require('dotenv').config({ quiet: true });
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const store = require('./db');
const discord = require('./discord');
const { TRACKS, TRACK_BY_ID, CUPS } = require('./tracks');
const { COUNTRIES, COUNTRY_BY_CODE, REGION_SUGGESTIONS } = require('./countries');

const PORT = Number(process.env.PORT || 3000);
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 50);
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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
    else cb(new Error('Format de fichier non autorisé (image ou vidéo uniquement).'));
  },
});

// Limitation simple : N soumissions par IP sur une fenêtre glissante
const RATE_WINDOW = 10 * 60 * 1000;
const RATE_MAX = Number(process.env.RATE_LIMIT || 10);
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW);
  list.push(now);
  hits.set(ip, list);
  return list.length > RATE_MAX;
}

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

const ccOf = (v) => (Number(v) === 200 ? 200 : 150);
const clean = (v, max = 100) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, max);

// ---------- Méta-données ----------
app.get('/api/meta', (req, res) => {
  res.json({ tracks: TRACKS, cups: CUPS, countries: COUNTRIES, regionSuggestions: REGION_SUGGESTIONS, stats: store.stats() });
});

app.get('/api/regions', (req, res) => {
  const country = clean(req.query.country, 2).toUpperCase();
  const known = store.knownRegions(country);
  const merged = [...new Set([...(REGION_SUGGESTIONS[country] || []), ...known])].sort((a, b) => a.localeCompare(b, 'fr'));
  res.json(merged);
});

// ---------- Soumission ----------
app.post('/api/submissions', (req, res) => {
  upload.single('proof_file')(req, res, async (err) => {
    const fail = (status, message) => {
      if (req.file) fs.unlink(req.file.path, () => {});
      res.status(status).json({ error: message });
    };
    if (err) return fail(400, err.code === 'LIMIT_FILE_SIZE' ? `Fichier trop lourd (max ${MAX_UPLOAD_MB} Mo).` : err.message);
    const b = req.body || {};
    if (b.website) return fail(400, 'Requête invalide.'); // pot de miel anti-spam
    if (rateLimited(req.ip)) return fail(429, 'Trop de soumissions, réessaie dans quelques minutes.');

    const playerName = clean(b.player_name, 32);
    const country = clean(b.country, 2).toUpperCase();
    const region = clean(b.region, 60) || null;
    const trackId = clean(b.track_id, 60);
    const cc = Number(b.cc);
    const timeMs = store.parseTime(b.time);
    const proofUrl = clean(b.proof_url, 500) || null;
    const comment = clean(b.comment, 500) || null;

    if (playerName.length < 2) return fail(400, 'Le pseudo doit contenir au moins 2 caractères.');
    if (!COUNTRY_BY_CODE[country]) return fail(400, 'Pays invalide.');
    if (!TRACK_BY_ID[trackId]) return fail(400, 'Circuit invalide.');
    if (cc !== 150 && cc !== 200) return fail(400, 'Cylindrée invalide (150cc ou 200cc).');
    if (!timeMs) return fail(400, 'Temps invalide. Format attendu : 1:23.456');
    if (timeMs < 30000 || timeMs > 600000) return fail(400, 'Temps hors limites.');
    if (proofUrl && !/^https?:\/\/\S+$/i.test(proofUrl)) return fail(400, 'Le lien de preuve doit commencer par http(s)://');
    if (!proofUrl && !req.file) return fail(400, 'Une preuve (lien ou fichier) est obligatoire.');

    const sub = store.createSubmission({
      player_name: playerName, country, region, track_id: trackId, cc, time_ms: timeMs,
      proof_url: proofUrl, proof_file: req.file ? req.file.filename : null, comment,
    });

    try {
      await discord.notifySubmission(sub);
    } catch (e) {
      console.error('[discord] Envoi impossible :', e.message);
    }
    res.status(201).json({ id: sub.id, status: sub.status, time: store.formatTime(sub.time_ms) });
  });
});

app.get('/api/submissions/:id', (req, res) => {
  const sub = store.getSubmission(Number(req.params.id));
  if (!sub) return res.status(404).json({ error: 'Introuvable' });
  res.json({ id: sub.id, status: sub.status, track_id: sub.track_id, cc: sub.cc, time_ms: sub.time_ms, reject_reason: sub.reject_reason });
});

// ---------- Classements ----------
const filt = (q) => ({
  country: clean(q.country, 2).toUpperCase() || undefined,
  region: clean(q.region, 60) || undefined,
});

app.get('/api/leaderboard/track/:trackId', (req, res) => {
  if (!TRACK_BY_ID[req.params.trackId]) return res.status(404).json({ error: 'Circuit inconnu' });
  res.json(store.trackLeaderboard({ trackId: req.params.trackId, cc: ccOf(req.query.cc), ...filt(req.query) }));
});

app.get('/api/leaderboard/players', (req, res) => {
  res.json(store.playerRanking({ cc: ccOf(req.query.cc), ...filt(req.query) }));
});

app.get('/api/leaderboard/countries', (req, res) => {
  res.json(store.countryRanking({ cc: ccOf(req.query.cc) }));
});

app.get('/api/leaderboard/regions', (req, res) => {
  res.json(store.regionRanking({ cc: ccOf(req.query.cc), country: filt(req.query).country }));
});

app.get('/api/players/search', (req, res) => {
  res.json(store.searchPlayers(clean(req.query.q, 32)));
});

app.get('/api/players/:id', (req, res) => {
  const profile = store.playerProfile(Number(req.params.id));
  if (!profile) return res.status(404).json({ error: 'Joueur introuvable' });
  res.json(profile);
});

app.get('/api/records', (req, res) => res.json(store.worldRecords({ cc: ccOf(req.query.cc) })));
app.get('/api/stats', (req, res) => res.json(store.stats()));
app.get('/api/recent', (req, res) => res.json(store.recentRecords(12)));

app.listen(PORT, () => {
  console.log(`🏁 MK8DX Leaderboard sur http://localhost:${PORT}`);
  discord.start().catch((e) => console.error('[discord] Connexion impossible :', e.message));
});
