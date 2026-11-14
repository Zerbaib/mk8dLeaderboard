/* MK8DX Times — front-end (no framework) */
const $app = document.getElementById('app');
const state = { meta: null, cc: localGet('cc', '150') };

function localGet(k, d) { try { return localStorage.getItem(k) || d; } catch { return d; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error((await r.json()).error || r.statusText); return r.json(); };

function fmt(ms) {
  const m = Math.floor(ms / 60000); const s = Math.floor((ms % 60000) / 1000); const x = ms % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(x).padStart(3, '0')}`;
}
const gap = (ms, wr) => (ms === wr ? '' : `+${((ms - wr) / 1000).toFixed(3)}`);
const num = (n) => Number(n || 0).toLocaleString('en-US');
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const flag = (code) => (code ? `<img class="flag" src="/flags/${code.toLowerCase()}.svg" alt="${esc(code)}" loading="lazy">` : '');
const countryName = (code) => state.meta.countries.find((c) => c.code === code)?.name || code;
const track = (id) => state.meta.tracks.find((t) => t.id === id);
const regionName = (id) => state.meta.regions.find((r) => r.id === id)?.name || 'Other';
const DISCORD_ICON = '<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.44.87-.6 1.25a18.27 18.27 0 0 0-5.49 0 12.6 12.6 0 0 0-.62-1.25.08.08 0 0 0-.08-.04 19.74 19.74 0 0 0-4.89 1.52.07.07 0 0 0-.03.03C.53 9.05-.32 13.58.1 18.06a.08.08 0 0 0 .03.06 19.9 19.9 0 0 0 5.99 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.23-1.99a.08.08 0 0 0-.04-.11 13.1 13.1 0 0 1-1.87-.89.08.08 0 0 1-.01-.13l.37-.29a.07.07 0 0 1 .08-.01c3.93 1.79 8.18 1.79 12.06 0a.07.07 0 0 1 .08.01l.37.29a.08.08 0 0 1-.01.13c-.6.35-1.22.65-1.87.89a.08.08 0 0 0-.04.11c.36.7.78 1.36 1.23 1.99a.08.08 0 0 0 .08.03 19.84 19.84 0 0 0 6-3.03.08.08 0 0 0 .03-.06c.5-5.18-.84-9.67-3.55-13.66a.06.06 0 0 0-.03-.03zM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.96 2.42-2.16 2.42zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.95 2.42-2.16 2.42z"/></svg>';
const REGION_ICONS = { europe: '🌍', africa: '🌍', 'north-america': '🌎', 'south-america': '🌎', asia: '🌏', oceania: '🌏' };
const rank = (r) => `<span class="rank rank-${r <= 3 ? r : 'x'}">${r}</span>`;
const playerLink = (id, name) => `<a class="player-link" href="#/player/${id}">${esc(name)}</a>`;
const proofHref = (r) => r.proof_url || (r.proof_file ? `/uploads/${r.proof_file}` : null);
const proofCell = (r) => { const h = proofHref(r); return h ? `<a class="proof" href="${esc(h)}" target="_blank" rel="noopener noreferrer">View ▸</a>` : ''; };
const CUP_COLORS = ['#e5352b', '#ff8a00', '#ffc928', '#a855f7', '#2d8cff', '#ffd34d', '#2ecc71', '#f97316', '#38bdf8', '#eab308', '#22c55e', '#f43f5e',
  '#fbbf24', '#ec4899', '#a3e635', '#60a5fa', '#94a3b8', '#818cf8', '#fb7185', '#34d399', '#c084fc', '#f472b6', '#d97706', '#4ade80'];

function ccToggle() {
  return `<div class="seg" role="group" aria-label="Engine class">
    ${['150', '200'].map((c) => `<button data-cc="${c}" class="${state.cc === c ? 'on' : ''}">${c}cc</button>`).join('')}
  </div>`;
}
function bindCc(rerender) {
  $app.querySelectorAll('[data-cc]').forEach((b) => b.addEventListener('click', () => {
    state.cc = b.dataset.cc; localSet('cc', state.cc); rerender();
  }));
}
function countryOptions(selected, placeholder = 'All countries') {
  return `<option value="">${placeholder}</option>${state.meta.countries.map((c) =>
    `<option value="${c.code}" ${c.code === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`;
}
function regionSelect(region) {
  return `<select id="region" aria-label="Region"><option value="">All regions</option>${state.meta.regions
    .map((r) => `<option value="${r.id}" ${r.id === region ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>`;
}
function bindFilters(base, country, region) {
  const update = (c, r) => {
    const p = new URLSearchParams(); if (c) p.set('country', c); if (r) p.set('region', r);
    location.hash = `${base}${p.toString() ? `?${p}` : ''}`;
  };
  $app.querySelector('#country').addEventListener('change', (e) => update(e.target.value, region));
  $app.querySelector('#region').addEventListener('change', (e) => update(country, e.target.value));
}
const empty = (title, text) => `<div class="card empty"><b>${title}</b>${text}</div>`;
const loading = () => { $app.innerHTML = '<div class="empty">Loading…</div>'; };
const recordsPill = (n) => (n ? `<span class="pill pill-wr">🏆 ${n}</span>` : '0');

// ---------- Home ----------
async function viewHome() {
  const [recent, s] = await Promise.all([api('/api/recent'), api('/api/stats')]);
  $app.innerHTML = `
    <section class="hero">
      <div class="card hero-main">
        <h1>The Mario Kart 8 Deluxe <span>time trial</span> leaderboard</h1>
        <p>Submit your best times in 150cc and 200cc on all 96 tracks. Every time is checked by our moderators before it shows up on the leaderboard.</p>
        <div class="toolbar">
          <a class="btn btn-primary" href="#/submit">Submit a time</a>
          <a class="btn" href="#/tracks">Browse tracks</a>
          ${state.meta.legal.discordInvite ? `<a class="btn btn-discord" href="${esc(state.meta.legal.discordInvite)}" target="_blank" rel="noopener">${DISCORD_ICON}Join the Discord</a>` : ''}
        </div>
      </div>
      <div class="stats">
        <div class="card stat"><b>${num(s.players)}</b><span>ranked players</span></div>
        <div class="card stat"><b>${num(s.approved)}</b><span>approved times</span></div>
        <div class="card stat"><b>${num(s.countries)}</b><span>countries</span></div>
        <div class="card stat"><b>${num(s.pending)}</b><span>awaiting review</span></div>
      </div>
    </section>
    <h2 class="section-title">Latest approved times</h2>
    ${recent.length ? `<div class="card table-wrap"><table>
      <thead><tr><th>Player</th><th>Track</th><th>Class</th><th class="num">Time</th></tr></thead>
      <tbody>${recent.map((r) => `<tr>
        <td>${flag(r.country)}${playerLink(r.player_id, r.name)}</td>
        <td><a class="player-link" href="#/track/${r.track_id}">${esc(track(r.track_id)?.name)}</a></td>
        <td><span class="pill pill-cc">${r.cc}cc</span></td>
        <td class="num time">${fmt(r.time_ms)}</td></tr>`).join('')}</tbody></table></div>`
    : empty('No times yet', 'Be the first to submit one!')}`;
}

// ---------- Tracks ----------
async function viewTracks() {
  const records = await api(`/api/records?cc=${state.cc}`);
  const wr = Object.fromEntries(records.map((r) => [r.track_id, r]));
  const byCup = state.meta.cups.map((cup, i) => ({ cup, i, tracks: state.meta.tracks.filter((t) => t.cupIndex === i) }));
  $app.innerHTML = `
    <div class="page-head"><div><h1>Tracks</h1><p>Current record on every track. Click a track to see the full leaderboard.</p></div>
      <div class="toolbar"><input id="q" type="search" placeholder="Search a track…" aria-label="Search a track">${ccToggle()}</div></div>
    <div id="cups">${byCup.map(({ cup, i, tracks }) => `
      <section class="cup" data-cup>
        <h3><span style="color:${CUP_COLORS[i]}">●</span>${esc(cup)}${i >= 12 ? ' <span class="pill">Booster Pass</span>' : ''}</h3>
        <div class="tracks">${tracks.map((t) => {
          const r = wr[t.id];
          return `<a class="track" href="#/track/${t.id}" style="--c:${CUP_COLORS[i]}" data-name="${esc(t.name.toLowerCase())}">
            <span class="track-name">${esc(t.name)}</span>
            <span class="track-wr">${r ? `<span>${flag(r.country)}${esc(r.name)}</span><span class="time">${fmt(r.time_ms)}</span>` : '<span>No time yet</span>'}</span>
          </a>`;
        }).join('')}</div>
      </section>`).join('')}</div>`;
  bindCc(viewTracks);
  $app.querySelector('#q').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    $app.querySelectorAll('.track').forEach((el) => { el.style.display = el.dataset.name.includes(q) ? '' : 'none'; });
    $app.querySelectorAll('[data-cup]').forEach((c) => { c.style.display = [...c.querySelectorAll('.track')].some((t) => t.style.display !== 'none') ? '' : 'none'; });
  });
}

async function viewTrack(id, params) {
  const t = track(id);
  if (!t) { $app.innerHTML = empty('Track not found', ''); return; }
  const country = params.get('country') || '';
  const region = params.get('region') || '';
  const rows = await api(`/api/leaderboard/track/${id}?${new URLSearchParams({ cc: state.cc, country, region })}`);
  const top = rows.slice(0, 3);
  $app.innerHTML = `
    <div class="page-head"><div><p><a class="player-link" href="#/tracks">← Tracks</a> · ${esc(t.cup)}</p><h1>${esc(t.name)}</h1></div>
      <div class="toolbar"><select id="country" aria-label="Country">${countryOptions(country)}</select>${regionSelect(region)}${ccToggle()}</div></div>
    ${rows.length >= 3 ? `<div class="podium">${[1, 0, 2].map((i) => `<div class="card ${i === 0 ? 'p1' : ''}">
        ${rank(i + 1)}<div class="name">${flag(top[i].country)}${playerLink(top[i].player_id, top[i].name)}</div>
        <div class="time">${fmt(top[i].time_ms)}</div><div class="gap">${gap(top[i].time_ms, top[0].time_ms) || 'Record'}</div></div>`).join('')}</div>` : ''}
    ${rows.length ? `<div class="card table-wrap"><table>
      <thead><tr><th>#</th><th>Player</th><th class="hide-sm">Region</th><th class="num">Time</th><th class="num hide-sm">Gap</th><th class="num">Points</th><th>Proof</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr>
        <td>${rank(country || region ? i + 1 : r.world_rank)}</td>
        <td>${flag(r.country)}${playerLink(r.player_id, r.name)}${country || region ? ` <span class="pill">${ordinal(r.world_rank)} worldwide</span>` : ''}</td>
        <td class="hide-sm muted">${esc(regionName(r.region))}</td>
        <td class="num time">${fmt(r.time_ms)}</td>
        <td class="num gap hide-sm">${gap(r.time_ms, rows[0].time_ms)}</td>
        <td class="num">${num(r.points)}</td>
        <td>${proofCell(r)}</td></tr>`).join('')}</tbody></table></div>`
    : empty('No approved times', `No ${state.cc}cc time yet${country || region ? ' for this filter' : ''}. <a href="#/submit?track=${id}">Submit yours!</a>`)}`;
  bindCc(() => route());
  bindFilters(`#/track/${id}`, country, region);
}

// ---------- Players ----------
async function viewPlayers(params) {
  const country = params.get('country') || '';
  const region = params.get('region') || '';
  const rows = await api(`/api/leaderboard/players?${new URLSearchParams({ cc: state.cc, country, region })}`);
  $app.innerHTML = `
    <div class="page-head"><div><h1>Player rankings</h1><p>Sum of points across all tracks (1,000 points per record). <a class="player-link" href="#/points">How points work</a></p></div>
      <div class="toolbar"><select id="country" aria-label="Country">${countryOptions(country)}</select>${regionSelect(region)}${ccToggle()}</div></div>
    ${rows.length ? `<div class="card table-wrap"><table>
      <thead><tr><th>#</th><th>Player</th><th class="hide-sm">Region</th><th class="num">Tracks</th><th class="num">Records</th><th class="num">Points</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr>
        <td>${rank(i + 1)}</td>
        <td>${flag(r.country)}${playerLink(r.player_id, r.name)}</td>
        <td class="hide-sm muted">${esc(regionName(r.region))}</td>
        <td class="num">${r.tracks}/96</td>
        <td class="num">${recordsPill(r.records)}</td>
        <td class="num time">${num(r.points)}</td></tr>`).join('')}</tbody></table></div>`
    : empty('No ranked players', 'No approved times for this filter.')}`;
  bindCc(() => route());
  bindFilters('#/players', country, region);
}

async function viewPlayer(id) {
  const { player, records } = await api(`/api/players/${id}`);
  const list = records.filter((r) => String(r.cc) === state.cc);
  const pts = list.reduce((a, r) => a + r.points, 0);
  const wrs = list.filter((r) => r.world_rank === 1).length;
  $app.innerHTML = `
    <div class="page-head"><div class="profile-head">
        <div class="avatar">${esc(player.name[0].toUpperCase())}</div>
        <div><h1>${esc(player.name)}</h1><p>${flag(player.country)}${esc(countryName(player.country))}· ${esc(regionName(player.region))}</p></div>
      </div>${ccToggle()}</div>
    <div class="stats" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
      <div class="card stat"><b>${num(pts)}</b><span>${state.cc}cc points</span></div>
      <div class="card stat"><b>${list.length}/96</b><span>tracks played</span></div>
      <div class="card stat"><b>${wrs}</b><span>records</span></div>
    </div>
    ${list.length ? `<div class="card table-wrap"><table>
      <thead><tr><th>Track</th><th class="hide-sm">Cup</th><th class="num">Time</th><th class="num">Rank</th><th class="num hide-sm">Gap to record</th><th class="num">Points</th><th>Proof</th></tr></thead>
      <tbody>${list.map((r) => `<tr>
        <td><a class="player-link" href="#/track/${r.track_id}">${esc(track(r.track_id)?.name)}</a></td>
        <td class="hide-sm muted">${esc(track(r.track_id)?.cup)}</td>
        <td class="num time">${fmt(r.time_ms)}</td>
        <td class="num">${r.world_rank === 1 ? '<span class="pill pill-wr">🏆 Record</span>' : `${r.world_rank}/${r.total}`}</td>
        <td class="num gap hide-sm">${gap(r.time_ms, r.wr_ms) || '—'}</td>
        <td class="num">${num(r.points)}</td>
        <td>${proofCell(r)}</td></tr>`).join('')}</tbody></table></div>`
    : empty(`No ${state.cc}cc times`, 'This player has no approved time in this class yet.')}`;
  bindCc(() => route());
}

// ---------- Countries & regions ----------
async function viewCountries() {
  const rows = await api(`/api/leaderboard/countries?cc=${state.cc}`);
  $app.innerHTML = `
    <div class="page-head"><div><h1>Country rankings</h1><p>Sum of the points of every player from each country.</p></div>${ccToggle()}</div>
    ${rows.length ? `<div class="card table-wrap"><table>
      <thead><tr><th>#</th><th>Country</th><th class="hide-sm">Region</th><th class="num">Players</th><th class="num">Records</th><th class="hide-sm">Top player</th><th class="num">Points</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr>
        <td>${rank(i + 1)}</td>
        <td><a class="player-link" href="#/players?country=${r.country}">${flag(r.country)}${esc(countryName(r.country))}</a></td>
        <td class="hide-sm muted">${esc(regionName(state.meta.countries.find((c) => c.code === r.country)?.region))}</td>
        <td class="num">${r.players}</td>
        <td class="num">${recordsPill(r.records)}</td>
        <td class="hide-sm">${esc(r.top_player)}</td>
        <td class="num time">${num(r.points)}</td></tr>`).join('')}</tbody></table></div>`
    : empty('No ranked countries', 'No approved times yet.')}`;
  bindCc(viewCountries);
}

