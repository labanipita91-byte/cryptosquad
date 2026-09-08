const SB_URL = "https://lqkrjajdbotcbjlvimxk.supabase.co";
const SB_KEY = "sb_publishable_JJf-0T9XY2lVJq1cs3NLuw_-_K7jhhB";
const supabaseClient = supabase.createClient(SB_URL, SB_KEY);
const tg = window.Telegram?.WebApp;

let MY_ID = tg?.initDataUnsafe?.user?.id ? "tg_" + tg.initDataUnsafe.user.id : (localStorage.getItem('device_id') || 'u_' + Math.random().toString(36).substring(7));
let MY_NAME = tg?.initDataUnsafe?.user?.first_name || "Guest";
localStorage.setItem('device_id', MY_ID);

async function init() {
    // ANTI-CHEAT: Check Device Fingerprint
    const fingerprint = btoa(navigator.userAgent + screen.width);
    const { data: profile } = await supabaseClient.from('profiles').upsert([{ 
        user_id: MY_ID, user_name: MY_NAME, device_fingerprint: fingerprint, chat_id: tg?.initDataUnsafe?.user?.id 
    }]).select().single();

    // HARD GATE
    const isLocked = new Date(profile.sub_expiry) < new Date() && !profile.is_pro;
    if (isLocked) document.getElementById('gate-wall').style.display = 'flex';

    document.getElementById('user-display').innerText = MY_NAME + (profile.is_pro ? " 👑" : "");
    renderPortfolio();
}

window.showView = (id) => {
    document.querySelectorAll('section').forEach(s => s.style.display = 'none');
    document.getElementById(id).style.display = 'block';
    if(id === 'view-dashboard') renderPortfolio();
    if(id === 'view-groups') renderSquadLists();
};

window.deleteCoin = async (id) => { if (confirm("Delete?")) { await supabaseClient.from('assets').delete().eq('id', id); renderPortfolio(); } };
window.exitSquad = async (id) => { if (confirm("Leave?")) { await supabaseClient.from('group_members').delete().eq('group_id', id).eq('user_id', MY_ID); renderSquadLists(); } };

async function renderPortfolio() {
    const { data: assets } = await supabaseClient.from('assets').select('*').eq('user_id', MY_ID);
    const list = document.getElementById('asset-list');
    if (!assets || assets.length === 0) { list.innerHTML = "<p style='text-align:center;color:gray'>Empty</p>"; return; }
    const ids = assets.map(a => a.coin_id).join(',');
    const prices = await (await fetch(`/api/prices?coins=${ids}`)).json();
    let total = 0, weight = 0;
    list.innerHTML = assets.map(a => {
        const p = prices[a.coin_id]?.usd || 0, c = prices[a.coin_id]?.usd_24h_change || 0, v = a.amount * p;
        total += v; weight += (c * v);
        return `<div class="asset-item"><div><strong>${a.coin_id.toUpperCase()}</strong><br><small>${a.amount}</small></div>
                <div style="display:flex; align-items:center;"><div style="text-align:right"><strong>$${v.toLocaleString()}</strong><br><small class="${c>=0?'up':'down'}">${c>=0?'↑':'↓'} ${Math.abs(c).toFixed(2)}%</small></div>
                <button onclick="deleteCoin('${a.id}')" class="btn-del">×</button></div></div>`;
    }).join('');
    document.getElementById('total-val').innerText = "$" + total.toLocaleString();
    const avg = total > 0 ? (weight / total) : 0;
    document.getElementById('total-change').innerText = `${avg>=0?'↑':'↓'} ${Math.abs(avg).toFixed(2)}% (24h)`;
    document.getElementById('total-change').className = avg >= 0 ? 'up' : 'down';
}

// ... SQUAD Logic remains same (renderSquadLists, loadLeaderboard)
window.buyTier = async (t) => { const res = await fetch(`/api/pay?userId=${MY_ID}&tier=${t}`); const data = await res.json(); tg.openTelegramLink(data.url); };
window.copyCode = () => { navigator.clipboard.writeText(document.getElementById('sq-code-display').innerText); alert("Copied!"); };

document.addEventListener('DOMContentLoaded', init);
