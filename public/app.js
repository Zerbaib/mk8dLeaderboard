/* MK8DX Times — browser code: navigation without reload, filters, submission form and Discord verification.
   Pages are rendered by render.js, the same code the server uses to send complete HTML to search engines. */
const $app = document.getElementById('app');
const meta = JSON.parse(document.getElementById('site-meta').textContent);
const R = window.MK8Render(meta);
const { esc, url } = R;
const { DISCORD_ICON } = R;

function localGet(k, d) { try { return localStorage.getItem(k) || d; } catch { return d; } }
function localSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
const session = {
  get(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
};

// ---------- Head (title, description, canonical, social previews) ----------
function setMeta(selector, attr, value) {
  const el = document.head.querySelector(selector);
  if (el) el.setAttribute(attr, value);
}
function updateHead(p) {
  document.title = p.title;
  setMeta('meta[name="description"]', 'content', p.description);
  setMeta('link[rel="canonical"]', 'href', p.canonical);
  setMeta('meta[property="og:title"]', 'content', p.title);
  setMeta('meta[property="og:description"]', 'content', p.description);
  setMeta('meta[property="og:url"]', 'content', p.canonical);
  setMeta('meta[name="twitter:title"]', 'content', p.title);
  setMeta('meta[name="twitter:description"]', 'content', p.description);
}
function updateNav(route) {
  const section = { track: 'tracks', player: 'players' }[route.view] || route.view;
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const on = a.dataset.nav === section;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

// ---------- Navigation ----------
function navigate(href, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', href); else history.pushState(null, '', href);
  render({ scroll: !replace });
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (a.target || a.hasAttribute('download')) return;
  const href = a.getAttribute('href');
  if (!href.startsWith('/') || href.startsWith('//') || /^\/(api|uploads|flags|fonts)\//.test(href)) return;
  e.preventDefault();
  if (href !== location.pathname + location.search) navigate(href);
});
window.addEventListener('popstate', () => render({ scroll: false }));

let renderId = 0;
async function render({ scroll = true } = {}) {
  const id = ++renderId;
  let route = R.parseRoute(location.pathname, location.search);
  if (route.redirect) { history.replaceState(null, '', route.redirect); route = R.parseRoute(location.pathname, location.search); }
  updateNav(route);

  if (route.view === 'submit') {
    showSubmit(route);
  } else {
    $app.classList.add('loading');
    let data = {};
    try {
      const res = await fetch(`/api/page?path=${encodeURIComponent(location.pathname + location.search)}`);
      const body = await res.json();
      if (body.redirect) { navigate(body.redirect, { replace: true }); return; }
      if (body.route) route = body.route;
      data = body.data || {};
    } catch (err) {
      if (id !== renderId) return;
      $app.classList.remove('loading');
      $app.innerHTML = `<div class="card empty"><b>Connection error</b>${esc(err.message)}</div>`;
      return;
    }
    if (id !== renderId) return; // a newer navigation started meanwhile
    $app.classList.remove('loading');
    const p = R.page(route, data);
    $app.innerHTML = p.html;
    updateHead(p);
    bind(route);
  }
  if (scroll) window.scrollTo(0, 0);
}

// ---------- Interactions of each page ----------
function bind(route) {
  if (route.view === 'tracks') {
    $app.querySelector('#q').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      $app.querySelectorAll('.track').forEach((el) => { el.style.display = el.dataset.name.includes(q) ? '' : 'none'; });
      $app.querySelectorAll('[data-cup]').forEach((c) => { c.style.display = [...c.querySelectorAll('.track')].some((t) => t.style.display !== 'none') ? '' : 'none'; });
    });
  }
  if (route.view === 'track' || route.view === 'players') {
    const go = (country, region) => navigate(route.view === 'track'
      ? url.track(route.id, route.cc, { country, region })
      : url.players(route.cc, { country, region }));
    $app.querySelector('#country').addEventListener('change', (e) => go(e.target.value, route.region));
    $app.querySelector('#region').addEventListener('change', (e) => go(route.country, e.target.value));
  }
}

// ---------- Discord verification ----------
function viewVerify(p) {
  const invite = p.discordInvite || meta.legal.discordInvite;
  document.title = `Verify your submission | ${meta.legal.siteName}`;
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
        <a href="/submit?new=1" id="vcancel">Cancel and submit another time</a></p>
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
        <a class="btn btn-primary" href="/submit?new=1">Submit another time</a>`;
    } catch (err) {
      msg.innerHTML = `<div class="alert alert-err">${esc(err.message)}</div>`;
      btn.disabled = false; btn.textContent = 'Verify';
    }
  });
}

// ---------- Submission form ----------
function showSubmit(route) {
  const pending = session.get('pendingVerify');
  if (pending && !route.fresh) { viewVerify(pending); return; }
  const saved = (() => { try { return JSON.parse(localStorage.getItem('player') || '{}'); } catch { return {}; } })();
  const p = R.page(route, {}, saved);
  $app.innerHTML = p.html;
  updateHead(p);

  const form = $app.querySelector('#form');
  const countrySel = form.querySelector('#countrySel');
  const showRegion = () => {
    const c = meta.countries.find((x) => x.code === countrySel.value);
    form.querySelector('#regionHint').textContent = c ? `Region: ${R.regionName(c.region)}` : '';
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
    const invite = meta.legal.discordInvite;
    const tab = invite && !localGet('discordJoined', '') ? window.open('', '_blank') : null;
    try {
      const r = await fetch('/api/submissions', { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      localSet('player', JSON.stringify({ player_name: fd.get('player_name'), country: fd.get('country'), cc: Number(fd.get('cc')) }));
      if (data.verifyRequired) {
        if (tab) { tab.opener = null; tab.location.href = invite; }
        const pending = { id: data.id, token: data.token, time: data.time, player: data.player, discordInvite: data.discordInvite };
        session.set('pendingVerify', pending);
        if (location.search) history.replaceState(null, '', '/submit');
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

// ---------- Start ----------
// The server already sent the complete page: only the interactions are attached
(function start() {
  const route = R.parseRoute(location.pathname, location.search);
  delete $app.dataset.ssr;
  if (route.view === 'submit') showSubmit(route);
  else if (!route.redirect) bind(route);
}());