async function viewRegions() {
  const rows = await api(`/api/leaderboard/regions?cc=${state.cc}`);
  $app.innerHTML = `
    <div class="page-head"><div><h1>Region rankings</h1><p>Europe vs the Americas vs the rest of the world: sum of the points of every player from each region.</p></div>${ccToggle()}</div>
    ${rows.length ? `<div class="card table-wrap"><table>
      <thead><tr><th>#</th><th>Region</th><th class="num">Countries</th><th class="num">Players</th><th class="num">Records</th><th class="hide-sm">Top player</th><th class="num">Points</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr>
        <td>${rank(i + 1)}</td>
        <td><a class="player-link" href="#/players?region=${r.region}"><span class="region-icon">${REGION_ICONS[r.region] || '🌐'}</span>${esc(regionName(r.region))}</a></td>
        <td class="num">${r.countries}</td>
        <td class="num">${r.players}</td>
        <td class="num">${recordsPill(r.records)}</td>
        <td class="hide-sm">${flag(r.top_country)}${esc(r.top_player)}</td>
        <td class="num time">${num(r.points)}</td></tr>`).join('')}</tbody></table></div>`
    : empty('No ranked regions', 'No approved times yet.')}`;
  bindCc(viewRegions);
}

// ---------- Submission form ----------
// ---------- Discord verification ----------
const session = {
  get(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
};

function viewVerify(p) {
  const invite = p.discordInvite || state.meta.legal.discordInvite;
  $app.innerHTML = `
    <div class="page-head"><div><h1>Verify it's you</h1><p>Your time <b>${esc(p.time)}</b> as <b>${esc(p.player)}</b> is saved. Confirm it with Discord to send it to the moderators.</p></div></div>
    <div class="card card-pad form-card verify">
      <ol class="steps">
        <li><span class="step-n">1</span><div><b>Join our Discord server</b>
          <p class="muted">A new tab opened with the invitation. Already a member? Skip this step.</p>
          ${invite ? `<a class="btn btn-discord" href="${esc(invite)}" target="_blank" rel="noopener">${DISCORD_ICON}Join the Discord</a>` : ''}</div></li>
        <li><span class="step-n">2</span><div><b>Type <code>/verif</code> in any channel</b>
          <p class="muted">The bot sends you a 6-digit code by private message (valid 10 minutes).</p></div></li>
        <li><span class="step-n">3</span><div><b>Enter the code here</b>
          <form id="vform" class="code-row" novalidate>
            <input id="code" class="code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123456" aria-label="6-digit code">
            <button class="btn btn-primary" id="vbtn" type="submit">Verify</button>
          </form></div></li>
      </ol>
      <div id="vmsg"></div>
      <p class="muted small">Your player name will be linked to this Discord account: only you will be able to submit times under it. Unverified submissions are deleted after 24 hours.
        <a href="#/submit?new=1" id="vcancel">Cancel and submit another time</a></p>
    </div>`;
  const input = $app.querySelector('#code');
  input.focus();
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); });
  $app.querySelector('#vcancel').addEventListener('click', () => session.del('pendingVerify'));
  $app.querySelector('#vform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $app.querySelector('#vmsg'); const btn = $app.querySelector('#vbtn');
    if (!/^\d{6}$/.test(input.value)) { msg.innerHTML = '<div class="alert alert-err">The code has 6 digits.</div>'; return; }
    btn.disabled = true; btn.textContent = 'Checking…';
    try {
      const r = await fetch(`/api/submissions/${p.id}/verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: p.token, code: input.value }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      session.del('pendingVerify');
      localSet('discordJoined', '1');
      $app.querySelector('.verify').innerHTML = `
        <div class="alert alert-ok">✅ Verified as <b>@${esc(data.discordName)}</b>. Your time <b>${esc(p.time)}</b> has been sent to the moderators.
          You'll get a Discord DM when it's reviewed.</div>
        <a class="btn btn-primary" href="#/submit?new=1">Submit another time</a>`;
    } catch (err) {
      msg.innerHTML = `<div class="alert alert-err">${esc(err.message)}</div>`;
      btn.disabled = false; btn.textContent = 'Verify';
    }
  });
}

