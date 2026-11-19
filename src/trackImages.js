// Track preview images placed in public/tracks/<track id>.<webp|jpg|jpeg|png|avif>
// They are optional: without an image, the site shows a placeholder in the cup's colours.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', 'tracks');
const EXTS = ['webp', 'avif', 'jpg', 'jpeg', 'png'];

// Fills track.image ('/tracks/<file>?v=<mtime>' or null) on the given track objects; returns how many were found
function scan(tracks) {
  let files = [];
  try { files = fs.readdirSync(DIR); } catch { /* no folder yet */ }
  const byId = {};
  for (const f of files) {
    const m = /^(.+)\.([a-z0-9]+)$/i.exec(f);
    if (!m || !EXTS.includes(m[2].toLowerCase())) continue;
    const id = m[1].toLowerCase();
    const prev = byId[id];
    // If several formats exist for one track, the first in EXTS wins
    if (!prev || EXTS.indexOf(m[2].toLowerCase()) < EXTS.indexOf(prev.ext)) {
      let v = 0;
      try { v = Math.round(fs.statSync(path.join(DIR, f)).mtimeMs); } catch { /* ignore */ }
      byId[id] = { file: f, ext: m[2].toLowerCase(), v };
    }
  }
  let count = 0;
  for (const t of tracks) {
    const img = byId[t.id];
    t.image = img ? `/tracks/${encodeURIComponent(img.file)}?v=${img.v}` : null;
    if (img) count++;
  }
  return count;
}

module.exports = { scan, DIR, EXTS };
