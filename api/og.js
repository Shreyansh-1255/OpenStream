// GET /api/og?type=movie&id=tt123  ->  1200x630 JPEG for link previews:
// the title's background image with its logo at the bottom-left (like the card on a computer).
// If anything fails it redirects to the plain background, so a preview is never empty.
const sharp = require('sharp');

const CINEMETA = 'https://v3-cinemeta.strem.io';
const W = 1200, H = 630;

async function grab(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(7000), redirect: 'follow' });
  if (!r.ok) throw new Error('image ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

module.exports = async (req, res) => {
  const type = String(req.query.type || '');
  const id = String(req.query.id || '');
  if (!(type === 'movie' || type === 'series') || !/^[\w:.\-%]+$/.test(id)) return res.status(400).send('bad request');

  let m = null;
  try {
    const r = await fetch(`${CINEMETA}/meta/${type}/${encodeURIComponent(id)}.json`, { signal: AbortSignal.timeout(6000) });
    m = r.ok ? (await r.json()).meta : null;
  } catch (_) {}
  const bg = m && (m.background || m.poster);
  if (!bg) return res.status(404).send('no image');

  try {
    const base = sharp(await grab(bg)).resize(W, H, { fit: 'cover', position: 'attention' });
    // dark fade in the bottom-left corner so the logo stays readable on any picture
    const fade = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="1" x2="0.65" y2="0.15"><stop offset="0" stop-color="#000" stop-opacity="0.88"/><stop offset="0.5" stop-color="#000" stop-opacity="0.35"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`);
    const layers = [{ input: fade, left: 0, top: 0 }];

    if (/^https?:\/\//i.test(m.logo || '')) {
      try {
        const logo = await sharp(await grab(m.logo)).resize({ width: 520, height: 190, fit: 'inside' }).png().toBuffer({ resolveWithObject: true });
        layers.push({ input: logo.data, left: 56, top: H - 52 - logo.info.height });
      } catch (_) { /* no usable logo: the plain background is still fine */ }
    }

    const out = await base.composite(layers).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, s-maxage=604800, stale-while-revalidate=2592000');
    return res.status(200).send(out);
  } catch (_) {
    return res.redirect(302, bg);
  }
};