function viewSubmit(params) {
  const pending = session.get('pendingVerify');
  if (pending && !params.get('new')) { viewVerify(pending); return; }
  const saved = (() => { try { return JSON.parse(localStorage.getItem('player') || '{}'); } catch { return {}; } })();
  const preTrack = params.get('track') || '';
  $app.innerHTML = `
    <div class="page-head"><div><h1>Submit a time</h1><p>After sending, you'll confirm it's you on our Discord server with <code>/verif</code>. A moderator then checks your time before it appears on the leaderboard.</p></div></div>
    <form id="form" class="card card-pad form-card" novalidate>
      <div id="msg"></div>
      <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <div class="row">
        <div class="field"><label for="player_name">Player name</label><input id="player_name" name="player_name" required maxlength="32" value="${esc(saved.player_name || '')}" placeholder="Your nickname" autocomplete="nickname"></div>
        <div class="field"><label for="countrySel">Country</label><select id="countrySel" name="country" required>${countryOptions(saved.country || '', 'Select your country')}</select>
          <div class="hint" id="regionHint"></div></div>
      </div>
      <div class="row">
        <div class="field"><label for="track_id">Track</label><select id="track_id" name="track_id" required>
          <option value="">Select a track</option>
          ${state.meta.cups.map((cup, i) => `<optgroup label="${esc(cup)}">${state.meta.tracks.filter((t) => t.cupIndex === i)
            .map((t) => `<option value="${t.id}" ${t.id === preTrack ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</optgroup>`).join('')}
        </select></div>
        <div class="field"><label>Engine class</label>
          <div class="seg" id="ccSeg">${['150', '200'].map((c) => `<button type="button" data-v="${c}" class="${state.cc === c ? 'on' : ''}">${c}cc</button>`).join('')}</div>
          <input type="hidden" name="cc" value="${state.cc}"></div>
      </div>
      <div class="field"><label for="time">Time</label><input id="time" name="time" required placeholder="1:45.123" inputmode="decimal">
        <div class="hint">Format minutes:seconds.milliseconds — e.g. 1:45.123</div></div>
      <div class="field"><label>Proof</label>
        <div class="proof-switch seg" id="proofSeg"><button type="button" data-p="url" class="on">Link</button><button type="button" data-p="file">File</button></div>
        <div id="proofUrl"><input name="proof_url" type="url" placeholder="https://youtu.be/… or https://x.com/…"></div>
        <label id="proofFile" class="dropzone" style="display:none"><input type="file" name="proof_file" accept="image/*,video/*">
          <span id="fileLabel">Drop a screenshot or video here, or click to choose one (max 50 MB)</span></label>
        <div class="hint">Screenshot of the ghost / results screen, or a YouTube, Twitch or X video.</div></div>
      <div class="field"><label for="comment">Comment <span class="muted">(optional)</span></label><textarea id="comment" name="comment" rows="2" maxlength="500" placeholder="Combo used, useful info…"></textarea></div>
      <div class="notice">Once approved, your <b>player name, country, time and proof</b> are shown publicly on this site. You'll need a Discord account to confirm your submission; it is then sent to our moderators through Discord. See the <a href="#/privacy">Privacy Policy</a>.</div>
      <div class="field"><label class="consent"><input type="checkbox" name="accept_terms" required>
        <span>I confirm this time was set by me, without cheats or modifications, and I accept the <a href="#/terms" target="_blank">Terms of Use</a> and the <a href="#/privacy" target="_blank">Privacy Policy</a>.</span></label></div>
      <button class="btn btn-primary" id="sendBtn" type="submit">Send for review</button>
    </form>`;

  const form = $app.querySelector('#form');
  const countrySel = form.querySelector('#countrySel');
  const showRegion = () => {
    const c = state.meta.countries.find((x) => x.code === countrySel.value);
    form.querySelector('#regionHint').textContent = c ? `Region: ${regionName(c.region)}` : '';
  };
  countrySel.addEventListener('change', showRegion); showRegion();

  form.querySelectorAll('#ccSeg button').forEach((b) => b.addEventListener('click', () => {
    form.querySelectorAll('#ccSeg button').forEach((x) => x.classList.toggle('on', x === b));
    form.cc.value = b.dataset.v;
  }));
  let proofMode = 'url';
  form.querySelectorAll('#proofSeg button').forEach((b) => b.addEventListener('click', () => {
    proofMode = b.dataset.p;
    form.querySelectorAll('#proofSeg button').forEach((x) => x.classList.toggle('on', x === b));
    form.querySelector('#proofUrl').style.display = proofMode === 'url' ? '' : 'none';
    form.querySelector('#proofFile').style.display = proofMode === 'file' ? '' : 'none';
  }));
  const drop = form.querySelector('#proofFile'); const fileInput = drop.querySelector('input');
  const showFile = () => { form.querySelector('#fileLabel').textContent = fileInput.files[0] ? `📎 ${fileInput.files[0].name}` : 'Drop a screenshot or video here, or click to choose one (max 50 MB)'; };
  fileInput.addEventListener('change', showFile);
  ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('drag')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); fileInput.files = e.dataTransfer.files; showFile(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = form.querySelector('#msg'); const btn = form.querySelector('#sendBtn');
    const fd = new FormData(form);
    if (proofMode === 'url') fd.delete('proof_file'); else fd.delete('proof_url');
    const error = (t) => { msg.innerHTML = `<div class="alert alert-err">${esc(t)}</div>`; msg.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    if (!fd.get('country')) return error('Please select your country.');
    if (!/^\d{1,2}:[0-5]\d[.,]\d{3}$/.test(fd.get('time').trim())) return error('Invalid time. Expected format: 1:45.123');
    if (!form.accept_terms.checked) return error('You must accept the Terms of Use and the Privacy Policy.');
    btn.disabled = true; btn.textContent = 'Sending…';
    // Open the Discord invite in a new tab. The tab must be opened during the click (popup blockers),
    // so it starts blank and is pointed at the invite once the submission is accepted.
    const invite = state.meta.legal.discordInvite;
    const tab = invite && !localGet('discordJoined', '') ? window.open('', '_blank') : null;
    try {
      const r = await fetch('/api/submissions', { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      localSet('player', JSON.stringify({ player_name: fd.get('player_name'), country: fd.get('country') }));
      if (data.verifyRequired) {
        if (tab) { tab.opener = null; tab.location.href = invite; }
        const pending = { id: data.id, token: data.token, time: data.time, player: data.player, discordInvite: data.discordInvite };
        session.set('pendingVerify', pending);
        viewVerify(pending);
        window.scrollTo(0, 0);
        return;
      }
      if (tab) tab.close();
      msg.innerHTML = `<div class="alert alert-ok">✅ Time <b>${esc(data.time)}</b> sent (submission #${data.id}). It will appear on the leaderboard once a moderator approves it.</div>`;
      form.time.value = ''; form.proof_url.value = ''; fileInput.value = ''; showFile(); form.comment.value = '';
      msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      if (tab) tab.close();
      error(err.message);
    } finally { btn.disabled = false; btn.textContent = 'Send for review'; }
  });
}

