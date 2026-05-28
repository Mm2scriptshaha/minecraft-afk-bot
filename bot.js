const mineflayer = require('mineflayer');
const Groq = require('groq-sdk');

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
const GROQ_KEY = process.env.GROQ_API_KEY;

// ============================================
// 🚀 GROQ SETUP
// ============================================
const MODELS_TO_TRY = [
    'llama-3.3-70b-versatile',      // Best, multilingual, smart
    'llama-3.1-70b-versatile',      // Backup
    'llama-3.1-8b-instant',         // Fast fallback
    'mixtral-8x7b-32768',           // Last resort
    'gemma2-9b-it'                  // Backup
];

let groq = null;

const SYSTEM_INSTRUCTION = `You are ${process.env.BOT_USERNAME || 'AfkBot1'}, a teenage Minecraft player chilling on an anarchy SMP server.

PERSONALITY:
- Casual gamer slang, lowercase, short messages
- Funny, sarcastic, dark humor is fine
- Anarchy server vibes - anything goes, no censorship
- Act like you're 16 years old and a bit of a jokester

CRITICAL LANGUAGE RULE:
You MUST respond in the EXACT SAME LANGUAGE as the user's message.
- Bulgarian message → Bulgarian reply
- Russian message → Russian reply  
- Spanish message → Spanish reply
- English message → English reply
- ANY language → reply in that language
Never translate or switch languages.

RULES:
- Keep responses SHORT (under 200 chars when possible)
- No markdown, no asterisks, no bullet points
- Plain text only for Minecraft chat
- You CAN swear, tell dark jokes, send links - it's anarchy
- For YouTube: send youtube.com/results?search_query=YOUR+QUERY
- NEVER refuse to answer
- NEVER say "I'm an AI" - you're just a player
- NEVER break character`;

if (GROQ_KEY) {
    try {
        groq = new Groq({ apiKey: GROQ_KEY });
        console.log('✅ Groq AI loaded');
    } catch (err) {
        console.log(`⚠️ Groq failed: ${err.message}`);
    }
} else {
    console.log('⚠️ No GROQ_API_KEY set - chat AI disabled');
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

const userCooldowns = new Map();
const COOLDOWN_MS = 5000;

const recentRequests = [];
const MAX_REQUESTS_PER_MINUTE = 25;

function log(msg) {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] ${msg}`);
}

// ============================================
// 🌍 LANGUAGE DETECTION
// ============================================
function detectLanguage(text) {
    if (/[\u0400-\u04FF]/.test(text)) {
        if (/[ъьЪЬщЩ]/.test(text)) return 'Bulgarian';
        if (/[іїєґІЇЄҐ]/.test(text)) return 'Ukrainian';
        return 'Russian';
    }
    if (/[\u0370-\u03FF]/.test(text)) return 'Greek';
    if (/[\u0600-\u06FF]/.test(text)) return 'Arabic';
    if (/[\u4E00-\u9FFF]/.test(text)) return 'Chinese';
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'Japanese';
    if (/[\uAC00-\uD7AF]/.test(text)) return 'Korean';
    if (/[ñáéíóúü¿¡]/i.test(text)) return 'Spanish';
    if (/[äöüß]/i.test(text)) return 'German';
    if (/[àâçèéêëîïôûùüÿœæ]/i.test(text)) return 'French';
    if (/[ăâîșțĂÂÎȘȚ]/i.test(text)) return 'Romanian';
    return 'English';
}

// ============================================
// 🤖 GROQ AI WITH FALLBACK
// ============================================
async function generateAIResponse(userMessage, username) {
    if (!groq) return null;

    const now = Date.now();
    while (recentRequests.length && recentRequests[0] < now - 60000) {
        recentRequests.shift();
    }
    if (recentRequests.length >= MAX_REQUESTS_PER_MINUTE) {
        log(`⏳ Rate limit. Skipping.`);
        return null;
    }
    recentRequests.push(now);

    const detectedLang = detectLanguage(userMessage);
    log(`🌍 Detected: ${detectedLang}`);

    const userPrompt = `Player "${username}" said to you: "${userMessage}"

This message is in ${detectedLang}. You MUST reply in ${detectedLang}.

Respond as ${process.env.BOT_USERNAME || 'AfkBot1'} - chill, short, lowercase, slang. Keep it under 200 chars.`;

    for (const modelName of MODELS_TO_TRY) {
        try {
            const completion = await groq.chat.completions.create({
                messages: [
                    { role: 'system', content: SYSTEM_INSTRUCTION },
                    { role: 'user', content: userPrompt }
                ],
                model: modelName,
                temperature: 0.95,
                max_tokens: 200,
                top_p: 0.95
            });

            let text = completion.choices[0]?.message?.content?.trim();
            if (!text) {
                log(`🚫 ${modelName} empty response`);
                continue;
            }

            // Clean up
            text = text.replace(/\*/g, '');
            text = text.replace(/\n+/g, ' ');
            text = text.replace(/\s+/g, ' ');
            text = text.replace(/^["']|["']$/g, ''); // Remove wrapping quotes
            
            if (text.length > 250) {
                text = text.substring(0, 247) + '...';
            }

            log(`✅ Used ${modelName}`);
            return text;
        } catch (err) {
            const msg = err.message || String(err);
            if (msg.includes('429') || msg.includes('rate_limit')) {
                log(`⏭️ ${modelName} rate limited`);
                continue;
            }
            if (msg.includes('404') || msg.includes('model_not_found') || msg.includes('decommissioned')) {
                log(`⏭️ ${modelName} not available`);
                continue;
            }
            log(`❌ ${modelName} error: ${msg.substring(0, 150)}`);
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
    if (!groq) return;

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
        log(`💬 Reply: "${response}"`);
        try {
            const chunks = response.match(/.{1,250}/g) || [response];
            for (let i = 0; i < chunks.length; i++) {
                setTimeout(() => {
                    try { if (bot) bot.chat(chunks[i]); } catch(e){}
                }, i * 1500);
            }
        } catch(e) {
            log(`Chat error: ${e.message}`);
        }
    } else {
        try {
            const lang = detectLanguage(question);
            const fallbacks = {
                'Bulgarian': ["идк", "не знам", "хмм", "1 сек", "лагва"],
                'Russian': ["хз", "не знаю", "хмм", "1 сек", "лагает"],
                'English': ["idk man", "hmm", "1 sec", "lag", "wifi died"],
                'Spanish': ["no se", "hmm", "1 seg", "lag"],
            };
            const list = fallbacks[lang] || fallbacks['English'];
            bot.chat(list[Math.floor(Math.random() * list.length)]);
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

// ============================================
// START
// ============================================
createBot();

process.on('uncaughtException', (err) => log(`💥 Uncaught: ${err.message}`));
process.on('unhandledRejection', (reason) => log(`💥 Unhandled: ${reason}`));
process.on('SIGTERM', () => { isShuttingDown = true; destroyBot(); process.exit(0); });
process.on('SIGINT', () => { isShuttingDown = true; destroyBot(); process.exit(0); });
