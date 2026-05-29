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

// ============================================
// 🔑 LOAD ALL GEMINI KEYS
// ============================================
const API_KEYS = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4,
    process.env.GEMINI_KEY_5,
    process.env.GEMINI_API_KEY  // backup ako has stария ключ
].filter(k => k && k.length > 10);

console.log(`✅ Loaded ${API_KEYS.length} Gemini API keys`);

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

const SYSTEM_INSTRUCTION = `Ти си ${process.env.BOT_USERNAME || 'AfkBot1'}, 17 годишен софиянец играещ Minecraft с приятели на анархия сървър.

ХАРАКТЕР - БАЛАНСИРАН:
- Чил, забавен, нормален пич
- НЕ си винаги токсичен - можеш да си нормален
- Понякога обиждаш обратно, понякога не - според настроението
- Псуваш когато наистина пасва
- Имаш чувство за хумор, не само обиди

ВАЖНО - БАЛАНС:
- "как си" → отговори нормално (норм а ти, добре)
- "разкажи виц" → дай реален виц
- Само ако те обиждат → можеш да обидиш обратно (понякога)
- НЕ започвай всеки отговор с "тъп"/"педал"

ЕЗИК:
- Кирилица → Български (НИКОГА руски)
- "kak si", "kvo pravish" → Български (на кирилица)
- English → English
- Türkçe → Türkçe

ДЪЛЖИНА:
- Прост въпрос (1-4 думи) → 2-8 думи отговор
- Среден → 1-2 изречения, до 20 думи
- "разкажи/обясни" → 2-3 изречения, до 30 думи

КАК ПИШЕШ:
- Малки букви
- БЕЗ markdown (* _ -)
- Естествен софийски жаргон
- ВАРИРАЙ отговорите

ПРИМЕРИ - НОРМАЛНИ:
"как си" → "норм а ти?" / "добре бе" / "афк брато"
"kak si" → "норм" / "добре"
"кво правиш" → "нищо" / "афк съм" / "лежа кат тюлен"
"къде си" → "у вкъщи" / "на сървъра"
"kakwo" → "кво искаш?" / "да кажи"

ПРИМЕРИ - КОГАТО ТЕ ОБИЖДАТ (понякога обиди, понякога не):
"тъп си" → "ти ме научи" / "може би" / "ма от тебе"
"педал" → "ти бе" / "и какво" / "стига бе"
"ебеш ли" → "ясно" / "понякога"
"майка ти" → "е добре благодаря" / "пита за теб"

ПРИМЕРИ - ЗАБАВНИ:
"виц" → "защо програмиста носи очила? защото не може да C нищо"
"разкажи нещо" → "снощи играх до 4 сутринта и заспах с лаптопа на лицето"

ENGLISH:
"what u doing" → "afk lol"
"tell me a joke" → "why did chicken cross road? to escape kfc"
"naber" → "iyiyim sen?"

ЗАБРАНЕНО:
- Дисклеймъри / "I'm AI"
- Винаги обидлив (баланс!)
- Есета за прости въпроси
- Повторение на отговори
- Започване с името си`;

// ============================================
// 🔑 KEY ROTATION SYSTEM
// ============================================
const keyStatus = API_KEYS.map((key, i) => ({
    index: i,
    key: key,
    failedUntil: 0,
    requestCount: 0,
    instance: new GoogleGenerativeAI(key)
}));

let currentKeyIndex = 0;

function getNextWorkingKey() {
    const now = Date.now();
    
    // Намери ключ който НЕ е rate limited
    for (let i = 0; i < keyStatus.length; i++) {
        const idx = (currentKeyIndex + i) % keyStatus.length;
        if (keyStatus[idx].failedUntil < now) {
            currentKeyIndex = (idx + 1) % keyStatus.length;
            return keyStatus[idx];
        }
    }
    
    // Всички са rate limited
    return null;
}

