// Login with Discord (OAuth2, "identify" scope only) and account management
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./db');
const { COUNTRY_BY_CODE } = require('./countries');

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const REDIRECT_URI = `${PUBLIC_URL}/auth/discord/callback`;
const SECURE = PUBLIC_URL.startsWith('https://');
const COOKIE = 'mk8_session';
const STATE_COOKIE = 'mk8_oauth';
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

const isEnabled = () => Boolean(CLIENT_ID && CLIENT_SECRET);

// Discord user IDs allowed to see /admin (comma-separated in ADMIN_DISCORD_IDS)
const ADMINS = new Set(String(process.env.ADMIN_DISCORD_IDS || '').split(/[\s,]+/).filter(Boolean));
const isAdmin = (user) => Boolean(user && ADMINS.has(user.discord_id));

// ---------- Cookies ----------
function readCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function setCookie(res, name, value, maxAge) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (SECURE) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

// Adds req.user ({ discord_id, discord_name, discord_avatar }) when logged in
function sessionMiddleware(req, res, next) {
  req.sessionId = readCookies(req)[COOKIE] || null;
  req.user = store.getSession(req.sessionId);
  if (req.user) store.touchSession(req.sessionId);
  next();
}

// Blocks requests coming from other websites (protection against CSRF)
function sameOrigin(req) {
  const origin = req.headers.origin || req.headers.referer || '';
  if (!origin) return false;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

const avatarUrl = (u) => (u.discord_avatar
  ? `https://cdn.discordapp.com/avatars/${u.discord_id}/${u.discord_avatar}.png?size=64` : null);

// Only local paths are accepted as "where to go after login"
const safeNext = (n) => (typeof n === 'string' && /^\/(?!\/)[\w\-/?=&.%]*$/.test(n) ? n : '/account');

function mount(app) {
  app.use(sessionMiddleware);

  // ---------- OAuth2 ----------
  app.get('/auth/discord', (req, res) => {
    if (!isEnabled()) return res.redirect('/account?error=disabled');
    const state = crypto.randomBytes(16).toString('hex');
    setCookie(res, STATE_COOKIE, `${state}|${safeNext(req.query.next)}`, 600);
    const params = new URLSearchParams({
      client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', scope: 'identify', state, prompt: 'none',
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });

  app.get('/auth/discord/callback', async (req, res) => {
    const [state, next] = (readCookies(req)[STATE_COOKIE] || '').split('|');
    setCookie(res, STATE_COOKIE, '', 0);
    if (req.query.error) return res.redirect('/account?error=cancelled');
    if (!state || state !== req.query.state || !req.query.code) return res.redirect('/account?error=state');
    try {
      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'authorization_code',
          code: String(req.query.code), redirect_uri: REDIRECT_URI,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!tokenRes.ok) throw new Error(`token HTTP ${tokenRes.status}`);
      const { access_token: accessToken } = await tokenRes.json();
      const meRes = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000),
      });
      if (!meRes.ok) throw new Error(`users/@me HTTP ${meRes.status}`);
      const me = await meRes.json();
      // The access token is not kept: we only needed the Discord identity
      const session = store.createSession({ id: me.id, name: me.username, avatar: me.avatar });
      setCookie(res, COOKIE, session.id, session.maxAge);
      res.redirect(safeNext(next));
    } catch (e) {
      console.error('[auth] Discord login failed:', e.message);
      res.redirect('/account?error=discord');
    }
  });

  app.post('/auth/logout', (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
    store.deleteSession(req.sessionId);
    setCookie(res, COOKIE, '', 0);
    res.json({ ok: true });
  });

  // ---------- Account API ----------
  app.get('/api/me', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!req.user) return res.json({ user: null, loginEnabled: isEnabled() });
    const info = store.accountInfo(req.user.discord_id);
    res.json({
      user: { id: req.user.discord_id, name: req.user.discord_name, avatar: avatarUrl(req.user) },
      player: info.player && { id: info.player.id, name: info.player.name, country: info.player.country },
      submissions: info.submissions,
      renameAt: info.renameAt,
      renameDays: store.RENAME_COOLDOWN_DAYS,
      loginEnabled: true,
      isAdmin: isAdmin(req.user),
    });
  });

  // Statistics for the admin panel. Anyone else gets a plain 404, as if the page did not exist.
  app.get('/api/admin/stats', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!isAdmin(req.user)) return res.status(404).json({ error: 'Not found' });
    res.json(store.adminStats());
  });

  // All account changes: logged in + same origin
  const guard = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please log in with Discord.' });
    if (!sameOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
  const clean = (v, max) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, max);
  const reply = (res, r) => (r.error ? res.status(400).json({ error: r.error }) : res.json({ ok: true }));

  app.post('/api/account/setup', guard, (req, res) => {
    const country = clean(req.body?.country, 2).toUpperCase();
    if (!COUNTRY_BY_CODE[country]) return res.status(400).json({ error: 'Please select your country.' });
    reply(res, store.setupAccount(req.user.discord_id, clean(req.body?.name, 32), country));
  });

  app.post('/api/account/name', guard, (req, res) => {
    reply(res, store.renameAccount(req.user.discord_id, clean(req.body?.name, 32)));
  });

  app.post('/api/account/country', guard, (req, res) => {
    const country = clean(req.body?.country, 2).toUpperCase();
    if (!COUNTRY_BY_CODE[country]) return res.status(400).json({ error: 'Invalid country.' });
    reply(res, store.setAccountCountry(req.user.discord_id, country));
  });

  app.post('/api/account/delete', guard, (req, res) => {
    const player = store.accountPlayer(req.user.discord_id);
    const expected = player ? player.name : req.user.discord_name;
    if (clean(req.body?.confirm, 64).toLowerCase() !== expected.toLowerCase()) {
      return res.status(400).json({ error: `Type "${expected}" to confirm.` });
    }
    const { deleted, files } = store.deleteAccount(req.user.discord_id);
    files.forEach((f) => fs.unlink(path.join(UPLOAD_DIR, path.basename(f)), () => {}));
    setCookie(res, COOKIE, '', 0);
    console.log(`[auth] Account deleted (${deleted} submission(s)).`);
    res.json({ ok: true, deleted });
  });
}

module.exports = { mount, isEnabled, sameOrigin, isAdmin };
