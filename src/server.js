require('dotenv').config({ quiet: true });
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const store = require('./db');
const discord = require('./discord');
const webhook = require('./webhook');
const { TRACKS, TRACK_BY_ID, CUPS } = require('./tracks');
const { COUNTRIES, COUNTRY_BY_CODE, REGIONS, REGION_BY_ID } = require('./countries');

const PORT = Number(process.env.PORT || 3000);
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 50);
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Information displayed on the legal pages (set them in .env)
const LEGAL = {
  siteName: process.env.SITE_NAME || 'MK8DX Times',
  // URL shown on the legal pages; falls back to PUBLIC_URL
  siteUrl: (process.env.LEGAL_SITE_URL || process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, ''),
  owner: process.env.LEGAL_OWNER_NAME || '[Publisher name]',
  ownerAddress: process.env.LEGAL_OWNER_ADDRESS || '[Postal address]',
  contactEmail: process.env.LEGAL_CONTACT_EMAIL || '[contact@example.com]',
  hostName: process.env.LEGAL_HOST_NAME || '[Hosting provider]',
  hostAddress: process.env.LEGAL_HOST_ADDRESS || '[Hosting provider address]',
  discordInvite: process.env.DISCORD_INVITE_URL || '',
  rejectedRetentionDays: Number(process.env.REJECTED_RETENTION_DAYS || 30),
  updated: '2026-11-14',
};

const ALLOWED_EXT = /\.(png|jpe?g|gif|webp|mp4|mov|webm|mkv)$/i;
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_EXT.test(file.originalname)) cb(null, true);
    else cb(new Error('File type not allowed (images or videos only).'));
  },
});

// Simple rate limit: N submissions per IP over a sliding window (kept in memory only, never stored)
const RATE_WINDOW = 10 * 60 * 1000;
const RATE_MAX = Number(process.env.RATE_LIMIT || 10);
function limiter(max) {
  const hits = new Map();
  return (ip) => {
    const now = Date.now();
    const list = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW);
    list.push(now);
    hits.set(ip, list);
    return list.length > max;
  };
}
const rateLimited = limiter(RATE_MAX);
const verifyLimited = limiter(20); // code attempts per IP

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
// Self-hosted flags and fonts: no request is made to third-party servers
app.use('/flags', express.static(path.join(__dirname, '..', 'node_modules', 'flag-icons', 'flags', '4x3'), { maxAge: '30d' }));
app.use('/fonts/inter', express.static(path.join(__dirname, '..', 'node_modules', '@fontsource', 'inter', 'files'), { maxAge: '30d' }));
app.use('/fonts/russo-one', express.static(path.join(__dirname, '..', 'node_modules', '@fontsource', 'russo-one', 'files'), { maxAge: '30d' }));

const ccOf = (v) => (Number(v) === 200 ? 200 : 150);
const clean = (v, max = 100) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, max);

// ---------- Metadata ----------
app.get('/api/meta', (req, res) => {
  res.json({ tracks: TRACKS, cups: CUPS, countries: COUNTRIES, regions: REGIONS, legal: LEGAL });
});

// ---------- Submissions ----------
app.post('/api/submissions', (req, res) => {
  upload.single('proof_file')(req, res, async (err) => {
    const fail = (status, message) => {
      if (req.file) fs.unlink(req.file.path, () => {});
      res.status(status).json({ error: message });
    };
    if (err) return fail(400, err.code === 'LIMIT_FILE_SIZE' ? `File too large (max ${MAX_UPLOAD_MB} MB).` : err.message);
    const b = req.body || {};
    if (b.website) return fail(400, 'Invalid request.'); // anti-spam honeypot
    if (rateLimited(req.ip)) return fail(429, 'Too many submissions, please try again in a few minutes.');

    const playerName = clean(b.player_name, 32);
    const country = clean(b.country, 2).toUpperCase();
    const trackId = clean(b.track_id, 60);
    const cc = Number(b.cc);
    const timeMs = store.parseTime(b.time);
    const proofUrl = clean(b.proof_url, 500) || null;
    const comment = clean(b.comment, 500) || null;

    if (playerName.length < 2) return fail(400, 'Your player name must be at least 2 characters long.');
    if (!COUNTRY_BY_CODE[country]) return fail(400, 'Invalid country.');
    if (!TRACK_BY_ID[trackId]) return fail(400, 'Invalid track.');
    if (cc !== 150 && cc !== 200) return fail(400, 'Invalid engine class (150cc or 200cc).');
    if (!timeMs) return fail(400, 'Invalid time. Expected format: 1:23.456');
    if (timeMs < 30000 || timeMs > 600000) return fail(400, 'Time out of range.');
    if (proofUrl && !/^https?:\/\/\S+$/i.test(proofUrl)) return fail(400, 'The proof link must start with http(s)://');
    if (!proofUrl && !req.file) return fail(400, 'A proof (link or file) is required.');
    if (b.accept_terms !== 'on' && b.accept_terms !== 'true') {
      return fail(400, 'You must accept the Terms of Use and the Privacy Policy.');
    }

    // The submission is only sent to the moderators once the player has verified it with /verif on Discord.
    // Without a configured bot (local tests), it is sent right away.
    const needsVerification = discord.isEnabled();
    const token = needsVerification ? crypto.randomBytes(24).toString('hex') : null;
    const sub = store.createSubmission({
      player_name: playerName, country, track_id: trackId, cc, time_ms: timeMs,
      proof_url: proofUrl, proof_file: req.file ? req.file.filename : null, comment, verify_token: token,
    });

    if (!needsVerification) await sendToModerators(sub);
    res.status(201).json({
      id: sub.id, time: store.formatTime(sub.time_ms), player: sub.player_name,
      verifyRequired: needsVerification, token, discordInvite: LEGAL.discordInvite,
    });
  });
});

