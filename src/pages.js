// Server-side rendering of the pages (so search engines get the full content), sitemap.xml and robots.txt
const fs = require('fs');
const path = require('path');
const store = require('./db');
const createRenderer = require('../public/render');

const TEMPLATE = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');

module.exports = function createPages(meta) {
  const R = createRenderer(meta);
  const base = meta.legal.siteUrl;
  const esc = R.esc;

  // Data needed by each view (the same data is served to the browser by /api/page)
  function loadData(route) {
    switch (route.view) {
      case 'home': return { recent: store.recentRecords(12), stats: store.stats() };
      case 'tracks': return { records: store.worldRecords({ cc: route.cc }) };
      case 'track': return { rows: store.trackLeaderboard({ trackId: route.id, cc: route.cc, country: route.country || undefined, region: route.region || undefined }) };
      case 'players': return { rows: store.playerRanking({ cc: route.cc, country: route.country || undefined, region: route.region || undefined }) };
      case 'player': return store.playerProfile(route.id);
      case 'countries': return { rows: store.countryRanking({ cc: route.cc }) };
      case 'regions': return { rows: store.regionRanking({ cc: route.cc }) };
      default: return {};
    }
  }

  // Resolves a URL into { status, redirect } or { status, route, data }
  function resolve(pathname, search) {
    let route = R.parseRoute(pathname, search);
    if (route.redirect) return { status: 301, redirect: route.redirect };
    let data = loadData(route);
    if (!data) { route = { view: 'notfound' }; data = {}; }
    return { status: route.view === 'notfound' ? 404 : 200, route, data };
  }

  // JSON inside <script>: "<" is escaped so the content can never close the tag
  const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

  function html(resolved) {
    const { route, data } = resolved;
    const p = R.page(route, data);
    const ogImage = `${base}/og-image.png`;
    const head = [
      `<title>${esc(p.title)}</title>`,
      `<meta name="description" content="${esc(p.description)}">`,
      p.noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${esc(p.canonical)}">`,
      '<meta property="og:type" content="website">',
      `<meta property="og:site_name" content="${esc(meta.legal.siteName)}">`,
      `<meta property="og:title" content="${esc(p.title)}">`,
      `<meta property="og:description" content="${esc(p.description)}">`,
      `<meta property="og:url" content="${esc(p.canonical)}">`,
      `<meta property="og:image" content="${ogImage}">`,
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
      '<meta name="twitter:card" content="summary_large_image">',
      `<meta name="twitter:title" content="${esc(p.title)}">`,
      `<meta name="twitter:description" content="${esc(p.description)}">`,
      `<meta name="twitter:image" content="${ogImage}">`,
      ...p.jsonLd.map((j) => `<script type="application/ld+json">${safeJson(j)}</script>`),
    ].join('\n  ');
    const section = { track: 'tracks', player: 'players' }[route.view] || route.view;
    return TEMPLATE
      .replace('<!--HEAD-->', () => head)
      .replace(`data-nav="${section}"`, `data-nav="${section}" class="active" aria-current="page"`)
      .replace('<!--APP-->', () => p.html)
      .replace('<!--META-->', () => safeJson(meta));
  }

  // ---------- sitemap.xml ----------
  function sitemap() {
    const urls = [];
    const add = (loc, lastmod, priority) => urls.push({ loc: `${base}${loc}`, lastmod, priority });
    const day = (d) => (d ? d.slice(0, 10) : undefined);

    const lastByTrack = Object.fromEntries(store.db.prepare(`SELECT track_id || ':' || cc AS k, MAX(reviewed_at) AS d
      FROM submissions WHERE status = 'approved' GROUP BY track_id, cc`).all().map((r) => [r.k, r.d]));
    const lastAll = store.db.prepare("SELECT MAX(reviewed_at) AS d FROM submissions WHERE status = 'approved'").get().d;

    add('/', day(lastAll), '1.0');
    for (const cc of [150, 200]) {
      add(R.url.tracks(cc), day(lastAll), '0.9');
      add(R.url.players(cc), day(lastAll), '0.8');
      add(R.url.countries(cc), day(lastAll), '0.6');
      add(R.url.regions(cc), day(lastAll), '0.6');
      meta.tracks.forEach((t) => add(R.url.track(t.id, cc), day(lastByTrack[`${t.id}:${cc}`]), '0.8'));
    }
    store.db.prepare(`SELECT p.id, MAX(s.reviewed_at) AS d FROM players p
      JOIN submissions s ON s.player_id = p.id AND s.status = 'approved' GROUP BY p.id ORDER BY p.id`).all()
      .forEach((p) => add(R.url.player(p.id), day(p.d), '0.5'));
    ['/submit', '/points', '/terms', '/privacy', '/legal'].forEach((u) => add(u, undefined, '0.3'));

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<priority>${u.priority}</priority></url>`).join('\n')}
</urlset>
`;
  }

  function robots() {
    return `User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${base}/sitemap.xml
`;
  }

  return { resolve, html, sitemap, robots, R };
};
