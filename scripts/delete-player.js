// Deletes a player and all their submissions (GDPR erasure request):
//   npm run delete-player -- "Player name"
const fs = require('fs');
const path = require('path');
const { db } = require('../src/db');

const name = process.argv.slice(2).join(' ').trim();
if (!name) { console.error('Usage: npm run delete-player -- "Player name"'); process.exit(1); }

const player = db.prepare('SELECT * FROM players WHERE name = ?').get(name);
const subs = db.prepare('SELECT id, proof_file FROM submissions WHERE player_name = ? COLLATE NOCASE OR player_id = ?')
  .all(name, player ? player.id : -1);
if (!player && !subs.length) { console.log(`No data found for "${name}".`); process.exit(0); }

db.transaction(() => {
  subs.forEach((s) => db.prepare('DELETE FROM submissions WHERE id = ?').run(s.id));
  if (player) db.prepare('DELETE FROM players WHERE id = ?').run(player.id);
})();
const uploads = path.join(__dirname, '..', 'uploads');
subs.filter((s) => s.proof_file).forEach((s) => fs.rmSync(path.join(uploads, path.basename(s.proof_file)), { force: true }));
console.log(`Deleted ${subs.length} submission(s)${player ? ` and player "${player.name}"` : ''}.`);
console.log('Remember to also delete the related messages in the Discord review channel.');
