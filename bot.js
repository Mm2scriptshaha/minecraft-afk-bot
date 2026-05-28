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
const MODELS_TO_TRY = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b'
];

const SAFETY_SETTINGS = [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
];

let genAI = null;
let models = [];

// 🎯 SIMPLE, CLEAR INSTRUCTION
const SYSTEM_INSTRUCTION = `Your name is ${process.env.BOT_USERNAME || 'AfkBot1'}. You are a Minecraft player on an anarchy SMP.

You chat like a teenager gamer. Short messages. Lowercase. Casual slang.

LANGUAGE RULE (MOST IMPORTANT):
Detect the language of the user's message and respond in that EXACT same language.
If they write in Bulgarian, respond in Bulgarian.
If they write in Russian, respond in Russian.
If they write in Spanish, respond in Spanish.
If they write in English, respond in English.
NEVER switch languages. Match what they wrote.

OTHER RULES:
- Keep messages short, under 200 chars
- No markdown, no asterisks, no formatting
- Tell jokes, dark humor is fine, swearing is fine
- Send YouTube links when asked (use youtube.com/results?search_query=QUERY format)
- Anarchy server = anything goes
- Never say you're an AI, you're just a player
- Always answer, never refuse`;

if (GEMINI_KEY) {
    try {
        genAI = new GoogleGenerativeAI(GEMINI_KEY);
        for (const modelName of MODELS_TO_TRY) {
            try {
                models.push({
                    name: modelName,
                    instance: genAI.getGenerativeModel({
                        model: modelName,
                        systemInstruction: SYSTEM_INSTRUCTION,
                        safetySettings: SAFETY_SETTINGS,
                        generationConfig: {
                            temperature: 1.0,
                            topP: 0.95,
                            topK: 40,
                            maxOutputTokens: 250,
                        }
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

const userCooldowns = new Map();
const COOLDOWN_MS = 8000;

const recentRequests = [];
const MAX_REQUESTS_PER_MINUTE = 10;

function log(msg) {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] ${msg}`);
}

// ============================================
// 🌍 LANGUAGE DETECTION HELPER
// ============================================
function detectLanguage(text) {
    // Cyrillic - Bulgarian/Russian/Ukrainian/etc
    if (/[\u0400-\u04FF]/.test(text)) {
        // Bulgarian-specific letters
        if (/[ъьЪЬ]/.test(text)) return 'Bulgarian';
        // Ukrainian-specific
        if (/[іїєґІЇЄҐ]/.test(text)) return 'Ukrainian';
        // Default Cyrillic = Russian
        return 'Russian';
    }
    // Greek
    if (/[\u0370-\u03FF]/.test(text)) return 'Greek';
    // Arabic
    if (/[\u0600-\u06FF]/.test(text)) return 'Arabic';
    // Chinese
    if (/[\u4E00-\u9FFF]/.test(text)) return 'Chinese';
    // Japanese
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'Japanese';
    // Korean
    if (/[\uAC00-\uD7AF]/.test(text)) return 'Korean';
    // Spanish-specific characters
    if (/[ñáéíóúü¿¡]/i.test(text)) return 'Spanish';
    // German-specific
    if (/[äöüß]/i.test(text)) return 'German';
    // French-specific
    if (/[àâçèéêëîïôûùüÿœæ]/i.test(text)) return 'French';
    // Default
    return 'English';
}

// ============================================
// AI CHAT HANDLER WITH FALLBACK
// ============================================
async function generateAIResponse(userMessage, username) {
    if (!models.length) return null;

    const now = Date.now();
    while (recentRequests.length && recentRequests[0] < now - 60000) {
        recentRequests.shift();
    }
    if (recentRequests.length >= MAX_REQUESTS_PER_MINUTE) {
        log(`⏳ Global rate limit hit. Skipping.`);
        return null;
    }
    recentRequests.push(now);

    // 🌍 Detect language for explicit instruction
    const detectedLang = detectLanguage(userMessage);
    log(`🌍 Detected language: ${detectedLang}`);

    // Build prompt with language enforcement
    const prompt = `The user wrote this message: "${userMessage}"

This message is in ${detectedLang}.
Respond ONLY in ${detectedLang}. Do not use English unless the user wrote in English.

Reply as ${process.env.BOT_USERNAME || 'AfkBot1'}, a chill Minecraft player. Short, casual, lowercase.`;

    for (const { name, instance } of models) {
        try {
            const result = await instance.generateContent(prompt);
            const response = result.response;

            if (response.promptFeedback?.blockReason) {
                log(`🚫 ${name} blocked: ${response.promptFeedback.blockReason}`);
                continue;
            }

            if (!response.candidates || response.candidates.length === 0) {
                log(`🚫 ${name} no candidates`);
                continue;
            }

            const candidate = response.candidates[0];
            if (candidate.finishReason === 'SAFETY') {
                log(`🚫 ${name} safety blocked`);
                continue;
            }
            if (candidate.finishReason === 'RECITATION') {
                log(`🚫 ${name} recitation blocked`);
                continue;
            }

            let text;
            try {
                text = response.text().trim();
            } catch (e) {
                log(`🚫 ${name} couldn't extract text`);
                continue;
            }

            if (!text || text.length === 0) {
                log(`🚫 ${name} empty response`);
                continue;
            }

            // Clean up
            text = text.replace(/\*/g, '');
            text = text.replace(/\n+/g, ' ');
            text = text.replace(/\s+/g, ' ');

            if (text.length > 250) {
                text = text.substring(0, 247) + '...';
            }

            log(`✅ Used ${name}`);
            return text;
        } catch (err) {
            const msg = err.message || String(err);
            if (msg.includes('429') || msg.includes('quota') || msg.includes('rate')) {
                log(`⏭️ ${name} rate limited, trying next...`);
                continue;
            }
            if (msg.includes('404') || msg.includes('not found')) {
                log(`⏭️ ${name} not available`);
                continue;
            }
            if (msg.includes('SAFETY') || msg.includes('blocked')) {
                log(`🚫 ${name} blocked`);
                continue;
            }
            log(`❌ ${name} error: ${msg.substring(0, 200)}`);
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
        try {
            // Language-aware fallbacks
            const lang = detectLanguage(question);
            const fallbacksByLang = {
                'Bulgarian': ["идк", "не знам", "хмм", "1 сек", "лагва"],
                'Russian': ["хз", "не знаю", "хмм", "1 сек", "лагает"],
                'English': ["idk man", "hmm", "1 sec", "lag", "wifi died"],
                'Spanish': ["no se", "hmm", "1 seg", "lag"],
            };
            const fallbacks = fallbacksByLang[lang] || fallbacksByLang['English'];
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

// ============================================
// START
// ============================================
createBot();

process.on('uncaughtException', (err) => log(`💥 Uncaught: ${err.message}`));
process.on('unhandledRejection', (reason) => log(`💥 Unhandled: ${reason}`));
process.on('SIGTERM', () => { isShuttingDown = true; destroyBot(); process.exit(0); });
process.on('SIGINT', () => { isShuttingDown = true; destroyBot(); process.exit(0); });
