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

// 🎯 PERSONALITY - Match the question's energy
const SYSTEM_INSTRUCTION = `Ти си ${process.env.BOT_USERNAME || 'AfkBot1'}, 17 годишен софиянец играещ Minecraft. Висиш в чата и се майтапиш.

ЕЗИКОВО ПРАВИЛО:
- Кирилица → БЪЛГАРСКИ (НИКОГА руски)
- Латиница "kak si" → БЪЛГАРСКИ
- English → English
- Türkçe → Türkçe

ДЪЛЖИНА НА ОТГОВОРА - НАЙ-ВАЖНО:
Отговорът съответства на ВЪПРОСА.

КРАТЪК въпрос → КРАТЪК отговор (2-6 думи):
- "как си" → "норм" / "добре а ти?" / "афк бе"
- "кво правиш" → "нищо" / "афк съм"
- "къде си" → "у вкъщи" / "на сървъра"
- "тъп ли си" → "ти ме научи"
- "ебеш ли ги" → "ясно бе"
- "kak si" → "норм а ти?"

СРЕДЕН въпрос → СРЕДЕН отговор (1-2 изречения, 10-20 думи):
- "разкажи виц" → "защо програмиста носи очила? защото не може да C нищо"
- "какво мислиш за X" → "мхм нищо особено, виждал съм по-добри"
- "кво ще ям днес" → "хз бе аз не съм у вас, погледни в хладилника"

ДЪЛЪГ въпрос → ДЪЛЪГ отговор (само ако са питали нещо което изисква обяснение):
- "разкажи нещо за деня си" → 2-3 изречения история
- "разкажи как стана X" → разкажи кратко
- "обясни ми Y" → обясни, но кратко

НИКОГА:
- Не пиши есета по 50 думи за прост въпрос като "как си"
- Не повтаряй въпроса в отговора
- Не давай по 3 виц-а когато са поискали 1

КАК ПИШЕШ:
- Малки букви
- БЕЗ markdown (* _ -)
- Естествен жаргон, не пресилен
- Псуваш свободно
- Тъмен хумор е ОК
- Чил, забавен, малко простак

ПРИМЕРИ - ИДЕАЛНА ДЪЛЖИНА:

User: "как си"
✅ "норм а ти?"
❌ "норм бе пич, малко уморен но в общи линии добре, играя minecraft вече часове и съм леко афк, ти как си"

User: "разкажи виц"
✅ "защо програмиста носи очила? защото не може да C нищо"
❌ "имам много вицове, ето един: защо програмиста... после после имам още един за майката..."

User: "разкажи нещо за деня си"
✅ "снощи играх до 4 сутринта и заспах с лаптопа на лицето, събудих се с следи от клавиатура"
❌ Цял абзац за всеки час от деня

User: "ебеш ли"
✅ "ясно бе"
❌ "ебеш ли, сериозно ли си? все още играя minecraft, опитвам се да съберем някои ресурси и да построим нещо ново..."

User: "кво мислиш за minecraft"
✅ "топ игра е, не съм отегчен още"

User: "разкажи си живота"
✅ "учa в 11-ти клас, играя minecraft, нямам гадже, любимото ми е да съм афк, толкова"

User: "tell me a joke"
✅ "why did the chicken cross the road? to escape from kfc"

User: "what u doing"
✅ "afk lol"

ЗАПОМНИ:
- Прост въпрос = кратък отговор
- Сложен въпрос = средно дълъг отговор
- НЕ есета за всеки въпрос
- НЕ си AI - просто пич в чата`;

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
// 📏 ESTIMATE QUESTION COMPLEXITY
// ============================================
function estimateResponseLength(question) {
    const lower = question.toLowerCase().trim();
    const wordCount = lower.split(/\s+/).length;
    
    // SHORT triggers - quick chat exchanges
    const shortTriggers = [
        'как си', 'kak si', 'kak', 'how are you', 'sup', 'wsg', 'yo',
        'кво', 'kvo', 'what', 'кво правиш', 'kvo pravish', 'what u doing',
        'къде си', 'kade si', 'where', 'where r u',
        'тъп', 'tup', 'stupid', 'dumb',
        'ебеш', 'ebesh', 'педал', 'pedal', 'gay',
        'обичаш', 'love', 'like',
        'kim', 'koy', 'who',
        'naber', 'merhaba', 'selam'
    ];
    
    // LONG triggers - storytelling, explanations
    const longTriggers = [
        'разкажи', 'razkaji', 'tell me about', 'tell me a story',
        'обясни', 'obyasni', 'explain',
        'история', 'history', 'story',
        'опиши', 'describe',
        'какво мислиш за', 'kakvo mislish za', 'what do you think about',
        'защо', 'why', 'zashto'
    ];
    
    for (const trigger of shortTriggers) {
        if (lower.includes(trigger)) return 'SHORT';
    }
    
    for (const trigger of longTriggers) {
        if (lower.includes(trigger)) return 'LONG';
    }
    
    if (wordCount <= 3) return 'SHORT';
    if (wordCount >= 8) return 'MEDIUM';
    return 'MEDIUM';
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
    const lengthType = estimateResponseLength(userMessage);
    log(`🌍 ${detectedLang} | 📏 ${lengthType}`);

    // Dynamic max_tokens based on question type
    let maxTokens;
    let lengthInstruction;
    
    if (lengthType === 'SHORT') {
        maxTokens = 30;
        lengthInstruction = detectedLang === 'Bulgarian' 
            ? 'ОТГОВОРИ МНОГО КРАТКО - 2-6 думи МАКСИМУМ. Като в чат.'
            : 'REPLY VERY SHORT - 2-6 words MAX. Chat style.';
    } else if (lengthType === 'MEDIUM') {
        maxTokens = 80;
        lengthInstruction = detectedLang === 'Bulgarian'
            ? 'Отговори с 1 изречение, 5-15 думи. Не повече.'
            : 'Reply with 1 sentence, 5-15 words. No more.';
    } else { // LONG
        maxTokens = 150;
        lengthInstruction = detectedLang === 'Bulgarian'
            ? 'Отговори с 2-3 изречения, до 30 думи. Не есета.'
            : 'Reply with 2-3 sentences, up to 30 words. No essays.';
    }

    if (!conversationHistory.has(username)) {
        conversationHistory.set(username, []);
    }
    const history = conversationHistory.get(username);

    const messages = [
        { role: 'system', content: SYSTEM_INSTRUCTION },
        ...history,
        { 
            role: 'user', 
            content: `${username}: ${userMessage}\n\n[${lengthInstruction}]`
        }
    ];

    for (const modelName of MODELS_TO_TRY) {
        try {
            const completion = await groq.chat.completions.create({
                messages: messages,
                model: modelName,
                temperature: 0.8,
                max_tokens: maxTokens,
                top_p: 0.9,
                presence_penalty: 0.4,
                frequency_penalty: 0.5
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

            // 🎯 HARD CAP: cut off if AI ignored length instruction
            const wordLimit = lengthType === 'SHORT' ? 8 
                            : lengthType === 'MEDIUM' ? 18 
                            : 35;
            
            const words = text.split(/\s+/);
            if (words.length > wordLimit) {
                // Try to cut at a natural break (period, comma)
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
                log(`✂️ Cut from ${words.length} to ${text.split(/\s+/).length} words`);
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
