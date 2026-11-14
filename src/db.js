const path = require('path');
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
  INSERT INTO submissions (player_name, country, track_id, cc, time_ms, proof_url, proof_file, comment)
  VALUES (@player_name, @country, @track_id, @cc, @time_ms, @proof_url, @proof_file, @comment)
`);

function createSubmission(data) {
  const info = insertSubmission.run(data);
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

function getSubmission(id) {
  return db.prepare('SELECT * FROM submissions WHERE id = ?').get(id);
}

function setDiscordMessage(id, messageId) {
  db.prepare('UPDATE submissions SET discord_message_id = ? WHERE id = ?').run(messageId, id);
}

const findPlayer = db.prepare('SELECT id FROM players WHERE name = ?');
const insertPlayer = db.prepare('INSERT INTO players (name, country) VALUES (?, ?)');
const updatePlayer = db.prepare('UPDATE players SET country = ? WHERE id = ?');
function upsertPlayer(name, country) {
  const existing = findPlayer.get(name);
  if (existing) { updatePlayer.run(country, existing.id); return existing.id; }
  return insertPlayer.run(name, country).lastInsertRowid;
}

const approveTx = db.transaction((id, reviewer) => {
  const sub = getSubmission(id);
  if (!sub) throw new Error('Submission not found');
  if (sub.status !== 'pending') return { sub, changed: false };
  const playerId = upsertPlayer(sub.player_name, sub.country);
  db.prepare(`UPDATE submissions SET status = 'approved', player_id = ?, reviewed_by = ?, reviewed_at = datetime('now')
              WHERE id = ?`).run(playerId, reviewer, id);
  return { sub: getSubmission(id), changed: true };
});

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
      (SELECT COUNT(*) FROM submissions WHERE status = 'pending') AS pending,
      (SELECT COUNT(DISTINCT country) FROM players) AS countries`).get();
}

function recentRecords(limit = 10) {
  return db.prepare(`SELECT s.id, s.track_id, s.cc, s.time_ms, s.reviewed_at, p.name, p.country, p.id AS player_id
    FROM submissions s JOIN players p ON p.id = s.player_id
    WHERE s.status = 'approved' ORDER BY s.reviewed_at DESC, s.id DESC LIMIT ?`).all(limit);
}

module.exports = {
  db, parseTime, formatTime, TRACK_BY_ID,
  createSubmission, getSubmission, purgeRejected, setDiscordMessage, approveSubmission, rejectSubmission,
  trackLeaderboard, worldRecords, playerRanking, countryRanking, regionRanking, playerProfile, searchPlayers,
  stats, recentRecords,
};
