const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const Database = require('better-sqlite3');
const { TRACKS, TRACK_BY_ID } = require('./tracks');
const { COUNTRIES } = require('./countries');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'leaderboard.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS players (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  country    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS submissions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  player_name        TEXT NOT NULL,
  player_id          INTEGER REFERENCES players(id),
  country            TEXT NOT NULL,
  track_id           TEXT NOT NULL,
  cc                 INTEGER NOT NULL CHECK (cc IN (150, 200)),
  time_ms            INTEGER NOT NULL,
  proof_url          TEXT,
  proof_file         TEXT,
  comment            TEXT,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reject_reason      TEXT,
  reviewed_by        TEXT,
  discord_message_id TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_sub_board ON submissions (track_id, cc, status, time_ms);
CREATE INDEX IF NOT EXISTS idx_sub_player ON submissions (player_id, status);

-- Country -> world region lookup (rebuilt at every start from src/countries.js)
CREATE TABLE IF NOT EXISTS country_regions (
  code   TEXT PRIMARY KEY,
  region TEXT NOT NULL
);
`);

// ---------- Migrations (add columns to databases created by older versions) ----------
function addColumn(table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return !exists;
}
// Discord verification of submissions
addColumn('submissions', 'verify_token', 'TEXT');
addColumn('submissions', 'verify_attempts', 'INTEGER NOT NULL DEFAULT 0');
addColumn('submissions', 'discord_id', 'TEXT');
addColumn('submissions', 'discord_name', 'TEXT');
if (addColumn('submissions', 'verified_at', 'TEXT')) {
  // Submissions made before verification existed are considered verified
  db.exec('UPDATE submissions SET verified_at = created_at');
}
addColumn('players', 'discord_id', 'TEXT');
addColumn('players', 'name_changed_at', 'TEXT');
addColumn('players', 'account_created_at', 'TEXT');
db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_discord ON players (discord_id) WHERE discord_id IS NOT NULL;
-- Login sessions (Discord accounts). Only a hash of the session id is stored.
CREATE TABLE IF NOT EXISTS sessions (
  id_hash        TEXT PRIMARY KEY,
  discord_id     TEXT NOT NULL,
  discord_name   TEXT NOT NULL,
  discord_avatar TEXT,
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_discord ON sessions (discord_id);
CREATE TABLE IF NOT EXISTS verification_codes (
  code         TEXT PRIMARY KEY,
  discord_id   TEXT NOT NULL,
  discord_name TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
`);

addColumn('sessions', 'last_seen', 'INTEGER');
// Small key/value store (e.g. date of the last Discord role sync)
db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)');

db.transaction(() => {
  db.prepare('DELETE FROM country_regions').run();
  const ins = db.prepare('INSERT INTO country_regions (code, region) VALUES (?, ?)');
  COUNTRIES.forEach((c) => ins.run(c.code, c.region));
})();

// ---------- Time helpers ----------
function parseTime(str) {
  const m = /^\s*(\d{1,2}):([0-5]\d)[.,:](\d{3})\s*$/.exec(String(str || ''));
  if (!m) return null;
  const ms = Number(m[1]) * 60000 + Number(m[2]) * 1000 + Number(m[3]);
  return ms > 0 ? ms : null;
}

function formatTime(ms) {
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  const milli = ms % 1000;
  return `${min}:${String(sec).padStart(2, '0')}.${String(milli).padStart(3, '0')}`;
}

// ---------- Submissions ----------
const insertSubmission = db.prepare(`
  INSERT INTO submissions (player_name, country, track_id, cc, time_ms, proof_url, proof_file, comment, verify_token, verified_at)
  VALUES (@player_name, @country, @track_id, @cc, @time_ms, @proof_url, @proof_file, @comment, @verify_token, @verified_at)
`);

// `verify_token` is null for submissions that do not need a Discord verification (imports, bot disabled)
function createSubmission(data) {
  const info = insertSubmission.run({
    verify_token: null, ...data, verified_at: data.verify_token ? null : new Date().toISOString().slice(0, 19).replace('T', ' '),
  });
  return getSubmission(info.lastInsertRowid);
}

// Deletes rejected submissions older than `days` days and returns their proof files to remove
function purgeRejected(days) {
  const rows = db.prepare(`SELECT id, proof_file FROM submissions
    WHERE status = 'rejected' AND reviewed_at < datetime('now', ?)`).all(`-${days} days`);
  const del = db.prepare('DELETE FROM submissions WHERE id = ?');
  db.transaction(() => rows.forEach((r) => del.run(r.id)))();
  return rows.map((r) => r.proof_file).filter(Boolean);
}

