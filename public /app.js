const SB_URL = "https://lqkrjajdbotcbjlvimxk.supabase.co";
const SB_KEY = "sb_publishable_JJf-0T9XY2lVJq1cs3NLuw_-_K7jhhB";
const supabaseClient = supabase.createClient(SB_URL, SB_KEY);
const tg = window.Telegram?.WebApp;

let MY_ID = localStorage.getItem('device_id') || 'u_' + Math.random().toString(36).substring(7);
let MY_NAME = tg?.initDataUnsafe?.user?.first_name || "Guest";
localStorage.setItem('device_id', MY_ID);

async function init() {
    await supabaseClient.from('profiles').upsert([{ user_id: MY_ID, user_name: MY_NAME }]);
    const { data: winner } = await supabaseClient.from('profiles').select('user_name').eq('is_weekly_winner', true).single();
    if (winner) {
        document.getElementById('winner-banner').style.display = 'block';
        document.getElementById('winner-name').innerText = winner.user_name;
    }
    document.getElementById('user-display').innerText = MY_NAME;
    renderPortfolio();
}

window.showView = (id) => {
    document.querySelectorAll('section').forEach(s => s.style.display = 'none');
    document.getElementById(id).style.display = 'block';
    if(id === 'view-dashboard') renderPortfolio();
    if(id === 'view-groups') renderSquadLists();
};

window.addAsset = async () => {
    const coinInput = document.getElementById('coin-id');
    const amtInput = document.getElementById('coin-amount');
    
    const cid = coinInput.value.toLowerCase().trim();
    const amt = parseFloat(amtInput.value);

    if (!cid) return alert("Please enter a coin name (e.g. bitcoin)");
    if (!amt || amt <= 0) return alert("Please enter a valid amount");

    const { error } = await supabaseClient.from('assets').insert([{ user_id: MY_ID, coin_id: cid, amount: amt }]);
    
    if (error) {
        alert("Database refused coin: " + error.message);
    } else {
        coinInput.value = "";
        amtInput.value = "";
        showView('view-dashboard');
    }
};

async function renderPortfolio() {
    const list = document.getElementById('asset-list');
    const { data: assets } = await supabaseClient.from('assets').select('*').eq('user_id', MY_ID);
    if (!assets || assets.length === 0) { list.innerHTML = "<p style='text-align:center;color:gray;padding:20px'>Empty</p>"; return; }
    
    const ids = assets.map(a => a.coin_id).join(',');
    const prices = await (await fetch(`/api/prices?coins=${ids}`)).json();
    let total = 0, weight = 0;
    list.innerHTML = assets.map(a => {
        const p = prices[a.coin_id]?.usd || 0, c = prices[a.coin_id]?.usd_24h_change || 0, v = a.amount * p;
        total += v; weight += (c * v);
        return `<div class="asset-item"><div><strong>${a.coin_id.toUpperCase()}</strong><br><small>${a.amount}</small></div>
                <div style="text-align:right; display:flex; align-items:center;">
                <div><strong>$${v.toLocaleString()}</strong><br><small class="${c>=0?'up':'down'}">${c.toFixed(2)}%</small></div>
                <button onclick="deleteCoin('${a.id}')" style="background:none; border:none; color:red; margin-left:10px;">×</button></div></div>`;
    }).join('');
    document.getElementById('total-val').innerText = "$" + total.toLocaleString();
    const avg = total > 0 ? (weight / total) : 0;
    document.getElementById('total-change').innerText = `${avg>=0?'+':''}${avg.toFixed(2)}% (24h)`;
    document.getElementById('total-change').className = avg >= 0 ? 'up' : 'down';
}

window.deleteCoin = async (id) => {
    await supabaseClient.from('assets').delete().eq('id', id);
    renderPortfolio();
};

window.createGroup = async () => {
    const name = document.getElementById('new-group-name').value;
    if (!name) return alert("Enter squad name");
    const code = Math.random().toString(36).substring(2, 7).toUpperCase();
    const { error } = await supabaseClient.from('groups').insert([{ name, invite_code: code, owner_id: MY_ID }]);
    if (error) alert("Squad Error: " + error.message);
    else joinGroup(code);
};

window.joinGroup = async (code) => {
    const c = code || document.getElementById('join-code').value.toUpperCase();
    const { data: group } = await supabaseClient.from('groups').select('*').eq('invite_code', c).single();
    if (group) {
        await supabaseClient.from('group_members').upsert([{ group_id: group.id, user_id: MY_ID, user_name: MY_NAME }]);
        localStorage.setItem('active_group_id', group.id);
        loadLeaderboard(group.id);
    } else alert("Code not found");
};

async function renderSquadLists() {
    const { data: created } = await supabaseClient.from('groups').select('*').eq('owner_id', MY_ID);
    const { data: mRows } = await supabaseClient.from('group_members').select('group_id').eq('user_id', MY_ID);
    let joined = [];
    if (mRows?.length > 0) {
        const { data: jd } = await supabaseClient.from('groups').select('*').in('id', mRows.map(m => m.group_id));
        joined = jd || [];
    }
    document.getElementById('created-squads-list').innerHTML = created?.map(s => `<div class="squad-link" onclick="loadLeaderboard('${s.id}')">${s.name} ➔</div>`).join('') || "<small>None</small>";
    document.getElementById('joined-squads-list').innerHTML = joined?.filter(j => j.owner_id !== MY_ID).map(j => `<div class="squad-link" onclick="loadLeaderboard('${j.id}')">${j.name} ➔</div>`).join('') || "<small>None</small>";
}

async function loadLeaderboard(gid) {
    showView('view-active-squad');
    const { data: group } = await supabaseClient.from('groups').select('*').eq('id', gid).single();
    const { data: members } = await supabaseClient.from('group_members').select('*').eq('group_id', gid);
    document.getElementById('sq-name').innerText = group.name;
    document.getElementById('sq-code').innerText = group.invite_code;
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
        <div class="asset-item"><span>${i === 0 ? '👑 ' : i + 1 + '. '}${d.name}</span><strong>${d.growth.toFixed(2)}%</strong></div>`).join('');
}

window.copyCode = () => { navigator.clipboard.writeText(document.getElementById('sq-code').innerText); alert("Copied!"); };
window.shareSquad = () => tg.openTelegramLink(`https://t.me/share/url?url=https://t.me/CryptoSquadProBot&text=Join my Squad! Code: ${document.getElementById('sq-code').innerText}`);
window.confirmExit = () => { if (confirm("Leave?")) { localStorage.removeItem('active_group_id'); showView('view-dashboard'); } };

document.addEventListener('DOMContentLoaded', init);
