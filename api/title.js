// Serves index.html for /t/<type>/<id> with Open Graph tags filled from Cinemeta,
// so WhatsApp / Telegram / Discord show title + description + 16:9 background.
// The browser still gets the normal app; script.js reads the id from the URL.
const fs = require('fs');
const path = require('path');

const CINEMETA = 'https://v3-cinemeta.strem.io';
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function loadShell(req) {
  try { return fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8'); } catch (_) {}
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const r = await fetch(`https://${host}/index.html`);
  return r.text();
}

module.exports = async (req, res) => {
  const type = String(req.query.type || '');
  const id = String(req.query.id || '');
  let html = await loadShell(req);

  if ((type === 'movie' || type === 'series') && /^[\w:.\-%]+$/.test(id)) {
    try {
      const r = await fetch(`${CINEMETA}/meta/${type}/${encodeURIComponent(id)}.json`, { signal: AbortSignal.timeout(6000) });
      const m = r.ok ? (await r.json()).meta : null;
      if (m && m.name) {
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const url = `https://${host}/t/${type}/${encodeURIComponent(id)}`;
        const kind = type === 'movie' ? 'Movie' : 'Series';
        const title = (m.releaseInfo ? `${m.name} (${m.releaseInfo})` : m.name) + ` - ${kind}`;
        // line 1: "Series · Horror, Thriller · IMDB: 8.2"   line 2+: the plot
        const genres = (Array.isArray(m.genres) && m.genres.length ? m.genres : (Array.isArray(m.genre) ? m.genre : [])).slice(0, 3).join(', ');
        const rating = m.imdbRating ? `IMDB: ${m.imdbRating}` : '';
        const info = [type === 'movie' ? 'Movie' : 'Series', genres, rating].filter(Boolean).join(' · ');
        const desc = m.description ? `${info}\n${m.description}` : info;
        const img = m.background || m.poster || '';
        const tags = [
          `<meta property="og:type" content="${type === 'movie' ? 'video.movie' : 'video.tv_show'}">`,
          `<meta property="og:site_name" content="OpenStream">`,
          `<meta property="og:url" content="${esc(url)}">`,
          `<meta property="og:title" content="${esc(title)}">`,
          `<meta property="og:description" content="${esc(desc)}">`,
          img && `<meta property="og:image" content="${esc(img)}">`,
          `<meta name="twitter:card" content="summary_large_image">`,
          `<meta name="twitter:title" content="${esc(title)}">`,
          `<meta name="twitter:description" content="${esc(desc)}">`,
          img && `<meta name="twitter:image" content="${esc(img)}">`,
          `<meta name="description" content="${esc(desc)}">`,
        ].filter(Boolean).join('\n');
        html = html.replace(/<!--og-default-->[\s\S]*?<!--\/og-default-->\n?/, '')
                   .replace('<title>OpenStream</title>', `<title>${esc(m.name)} - OpenStream</title>`)
                   .replace('</head>', tags + '\n</head>');
      }
    } catch (_) { /* Cinemeta down: fall through to the plain app */ }
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  res.status(200).send(html);
};
