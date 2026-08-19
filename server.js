const express = require('express');
const axios = require('axios');
const { Telegraf } = require('telegraf');
const path = require('path');
const app = express();
const PORT = 3000;

const BOT_TOKEN = '8332205126:AAH6eLzP2yia4iPxCaRe59r9Ql7GCLhoKgY'; 
const GECKO_API_KEY = 'CG-e6enyNNGrQu3jF2x4h2eoTGd'; 
const APP_URL = 'https://joseph-final-squad.loca.lt'; 

const bot = new Telegraf(BOT_TOKEN);
bot.start((ctx) => ctx.reply(`Welcome! 🚀`, {
    reply_markup: { inline_keyboard: [[{ text: "🚀 Open App", web_app: { url: APP_URL } }]] }
}));
bot.launch();

app.use(express.json());
app.use(express.static('public'));

let priceCache = {};
let lastFetch = 0;
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

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`✅ Server Live`));