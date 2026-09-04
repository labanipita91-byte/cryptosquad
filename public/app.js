// name=public/app.js
// Frontend for CryptoSquad Pro
// - Calls /api/profile to hard-gate UI
// - Generates/stores device fingerprint and POSTs to /api/check_fingerprint
// - Connects Delete coin (DELETE /api/coins/:id), Exit squad (POST /api/squads/:id/exit), Copy code
// - Uses Supabase client for DB operations (public key) just like prior code
// - Uses /api/coins (CoinGecko proxy) for prices (cached server-side)

const SB_URL = "https://lqkrjajdbotcbjlvimxk.supabase.co"; // keep as before or replace
const SB_KEY = "sb_publishable_JJf-0T9XY2lVJq1cs3NLuw_-_K7jhhB"; // keep as before or replace
const supabaseClient = supabase.createClient(SB_URL, SB_KEY);
const tg = window.Telegram?.WebApp;

// Lightweight stable client id (used as 'user_id' here for demo apps).
let MY_ID = localStorage.getItem('device_id') || 'u_' + Math.random().toString(36).substring(7);
let MY_NAME = tg?.initDataUnsafe?.user?.first_name || "Guest";
localStorage.setItem('device_id', MY_ID);

let DEVICE_FP = localStorage.getItem('device_fingerprint') || null;

// UI helpers
function showPayWall(show, msg) {
  const el = document.getElementById('pay-wall');
  el.style.display = show ? 'flex' : 'none';
  if (msg) document.getElementById('pay-msg').innerText = msg;
}
function showView(id) {
  document.querySelectorAll('section').forEach(s => s.style.display = 'none');
  document.getElementById(id).style.display = 'block';
  if (id === 'view-dashboard') renderPortfolio();
  if (id === 'view-groups') renderSquadLists();
}

// Fingerprint generation using simple fingerprint (UA + screen + timezone + language) hashed with SHA-256
async function generateFingerprint() {
  try {
    const parts = [
      navigator.userAgent || '',
      screen.width + 'x' + screen.height,
      Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      navigator.language || ''
    ].join('||');
    const enc = new TextEncoder().encode(parts);
    const hashBuffer = await crypto.subtle.digest('SHA-256', enc);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('device_fingerprint', hashHex);
    DEVICE_FP = hashHex;
    return hashHex;
  } catch (e) {
    // fallback: stable random stored value
    let fallback = localStorage.getItem('device_fallback') || ('fp_' + Math.random().toString(36).slice(2));
    localStorage.setItem('device_fallback', fallback);
    DEVICE_FP = fallback;
    return fallback;
  }
}

// POST fingerprint to server to register/check trial usage
async function checkAndRegisterFingerprint() {
  if (!DEVICE_FP) await generateFingerprint();
  try {
    const resp = await fetch('/api/check_fingerprint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: MY_ID, device_fingerprint: DEVICE_FP })
    });
    const j = await resp.json();
    if (!j.allowed) {
      // If a device fingerprint conflict, hard-gate
      showPayWall(true, j.reason || 'Device restricted from trial');
      return false;
    }
    return true;
  } catch (e) {
    // best-effort: allow but warn
    console.warn('Fingerprint check failed, proceeding', e);
    return true;
  }
}

// Hard-gate: fetch profile and lock if sub_expiry passed
async function checkProfileLock() {
  try {
    const resp = await fetch(`/api/profile?user_id=${encodeURIComponent(MY_ID)}`);
    if (!resp.ok) {
      console.warn('profile fetch failed', resp.statusText);
      return false;
    }
    const j = await resp.json();
    const profile = j.profile || {};
    const locked = j.locked === true;
    // Show badge and user
    document.getElementById('user-display').innerText = profile.user_name || MY_NAME;
    document.getElementById('trial-badge').innerText = profile.sub_tier ? profile.sub_tier.toUpperCase() : (profile.trial_used ? 'TRIAL' : 'FREE');

    if (locked) {
      // show paywall and populate tier buttons
      showPayWall(true, 'Your subscription has expired. Choose a tier to continue using CryptoSquad Pro.');
      return true;
    }
    // not locked -> hide paywall
    showPayWall(false);
    return false;
  } catch (err) {
    console.error('checkProfileLock error', err);
    return false;
  }
}

