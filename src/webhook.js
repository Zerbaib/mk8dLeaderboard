// Announces new records on a Discord webhook (DISCORD_RECORDS_WEBHOOK_URL)
const store = require('./db');
const { COUNTRY_BY_CODE } = require('./countries');

const WEBHOOK_URL = process.env.DISCORD_RECORDS_WEBHOOK_URL;
const SITE_NAME = process.env.SITE_NAME || 'MK8DX Times';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const IS_PUBLIC = /^https:\/\//.test(PUBLIC_URL);

const flag = (code) => (code && code.length === 2
  ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildPayload(sub, { previous, tied }) {
  const track = store.TRACK_BY_ID[sub.track_id];
  const trackName = track ? track.name : sub.track_id;
  const time = store.formatTime(sub.time_ms);
  const fields = [
    { name: 'Player', value: `${flag(sub.country)} ${sub.player_name}`, inline: true },
    { name: 'Time', value: `**${time}**`, inline: true },
    { name: 'Class', value: `${sub.cc}cc`, inline: true },
  ];
  if (previous) {
    const diff = ((previous.time_ms - sub.time_ms) / 1000).toFixed(3);
    const samePlayer = previous.name.toLowerCase() === sub.player_name.toLowerCase();
    fields.push({
      name: tied ? 'Tied with' : 'Previous record',
      value: `${flag(previous.country)} ${previous.name} — ${store.formatTime(previous.time_ms)}`
        + `${tied ? '' : ` (−${diff} s${samePlayer ? ', own record improved' : ''})`}`,
    });
  } else {
    fields.push({ name: 'Previous record', value: 'None — first time on this track!' });
  }
  const proof = sub.proof_url || (sub.proof_file && PUBLIC_URL ? `${PUBLIC_URL}/uploads/${sub.proof_file}` : null);
  if (proof) fields.push({ name: 'Proof', value: proof });

  const embed = {
    title: `${tied ? '🤝 Record tied' : '🏆 New record'} — ${trackName} ${sub.cc}cc`,
    color: tied ? 0x2d8cff : 0xffc928,
    fields,
    footer: { text: `${track ? track.cup : ''} • ${COUNTRY_BY_CODE[sub.country]?.name || sub.country}` },
    timestamp: new Date().toISOString(),
  };
  if (PUBLIC_URL) embed.url = `${PUBLIC_URL}/#/track/${sub.track_id}`;
  if (IS_PUBLIC) embed.thumbnail = { url: `${PUBLIC_URL}/logo.png` };

  return {
    username: SITE_NAME,
    ...(IS_PUBLIC ? { avatar_url: `${PUBLIC_URL}/logo.png` } : {}),
    embeds: [embed],
    allowed_mentions: { parse: [] }, // player names can never ping anyone
  };
}

// Messages are sent one by one, 2 s apart, to stay under Discord's webhook rate limit
const queue = [];
let running = false;

async function post(payload) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (res.ok) return;
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      await sleep(Math.ceil((body.retry_after || 2) * 1000));
      continue;
    }
    throw new Error(`HTTP ${res.status}`);
  }
}

async function drain() {
  if (running) return;
  running = true;
  while (queue.length) {
    const { payload, resolve } = queue.shift();
    try { await post(payload); } catch (e) { console.error('[webhook] Could not announce record:', e.message); }
    resolve();
    if (queue.length) await sleep(2000);
  }
  running = false;
}

// Returns a promise resolved once the message has been sent (or failed)
function announceRecord(sub, record) {
  if (!WEBHOOK_URL || !record) return Promise.resolve();
  return new Promise((resolve) => {
    queue.push({ payload: buildPayload(sub, record), resolve });
    drain();
  });
}

module.exports = { announceRecord, buildPayload, isEnabled: () => Boolean(WEBHOOK_URL) };
