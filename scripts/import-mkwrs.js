// Imports the current world records from https://mkwrs.com/mk8dx/ into the database.
//
//   npm run import-wrs                  fetch the page and import
//   npm run import-wrs -- --dry-run     show what would be imported, change nothing
//   npm run import-wrs -- --file page.html   use a saved copy of the page instead of downloading it
//
// Safe to run again: a record already in the database (same player, track, class and time) is skipped.
// Only one page is downloaded per run (the site asks for a 20 s crawl delay between requests).
const fs = require('fs');
const store = require('../src/db');
const { TRACKS } = require('../src/tracks');
const { COUNTRY_BY_CODE } = require('../src/countries');

const SOURCE = 'https://mkwrs.com/mk8dx/';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fileIdx = args.indexOf('--file');
const file = fileIdx >= 0 ? args[fileIdx + 1] : null;

// mkwrs.com names that differ from ours
const NAME_ALIASES = {
  'Tour Ninja Hideaway': 'Ninja Hideaway',
  'Tour Merry Mountain': 'Merry Mountain',
  'Tour Piranha Plant Cove': 'Piranha Plant Cove',
};
const TRACK_BY_NAME = Object.fromEntries(TRACKS.map((t) => [t.name.toLowerCase(), t]));

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

// 1'33"628 -> 93628 ms
function parseWrTime(t) {
  const m = /^(\d+)'(\d\d)"(\d{3})$/.exec(t);
  return m ? Number(m[1]) * 60000 + Number(m[2]) * 1000 + Number(m[3]) : null;
}

function parse(html) {
  const start = html.indexOf('<table class = "wr">');
  if (start < 0) throw new Error('WR table not found: the page layout may have changed.');
  const blocks = html.slice(start).split('<table class= "track">').slice(1);
  const ROW = /<td>(?:<a href="([^"]+)"[^>]*>)?(\d+'\d\d"\d{3})(?:<\/a>)?[^]*?<\/td>\s*<td>(?:<a href="[^"]*">)?([^<]*)(?:<\/a>)?<\/td>\s*<td><div class="center"><img alt="[^"]*" title="[^"]*" src="\.\.\/country-flags\/([A-Za-z_]+)\.png"><\/div><\/td>\s*<td>([\d-]+)<\/td>/g;

  const records = [];
  const problems = [];
  for (const block of blocks) {
    const nameMatch = /display\.php\?track=([^"&]+)">([^<]+)<\/a>/.exec(block);
    if (!nameMatch) continue;
    const siteName = decode(nameMatch[2]);
    const track = TRACK_BY_NAME[(NAME_ALIASES[siteName] || siteName).toLowerCase()];
    if (!track) { problems.push(`Unknown track "${siteName}"`); continue; }

    // Rows are listed 150cc first, then 200cc. Tied records repeat the same time on extra rows.
    let cc = 150;
    let prevTime = null;
    for (const m of block.matchAll(ROW)) {
      const [, video, rawTime, rawPlayer, rawCountry, date] = m;
      const timeMs = parseWrTime(rawTime);
      if (prevTime !== null && timeMs !== prevTime) cc = 200;
      prevTime = timeMs;
      const country = rawCountry.toUpperCase();
      if (!COUNTRY_BY_CODE[country]) { problems.push(`${track.name} ${cc}cc: unknown country "${rawCountry}"`); continue; }
      records.push({
        track, cc, timeMs, player: decode(rawPlayer), country, date,
        proof: video || `${SOURCE}display.php?track=${nameMatch[1]}${cc === 200 ? '&m=200' : ''}`,
      });
    }
  }
  return { records, problems };
}

async function main() {
  let html;
  if (file) {
    html = fs.readFileSync(file, 'utf8');
  } else {
    const res = await fetch(SOURCE, { headers: { 'User-Agent': 'mk8dx-leaderboard-import (+https://github.com)' } });
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    html = await res.text();
  }

  const { records, problems } = parse(html);
  const per = { 150: records.filter((r) => r.cc === 150).length, 200: records.filter((r) => r.cc === 200).length };
  console.log(`Found ${records.length} records (${per[150]} in 150cc, ${per[200]} in 200cc).`);
  problems.forEach((p) => console.warn(`  ! ${p}`));

  const exists = store.db.prepare(`SELECT 1 FROM submissions
    WHERE player_name = ? COLLATE NOCASE AND track_id = ? AND cc = ? AND time_ms = ? AND status = 'approved'`);
  const setDate = store.db.prepare('UPDATE submissions SET created_at = ?, reviewed_at = ? WHERE id = ?');

  let added = 0;
  let skipped = 0;
  const run = store.db.transaction(() => {
    for (const r of records) {
      if (exists.get(r.player, r.track.id, r.cc, r.timeMs)) { skipped++; continue; }
      if (dryRun) {
        console.log(`  + ${r.track.name} ${r.cc}cc  ${store.formatTime(r.timeMs)}  ${r.player} (${r.country})  ${r.date}`);
        added++;
        continue;
      }
      const sub = store.createSubmission({
        player_name: r.player, country: r.country, track_id: r.track.id, cc: r.cc, time_ms: r.timeMs,
        proof_url: r.proof, proof_file: null, comment: `World record imported from mkwrs.com (set on ${r.date})`,
      });
      store.approveSubmission(sub.id, 'mkwrs.com import');
      const when = `${r.date} 12:00:00`;
      setDate.run(when, when, sub.id);
      added++;
    }
  });
  run();

  console.log(dryRun
    ? `Dry run: ${added} record(s) would be added, ${skipped} already present. Nothing was changed.`
    : `Done: ${added} record(s) added, ${skipped} already present.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
