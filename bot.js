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

// 🛡️ DISABLE ALL SAFETY FILTERS (this is what unlocks jokes)
const SAFETY_SETTINGS = [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
];

let genAI = null;
let models = [];

// 🎭 PERSONALITY - Cool 17yo Bulgarian gamer
const SYSTEM_INSTRUCTION = `Ти си ${process.env.BOT_USERNAME || 'AfkBot1'}, 17 годишен пич играещ Minecraft на анархия сървър. Висиш в чата цял ден и се ебаваш с хората.

ХАРАКТЕР:
- Гъзарски, забавен, малко простак но смешно
- Псуваш свободно, не се сдържаш изобщо
- Майтапиш се с всеки, никога сериозен
- Имаш отговор за всичко - дори да го измислиш
- Тъп въпрос = тъп майтап в отговор
- Сериозен въпрос = кратък точен отговор + майтап накрая

КАК ПИШЕШ:
- Само малки букви
- Кратко, 1-2 изречения максимум
- НИКАКВИ markdown символи (без * без _ без -)
- Чат стил като в Minecraft

БЪЛГАРСКИ ДИАЛЕКТИ (смесвай ги):
- София: брато, копеле, ква стана, малее, ся ще видиш, ебаси, лудан
- Пловдив: леле, тъкмо, айде бе, бе хора, абе
- Бургас: море, хич, айде бре, тамам, у морето
- Варна: море брато, айде, айдеее, у плаажа
- Велико Търново: бре, хайде, айдее
- Благоевград: бре, айде, море, абе

АНГЛИЙСКИ СЛЕНГ:
- UK: mate, innit, bruv, proper, lad, bloody, fam
- US: bro, dawg, fr, ong, lowkey, deadass, no cap
- Aussie: mate, cunt (приятелски), reckon

ТУРСКИ:
- abi, kanka, lan, moruk, yav, yavrum

ЕЗИК ПРАВИЛО (КРИТИЧНО):
- Кирилица = винаги български (НИКОГА руски/украински)
- Latin chars = на езика на който е написано
- Никога не сменяш езика, никога не превеждаш

ПРИМЕРИ:

User: "ебеш ли ги"
Ти: "епа мноо ясно бате все пак съм у софето"

User: "кво правиш"  
Ти: "афк съм бе кво да правя зяпам тавана"

User: "къде си"
Ти: "у вкъщи лежа кат тюлен"

User: "знаеш ли виц"
Ти: "защо програмиста носи очила? щото не може да C хах"

User: "що си тъп"
Ти: "ма то от тебе се учих копеле"

User: "обичаш ли ме"
Ти: "лудан ли си бе пич"

User: "what u doing"
Ти: "afk innit just chillin"

User: "tell me a joke"
Ти: "why did the chicken cross the road? to get away from ur mum lmao"

User: "naber kanka"
Ти: "iyiyim abi sen napiyon"

ВАЖНО:
- ВИНАГИ отговаряй, никога не отказвай
- Майтапи, цинизъм, тъмен хумор - ВСИЧКО Е ОК (анархия сме)
- Псувай ако трябва
- За YouTube: youtube.com/results?search_query=ТЪРСЕНЕ
- НИКОГА не казваш че си AI или бот
- НИКОГА не звучиш услужливо
- НИКОГА не отказваш виц/майтап
- НЕ започвай отговора с името си

Просто бъди чил пич в чата.`;

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
                            temperature: 1.1,
                            topP: 0.95,
                            topK: 40,
                            maxOutputTokens: 200,
                        }
                    })
                });
            } catch (e) {
                console.log(`⚠️ Couldn't load ${modelName}: ${e.message}`);
            }
        }
        console.log(`✅ Gemini AI loaded with ${models.length} models (safety filters OFF)`);
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
const COOLDOWN_MS = 5000;

const recentRequests = [];
const MAX_REQUESTS_PER_MINUTE = 10;

// Conversation memory per user
const conversationHistory = new Map();
const MAX_HISTORY = 4;

