// Disk usage: free space, database and proof files sizes; periodic checks
const fs = require('fs');
const path = require('path');
const store = require('./db');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const LOW_SPACE = Number(process.env.LOW_DISK_WARNING_MB || 500) * 1024 * 1024;

const fileSize = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };

function dirSize(dir) {
  let total = 0; let files = 0;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return { total, files }; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const s = dirSize(p); total += s.total; files += s.files; } else if (e.isFile()) { total += fileSize(p); files += 1; }
  }
  return { total, files };
}

function info() {
  let free = null; let size = null;
  try {
    const s = fs.statfsSync(path.dirname(store.DB_PATH));
    free = s.bavail * s.bsize; size = s.blocks * s.bsize;
  } catch { /* statfs not available */ }
  const uploads = dirSize(UPLOAD_DIR);
  return {
    disk: { free, size },
    database: { file: fileSize(store.DB_PATH), wal: fileSize(`${store.DB_PATH}-wal`) },
    uploads: { bytes: uploads.total, files: uploads.files },
  };
}

const mb = (b) => `${Math.round(b / 1048576)} MB`;

// Every hour: empty the WAL file and warn when the disk is almost full
function startChecks() {
  const check = () => {
    try { store.checkpoint(); } catch (e) { console.error('[storage] WAL checkpoint failed:', e.message); }
    const i = info();
    if (i.disk.free !== null && i.disk.free < LOW_SPACE) {
      console.warn(`[storage] ⚠️ Low disk space: ${mb(i.disk.free)} free. Database ${mb(i.database.file + i.database.wal)}, `
        + `proof files ${mb(i.uploads.bytes)} (${i.uploads.files} files). Free some space or the site will stop saving data.`);
    }
  };
  check();
  setInterval(check, 60 * 60 * 1000).unref();
}

module.exports = { info, startChecks };
