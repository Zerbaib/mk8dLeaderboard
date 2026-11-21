/* MK8DX Times — page rendering shared by the server (HTML for search engines) and the browser.
   Every function is pure: data in, HTML string out. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MK8Render = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function fmt(ms) {
    const m = Math.floor(ms / 60000); const s = Math.floor((ms % 60000) / 1000); const x = ms % 1000;
    return `${m}:${String(s).padStart(2, '0')}.${String(x).padStart(3, '0')}`;
  }
  const gap = (ms, wr) => (ms === wr ? '' : `+${((ms - wr) / 1000).toFixed(3)}`);
  const num = (n) => Number(n || 0).toLocaleString('en-US');
  const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const longDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  const DISCORD_ICON = '<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.44.87-.6 1.25a18.27 18.27 0 0 0-5.49 0 12.6 12.6 0 0 0-.62-1.25.08.08 0 0 0-.08-.04 19.74 19.74 0 0 0-4.89 1.52.07.07 0 0 0-.03.03C.53 9.05-.32 13.58.1 18.06a.08.08 0 0 0 .03.06 19.9 19.9 0 0 0 5.99 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.23-1.99a.08.08 0 0 0-.04-.11 13.1 13.1 0 0 1-1.87-.89.08.08 0 0 1-.01-.13l.37-.29a.07.07 0 0 1 .08-.01c3.93 1.79 8.18 1.79 12.06 0a.07.07 0 0 1 .08.01l.37.29a.08.08 0 0 1-.01.13c-.6.35-1.22.65-1.87.89a.08.08 0 0 0-.04.11c.36.7.78 1.36 1.23 1.99a.08.08 0 0 0 .08.03 19.84 19.84 0 0 0 6-3.03.08.08 0 0 0 .03-.06c.5-5.18-.84-9.67-3.55-13.66a.06.06 0 0 0-.03-.03zM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.96 2.42-2.16 2.42zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.95 2.42-2.16 2.42z"/></svg>';
  const REGION_ICONS = { europe: '🌍', africa: '🌍', 'north-america': '🌎', 'south-america': '🌎', asia: '🌏', oceania: '🌏' };
  const CUP_COLORS = ['#e5352b', '#ff8a00', '#ffc928', '#a855f7', '#2d8cff', '#ffd34d', '#2ecc71', '#f97316', '#38bdf8', '#eab308', '#22c55e', '#f43f5e',
    '#fbbf24', '#ec4899', '#a3e635', '#60a5fa', '#94a3b8', '#818cf8', '#fb7185', '#34d399', '#c084fc', '#f472b6', '#d97706', '#4ade80'];

  // ---------- URLs ----------
  const withQuery = (path, params) => {
    const q = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false);
    return q.length ? `${path}?${q.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}` : path;
  };
  const ccParam = (cc) => (Number(cc) === 200 ? 200 : undefined); // 150cc is the default, no parameter
  const url = {
    home: () => '/',
    tracks: (cc) => withQuery('/tracks', { cc: ccParam(cc) }),
    track: (id, cc = 150, f = {}) => withQuery(`/track/${id}/${Number(cc) === 200 ? 200 : 150}cc`, { country: f.country, region: f.region }),
    players: (cc, f = {}) => withQuery('/players', { cc: ccParam(cc), country: f.country, region: f.region }),
    player: (id, cc) => withQuery(`/player/${id}`, { cc: ccParam(cc) }),
    countries: (cc) => withQuery('/countries', { cc: ccParam(cc) }),
    regions: (cc) => withQuery('/regions', { cc: ccParam(cc) }),
    submit: (track) => withQuery('/submit', { track }),
  };

  return function createRenderer(meta) {
    const L = meta.legal;
    const countryByCode = Object.fromEntries(meta.countries.map((c) => [c.code, c]));
    const trackById = Object.fromEntries(meta.tracks.map((t) => [t.id, t]));
    const regionById = Object.fromEntries(meta.regions.map((r) => [r.id, r]));
    const countryName = (code) => countryByCode[code]?.name || code;
    const regionName = (id) => regionById[id]?.name || 'Other';

    const flag = (code) => (code ? `<img class="flag" src="/flags/${esc(code.toLowerCase())}.svg" alt="${esc(countryName(code))}" title="${esc(countryName(code))}" width="22" height="15" loading="lazy">` : '');
    const rank = (r) => `<span class="rank rank-${r <= 3 ? r : 'x'}">${r}</span>`;
    const playerLink = (id, name, cc) => `<a class="player-link" href="${url.player(id, cc)}">${esc(name)}</a>`;
    const proofHref = (r) => r.proof_url || (r.proof_file ? `/uploads/${r.proof_file}` : null);
    const proofCell = (r) => { const h = proofHref(r); return h ? `<a class="proof" href="${esc(h)}" target="_blank" rel="noopener noreferrer nofollow">View ▸</a>` : ''; };
    // Track image, or a placeholder in the cup's colours when public/tracks has no image for it
    const cupColor = (t) => CUP_COLORS[t.cupIndex] || '#e5352b';
    const initials = (name) => name.replace(/^(Wii|GBA|DS|3DS|N64|GCN|SNES|Tour)\s+/, '').split(/[\s-]+/).filter(Boolean)
      .slice(0, 3).map((w) => w[0]).join('').toUpperCase();
    const trackImage = (t, cls = 'track-img') => (t.image
      ? `<span class="${cls}"><img src="${esc(t.image)}" alt="" loading="lazy" decoding="async"></span>`
      : `<span class="${cls} track-ph" style="--c:${cupColor(t)}" aria-hidden="true"><b>${esc(initials(t.name))}</b></span>`);
    const recordsPill = (n) => (n ? `<span class="pill pill-wr">🏆 ${n}</span>` : '0');
    const empty = (title, text) => `<div class="card empty"><b>${title}</b>${text}</div>`;

    // Engine class switch: real links, so they work without JavaScript and can be crawled
    const ccToggle = (cc, hrefFor) => `<nav class="seg" aria-label="Engine class">${[150, 200].map((c) =>
      `<a href="${hrefFor(c)}" class="${Number(cc) === c ? 'on' : ''}"${Number(cc) === c ? ' aria-current="page"' : ''}>${c}cc</a>`).join('')}</nav>`;
    const countryOptions = (selected, placeholder = 'All countries') => `<option value="">${placeholder}</option>${meta.countries.map((c) =>
      `<option value="${c.code}" ${c.code === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`;
    const regionSelect = (region) => `<select id="region" aria-label="Region"><option value="">All regions</option>${meta.regions
      .map((r) => `<option value="${r.id}" ${r.id === region ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>`;

    // ---------- Routing (shared by server and browser) ----------
    function parseRoute(pathname, search) {
      const q = new URLSearchParams(search || '');
      const cc = q.get('cc') === '200' ? 200 : 150;
      const country = countryByCode[(q.get('country') || '').toUpperCase()] ? q.get('country').toUpperCase() : '';
      const region = regionById[q.get('region')] ? q.get('region') : '';
      let parts;
      try { parts = pathname.split('/').filter(Boolean).map(decodeURIComponent); } catch { return { view: 'notfound' }; }
      const [p0 = '', p1, p2] = parts;
      const n = parts.length;
      if (n === 0) return { view: 'home' };
      if (n === 1 && p0 === 'tracks') return { view: 'tracks', cc };
      if (p0 === 'track' && trackById[p1]) {
        if (n === 2) return { redirect: url.track(p1, 150) };
        if (n === 3 && /^(150|200)cc$/.test(p2)) return { view: 'track', id: p1, cc: parseInt(p2, 10), country, region };
      }
      if (n === 1 && p0 === 'players') return { view: 'players', cc, country, region };
      if (n === 2 && p0 === 'player' && /^\d+$/.test(p1)) return { view: 'player', id: Number(p1), cc };
      if (n === 1 && p0 === 'countries') return { view: 'countries', cc };
      if (n === 1 && p0 === 'regions') return { view: 'regions', cc };
      if (n === 1 && p0 === 'submit') return { view: 'submit', track: trackById[q.get('track')] ? q.get('track') : '', fresh: q.has('new') };
      if (n === 1 && ['terms', 'privacy', 'legal', 'points'].includes(p0)) return { view: p0 };
      if (n === 1 && p0 === 'account') return { view: 'account', error: q.get('error') || '' };
      if (n === 1 && p0 === 'admin') return { view: 'admin' };
      return { view: 'notfound' };
    }

    // Canonical URL of a route: filters are not part of it, the engine class is
    function canonicalPath(route) {
      switch (route.view) {
        case 'home': return '/';
        case 'tracks': return url.tracks(route.cc);
        case 'track': return url.track(route.id, route.cc);
        case 'players': return url.players(route.cc);
        case 'player': return url.player(route.id, route.cc);
        case 'countries': return url.countries(route.cc);
        case 'regions': return url.regions(route.cc);
        case 'submit': return '/submit';
        default: return `/${route.view}`;
      }
    }

    // Old links of the form /#/track/xxx
    function fromLegacyHash(hash) {
      if (!hash || !hash.startsWith('#/')) return null;
      const [path, query] = hash.slice(1).split('?');
      const m = /^\/track\/([^/]+)$/.exec(path);
      return m ? url.track(m[1], 150) : `${path}${query ? `?${query}` : ''}`;
    }

    // ---------- Pages ----------
    // Each page returns { html, title, description, crumbs, jsonLd, noindex }
    const SITE = L.siteName;
    const suffix = ` | ${SITE}`;
    const crumb = (name, path) => ({ name, path });

    function home(route, { recent, stats: s }) {
      return {
        title: `${SITE} – Mario Kart 8 Deluxe Time Trial Leaderboard & Records`,
        description: `Mario Kart 8 Deluxe time trial leaderboard: world records and rankings in 150cc and 200cc on all 96 tracks. ${num(s.approved)} verified times from ${num(s.players)} players in ${num(s.countries)} countries.`,
        crumbs: [],
        jsonLd: [{
          '@context': 'https://schema.org', '@type': 'WebSite', name: SITE, url: `${L.siteUrl}/`,
          description: 'Community time trial leaderboard for Mario Kart 8 Deluxe (150cc and 200cc).',
        }, {
          '@context': 'https://schema.org', '@type': 'Organization', name: SITE, url: `${L.siteUrl}/`, logo: `${L.siteUrl}/logo.png`,
        }],
        html: `
    <section class="hero">
      <div class="card hero-main">
        <h1>The Mario Kart 8 Deluxe <span>time trial</span> leaderboard</h1>
        <p>Submit your best times in 150cc and 200cc on all 96 tracks. Every time is checked by our moderators before it shows up on the leaderboard.</p>
        <div class="toolbar">
          <a class="btn btn-primary" href="/submit">Submit a time</a>
          <a class="btn" href="/tracks">Browse tracks</a>
          ${L.discordInvite ? `<a class="btn btn-discord" href="${esc(L.discordInvite)}" target="_blank" rel="noopener">${DISCORD_ICON}Join the Discord</a>` : ''}
        </div>
      </div>
      <div class="stats">
        <div class="card stat"><b>${num(s.players)}</b><span>ranked players</span></div>
        <div class="card stat"><b>${num(s.approved)}</b><span>approved times</span></div>
        <div class="card stat"><b>${num(s.countries)}</b><span>countries</span></div>
        <div class="card stat"><b>${num(s.pending)}</b><span>awaiting review</span></div>
      </div>
    </section>
    <h2 class="section-title">Latest approved times</h2>
    ${recent.length ? `<div class="card table-wrap"><table>
      <thead><tr><th>Player</th><th>Track</th><th>Class</th><th class="num">Time</th></tr></thead>
      <tbody>${recent.map((r) => `<tr>
        <td>${flag(r.country)}${playerLink(r.player_id, r.name, r.cc)}</td>
        <td><a class="player-link" href="${url.track(r.track_id, r.cc)}">${esc(trackById[r.track_id]?.name)}</a></td>
        <td><span class="pill pill-cc">${r.cc}cc</span></td>
        <td class="num time">${fmt(r.time_ms)}</td></tr>`).join('')}</tbody></table></div>`
    : empty('No times yet', 'Be the first to submit one!')}
    <section class="about">
      <h2 class="section-title">A Mario Kart 8 Deluxe leaderboard for every player</h2>
      <div class="about-grid">
        <div class="card card-pad">
          <h3>All 96 tracks, 150cc and 200cc</h3>
          <p>Every Mario Kart 8 Deluxe track has its own time trial leaderboard in 150cc and 200cc, from Mario Kart Stadium to the
            Booster Course Pass. See the <a href="/tracks">150cc world records</a> or the <a href="/tracks?cc=200">200cc world records</a> on every track.</p>
        </div>
        <div class="card card-pad">
          <h3>Verified times</h3>
          <p>Each time is sent with a video or screenshot proof and checked by a moderator before it appears on the leaderboard.
            Players confirm their identity with Discord, so nobody can post times under your name. <a href="/submit">Submit your time</a>.</p>
        </div>
        <div class="card card-pad">
          <h3>Rankings by player, country and region</h3>
          <p>Points reward both speed and the number of tracks played. Compare the best <a href="/players">Mario Kart 8 Deluxe players</a>,
            <a href="/countries">countries</a> and <a href="/regions">regions</a> (Europe, the Americas, Asia…). <a href="/points">How points work</a>.</p>
        </div>
      </div>
    </section>`,
      };
    }

    function tracks(route, { records }) {
      const { cc } = route;
      const wr = Object.fromEntries(records.map((r) => [r.track_id, r]));
      const byCup = meta.cups.map((cup, i) => ({ cup, i, list: meta.tracks.filter((t) => t.cupIndex === i) }));
      return {
        title: `Mario Kart 8 Deluxe ${cc}cc World Records – All 96 Tracks${suffix}`,
        description: `Current ${cc}cc time trial record on every Mario Kart 8 Deluxe track, from Mario Kart Stadium to the Booster Course Pass. Click a track for the full leaderboard.`,
        crumbs: [crumb('Tracks', url.tracks(cc))],
        html: `
    <div class="page-head"><div><h1>Mario Kart 8 Deluxe ${cc}cc world records</h1><p>The current ${cc}cc time trial record on all 96 tracks, base game and Booster Course Pass. Click a track to see its full leaderboard.</p></div>
      <div class="toolbar"><input id="q" type="search" placeholder="Search a track…" aria-label="Search a track">${ccToggle(cc, url.tracks)}</div></div>
    <div id="cups">${byCup.map(({ cup, i, list }) => `
      <section class="cup" data-cup>
        <h2><span style="color:${CUP_COLORS[i]}" aria-hidden="true">●</span>${esc(cup)}${i >= 12 ? ' <span class="pill">Booster Pass</span>' : ''}</h2>
        <div class="tracks">${list.map((t) => {
          const r = wr[t.id];
          return `<a class="track" href="${url.track(t.id, cc)}" style="--c:${CUP_COLORS[i]}" data-name="${esc(t.name.toLowerCase())}">
            ${trackImage(t)}
            <span class="track-body">
              <span class="track-name">${esc(t.name)}</span>
              <span class="track-wr">${r ? `<span>${flag(r.country)}${esc(r.name)}</span><span class="time">${fmt(r.time_ms)}</span>` : '<span>No time yet</span>'}</span>
            </span>
          </a>`;
        }).join('')}</div>
      </section>`).join('')}</div>`,
      };
    }

    function track(route, { rows }) {
      const t = trackById[route.id];
      const { cc, country, region } = route;
      const filtered = Boolean(country || region);
      const top = rows.slice(0, 3);
      const wr = rows[0];
      const other = cc === 200 ? 150 : 200;
      const intro = wr && !filtered
        ? `Current ${cc}cc record: <b>${fmt(wr.time_ms)}</b> by ${flag(wr.country)}<b>${esc(wr.name)}</b>. ${rows.length} player${rows.length > 1 ? 's' : ''} ranked.`
        : `${esc(t.cup)} · ${t.dlc ? 'Booster Course Pass' : 'Base game'}`;
      return {
        title: `${t.name} ${cc}cc World Record – Mario Kart 8 Deluxe${suffix}`,
        description: wr
          ? `${t.name} ${cc}cc record in Mario Kart 8 Deluxe: ${fmt(wr.time_ms)} by ${wr.name} (${countryName(wr.country)}). Full time trial leaderboard with ${rows.length} ranked player${rows.length > 1 ? 's' : ''} and video proofs.`
          : `${t.name} ${cc}cc time trial leaderboard for Mario Kart 8 Deluxe (${t.cup}). No time yet: submit yours and set the first record!`,
        crumbs: [crumb('Tracks', url.tracks(cc)), crumb(`${t.name} ${cc}cc`, url.track(t.id, cc))],
        jsonLd: rows.length ? [{
          '@context': 'https://schema.org', '@type': 'ItemList', name: `${t.name} ${cc}cc leaderboard – Mario Kart 8 Deluxe`,
          numberOfItems: rows.length,
          itemListElement: rows.slice(0, 10).map((r, i) => ({ '@type': 'ListItem', position: i + 1, name: `${r.name} – ${fmt(r.time_ms)}`, url: `${L.siteUrl}${url.player(r.player_id, cc)}` })),
        }] : [],
        html: `
    <div class="page-head"><div><p class="crumbs"><a class="player-link" href="${url.tracks(cc)}">← Tracks</a> · Mario Kart 8 Deluxe · ${esc(t.cup)}</p>
        <h1>${esc(t.name)} <span class="h1-cc">${cc}cc</span></h1><p>${intro}</p></div>
      <div class="toolbar"><select id="country" aria-label="Country">${countryOptions(country)}</select>${regionSelect(region)}${ccToggle(cc, (c) => url.track(t.id, c, { country, region }))}</div></div>
    ${rows.length >= 3 ? `<div class="podium">${[1, 0, 2].map((i) => `<div class="card ${i === 0 ? 'p1' : ''}">
        ${rank(i + 1)}<div class="name">${flag(top[i].country)}${playerLink(top[i].player_id, top[i].name, cc)}</div>
        <div class="time">${fmt(top[i].time_ms)}</div><div class="gap">${gap(top[i].time_ms, top[0].time_ms) || 'Record'}</div></div>`).join('')}</div>` : ''}
    ${rows.length ? `<div class="card table-wrap"><table>
      <thead><tr><th>#</th><th>Player</th><th class="hide-sm">Region</th><th class="num">Time</th><th class="num hide-sm">Gap</th><th class="num">Points</th><th>Proof</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr>
        <td>${rank(filtered ? i + 1 : r.world_rank)}</td>
        <td>${flag(r.country)}${playerLink(r.player_id, r.name, cc)}${filtered ? ` <span class="pill">${ordinal(r.world_rank)} worldwide</span>` : ''}</td>
        <td class="hide-sm muted">${esc(regionName(r.region))}</td>
        <td class="num time">${fmt(r.time_ms)}</td>
        <td class="num gap hide-sm">${gap(r.time_ms, rows[0].time_ms)}</td>
        <td class="num">${num(r.points)}</td>
        <td>${proofCell(r)}</td></tr>`).join('')}</tbody></table></div>`
    : empty('No approved times', `No ${cc}cc time yet${filtered ? ' for this filter' : ''}. <a href="${url.submit(t.id)}">Submit yours!</a>`)}
    <p class="see-also">See also: <a href="${url.track(t.id, other)}">${esc(t.name)} ${other}cc leaderboard</a> · <a href="${url.tracks(cc)}">all ${cc}cc track records</a></p>`,
      };
    }

    function players(route, { rows }) {
      const { cc, country, region } = route;
      return {
        title: `Mario Kart 8 Deluxe ${cc}cc Player Rankings${suffix}`,
        description: `Best Mario Kart 8 Deluxe time trial players in ${cc}cc, ranked by points over all 96 tracks: records held, tracks played and total points.`,
        crumbs: [crumb('Players', url.players(cc))],
        html: `
    <div class="page-head"><div><h1>Mario Kart 8 Deluxe ${cc}cc player rankings</h1><p>The best Mario Kart 8 Deluxe time trial players, ranked by points on all tracks (1,000 points per record). <a class="player-link" href="/points">How points work</a></p></div>
      <div class="toolbar"><select id="country" aria-label="Country">${countryOptions(country)}</select>${regionSelect(region)}${ccToggle(cc, (c) => url.players(c, { country, region }))}</div></div>
    ${rows.length ? `<div class="card table-wrap"><table>
      <thead><tr><th>#</th><th>Player</th><th class="hide-sm">Region</th><th class="num">Tracks</th><th class="num">Records</th><th class="num">Points</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr>
        <td>${rank(i + 1)}</td>
        <td>${flag(r.country)}${playerLink(r.player_id, r.name, cc)}</td>
        <td class="hide-sm muted">${esc(regionName(r.region))}</td>
        <td class="num">${r.tracks}/96</td>
        <td class="num">${recordsPill(r.records)}</td>
        <td class="num time">${num(r.points)}</td></tr>`).join('')}</tbody></table></div>`
    : empty('No ranked players', 'No approved times for this filter.')}`,
      };
    }

    function player(route, { player: p, records }) {
      const { cc } = route;
      const list = records.filter((r) => r.cc === cc);
      const pts = list.reduce((a, r) => a + r.points, 0);
      const wrs = list.filter((r) => r.world_rank === 1).length;
      const allWrs = records.filter((r) => r.world_rank === 1).length;
      return {
        title: `${p.name} – Mario Kart 8 Deluxe ${cc}cc Times & Records${suffix}`,
        description: `${p.name} (${countryName(p.country)}) on the Mario Kart 8 Deluxe time trial leaderboard: ${list.length} track${list.length === 1 ? '' : 's'} in ${cc}cc, ${wrs} record${wrs === 1 ? '' : 's'}, ${num(pts)} points.`,
        crumbs: [crumb('Players', url.players(cc)), crumb(p.name, url.player(p.id, cc))],
        jsonLd: [{
          '@context': 'https://schema.org', '@type': 'ProfilePage', dateCreated: `${p.created_at.replace(' ', 'T')}Z`,
          mainEntity: {
            '@type': 'Person', name: p.name, nationality: { '@type': 'Country', name: countryName(p.country) },
            description: `Mario Kart 8 Deluxe time trial player – ${allWrs} record${allWrs === 1 ? '' : 's'}`,
          },
        }],
        html: `
    <div class="page-head"><div class="profile-head">
        <div class="avatar" aria-hidden="true">${esc(p.name[0].toUpperCase())}</div>
        <div><h1>${esc(p.name)}</h1><p>${flag(p.country)}${esc(countryName(p.country))} · ${esc(regionName(p.region))}</p></div>
      </div>${ccToggle(cc, (c) => url.player(p.id, c))}</div>
    <div class="stats" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
      <div class="card stat"><b>${num(pts)}</b><span>${cc}cc points</span></div>
      <div class="card stat"><b>${list.length}/96</b><span>tracks played</span></div>
      <div class="card stat"><b>${wrs}</b><span>records</span></div>
    </div>
    ${list.length ? `<div class="card table-wrap"><table>
      <thead><tr><th>Track</th><th class="hide-sm">Cup</th><th class="num">Time</th><th class="num">Rank</th><th class="num hide-sm">Gap to record</th><th class="num">Points</th><th>Proof</th></tr></thead>
      <tbody>${list.map((r) => `<tr>
        <td><a class="player-link" href="${url.track(r.track_id, cc)}">${esc(trackById[r.track_id]?.name)}</a></td>
        <td class="hide-sm muted">${esc(trackById[r.track_id]?.cup)}</td>
        <td class="num time">${fmt(r.time_ms)}</td>
        <td class="num">${r.world_rank === 1 ? '<span class="pill pill-wr">🏆 Record</span>' : `${r.world_rank}/${r.total}`}</td>
        <td class="num gap hide-sm">${gap(r.time_ms, r.wr_ms) || '—'}</td>
        <td class="num">${num(r.points)}</td>
        <td>${proofCell(r)}</td></tr>`).join('')}</tbody></table></div>`
    : empty(`No ${cc}cc times`, 'This player has no approved time in this class yet.')}`,
      };
    }

    function countries(route, { rows }) {
      const { cc } = route;
      return {
        title: `Mario Kart 8 Deluxe ${cc}cc Country Rankings${suffix}`,
        description: `Which country has the best Mario Kart 8 Deluxe time trial players? ${cc}cc ranking by country: players, records and total points.`,
        crumbs: [crumb('Countries', url.countries(cc))],
        html: `
    <div class="page-head"><div><h1>Mario Kart 8 Deluxe ${cc}cc country rankings</h1><p>Which country has the fastest Mario Kart 8 Deluxe players? Sum of the points of every player from each country.</p></div>${ccToggle(cc, url.countries)}</div>
    ${rows.length ? `<div class="card table-wrap"><table>
      <thead><tr><th>#</th><th>Country</th><th class="hide-sm">Region</th><th class="num">Players</th><th class="num">Records</th><th class="hide-sm">Top player</th><th class="num">Points</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr>
        <td>${rank(i + 1)}</td>
        <td><a class="player-link" href="${url.players(cc, { country: r.country })}">${flag(r.country)}${esc(countryName(r.country))}</a></td>
        <td class="hide-sm muted">${esc(regionName(countryByCode[r.country]?.region))}</td>
        <td class="num">${r.players}</td>
        <td class="num">${recordsPill(r.records)}</td>
        <td class="hide-sm">${esc(r.top_player)}</td>
        <td class="num time">${num(r.points)}</td></tr>`).join('')}</tbody></table></div>`
    : empty('No ranked countries', 'No approved times yet.')}`,
      };
    }

    function regions(route, { rows }) {
      const { cc } = route;
      return {
        title: `Mario Kart 8 Deluxe ${cc}cc Rankings by Region${suffix}`,
        description: `Europe vs North America vs Asia and the rest of the world: Mario Kart 8 Deluxe ${cc}cc time trial ranking by region.`,
        crumbs: [crumb('Regions', url.regions(cc))],
        html: `
    <div class="page-head"><div><h1>Mario Kart 8 Deluxe ${cc}cc region rankings</h1><p>Europe vs the Americas vs the rest of the world: sum of the points of every player from each region.</p></div>${ccToggle(cc, url.regions)}</div>
    ${rows.length ? `<div class="card table-wrap"><table>
      <thead><tr><th>#</th><th>Region</th><th class="num">Countries</th><th class="num">Players</th><th class="num">Records</th><th class="hide-sm">Top player</th><th class="num">Points</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr>
        <td>${rank(i + 1)}</td>
        <td><a class="player-link" href="${url.players(cc, { region: r.region })}"><span class="region-icon" aria-hidden="true">${REGION_ICONS[r.region] || '🌐'}</span>${esc(regionName(r.region))}</a></td>
        <td class="num">${r.countries}</td>
        <td class="num">${r.players}</td>
        <td class="num">${recordsPill(r.records)}</td>
        <td class="hide-sm">${flag(r.top_country)}${esc(r.top_player)}</td>
        <td class="num time">${num(r.points)}</td></tr>`).join('')}</tbody></table></div>`
    : empty('No ranked regions', 'No approved times yet.')}`,
      };
    }

    // The form is rendered on the server too; the browser fills in the saved player name and handles it
    // Track picker with thumbnails (the browser makes it interactive, see app.js)
    function trackPicker(selected) {
      const sel = trackById[selected];
      const current = (t) => (t ? `${trackImage(t, 'tp-thumb')}<span>${esc(t.name)}</span>` : '<span class="muted">Select a track</span>');
      return `<div class="track-picker" id="trackPicker">
        <input type="hidden" name="track_id" value="${sel ? sel.id : ''}">
        <button type="button" class="tp-button" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="trackLabel tpCurrent">
          <span class="tp-current" id="tpCurrent">${current(sel)}</span><span class="tp-caret" aria-hidden="true">▾</span></button>
        <div class="tp-panel" hidden>
          <input class="tp-search" type="search" placeholder="Search a track…" aria-label="Search a track" autocomplete="off">
          <ul class="tp-list" role="listbox" aria-labelledby="trackLabel">${meta.cups.map((cup, i) => `
            <li class="tp-cup" role="presentation">${esc(cup)}</li>${meta.tracks.filter((t) => t.cupIndex === i).map((t) => `
            <li class="tp-option" role="option" id="tp-${t.id}" data-id="${t.id}" data-name="${esc(t.name.toLowerCase())}" aria-selected="${t.id === selected}" tabindex="-1">
              ${trackImage(t, 'tp-thumb')}<span>${esc(t.name)}</span></li>`).join('')}`).join('')}
            <li class="tp-empty" role="presentation" hidden>No track found</li>
          </ul>
        </div>
      </div>`;
    }

    // extra: { saved: last values typed in this browser, account: logged-in player }
    function submit(route, data, extra = {}) {
      const saved = extra.saved || {};
      const account = extra.account || null;
      const cc = saved.cc === 200 ? 200 : 150;
      const identity = account
        ? `<div class="notice account-notice">Submitting as ${flag(account.country)}<b>${esc(account.name)}</b> (${esc(countryName(account.country))}).
            Your time goes straight to the moderators, no <code>/verif</code> needed. <a href="/account">Change on your account page</a></div>`
        : `<div class="notice login-hint">${DISCORD_ICON}<span><a href="/auth/discord?next=/submit">Log in with Discord</a> to skip the <code>/verif</code> step on every submission.</span></div>
      <div class="row">
        <div class="field"><label for="player_name">Player name</label><input id="player_name" name="player_name" required maxlength="32" value="${esc(saved.player_name || '')}" placeholder="Your nickname" autocomplete="nickname"></div>
        <div class="field"><label for="countrySel">Country</label><select id="countrySel" name="country" required>${countryOptions(saved.country || '', 'Select your country')}</select>
          <div class="hint" id="regionHint"></div></div>
      </div>`;
      return {
        title: `Submit a Mario Kart 8 Deluxe time trial record${suffix}`,
        description: 'Submit your Mario Kart 8 Deluxe time trial time (150cc or 200cc) with a video or screenshot proof. Verified by our moderators.',
        crumbs: [crumb('Submit a time', '/submit')],
        html: `
    <div class="page-head"><div><h1>Submit a time</h1><p>${account ? 'A moderator checks your time before it appears on the leaderboard.'
      : "After sending, you'll confirm it's you on our Discord server with <code>/verif</code>. A moderator then checks your time before it appears on the leaderboard."}</p></div></div>
    <form id="form" class="card card-pad form-card" novalidate>
      <div id="msg"></div>
      <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      ${identity}
      <div class="row">
        <div class="field"><label id="trackLabel">Track</label>${trackPicker(route.track)}</div>
        <div class="field"><label>Engine class</label>
          <div class="seg" id="ccSeg">${[150, 200].map((c) => `<button type="button" data-v="${c}" class="${cc === c ? 'on' : ''}">${c}cc</button>`).join('')}</div>
          <input type="hidden" name="cc" value="${cc}"></div>
      </div>
      <div class="field"><label for="time">Time</label><input id="time" name="time" required placeholder="1:45.123" inputmode="decimal">
        <div class="hint">Format minutes:seconds.milliseconds — e.g. 1:45.123</div></div>
      <div class="field"><label>Proof</label>
        <div class="proof-switch seg" id="proofSeg"><button type="button" data-p="url" class="on">Link</button><button type="button" data-p="file">File</button></div>
        <div id="proofUrl"><input name="proof_url" type="url" placeholder="https://youtu.be/… or https://x.com/…" aria-label="Proof link"></div>
        <label id="proofFile" class="dropzone" style="display:none"><input type="file" name="proof_file" accept="image/*,video/*">
          <span id="fileLabel">Drop a screenshot or video here, or click to choose one (max 50 MB)</span></label>
        <div class="hint">Screenshot of the ghost / results screen, or a YouTube, Twitch or X video.</div></div>
      <div class="field"><label for="comment">Comment <span class="muted">(optional)</span></label><textarea id="comment" name="comment" rows="2" maxlength="500" placeholder="Combo used, useful info…"></textarea></div>
      <div class="notice">Once approved, your <b>player name, country, time and proof</b> are shown publicly on this site. ${account
    ? 'Your submission is sent to our moderators through Discord, with your Discord account.'
    : "You'll need a Discord account to confirm your submission; it is then sent to our moderators through Discord."} See the <a href="/privacy">Privacy Policy</a>.</div>
      <div class="field"><label class="consent"><input type="checkbox" name="accept_terms" required>
        <span>I confirm this time was set by me, without cheats or modifications, and I accept the <a href="/terms" target="_blank">Terms of Use</a> and the <a href="/privacy" target="_blank">Privacy Policy</a>.</span></label></div>
      <button class="btn btn-primary" id="sendBtn" type="submit">Send for review</button>
    </form>`,
      };
    }

    // ---------- Legal pages ----------
    // Values come from the server configuration (.env); placeholders are highlighted until they are filled in
    const v = (val) => (/^\[.*\]$/.test(val) ? `<span class="ph">${esc(val)}</span>` : esc(val));
    const mail = (m) => (/^\[.*\]$/.test(m) ? v(m) : `<a href="mailto:${esc(m)}">${esc(m)}</a>`);
    const legalPage = (title, description, path, body) => ({
      title: `${title}${suffix}`, description, crumbs: [crumb(title, path)],
      html: `
    <div class="page-head"><div><h1>${title}</h1><p>Last updated: ${longDate(L.updated)}</p></div></div>
    <article class="card legal">${body}</article>`,
    });

    const terms = () => legalPage('Terms of Use', `Terms of Use of ${SITE}, the Mario Kart 8 Deluxe time trial leaderboard.`, '/terms', `
    <h2>1. Purpose</h2>
    <p>These Terms of Use govern access to and use of <b>${esc(L.siteName)}</b> (${esc(L.siteUrl)}), a free, unofficial, community-run leaderboard for Mario Kart 8 Deluxe time trials (the "Site"), published by ${v(L.owner)} (the "Publisher").</p>
    <h2>2. Acceptance</h2>
    <p>By browsing the Site you agree to these Terms. Submitting a time requires you to explicitly accept them together with the <a href="/privacy">Privacy Policy</a>. If you do not agree, please do not use the Site.</p>
    <h2>3. Access to the Site</h2>
    <p>The Site is free. Browsing does not require an account; an optional account can be created by logging in with Discord. The Publisher makes reasonable efforts to keep it available but does not guarantee uninterrupted access and may suspend, modify or close it at any time, in particular for maintenance.</p>
    <p>If you are under the age of digital consent in your country (15 in France, 13 to 16 elsewhere in the EU), you must have the permission of a parent or legal guardian before submitting a time.</p>
    <h2>4. Submitting times</h2>
    <p>When you submit a time, you confirm that:</p>
    <ul>
      <li>the time was set by you, personally, on an unmodified copy of Mario Kart 8 Deluxe running on a Nintendo Switch console;</li>
      <li>no cheat, hacked save, modified game file, emulator speed-up, macro or any other unfair tool was used;</li>
      <li>the proof you provide is genuine, unedited and shows the submitted time;</li>
      <li>you have the right to share the proof (e.g. you made the video or screenshot yourself) and it does not infringe anyone else's rights.</li>
    </ul>
    <p>Each submission must be confirmed with a Discord account: either by logging in with Discord on the Site, or by using the <code>/verif</code> command on our Discord server. The first verified submission links your player name to your Discord account: afterwards, only this account can submit times under that name, and each Discord account can only be linked to one player name. Your player name can be changed from your account page (once every 7 days); to link it to another Discord account, contact a moderator. You can delete your account and all your times at any time from your account page.</p>
    <p>Only one player name may be used per person. Do not submit times under someone else's name.</p>
    <h2>5. Moderation</h2>
    <p>Every submission is reviewed by volunteer moderators before publication. Moderators may approve or reject any submission at their sole discretion, may ask for additional proof, and may remove an approved time or a player from the leaderboard at any time if a rule appears to have been broken. Moderation decisions are not subject to any compensation.</p>
    <h2>6. Content you submit</h2>
    <p>You remain the owner of the proofs you submit. By submitting them, you grant the Publisher a free, non-exclusive, worldwide licence to store, reproduce and display them on the Site and to share them with moderators, for as long as the time is displayed, solely for the purpose of running the leaderboard.</p>
    <p>You must not submit content that is illegal, offensive, hateful, sexually explicit, violent, defamatory, contains personal data of other people, or is unrelated to the submitted time. The same applies to player names and comments.</p>
    <h2>7. Prohibited behaviour</h2>
    <ul>
      <li>Attempting to disrupt, overload or gain unauthorised access to the Site or its database;</li>
      <li>Sending spam or automated submissions;</li>
      <li>Impersonating another player or a moderator;</li>
      <li>Harassing other players or moderators.</li>
    </ul>
    <p>Any breach may lead to the removal of your times and a ban from submitting.</p>
    <h2>8. Intellectual property</h2>
    <p>Mario Kart, Nintendo Switch and the names of tracks and cups are trademarks of Nintendo. The Site is a fan project, is not affiliated with, endorsed or sponsored by Nintendo${L.trackImages
    ? '. Track preview images are screenshots of Mario Kart 8 Deluxe, © Nintendo, shown only to help identify the tracks; they will be removed on request of the rights holder'
    : ', and does not use any game assets'}. All other elements of the Site (design, code, texts) belong to the Publisher, unless stated otherwise.</p>
    <h2>9. Liability</h2>
    <p>The Site and the leaderboards are provided "as is", for entertainment purposes only. The Publisher does not guarantee that the rankings are complete or error-free and cannot be held liable for any indirect damage resulting from the use of the Site. External links (videos, social networks) are under the sole responsibility of their publishers.</p>
    <h2>10. Personal data</h2>
    <p>The processing of your personal data is described in the <a href="/privacy">Privacy Policy</a>.</p>
    <h2>11. Changes</h2>
    <p>These Terms may be updated at any time. The date of the last update is shown at the top of this page. Continuing to use the Site after a change means you accept the new version.</p>
    <h2>12. Governing law</h2>
    <p>These Terms are governed by French law. In the event of a dispute, please contact us first so we can try to find an amicable solution. If no solution is found, the competent French courts will have jurisdiction, without prejudice to any mandatory consumer protection rules of your country of residence.</p>
    <h2>13. Contact</h2>
    <p>Any question about these Terms: ${mail(L.contactEmail)}${L.discordInvite ? ` or on our <a href="${esc(L.discordInvite)}" target="_blank" rel="noopener">Discord server</a>` : ''}.</p>`);
    const privacy = () => legalPage('Privacy Policy', `How ${SITE} handles your personal data (GDPR).`, '/privacy', `
    <p>This policy explains what personal data <b>${esc(L.siteName)}</b> collects, why, and what your rights are, in accordance with the EU General Data Protection Regulation (GDPR).</p>
    <h2>1. Data controller</h2>
    <p>${v(L.owner)}, ${v(L.ownerAddress)} — contact: ${mail(L.contactEmail)}.</p>
    <h2>2. Data we collect</h2>
    <p><b>When you submit a time</b> (all provided by you):</p>
    <ul>
      <li>player name and country (your world region, e.g. Europe, is deduced from your country);</li>
      <li>track, engine class and time;</li>
      <li>your proof: a link or an uploaded image/video — note that a proof may contain your in-game name, your voice or your image if you include them;</li>
      <li>an optional comment;</li>
      <li>your <b>Discord user ID and username</b>, when you confirm the submission with <code>/verif</code>;</li>
      <li>if you <b>log in with Discord</b>: your Discord user ID, username and avatar. We never receive your email address or password, and we do not keep the access token Discord gives us. While you are logged in, we also record the time of your last activity on the Site (at most once a minute), used only for the Site's internal statistics (e.g. number of players online) and deleted with your session;</li>
      <li>the date of submission, and the review result (approved/rejected, moderator name, optional reason).</li>
    </ul>
    <p><b>Technical data:</b> your IP address is used temporarily, in memory only, to limit the number of submissions (anti-spam). It is never written to our database and is forgotten within 10 minutes. Our hosting provider may keep standard server logs for security purposes.</p>
    <p>We do not ask for your email address or real name, and we do not use any analytics or advertising tools.</p>
    <h2>3. Purposes and legal bases</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Purpose</th><th>Legal basis</th></tr></thead>
      <tbody>
        <tr><td>Reviewing your submission and publishing it on the leaderboards</td><td>Performance of the service you request by accepting the Terms of Use (Art. 6(1)(b) GDPR)</td></tr>
        <tr><td>Checking that you own your player name (Discord verification) and sending you notifications by Discord direct message (review status, overtaken in a top 10)</td><td>Performance of the service you request (Art. 6(1)(b) GDPR) and our legitimate interest in preventing impersonation (Art. 6(1)(f) GDPR)</td></tr>
        <tr><td>Preventing spam and abuse</td><td>Our legitimate interest in keeping the Site working (Art. 6(1)(f) GDPR)</td></tr>
        <tr><td>Answering your requests</td><td>Our legitimate interest / legal obligations</td></tr>
      </tbody></table></div>
    <h2>4. What is public</h2>
    <p>Once a time is approved, the following are <b>publicly visible</b> on the Site: player name, country and world region, times, rankings, points and proof (link or file). Rejected and pending submissions are never public. The link between your player name and your Discord account is <b>not</b> displayed on the Site; it is only visible to the moderators.</p>
    <h2>5. Who receives your data</h2>
    <ul>
      <li><b>Moderators</b>: each submission is sent, with the Discord account that confirmed it, to a private channel of our Discord server, where volunteer moderators review it. Our Discord bot also sends you direct messages: your verification code, confirmation that your time is waiting for review, the result of the review, and a notice when someone overtakes or ties you in the top 10 of a track. Discord is operated by Discord Inc. (United States); data transferred to it is covered by the EU-US Data Privacy Framework and/or the European Commission's Standard Contractual Clauses. See <a href="https://discord.com/privacy" target="_blank" rel="noopener">Discord's privacy policy</a>.</li>
      <li><b>Our hosting provider</b>: ${v(L.hostName)}, which stores the Site and its database.</li>
    </ul>
    <p>Your data is never sold or used for advertising.</p>
    <h2>6. Retention</h2>
    <ul>
      <li><b>Approved times</b>: kept as long as they are displayed on the leaderboard, or until you ask for their deletion.</li>
      <li><b>Rejected submissions</b>: automatically deleted, including any uploaded file, ${L.rejectedRetentionDays} days after the review.</li>
      <li><b>Pending submissions</b>: kept until they are reviewed. Submissions that are never confirmed on Discord are deleted, including any uploaded file, after 24 hours.</li>
      <li><b>Verification codes</b>: valid for 10 minutes, then deleted.</li>
      <li><b>Link between your player name and your Discord account</b>: kept as long as your player profile exists.</li>
      <li><b>Account</b>: kept until you delete it from your account page, which immediately deletes your profile, all your times and your proof files.</li>
      <li><b>Login sessions</b>: 30 days, or until you log out.</li>
      <li>The Discord review message may remain in the moderators' private channel; it is deleted on request.</li>
    </ul>
    <h2 id="cookies">7. Cookies and local storage</h2>
    <p>The Site uses no tracking or advertising cookies. Only if you log in with Discord, it sets two <b>strictly necessary</b> cookies (which do not require consent): <code>mk8_session</code>, which keeps you logged in for 30 days or until you log out, and <code>mk8_oauth</code>, which lasts 10 minutes during the login and protects it against forged requests. On your account page, your Discord avatar is loaded from Discord's servers.</p>
    <p>When you first visit the Site, a banner lets you <b>accept or refuse</b> these cookies; refusing is as easy as accepting. If you refuse, you can still browse and submit times with <code>/verif</code>, but you cannot log in, and your player name and country are not remembered in the form. Your choice is stored in your browser for 6 months, then asked again; you can change it at any time with the <b>Cookie settings</b> link at the bottom of every page. Logging out or refusing deletes the login cookie.</p>
    <p> It uses your browser's local storage, only on your device, to remember your player name and country (to pre-fill the form). You can clear it at any time from your browser settings. Fonts and flags are hosted on our own server: no third-party service is contacted while you browse, except external proof links you choose to open.</p>
    <h2>8. Your rights</h2>
    <p>You have the right to access, rectify and erase your data, to restrict or object to its processing, and to data portability. If you log in with Discord, you can change your player name and country, and delete your account and all your times yourself, on your account page. Otherwise, or for any other request, contact ${mail(L.contactEmail)}, indicating your player name. As we have no accounts, we may ask you to prove that you own the player name, for example by contacting us from the Discord account linked to it. We answer within one month.</p>
    <p>You also have the right to lodge a complaint with a supervisory authority, such as the CNIL in France (<a href="https://www.cnil.fr" target="_blank" rel="noopener">cnil.fr</a>) or the authority of your country of residence.</p>
    <h2>9. Security</h2>
    <p>We take reasonable measures to protect your data (restricted access to the server and database, moderation limited to authorised Discord members). No system is perfectly secure, however.</p>
    <h2>10. Children</h2>
    <p>If you are under the age of digital consent in your country (15 in France), please ask a parent or legal guardian before submitting a time. A parent can ask us to delete a child's data at any time.</p>
    <h2>11. Changes</h2>
    <p>We may update this policy. The date of the last update is shown at the top of this page.</p>`);
    const legal = () => legalPage('Legal Notice', `Legal notice of ${SITE}: publisher, hosting and credits.`, '/legal', `
    <h2>Publisher</h2>
    <p><b>${v(L.owner)}</b><br>${v(L.ownerAddress)}<br>Email: ${mail(L.contactEmail)}</p>
    <p>Publication director: ${v(L.owner)}</p>
    <h2>Hosting</h2>
    <p><b>${v(L.hostName)}</b><br>${v(L.hostAddress)}</p>
    <h2>Nature of the site</h2>
    <p>${esc(L.siteName)} is a free, non-commercial, fan-made community leaderboard. It is not affiliated with, endorsed or sponsored by Nintendo. Mario Kart and Nintendo Switch are trademarks of Nintendo. Track and cup names${L.trackImages ? ', and the track preview screenshots (© Nintendo),' : ''} are used only to identify the leaderboards.</p>
    <h2>User content</h2>
    <p>Times and proofs are submitted by players and reviewed by volunteer moderators before publication. To report content that you believe is unlawful or infringes your rights, contact ${mail(L.contactEmail)} with the link to the page concerned and the reason for your request; it will be handled promptly.</p>
    <h2>Credits</h2>
    <p>World record data: <a href="https://mkwrs.com/mk8dx/" target="_blank" rel="noopener">mkwrs.com</a>.</p>${L.trackImages ? `
    <p>Track images: in-game course icons of Mario Kart 8 Deluxe, © Nintendo, obtained from the <a href="https://www.mariowiki.com" target="_blank" rel="noopener">Super Mario Wiki</a>.</p>` : ''}
    <p>Flags: <a href="https://github.com/lipis/flag-icons" target="_blank" rel="noopener">flag-icons</a> (MIT licence). Fonts: Inter and Russo One (SIL Open Font License).</p>
    <p>See also the <a href="/terms">Terms of Use</a> and the <a href="/privacy">Privacy Policy</a>.</p>`);
    const points = () => legalPage('How points work', 'How the Mario Kart 8 Deluxe leaderboard points are calculated: 1,000 points for a record, proportional to the record time otherwise.', '/points', `
    <h2>On a track</h2>
    <p>For each track and engine class, only your <b>best approved time</b> counts. You earn:</p>
    <p style="font-size:17px"><b>points = 1,000 × record time ÷ your time</b></p>
    <ul>
      <li>The record holder gets <b>1,000</b> points.</li>
      <li>A time 1% slower than the record is worth about <b>990</b> points.</li>
      <li>A time 10% slower is worth about <b>909</b> points.</li>
    </ul>
    <p>Every track is worth the same, whether it lasts 1:30 or 2:30.</p>
    <h2>Rankings</h2>
    <ul>
      <li><b>Players</b>: sum of your points on all tracks — being fast <i>and</i> playing many tracks both pay off.</li>
      <li><b>Countries</b>: sum of the points of all players from that country.</li>
      <li><b>Regions</b> (Europe, North America, South America, Asia, Africa, Oceania): sum of the points of all players from that part of the world. Your region is deduced from your country.</li>
    </ul>
    <p>When a new record is set, everyone's points on that track are recalculated.</p>`);

    // Personal page: the browser fills it in (see app.js), search engines do not index it
    function account() {
      return {
        title: `My account${suffix}`, description: `Log in to ${SITE} with Discord.`, crumbs: [], noindex: true,
        html: '<div class="page-head"><div><h1>My account</h1><p>Loading…</p></div></div>',
      };
    }

    // Private page filled in by the browser for admins only; looks like any other missing page otherwise
    function admin() {
      return {
        title: `Admin${suffix}`, description: 'Admin', crumbs: [], noindex: true,
        html: '<div class="page-head"><div><h1>Admin</h1><p>Loading…</p></div></div>',
      };
    }

    function notfound() {
      return {
        title: `Page not found${suffix}`, description: 'This page does not exist.', crumbs: [], noindex: true,
        html: `<div class="page-head"><div><h1>Page not found</h1></div></div>${empty('This page does not exist', ' <a href="/">Back to the home page</a>')}`,
      };
    }

    const VIEWS = { home, tracks, track, players, player, countries, regions, submit, terms, privacy, legal, points, account, admin, notfound };

    // Renders a route with its data
    function page(route, data, extra) {
      const p = VIEWS[route.view](route, data || {}, extra);
      const crumbs = p.crumbs || [];
      const jsonLd = [...(p.jsonLd || [])];
      if (crumbs.length) {
        jsonLd.push({
          '@context': 'https://schema.org', '@type': 'BreadcrumbList',
          itemListElement: [crumb('Home', '/'), ...crumbs].map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: `${L.siteUrl}${c.path}` })),
        });
      }
      return { ...p, jsonLd, canonical: `${L.siteUrl}${canonicalPath(route)}` };
    }

    return { parseRoute, canonicalPath, fromLegacyHash, page, url, esc, fmt, regionName, countryName, countryOptions, flag, DISCORD_ICON };
  };
}));