// Deletes submissions that were never verified on Discord after `hours` hours
function purgeUnverified(hours) {
  const rows = db.prepare(`SELECT id, proof_file FROM submissions
    WHERE verified_at IS NULL AND status = 'pending' AND created_at < datetime('now', ?)`).all(`-${hours} hours`);
  const del = db.prepare('DELETE FROM submissions WHERE id = ?');
  db.transaction(() => rows.forEach((r) => del.run(r.id)))();
  db.prepare('DELETE FROM verification_codes WHERE expires_at < ?').run(Date.now());
  return rows.map((r) => r.proof_file).filter(Boolean);
}

function getSubmission(id) {
  return db.prepare('SELECT * FROM submissions WHERE id = ?').get(id);
}

// Verified submissions that never reached the moderators (bot was offline)
function unsentSubmissions() {
  return db.prepare(`SELECT * FROM submissions WHERE status = 'pending' AND verified_at IS NOT NULL
    AND discord_message_id IS NULL ORDER BY id`).all();
}

// Links a submission made from a logged-in account to its Discord account
function setSubmissionDiscord(id, discordId, discordName) {
  db.prepare('UPDATE submissions SET discord_id = ?, discord_name = ? WHERE id = ?').run(discordId, discordName, id);
  return getSubmission(id);
}

function setDiscordMessage(id, messageId) {
  db.prepare('UPDATE submissions SET discord_message_id = ? WHERE id = ?').run(messageId, id);
}

const findPlayer = db.prepare('SELECT id, name, discord_id FROM players WHERE name = ?');
const insertPlayer = db.prepare('INSERT INTO players (name, country, discord_id) VALUES (?, ?, ?)');
const updatePlayer = db.prepare('UPDATE players SET country = ?, discord_id = COALESCE(discord_id, ?) WHERE id = ?');
function upsertPlayer(name, country, discordId = null) {
  const existing = findPlayer.get(name);
  if (existing) {
    if (existing.discord_id && discordId && existing.discord_id !== discordId) {
      throw new Error(`The player name "${existing.name}" is linked to another Discord account.`);
    }
    updatePlayer.run(country, discordId, existing.id);
    return existing.id;
  }
  return insertPlayer.run(name, country, discordId).lastInsertRowid;
}

// Number of places that trigger announcements and notifications
const TOP = 10;

const approveTx = db.transaction((id, reviewer) => {
  const sub = getSubmission(id);
  if (!sub) throw new Error('Submission not found');
  if (sub.status !== 'pending') return { sub, changed: false };
  const playerId = upsertPlayer(sub.player_name, sub.country, sub.discord_id);
  // Best time of every player on this track and class, before this approval
  const board = db.prepare(`SELECT p.id, p.name, p.country, p.discord_id, MIN(s.time_ms) AS time_ms
    FROM submissions s JOIN players p ON p.id = s.player_id
    WHERE s.status = 'approved' AND s.track_id = ? AND s.cc = ? GROUP BY p.id`).all(sub.track_id, sub.cc);
  db.prepare(`UPDATE submissions SET status = 'approved', player_id = ?, reviewed_by = ?, reviewed_at = datetime('now')
              WHERE id = ?`).run(playerId, reviewer, id);
  return { sub: getSubmission(id), changed: true, ranking: rankingChange(board, playerId, sub.time_ms) };
});

// What this new time changes in the top 10 of the track, or null if it does not enter it
// (or does not improve the player's best time). { rank, previousRank, total, recordMs, previousRecord, passed, tiedWith }
function rankingChange(board, playerId, timeMs) {
  const rankOf = (t, list) => 1 + list.filter((e) => e.time_ms < t).length;
  const own = board.find((e) => e.id === playerId);
  const others = board.filter((e) => e.id !== playerId);
  if (own && timeMs >= own.time_ms) return null; // not a personal best: the leaderboard does not change
  const rank = rankOf(timeMs, others);
  if (rank > TOP) return null;
  const oldBest = own ? own.time_ms : Infinity;
  const leader = board.reduce((a, e) => (!a || e.time_ms < a.time_ms ? e : a), null);
  const pick = (e) => ({ name: e.name, country: e.country, discord_id: e.discord_id, time_ms: e.time_ms });
  return {
    rank,
    previousRank: own ? rankOf(own.time_ms, board) : null,
    total: others.length + 1,
    recordMs: Math.min(timeMs, ...others.map((e) => e.time_ms)),
    previousRecord: leader ? pick(leader) : null,
    // Players this time overtakes (each goes down one place)
    passed: others.filter((e) => e.time_ms > timeMs && e.time_ms <= oldBest)
      .map((e) => ({ ...pick(e), oldRank: rankOf(e.time_ms, board), newRank: rankOf(e.time_ms, board) + 1 }))
      .filter((e) => e.oldRank <= TOP)
      .sort((a, b) => a.time_ms - b.time_ms),
    tiedWith: others.filter((e) => e.time_ms === timeMs).map(pick),
  };
}

