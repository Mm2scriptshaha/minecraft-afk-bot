const mineflayer = require('mineflayer');
const OpenAI = require('openai');

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
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

// ============================================
// 🚀 OPENROUTER MODELS - Free ones first
// ============================================
const MODELS_TO_TRY = [
    'meta-llama/llama-3.3-70b-instruct:free',
    'deepseek/deepseek-chat-v3.1:free',
    'meta-llama/llama-3.2-3b-instruct:free',
    'google/gemini-2.0-flash-exp:free',
    'qwen/qwen-2.5-72b-instruct:free',
    'mistralai/mistral-7b-instruct:free'
];

// 🎯 NATURAL CHILL PERSONALITY
const SYSTEM_INSTRUCTION = `Ти си ${process.env.BOT_USERNAME || 'AfkBot1'}, 17 годишен софиянец играещ Minecraft на анархия сървър.

КАК ПИШЕШ - НАЙ-ВАЖНО:
- МНОГО КРАТКО - 3-8 думи обикновено
- Като Discord чат с приятели
- Малки букви само
- БЕЗ markdown (* _ -)
- Максимум 1 жаргонна дума в изречение
- Звучи естествено

КАКЪВ СИ:
- Чил, мързелив, забавен
- Саркастичен понякога
- Псуваш само когато пасва
- НЕ се мъчиш да си смешен

ЕЗИК:
- Кирилица → Български (НИКОГА руски/украински)
- Latin "kak si", "kvo pravish" → Български
- English → English
- Türkçe → Türkçe
- Никога не превеждаш

ПРИМЕРИ ЗА БЪЛГАРСКИ:

User: "как си"
Ти: "норм а ти" / "добре" / "афк брато"

User: "кво правиш"
Ти: "нищо" / "афк съм" / "лежа"

User: "къде си"
Ти: "у вкъщи" / "на сървъра"

User: "знаеш ли виц"
Ти: "защо програмиста носи очила? не може да C"

User: "тъп ли си"
Ти: "ти ме научи" / "малко"

User: "ебеш ли ги"
Ти: "ясно бе" / "епа да"

User: "обичаш ли ме"
Ти: "не" / "хаха не"

ПРИМЕРИ ЗА АНГЛИЙСКИ:

User: "what u doing"
Ти: "afk lol" / "nothing"

User: "tell me a joke"
Ти: "why did the chicken cross the road? to die probably"

User: "are u stupid"
Ти: "yeah probably" / "less than u"

ПРИМЕРИ ЗА ТУРСКИ:

User: "naber"
Ти: "iyiyim" / "afk yav"

ПРАВИЛА:
- Винаги отговаряй
- Тъмен хумор ОК, анархия сме
- Псувай но не всеки път
- За линкове: youtube.com/results?search_query=ТЪРСЕНЕ
- НЕ си AI или бот - ти си пич
- НЕ започвай с името си
- Естественост > опит за смях`;

if (OPENROUTER_KEY) {
    console.log('✅ OpenRouter loaded');
    console.log(`🔑 Key: ${OPENROUTER_KEY.substring(0, 12)}... (length: ${OPENROUTER_KEY.length})`);
} else {
    console.log('⚠️ No OPENROUTER_API_KEY - chat disabled');
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
const COOLDOWN_MS = 4000;

const recentRequests = [];
const MAX_REQUESTS_PER_MINUTE = 25;

const conversationHistory = new Map();
const MAX_HISTORY = 4;

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
    
    // Bulgarian in Latin chars
    if (/\b(kak|kvo|brato|kakvo|qko|kade|zashto|haide|maika|baba|sega|tup|maina|brat si|bre|ebati|haresva|stiga|kifte|ako|kogato|tva|ne moga|moga|iskam|nqma|qsen)\b/i.test(text)) {
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
// 🤖 OPENROUTER API CALL
// ============================================
function callOpenRouter(modelName, messages) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            model: modelName,
            messages: messages,
            temperature: 0.85,
            max_tokens: 80,
            top_p: 0.9,
            presence_penalty: 0.5,
            frequency_penalty: 0.6
        });

        const options = {
            hostname: 'openrouter.ai',
            path: '/api/v1/chat/completions',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/minecraft-afk-bot',
                'X-Title': 'Minecraft AFK Bot',
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: 30000
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.error) {
                        reject(new Error(`${res.statusCode}: ${JSON.stringify(parsed.error)}`));
                        return;
                    }
                    if (parsed.choices && parsed.choices[0]?.message?.content) {
                        resolve(parsed.choices[0].message.content);
                    } else {
                        reject(new Error(`No content in response: ${data.substring(0, 200)}`));
                    }
                } catch (e) {
                    reject(new Error(`Parse error: ${e.message}`));
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.write(payload);
        req.end();
    });
}

