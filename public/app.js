/* MK8DX Chronos — front-end (sans framework) */
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
const num = (n) => Number(n || 0).toLocaleString('fr-FR');
const flag = (code) => (code ? `<img class="flag" src="https://flagcdn.com/w40/${code.toLowerCase()}.png" alt="${esc(code)}" loading="lazy">` : '');
const countryName = (code) => state.meta.countries.find((c) => c.code === code)?.name || code;
const track = (id) => state.meta.tracks.find((t) => t.id === id);
const rank = (r) => `<span class="rank rank-${r <= 3 ? r : 'x'}">${r}</span>`;
const playerLink = (id, name) => `<a class="player-link" href="#/joueur/${id}">${esc(name)}</a>`;
const proofHref = (r) => r.proof_url || (r.proof_file ? `/uploads/${r.proof_file}` : null);
const proofCell = (r) => { const h = proofHref(r); return h ? `<a class="proof" href="${esc(h)}" target="_blank" rel="noopener">Voir ▸</a>` : ''; };
const CUP_COLORS = ['#e5352b', '#ff8a00', '#ffc928', '#a855f7', '#2d8cff', '#ffd34d', '#2ecc71', '#f97316', '#38bdf8', '#eab308', '#22c55e', '#f43f5e',
  '#fbbf24', '#ec4899', '#a3e635', '#60a5fa', '#94a3b8', '#818cf8', '#fb7185', '#34d399', '#c084fc', '#f472b6', '#d97706', '#4ade80'];

