// server.js - CryptoSquad Pro backend
// Environment variables required:
// SUPABASE_URL, SUPABASE_KEY, TELEGRAM_BOT_TOKEN, PAYMENT_PROVIDER_TOKEN (Telegram provider token), PORT

const express = require('express');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const NodeCache = require('node-cache');
const { Telegraf } = require('telegraf');
const cron = require('node-cron');

const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PAYMENT_PROVIDER_TOKEN = process.env.PAYMENT_PROVIDER_TOKEN || null;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing Supabase environment variables.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = BOT_TOKEN ? new Telegraf(BOT_TOKEN) : null;

// Node-cache for CoinGecko with 5-minute TTL
const cgCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

function parseDate(d) { return d ? new Date(d) : null; }

// 1) Profile check - returns locked state based on sub_expiry
app.get('/api/profile', async (req, res) => {
  const user_id = req.query.user_id;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const { data, error } = await supabase.from('profiles').select('*').eq('id', user_id).single();
  if (error) return res.status(500).json({ error: error.message });

  const now = new Date();
  const subExpiry = parseDate(data.sub_expiry);
  const locked = !subExpiry || now > subExpiry;

  return res.json({ profile: data, locked });
});

// 2) Device fingerprint check & register - prevents multiple trials for same device
app.post('/api/check_fingerprint', async (req, res) => {
  const { user_id, device_fingerprint } = req.body;
  if (!user_id || !device_fingerprint) return res.status(400).json({ error: 'user_id and device_fingerprint required' });

  try {
    // If any other profile has this fingerprint and already used trial, block
    const { data: matches, error: matchErr } = await supabase
      .from('profiles')
      .select('id,trial_used')
      .neq('id', user_id)
      .eq('device_fingerprint', device_fingerprint)
      .limit(1);
    if (matchErr) return res.status(500).json({ error: matchErr.message });

    if (matches && matches.length > 0 && matches[0].trial_used) {
      return res.json({ allowed: false, reason: 'Device fingerprint already used for trial' });
    }

    // Associate fingerprint with current user (upsert)
    const { data, error } = await supabase
      .from('profiles')
      .update({ device_fingerprint })
      .eq('id', user_id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ allowed: true, profile: data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 3) CoinGecko caching proxy - 5 minute caching
app.get('/api/coins', async (req, res) => {
  const cacheKey = 'coingecko_markets_v1';
  const cached = cgCache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const resp = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
      params: { vs_currency: 'usd', order: 'market_cap_desc', per_page: 50, page: 1, sparkline: false }
    });
    cgCache.set(cacheKey, resp.data);
    return res.json(resp.data);
  } catch (err) {
    console.error('CoinGecko error', err.message);
    return res.status(502).json({ error: 'CoinGecko fetch failed' });
  }
});

// 4) Payment invoice generation via Telegram bot (server triggers bot to send invoice)
// body: { user_id, telegram_chat_id, tier } where tier is 'bronze'|'silver'|'gold'
app.post('/api/pay', async (req, res) => {
  const { user_id, telegram_chat_id, tier } = req.body;
  if (!user_id || !telegram_chat_id || !tier) return res.status(400).json({ error: 'user_id, telegram_chat_id, and tier required' });
  if (!bot) return res.status(500).json({ error: 'Telegram bot not configured' });

  const prices = {
    bronze: { amount: 500, label: 'Bronze - 50 Stars/wk' },
    silver: { amount: 1000, label: 'Silver - 100 Stars/wk' },
    gold: { amount: 2000, label: 'Gold VIP - 200 Stars/wk' }
  };
  const price = prices[tier];
  if (!price) return res.status(400).json({ error: 'unknown tier' });

  try {
    if (PAYMENT_PROVIDER_TOKEN) {
      await bot.telegram.sendInvoice(
        telegram_chat_id,
        `CryptoSquad ${price.label}`,
        `Subscription purchase: ${price.label}`,
        `cs_invoice_${Date.now()}`,
        PAYMENT_PROVIDER_TOKEN,
        'payload',
        'USD',
        [{ label: price.label, amount: price.amount }]
      );
      return res.json({ success: true, message: 'Invoice sent via bot' });
    } else {
      // No provider configured: return a fake payment payload for client to handle
      return res.json({ success: true, message: 'payment_provider_not_configured', fake: true });
    }
  } catch (err) {
    console.error('Invoice error', err.message);
    return res.status(500).json({ error: 'Failed to send invoice' });
  }
});

