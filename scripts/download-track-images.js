// Downloads the 96 track preview images (in-game course icons, 288x162) from the Super Mario Wiki
// into public/tracks/, where the site picks them up automatically.
//
//   npm run download-track-images            download the missing images
//   npm run download-track-images -- --force replace the existing ones too
//
// Images © Nintendo, used by a non-commercial fan site to identify the tracks.
// The wiki's API is used politely: a few requests to get the URLs, then one download per second.
const fs = require('fs');
const path = require('path');
const SOURCES = require('../src/trackImageSources');
const { DIR } = require('../src/trackImages');

const API = 'https://www.mariowiki.com/api.php';
const HEADERS = { 'User-Agent': 'mk8dx-leaderboard track images (non-commercial fan site)' };
const force = process.argv.includes('--force');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fileTitle = (name) => `File:MK8D ${name} Course Icon Full.png`;

// Optional: converts the PNG files to WebP (about 5x lighter) when the "sharp" package is installed
let sharp = null;
try { sharp = require('sharp'); } catch { /* keep PNG */ }
async function save(id, png) {
  fs.readdirSync(DIR).filter((f) => f.toLowerCase().startsWith(`${id}.`) && !f.endsWith('.md'))
    .forEach((f) => fs.unlinkSync(path.join(DIR, f)));
  if (sharp) fs.writeFileSync(path.join(DIR, `${id}.webp`), await sharp(png).webp({ quality: 82 }).toBuffer());
  else fs.writeFileSync(path.join(DIR, `${id}.png`), png);
}

const existing = (id) => fs.readdirSync(DIR).some((f) => f.toLowerCase().startsWith(`${id}.`) && !f.endsWith('.md'));

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  // PNG files already there are converted to WebP without downloading them again
  if (sharp && !force) {
    const pngs = Object.keys(SOURCES).filter((id) => fs.existsSync(path.join(DIR, `${id}.png`)));
    for (const id of pngs) await save(id, fs.readFileSync(path.join(DIR, `${id}.png`)));
    if (pngs.length) console.log(`${pngs.length} PNG image(s) converted to WebP.`);
  }
  const todo = Object.entries(SOURCES).filter(([id]) => force || !existing(id));
  if (!todo.length) { console.log('All 96 track images are already there (use --force to download them again).'); return; }
  console.log(`Getting the address of ${todo.length} image(s)...`);

  // 1. Image URLs, 50 titles per request
  const urls = {};
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50);
    const params = new URLSearchParams({
      action: 'query', prop: 'imageinfo', iiprop: 'url', format: 'json', formatversion: '2',
      titles: batch.map(([, name]) => fileTitle(name)).join('|'),
    });
    const data = await getJson(`${API}?${params}`);
    const byTitle = {};
    for (const p of data.query.pages) if (p.imageinfo) byTitle[p.title] = p.imageinfo[0].url;
    // The API may normalise titles (e.g. apostrophes): map them back
    for (const n of data.query.normalized || []) if (byTitle[n.to]) byTitle[n.from] = byTitle[n.to];
    for (const [id, name] of batch) urls[id] = byTitle[fileTitle(name)];
    await sleep(1000);
  }

  // 2. Downloads, one per second
  let ok = 0;
  const failed = [];
  for (const [id] of todo) {
    const url = urls[id];
    if (!url) { failed.push(`${id} (not found on the wiki)`); continue; }
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000 || buf.subarray(1, 4).toString() !== 'PNG') throw new Error('not a PNG image');
      await save(id, buf);
      ok++;
      process.stdout.write(`\r  ${ok}/${todo.length} ${id.padEnd(30)}`);
    } catch (e) {
      failed.push(`${id} (${e.message})`);
    }
    await sleep(1000);
  }
  console.log(`\nDone: ${ok} image(s) downloaded into public/tracks/${sharp ? ' (WebP)' : ' (PNG: install "sharp" to get lighter WebP files)'}.`);
  if (failed.length) console.log(`Failed: ${failed.join(', ')}\nRun the command again to retry the missing ones.`);
  console.log('The site shows them within 2 minutes (no restart needed).');
}

main().catch((e) => { console.error(`Download failed: ${e.message}`); process.exit(1); });