function ccToggle() {
  return `<div class="seg" role="group" aria-label="Cylindrée">
    ${['150', '200'].map((c) => `<button data-cc="${c}" class="${state.cc === c ? 'on' : ''}">${c}cc</button>`).join('')}
  </div>`;
}
function bindCc(rerender) {
  $app.querySelectorAll('[data-cc]').forEach((b) => b.addEventListener('click', () => {
    state.cc = b.dataset.cc; localSet('cc', state.cc); rerender();
  }));
}
function countryOptions(selected, placeholder = 'Tous les pays') {
  return `<option value="">${placeholder}</option>${state.meta.countries.map((c) =>
    `<option value="${c.code}" ${c.code === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`;
}
const empty = (title, text) => `<div class="card empty"><b>${title}</b>${text}</div>`;
const loading = () => { $app.innerHTML = '<div class="empty">Chargement…</div>'; };

// ---------- Accueil ----------
async function viewHome() {
  const [recent, s] = await Promise.all([api('/api/recent'), api('/api/stats')]);
  $app.innerHTML = `
    <section class="hero">
      <div class="card hero-main">
        <h1>Le classement <span>contre-la-montre</span><br>Mario Kart 8 Deluxe</h1>
        <p>Envoie tes meilleurs temps en 150cc et 200cc sur les 96 circuits. Chaque chrono est vérifié par l'équipe de modération avant d'apparaître au classement.</p>
        <div class="toolbar">
          <a class="btn btn-primary" href="#/soumettre">Soumettre un chrono</a>
          <a class="btn" href="#/circuits">Voir les circuits</a>
        </div>
      </div>
      <div class="stats">
        <div class="card stat"><b>${num(s.players)}</b><span>joueurs classés</span></div>
        <div class="card stat"><b>${num(s.approved)}</b><span>chronos validés</span></div>
        <div class="card stat"><b>${num(s.countries)}</b><span>pays représentés</span></div>
        <div class="card stat"><b>${num(s.pending)}</b><span>en attente de vérification</span></div>
      </div>
    </section>
    <h2 class="section-title">Derniers chronos validés</h2>
    ${recent.length ? `<div class="card table-wrap"><table>
      <thead><tr><th>Joueur</th><th>Circuit</th><th>Cylindrée</th><th class="num">Temps</th></tr></thead>
      <tbody>${recent.map((r) => `<tr>
        <td>${flag(r.country)}${playerLink(r.player_id, r.name)}</td>
        <td><a class="player-link" href="#/circuit/${r.track_id}">${esc(track(r.track_id)?.name)}</a></td>
        <td><span class="pill pill-cc">${r.cc}cc</span></td>
        <td class="num time">${fmt(r.time_ms)}</td></tr>`).join('')}</tbody></table></div>`
    : empty('Aucun chrono pour le moment', 'Sois le premier à soumettre un temps !')}`;
}

// ---------- Circuits ----------
async function viewTracks() {
  const records = await api(`/api/records?cc=${state.cc}`);
  const wr = Object.fromEntries(records.map((r) => [r.track_id, r]));
  const byCup = state.meta.cups.map((cup, i) => ({ cup, i, tracks: state.meta.tracks.filter((t) => t.cupIndex === i) }));
  $app.innerHTML = `
    <div class="page-head"><div><h1>Circuits</h1><p>Record actuel de chaque circuit. Clique pour voir le classement complet.</p></div>
      <div class="toolbar"><input id="q" type="search" placeholder="Rechercher un circuit…">${ccToggle()}</div></div>
    <div id="cups">${byCup.map(({ cup, i, tracks }) => `
      <section class="cup" data-cup>
        <h3><span style="color:${CUP_COLORS[i]}">●</span>${esc(cup)}${i >= 12 ? ' <span class="pill">Pass</span>' : ''}</h3>
        <div class="tracks">${tracks.map((t) => {
          const r = wr[t.id];
          return `<a class="track" href="#/circuit/${t.id}" style="--c:${CUP_COLORS[i]}" data-name="${esc(t.name.toLowerCase())}">
            <span class="track-name">${esc(t.name)}</span>
            <span class="track-wr">${r ? `<span>${flag(r.country)}${esc(r.name)}</span><span class="time">${fmt(r.time_ms)}</span>` : '<span>Aucun temps</span>'}</span>
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
  if (!t) { $app.innerHTML = empty('Circuit introuvable', ''); return; }
  const country = params.get('country') || '';
  const region = params.get('region') || '';
  const qs = new URLSearchParams({ cc: state.cc, country, region });
  const rows = await api(`/api/leaderboard/track/${id}?${qs}`);
  const regions = country ? await api(`/api/regions?country=${country}`) : [];
  const top = rows.slice(0, 3);
  $app.innerHTML = `
    <div class="page-head"><div><p><a class="player-link" href="#/circuits">← Circuits</a> · ${esc(t.cup)}</p><h1>${esc(t.name)}</h1></div>
      <div class="toolbar">
        <select id="country">${countryOptions(country)}</select>
        <select id="region" ${country ? '' : 'disabled'}><option value="">Toutes les régions</option>${regions.map((r) => `<option ${r === region ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
        ${ccToggle()}
      </div></div>
    ${rows.length >= 3 ? `<div class="podium">${[1, 0, 2].map((i) => `<div class="card ${i === 0 ? 'p1' : ''}">
        ${rank(i + 1)}<div class="name">${flag(top[i].country)}${playerLink(top[i].player_id, top[i].name)}</div>
        <div class="time">${fmt(top[i].time_ms)}</div><div class="gap">${gap(top[i].time_ms, top[0].time_ms) || 'Record'}</div></div>`).join('')}</div>` : ''}
    ${rows.length ? `<div class="card table-wrap"><table>
      <thead><tr><th>#</th><th>Joueur</th><th class="hide-sm">Région</th><th class="num">Temps</th><th class="num hide-sm">Écart</th><th class="num">Points</th><th>Preuve</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr>
        <td>${rank(country ? i + 1 : r.world_rank)}</td>
        <td>${flag(r.country)}${playerLink(r.player_id, r.name)}${country && r.world_rank ? ` <span class="pill">${r.world_rank}e mondial</span>` : ''}</td>
        <td class="hide-sm muted">${esc(r.region || '—')}</td>
        <td class="num time">${fmt(r.time_ms)}</td>
        <td class="num gap hide-sm">${gap(r.time_ms, rows[0].time_ms)}</td>
        <td class="num">${num(r.points)}</td>
        <td>${proofCell(r)}</td></tr>`).join('')}</tbody></table></div>`
    : empty('Aucun temps validé', `Pas encore de chrono en ${state.cc}cc${country ? ' pour ce filtre' : ''}. <a href="#/soumettre?track=${id}">Soumets le tien !</a>`)}`;
  bindCc(() => route());
  const update = (c, r) => { const p = new URLSearchParams(); if (c) p.set('country', c); if (r) p.set('region', r); location.hash = `#/circuit/${id}${p.size ? `?${p}` : ''}`; };
  $app.querySelector('#country').addEventListener('change', (e) => update(e.target.value, ''));
  $app.querySelector('#region').addEventListener('change', (e) => update(country, e.target.value));
}

// ---------- Joueurs ----------
async function viewPlayers(params) {
  const country = params.get('country') || '';
  const region = params.get('region') || '';
  const rows = await api(`/api/leaderboard/players?${new URLSearchParams({ cc: state.cc, country, region })}`);
  const regions = country ? await api(`/api/regions?country=${country}`) : [];
  $app.innerHTML = `
    <div class="page-head"><div><h1>Classement joueurs</h1><p>Somme des points sur tous les circuits (1000 pts par record).</p></div>
      <div class="toolbar">
        <select id="country">${countryOptions(country)}</select>
        <select id="region" ${country ? '' : 'disabled'}><option value="">Toutes les régions</option>${regions.map((r) => `<option ${r === region ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
        ${ccToggle()}
      </div></div>
    ${rows.length ? `<div class="card table-wrap"><table>
      <thead><tr><th>#</th><th>Joueur</th><th class="hide-sm">Région</th><th class="num">Circuits</th><th class="num">Records</th><th class="num">Points</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr>
        <td>${rank(i + 1)}</td>
        <td>${flag(r.country)}${playerLink(r.player_id, r.name)}</td>
        <td class="hide-sm muted">${esc(r.region || '—')}</td>
        <td class="num">${r.tracks}/96</td>
        <td class="num">${r.records ? `<span class="pill pill-wr">🏆 ${r.records}</span>` : '0'}</td>
        <td class="num time">${num(r.points)}</td></tr>`).join('')}</tbody></table></div>`
    : empty('Aucun joueur classé', 'Aucun chrono validé pour ce filtre.')}`;
  bindCc(() => route());
  const update = (c, r) => { const p = new URLSearchParams(); if (c) p.set('country', c); if (r) p.set('region', r); location.hash = `#/joueurs${p.size ? `?${p}` : ''}`; };
  $app.querySelector('#country').addEventListener('change', (e) => update(e.target.value, ''));
  $app.querySelector('#region').addEventListener('change', (e) => update(country, e.target.value));
}

async function viewPlayer(id) {
  const { player, records } = await api(`/api/players/${id}`);
  const list = records.filter((r) => String(r.cc) === state.cc);
  const pts = list.reduce((a, r) => a + r.points, 0);
  const wrs = list.filter((r) => r.world_rank === 1).length;
  $app.innerHTML = `
    <div class="page-head"><div class="profile-head">
        <div class="avatar">${esc(player.name[0].toUpperCase())}</div>
        <div><h1>${esc(player.name)}</h1><p>${flag(player.country)}${esc(countryName(player.country))}${player.region ? ` · ${esc(player.region)}` : ''}</p></div>
      </div>${ccToggle()}</div>
    <div class="stats" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
      <div class="card stat"><b>${num(pts)}</b><span>points ${state.cc}cc</span></div>
      <div class="card stat"><b>${list.length}/96</b><span>circuits joués</span></div>
      <div class="card stat"><b>${wrs}</b><span>records</span></div>
    </div>
    ${list.length ? `<div class="card table-wrap"><table>
      <thead><tr><th>Circuit</th><th class="hide-sm">Coupe</th><th class="num">Temps</th><th class="num">Rang</th><th class="num hide-sm">Écart record</th><th class="num">Points</th><th>Preuve</th></tr></thead>
      <tbody>${list.map((r) => `<tr>
        <td><a class="player-link" href="#/circuit/${r.track_id}">${esc(track(r.track_id)?.name)}</a></td>
        <td class="hide-sm muted">${esc(track(r.track_id)?.cup)}</td>
        <td class="num time">${fmt(r.time_ms)}</td>
        <td class="num">${r.world_rank === 1 ? '<span class="pill pill-wr">🏆 Record</span>' : `${r.world_rank}/${r.total}`}</td>
        <td class="num gap hide-sm">${gap(r.time_ms, r.wr_ms) || '—'}</td>
        <td class="num">${num(r.points)}</td>
        <td>${proofCell(r)}</td></tr>`).join('')}</tbody></table></div>`
    : empty(`Aucun temps en ${state.cc}cc`, 'Ce joueur n\'a pas encore de chrono validé dans cette cylindrée.')}`;
  bindCc(() => route());
}

// ---------- Pays & Régions ----------
async function viewCountries() {
  const rows = await api(`/api/leaderboard/countries?cc=${state.cc}`);
  $app.innerHTML = `
    <div class="page-head"><div><h1>Classement par pays</h1><p>Somme des points de tous les joueurs du pays.</p></div>${ccToggle()}</div>
    ${rows.length ? `<div class="card table-wrap"><table>
      <thead><tr><th>#</th><th>Pays</th><th class="num">Joueurs</th><th class="num">Records</th><th class="hide-sm">Meilleur joueur</th><th class="num">Points</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr>
        <td>${rank(i + 1)}</td>
        <td><a class="player-link" href="#/joueurs?country=${r.country}">${flag(r.country)}${esc(countryName(r.country))}</a></td>
        <td class="num">${r.players}</td>
        <td class="num">${r.records ? `<span class="pill pill-wr">🏆 ${r.records}</span>` : '0'}</td>
        <td class="hide-sm">${esc(r.top_player)}</td>
        <td class="num time">${num(r.points)}</td></tr>`).join('')}</tbody></table></div>`
    : empty('Aucun pays classé', 'Aucun chrono validé pour le moment.')}`;
  bindCc(viewCountries);
}

async function viewRegions(params) {
  const country = params.get('country') || '';
  const rows = await api(`/api/leaderboard/regions?${new URLSearchParams({ cc: state.cc, country })}`);
  $app.innerHTML = `
    <div class="page-head"><div><h1>Classement par région</h1><p>Somme des points des joueurs de chaque région.</p></div>
      <div class="toolbar"><select id="country">${countryOptions(country)}</select>${ccToggle()}</div></div>
    ${rows.length ? `<div class="card table-wrap"><table>
      <thead><tr><th>#</th><th>Région</th><th class="hide-sm">Pays</th><th class="num">Joueurs</th><th class="num">Records</th><th class="hide-sm">Meilleur joueur</th><th class="num">Points</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr>
        <td>${rank(i + 1)}</td>
        <td>${r.region === '—' ? '<span class="muted">Non renseignée</span>'
          : `<a class="player-link" href="#/joueurs?country=${r.country}&region=${encodeURIComponent(r.region)}">${esc(r.region)}</a>`}</td>
        <td class="hide-sm">${flag(r.country)}${esc(countryName(r.country))}</td>
        <td class="num">${r.players}</td>
        <td class="num">${r.records ? `<span class="pill pill-wr">🏆 ${r.records}</span>` : '0'}</td>
        <td class="hide-sm">${esc(r.top_player)}</td>
        <td class="num time">${num(r.points)}</td></tr>`).join('')}</tbody></table></div>`
    : empty('Aucune région classée', 'Aucun chrono validé pour ce filtre.')}`;
  bindCc(() => route());
  $app.querySelector('#country').addEventListener('change', (e) => { location.hash = `#/regions${e.target.value ? `?country=${e.target.value}` : ''}`; });
}

// ---------- Formulaire ----------
function viewSubmit(params) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem('player') || '{}'); } catch { return {}; } })();
  const preTrack = params.get('track') || '';
  $app.innerHTML = `
    <div class="page-head"><div><h1>Soumettre un chrono</h1><p>Ton temps sera vérifié par un modérateur sur Discord avant d'apparaître au classement.</p></div></div>
    <form id="form" class="card card-pad form-card" novalidate>
      <div id="msg"></div>
      <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <div class="row">
        <div class="field"><label for="player_name">Pseudo</label><input id="player_name" name="player_name" required maxlength="32" value="${esc(saved.player_name || '')}" placeholder="Ton pseudo"></div>
        <div class="field"><label for="countrySel">Pays</label><select id="countrySel" name="country" required>${countryOptions(saved.country || 'FR', 'Choisis ton pays')}</select></div>
      </div>
      <div class="field"><label for="region">Région <span class="muted">(optionnel)</span></label>
        <input id="region" name="region" list="regions" maxlength="60" value="${esc(saved.region || '')}" placeholder="Ex : Île-de-France"><datalist id="regions"></datalist></div>
      <div class="row">
        <div class="field"><label for="track_id">Circuit</label><select id="track_id" name="track_id" required>
          <option value="">Choisis un circuit</option>
          ${state.meta.cups.map((cup, i) => `<optgroup label="${esc(cup)}">${state.meta.tracks.filter((t) => t.cupIndex === i)
            .map((t) => `<option value="${t.id}" ${t.id === preTrack ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</optgroup>`).join('')}
        </select></div>
        <div class="field"><label>Cylindrée</label>
          <div class="seg" id="ccSeg">${['150', '200'].map((c) => `<button type="button" data-v="${c}" class="${state.cc === c ? 'on' : ''}">${c}cc</button>`).join('')}</div>
          <input type="hidden" name="cc" value="${state.cc}"></div>
      </div>
      <div class="field"><label for="time">Temps</label><input id="time" name="time" required placeholder="1:45.123" inputmode="decimal" pattern="\\d{1,2}:[0-5]\\d\\.\\d{3}">
        <div class="hint">Format minutes:secondes.millièmes — ex : 1:45.123</div></div>
      <div class="field"><label>Preuve</label>
        <div class="proof-switch seg" id="proofSeg"><button type="button" data-p="url" class="on">Lien</button><button type="button" data-p="file">Fichier</button></div>
        <div id="proofUrl"><input name="proof_url" type="url" placeholder="https://youtu.be/… ou https://twitter.com/…"></div>
        <label id="proofFile" class="dropzone" style="display:none"><input type="file" name="proof_file" accept="image/*,video/*">
          <span id="fileLabel">Glisse une capture ou une vidéo ici, ou clique pour choisir (max 50 Mo)</span></label>
        <div class="hint">Capture d'écran du fantôme / de l'écran de fin, ou vidéo YouTube, Twitch, Twitter…</div></div>
      <div class="field"><label for="comment">Commentaire <span class="muted">(optionnel)</span></label><textarea id="comment" name="comment" rows="2" maxlength="500" placeholder="Combo utilisé, infos utiles…"></textarea></div>
      <button class="btn btn-primary" id="sendBtn" type="submit">Envoyer pour vérification</button>
    </form>`;

  const form = $app.querySelector('#form');
  const countrySel = form.querySelector('#countrySel');
  const loadRegions = async () => {
    const list = countrySel.value ? await api(`/api/regions?country=${countrySel.value}`) : [];
    form.querySelector('#regions').innerHTML = list.map((r) => `<option value="${esc(r)}">`).join('');
  };
  countrySel.addEventListener('change', loadRegions); loadRegions();

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
  const showFile = () => { form.querySelector('#fileLabel').textContent = fileInput.files[0] ? `📎 ${fileInput.files[0].name}` : 'Glisse une capture ou une vidéo ici'; };
  fileInput.addEventListener('change', showFile);
  ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('drag')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); fileInput.files = e.dataTransfer.files; showFile(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = form.querySelector('#msg'); const btn = form.querySelector('#sendBtn');
    const fd = new FormData(form);
    if (proofMode === 'url') fd.delete('proof_file'); else fd.delete('proof_url');
    if (!/^\d{1,2}:[0-5]\d[.,]\d{3}$/.test(fd.get('time').trim())) {
      msg.innerHTML = '<div class="alert alert-err">Temps invalide. Format attendu : 1:45.123</div>'; return;
    }
    btn.disabled = true; btn.textContent = 'Envoi…';
    try {
      const r = await fetch('/api/submissions', { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      localSet('player', JSON.stringify({ player_name: fd.get('player_name'), country: fd.get('country'), region: fd.get('region') }));
      msg.innerHTML = `<div class="alert alert-ok">✅ Chrono <b>${esc(data.time)}</b> envoyé (soumission #${data.id}). Il apparaîtra au classement dès qu'un modérateur l'aura validé.</div>`;
      form.time.value = ''; form.proof_url.value = ''; fileInput.value = ''; showFile(); form.comment.value = '';
      msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      msg.innerHTML = `<div class="alert alert-err">${esc(err.message)}</div>`;
    } finally { btn.disabled = false; btn.textContent = 'Envoyer pour vérification'; }
  });
}

// ---------- Routeur ----------
async function route() {
  const [path, query] = location.hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query || '');
  const parts = (path || '/').split('/').filter(Boolean);
  const section = parts[0] || '';
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active',
    a.dataset.nav === section || (a.dataset.nav === 'circuits' && section === 'circuit') || (a.dataset.nav === 'joueurs' && section === 'joueur')));
  loading();
  try {
    if (!section) await viewHome();
    else if (section === 'circuits') await viewTracks();
    else if (section === 'circuit') await viewTrack(parts[1], params);
    else if (section === 'joueurs') await viewPlayers(params);
    else if (section === 'joueur') await viewPlayer(parts[1]);
    else if (section === 'pays') await viewCountries();
    else if (section === 'regions') await viewRegions(params);
    else if (section === 'soumettre') viewSubmit(params);
    else $app.innerHTML = empty('Page introuvable', '');
  } catch (err) {
    $app.innerHTML = empty('Erreur', esc(err.message));
  }
  window.scrollTo(0, 0);
}

(async () => {
  state.meta = await api('/api/meta');
  window.addEventListener('hashchange', route);
  route();
})();
