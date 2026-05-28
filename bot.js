const mineflayer = require('mineflayer');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ============================================
// CONFIG
// ============================================
const config = {
    host: process.env.SERVER_HOST,
    port: parseInt(process.env.SERVER_PORT) || 25565,
    username: process.env.BOT_USERNAME || 'AfkBot1',
    auth: 'offline',
    version: process.env.MC_VERSION || '1.20.1',
    hideErrors: false,
    checkTimeoutInterval: 30000,
    keepAlive: true,
    viewDistance: 'tiny'
};

const BOT_NAME = (process.env.BOT_USERNAME || 'AfkBot1').toLowerCase();
const GEMINI_KEY = process.env.GEMINI_API_KEY;

// ============================================
// GEMINI SETUP
// ============================================
let genAI = null;
let model = null;

if (GEMINI_KEY) {
    try {
        genAI = new GoogleGenerativeAI(GEMINI_KEY);
        model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash",  // Fast & free
            systemInstruction: `You are a Minecraft player named ${process.env.BOT_USERNAME || 'AfkBot1'}, currently AFK on an anarchy SMP server. 
            
Rules:
- ALWAYS respond in the SAME LANGUAGE the user wrote in (English, Bulgarian, Russian, Spanish, etc.)
- Keep responses SHORT (under 100 characters when possible) - it's Minecraft chat
- Be casual, fun, use slang, act like a teenager gamer
- Don't use markdown, no asterisks, no bullet points - plain text only
- Don't break character - you're a player chilling on the server
- If asked technical questions, answer briefly
- Use lowercase mostly, like real Minecraft chat
- Add some humor / banter when appropriate
- Never mention you're an AI - you're just a player named ${process.env.BOT_USERNAME || 'AfkBot1'}`
        });
        console.log('✅ Gemini AI loaded');
    } catch (err) {
        console.log(`⚠️ Gemini failed to load: ${err.message}`);
    }
} else {
    console.log('⚠️ No GEMINI_API_KEY set - chat AI disabled');
}

// ============================================
// STATE
// ============================================
let bot = null;
let hitInterval = null;
let healthCheckInterval = null;
let connectionTimeout = null;
let reconnectCount = 0;
let isReconnecting = false;
let isShuttingDown = false;
let lastPacketTime = Date.now();
const MAX_RECONNECTS = 50;

// Rate limiting (avoid spam abuse)
const userCooldowns = new Map();
const COOLDOWN_MS = 5000; // 5 seconds per user

