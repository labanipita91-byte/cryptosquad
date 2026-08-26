
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// === CONFIGURATION ===
// If you don't use Render Env Vars, paste keys between the quotes below
const BOT_TOKEN = process.env.BOT_TOKEN || '8332205126:AAH6eLzP2yia4iPxCaRe59r9Ql7GCLhoKgY'; 
const GECKO_API_KEY = process.env.GECKO_API_KEY || 'CG-e6enyNNGrQu3jF2x4h2eoTGd'; 
const SB_URL = process.env.SUPABASE_URL || 'https://lqkrjajdbotcbjlvimxk.supabase.co';
const SB_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_JJf-0T9XY2lVJq1cs3NLuw_-_K7jhhB';
const APP_URL = process.env.APP_URL || 'https://your-app.onrender.com';

const bot = new Telegraf(BOT_TOKEN);
const supabase = createClient(SB_URL, SB_KEY);

// 1. TRIAL ALERTS (14 Day logic)
cron.schedule('0 */12 * * *', async () => {
    const { data: users } = await supabase.from('profiles').select('*').eq('is_pro', false);
    if (!users) return;
    users.forEach(user => {
        const diff = (Date.now() - new Date(user.trial_started_at).getTime()) / (1000 * 60 * 60 * 24);
        const daysUsed = Math.floor(diff);
        let msg = "";
        if (daysUsed === 11) msg = "⚠️ Joseph here! 3 days left on your free trial.";
        if (daysUsed === 12) msg = "⚠️ 2 days left! Keep your squad leaderboard spot alive.";
        if (daysUsed === 13) msg = "🚨 FINAL 24 HOURS! Upgrade to stay Pro.";
        if (msg && user.chat_id) bot.telegram.sendMessage(user.chat_id, msg).catch(() => {});
    });
});

// 2. STARS PAYMENT (299 Stars)
app.get('/api/pay-pro', async (req, res) => {
    try {
        const link = await bot.telegram.createInvoiceLink({
            title: "Pro Upgrade", description: "Unlimited Squads & Winner Badge", payload: req.query.userId,
            provider_token: "", currency: "XTR", prices: [{ label: "Pro", amount: 299 }]
        });
        res.json({ url: link });
    } catch (e) { res.status(500).send(e.message); }
});

bot.start((ctx) => ctx.reply(`Welcome to CryptoSquad! 🚀`, {
    reply_markup: { inline_keyboard: [[{ text: "📊 Open Squad Dashboard", web_app: { url: APP_URL } }]] }
}));
bot.launch();

app.use(express.json());
app.use(express.static('public'));

// 3. PRICE CACHE
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
    } catch (e) { res.status(500).send("API Busy"); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Joseph's Pro Server Live!`));