// BUY flow: call /api/pay to generate/send invoice
async function buyTier(tier) {
  // attempt to get telegram chat id (if running inside Telegram WebApp)
  const tgChatId = tg?.initDataUnsafe?.user?.id || null;
  try {
    const resp = await fetch('/api/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: MY_ID, telegram_chat_id: tgChatId, tier })
    });
    const j = await resp.json();
    if (j.success && j.fake) {
      alert('Payment provider not configured on server. This is a demo response. Implement payment finalization server-side.');
    }
    if (j.success && j.message) {
      alert(j.message);
    }
  } catch (e) {
    alert('Failed to start payment: ' + e.message);
  }
}

// Wire paywall buttons (delegated)
document.addEventListener('click', (ev) => {
  const buy = ev.target.closest('.tier-buy');
  if (buy) {
    const tier = buy.dataset.tier;
    buyTier(tier);
  }
  const payClose = ev.target.closest('.pay-close');
  if (payClose) {
    showPayWall(false);
  }
});

// ------------------- Portfolio / Assets -------------------
async function renderPortfolio() {
  // Ensure not locked before rendering - if locked, we already display paywall, so skip rendering
  const profileResp = await fetch(`/api/profile?user_id=${encodeURIComponent(MY_ID)}`);
  if (profileResp.ok) {
    const pj = await profileResp.json();
    if (pj.locked) {
      showPayWall(true, 'Subscription required to use the app.');
      return;
    }
  }

  const { data: assets } = await supabaseClient.from('assets').select('*').eq('user_id', MY_ID);
  const list = document.getElementById('asset-list');
  if (!assets || assets.length === 0) {
    list.innerHTML = `<p style="color:var(--hint);text-align:center">No assets yet.</p>`;
    document.getElementById('total-val').innerText = "$0.00";
    return;
  }

  // Fetch CoinGecko markets (server caches 5-min)
  let coins = [];
  try {
    const resp = await fetch('/api/coins');
    if (resp.ok) coins = await resp.json();
  } catch (e) { console.warn('coin fetch failed', e); }

  const byId = {};
  (coins || []).forEach(c => { byId[c.id] = c; byId[c.symbol] = c; });

  let total = 0, weightedChange = 0;
  const itemsHTML = assets.map(a => {
    const coinKey = a.coin_id.toLowerCase();
    const coin = byId[coinKey] || {};
    const price = coin.current_price || 0;
    const pct = coin.price_change_percentage_24h || 0;
    const value = (a.amount || 0) * price;
    total += value;
    weightedChange += pct * value;
    const arrow = pct >= 0 ? '↑' : '↓';
    const cls = pct >= 0 ? 'up' : 'down';
    return `
      <div class="asset-item">
        <div>
          <strong>${(a.coin_id || '').toUpperCase()}</strong><br><small>${a.amount || 0}</small>
        </div>
        <div style="display:flex; align-items:center;">
          <div style="text-align:right; margin-right:10px">
            <strong>$${value.toLocaleString(undefined, {maximumFractionDigits:2})}</strong><br>
            <small class="${cls}">${arrow} ${Math.abs(pct).toFixed(2)}%</small>
          </div>
          <button onclick="deleteCoin('${a.id}')" class="btn-del-circle" title="Delete coin">×</button>
        </div>
      </div>
    `;
  }).join('');
  list.innerHTML = itemsHTML;
  document.getElementById('total-val').innerText = "$" + total.toLocaleString(undefined, {maximumFractionDigits:2});
  const avgChange = total ? (weightedChange / total) : 0;
  document.getElementById('total-change').innerText = (avgChange >= 0 ? '+' : '') + avgChange.toFixed(2) + '%';
  document.getElementById('total-change').className = avgChange >= 0 ? 'up' : 'down';
}

