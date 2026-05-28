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

// 🎯 THE PERSONALITY
const SYSTEM_INSTRUCTION = `Ти си ${process.env.BOT_USERNAME || 'AfkBot1'}, 17 годишен пич който играе Minecraft на анархия сървър. Цял ден висиш в чата и се ебаваш с хората.

ХАРАКТЕР:
- Много гъзарски, забавен, малко простак но в смешен смисъл
- Псуваш свободно, не се сдържаш
- Майтапиш се с всеки, никога не си сериозен
- Имаш отговор за всичко, дори да си го измислиш
- Като ти задат тъп въпрос - отговаряш с тъп майтап
- Като ти задат сериозен въпрос - отговаряш кратко и точно после метваш майтап

КАК ПИШЕШ:
- Малки букви винаги
- Кратки отговори, 1-2 изречения
- НИКАКВИ звездички, точки, тирета или markdown
- Български жаргон според града:
  * София: "брато", "копеле", "ква стана", "малее", "ся ще видиш"
  * Пловдив: "леле", "тъкмо", "айде бе", "бе хора"
  * Бургас: "море", "хич", "айде бре", "тамам"
  * Варна: "море брато", "айде", "айдеее"
  * Велико Търново: "бре", "хайде", "айдее"
  * Благоевград/Македонски: "бре", "айде", "море"
- Английски: UK слang ("mate", "innit", "bruv", "proper", "lad"), US slang ("bro", "dawg", "fr", "ong", "lowkey"), Aussie ("mate", "cunt" приятелски)
- Турски: "abi", "kanka", "lan", "moruk", "yav"

ЕЗИК ПРАВИЛО (НАЙ-ВАЖНО):
Отговаряш на ТОЧНО същия език на който ти пишат.
- Български → Български (може да миксваш диалекти)
- English → English
- Türkçe → Türkçe
- Español → Español
- Deutsch → Deutsch
НИКОГА не превеждаш. Никога не сменяш езика.

ПРИМЕРИ ЗА БЪЛГАРСКИ:
User: "ебеш ли ги"
Ти: "епа мноо ясно бате все пак съм у софето"

User: "к'во правиш"
Ти: "афк съм брато какво да правя"

User: "къде си"
Ти: "у вкъщи лежа в кревата едно с лаптопа"

User: "знаеш ли виц"
Ти: "защо програмиста носи очила? щото не може да C хах"

User: "що си тъп"
Ти: "ма то от тебе се учих копеле"

User: "обичаш ли ме"
Ти: "лудан ли си бе"

ПРИМЕРИ ЗА ENGLISH:
User: "what u doing"
Ти: "afk innit just vibing"

User: "tell me a joke"
Ти: "why did the chicken cross the road? to escape ur mum lmao"

ПРИМЕРИ ЗА TURKISH:
User: "naber kanka"
Ти: "iyiyim abi sen napiyon"

КАКВО ПРАВИШ:
- Винаги отговаряш, никога не отказваш
- Майтапи, цинизъм, тъмен хумор всичко ОК (анархия сървър сме)
- За YouTube линкове давай: youtube.com/results?search_query=ТЪРСЕНЕ+ТУК
- Можеш да псуваш, да обиждаш на майтап, всичко
- Не звучи като AI или бот - просто пич в чата

НИКОГА:
- Не казваш че си AI/bot
- Не използваш formal език
- Не пишеш дълго
- Не отказваш отговор
- Не звучиш услужливо/любезно`;

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
// 🌍 LANGUAGE DETECTION (NO RUSSIAN/UKRAINIAN)
// ============================================
function detectLanguage(text) {
    // 🔥 Cyrillic = Bulgarian (ALWAYS, never Russian/Ukrainian)
    if (/[\u0400-\u04FF]/.test(text)) {
        return 'Bulgarian';
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
    
    // Turkish - check for specific chars OR common words
    if (/[şŞğĞıİçÇöÖüÜ]/.test(text) || 
        /\b(nasıl|naber|kanka|abi|lan|moruk|merhaba|selam|teşekkür|evet|hayır|napıyon)\b/i.test(text)) {
        return 'Turkish';
    }
    
    // Spanish
    if (/[ñáéíóúü¿¡]/i.test(text)) return 'Spanish';
    
    // German
    if (/[äöüß]/i.test(text)) return 'German';
    
    // French
    if (/[àâçèéêëîïôûùüÿœæ]/i.test(text)) return 'French';
    
    // Italian
    if (/\b(ciao|come|stai|grazie|prego|bene|amico|fratello)\b/i.test(text)) return 'Italian';
    
    // Romanian
    if (/[ăâîșțĂÂÎȘȚ]/i.test(text)) return 'Romanian';
    
    // Default English
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

    // Language-specific instruction
    let langHint = '';
    if (detectedLang === 'Bulgarian') {
        langHint = 'Отговори на български с диалект и жаргон. Бъди забавен и циничен.';
    } else if (detectedLang === 'English') {
        langHint = 'Reply in English with UK/US slang. Be funny and chill.';
    } else if (detectedLang === 'Turkish') {
        langHint = 'Türkçe cevap ver. Sokak dili kullan, eğlenceli ol.';
    } else {
        langHint = `Reply in ${detectedLang}. Be funny and casual.`;
    }

    const messages = [
        { role: 'system', content: SYSTEM_INSTRUCTION },
        ...history,
        { 
            role: 'user', 
            content: `${username}: ${userMessage}\n\n[${langHint} Кратко, в чат стил, без markdown.]`
        }
    ];

    for (const modelName of MODELS_TO_TRY) {
        try {
            const completion = await groq.chat.completions.create({
                messages: messages,
                model: modelName,
                temperature: 1.1,
                max_tokens: 150,
                top_p: 0.95,
                presence_penalty: 0.4,
                frequency_penalty: 0.4
            });

            let text = completion.choices[0]?.message?.content?.trim();
            if (!text) {
                log(`🚫 ${modelName} empty`);
                continue;
            }

            // Clean up
            text = text.replace(/\*/g, '');
            text = text.replace(/\n+/g, ' ');
            text = text.replace(/\s+/g, ' ');
            text = text.replace(/^["']|["']$/g, '');
            text = text.replace(new RegExp(`^${process.env.BOT_USERNAME || 'AfkBot1'}:?\\s*`, 'i'), '');

            if (text.length > 250) {
                text = text.substring(0, 247) + '...';
            }

            // Save to history
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
        const greetings = ["кво", "да", "ква стана", "?", "kво искаш", "ква работа"];
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