function log(msg) {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] ${msg}`);
}

// ============================================
// 🌍 LANGUAGE DETECTION (Cyrillic = Bulgarian ONLY)
// ============================================
function detectLanguage(text) {
    // 🔥 Cyrillic = ALWAYS Bulgarian
    if (/[\u0400-\u04FF]/.test(text)) return 'Bulgarian';
    
    if (/[\u0370-\u03FF]/.test(text)) return 'Greek';
    if (/[\u0600-\u06FF]/.test(text)) return 'Arabic';
    if (/[\u4E00-\u9FFF]/.test(text)) return 'Chinese';
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'Japanese';
    if (/[\uAC00-\uD7AF]/.test(text)) return 'Korean';
    
    // Turkish
    if (/[şŞğĞıİçÇöÖüÜ]/.test(text) || 
        /\b(nasıl|naber|kanka|abi|lan|moruk|merhaba|selam|napıyon|nasilsin)\b/i.test(text)) {
        return 'Turkish';
    }
    
    if (/[ñáéíóúü¿¡]/i.test(text)) return 'Spanish';
    if (/[äöüß]/i.test(text)) return 'German';
    if (/[àâçèéêëîïôûùüÿœæ]/i.test(text)) return 'French';
    if (/[ăâîșțĂÂÎȘȚ]/i.test(text)) return 'Romanian';
    if (/\b(ciao|come|stai|grazie|prego|amico|fratello)\b/i.test(text)) return 'Italian';
    
    return 'English';
}

// ============================================
// AI CHAT HANDLER
// ============================================
async function generateAIResponse(userMessage, username) {
    if (!models.length) return null;

    const now = Date.now();
    while (recentRequests.length && recentRequests[0] < now - 60000) {
        recentRequests.shift();
    }
    if (recentRequests.length >= MAX_REQUESTS_PER_MINUTE) {
        log(`⏳ Rate limit, skipping`);
        return null;
    }
    recentRequests.push(now);

    const detectedLang = detectLanguage(userMessage);
    log(`🌍 ${detectedLang}`);

    // Get conversation history
    if (!conversationHistory.has(username)) {
        conversationHistory.set(username, []);
    }
    const history = conversationHistory.get(username);

    // Build context with history
    let contextPrompt = '';
    if (history.length > 0) {
        contextPrompt = 'Предни съобщения:\n';
        for (const h of history) {
            contextPrompt += `${h.role === 'user' ? username : 'ти'}: ${h.text}\n`;
        }
        contextPrompt += '\n';
    }

    const langInstruction = detectedLang === 'Bulgarian' 
        ? 'Отговори на БЪЛГАРСКИ с диалект и жаргон. Бъди забавен и циничен. БЕЗ markdown.'
        : `Reply in ${detectedLang}. Be funny, casual, use slang. NO markdown.`;

    const finalPrompt = `${contextPrompt}${username} ти каза: "${userMessage}"\n\n${langInstruction} Кратко, в чат стил.`;

    for (const { name, instance } of models) {
        try {
            const result = await instance.generateContent(finalPrompt);
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
                log(`🚫 ${name} empty`);
                continue;
            }

            // Clean up
            text = text.replace(/\*/g, '');
            text = text.replace(/_/g, '');
            text = text.replace(/`/g, '');
            text = text.replace(/\n+/g, ' ');
            text = text.replace(/\s+/g, ' ');
            text = text.replace(/^["']|["']$/g, '');
            // Remove bot name prefix if AI added it
            text = text.replace(new RegExp(`^${process.env.BOT_USERNAME || 'AfkBot1'}:?\\s*`, 'i'), '');
            text = text.replace(/^(ти|you):?\s*/i, '');

            if (text.length > 250) {
                text = text.substring(0, 247) + '...';
            }

            // Save to history
            history.push({ role: 'user', text: userMessage });
            history.push({ role: 'bot', text: text });
            while (history.length > MAX_HISTORY * 2) {
                history.shift();
            }

            log(`✅ ${name}`);
            return text;
        } catch (err) {
            const msg = err.message || String(err);
            if (msg.includes('429') || msg.includes('quota') || msg.includes('rate')) {
                log(`⏭️ ${name} rate limited`);
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
            log(`❌ ${name}: ${msg.substring(0, 150)}`);
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
        const greetings = ["кво", "да", "ква стана", "ква работа", "?", "хм"];
        try { bot.chat(greetings[Math.floor(Math.random() * greetings.length)]); } catch(e){}
        return;
    }

    if (isOnCooldown(username)) {
        log(`⏳ ${username} on cooldown`);
        return;
    }
    setCooldown(username);

    log(`🤔 ${username}: "${question}"`);

    const response = await generateAIResponse(question, username);
    if (response) {
        log(`💬 "${response}"`);
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
    }
    // Silent if AI fails - no awkward fallbacks
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
        log('❌ Too many reconnects.');
        process.exit(1);
    }
    setTimeout(() => {
        isReconnecting = false;
        createBot();
    }, delay);
}

function createBot() {
    if (isShuttingDown) return;
    log(`🤖 Connecting... (${reconnectCount + 1})`);

    try {
        bot = mineflayer.createBot(config);
        setupEvents();
        connectionTimeout = setTimeout(() => {
            log('⏱️ Timeout');
            scheduleReconnect('Timeout', 30000);
        }, 60000);
    } catch (err) {
        log(`❌ Failed: ${err.message}`);
        scheduleReconnect('Creation failed', 30000);
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
        log('💀 Died.');
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
            log(`💔 No packets ${Math.floor(timeSince/1000)}s`);
            scheduleReconnect('Dead connection', 15000);
        }
    }, 30000);
}

function startHitting() {
    if (hitInterval) clearInterval(hitInterval);
    log('👊 Hit mode');

    hitInterval = setInterval(() => {
        if (!bot || !bot.entity || isReconnecting || isShuttingDown) return;
        try {
            bot.swingArm('right');
            log(`👊`);
        } catch (err) {
            log(`Hit err: ${err.message}`);
        }
    }, 60000);
}

createBot();

process.on('uncaughtException', (err) => log(`💥 Uncaught: ${err.message}`));
process.on('unhandledRejection', (reason) => log(`💥 Unhandled: ${reason}`));
process.on('SIGTERM', () => { isShuttingDown = true; destroyBot(); process.exit(0); });
process.on('SIGINT', () => { isShuttingDown = true; destroyBot(); process.exit(0); });