// 5) Squads / coins endpoints
app.get('/api/squads', async (req, res) => {
  const user_id = req.query.user_id;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  try {
    const { data: created } = await supabase.from('squads').select('*, members: squad_members(*)').eq('owner_id', user_id);
    const { data: memberRows } = await supabase.from('squad_members').select('squad_id').eq('member_id', user_id);
    let joined = [];
    if (memberRows && memberRows.length) {
      const ids = memberRows.map(m => m.squad_id);
      const { data: joinedData } = await supabase.from('squads').select('*').in('id', ids);
      joined = joinedData || [];
    }
    return res.json({ created: created || [], joined });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.delete('/api/coins/:coin_id', async (req, res) => {
  const coin_id = req.params.coin_id;
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  try {
    const { data: coin, error } = await supabase.from('coins').select('*').eq('id', coin_id).single();
    if (error || !coin) return res.status(404).json({ error: 'coin not found' });
    if (coin.owner_id !== user_id) return res.status(403).json({ error: 'forbidden' });
    const { error: delErr } = await supabase.from('coins').delete().eq('id', coin_id);
    if (delErr) return res.status(500).json({ error: delErr.message });
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.post('/api/squads/:squad_id/exit', async (req, res) => {
  const squad_id = req.params.squad_id;
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  try {
    const { error } = await supabase.from('squad_members').delete().match({ squad_id, member_id: user_id });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// 6) Weekly prize automation - run once weekly (cron) to pick top 3 by stars_week
async function runWeeklyPrizeAutomation() {
  try {
    const { data: winners, error } = await supabase.from('profiles').select('*').order('stars_week', { ascending: false }).limit(3);
    if (error) { console.error('Prize automation error', error); return; }

    for (let i = 0; i < (winners || []).length; i++) {
      const w = winners[i];
      const extendDays = 7;
      const current = w.sub_expiry ? new Date(w.sub_expiry) : new Date();
      const newExpiry = new Date(Math.max(current.getTime(), Date.now()));
      newExpiry.setDate(newExpiry.getDate() + extendDays);

      // set winner's tier for next week (keep existing tier or set bronze)
      const newTier = (w.sub_tier) ? w.sub_tier : 'bronze';
      await supabase.from('profiles').update({ sub_expiry: newExpiry.toISOString(), sub_tier: newTier }).eq('id', w.id);

      if (bot && w.telegram_chat_id) {
        try { await bot.telegram.sendMessage(w.telegram_chat_id, `🏆 You placed #${i+1} this week and received a ${extendDays}-day subscription extension!`); } catch (e) { console.error('notify winner', e.message); }
      }
    }
  } catch (err) { console.error('Prize automation unexpected', err.message); }
}

// Cron: send trial alerts daily at 08:00 UTC for users expiring in 3d,2d,1d
cron.schedule('0 8 * * *', async () => {
  console.log('Running trial alerts job...');
  const now = new Date();
  const targets = [3,2,1];
  for (const days of targets) {
    const start = new Date(now);
    start.setDate(start.getDate() + days);
    start.setHours(0,0,0,0);
    const end = new Date(start);
    end.setHours(23,59,59,999);

    const { data, error } = await supabase.from('profiles').select('*').gte('sub_expiry', start.toISOString()).lte('sub_expiry', end.toISOString());
    if (error) { console.error('trial alert query error', error); continue; }
    for (const p of data || []) {
      if (!bot || !p.telegram_chat_id) continue;
      const msg = `Reminder: Your CryptoSquad subscription expires in ${days} day(s) on ${new Date(p.sub_expiry).toLocaleString()}. Renew to keep access.`;
      try { await bot.telegram.sendMessage(p.telegram_chat_id, msg); } catch (e) { console.error('send alert', e.message); }
    }
  }
});

// Weekly prize: every Monday 00:05 UTC
cron.schedule('5 0 * * 1', async () => { console.log('Running weekly prize cron'); await runWeeklyPrizeAutomation(); });

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