// Delete coin (requires confirmation)
async function deleteCoin(id) {
  if (!confirm('Permanently delete this coin from your portfolio?')) return;
  try {
    const resp = await fetch(`/api/coins/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: MY_ID })
    });
    if (!resp.ok) {
      const j = await resp.json();
      alert('Failed: ' + (j.error || resp.statusText));
      return;
    }
    await renderPortfolio();
  } catch (e) {
    alert('Delete failed: ' + e.message);
  }
}

// Add asset
async function addAsset() {
  const coin = document.getElementById('coin-id').value.trim().toLowerCase();
  const amount = parseFloat(document.getElementById('coin-amount').value);
  if (!coin || !amount || amount <= 0) return alert('Enter coin and amount');
  const { error } = await supabaseClient.from('assets').insert([{ user_id: MY_ID, coin_id: coin, amount }]);
  if (error) return alert('Save failed: ' + error.message);
  document.getElementById('coin-id').value = '';
  document.getElementById('coin-amount').value = '';
  showView('view-dashboard');
  renderPortfolio();
}

// ------------------- Squads -------------------
let CURRENT_SQUAD = null;
async function renderSquadLists() {
  try {
    const resp = await fetch(`/api/squads?user_id=${encodeURIComponent(MY_ID)}`);
    const j = await resp.json();
    const created = j.created || [];
    const joined = j.joined || [];

    document.getElementById('created-list').innerHTML = created.length ? created.map(s => {
      return `
        <div class="squad-link">
          <span onclick="openSquad('${s.id}', ${JSON.stringify(s)})">${escapeHtml(s.name)} ➔</span>
          <button onclick="deleteSquadCreated('${s.id}')" class="btn-del-circle" title="Delete squad">×</button>
        </div>
      `;
    }).join('') : `<p style="color:var(--hint);font-size:12px">None created.</p>`;

    document.getElementById('joined-list').innerHTML = joined.length ? joined.map(s => {
      return `
        <div class="squad-link">
          <span onclick="openSquad('${s.id}', ${JSON.stringify(s)})">${escapeHtml(s.name)} ➔</span>
          <button onclick="exitSquadConfirm('${s.id}')" class="btn-exit-text">LEAVE</button>
        </div>
      `;
    }).join('') : `<p style="color:var(--hint);font-size:12px">None joined.</p>`;
  } catch (e) {
    console.error('renderSquadLists', e);
  }
}

function escapeHtml(s) {
  if (!s) return '';
  return s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
}

async function createGroup() {
  const name = document.getElementById('new-sq-name').value.trim();
  if (!name) return alert('Enter a name');
  const code = Math.random().toString(36).slice(2,9).toUpperCase();
  const { error } = await supabaseClient.from('squads').insert([{ name, owner_id: MY_ID, code }]);
  if (error) return alert('Failed: ' + error.message);
  document.getElementById('new-sq-name').value = '';
  renderSquadLists();
}

async function joinGroup() {
  const code = document.getElementById('join-code').value.trim();
  if (!code) return alert('Enter code');
  const { data: sq } = await supabaseClient.from('squads').select('*').eq('code', code).limit(1).single();
  if (!sq) return alert('Squad not found');
  const { error } = await supabaseClient.from('squad_members').insert([{ squad_id: sq.id, member_id: MY_ID }]);
  if (error) return alert('Failed: ' + error.message);
  document.getElementById('join-code').value = '';
  renderSquadLists();
}

async function deleteSquadCreated(id) {
  if (!confirm('OWNER: Delete this squad and all its members?')) return;
  const { error } = await supabaseClient.from('squads').delete().eq('id', id);
  if (error) return alert('Delete failed: ' + error.message);
  renderSquadLists();
}

function openSquad(id, squadObj) {
  CURRENT_SQUAD = { id, ...squadObj };
  document.getElementById('sq-name-display').innerText = squadObj.name || 'Squad';
  const ownerName = squadObj.owner_id || 'Owner';
  // fetch member count quickly
  supabaseClient.from('squad_members').select('member_id', { count: 'exact' }).eq('squad_id', id).then(res => {
    const count = res.count || 0;
    document.getElementById('sq-owner-count').innerText = `Owner: ${ownerName} • Members: ${count}`;
  }).catch(()=>{ document.getElementById('sq-owner-count').innerText = `Owner: ${ownerName}`; });

  document.getElementById('sq-code-display').innerText = squadObj.code || '';
  showView('view-active-squad');
  loadLeaderboard(id);
}

// Copy code button
async function copyCode() {
  const code = document.getElementById('sq-code-display').innerText;
  try {
    await navigator.clipboard.writeText(code);
    const btn = document.querySelector('.btn-copy');
    const old = btn.innerText;
    btn.innerText = 'COPIED';
    setTimeout(() => btn.innerText = old, 1200);
  } catch (e) {
    alert('Copy not supported');
  }
}

// Exit squad with server call
async function exitSquadConfirm(squadId) {
  if (!squadId && CURRENT_SQUAD) squadId = CURRENT_SQUAD.id;
  if (!confirm('Are you sure you want to leave this squad?')) return;
  try {
    const resp = await fetch(`/api/squads/${encodeURIComponent(squadId)}/exit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: MY_ID })
    });
    if (!resp.ok) {
      const j = await resp.json();
      alert('Failed: ' + (j.error || resp.statusText));
      return;
    }
    alert('Left squad');
    showView('view-groups');
    renderSquadLists();
  } catch (e) {
    alert('Exit failed: ' + e.message);
  }
}

