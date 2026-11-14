// Fills the database with demo data: npm run seed
const store = require('../src/db');
const { TRACKS } = require('../src/tracks');

const PLAYERS = [
  ['Kiryu', 'FR', 'Île-de-France'], ['Nayla', 'FR', 'Occitanie'], ['Zerbaib', 'FR', 'Auvergne-Rhône-Alpes'],
  ['Hugo_MK', 'FR', 'Bretagne'], ['Lumi', 'FR', 'Hauts-de-France'], ['Toadette77', 'FR', 'Île-de-France'],
  ['Shiro', 'JP', 'Kanto'], ['Haruka', 'JP', 'Kansai'], ['Blaze', 'US', 'California'], ['Drift King', 'US', 'Texas'],
  ['Maple', 'CA', 'Quebec'], ['Wally', 'BE', 'Wallonia'], ['Grüni', 'DE', 'Bayern'], ['Ricardo', 'ES', 'Cataluña'],
  ['Pasta', 'IT', 'Lombardia'], ['Swissy', 'CH', 'Suisse romande'], ['Brit', 'GB', 'England'], ['Nordic', 'SE', 'Stockholm'],
];

let seed = 42;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

const base = (t) => 95000 + (t.name.length * 2371) % 50000; // fake base time per track
let n = 0;
for (const cc of [150, 200]) {
  for (const t of TRACKS) {
    PLAYERS.forEach(([name, country, region], i) => {
      if (rnd() < 0.35) return;
      const skill = 1 + i * 0.006 + rnd() * 0.02;
      const time = Math.round(base(t) * (cc === 200 ? 0.88 : 1) * skill);
      const sub = store.createSubmission({ player_name: name, country, region, track_id: t.id, cc, time_ms: time,
        proof_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', proof_file: null, comment: null });
      store.approveSubmission(sub.id, 'seed');
      n++;
    });
  }
}
for (let i = 0; i < 3; i++) {
  store.createSubmission({ player_name: 'Newcomer', country: 'FR', region: 'Normandie', track_id: TRACKS[i].id, cc: 150,
    time_ms: 110000 + i * 1000, proof_url: 'https://example.com/preuve.png', proof_file: null, comment: null });
}
console.log(`${n} demo times approved + 3 pending.`);