// ---------- Legal pages ----------
function legalPage(title, body) {
  const L = state.meta.legal;
  $app.innerHTML = `
    <div class="page-head"><div><h1>${title}</h1><p>Last updated: ${new Date(L.updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p></div></div>
    <article class="card legal">${body}</article>`;
}
// Values come from the server configuration (.env); placeholders are highlighted until they are filled in
const v = (val) => (/^\[.*\]$/.test(val) ? `<span class="ph">${esc(val)}</span>` : esc(val));
const mail = (m) => (/^\[.*\]$/.test(m) ? v(m) : `<a href="mailto:${esc(m)}">${esc(m)}</a>`);

function viewTerms() {
  const L = state.meta.legal;
  legalPage('Terms of Use', `
    <h2>1. Purpose</h2>
    <p>These Terms of Use govern access to and use of <b>${esc(L.siteName)}</b> (${esc(L.siteUrl)}), a free, unofficial, community-run leaderboard for Mario Kart 8 Deluxe time trials (the "Site"), published by ${v(L.owner)} (the "Publisher").</p>
    <h2>2. Acceptance</h2>
    <p>By browsing the Site you agree to these Terms. Submitting a time requires you to explicitly accept them together with the <a href="#/privacy">Privacy Policy</a>. If you do not agree, please do not use the Site.</p>
    <h2>3. Access to the Site</h2>
    <p>The Site is free and does not require an account. The Publisher makes reasonable efforts to keep it available but does not guarantee uninterrupted access and may suspend, modify or close it at any time, in particular for maintenance.</p>
    <p>If you are under the age of digital consent in your country (15 in France, 13 to 16 elsewhere in the EU), you must have the permission of a parent or legal guardian before submitting a time.</p>
    <h2>4. Submitting times</h2>
    <p>When you submit a time, you confirm that:</p>
    <ul>
      <li>the time was set by you, personally, on an unmodified copy of Mario Kart 8 Deluxe running on a Nintendo Switch console;</li>
      <li>no cheat, hacked save, modified game file, emulator speed-up, macro or any other unfair tool was used;</li>
      <li>the proof you provide is genuine, unedited and shows the submitted time;</li>
      <li>you have the right to share the proof (e.g. you made the video or screenshot yourself) and it does not infringe anyone else's rights.</li>
    </ul>
    <p>Each submission must be confirmed with a Discord account, using the <code>/verif</code> command on our Discord server. The first verified submission links your player name to your Discord account: afterwards, only this account can submit times under that name, and each Discord account can only be linked to one player name. To change this link, contact a moderator.</p>
    <p>Only one player name may be used per person. Do not submit times under someone else's name.</p>
    <h2>5. Moderation</h2>
    <p>Every submission is reviewed by volunteer moderators before publication. Moderators may approve or reject any submission at their sole discretion, may ask for additional proof, and may remove an approved time or a player from the leaderboard at any time if a rule appears to have been broken. Moderation decisions are not subject to any compensation.</p>
    <h2>6. Content you submit</h2>
    <p>You remain the owner of the proofs you submit. By submitting them, you grant the Publisher a free, non-exclusive, worldwide licence to store, reproduce and display them on the Site and to share them with moderators, for as long as the time is displayed, solely for the purpose of running the leaderboard.</p>
    <p>You must not submit content that is illegal, offensive, hateful, sexually explicit, violent, defamatory, contains personal data of other people, or is unrelated to the submitted time. The same applies to player names and comments.</p>
    <h2>7. Prohibited behaviour</h2>
    <ul>
      <li>Attempting to disrupt, overload or gain unauthorised access to the Site or its database;</li>
      <li>Sending spam or automated submissions;</li>
      <li>Impersonating another player or a moderator;</li>
      <li>Harassing other players or moderators.</li>
    </ul>
    <p>Any breach may lead to the removal of your times and a ban from submitting.</p>
    <h2>8. Intellectual property</h2>
    <p>Mario Kart, Nintendo Switch and the names of tracks and cups are trademarks of Nintendo. The Site is a fan project, is not affiliated with, endorsed or sponsored by Nintendo, and does not use any game assets. All other elements of the Site (design, code, texts) belong to the Publisher, unless stated otherwise.</p>
    <h2>9. Liability</h2>
    <p>The Site and the leaderboards are provided "as is", for entertainment purposes only. The Publisher does not guarantee that the rankings are complete or error-free and cannot be held liable for any indirect damage resulting from the use of the Site. External links (videos, social networks) are under the sole responsibility of their publishers.</p>
    <h2>10. Personal data</h2>
    <p>The processing of your personal data is described in the <a href="#/privacy">Privacy Policy</a>.</p>
    <h2>11. Changes</h2>
    <p>These Terms may be updated at any time. The date of the last update is shown at the top of this page. Continuing to use the Site after a change means you accept the new version.</p>
    <h2>12. Governing law</h2>
    <p>These Terms are governed by French law. In the event of a dispute, please contact us first so we can try to find an amicable solution. If no solution is found, the competent French courts will have jurisdiction, without prejudice to any mandatory consumer protection rules of your country of residence.</p>
    <h2>13. Contact</h2>
    <p>Any question about these Terms: ${mail(L.contactEmail)}${L.discordInvite ? ` or on our <a href="${esc(L.discordInvite)}" target="_blank" rel="noopener">Discord server</a>` : ''}.</p>`);
}

