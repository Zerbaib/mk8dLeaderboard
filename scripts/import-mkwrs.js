// Imports the current world records from https://mkwrs.com/mk8dx/ into the database.
//
//   npm run import-wrs                  fetch the page and import
//   npm run import-wrs -- --dry-run     show what would be imported, change nothing
//   npm run import-wrs -- --file page.html   use a saved copy of the page instead of downloading it
//   npm run import-wrs -- --announce    also post each new record on the records webhook
//                                       (only records that beat or tie a time already in the database)
//
// Safe to run again: a record already in the database (same player, track, class and time) is skipped.
// Only one page is downloaded per run (the site asks for a 20 s crawl delay between requests).
require('dotenv').config({ quiet: true });
const { importWorldRecords } = require('../src/mkwrs');

const args = process.argv.slice(2);
const fileIdx = args.indexOf('--file');

importWorldRecords({
  file: fileIdx >= 0 ? args[fileIdx + 1] : null,
  dryRun: args.includes('--dry-run'),
  announce: args.includes('--announce'),
}).catch((e) => { console.error(e.message); process.exit(1); });
