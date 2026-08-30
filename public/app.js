const SB_URL ="https:lqkrjajdbotcbjlvimxk.supabase.co";
const SB_KEY = "sb_publishable_JJf-0T9XY2lVJq1cs3NLuw_-_K7jhhB";
const supabaseClient = supabase.createClient(SB_URL, SB_KEY);
const tg = window.Telegram?.WebApp;

let MY_ID = localStorage.getItem('device_id') || 'u_' + Math.random().toString(36).substring(7);
let MY_NAME = tg?.initDataUnsafe?.user?.first_name || "Guest";
localStorage.setItem('device_id', MY_ID);

async function init() {
    await supabaseClient.from('profiles').upsert([{ user_id: MY_ID, user_name: MY_NAME, chat_id: tg?.initDataUnsafe?.user?.id }]);
    renderPortfolio();
}

window.showView = (id) => {
    document.querySelectorAll('section').forEach(s => s.style.display = 'none');
    document.getElementById(id).style.display = 'block';
    if(id === 'view-dashboard') renderPortfolio();
    if(id === 'view-groups') renderSquadLists();
};

// DELETE COIN FUNCTION
window.deleteCoin = async (id) => {
    if (confirm("Remove this coin?")) {
        await supabaseClient.from('assets').delete().eq('id', id);
        renderPortfolio();
    }
};

window.addAsset = async () => {
    const cid = document.getElementById('coin-id').value.toLowerCase().trim();
    const amt = parseFloat(document.getElementById('coin-amount').value);
    if (!cid || isNaN(amt)) return alert("Invalid Data");
    await supabaseClient.from('assets').insert([{ user_id: MY_ID, coin_id: cid, amount: amt }]);
    showView('view-dashboard');
};

async function renderPortfolio() {
    const { data: assets } = await supabaseClient.from('assets').select('*').eq('user_id', MY_ID);
    const list = document.getElementById('asset-list');
    if (!assets || assets.length === 0) { list.innerHTML = "<p style='color:gray'>Empty</p>"; return; }
    
    const ids = assets.map(a => a.coin_id).join(',');
    const prices = await (await fetch(`/api/prices?coins=${ids}`)).json();
    let total = 0, weight = 0;

    list.innerHTML = assets.map(a => {
        const p = prices[a.coin_id]?.usd || 0, c = prices[a.coin_id]?.usd_24h_change || 0, v = a.amount * p;
        total += v; weight += (c * v);
        return `
        <div class="asset-item">
            <div><strong>${a.coin_id.toUpperCase()}</strong><br><small>${a.amount}</small></div>
            <div style="text-align:right; display:flex; align-items:center;">
                <div>
                    <strong>$${v.toLocaleString()}</strong><br>
                    <small class="${c>=0?'up':'down'}">${c>=0?'↑':'↓'} ${Math.abs(c).toFixed(2)}%</small>
                </div>
                <!-- THE DELETE BUTTON -->
                <button onclick="deleteCoin('${a.id}')" class="btn-del">×</button>
            </div>
        </div>`;
    }).join('');
    
    document.getElementById('total-val').innerText = "$" + total.toLocaleString();
    const avg = total > 0 ? (weight / total) : 0;
    const changeEl = document.getElementById('total-change');
    changeEl.innerText = `${avg>=0?'↑':'↓'} ${Math.abs(avg).toFixed(2)}% (24h)`;
    changeEl.className = avg >= 0 ? 'up' : 'down';
}

// Squad Management (Same as before but ensures proper rendering)
window.createGroup = async () => {
    const name = document.getElementById('new-sq-name').value;
    const code = Math.random().toString(36).substring(2, 7).toUpperCase();
    const { data: squad } = await supabaseClient.from('groups').insert([{ name, invite_code: code, owner_id: MY_ID }]).select().single();
    await supabaseClient.from('group_members').insert([{ group_id: squad.id, user_id: MY_ID, user_name: MY_NAME }]);
    renderSquadLists();
};

window.joinGroup = async () => {
    const c = document.getElementById('join-code').value.toUpperCase();
    const { data: group } = await supabaseClient.from('groups').select('*').eq('invite_code', c).single();
    if (group) {
        await supabaseClient.from('group_members').upsert([{ group_id: group.id, user_id: MY_ID, user_name: MY_NAME }]);
        loadLeaderboard(group.id);
    }
};

async function renderSquadLists() {
    const { data: created } = await supabaseClient.from('groups').select('*').eq('owner_id', MY_ID);
    const { data: mRows } = await supabaseClient.from('group_members').select('group_id').eq('user_id', MY_ID);
    let jd = []; if (mRows?.length > 0) jd = (await supabaseClient.from('groups').select('*').in('id', mRows.map(m => m.group_id))).data || [];
    
    document.getElementById('created-list').innerHTML = created?.map(s => `<div class="squad-link"><span onclick="loadLeaderboard('${s.id}')">${s.name} ➔</span></div>`).join('') || "None";
    document.getElementById('joined-list').innerHTML = jd?.filter(j => j.owner_id !== MY_ID).map(j => `<div class="squad-link"><span onclick="loadLeaderboard('${j.id}')">${j.name} ➔</span></div>`).join('') || "None";
}

async function loadLeaderboard(gid) {
    showView('view-active-squad');
    const { data: members } = await supabaseClient.from('group_members').select('*').eq('group_id', gid);
    const { data: group } = await supabaseClient.from('groups').select('*').eq('id', gid).single();
    document.getElementById('sq-name-display').innerText = group.name;
    document.getElementById('sq-code-display').innerText = group.invite_code;
    const mIds = members.map(m => m.user_id);
    const { data: allA } = await supabaseClient.from('assets').select('*').in('user_id', mIds);
    const uCoins = [...new Set(allA.map(a => a.coin_id))].join(',');
    const prices = await (await fetch(`/api/prices?coins=${uCoins}`)).json();
    const lb = members.map(m => {
        const uA = allA.filter(a => a.user_id === m.user_id);
        let t = 0, w = 0; uA.forEach(a => { const p = prices[a.coin_id]?.usd || 0, c = prices[a.coin_id]?.usd_24h_change || 0; t += (a.amount * p); w += (c * (a.amount * p)); });
        return { name: m.user_name, growth: t > 0 ? (w / t) : 0 };
    });
    lb.sort((a, b) => b.growth - a.growth);
    document.getElementById('leaderboard-list').innerHTML = lb.map((d, i) => `
        <div class="asset-item"><span>${i === 0 ? '👑 ' : i + 1 + '. '}${d.name}</span>
        <strong class="${d.growth >= 0 ? 'up' : 'down'}">${d.growth >= 0 ? '↑' : '↓'} ${Math.abs(d.growth).toFixed(2)}%</strong></div>`).join('');
}

window.copyCode = () => { navigator.clipboard.writeText(document.getElementById('sq-code-display').innerText); alert("Copied!"); };
window.shareSquad = () => tg.openTelegramLink(`https://t.me/share/url?url=https://t.me/CryptoSquadProBot?startapp=${document.getElementById('sq-code-display').innerText}`);

document.addEventListener('DOMContentLoaded', init);