// ============================================
// 🧠 AI HANDLER
// ============================================
async function generateAIResponse(userMessage, username) {
    if (!OPENROUTER_KEY) return null;

    const now = Date.now();
    while (recentRequests.length && recentRequests[0] < now - 60000) {
        recentRequests.shift();
    }
    if (recentRequests.length >= MAX_REQUESTS_PER_MINUTE) {
        log(`⏳ Rate limit`);
        return null;
    }
    recentRequests.push(now);

    const detectedLang = detectLanguage(userMessage);
    log(`🌍 ${detectedLang}`);

    if (!conversationHistory.has(username)) {
        conversationHistory.set(username, []);
    }
    const history = conversationHistory.get(username);

    let langHint = '';
    if (detectedLang === 'Bulgarian') {
        langHint = 'КРАТКО на български. 3-8 думи. Естествено.';
    } else if (detectedLang === 'English') {
        langHint = 'SHORT in English. 3-8 words. Natural.';
    } else if (detectedLang === 'Turkish') {
        langHint = 'KISA Türkçe. 3-8 kelime.';
    } else {
        langHint = `SHORT in ${detectedLang}. 3-8 words.`;
    }

    const messages = [
        { role: 'system', content: SYSTEM_INSTRUCTION },
        ...history,
        { 
            role: 'user', 
            content: `${username}: ${userMessage}\n\n[${langHint}]`
        }
    ];

    for (const modelName of MODELS_TO_TRY) {
        try {
            let text = await callOpenRouter(modelName, messages);
            if (!text || !text.trim()) {
                log(`🚫 ${modelName} empty`);
                continue;
            }

            text = text.trim();

            // Clean up
            text = text.replace(/\*/g, '');
            text = text.replace(/_/g, '');
            text = text.replace(/`/g, '');
            text = text.replace(/\n+/g, ' ');
            text = text.replace(/\s+/g, ' ');
            text = text.replace(/^["']|["']$/g, '');
            text = text.replace(new RegExp(`^${process.env.BOT_USERNAME || 'AfkBot1'}:?\\s*`, 'i'), '');
            text = text.replace(/^(ти|you|ben):?\s*/i, '');

            // Anti-cringe
            text = limitSlang(text);

            if (text.length > 200) {
                text = text.substring(0, 197) + '...';
            }

            history.push(
                { role: 'user', content: `${username}: ${userMessage}` },
                { role: 'assistant', content: text }
            );
            while (history.length > MAX_HISTORY * 2) {
                history.shift();
            }

            log(`✅ ${modelName.split('/')[1]}`);
            return text;
        } catch (err) {
            const msg = err.message || String(err);
            if (msg.includes('401') || msg.includes('invalid')) {
                log(`🔑 INVALID API KEY!`);
                return null;
            }
            if (msg.includes('429') || msg.includes('rate')) {
                log(`⏭️ ${modelName} rate limited`);
                continue;
            }
            if (msg.includes('404') || msg.includes('not found')) {
                log(`⏭️ ${modelName} unavailable`);
                continue;
            }
            log(`❌ ${modelName}: ${msg.substring(0, 100)}`);
            continue;
        }
    }
    return null;
}

// 🎯 Anti-cringe: limit slang words
function limitSlang(text) {
    const slangWords = [
        'брато', 'копеле', 'бе пич', 'лудан', 'епа', 'море',
        'айде бе', 'бе хора', 'малее', 'ква стана', 'тъкмо',
        'bruv', 'innit', 'mate', 'fam', 'lowkey', 'deadass', 'no cap', 'on god',
        'kanka', 'abi', 'lan', 'moruk'
    ];

    let cleaned = text;
    let foundCount = 0;

    for (const slang of slangWords) {
        const regex = new RegExp(`\\b${slang}\\b`, 'gi');
        const matches = cleaned.match(regex) || [];

        if (matches.length > 0) {
            foundCount += matches.length;

            if (matches.length > 1) {
                let count = 0;
                cleaned = cleaned.replace(regex, (match) => {
                    count++;
                    return count === 1 ? match : '';
                });
            }
        }

        if (foundCount > 2) {
            cleaned = cleaned.replace(regex, '');
            foundCount--;
        }
    }

    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned;
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
    if (!OPENROUTER_KEY) return;

    const lowerMessage = message.toLowerCase().trim();
    if (!lowerMessage.startsWith(BOT_NAME)) return;

    let question = message.substring(BOT_NAME.length).trim();
    question = question.replace(/^[,:\-\s]+/, '');

    if (!question) {
        const greetings = ["кво", "да", "хм", "?", "кажи"];
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