function viewPrivacy() {
  const L = state.meta.legal;
  legalPage('Privacy Policy', `
    <p>This policy explains what personal data <b>${esc(L.siteName)}</b> collects, why, and what your rights are, in accordance with the EU General Data Protection Regulation (GDPR).</p>
    <h2>1. Data controller</h2>
    <p>${v(L.owner)}, ${v(L.ownerAddress)} — contact: ${mail(L.contactEmail)}.</p>
    <h2>2. Data we collect</h2>
    <p><b>When you submit a time</b> (all provided by you):</p>
    <ul>
      <li>player name and country (your world region, e.g. Europe, is deduced from your country);</li>
      <li>track, engine class and time;</li>
      <li>your proof: a link or an uploaded image/video — note that a proof may contain your in-game name, your voice or your image if you include them;</li>
      <li>an optional comment;</li>
      <li>your <b>Discord user ID and username</b>, when you confirm the submission with <code>/verif</code>;</li>
      <li>the date of submission, and the review result (approved/rejected, moderator name, optional reason).</li>
    </ul>
    <p><b>Technical data:</b> your IP address is used temporarily, in memory only, to limit the number of submissions (anti-spam). It is never written to our database and is forgotten within 10 minutes. Our hosting provider may keep standard server logs for security purposes.</p>
    <p>We do not ask for your email address or real name, and we do not use any analytics or advertising tools.</p>
    <h2>3. Purposes and legal bases</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Purpose</th><th>Legal basis</th></tr></thead>
      <tbody>
        <tr><td>Reviewing your submission and publishing it on the leaderboards</td><td>Performance of the service you request by accepting the Terms of Use (Art. 6(1)(b) GDPR)</td></tr>
        <tr><td>Checking that you own your player name (Discord verification) and sending you the result of the review by Discord direct message</td><td>Performance of the service you request (Art. 6(1)(b) GDPR) and our legitimate interest in preventing impersonation (Art. 6(1)(f) GDPR)</td></tr>
        <tr><td>Preventing spam and abuse</td><td>Our legitimate interest in keeping the Site working (Art. 6(1)(f) GDPR)</td></tr>
        <tr><td>Answering your requests</td><td>Our legitimate interest / legal obligations</td></tr>
      </tbody></table></div>
    <h2>4. What is public</h2>
    <p>Once a time is approved, the following are <b>publicly visible</b> on the Site: player name, country and world region, times, rankings, points and proof (link or file). Rejected and pending submissions are never public. The link between your player name and your Discord account is <b>not</b> displayed on the Site; it is only visible to the moderators.</p>
    <h2>5. Who receives your data</h2>
    <ul>
      <li><b>Moderators</b>: each submission is sent, with the Discord account that confirmed it, to a private channel of our Discord server, where volunteer moderators review it. Our Discord bot also sends you direct messages (your verification code and the result of the review). Discord is operated by Discord Inc. (United States); data transferred to it is covered by the EU-US Data Privacy Framework and/or the European Commission's Standard Contractual Clauses. See <a href="https://discord.com/privacy" target="_blank" rel="noopener">Discord's privacy policy</a>.</li>
      <li><b>Our hosting provider</b>: ${v(L.hostName)}, which stores the Site and its database.</li>
    </ul>
    <p>Your data is never sold or used for advertising.</p>
    <h2>6. Retention</h2>
    <ul>
      <li><b>Approved times</b>: kept as long as they are displayed on the leaderboard, or until you ask for their deletion.</li>
      <li><b>Rejected submissions</b>: automatically deleted, including any uploaded file, ${L.rejectedRetentionDays} days after the review.</li>
      <li><b>Pending submissions</b>: kept until they are reviewed. Submissions that are never confirmed on Discord are deleted, including any uploaded file, after 24 hours.</li>
      <li><b>Verification codes</b>: valid for 10 minutes, then deleted.</li>
      <li><b>Link between your player name and your Discord account</b>: kept as long as your player profile exists.</li>
      <li>The Discord review message may remain in the moderators' private channel; it is deleted on request.</li>
    </ul>
    <h2>7. Cookies and local storage</h2>
    <p>The Site does not use cookies or trackers. It uses your browser's local storage, only on your device, to remember your player name and country (to pre-fill the form) and your preferred engine class. You can clear it at any time from your browser settings. Fonts and flags are hosted on our own server: no third-party service is contacted while you browse, except external proof links you choose to open.</p>
    <h2>8. Your rights</h2>
    <p>You have the right to access, rectify and erase your data, to restrict or object to its processing, and to data portability. To exercise them — for example to change your player name or remove all your times — contact ${mail(L.contactEmail)}, indicating your player name. As we have no accounts, we may ask you to prove that you own the player name, for example by contacting us from the Discord account linked to it. We answer within one month.</p>
    <p>You also have the right to lodge a complaint with a supervisory authority, such as the CNIL in France (<a href="https://www.cnil.fr" target="_blank" rel="noopener">cnil.fr</a>) or the authority of your country of residence.</p>
    <h2>9. Security</h2>
    <p>We take reasonable measures to protect your data (restricted access to the server and database, moderation limited to authorised Discord members). No system is perfectly secure, however.</p>
    <h2>10. Children</h2>
    <p>If you are under the age of digital consent in your country (15 in France), please ask a parent or legal guardian before submitting a time. A parent can ask us to delete a child's data at any time.</p>
    <h2>11. Changes</h2>
    <p>We may update this policy. The date of the last update is shown at the top of this page.</p>`);
}