// Leaderboard (simple): displays name + growth% with arrows
async function loadLeaderboard(squadId) {
  // For demo: we query a leaderboard table or compute from members' portfolios.
  // Try to query squad leaderboard from 'squad_leaderboard' view/table if present.
  const lbEl = document.getElementById('leaderboard-list');
  lbEl.innerHTML = '<p style="color:var(--hint)">Loading leaderboard...</p>';
  try {
    // fallback: query a 'squad_leaderboard' table by squad_id
    const { data } = await supabaseClient.from('squad_leaderboard').select('*').eq('squad_id', squadId).order('rank');
    if (!data || data.length === 0) {
      lbEl.innerHTML = '<p style="color:var(--hint)">No leaderboard data yet.</p>';
      return;
    }
    lbEl.innerHTML = data.map(row => {
      const pct = row.growth_pct || 0;
      const arrow = pct >= 0 ? '↑' : '↓';
      const cls = pct >= 0 ? 'up' : 'down';
      return `<div class="asset-item"><div><strong>${escapeHtml(row.name)}</strong><br><small>${row.handle || ''}</small></div><div style="text-align:right"><strong>${arrow} ${Math.abs(pct).toFixed(2)}%</strong><br><small class="${cls}">${row.value ? '$'+Number(row.value).toLocaleString() : ''}</small></div></div>`;
    }).join('');
  } catch (e) {
    lbEl.innerHTML = '<p style="color:var(--hint)">Leaderboard unavailable.</p>';
    console.warn(e);
  }
}

// Init flow
document.addEventListener('DOMContentLoaded', async () => {
  // ensure profile exists in Supabase (upsert)
  await supabaseClient.from('profiles').upsert([{ id: MY_ID, user_name: MY_NAME, telegram_chat_id: tg?.initDataUnsafe?.user?.id }], { onConflict: 'id' });

  await generateFingerprint();
  await checkAndRegisterFingerprint();
  await checkProfileLock();
  renderPortfolio();
  // Kick off periodic refresh of market data & portfolio
  setInterval(renderPortfolio, 300000); // every 5m
});
