// Tests the records webhook without changing the database:
//   npm run test-webhook              sends a "webhook connected" message
//   npm run test-webhook -- --record  sends an example top 10 announcement (marked as a test)
require('dotenv').config({ quiet: true });
const store = require('../src/db');
const webhook = require('../src/webhook');

async function main() {
  if (!process.argv.includes('--record')) {
    await webhook.sendTest();
    console.log('Test message sent: check your Discord channel.');
    return;
  }
  if (!webhook.isEnabled()) throw new Error('DISCORD_RECORDS_WEBHOOK_URL is not set in .env');
  // Example: a fake player entering the top 10 of Mario Kart Stadium 150cc at the 3rd place
  const rows = store.trackLeaderboard({ trackId: 'mario-kart-stadium', cc: 150, limit: 11 });
  const time = rows.length >= 3 ? Math.round((rows[1].time_ms + rows[2].time_ms) / 2) : 94000;
  const sub = {
    player_name: 'Test Player', country: 'FR', track_id: 'mario-kart-stadium', cc: 150,
    time_ms: time, proof_url: 'https://example.com/proof', proof_file: null,
  };
  const board = rows.map((r) => ({ id: r.player_id, name: r.name, country: r.country, discord_id: null, time_ms: r.time_ms }));
  const ranking = store.rankingChange(board, -1, time);
  if (!ranking) throw new Error('Could not build an example (not enough times on Mario Kart Stadium 150cc).');
  await webhook.announceRecord(sub, ranking, { test: true });
  console.log('Example top 10 announcement sent (marked as a test): check your Discord channel.');
}

main().catch((e) => { console.error(`Webhook test failed: ${e.message}`); process.exit(1); });