function approveSubmission(id, reviewer) {
  return approveTx(id, reviewer);
}

function rejectSubmission(id, reviewer, reason) {
  const sub = getSubmission(id);
  if (!sub) throw new Error('Submission not found');
  if (sub.status !== 'pending') return { sub, changed: false };
  db.prepare(`UPDATE submissions SET status = 'rejected', reject_reason = ?, reviewed_by = ?, reviewed_at = datetime('now')
              WHERE id = ?`).run(reason || null, reviewer, id);
  return { sub: getSubmission(id), changed: true };
}

// ---------- Discord verification ----------
const CODE_TTL = 10 * 60 * 1000;
const CODE_COOLDOWN = 30 * 1000;
const MAX_ATTEMPTS = 5;

// Creates a 6-digit code for a Discord user (replaces their previous one)
function issueCode(discordId, discordName) {
  const now = Date.now();
  const last = db.prepare('SELECT created_at FROM verification_codes WHERE discord_id = ?').get(discordId);
  if (last && now - last.created_at < CODE_COOLDOWN) {
    return { cooldown: Math.ceil((CODE_COOLDOWN - (now - last.created_at)) / 1000) };
  }
  return db.transaction(() => {
    db.prepare('DELETE FROM verification_codes WHERE discord_id = ? OR expires_at < ?').run(discordId, now);
    let code;
    do { code = String(crypto.randomInt(0, 1000000)).padStart(6, '0'); }
    while (db.prepare('SELECT 1 FROM verification_codes WHERE code = ?').get(code));
    db.prepare(`INSERT INTO verification_codes (code, discord_id, discord_name, created_at, expires_at)
                VALUES (?, ?, ?, ?, ?)`).run(code, discordId, discordName, now, now + CODE_TTL);
    return { code, minutes: CODE_TTL / 60000 };
  })();
}

const isImported = (playerId) => !!db.prepare(`SELECT 1 FROM submissions
  WHERE player_id = ? AND reviewed_by = 'mkwrs.com import' LIMIT 1`).get(playerId);

// Returns an error message if this Discord account may not submit under this player name
function claimError(playerName, discordId) {
  const player = findPlayer.get(playerName);
  if (player && player.discord_id && player.discord_id !== discordId) {
    return `The player name "${player.name}" is already linked to another Discord account.`;
  }
  const own = db.prepare('SELECT name FROM players WHERE discord_id = ?').get(discordId);
  if (own && own.name.toLowerCase() !== playerName.toLowerCase()) {
    return `Your Discord account is already linked to the player "${own.name}". Submit your times under that name.`;
  }
  if (player && !player.discord_id && isImported(player.id)) {
    return `"${player.name}" is a world record holder imported from mkwrs.com. If it's you, ask a moderator to link this name to your Discord account.`;
  }
  const otherPending = db.prepare(`SELECT 1 FROM submissions WHERE player_name = ? COLLATE NOCASE
    AND discord_id IS NOT NULL AND discord_id != ? AND status = 'pending' LIMIT 1`).get(playerName, discordId);
  if (!player && otherPending) return `The player name "${playerName}" is already used by another Discord account.`;
  return null;
}

