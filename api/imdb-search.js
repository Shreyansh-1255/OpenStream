// Vercel proxy for IMDb's suggestion search (used only when the browser cannot call IMDb directly).
// GET /api/imdb-search?q=inception  ->  same JSON IMDb returns ({ d: [...] })
module.exports = async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase().slice(0, 100);
  if (!q) return res.status(400).json({ d: [], error: 'missing q' });
  const first = /[a-z0-9]/.test(q[0]) ? q[0] : 'x';
  try {
    const r = await fetch(`https://v3.sg.media-imdb.com/suggestion/${first}/${encodeURIComponent(q)}.json`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return res.status(502).json({ d: [], error: 'imdb ' + r.status });
    const data = await r.json();
    // same query = same answer, so Vercel's CDN can keep it for a while (faster + fewer calls to IMDb)
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(data);
  } catch (_) {
    return res.status(502).json({ d: [], error: 'unreachable' });
  }
};
