/* MK8DX Times — browser code: navigation without reload, filters, submission form and Discord verification.
   Pages are rendered by render.js, the same code the server uses to send complete HTML to search engines. */
const $app = document.getElementById('app');
const meta = JSON.parse(document.getElementById('site-meta').textContent);
const R = window.MK8Render(meta);
const { esc, url } = R;
const { DISCORD_ICON } = R;

// ---------- Cookie consent ----------
// The choice itself is stored in the browser (that storage is allowed without consent) and asked again after 6 months.
const CONSENT_KEY = 'cookieConsent';
const CONSENT_DAYS = 180;
const OPTIONAL_KEYS = ['player', 'discordJoined']; // remembered only if cookies are accepted
const consent = {
  get() {
    try {
      const c = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null');
      if (!c || Date.now() - c.at > CONSENT_DAYS * 86400000) return null;
      return c.value;
    } catch { return null; }
  },
  set(value) {
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ value, at: Date.now() })); } catch { /* ignore */ }
  },
};

function localGet(k, d) { try { return localStorage.getItem(k) || d; } catch { return d; } }
function localSet(k, v) {
  if (OPTIONAL_KEYS.includes(k) && consent.get() !== 'accepted') return;
  try { localStorage.setItem(k, v); } catch { /* ignore */ }
}
const session = {
  get(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
};

// ---------- Logged-in user (login with Discord) ----------
let me = { user: null };
let mePromise = null;
function loadMe() {
  mePromise = fetch('/api/me', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => ({ user: null }))
    .then((m) => { me = m; updateAccountLink(); return m; });
  return mePromise;
}
function updateAccountLink() {
  const a = document.getElementById('accountLink');
  if (!a) return;
  let adminLink = document.getElementById('adminLink');
  if (me.isAdmin && !adminLink) {
    adminLink = document.createElement('a');
    adminLink.id = 'adminLink'; adminLink.href = '/admin'; adminLink.dataset.nav = 'admin'; adminLink.textContent = 'Admin';
    document.getElementById('nav').appendChild(adminLink);
  } else if (!me.isAdmin && adminLink) {
    adminLink.remove();
  }
  if (me.user) {
    const label = me.player ? me.player.name : me.user.name;
    a.innerHTML = `${me.user.avatar ? `<img src="${esc(me.user.avatar)}" alt="" width="28" height="28">` : ''}<span>${esc(label)}</span>`;
    a.classList.add('logged');
    a.setAttribute('aria-label', 'My account');
  } else {
    a.textContent = 'Log in';
    a.classList.remove('logged');
    a.removeAttribute('aria-label');
  }
}
async function postJson(href, body) {
  const r = await fetch(href, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

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
  // Logging in sets a cookie: only once cookies are accepted
  const login = e.target.closest('a[href^="/auth/discord"]');
  if (login && consent.get() !== 'accepted') {
    e.preventDefault();
    showCookieBanner({ reason: 'login', next: login.getAttribute('href') });
    return;
  }
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (a.target || a.hasAttribute('download')) return;
  const href = a.getAttribute('href');
  if (!href.startsWith('/') || href.startsWith('//') || /^\/(api|uploads|flags|fonts|auth)\//.test(href)) return;
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
    await showSubmit(route);
  } else if (route.view === 'account') {
    await viewAccount(route);
  } else if (route.view === 'admin') {
    await viewAdmin();
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

// ---------- Time field ----------
// "145123" -> "1:45.123", "1 45 123" -> "1:45.123"; anything else is left as typed
function normalizeTime(value) {
  const v = String(value || '').trim();
  const digits = v.replace(/\D/g, '');
  if (/^\d{5,6}$/.test(digits) && !/[:.,]/.test(v)) return `${digits.slice(0, -5)}:${digits.slice(-5, -3)}.${digits.slice(-3)}`;
  return v;
}

// On phones and tablets the system keyboard is replaced by our own keypad (digits, ":" and "."):
// some keyboards (e.g. the iPhone decimal pad) have no ":" nor "."
function bindTimeKeypad(input) {
  if (!input || !window.matchMedia('(pointer: coarse)').matches) return;
  input.setAttribute('inputmode', 'none');
  input.setAttribute('autocomplete', 'off');
  const pad = document.createElement('div');
  pad.className = 'time-pad';
  pad.hidden = true;
  pad.setAttribute('role', 'group');
  pad.setAttribute('aria-label', 'Time keypad');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ':', '0', '.'];
  pad.innerHTML = `${keys.map((k) => `<button type="button" data-key="${k}" class="${/\d/.test(k) ? '' : 'sym'}">${k}</button>`).join('')}
    <button type="button" data-key="back" class="back" aria-label="Delete">⌫</button>
    <button type="button" data-key="ok" class="ok">OK</button>`;
  input.closest('.field').insertBefore(pad, input.nextSibling);

  const insert = (text) => {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.setRangeText(text, start, end, 'end');
  };
  const back = () => {
    let start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    if (start === end && start > 0) start -= 1;
    input.setRangeText('', start, end, 'end');
  };
  // Keep the focus (and the caret) in the field while tapping the keys
  pad.addEventListener('pointerdown', (e) => e.preventDefault());
  pad.addEventListener('click', (e) => {
    const key = e.target.closest('[data-key]')?.dataset.key;
    if (!key) return;
    if (key === 'ok') { input.value = normalizeTime(input.value); input.blur(); return; }
    if (key === 'back') back(); else if (input.value.length < 9) insert(key);
    if (navigator.vibrate) navigator.vibrate(8);
  });
  input.addEventListener('focus', () => { pad.hidden = false; });
  input.addEventListener('blur', () => { pad.hidden = true; input.value = normalizeTime(input.value); });
}

// ---------- Track picker (submission form) ----------
function bindTrackPicker(root) {
  const input = root.querySelector('input[name="track_id"]');
  const button = root.querySelector('.tp-button');
  const panel = root.querySelector('.tp-panel');
  const search = root.querySelector('.tp-search');
  const options = [...root.querySelectorAll('.tp-option')];
  const cups = [...root.querySelectorAll('.tp-cup')];
  const emptyRow = root.querySelector('.tp-empty');
  let active = -1;
  const visible = () => options.filter((o) => !o.hidden);

  const setActive = (i) => {
    const list = visible();
    if (!list.length) { active = -1; return; }
    active = (i + list.length) % list.length;
    options.forEach((o) => o.classList.remove('active'));
    list[active].classList.add('active');
    list[active].scrollIntoView({ block: 'nearest' });
    search.setAttribute('aria-activedescendant', list[active].id);
  };
  const filter = () => {
    const q = search.value.trim().toLowerCase();
    options.forEach((o) => { o.hidden = Boolean(q) && !o.dataset.name.includes(q); });
    // Hide cup titles with no visible track
    cups.forEach((c) => {
      let el = c.nextElementSibling; let any = false;
      while (el && el.classList.contains('tp-option')) { if (!el.hidden) any = true; el = el.nextElementSibling; }
      c.hidden = !any;
    });
    emptyRow.hidden = visible().length > 0;
    setActive(0);
  };
  const open = () => {
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    search.value = ''; filter();
    const sel = options.findIndex((o) => o.dataset.id === input.value);
    if (sel >= 0) setActive(visible().indexOf(options[sel]));
    search.focus();
  };
  const close = (focusButton = true) => {
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (focusButton) button.focus();
  };
  const choose = (o) => {
    input.value = o.dataset.id;
    options.forEach((x) => x.setAttribute('aria-selected', String(x === o)));
    root.querySelector('.tp-current').innerHTML = o.innerHTML;
    close();
  };

  button.addEventListener('click', () => (panel.hidden ? open() : close()));
  search.addEventListener('input', filter);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); const o = visible()[active]; if (o) choose(o); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  options.forEach((o) => o.addEventListener('click', () => choose(o)));
  document.addEventListener('click', (e) => { if (!panel.hidden && !root.contains(e.target)) close(false); });
}

// ---------- Submission form ----------
async function showSubmit(route) {
  await mePromise;
  const account = me.user ? me.player : null;
  if (me.user && !me.player) { navigate('/account', { replace: true }); return; }
  const pending = session.get('pendingVerify');
  if (pending && !route.fresh && !account) { viewVerify(pending); return; }
  const saved = (() => { try { return JSON.parse(localGet('player', '{}')); } catch { return {}; } })();
  const p = R.page(route, {}, { saved, account });
  $app.innerHTML = p.html;
  updateHead(p);

  const form = $app.querySelector('#form');
  const countrySel = form.querySelector('#countrySel');
  if (countrySel) {
    const showRegion = () => {
      const c = meta.countries.find((x) => x.code === countrySel.value);
      form.querySelector('#regionHint').textContent = c ? `Region: ${R.regionName(c.region)}` : '';
    };
    countrySel.addEventListener('change', showRegion); showRegion();
  }

  bindTrackPicker(form.querySelector('#trackPicker'));
  bindTimeKeypad(form.querySelector('#time'));

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
    if (!account && !fd.get('country')) return error('Please select your country.');
    if (!fd.get('track_id')) return error('Please select a track.');
    const time = normalizeTime(fd.get('time'));
    form.time.value = time; fd.set('time', time);
    if (!/^\d{1,2}:[0-5]\d[.,]\d{3}$/.test(time)) return error('Invalid time. Expected format: 1:45.123');
    if (!form.accept_terms.checked) return error('You must accept the Terms of Use and the Privacy Policy.');
    btn.disabled = true; btn.textContent = 'Sending…';
    // Open the Discord invite in a new tab. The tab must be opened during the click (popup blockers),
    // so it starts blank and is pointed at the invite once the submission is accepted.
    const invite = meta.legal.discordInvite;
    const tab = !account && invite && !localGet('discordJoined', '') ? window.open('', '_blank') : null;
    try {
      const r = await fetch('/api/submissions', { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      localSet('player', JSON.stringify(account ? { ...saved, cc: Number(fd.get('cc')) }
        : { player_name: fd.get('player_name'), country: fd.get('country'), cc: Number(fd.get('cc')) }));
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
      msg.innerHTML = `<div class="alert alert-ok">✅ Time <b>${esc(data.time)}</b> sent to the moderators (submission #${data.id}).
        It will appear on the leaderboard once approved${account ? ': follow it on <a href="/account">your account page</a>' : ''}.</div>`;
      form.time.value = ''; form.proof_url.value = ''; fileInput.value = ''; showFile(); form.comment.value = '';
      msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      if (tab) tab.close();
      error(err.message);
    } finally { btn.disabled = false; btn.textContent = 'Send for review'; }
  });
}

// ---------- Account page ----------
const LOGIN_ERRORS = {
  cancelled: 'Login cancelled.',
  state: 'The login link expired, please try again.',
  discord: 'Discord did not answer, please try again in a moment.',
  disabled: 'Login with Discord is not configured on this site yet.',
};
const STATUS = { pending: '⏳ Pending', approved: '✅ Approved', rejected: '❌ Rejected' };

async function viewAccount(route) {
  await loadMe();
  document.title = `My account | ${meta.legal.siteName}`;
  const errorBox = route.error && LOGIN_ERRORS[route.error] ? `<div class="alert alert-err">${LOGIN_ERRORS[route.error]}</div>` : '';
  if (route.error) history.replaceState(null, '', '/account');

  if (!me.user) {
    $app.innerHTML = `
    <div class="page-head"><div><h1>My account</h1><p>Log in with your Discord account: it is created automatically the first time.</p></div></div>
    <div class="card card-pad form-card account-card">
      ${errorBox}
      <ul class="perks">
        <li>Submit your times <b>without the <code>/verif</code> step</b></li>
        <li>Follow the review of your submissions</li>
        <li>Change your player name or country, or delete your account at any time</li>
      </ul>
      ${me.loginEnabled === false
    ? '<div class="alert alert-err">Login with Discord is not configured on this site yet.</div>'
    : `<a class="btn btn-discord btn-lg" href="/auth/discord?next=/account">${R.DISCORD_ICON}Log in with Discord</a>`}
      <p class="muted small">We only receive your Discord ID, username and avatar — never your email or password. See the <a href="/privacy">Privacy Policy</a>.</p>
    </div>`;
    return;
  }

  const head = `
    <div class="page-head"><div class="profile-head">
      ${me.user.avatar ? `<img class="discord-avatar" src="${esc(me.user.avatar)}" alt="" width="64" height="64">` : `<div class="avatar" aria-hidden="true">${esc((me.player ? me.player.name : me.user.name)[0].toUpperCase())}</div>`}
      <div><h1>${esc(me.player ? me.player.name : 'Welcome!')}</h1><p>Logged in with Discord as <b>@${esc(me.user.name)}</b></p></div>
    </div><button class="btn" id="logout">Log out</button></div>`;

  if (!me.player) {
    $app.innerHTML = `${head}
    <form id="setup" class="card card-pad form-card" novalidate>
      <h2 class="card-title">Choose your player name</h2>
      <p class="muted">It is shown on the leaderboards. If you already submitted times with <code>/verif</code>, use the same name to get them back.</p>
      <div id="msg"></div>
      <div class="row">
        <div class="field"><label for="name">Player name</label><input id="name" name="name" required maxlength="32" placeholder="Your nickname"></div>
        <div class="field"><label for="country">Country</label><select id="country" name="country" required>${R.countryOptions('', 'Select your country')}</select></div>
      </div>
      <button class="btn btn-primary" type="submit">Create my profile</button>
    </form>`;
    bindLogout();
    $app.querySelector('#setup').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      submitAction(f, '/api/account/setup', { name: f.elements.namedItem('name').value, country: f.elements.namedItem('country').value }, () => navigate('/account', { replace: true }));
    });
    return;
  }

  const p = me.player;
  // Pending and rejected first (they need attention), then the latest approved times
  const subs = me.submissions || [];
  const toCheck = subs.filter((x) => x.status !== 'approved');
  const approved = subs.filter((x) => x.status === 'approved');
  const APPROVED_SHOWN = 10;
  const subRow = (x, hidden) => `<tr${hidden ? ' class="more-row" hidden' : ''}>
        <td><a class="player-link" href="${url.track(x.track_id, x.cc)}">${esc(meta.tracks.find((t) => t.id === x.track_id)?.name || x.track_id)}</a></td>
        <td><span class="pill pill-cc">${x.cc}cc</span></td>
        <td class="num time">${R.fmt(x.time_ms)}</td>
        <td><span class="status status-${x.status}">${STATUS[x.status]}</span>${x.reject_reason ? `<div class="hint">${esc(x.reject_reason)}</div>` : ''}</td>
        <td class="hide-sm muted">${esc((x.reviewed_at || x.created_at).slice(0, 10))}</td></tr>`;
  const counts = [
    toCheck.filter((x) => x.status === 'pending').length && `${toCheck.filter((x) => x.status === 'pending').length} pending`,
    toCheck.filter((x) => x.status === 'rejected').length && `${toCheck.filter((x) => x.status === 'rejected').length} rejected`,
    approved.length && `${approved.length} approved`,
  ].filter(Boolean).join(' · ');
  $app.innerHTML = `${head}
    <div class="account-grid">
      <section class="card card-pad">
        <h2 class="card-title">Profile</h2>
        <p>${R.flag(p.country)}${esc(R.countryName(p.country))} · <a class="player-link" href="${url.player(p.id)}">View my public profile ›</a></p>
        <form id="rename" novalidate>
          <div id="msg-name"></div>
          <label for="name">Player name</label>
          <div class="inline-form"><input id="name" name="name" maxlength="32" value="${esc(p.name)}" ${me.renameAt ? 'disabled' : ''}>
            <button class="btn" type="submit" ${me.renameAt ? 'disabled' : ''}>Rename</button></div>
          <div class="hint">${me.renameAt ? `You can change it again on ${esc(me.renameAt.slice(0, 10))}.` : `Your name can be changed once every ${me.renameDays} days. All your times follow.`}</div>
        </form>
        <form id="country-form" novalidate>
          <div id="msg-country"></div>
          <label for="country">Country</label>
          <div class="inline-form"><select id="country" name="country">${R.countryOptions(p.country, 'Select your country')}</select>
            <button class="btn" type="submit">Save</button></div>
        </form>
      </section>
      <section class="card card-pad">
        <h2 class="card-title">Submit</h2>
        <p class="muted">You're logged in: your times go straight to the moderators, no <code>/verif</code> needed.</p>
        <a class="btn btn-primary" href="/submit">Submit a time</a>
      </section>
    </div>
    <div class="section-row"><h2 class="section-title">My submissions</h2>${counts ? `<span class="muted small">${counts}</span>` : ''}</div>
    ${subs.length ? `<div class="card table-wrap"><table>
      <thead><tr><th>Track</th><th>Class</th><th class="num">Time</th><th>Status</th><th class="hide-sm">Date</th></tr></thead>
      <tbody>${[...toCheck, ...approved].map((x, i) => subRow(x, x.status === 'approved' && i - toCheck.length >= APPROVED_SHOWN)).join('')}</tbody></table>
      ${approved.length > APPROVED_SHOWN ? `<button class="btn show-all" id="showAll" type="button" aria-expanded="false">Show all ${approved.length} approved times</button>` : ''}</div>`
    : '<div class="card empty"><b>No submissions yet</b><a href="/submit">Submit your first time!</a></div>'}
    <section class="card card-pad danger-zone">
      <h2 class="card-title">Delete my account</h2>
      <p>This permanently deletes your profile, <b>all your times</b> (including approved ones and records) and your proof files. This cannot be undone.</p>
      <form id="delete" novalidate>
        <div id="msg-delete"></div>
        <label for="confirm">Type <b>${esc(p.name)}</b> to confirm</label>
        <div class="inline-form"><input id="confirm" name="confirm" autocomplete="off"><button class="btn btn-danger" type="submit">Delete my account</button></div>
      </form>
    </section>`;
  bindLogout();
  $app.querySelector('#showAll')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const open = btn.getAttribute('aria-expanded') !== 'true';
    $app.querySelectorAll('.more-row').forEach((row) => { row.hidden = !open; });
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? 'Show less' : `Show all ${approved.length} approved times`;
    if (!open) btn.closest('.card').scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  $app.querySelector('#rename').addEventListener('submit', (e) => {
    e.preventDefault();
    submitAction(e.target, '/api/account/name', { name: e.target.elements.namedItem('name').value }, () => viewAccount({ view: 'account' }), '#msg-name');
  });
  $app.querySelector('#country-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitAction(e.target, '/api/account/country', { country: e.target.elements.namedItem('country').value }, () => viewAccount({ view: 'account' }), '#msg-country');
  });
  $app.querySelector('#delete').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!window.confirm('Delete your account and all your times? This cannot be undone.')) return;
    submitAction(e.target, '/api/account/delete', { confirm: e.target.elements.namedItem('confirm').value }, async () => {
      session.del('pendingVerify');
      try { localStorage.removeItem('player'); } catch { /* ignore */ }
      await loadMe();
      $app.innerHTML = '<div class="page-head"><div><h1>Account deleted</h1><p>Your profile and all your times have been deleted.</p></div></div><a class="btn" href="/">Back to the home page</a>';
    }, '#msg-delete');
  });
}