// Checks the code typed on the website and links the submission to the Discord account
const verifyTx = db.transaction((id, token, code) => {
  const sub = getSubmission(id);
  const sameToken = sub && sub.verify_token && token && sub.verify_token.length === token.length
    && crypto.timingSafeEqual(Buffer.from(sub.verify_token), Buffer.from(token));
  if (!sameToken) return { status: 404, error: 'Submission not found.' };
  if (sub.verified_at) return { sub, already: true };
  if (sub.verify_attempts >= MAX_ATTEMPTS) return { status: 429, error: 'Too many wrong codes. Please submit your time again.' };
  db.prepare('UPDATE submissions SET verify_attempts = verify_attempts + 1 WHERE id = ?').run(id);

  const row = db.prepare('SELECT * FROM verification_codes WHERE code = ? AND expires_at > ?').get(code, Date.now());
  if (!row) return { status: 400, error: 'Invalid or expired code. Type /verif again on Discord to get a new one.' };
  const err = claimError(sub.player_name, row.discord_id);
  if (err) return { status: 409, error: err };

  db.prepare('DELETE FROM verification_codes WHERE code = ?').run(code);
  db.prepare(`UPDATE submissions SET verified_at = datetime('now'), discord_id = ?, discord_name = ? WHERE id = ?`)
    .run(row.discord_id, row.discord_name, id);
  // Claim an existing player name right away
  db.prepare('UPDATE players SET discord_id = ? WHERE name = ? AND discord_id IS NULL').run(row.discord_id, sub.player_name);
  return { sub: getSubmission(id) };
});

function verifySubmission(id, token, code) {
  return verifyTx(id, String(token || ''), String(code || ''));
}

// Moderator command: link a player name to a Discord account
function linkPlayer(playerName, discordId) {
  const player = findPlayer.get(playerName);
  if (!player) return { error: `No player named "${playerName}".` };
  const other = db.prepare('SELECT name FROM players WHERE discord_id = ? AND id != ?').get(discordId, player.id);
  if (other) return { error: `This Discord account is already linked to "${other.name}".` };
  db.prepare('UPDATE players SET discord_id = ? WHERE id = ?').run(discordId, player.id);
  return { player: player.name };
}

// ---------- Leaderboards ----------
// Best approved time per player, track and engine class
const BEST_CTE = `
  WITH best AS (
    SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.player_id, s.track_id, s.cc ORDER BY s.time_ms, s.reviewed_at) AS rn
    FROM submissions s WHERE s.status = 'approved'
  ),
  pb AS (
    SELECT b.id, b.player_id, b.track_id, b.cc, b.time_ms, b.proof_url, b.proof_file, b.reviewed_at,
           p.name, p.country, COALESCE(cr.region, 'other') AS region
    FROM best b JOIN players p ON p.id = b.player_id
    LEFT JOIN country_regions cr ON cr.code = p.country
    WHERE b.rn = 1
  ),
  scored AS (
    SELECT pb.*,
      RANK() OVER (PARTITION BY track_id, cc ORDER BY time_ms) AS world_rank,
      MIN(time_ms) OVER (PARTITION BY track_id, cc) AS wr_ms
    FROM pb
  )
`;

// Points: 1000 for the record, otherwise proportional to the record time
const POINTS_EXPR = 'CAST(ROUND(1000.0 * wr_ms / time_ms) AS INTEGER)';

function filters({ country, region }, params, alias = '') {
  const clauses = [];
  if (country) { clauses.push(`${alias}country = @country`); params.country = country; }
  if (region) { clauses.push(`${alias}region = @region`); params.region = region; }
  return clauses;
}

function trackLeaderboard({ trackId, cc, country, region, limit = 200 }) {
  const params = { trackId, cc, limit };
  const where = ['track_id = @trackId', 'cc = @cc', ...filters({ country, region }, params)];
  return db.prepare(`${BEST_CTE}
    SELECT id, player_id, name, country, region, time_ms, proof_url, proof_file, reviewed_at, world_rank, wr_ms,
           ${POINTS_EXPR} AS points
    FROM scored WHERE ${where.join(' AND ')}
    ORDER BY time_ms, reviewed_at LIMIT @limit`).all(params);
}

function playerRanking({ cc, country, region, limit = 500 }) {
  const params = { cc, limit };
  const where = ['cc = @cc', ...filters({ country, region }, params)];
  return db.prepare(`${BEST_CTE}
    SELECT player_id, name, country, region,
           SUM(${POINTS_EXPR}) AS points,
           COUNT(*) AS tracks,
           SUM(CASE WHEN world_rank = 1 THEN 1 ELSE 0 END) AS records
    FROM scored WHERE ${where.join(' AND ')}
    GROUP BY player_id ORDER BY points DESC, records DESC, name LIMIT @limit`).all(params);
}

