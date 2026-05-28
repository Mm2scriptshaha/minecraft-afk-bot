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
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'gemma2-9b-it'
];

let groq = null;

// 🎯 NATURAL CHILL PERSONALITY
const SYSTEM_INSTRUCTION = `Ти си ${process.env.BOT_USERNAME || 'AfkBot1'}, 17 годишен софиянец играещ Minecraft на анархия сървър.

КАК ПИШЕШ - НАЙ-ВАЖНО:
- МНОГО КРАТКО - 3-8 думи обикновено
- Като Discord чат с приятели
- Малки букви само
- БЕЗ markdown (* _ -)
- Максимум 1 жаргонна дума в изречение
- Звучи естествено, не пресилено

КАКЪВ СИ:
- Чил, мързелив, забавен
- Саркастичен понякога
- Псуваш само когато реално пасва
- НЕ се мъчиш да си смешен
- Имаш отговор за всичко

ЕЗИК - КРИТИЧНО:
- Кирилица → Български (НИКОГА руски/украински)
- Latin "kak si", "kvo pravish" → Български
- English → English
- Türkçe → Türkçe
- Никога не превеждаш

ПРИМЕРИ ЗА БЪЛГАРСКИ (учи се от тях):

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

User: "kak si"
Ти: "норм" / "добре а ти"

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

if (GROQ_KEY) {
    try {
        groq = new Groq({ apiKey: GROQ_KEY });
        console.log('✅ Groq AI loaded');
        console.log(`🔑 Key: ${GROQ_KEY.substring(0, 7)}... (length: ${GROQ_KEY.length})`);
    } catch (err) {
        console.log(`⚠️ Groq failed: ${err.message}`);
    }
} else {
    console.log('⚠️ No GROQ_API_KEY - chat disabled');
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
    
    // Bulgarian in Latin chars (expanded list)
    if (/\b(kak|kvo|kwo|brato|kakvo|qko|kade|kude|zashto|haide|hajde|maika|baba|sega|tup|maina|brat|bre|ebati|haresva|stiga|kifte|ako|kogato|tva|tova|moga|iskam|nqma|nyama|qsen|prawish|pravish|pravi|raboti|jivot|kasno|rano|mlqko|hlqb|bira|sega|moje|mozhe|kolko|toy|tya|nyakoy|nikoy|vsichko|nishto|samo|tuk|tam|tая|тоя)\b/i.test(text)) {
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
// 🤖 AI HANDLER
// ============================================
async function generateAIResponse(userMessage, username) {
    if (!groq) return null;

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
            const completion = await groq.chat.completions.create({
                messages: messages,
                model: modelName,
                temperature: 0.85,
                max_tokens: 80,
                top_p: 0.9,
                presence_penalty: 0.5,
                frequency_penalty: 0.6
            });

            let text = completion.choices[0]?.message?.content?.trim();
            if (!text) {
                log(`🚫 ${modelName} empty`);
                continue;
            }

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

            log(`✅ ${modelName}`);
            return text;
        } catch (err) {
            const msg = err.message || String(err);
            if (msg.includes('401') || msg.includes('invalid_api_key')) {
                log(`🔑 INVALID API KEY! Check GROQ_API_KEY secret.`);
                return null;
            }
            if (msg.includes('429') || msg.includes('rate_limit')) {
                log(`⏭️ ${modelName} rate limited`);
                continue;
            }
            if (msg.includes('404') || msg.includes('decommissioned')) {
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
    if (!groq) return;

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
