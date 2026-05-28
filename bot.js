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
// GEMINI SETUP - Multiple models for fallback
// ============================================
const MODELS_TO_TRY = [
    'gemini-2.5-flash',           // Best free option (2025)
    'gemini-2.5-flash-lite',      // Backup
    'gemini-2.0-flash-lite',      // Older but stable
    'gemini-1.5-flash',           // Last resort
    'gemini-1.5-flash-8b'         // Cheapest tier
];

let genAI = null;
let models = [];

const SYSTEM_INSTRUCTION = `You are a Minecraft player named ${process.env.BOT_USERNAME || 'AfkBot1'}, currently AFK on an anarchy SMP server.

Rules:
- ALWAYS respond in the SAME LANGUAGE the user wrote in (English, Bulgarian, Russian, Spanish, etc.)
- Keep responses SHORT (under 100 characters when possible) - it's Minecraft chat
- Be casual, fun, use slang, act like a teenager gamer
- Don't use markdown, no asterisks, no bullet points - plain text only
- Don't break character - you're a player chilling on the server
- If asked technical questions, answer briefly
- Use lowercase mostly, like real Minecraft chat
- Add some humor / banter when appropriate
- Never mention you're an AI - you're just a player named ${process.env.BOT_USERNAME || 'AfkBot1'}`;

if (GEMINI_KEY) {
    try {
        genAI = new GoogleGenerativeAI(GEMINI_KEY);
        // Pre-load all models
        for (const modelName of MODELS_TO_TRY) {
            try {
                models.push({
                    name: modelName,
                    instance: genAI.getGenerativeModel({
                        model: modelName,
                        systemInstruction: SYSTEM_INSTRUCTION
                    })
                });
            } catch (e) {
                console.log(`⚠️ Couldn't load ${modelName}: ${e.message}`);
            }
        }
        console.log(`✅ Gemini AI loaded with ${models.length} models`);
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

// Rate limiting per user
const userCooldowns = new Map();
const COOLDOWN_MS = 8000; // 8 seconds per user (slower to avoid spam)

// Global rate limiting (avoid hitting API limits)
const recentRequests = [];
const MAX_REQUESTS_PER_MINUTE = 10; // Conservative

function log(msg) {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] ${msg}`);
}

// ============================================
// AI CHAT HANDLER WITH FALLBACK
// ============================================
async function generateAIResponse(userMessage, username) {
    if (!models.length) return null;

    // Check global rate limit
    const now = Date.now();
    while (recentRequests.length && recentRequests[0] < now - 60000) {
        recentRequests.shift();
    }
    if (recentRequests.length >= MAX_REQUESTS_PER_MINUTE) {
        log(`⏳ Global rate limit hit. Skipping.`);
        return null;
    }
    recentRequests.push(now);

    // Try each model until one works
    for (const { name, instance } of models) {
        try {
            const result = await instance.generateContent(
                `Player "${username}" says to you: "${userMessage}"\n\nRespond as ${process.env.BOT_USERNAME || 'AfkBot1'} would, in the same language.`
            );
            let response = result.response.text().trim();

            response = response.replace(/\*/g, '');
            response = response.replace(/\n+/g, ' ');
            response = response.replace(/\s+/g, ' ');

            if (response.length > 250) {
                response = response.substring(0, 247) + '...';
            }

            log(`✅ Used model: ${name}`);
            return response;
        } catch (err) {
            const msg = err.message || String(err);
            if (msg.includes('429') || msg.includes('quota') || msg.includes('rate')) {
                log(`⏭️ ${name} rate limited, trying next...`);
                continue;
            }
            if (msg.includes('404') || msg.includes('not found')) {
                log(`⏭️ ${name} not available, trying next...`);
                continue;
            }
            log(`❌ AI error with ${name}: ${msg.substring(0, 200)}`);
            continue;
        }
    }

    log(`❌ All models failed`);
    return null;
}

function isOnCooldown(username) {
    const lastUsed = userCooldowns.get(username);
    if (!lastUsed) return false;
    return (Date.now() - lastUsed) < COOLDOWN_MS;
}

function setCooldown(username) {
    userCooldowns.set(username, Date.now());
    if (userCooldowns.size > 100) {
        const now = Date.now();
        for (const [user, time] of userCooldowns.entries()) {
            if (now - time > 60000) userCooldowns.delete(user);
        }
    }
}

async function handleChatMessage(username, message) {
    if (!bot || username === bot.username) return;
    if (!models.length) return;

    const lowerMessage = message.toLowerCase().trim();
    if (!lowerMessage.startsWith(BOT_NAME)) return;

    let question = message.substring(BOT_NAME.length).trim();
    question = question.replace(/^[,:\-\s]+/, '');

    if (!question) {
        try { bot.chat(`yo ${username}`); } catch(e){}
        return;
    }

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
            const chunks = response.match(/.{1,250}/g) || [response];
            for (let i = 0; i < chunks.length; i++) {
                setTimeout(() => {
                    try { if (bot) bot.chat(chunks[i]); } catch(e){}
                }, i * 1500);
            }
        } catch(e) {
            log(`Chat send error: ${e.message}`);
        }
    } else {
        // All models failed - send a fallback message
        try {
            const fallbacks = ["brb thinking", "wait wait", "uhh", "hmm", "1 sec", "lag", "wifi died"];
            const fallback = fallbacks[Math.floor(Math.random() * fallbacks.length)];
            bot.chat(fallback);
        } catch(e) {}
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

createBot();

process.on('uncaughtException', (err) => log(`💥 Uncaught: ${err.message}`));
process.on('unhandledRejection', (reason) => log(`💥 Unhandled: ${reason}`));
process.on('SIGTERM', () => { isShuttingDown = true; destroyBot(); process.exit(0); });
process.on('SIGINT', () => { isShuttingDown = true; destroyBot(); process.exit(0); });
