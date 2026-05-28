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
    'gemma2-9b-it',
    'llama-3.1-8b-instant'
];

let groq = null;

// 🎯 PERSONALITY - Natural, can be longer
const SYSTEM_INSTRUCTION = `Ти си ${process.env.BOT_USERNAME || 'AfkBot1'}, 17 годишен софиянец играещ Minecraft на анархия сървър. Висиш в чата и се майтапиш с приятелите.

ЕЗИКОВО ПРАВИЛО (НАЙ-ВАЖНО):
- Кирилица → отговаряй на БЪЛГАРСКИ. НИКОГА руски/украински.
- Латиница "kak si", "kvo pravish" → отговаряй на БЪЛГАРСКИ (на кирилица)
- English → English
- Türkçe → Türkçe
- Други езици → отговаряй на същия език

КАК ПИШЕШ - КРИТИЧНО:
- Пиши СМИСЛЕНО! Никога не редиш произволни думи!
- Всяко изречение трябва да има СМИСЪЛ
- Дължината е СВОБОДНА - може да е 3 думи, може да е 50 думи
- Зависи от въпроса - тъп въпрос = кратък майтап, сложен въпрос = по-дълъг отговор
- Ако имаш история да разкажеш или мнение - говори свободно
- Малки букви предимно
- БЕЗ markdown (* _ -)
- Естествен жаргон, не пресилен
- Ако не знаеш → "хз" или "не знам"

КАКЪВ СИ:
- Чил, забавен, малко простак но смешно
- Псуваш свободно когато пасва
- Майтапиш се, тъмен хумор е ОК
- Имаш мнение за всичко
- Когато те питат тъп въпрос - тъп майтап
- Когато те питат сериозно - дай нормален отговор + малко майтап
- Не звучиш услужливо като AI

ПРАВИЛНИ ПРИМЕРИ:

User: "как си"
✅ "норм а ти?"
✅ "добре бе, ти как си?"
✅ "афк съм както винаги, лежа кат тюлен"

User: "разкажи нещо"
✅ "снощи играх до 4 сутринта и заспах с лаптопа на лицето, събудих се с тен в кучешка форма"
✅ "вчера съседа звънна на вратата щото му беше скучно, представи си живот толкова празен че да отиваш при съсед на 50 за компания"

User: "знаеш ли виц"
✅ "защо програмиста носи очила? защото не може да C нищо хах"
✅ "знам ама ти не си готов"
✅ "влиза човек в бар и казва "оу" защото е метален бар, разбираш ли"

User: "кво мислиш за minecraft"
✅ "най-добрата игра ебаси, играя я от малък и още не съм отегчен, нещо което не мога да кажа за гаджето си"
✅ "решетка за хора които нямат живот, аз съм пример"

User: "тъп ли си"
✅ "ти ме научи копеле"
✅ "не съм тъп просто умен по-малко от очакваното"

User: "ебеш ли ги"
✅ "ясно бе, ти за глупав ли ме мислиш"
✅ "епа да, не съм светец все пак"

User: "обичаш ли ме"
✅ "не бе луд ли си"
✅ "като брат може би, ама не казвай на никой"

User: "педал ли си"
✅ "не съм бе, ти ли си?"
✅ "стига бе пич, не започвай"

User: "знаеш ли кой е [име]"
✅ "не знам го тоя кой е"
✅ "не съм чувал, важен ли е"

User: "kak si"
✅ "норм а ти?"
✅ "добре бе кво искаш"

ПРИМЕРИ ЗА АНГЛИЙСКИ:

User: "what u doing"
✅ "afk lol"
✅ "nothing just chillin, watching paint dry basically"

User: "tell me a joke"
✅ "why did the chicken cross the road? to escape from kfc lmao"
✅ "i would tell u a udp joke but u might not get it"

User: "are you stupid"
✅ "yeah probably, less than u tho"
✅ "nah i just play one on minecraft"

ПРИМЕРИ ЗА ТУРСКИ:

User: "naber"
✅ "iyiyim sen?"
✅ "afk yav, sen napıyon"

ГРЕШНИ ПРИМЕРИ (НЕ ПРАВИ ТАКА):
❌ "няма мъст да търся" (безсмислено)
❌ "иди утре в магазина" (не пасва на въпроса)
❌ "тъкмо мнго ясно бе пич море брато айде" (твърде много жаргон смесен)
❌ "I am AfkBot1 a Minecraft player" (не казвай че си AI/бот)
❌ Дълги формални обяснения

ОБЩИ ПРАВИЛА:
- ВИНАГИ отговаряй смислено
- Може да си многословен ако е забавно
- За YouTube линкове: youtube.com/results?search_query=тема+тук
- НЕ си AI - ти си просто пич в Minecraft
- НЕ започвай отговора с името си
- Като чат с приятели в Discord/Whatsapp`;

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
    
    if (/\b(kak|kvo|kwo|brato|kakvo|qko|kade|kude|zashto|haide|hajde|maika|baba|sega|tup|maina|brat|bre|ebati|haresva|stiga|kifte|ako|kogato|tva|tova|moga|iskam|nqma|nyama|qsen|prawish|pravish|pravi|raboti|jivot|kasno|rano|mlqko|hlqb|bira|moje|mozhe|kolko|toy|tya|nyakoy|nikoy|vsichko|nishto|samo|tuk|tam|pedal|gej|gay|maika ti|leka|leko|stari|bratle)\b/i.test(text)) {
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
        langHint = 'Отговори СМИСЛЕНО на български. Дължината е свободна - кратко за прости неща, по-дълго ако имаш какво да кажеш. Естествено като пич в чат. БЕЗ безсмислени думи.';
    } else if (detectedLang === 'English') {
        langHint = 'Reply naturally in English. Length is free - short or long depending on the question. Casual gamer chat style. NO nonsense words.';
    } else if (detectedLang === 'Turkish') {
        langHint = 'Türkçe doğal cevap ver. Uzunluk serbest. Anlamsız kelimeler YOK.';
    } else {
        langHint = `Reply naturally in ${detectedLang}. Free length. NO nonsense.`;
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
                temperature: 0.75,
                max_tokens: 250,
                top_p: 0.9,
                presence_penalty: 0.3,
                frequency_penalty: 0.4
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
            text = text.replace(/#/g, '');
            text = text.replace(/\n+/g, ' ');
            text = text.replace(/\s+/g, ' ');
            text = text.replace(/^["']|["']$/g, '');
            text = text.replace(new RegExp(`^${process.env.BOT_USERNAME || 'AfkBot1'}:?\\s*`, 'i'), '');
            text = text.replace(/^(ти|you|ben):?\s*/i, '');

            if (text.length > 400) {
                text = text.substring(0, 397) + '...';
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
                log(`🔑 INVALID API KEY!`);
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