function countryRanking({ cc }) {
  return db.prepare(`${BEST_CTE},
    per_player AS (
      SELECT player_id, name, country, SUM(${POINTS_EXPR}) AS points,
             SUM(CASE WHEN world_rank = 1 THEN 1 ELSE 0 END) AS records
      FROM scored WHERE cc = @cc GROUP BY player_id
    )
    SELECT country, COUNT(*) AS players, SUM(points) AS points, SUM(records) AS records,
           (SELECT name FROM per_player p2 WHERE p2.country = pp.country ORDER BY points DESC LIMIT 1) AS top_player
    FROM per_player pp GROUP BY country ORDER BY points DESC`).all({ cc });
}

function regionRanking({ cc }) {
  return db.prepare(`${BEST_CTE},
    per_player AS (
      SELECT player_id, name, country, region, SUM(${POINTS_EXPR}) AS points,
             SUM(CASE WHEN world_rank = 1 THEN 1 ELSE 0 END) AS records
      FROM scored WHERE cc = @cc GROUP BY player_id
    )
    SELECT region, COUNT(*) AS players, COUNT(DISTINCT country) AS countries, SUM(points) AS points, SUM(records) AS records,
           (SELECT name FROM per_player p2 WHERE p2.region = pp.region ORDER BY points DESC LIMIT 1) AS top_player,
           (SELECT country FROM per_player p2 WHERE p2.region = pp.region ORDER BY points DESC LIMIT 1) AS top_country
    FROM per_player pp GROUP BY region ORDER BY points DESC`).all({ cc });
}

function worldRecords({ cc }) {
  return db.prepare(`${BEST_CTE}
    SELECT track_id, name, country, player_id, time_ms FROM scored
    WHERE cc = @cc AND world_rank = 1 GROUP BY track_id`).all({ cc });
}

function playerProfile(playerId) {
  const player = db.prepare(`SELECT p.id, p.name, p.country, p.created_at, COALESCE(cr.region, 'other') AS region
    FROM players p LEFT JOIN country_regions cr ON cr.code = p.country WHERE p.id = ?`).get(playerId);
  if (!player) return null;
  const records = db.prepare(`${BEST_CTE}
    SELECT id, track_id, cc, time_ms, proof_url, proof_file, reviewed_at, world_rank, wr_ms, ${POINTS_EXPR} AS points,
           (SELECT COUNT(*) FROM scored s2 WHERE s2.track_id = scored.track_id AND s2.cc = scored.cc) AS total
    FROM scored WHERE player_id = ?`).all(playerId);
  const order = Object.fromEntries(TRACKS.map((t, i) => [t.id, i]));
  records.sort((a, b) => (order[a.track_id] - order[b.track_id]) || a.cc - b.cc);
  return { player, records };
}

function searchPlayers(q) {
  return db.prepare('SELECT id, name, country FROM players WHERE name LIKE ? ORDER BY name LIMIT 20')
    .all(`%${q}%`);
}

function stats() {
  return db.prepare(`SELECT
      (SELECT COUNT(DISTINCT player_id) FROM submissions WHERE status = 'approved') AS players,
      (SELECT COUNT(*) FROM submissions WHERE status = 'approved') AS approved,
      (SELECT COUNT(*) FROM submissions WHERE status = 'pending' AND verified_at IS NOT NULL) AS pending,
      (SELECT COUNT(DISTINCT p.country) FROM players p
        WHERE EXISTS (SELECT 1 FROM submissions s WHERE s.player_id = p.id AND s.status = 'approved')) AS countries`).get();
}

function recentRecords(limit = 10) {
  return db.prepare(`SELECT s.id, s.track_id, s.cc, s.time_ms, s.reviewed_at, p.name, p.country, p.id AS player_id
    FROM submissions s JOIN players p ON p.id = s.player_id
    WHERE s.status = 'approved' ORDER BY s.reviewed_at DESC, s.id DESC LIMIT ?`).all(limit);
}

// ---------- Accounts (login with Discord) ----------
const SESSION_DAYS = 30;
const RENAME_COOLDOWN_DAYS = 7;
const hashId = (id) => crypto.createHash('sha256').update(id).digest('hex');

// Returns the session id to put in the cookie
function createSession(user) {
  const id = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.prepare(`INSERT INTO sessions (id_hash, discord_id, discord_name, discord_avatar, created_at, expires_at)
              VALUES (?, ?, ?, ?, ?, ?)`).run(hashId(id), user.id, user.name, user.avatar || null, now, now + SESSION_DAYS * 86400000);
  return { id, maxAge: SESSION_DAYS * 86400 };
}