async function sendToModerators(sub) {
  try {
    await discord.notifySubmission(sub);
  } catch (e) {
    console.error('[discord] Could not send submission:', e.message);
  }
}

app.post('/api/submissions/:id/verify', async (req, res) => {
  if (verifyLimited(req.ip)) return res.status(429).json({ error: 'Too many attempts, please wait a few minutes.' });
  const code = String(req.body?.code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'The code has 6 digits.' });
  const result = store.verifySubmission(Number(req.params.id), req.body?.token, code);
  if (result.error) return res.status(result.status).json({ error: result.error });
  if (!result.already) {
    await sendToModerators(result.sub);
    discord.notifyPending(result.sub);
  }
  res.json({ ok: true, discordName: result.sub.discord_name });
});

app.get('/api/submissions/:id', (req, res) => {
  const sub = store.getSubmission(Number(req.params.id));
  if (!sub) return res.status(404).json({ error: 'Not found' });
  res.json({ id: sub.id, status: sub.status, track_id: sub.track_id, cc: sub.cc, time_ms: sub.time_ms, reject_reason: sub.reject_reason });
});

// ---------- Leaderboards ----------
const filt = (q) => ({
  country: clean(q.country, 2).toUpperCase() || undefined,
  region: REGION_BY_ID[clean(q.region, 30)] ? clean(q.region, 30) : undefined,
});

app.get('/api/leaderboard/track/:trackId', (req, res) => {
  if (!TRACK_BY_ID[req.params.trackId]) return res.status(404).json({ error: 'Unknown track' });
  res.json(store.trackLeaderboard({ trackId: req.params.trackId, cc: ccOf(req.query.cc), ...filt(req.query) }));
});

app.get('/api/leaderboard/players', (req, res) => {
  res.json(store.playerRanking({ cc: ccOf(req.query.cc), ...filt(req.query) }));
});

app.get('/api/leaderboard/countries', (req, res) => {
  res.json(store.countryRanking({ cc: ccOf(req.query.cc) }));
});

app.get('/api/leaderboard/regions', (req, res) => {
  res.json(store.regionRanking({ cc: ccOf(req.query.cc) }));
});

app.get('/api/players/search', (req, res) => {
  res.json(store.searchPlayers(clean(req.query.q, 32)));
});

app.get('/api/players/:id', (req, res) => {
  const profile = store.playerProfile(Number(req.params.id));
  if (!profile) return res.status(404).json({ error: 'Player not found' });
  res.json(profile);
});

app.get('/api/records', (req, res) => res.json(store.worldRecords({ cc: ccOf(req.query.cc) })));
app.get('/api/stats', (req, res) => res.json(store.stats()));
app.get('/api/recent', (req, res) => res.json(store.recentRecords(12)));

// Data retention: rejected submissions (and their files) are deleted after N days,
// submissions never verified on Discord after 24 hours
function purge() {
  try {
    const files = [...store.purgeRejected(LEGAL.rejectedRetentionDays), ...store.purgeUnverified(24)];
    files.forEach((f) => fs.unlink(path.join(UPLOAD_DIR, path.basename(f)), () => {}));
    if (files.length) console.log(`[purge] ${files.length} proof file(s) of rejected or unverified submissions deleted.`);
  } catch (e) { console.error('[purge]', e.message); }
}
purge();
setInterval(purge, 60 * 60 * 1000).unref();

app.listen(PORT, () => {
  console.log(`🏁 MK8DX Leaderboard running on http://localhost:${PORT}`);
  console.log(`[webhook] Record announcements: ${webhook.isEnabled() ? 'enabled' : 'disabled (DISCORD_RECORDS_WEBHOOK_URL not set)'}`);
  discord.start().catch((e) => console.error('[discord] Could not connect:', e.message));
});