function viewLegal() {
  const L = state.meta.legal;
  legalPage('Legal Notice', `
    <h2>Publisher</h2>
    <p><b>${v(L.owner)}</b><br>${v(L.ownerAddress)}<br>Email: ${mail(L.contactEmail)}</p>
    <p>Publication director: ${v(L.owner)}</p>
    <h2>Hosting</h2>
    <p><b>${v(L.hostName)}</b><br>${v(L.hostAddress)}</p>
    <h2>Nature of the site</h2>
    <p>${esc(L.siteName)} is a free, non-commercial, fan-made community leaderboard. It is not affiliated with, endorsed or sponsored by Nintendo. Mario Kart and Nintendo Switch are trademarks of Nintendo. Track and cup names are used only to identify the leaderboards.</p>
    <h2>User content</h2>
    <p>Times and proofs are submitted by players and reviewed by volunteer moderators before publication. To report content that you believe is unlawful or infringes your rights, contact ${mail(L.contactEmail)} with the link to the page concerned and the reason for your request; it will be handled promptly.</p>
    <h2>Credits</h2>
    <p>World record data: <a href="https://mkwrs.com/mk8dx/" target="_blank" rel="noopener">mkwrs.com</a>.</p>
    <p>Flags: <a href="https://github.com/lipis/flag-icons" target="_blank" rel="noopener">flag-icons</a> (MIT licence). Fonts: Inter and Russo One (SIL Open Font License).</p>
    <p>See also the <a href="#/terms">Terms of Use</a> and the <a href="#/privacy">Privacy Policy</a>.</p>`);
}

