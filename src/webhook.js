// Announces new records and top 10 times on a Discord webhook (DISCORD_RECORDS_WEBHOOK_URL)
const store = require('./db');
const { COUNTRY_BY_CODE } = require('./countries');

const WEBHOOK_URL = process.env.DISCORD_RECORDS_WEBHOOK_URL;
const SITE_NAME = process.env.SITE_NAME || 'MK8DX Times';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const IS_PUBLIC = /^https:\/\//.test(PUBLIC_URL);

const flag = (code) => (code && code.length === 2
  ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sec = (ms) => (ms / 1000).toFixed(3);

// ranking: see rankingChange() in db.js
function buildPayload(sub, ranking, { test = false } = {}) {
  const { rank, previousRank, total, recordMs, previousRecord, passed, tiedWith } = ranking;
  const track = store.TRACK_BY_ID[sub.track_id];
  const trackName = track ? track.name : sub.track_id;
  const time = store.formatTime(sub.time_ms);
  const isRecord = rank === 1;
  const tied = tiedWith.length > 0;
  const who = (e) => `${flag(e.country)} ${e.name}`;

  const fields = [
    { name: 'Player', value: who({ country: sub.country, name: sub.player_name }), inline: true },
    { name: 'Time', value: `**${time}**`, inline: true },
    { name: 'Rank', value: `**#${rank}**${tied ? ' (tied)' : ''} / ${total}`, inline: true },
  ];
  if (isRecord) {
    if (previousRecord) {
      const samePlayer = previousRecord.name.toLowerCase() === sub.player_name.toLowerCase();
      fields.push({
        name: tied ? 'Tied with' : 'Previous record',
        value: tied
          ? tiedWith.map((e) => `${who(e)} — ${store.formatTime(e.time_ms)}`).join('\n')
          : `${who(previousRecord)} — ${store.formatTime(previousRecord.time_ms)} (−${sec(previousRecord.time_ms - sub.time_ms)} s${samePlayer ? ', own record improved' : ''})`,
      });
    } else {
      fields.push({ name: 'Previous record', value: 'None — first time on this track!' });
    }
  } else {
    fields.push({ name: 'Gap to the record', value: `+${sec(sub.time_ms - recordMs)} s`, inline: true });
    fields.push({ name: 'Progress', value: previousRank ? `#${previousRank} → #${rank}` : 'New entry', inline: true });
    if (tied) fields.push({ name: 'Tied with', value: tiedWith.map(who).join(', ') });
  }
  if (passed.length && !(isRecord && !tied && passed.length === 1 && passed[0].oldRank === 1)) {
    const list = passed.slice(0, 5).map((e) => `${who(e)} (#${e.oldRank} → #${e.newRank})`);
    if (passed.length > 5) list.push(`and ${passed.length - 5} more`);
    fields.push({ name: 'Overtook', value: list.join('\n') });
  }
  const proof = sub.proof_url || (sub.proof_file && PUBLIC_URL ? `${PUBLIC_URL}/uploads/${sub.proof_file}` : null);
  if (proof) fields.push({ name: 'Proof', value: proof });

  let title;
  if (isRecord) title = `${tied ? '🤝 Record tied' : '🏆 New record'} — ${trackName} ${sub.cc}cc`;
  else title = `🔥 New top ${store.TOP} time — #${rank} on ${trackName} ${sub.cc}cc`;

  const embed = {
    title: `${test ? '[TEST] ' : ''}${title}`,
    color: isRecord ? (tied ? 0x2d8cff : 0xffc928) : 0xff8a00,
    fields,
    footer: { text: `${track ? track.cup : ''} • ${COUNTRY_BY_CODE[sub.country]?.name || sub.country}` },
    timestamp: new Date().toISOString(),
  };
  if (PUBLIC_URL) embed.url = `${PUBLIC_URL}/track/${sub.track_id}/${sub.cc}cc`;
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
    try {
      await post(payload);
      console.log(`[webhook] Announced: ${payload.embeds[0].title}`);
    } catch (e) { console.error('[webhook] Could not announce record:', e.message); }
    resolve();
    if (queue.length) await sleep(2000);
  }
  running = false;
}

// Announces a time that enters the top 10 (ranking from db.rankingChange).
// Returns a promise resolved once the message has been sent (or failed).
function announceRecord(sub, ranking, options) {
  if (!WEBHOOK_URL || !ranking) return Promise.resolve();
  return new Promise((resolve) => {
    queue.push({ payload: buildPayload(sub, ranking, options), resolve });
    drain();
  });
}

// Sends a test message; throws with the reason if it fails
async function sendTest() {
  if (!WEBHOOK_URL) throw new Error('DISCORD_RECORDS_WEBHOOK_URL is not set in .env');
  await post({
    username: SITE_NAME,
    ...(IS_PUBLIC ? { avatar_url: `${PUBLIC_URL}/logo.png` } : {}),
    embeds: [{ title: '✅ Records webhook connected', description: 'New records will be announced in this channel.', color: 0x2ecc71 }],
  });
}

module.exports = { announceRecord, buildPayload, sendTest, isEnabled: () => Boolean(WEBHOOK_URL) };