async function submitAction(form, href, body, onSuccess, msgSel = '#msg') {
  const msg = form.querySelector(msgSel);
  const buttons = form.querySelectorAll('button');
  buttons.forEach((b) => { b.disabled = true; });
  try {
    await postJson(href, body);
    await onSuccess();
  } catch (err) {
    msg.innerHTML = `<div class="alert alert-err">${esc(err.message)}</div>`;
    buttons.forEach((b) => { b.disabled = false; });
  }
}

function bindLogout() {
  $app.querySelector('#logout').addEventListener('click', async () => {
    try { await postJson('/auth/logout'); } catch { /* ignore */ }
    await loadMe();
    navigate('/');
  });
}

// ---------- Cookie banner ----------
function showCookieBanner({ reason, next } = {}) {
  document.getElementById('cookie-banner')?.remove();
  const current = consent.get();
  const box = document.createElement('div');
  box.id = 'cookie-banner';
  box.className = 'cookie-banner';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-labelledby', 'cookie-title');
  box.innerHTML = `
    <h2 id="cookie-title">🍪 Cookies</h2>
    ${reason === 'login' ? '<p class="cookie-alert">Logging in with Discord needs a login cookie. Accept cookies to continue.</p>' : ''}
    <p>We only use cookies to <b>keep you logged in with Discord</b>, and your browser's storage to <b>remember your player name and country</b> in the form.
      No tracking, no advertising, no statistics.</p>
    <p class="muted small">If you refuse, you can still browse and submit times with <code>/verif</code>, but you can't log in.
      ${current ? `Current choice: <b>${current === 'accepted' ? 'accepted' : 'refused'}</b>. ` : ''}<a href="/privacy#cookies">Learn more</a></p>
    <div class="cookie-actions">
      <button class="btn btn-choice" type="button" data-choice="refused">Refuse</button>
      <button class="btn btn-choice" type="button" data-choice="accepted">Accept</button>
    </div>`;
  document.body.appendChild(box);
  box.querySelector(reason === 'login' ? '[data-choice="accepted"]' : '[data-choice]').focus();
  box.querySelectorAll('[data-choice]').forEach((btn) => btn.addEventListener('click', async () => {
    const value = btn.dataset.choice;
    consent.set(value);
    box.remove();
    if (value === 'accepted') {
      if (next) location.href = next;
      return;
    }
    // Refused: forget what was remembered and log out
    OPTIONAL_KEYS.forEach((k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
    if (me.user) {
      try { await postJson('/auth/logout'); } catch { /* ignore */ }
      await loadMe();
      const route = R.parseRoute(location.pathname, location.search);
      if (route.view === 'account' || route.view === 'submit') render({ scroll: false });
    }
  }));
}

document.getElementById('cookieSettings')?.addEventListener('click', () => showCookieBanner());

// ---------- Admin panel ----------
const nf = (n) => Number(n || 0).toLocaleString('en-US');
const shortDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const ago = (ms) => {
  if (!ms) return '—';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};

// Single-series bar chart (one value per day): thin bars, recessive grid, hover tooltip, table view
// unit: [singular, plural]
const plural = (n, unit) => (n === 1 ? unit[0] : unit[1]);
function barChart(id, title, rows, unit) {
  const W = 720; const H = 220; const pad = { l: 34, r: 8, t: 12, b: 26 };
  const max = Math.max(1, ...rows.map((r) => r.n));
  const step = Math.max(1, Math.ceil(max / 4));
  const top = step * Math.ceil(max / step);
  const iw = W - pad.l - pad.r; const ih = H - pad.t - pad.b;
  const slot = iw / rows.length; const bw = Math.max(2, slot - 2); // 2px gap between bars
  const y = (v) => pad.t + ih - (v / top) * ih;
  const ticks = []; for (let v = 0; v <= top; v += step) ticks.push(v);
  const total = rows.reduce((a, r) => a + r.n, 0);
  const bars = rows.map((r, i) => {
    const x = pad.l + i * slot + 1; const h = (r.n / top) * ih;
    const radius = Math.min(4, bw / 2, h);
    const path = h > 0
      ? `M${x},${pad.t + ih} v${-(h - radius)} q0,${-radius} ${radius},${-radius} h${bw - 2 * radius} q${radius},0 ${radius},${radius} v${h - radius} z`
      : '';
    return `${path ? `<path d="${path}" class="bar"/>` : ''}<rect class="hit" x="${pad.l + i * slot}" y="${pad.t}" width="${slot}" height="${ih}" data-i="${i}"/>`;
  }).join('');
  const labels = rows.map((r, i) => (i % 5 === 4 || i === rows.length - 1)
    ? `<text x="${pad.l + i * slot + slot / 2}" y="${H - 8}" text-anchor="middle">${shortDay(r.day)}</text>` : '').join('');
  return `<figure class="chart card card-pad" id="${id}">
    <figcaption><b>${title}</b><span class="muted small">${nf(total)} in 30 days</span></figcaption>
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}: ${nf(total)} in the last 30 days">
        ${ticks.map((v) => `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
        ${bars}<g class="xlabels">${labels}</g>
      </svg>
      <div class="chart-tip" hidden></div>
    </div>
    <details class="chart-table"><summary>View as table</summary><div class="table-wrap"><table>
      <thead><tr><th>Day</th><th class="num">${esc(unit[1])}</th></tr></thead>
      <tbody>${rows.slice().reverse().map((r) => `<tr><td>${shortDay(r.day)}</td><td class="num">${r.n}</td></tr>`).join('')}</tbody></table></div></details>
  </figure>`;
}

function bindChart(id, rows, unit) {
  const fig = document.getElementById(id);
  const tip = fig.querySelector('.chart-tip');
  const wrap = fig.querySelector('.chart-wrap');
  fig.querySelectorAll('.hit').forEach((hit) => {
    const show = () => {
      const r = rows[Number(hit.dataset.i)];
      fig.querySelectorAll('.hit.on').forEach((h) => h.classList.remove('on'));
      hit.classList.add('on');
      tip.innerHTML = `<b>${r.n}</b> ${esc(plural(r.n, unit))}<span>${shortDay(r.day)}</span>`;
      tip.hidden = false;
      const box = hit.getBoundingClientRect(); const w = wrap.getBoundingClientRect();
      const left = Math.min(Math.max(box.left - w.left + box.width / 2, 50), w.width - 50);
      tip.style.left = `${left}px`;
    };
    hit.addEventListener('mouseenter', show);
    hit.addEventListener('click', show);
  });
  wrap.addEventListener('mouseleave', () => { tip.hidden = true; fig.querySelectorAll('.hit.on').forEach((h) => h.classList.remove('on')); });
}

async function viewAdmin() {
  document.title = `Admin | ${meta.legal.siteName}`;
  const res = await fetch('/api/admin/stats', { credentials: 'same-origin' });
  if (!res.ok) {
    const p = R.page({ view: 'notfound' }, {});
    $app.innerHTML = p.html; updateHead(p);
    return;
  }
  const st = await res.json();
  const tile = (value, label, note) => `<div class="card stat"><b>${nf(value)}</b><span>${label}</span>${note ? `<em>${note}</em>` : ''}</div>`;
  const trackName = (id) => meta.tracks.find((t) => t.id === id)?.name || id;
  const STATUS_LABEL = { pending: '⏳ Pending', approved: '✅ Approved', rejected: '❌ Rejected' };
  $app.innerHTML = `
    <div class="page-head"><div><h1>Admin</h1><p>Updated ${new Date(st.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · only visible to you</p></div>
      <button class="btn" id="refresh" type="button">Refresh</button></div>

    <h2 class="section-title">Logged-in players</h2>
    <div class="stats stats-4">
      ${tile(st.users.online, 'online now', 'active in the last 5 min')}
      ${tile(st.users.active24h, 'active in 24 h')}
      ${tile(st.users.logins24h, 'logins in 24 h')}
      ${tile(st.users.sessions, 'with an open session')}
    </div>

    <h2 class="section-title">Accounts</h2>
    <div class="stats stats-4">
      ${tile(st.accounts.total, 'accounts')}
      ${tile(st.accounts.new24h, 'new in 24 h')}
      ${tile(st.accounts.new7d, 'new in 7 days')}
      ${tile(st.accounts.new30d, 'new in 30 days')}
    </div>

    <h2 class="section-title">Times</h2>
    <div class="stats stats-4">
      ${tile(st.submissions.new24h, 'submitted in 24 h', `${nf(st.submissions.new7d)} in 7 days`)}
      ${tile(st.submissions.pending, 'awaiting review', st.submissions.unverified ? `+ ${nf(st.submissions.unverified)} not verified yet` : '')}
      ${tile(st.submissions.approved, 'approved', `${nf(st.submissions.approved7d)} in 7 days`)}
      ${tile(st.submissions.rejected, 'rejected')}
    </div>
    <p class="muted small">Leaderboard: ${nf(st.leaderboard.players)} ranked players from ${nf(st.leaderboard.countries)} countries · ${nf(st.submissions.total)} submissions in total.</p>

    <div class="charts">
      ${barChart('chart-subs', 'Times submitted per day', st.perDay.submissions, ['time', 'times'])}
      ${barChart('chart-accounts', 'New accounts per day', st.perDay.accounts, ['account', 'accounts'])}
    </div>

    <div class="account-grid admin-grid">
      <section>
        <h2 class="section-title">Latest accounts</h2>
        ${st.latestAccounts.length ? `<div class="card table-wrap"><table>
          <thead><tr><th>Player</th><th class="hide-sm">Discord</th><th>Created</th><th class="hide-sm">Last seen</th></tr></thead>
          <tbody>${st.latestAccounts.map((a) => `<tr>
            <td>${R.flag(a.country)}<a class="player-link" href="${url.player(a.id)}">${esc(a.name)}</a></td>
            <td class="hide-sm muted">${a.discord_name ? `@${esc(a.discord_name)}` : '—'}</td>
            <td class="muted">${esc((a.created || '').slice(0, 10))}</td>
            <td class="hide-sm muted">${ago(a.last_seen)}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="card empty"><b>No accounts yet</b></div>'}
      </section>
      <section>
        <h2 class="section-title">Most submitted tracks <span class="muted small">(30 days)</span></h2>
        ${st.topTracks.length ? `<div class="card table-wrap"><table>
          <thead><tr><th>Track</th><th>Class</th><th class="num">Times</th></tr></thead>
          <tbody>${st.topTracks.map((t) => `<tr><td><a class="player-link" href="${url.track(t.track_id, t.cc)}">${esc(trackName(t.track_id))}</a></td>
            <td><span class="pill pill-cc">${t.cc}cc</span></td><td class="num">${t.n}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="card empty"><b>No submissions in 30 days</b></div>'}
      </section>
    </div>

    <h2 class="section-title">Latest submissions</h2>
    ${st.latestSubmissions.length ? `<div class="card table-wrap"><table>
      <thead><tr><th>#</th><th>Player</th><th>Track</th><th class="num">Time</th><th>Status</th><th class="hide-sm">Sent</th></tr></thead>
      <tbody>${st.latestSubmissions.map((x) => `<tr>
        <td class="muted">${x.id}</td>
        <td>${R.flag(x.country)}${esc(x.player_name)}${x.discord_name ? ` <span class="muted small">@${esc(x.discord_name)}</span>` : ''}</td>
        <td><a class="player-link" href="${url.track(x.track_id, x.cc)}">${esc(trackName(x.track_id))}</a> <span class="pill pill-cc">${x.cc}cc</span></td>
        <td class="num time">${R.fmt(x.time_ms)}</td>
        <td><span class="status status-${x.status}">${x.status === 'pending' && !x.verified ? '🔒 Not verified' : STATUS_LABEL[x.status]}</span></td>
        <td class="hide-sm muted">${esc(x.created_at.slice(0, 16))}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="card empty"><b>No submissions yet</b></div>'}`;
  bindChart('chart-subs', st.perDay.submissions, ['time', 'times']);
  bindChart('chart-accounts', st.perDay.accounts, ['account', 'accounts']);
  $app.querySelector('#refresh').addEventListener('click', () => viewAdmin());
}

// ---------- Start ----------
// The server already sent the complete page: only the interactions are attached
(function start() {
  loadMe();
  if (!consent.get()) showCookieBanner();
  const route = R.parseRoute(location.pathname, location.search);
  delete $app.dataset.ssr;
  if (route.view === 'submit') showSubmit(route);
  else if (route.view === 'account') viewAccount(route);
  else if (route.view === 'admin') viewAdmin();
  else if (!route.redirect) bind(route);
}());