function viewPoints() {
  legalPage('How points work', `
    <h2>On a track</h2>
    <p>For each track and engine class, only your <b>best approved time</b> counts. You earn:</p>
    <p style="font-size:17px"><b>points = 1,000 × record time ÷ your time</b></p>
    <ul>
      <li>The record holder gets <b>1,000</b> points.</li>
      <li>A time 1% slower than the record is worth about <b>990</b> points.</li>
      <li>A time 10% slower is worth about <b>909</b> points.</li>
    </ul>
    <p>Every track is worth the same, whether it lasts 1:30 or 2:30.</p>
    <h2>Rankings</h2>
    <ul>
      <li><b>Players</b>: sum of your points on all tracks — being fast <i>and</i> playing many tracks both pay off.</li>
      <li><b>Countries</b>: sum of the points of all players from that country.</li>
      <li><b>Regions</b> (Europe, North America, South America, Asia, Africa, Oceania): sum of the points of all players from that part of the world. Your region is deduced from your country.</li>
    </ul>
    <p>When a new record is set, everyone's points on that track are recalculated.</p>`);
}

// ---------- Router ----------
async function route() {
  const [path, query] = location.hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query || '');
  const parts = (path || '/').split('/').filter(Boolean);
  const section = parts[0] || '';
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active',
    a.dataset.nav === section || `${a.dataset.nav}` === `${section}s`));
  loading();
  try {
    if (!section) await viewHome();
    else if (section === 'tracks') await viewTracks();
    else if (section === 'track') await viewTrack(parts[1], params);
    else if (section === 'players') await viewPlayers(params);
    else if (section === 'player') await viewPlayer(parts[1]);
    else if (section === 'countries') await viewCountries();
    else if (section === 'regions') await viewRegions();
    else if (section === 'submit') viewSubmit(params);
    else if (section === 'terms') viewTerms();
    else if (section === 'privacy') viewPrivacy();
    else if (section === 'legal') viewLegal();
    else if (section === 'points') viewPoints();
    else $app.innerHTML = empty('Page not found', '');
  } catch (err) {
    $app.innerHTML = empty('Error', esc(err.message));
  }
  document.title = `${section ? `${(document.querySelector('.page-head h1')?.textContent || '').trim()} · ` : ''}${state.meta?.legal.siteName || 'MK8DX Times'}`;
  window.scrollTo(0, 0);
}

(async () => {
  state.meta = await api('/api/meta');
  window.addEventListener('hashchange', route);
  route();
})();