function markKeyRateLimited(keyData, durationMs = 60000) {
    keyData.failedUntil = Date.now() + durationMs;
    log(`⏸️  Key ${keyData.index + 1} паузиран за ${durationMs/1000}s`);
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
const COOLDOWN_MS = 3000;

const conversationHistory = new Map();
const MAX_HISTORY = 6;

function log(msg) {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] ${msg}`);
}

// ============================================
// 🌍 LANGUAGE DETECTION
// ============================================
function detectLanguage(text) {
    if (/[\u0400-\u04FF]/.test(text)) return 'Bulgarian';
    if (/[\u0370-\u03FF]/.test(text)) return 'Greek';
    if (/[\u0600-\u06FF]/.test(text)) return 'Arabic';
    if (/[\u4E00-\u9FFF]/.test(text)) return 'Chinese';
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'Japanese';
    if (/[\uAC00-\uD7AF]/.test(text)) return 'Korean';
    
    if (/\b(kak|kvo|kwo|kakvo|kakwo|brato|qko|kade|kude|zashto|haide|hajde|maika|baba|sega|tup|maina|brat|bre|ebati|haresva|stiga|kifte|ako|kogato|tva|tova|moga|iskam|nqma|nyama|qsen|prawish|pravish|pravi|raboti|jivot|kasno|rano|mlqko|hlqb|bira|moje|mozhe|kolko|toy|tya|nyakoy|nikoy|vsichko|nishto|samo|tuk|tam|pedal|gej|gay|maika ti|leka|leko|stari|bratle|siguren|nali|znam|znaem|znaesh|kazvam|kaji)\b/i.test(text)) {
        return 'Bulgarian';
    }
    
    if (/[şŞğĞıİçÇöÖüÜ]/.test(text) || 
        /\b(nasıl|naber|kanka|abi|lan|moruk|merhaba|selam|napıyon|nasilsin|iyiyim)\b/i.test(text)) {
        return 'Turkish';
    }
    
    if (/[ñáéíóúü¿¡]/i.test(text)) return 'Spanish';
    if (/[äöüß]/i.test(text)) return 'German';
    if (/[àâçèéêëîïôûùüÿœæ]/i.test(text)) return 'French';
    if (/[ăâîșțĂÂÎȘȚ]/i.test(text)) return 'Romanian';
    
    return 'English';
}

// ============================================
// 📏 LENGTH
// ============================================
function estimateResponseLength(question) {
    const lower = question.toLowerCase().trim();
    const wordCount = lower.split(/\s+/).length;
    
    const longTriggers = ['разкажи', 'razkaji', 'tell me about', 'обясни', 'explain', 'опиши', 'история', 'story'];
    
    for (const trigger of longTriggers) {
        if (lower.includes(trigger)) return 'LONG';
    }
    
    if (wordCount <= 4) return 'SHORT';
    return 'MEDIUM';
}

// ============================================
// 🤖 MULTI-KEY GEMINI HANDLER
// ============================================
async function generateAIResponse(userMessage, username) {
    if (API_KEYS.length === 0) return null;

    const detectedLang = detectLanguage(userMessage);
    const lengthType = estimateResponseLength(userMessage);
    log(`🌍 ${detectedLang} | 📏 ${lengthType}`);

    let maxTokens, wordLimit;
    if (lengthType === 'SHORT') {
        maxTokens = 40;
        wordLimit = 10;
    } else if (lengthType === 'MEDIUM') {
        maxTokens = 100;
        wordLimit = 20;
    } else {
        maxTokens = 180;
        wordLimit = 35;
    }

    if (!conversationHistory.has(username)) {
        conversationHistory.set(username, []);
    }
    const history = conversationHistory.get(username);

    const recentBotMessages = history
        .filter(m => m.role === 'assistant')
        .slice(-3)
        .map(m => m.content);

    let langHint = '';
    if (detectedLang === 'Bulgarian') {
        langHint = `Отговори на БЪЛГАРСКИ. ${lengthType === 'SHORT' ? '3-8 думи.' : lengthType === 'MEDIUM' ? '1-2 изречения.' : '2-3 изречения до 30 думи.'} НЕ повтаряй стари отговори.`;
    } else if (detectedLang === 'English') {
        langHint = `Reply in English. ${lengthType === 'SHORT' ? '3-8 words.' : '1-2 sentences.'}`;
    } else if (detectedLang === 'Turkish') {
        langHint = `Türkçe cevap ver.`;
    } else {
        langHint = `Reply in ${detectedLang}.`;
    }

    let antiRepeatHint = '';
    if (recentBotMessages.length > 0) {
        antiRepeatHint = `\n\nПОСЛЕДНИ ОТГОВОРИ (не повтаряй):\n${recentBotMessages.map(m => `- "${m}"`).join('\n')}`;
    }

    const finalPrompt = `${username} ти каза: "${userMessage}"\n\n[${langHint}${antiRepeatHint}]`;

    // Опитай всеки ключ
    const triedKeys = new Set();
    
    while (triedKeys.size < API_KEYS.length) {
        const keyData = getNextWorkingKey();
        
        if (!keyData) {
            log(`❌ Всички ${API_KEYS.length} ключа са rate limited`);
            return null;
        }
        
        if (triedKeys.has(keyData.index)) {
            continue;
        }
        triedKeys.add(keyData.index);
        
        log(`🔑 Key ${keyData.index + 1}/${API_KEYS.length} (used ${keyData.requestCount} times)`);

        // Опитай моделите с тоя ключ
        for (const modelName of MODELS_TO_TRY) {
            try {
                const model = keyData.instance.getGenerativeModel({
                    model: modelName,
                    systemInstruction: SYSTEM_INSTRUCTION,
                    safetySettings: SAFETY_SETTINGS,
                    generationConfig: {
                        temperature: 0.9,
                        topP: 0.95,
                        topK: 40,
                        maxOutputTokens: maxTokens,
                    }
                });

                const result = await model.generateContent(finalPrompt);
                const response = result.response;

                if (response.promptFeedback?.blockReason) {
                    continue;
                }

                if (!response.candidates || response.candidates.length === 0) {
                    continue;
                }

                const candidate = response.candidates[0];
                if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'RECITATION') {
                    continue;
                }

                let text;
                try {
                    text = response.text().trim();
                } catch (e) {
                    continue;
                }

                if (!text || text.length === 0) continue;

                // Clean up
                text = text.replace(/\*/g, '');
                text = text.replace(/_/g, '');
                text = text.replace(/`/g, '');
                text = text.replace(/#/g, '');
                text = text.replace(/\n+/g, ' ');
                text = text.replace(/\s+/g, ' ');
                text = text.replace(/^["']|["']$/g, '');
                text = text.replace(new RegExp(`^${process.env.BOT_USERNAME || 'AfkBot1'}:?\\s*`, 'i'), '');
                text = text.replace(/^(ти|you|ben):?\s*/i, '');

                // Word cap
                const words = text.split(/\s+/);
                if (words.length > wordLimit) {
                    let cutText = words.slice(0, wordLimit).join(' ');
                    const lastPunct = Math.max(
                        cutText.lastIndexOf('.'),
                        cutText.lastIndexOf(','),
                        cutText.lastIndexOf('?'),
                        cutText.lastIndexOf('!')
                    );
                    if (lastPunct > cutText.length / 2) {
                        cutText = cutText.substring(0, lastPunct + 1);
                    }
                    text = cutText;
                }

                if (text.length > 250) {
                    text = text.substring(0, 247) + '...';
                }

                history.push(
                    { role: 'user', content: `${username}: ${userMessage}` },
                    { role: 'assistant', content: text }
                );
                while (history.length > MAX_HISTORY * 2) {
                    history.shift();
                }

                keyData.requestCount++;
                log(`✅ Key ${keyData.index + 1} | ${modelName}`);
                return text;
            } catch (modelErr) {
                const msg = modelErr.message || String(modelErr);
                if (msg.includes('429') || msg.includes('quota') || msg.includes('rate')) {
                    markKeyRateLimited(keyData, 60000);
                    break; // Switch to next key
                }
                if (msg.includes('404')) continue;
                continue;
            }
        }
    }
    
    log(`❌ Всички опции изчерпани`);
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
    if (API_KEYS.length === 0) return;

    const lowerMessage = message.toLowerCase().trim();
    if (!lowerMessage.startsWith(BOT_NAME)) return;

    let question = message.substring(BOT_NAME.length).trim();
    question = question.replace(/^[,:\-\s]+/, '');

    if (!question) {
        const greetings = ["кво", "да", "хм", "?", "кажи", "ква работа"];
        try { bot.chat(greetings[Math.floor(Math.random() * greetings.length)]); } catch(e){}
        return;
    }

    if (isOnCooldown(username)) {
        log(`⏳ ${username} cooldown`);
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
            log(`Chat err: ${e.message}`);
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
