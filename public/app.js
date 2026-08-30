const SB_URL = "https://lqkrjajdbotcbjlvimxk.supabase.co";
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

// --- DELETE & EXIT FUNCTIONS ---

window.deleteCoin = async (id) => {
    if (confirm("Permanently delete this coin from your portfolio?")) {
        await supabaseClient.from('assets').delete().eq('id', id);
        renderPortfolio();
    }
};

window.exitSquad = async (groupId) => {
    if (confirm("Are you sure you want to leave this squad?")) {
        await supabaseClient.from('group_members').delete().eq('group_id', groupId).eq('user_id', MY_ID);
        renderSquadLists();
    }
};

window.deleteSquadCreated = async (id) => {
    if (confirm("OWNER: Delete this squad and all its members?")) {
        await supabaseClient.from('groups').delete().eq('id', id);
        renderSquadLists();
    }
};

// --- DATA RENDERING ---

async function renderPortfolio() {
    const { data: assets } = await supabaseClient.from('assets').select('*').eq('user_id', MY_ID);
    const list = document.getElementById('asset-list');
    if (!assets || assets.length === 0) { list.innerHTML = "<p style='color:gray;text-align:center'>No assets yet.</p>"; return; }
    
    const ids = assets.map(a => a.coin_id).join(',');
    const prices = await (await fetch(`/api/prices?coins=${ids}`)).json();
    let total = 0, weight = 0;

    list.innerHTML = assets.map(a => {
        const p = prices[a.coin_id]?.usd || 0, c = prices[a.coin_id]?.usd_24h_change || 0, v = a.amount * p;
        total += v; weight += (c * v);
        return `
        <div class="asset-item">
            <div><strong>${a.coin_id.toUpperCase()}</strong><br><small>${a.amount}</small></div>
            <div style="display:flex; align-items:center;">
                <div style="text-align:right">
                    <strong>$${v.toLocaleString()}</strong><br>
                    <small class="${c>=0?'up':'down'}">${c>=0?'↑':'↓'} ${Math.abs(c).toFixed(2)}%</small>
                </div>
                <button onclick="deleteCoin('${a.id}')" class="btn-del-circle">×</button>
            </div>
        </div>`;
    }).join('');
    document.getElementById('total-val').innerText = "$" + total.toLocaleString();
}

async function renderSquadLists() {
    const { data: created } = await supabaseClient.from('groups').select('*').eq('owner_id', MY_ID);
    const { data: mRows } = await supabaseClient.from('group_members').select('group_id').eq('user_id', MY_ID);
    let jd = []; if (mRows?.length > 0) jd = (await supabaseClient.from('groups').select('*').in('id', mRows.map(m => m.group_id))).data || [];
    
    document.getElementById('created-list').innerHTML = created?.map(s => 
        `<div class="squad-link">
            <span onclick="loadLeaderboard('${s.id}')">${s.name} ➔</span>
            <button onclick="deleteSquadCreated('${s.id}')" style="background:none; border:none; color:red; font-size:20px;">×</button>
        </div>`).join('') || "<p style='color:gray;font-size:12px'>None created.</p>";

    document.getElementById('joined-list').innerHTML = jd?.filter(j => j.owner_id !== MY_ID).map(j => 
        `<div class="squad-link">
            <span onclick="loadLeaderboard('${j.id}')">${j.name} ➔</span>
            <button onclick="exitSquad('${j.id}')" class="btn-exit-text">LEAVE</button>
        </div>`).join('') || "<p style='color:gray;font-size:12px'>None joined.</p>";
}

// ... (Other functions like addAsset, createGroup, joinGroup, loadLeaderboard stay the same)

document.addEventListener('DOMContentLoaded', init);