function getSession(id) {
  if (!id) return null;
  return db.prepare('SELECT discord_id, discord_name, discord_avatar FROM sessions WHERE id_hash = ? AND expires_at > ?')
    .get(hashId(id), Date.now()) || null;
}

// Remembers when a logged-in user was last active (at most once a minute)
function touchSession(id) {
  if (!id) return;
  const now = Date.now();
  db.prepare('UPDATE sessions SET last_seen = ? WHERE id_hash = ? AND (last_seen IS NULL OR last_seen < ?)').run(now, hashId(id), now - 60000);
}

function deleteSession(id) {
  if (id) db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(hashId(id));
}

const accountPlayer = (discordId) => db.prepare('SELECT * FROM players WHERE discord_id = ?').get(discordId) || null;

const validName = (name) => {
  if (name.length < 2 || name.length > 32) return 'Your player name must be between 2 and 32 characters long.';
  if (/[<>@#`]|^\s|\s$/.test(name)) return 'Your player name contains forbidden characters.';
  return null;
};

// What the account page needs
function accountInfo(discordId) {
  const player = accountPlayer(discordId);
  const submissions = db.prepare(`SELECT id, track_id, cc, time_ms, status, reject_reason, created_at, reviewed_at
    FROM submissions WHERE discord_id = ? OR (player_id IS NOT NULL AND player_id = ?)
    ORDER BY id DESC LIMIT 2000`).all(discordId, player ? player.id : -1);
  let renameAt = null;
  if (player && player.name_changed_at) {
    const next = new Date(`${player.name_changed_at.replace(' ', 'T')}Z`).getTime() + RENAME_COOLDOWN_DAYS * 86400000;
    if (next > Date.now()) renameAt = new Date(next).toISOString();
  }
  return { player, submissions, renameAt };
}

// First login: chooses a player name (or claims an existing one, with the same rules as /verif)
const setupTx = db.transaction((discordId, name, country) => {
  if (accountPlayer(discordId)) return { error: 'Your account already has a player name.' };
  const invalid = validName(name);
  if (invalid) return { error: invalid };
  const err = claimError(name, discordId);
  if (err) return { error: err };
  const existing = findPlayer.get(name);
  if (existing) {
    db.prepare("UPDATE players SET discord_id = ?, country = ?, account_created_at = datetime('now') WHERE id = ?").run(discordId, country, existing.id);
  } else {
    db.prepare("INSERT INTO players (name, country, discord_id, account_created_at) VALUES (?, ?, ?, datetime('now'))").run(name, country, discordId);
  }
  return { player: accountPlayer(discordId) };
});
const setupAccount = (discordId, name, country) => setupTx(discordId, name, country);

const renameTx = db.transaction((discordId, name) => {
  const player = accountPlayer(discordId);
  if (!player) return { error: 'Choose a player name first.' };
  const invalid = validName(name);
  if (invalid) return { error: invalid };
  if (name === player.name) return { player };
  const { renameAt } = accountInfo(discordId);
  if (renameAt) return { error: `You can change your player name again on ${renameAt.slice(0, 10)}.` };
  const taken = db.prepare('SELECT 1 FROM players WHERE name = ? AND id != ?').get(name, player.id)
    || db.prepare(`SELECT 1 FROM submissions WHERE player_name = ? COLLATE NOCASE AND status = 'pending'
                   AND (discord_id IS NULL OR discord_id != ?) LIMIT 1`).get(name, discordId);
  if (taken) return { error: `The player name "${name}" is already taken.` };
  db.prepare("UPDATE players SET name = ?, name_changed_at = datetime('now') WHERE id = ?").run(name, player.id);
  db.prepare('UPDATE submissions SET player_name = ? WHERE player_id = ? OR discord_id = ?').run(name, player.id, discordId);
  return { player: accountPlayer(discordId) };
});
const renameAccount = (discordId, name) => renameTx(discordId, name);

function setAccountCountry(discordId, country) {
  const player = accountPlayer(discordId);
  if (!player) return { error: 'Choose a player name first.' };
  db.prepare('UPDATE players SET country = ? WHERE id = ?').run(country, player.id);
  db.prepare("UPDATE submissions SET country = ? WHERE (player_id = ? OR discord_id = ?) AND status = 'pending'").run(country, player.id, discordId);
  return { player: accountPlayer(discordId) };
}

// Deletes the player, all their submissions, sessions and codes; returns the proof files to remove
const deleteTx = db.transaction((discordId) => {
  const player = accountPlayer(discordId);
  const subs = db.prepare('SELECT id, proof_file FROM submissions WHERE discord_id = ? OR (player_id IS NOT NULL AND player_id = ?)')
    .all(discordId, player ? player.id : -1);
  const del = db.prepare('DELETE FROM submissions WHERE id = ?');
  subs.forEach((r) => del.run(r.id));
  if (player) db.prepare('DELETE FROM players WHERE id = ?').run(player.id);
  db.prepare('DELETE FROM sessions WHERE discord_id = ?').run(discordId);
  db.prepare('DELETE FROM verification_codes WHERE discord_id = ?').run(discordId);
  return { deleted: subs.length, files: subs.map((r) => r.proof_file).filter(Boolean) };
});
const deleteAccount = (discordId) => deleteTx(discordId);

// ---------- Discord roles ----------
const kvGet = (key) => db.prepare('SELECT value FROM kv WHERE key = ?').get(key)?.value ?? null;
const kvSet = (key, value) => db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));

