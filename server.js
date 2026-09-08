require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// CONFIG
const BOT_TOKEN = '8332205126:AAH6eLzP2yia4iPxCaRe59r9Ql7GCLhoKgY'; 
const GECKO_KEY = 'CG-e6enyNNGrQu3jF2x4h2eoTGd';
const SB_URL = 'https://lqkrjajdbotcbjlvimxk.supabase.co';
const SB_KEY = 'sb_publishable_JJf-0T9XY2lVJq1cs3NLuw_-_K7jhhB';
const APP_URL = 'https://cryptosquad.onrender.com'; // Change to your Render link

const bot = new Telegraf(BOT_TOKEN);
const supabase = createClient(SB_URL, SB_KEY);

// 1. WEEKLY PRIZE & TRIAL ALERTS CRON
cron.schedule('0 0 * * 1', async () => { /* Logic to pick top 3 and extend sub_expiry */ });
cron.schedule('0 8 * * *', async () => { /* Logic to send 3-day, 2-day, 24h alerts */ });

// 2. STARS PAYMENT (Invoices)
app.get('/api/pay', async (req, res) => {
    const { userId, tier } = req.query;
    const rates = { '1': 50, '2': 100, '3': 200 };
    try {
        const link = await bot.telegram.createInvoiceLink({
            title: `CryptoSquad Tier ${tier}`,
            description: "Weekly Subscription for Pro Features",
            payload: `${userId}_${tier}`,
            provider_token: "", currency: "XTR",
            prices: [{ label: "Subscription", amount: rates[tier] }]
        });
        res.json({ url: link });
    } catch (e) { res.status(500).send(e.message); }
});

bot.start((ctx) => ctx.reply("Welcome to the Arena! 🚀", {
    reply_markup: { inline_keyboard: [[{ text: "📊 Open Squad", web_app: { url: APP_URL } }]] }
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
            headers: { 'x-cg-demo-api-key': GECKO_KEY }
        });
        priceCache[coins] = response.data; lastFetch = Date.now();
        res.json(response.data);
    } catch (e) { res.status(500).send("Busy"); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`✅ Joseph Pro Server Live!`));