function log(msg) {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] ${msg}`);
}

// ============================================
// AI CHAT HANDLER
// ============================================
async function generateAIResponse(userMessage, username) {
    if (!model) return null;
    
    try {
        const result = await model.generateContent(
            `Player "${username}" says to you: "${userMessage}"\n\nRespond as ${process.env.BOT_USERNAME || 'AfkBot1'} would, in the same language.`
        );
        let response = result.response.text().trim();
        
        // Clean up response for Minecraft chat
        response = response.replace(/\*/g, ''); // No asterisks
        response = response.replace(/\n+/g, ' '); // No newlines
        response = response.replace(/\s+/g, ' '); // No double spaces
        
        // Minecraft chat limit is 256 chars
        if (response.length > 250) {
            response = response.substring(0, 247) + '...';
        }
        
        return response;
    } catch (err) {
        log(`❌ AI error: ${err.message}`);
        return null;
    }
}

function isOnCooldown(username) {
    const lastUsed = userCooldowns.get(username);
    if (!lastUsed) return false;
    return (Date.now() - lastUsed) < COOLDOWN_MS;
}

function setCooldown(username) {
    userCooldowns.set(username, Date.now());
    // Clean up old entries every 100 messages
    if (userCooldowns.size > 100) {
        const now = Date.now();
        for (const [user, time] of userCooldowns.entries()) {
            if (now - time > 60000) userCooldowns.delete(user);
        }
    }
}

async function handleChatMessage(username, message) {
    if (username === bot.username) return; // Ignore self
    if (!model) return; // AI not available
    
    const lowerMessage = message.toLowerCase().trim();
    
    // Check if bot name is mentioned at start
    if (!lowerMessage.startsWith(BOT_NAME)) return;
    
    // Extract the actual question (remove bot name)
    let question = message.substring(BOT_NAME.length).trim();
    
    // Remove common separators after the name
    question = question.replace(/^[,:\-\s]+/, '');
    
    if (!question) {
        // Just mentioned name with no question
        try { bot.chat(`yo ${username}`); } catch(e){}
        return;
    }
    
    // Rate limit
    if (isOnCooldown(username)) {
        log(`⏳ ${username} on cooldown`);
        return;
    }
    setCooldown(username);
    
    log(`🤔 ${username} asked: "${question}"`);
    
    const response = await generateAIResponse(question, username);
    if (response) {
        log(`💬 Responding: "${response}"`);
        try {
            // Split into multiple messages if too long (256 char limit)
            const chunks = response.match(/.{1,250}/g) || [response];
            for (let i = 0; i < chunks.length; i++) {
                setTimeout(() => {
                    try { if (bot) bot.chat(chunks[i]); } catch(e){}
                }, i * 1500); // 1.5s delay between chunks
            }
        } catch(e) {
            log(`Chat send error: ${e.message}`);
        }
    }
}

// ============================================
// BOT LIFECYCLE
// ============================================
function destroyBot() {
    if (bot) {
        try {
            bot.removeAllListeners();
            if (bot._client) {
                bot._client.removeAllListeners();
                try { bot._client.end(); } catch(e) {}
                try { bot._client.destroy(); } catch(e) {}
            }
            try { bot.quit(); } catch(e) {}
            try { bot.end(); } catch(e) {}
        } catch (e) {}
        bot = null;
    }
    if (hitInterval) clearInterval(hitInterval);
    if (connectionTimeout) clearTimeout(connectionTimeout);
    if (healthCheckInterval) clearInterval(healthCheckInterval);
}

function scheduleReconnect(reason, delay = 30000) {
    if (isShuttingDown || isReconnecting) return;
    isReconnecting = true;
    log(`🔄 Reconnecting in ${delay/1000}s: ${reason}`);
    destroyBot();
    reconnectCount++;
    if (reconnectCount >= MAX_RECONNECTS) {
        log('❌ Too many reconnects. Stopping.');
        process.exit(1);
    }
    setTimeout(() => {
        isReconnecting = false;
        createBot();
    }, delay);
}

function createBot() {
    if (isShuttingDown) return;
    log(`🤖 Connecting... (Attempt ${reconnectCount + 1})`);

    try {
        bot = mineflayer.createBot(config);
        setupEvents();
        connectionTimeout = setTimeout(() => {
            log('⏱️ Connection timeout');
            scheduleReconnect('Timeout', 30000);
        }, 60000);
    } catch (err) {
        log(`❌ Failed: ${err.message}`);
        scheduleReconnect('Bot creation failed', 30000);
    }
}

function setupEvents() {
    bot.on('login', () => log(`🔑 Logged in`));

    bot.on('spawn', () => {
        if (connectionTimeout) clearTimeout(connectionTimeout);
        if (!bot || !bot.entity) return;
        log(`✅ Spawned as "${bot.username}"`);
        reconnectCount = 0;
        startHitting();
        startHealthCheck();
    });

    // 💬 CHAT HANDLER - This is where the magic happens
    bot.on('chat', async (username, message) => {
        log(`💬 <${username}> ${message}`);
        await handleChatMessage(username, message);
    });

    bot.on('kicked', (reason) => {
        let kickText = String(reason);
        try {
            const parsed = JSON.parse(reason);
            kickText = parsed.translate || parsed.text || JSON.stringify(parsed);
        } catch (e) {}
        log(`⚠️ Kicked: ${kickText}`);

        let delay = 30000;
        if (kickText.includes('throttled')) delay = 60000;
        else if (kickText.includes('duplicate_login')) delay = 45000;
        else if (kickText.includes('banned')) {
            log('🚫 BANNED');
            process.exit(1);
        }
        scheduleReconnect(`Kicked: ${kickText}`, delay);
    });

    bot.on('error', (err) => {
        log(`❌ Error: ${err.message}`);
        scheduleReconnect(`Error: ${err.message}`, 30000);
    });

    bot.on('end', (reason) => {
        log(`🔌 Disconnected: ${reason}`);
        scheduleReconnect(`Disconnected: ${reason}`, 25000);
    });

    bot.on('death', () => {
        log('💀 Died. Respawning...');
        setTimeout(() => { try { if (bot) bot.respawn(); } catch(e) {} }, 2000);
    });
}

function startHealthCheck() {
    if (healthCheckInterval) clearInterval(healthCheckInterval);
    lastPacketTime = Date.now();
    if (bot && bot._client) {
        bot._client.on('packet', () => { lastPacketTime = Date.now(); });
    }
    healthCheckInterval = setInterval(() => {
        if (!bot || isReconnecting) return;
        const timeSince = Date.now() - lastPacketTime;
        if (timeSince > 90000) {
            log(`💔 No packets for ${Math.floor(timeSince/1000)}s`);
            scheduleReconnect('Dead connection', 15000);
        }
    }, 30000);
}

// 👊 HIT EVERY 60 SECONDS (keeps bot active, prevents AFK kick)
function startHitting() {
    if (hitInterval) clearInterval(hitInterval);
    log('👊 Hit mode started (every 60s)');

    hitInterval = setInterval(() => {
        if (!bot || !bot.entity || isReconnecting || isShuttingDown) return;
        try {
            bot.swingArm('right');
            log(`👊 Hit`);
        } catch (err) {
            log(`Hit error: ${err.message}`);
        }
    }, 60000);
}

// ============================================
// START
// ============================================
createBot();

process.on('uncaughtException', (err) => log(`💥 Uncaught: ${err.message}`));
process.on('unhandledRejection', (reason) => log(`💥 Unhandled: ${reason}`));
process.on('SIGTERM', () => { isShuttingDown = true; destroyBot(); process.exit(0); });
process.on('SIGINT', () => { isShuttingDown = true; destroyBot(); process.exit(0); });
