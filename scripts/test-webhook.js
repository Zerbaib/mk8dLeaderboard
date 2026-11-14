// Tests the records webhook without changing the database:
//   npm run test-webhook              sends a "webhook connected" message
//   npm run test-webhook -- --record  sends an example record announcement (marked as a test)
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
  // Example: the current 150cc record of Mario Kart Stadium, beaten by 0.123 s by a fake player
  const current = store.trackLeaderboard({ trackId: 'mario-kart-stadium', cc: 150, limit: 1 })[0];
  const sub = {
    player_name: 'Test Player', country: 'FR', track_id: 'mario-kart-stadium', cc: 150,
    time_ms: current ? current.time_ms - 123 : 94000, proof_url: 'https://example.com/proof', proof_file: null,
  };
  const record = { previous: current ? { name: current.name, country: current.country, time_ms: current.time_ms } : null, tied: false };
  await webhook.announceRecord(sub, record, { test: true });
  console.log('Example record announcement sent (marked as a test): check your Discord channel.');
}

main().catch((e) => { console.error(`Webhook test failed: ${e.message}`); process.exit(1); });
