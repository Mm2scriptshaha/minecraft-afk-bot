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
// GROQ SETUP
// ============================================
const MODELS_TO_TRY = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'gemma2-9b-it'
];

let groq = null;

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
- Ако някой пише на латиница български думи (kak si, brato), отговаряй на български

ПРИМЕРИ:

User: "ебеш ли ги"
Ти: "епа мноо ясно бате все пак съм у софето"

User: "кво правиш"  
Ти: "афк съм бе кво да правя зяпам тавана"

User: "kak si" или "как си"
Ти: "норм брато ти кво правиш"

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
// LANGUAGE DETECTION
// ============================================
function detectLanguage(text) {
    if (/[\u0400-\u04FF]/.test(text)) return 'Bulgarian';
    if (/[\u0370-\u03FF]/.test(text)) return 'Greek';
    if (/[\u0600-\u06FF]/.test(text)) return 'Arabic';
    if (/[\u4E00-\u9FFF]/.test(text)) return 'Chinese';
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'Japanese';
    if (/[\uAC00-\uD7AF]/.test(text)) return 'Korean';
    
    // Bulgarian written in Latin (kak si, brato, kvo pravish)
    if (/\b(kak|kvo|brato|kak si|kakvo|qko|kade|zashto|haide|mai|maika|baba|leka|leko|maika|brat|sega|tup|kif|haresva|maina|stiga)\b/i.test(text)) {
        return 'Bulgarian';
    }
    
    if (/[şŞğĞıİçÇöÖüÜ]/.test(text) || 
        /\b(nasıl|naber|kanka|abi|lan|moruk|merhaba|selam|napıyon|nasilsin)\b/i.test(text)) {
        return 'Turkish';
    }
    
    if (/[ñáéíóúü¿¡]/i.test(text)) return 'Spanish';
    if (/[äöüß]/i.test(text)) return 'German';
    if (/[àâçèéêëîïôûùüÿœæ]/i.test(text)) return 'French';
    if (/[ăâîșțĂÂÎȘȚ]/i.test(text)) return 'Romanian';
    
    return 'English';
}

// ============================================
// AI HANDLER
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
        langHint = 'Отговори на БЪЛГАРСКИ с диалект и жаргон. Бъди забавен. БЕЗ markdown.';
    } else if (detectedLang === 'English') {
        langHint = 'Reply in English with UK/US slang. Be funny. NO markdown.';
    } else if (detectedLang === 'Turkish') {
        langHint = 'Türkçe cevap ver. Sokak dili kullan. Markdown YOK.';
    } else {
        langHint = `Reply in ${detectedLang}. Be funny. NO markdown.`;
    }

    const messages = [
        { role: 'system', content: SYSTEM_INSTRUCTION },
        ...history,
        { 
            role: 'user', 
            content: `${username}: ${userMessage}\n\n[${langHint} Кратко.]`
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
            text = text.replace(/_/g, '');
            text = text.replace(/`/g, '');
            text = text.replace(/\n+/g, ' ');
            text = text.replace(/\s+/g, ' ');
            text = text.replace(/^["']|["']$/g, '');
            text = text.replace(new RegExp(`^${process.env.BOT_USERNAME || 'AfkBot1'}:?\\s*`, 'i'), '');
            text = text.replace(/^(ти|you):?\s*/i, '');

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
        const greetings = ["кво", "да", "ква стана", "ква работа", "?", "хм"];
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