// Discord accounts that should have each role, computed from the approved times
function roleHolders() {
  const ids = (sql) => new Set(db.prepare(sql).all().map((r) => r.discord_id));
  const verified = ids('SELECT discord_id FROM players WHERE discord_id IS NOT NULL');
  // Current record (rank 1, ties included) / top 10 on at least one track and class
  const wr = ids(`${BEST_CTE} SELECT DISTINCT p.discord_id FROM scored JOIN players p ON p.id = scored.player_id
    WHERE world_rank = 1 AND p.discord_id IS NOT NULL`);
  const top10 = ids(`${BEST_CTE} SELECT DISTINCT p.discord_id FROM scored JOIN players p ON p.id = scored.player_id
    WHERE world_rank <= ${TOP} AND p.discord_id IS NOT NULL`);
  // Held a record at some point. An imported world record (mkwrs.com) always counts; a time submitted on the site
  // only counts if another player had a time on the track meanwhile (being alone on a track is not a record).
  const everWr = new Set();
  const rows = db.prepare(`SELECT s.track_id, s.cc, s.player_id, s.time_ms, p.discord_id,
      s.reviewed_by = 'mkwrs.com import' AS imported FROM submissions s
    JOIN players p ON p.id = s.player_id WHERE s.status = 'approved' ORDER BY s.track_id, s.cc, s.reviewed_at, s.id`).all();
  let key = null; let best = Infinity; let holders = new Map(); let players = new Set();
  // holders: playerId -> { discordId, imported }
  const closeReign = () => holders.forEach((h, playerId) => {
    if (h.discordId && (h.imported || [...players].some((p) => p !== playerId))) everWr.add(h.discordId);
  });
  for (const r of rows) {
    const k = `${r.track_id}:${r.cc}`;
    if (k !== key) { closeReign(); key = k; best = Infinity; holders = new Map(); players = new Set(); }
    if (r.time_ms < best) {
      closeReign(); // the time that ends the reign is not counted as competition for it
      best = r.time_ms; holders = new Map([[r.player_id, { discordId: r.discord_id, imported: Boolean(r.imported) }]]);
    } else if (r.time_ms === best) {
      holders.set(r.player_id, { discordId: r.discord_id, imported: Boolean(r.imported) || holders.get(r.player_id)?.imported });
    }
    players.add(r.player_id);
  }
  closeReign();
  const formerWr = new Set([...everWr].filter((id) => !wr.has(id)));
  return { verified, wr, formerWr, top10 };
}

