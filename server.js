const express = require('express');
const axios = require('axios');
const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// === CONFIG (PASTE YOUR KEYS) ===
const bot = new Telegraf('8332205126:AAH6eLzP2yia4iPxCaRe59r9Ql7GCLhoKgY');
const supabase = createClient('https://lqkrjajdbotcbjlvimxk.supabase.co', 'sb_publishable_JJf-0T9XY2lVJq1cs3NLuw_-_K7jhhB');
const GECKO_API_KEY = 'CG-e6enyNNGrQu3jF2x4h2eoTGd';
const APP_URL = 'https://cryptosquad-pro.onrender.com'; 

// 1. TRIAL ALERTS (14 Days)
cron.schedule('0 */12 * * *', async () => {
    const { data: users } = await supabase.from('profiles').select('*').eq('is_pro', false);
    if (!users) return;
    users.forEach(user => {
        const diff = (Date.now() - new Date(user.trial_started_at).getTime()) / (1000 * 60 * 60 * 24);
        const daysUsed = Math.floor(diff);
        let msg = "";
        if (daysUsed === 11) msg = "⚠️ 3 days left on trial!";
        if (daysUsed === 13) msg = "🚨 24 HOURS LEFT! Upgrade to stay Pro.";
        if (msg && user.chat_id) bot.telegram.sendMessage(user.chat_id, msg).catch(() => {});
    });
});

// 2. STARS PAYMENT
app.get('/api/pay-pro', async (req, res) => {
    try {
        const link = await bot.telegram.createInvoiceLink({
            title: "Pro Upgrade", description: "Unlimited Squads", payload: req.query.userId,
            provider_token: "", currency: "XTR", prices: [{ label: "Pro", amount: 299 }]
        });
        res.json({ url: link });
    } catch (e) { res.status(500).send(e.message); }
});

bot.start((ctx) => ctx.reply(`🚀 Welcome!`, {
    reply_markup: { inline_keyboard: [[{ text: "📊 Open App", web_app: { url: APP_URL } }]] }
}));
bot.launch();

app.use(express.json());
app.use(express.static('public'));

let priceCache = {}; let lastFetch = 0;
app.get('/api/prices', async (req, res) => {
    const { coins } = req.query;
    if (Date.now() - lastFetch < 300000 && priceCache[coins]) return res.json(priceCache[coins]);
    try {
        const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price`, {
            params: { ids: coins, vs_currencies: 'usd', include_24hr_change: 'true' },
            headers: { 'x-cg-demo-api-key': GECKO_API_KEY }
        });
        priceCache[coins] = response.data; lastFetch = Date.now();
        res.json(response.data);
    } catch (e) { res.status(500).send("Busy"); }
});

app.get('*', (req, res) => res.sendFile(__dirname + '/public/index.html'));
app.listen(PORT, '0.0.0.0');
