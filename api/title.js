// Serves index.html for /t/<type>/<id> with Open Graph tags filled from Cinemeta,
// so WhatsApp / Telegram / Discord show title + description + 16:9 background.
// The browser still gets the normal app; script.js reads the id from the URL.
const fs = require('fs');
const path = require('path');

const CINEMETA = 'https://v3-cinemeta.strem.io';
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// one clean line, max ~240 chars, cut at a word boundary (WhatsApp/Telegram show roughly this much)
function shorten(text, max = 240) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 160)).replace(/[\s,.;:!?-]+$/, '') + '…';
}

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
  let injected = false; // true only when the Open Graph tags were really filled from Cinemeta

  if ((type === 'movie' || type === 'series') && /^[\w:.\-%]+$/.test(id)) {
    try {
      const r = await fetch(`${CINEMETA}/meta/${type}/${encodeURIComponent(id)}.json`, { signal: AbortSignal.timeout(6000) });
      const m = r.ok ? (await r.json()).meta : null;
      if (m && m.name) {
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const url = `https://${host}/t/${type}/${encodeURIComponent(id)}`;
        const kind = type === 'movie' ? 'Movie' : 'Series';
        const title = (m.releaseInfo ? `${m.name} (${m.releaseInfo})` : m.name) + ` - ${kind}`;
        const desc = shorten(m.description) || 'Watch on OpenStream';
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
        const pageTitle = `<title>${esc(m.name)} - OpenStream</title>`;
        const headTags = tags + '\n</head>';
        html = html.replace(/<!--og-default-->[\s\S]*?<!--\/og-default-->\n?/, () => '')
                   .replace('<title>OpenStream</title>', () => pageTitle)
                   .replace('</head>', () => headTags);
        injected = true;
      }
    } catch (_) { /* Cinemeta down: fall through to the plain app */ }
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Cinemeta failed / bad link: the plain page is only cached briefly so the real preview can appear on the next try
  res.setHeader('Cache-Control', injected
    ? 'public, s-maxage=86400, stale-while-revalidate=604800'
    : 'public, s-maxage=60, stale-while-revalidate=300');
  res.status(200).send(html);
};