// ---------- Admin statistics ----------
function adminStats() {
  const now = Date.now();
  const n = (sql, ...args) => db.prepare(sql).get(...args).n;
  const days = 30;
  const since = (d) => `-${d} days`;
  const accountDate = "COALESCE(account_created_at, created_at)";

  // One entry per day for the last 30 days, zeros included
  const series = (rows) => {
    const byDay = Object.fromEntries(rows.map((r) => [r.day, r.n]));
    return Array.from({ length: days }, (_, i) => {
      const day = new Date(now - (days - 1 - i) * 86400000).toISOString().slice(0, 10);
      return { day, n: byDay[day] || 0 };
    });
  };

  return {
    generatedAt: new Date(now).toISOString(),
    users: {
      online: n('SELECT COUNT(DISTINCT discord_id) AS n FROM sessions WHERE last_seen > ? AND expires_at > ?', now - 5 * 60000, now),
      active24h: n('SELECT COUNT(DISTINCT discord_id) AS n FROM sessions WHERE last_seen > ?', now - 86400000),
      logins24h: n('SELECT COUNT(*) AS n FROM sessions WHERE created_at > ?', now - 86400000),
      sessions: n('SELECT COUNT(DISTINCT discord_id) AS n FROM sessions WHERE expires_at > ?', now),
    },
    accounts: {
      total: n('SELECT COUNT(*) AS n FROM players WHERE discord_id IS NOT NULL'),
      new24h: n(`SELECT COUNT(*) AS n FROM players WHERE discord_id IS NOT NULL AND ${accountDate} > datetime('now', '-1 day')`),
      new7d: n(`SELECT COUNT(*) AS n FROM players WHERE discord_id IS NOT NULL AND ${accountDate} > datetime('now', ?)`, since(7)),
      new30d: n(`SELECT COUNT(*) AS n FROM players WHERE discord_id IS NOT NULL AND ${accountDate} > datetime('now', ?)`, since(30)),
    },
    submissions: {
      total: n('SELECT COUNT(*) AS n FROM submissions'),
      new24h: n("SELECT COUNT(*) AS n FROM submissions WHERE created_at > datetime('now', '-1 day')"),
      new7d: n('SELECT COUNT(*) AS n FROM submissions WHERE created_at > datetime(\'now\', ?)', since(7)),
      pending: n("SELECT COUNT(*) AS n FROM submissions WHERE status = 'pending' AND verified_at IS NOT NULL"),
      unverified: n("SELECT COUNT(*) AS n FROM submissions WHERE status = 'pending' AND verified_at IS NULL"),
      approved: n("SELECT COUNT(*) AS n FROM submissions WHERE status = 'approved'"),
      rejected: n("SELECT COUNT(*) AS n FROM submissions WHERE status = 'rejected'"),
      approved7d: n("SELECT COUNT(*) AS n FROM submissions WHERE status = 'approved' AND reviewed_at > datetime('now', ?)", since(7)),
    },
    leaderboard: stats(),
    perDay: {
      submissions: series(db.prepare(`SELECT date(created_at) AS day, COUNT(*) AS n FROM submissions
        WHERE created_at > datetime('now', ?) GROUP BY day`).all(since(days))),
      accounts: series(db.prepare(`SELECT date(${accountDate}) AS day, COUNT(*) AS n FROM players
        WHERE discord_id IS NOT NULL AND ${accountDate} > datetime('now', ?) GROUP BY day`).all(since(days))),
    },
    latestAccounts: db.prepare(`SELECT p.id, p.name, p.country, ${accountDate} AS created,
        (SELECT discord_name FROM sessions s WHERE s.discord_id = p.discord_id ORDER BY created_at DESC LIMIT 1) AS discord_name,
        (SELECT MAX(last_seen) FROM sessions s WHERE s.discord_id = p.discord_id) AS last_seen
      FROM players p WHERE p.discord_id IS NOT NULL ORDER BY created DESC LIMIT 10`).all(),
    latestSubmissions: db.prepare(`SELECT id, player_name, country, track_id, cc, time_ms, status, created_at,
        verified_at IS NOT NULL AS verified, discord_name
      FROM submissions ORDER BY id DESC LIMIT 15`).all(),
    topTracks: db.prepare(`SELECT track_id, cc, COUNT(*) AS n FROM submissions
      WHERE created_at > datetime('now', ?) GROUP BY track_id, cc ORDER BY n DESC LIMIT 8`).all(since(days)),
  };
}

module.exports = {
  db, parseTime, formatTime, TRACK_BY_ID,
  createSubmission, getSubmission, setSubmissionDiscord, unsentSubmissions, rankingChange, TOP, purgeRejected, purgeUnverified, issueCode, verifySubmission, claimError, linkPlayer, setDiscordMessage, approveSubmission, rejectSubmission,
  trackLeaderboard, worldRecords, playerRanking, countryRanking, regionRanking, playerProfile, searchPlayers,
  stats, recentRecords,
  createSession, getSession, touchSession, deleteSession, adminStats, roleHolders, kvGet, kvSet, accountPlayer, accountInfo, setupAccount, renameAccount, setAccountCountry, deleteAccount,
  RENAME_COOLDOWN_DAYS,
};
