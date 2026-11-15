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
db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_discord ON players (discord_id) WHERE discord_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS verification_codes (
  code         TEXT PRIMARY KEY,
  discord_id   TEXT NOT NULL,
  discord_name TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
`);

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
      (SELECT COUNT(*) FROM players) AS players,
      (SELECT COUNT(*) FROM submissions WHERE status = 'approved') AS approved,
      (SELECT COUNT(*) FROM submissions WHERE status = 'pending' AND verified_at IS NOT NULL) AS pending,
      (SELECT COUNT(DISTINCT country) FROM players) AS countries`).get();
}

function recentRecords(limit = 10) {
  return db.prepare(`SELECT s.id, s.track_id, s.cc, s.time_ms, s.reviewed_at, p.name, p.country, p.id AS player_id
    FROM submissions s JOIN players p ON p.id = s.player_id
    WHERE s.status = 'approved' ORDER BY s.reviewed_at DESC, s.id DESC LIMIT ?`).all(limit);
}

module.exports = {
  db, parseTime, formatTime, TRACK_BY_ID,
  createSubmission, getSubmission, unsentSubmissions, rankingChange, TOP, purgeRejected, purgeUnverified, issueCode, verifySubmission, claimError, linkPlayer, setDiscordMessage, approveSubmission, rejectSubmission,
  trackLeaderboard, worldRecords, playerRanking, countryRanking, regionRanking, playerProfile, searchPlayers,
  stats, recentRecords,
};
