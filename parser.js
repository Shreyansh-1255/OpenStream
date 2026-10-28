/* Media filename decoder (see README). Exposes window.parseMediaName(name). If this file cannot run on an old browser, the app falls back to its simple built-in parser. */
(function () {
'use strict';
// Reference parser for media filenames. Validates the rules written in README.md.

const VIDEO_EXT = /\.(mkv|mp4|avi|m4v|ts|m2ts|webm|mov)$/i;
const TLDS = 'com|net|org|to|tw|lol|lt|mx|tv|ms|cfd|io|cc|xyz|bio|ws|top|buzz|ink|ist|dev';
const DOMAIN = new RegExp(`(?<![A-Za-z0-9])((?:www\\.)?[A-Za-z0-9]+\\.(?:${TLDS}))(?![A-Za-z0-9])`, 'i');
const PREFIX_SITE = new RegExp(`^\\[\\s*((?:www\\.)?[A-Za-z0-9.-]+\\.(?:${TLDS}))\\s*\\]\\s*`, 'i');

const LANG_LONG = {
  hindi: 'Hindi', english: 'English', tamil: 'Tamil', telugu: 'Telugu', malayalam: 'Malayalam',
  kannada: 'Kannada', bengali: 'Bengali', punjabi: 'Punjabi', marathi: 'Marathi', urdu: 'Urdu',
  gujarati: 'Gujarati', japanese: 'Japanese', korean: 'Korean', chinese: 'Chinese', spanish: 'Spanish',
  french: 'French', german: 'German', russian: 'Russian', italian: 'Italian', polish: 'Polish',
  portuguese: 'Portuguese', castellano: 'Spanish', latino: 'Spanish', vfq: 'French', vff: 'French',
};
const LANG_SHORT = {
  hin: 'Hindi', eng: 'English', tam: 'Tamil', tel: 'Telugu', mal: 'Malayalam', kan: 'Kannada',
  ben: 'Bengali', pun: 'Punjabi', mar: 'Marathi', ita: 'Italian', fre: 'French', fra: 'French',
  ger: 'German', deu: 'German', spa: 'Spanish', rus: 'Russian', jap: 'Japanese', kor: 'Korean',
  chi: 'Chinese', pol: 'Polish', lat: 'Spanish',
};
const SERVICES_STRONG = { amzn: 'AMZN', nf: 'NF', dsnp: 'DSNP', hmax: 'HMAX', atvp: 'ATVP', hulu: 'HULU', pcok: 'PCOK', hotstar: 'HS', zee5: 'ZEE5', jiocinema: 'JC' };
const SERVICES_WEAK = { ma: 'MA', it: 'iT', hs: 'HS', jc: 'JC', ss: 'SS', max: 'MAX' };
const KNOWN_GROUPS = new Set(['tigole', 'qxr', 'psa', 'yts', 'rarbg', 'fgt', 'framestor', 'terminal', 'galaxyrg', 'galaxyrg265', 'kingdom-rg', 'evo', 'sparks', 'silence', 'immortal', 'morningstar', 'viir', 'homelander', 'swtyb', 'tombdoc', 'remuxdoc', 'mgb', 'sic', 'telly', 'mushr00m', 'lkf', 'uh', 'mr', 'extreme', 'aoc', 'hammer', 'marjenbo', 'licdom', 'mircrew', 'genemige', 'lord', 'asmo', 'deflate', 'chdb', '3li', 'soup', 'tgx', 'ethd', 'mb', 'frds', 'mnhd']);
const KNOWN_SITES = new Set(['uhdmovies', '4khdhub', 'hdhub4u', 'moviesdrives', 'vegamovies', '1vegamovies', 'filmyzilla', 'mkvcinemas', 'bollyflix', 'moviesmod', 'katmoviehd', 'yts']);
const NOISE = new Set(['mp4', 'mkv', 'avi', 'movie', 'hollywood', 'bollywood', 'mcu', 'dceu', 'full', 'free', 'download', 'hd', 'uhd', 'bluray', 'film', 'the', 'and']);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const B = (src, flags = 'gi') => new RegExp(`(?<![A-Za-z0-9])(?:${src})(?![A-Za-z0-9])`, flags);
const blank = (str, i, len) => str.slice(0, i) + ' '.repeat(len) + str.slice(i + len);

function normalizeDots(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '_') { out += ' '; continue; }
    if (c !== '.') { out += c; continue; }
    const p = s[i - 1] || '', n = s[i + 1] || '';
    if (/\d/.test(p) && /\d/.test(n)) {                                                // 5.1, 2.0 (but AC3.5.1 -> AC3 5.1)
      if (s[i + 2] === '.' && /\d/.test(s[i + 3] || '')) { out += ' '; continue; }
      out += '.'; continue;
    }
    if (/h/i.test(p) && /^26[45]/.test(s.slice(i + 1, i + 4)) && !/[A-Za-z0-9]/.test(s[i - 2] || ' ')) { out += '.'; continue; } // H.265
    out += ' ';
  }
  return out;
}

function parseName(raw) {
  const out = {
    type: 'movie', raw, title: null, titleKey: null, year: null, edition: [], resolution: null, source: null, sourceRaw: null,
    service: null, remux: false,
    video: { codec: null, encoder: null, bitDepth: null, hdr: [] },
    audio: [], languages: [], languageMode: 'unknown', dubbed: false, subtitles: [],
    flags: [], fps: null, threeD: null, group: null, site: null, container: null, ids: {}, tags: [], warnings: [],
  };
  let s = raw.trim();

  // ---- Step 1: extension, site prefix, ids
  const ext = s.match(VIDEO_EXT);
  if (ext) { out.container = ext[1].toLowerCase(); s = s.slice(0, -ext[0].length); }
  const ps = s.match(PREFIX_SITE);
  if (ps) { out.site = ps[1]; s = s.slice(ps[0].length); }
  s = s.replace(/^www\.[\w-]+\.\w+\s*[-–]\s*/i, (m) => { out.site = m.replace(/\s*[-–]\s*$/, ''); return ''; });
  s = s.replace(/\{(imdb|tmdb|tvdb)-([\w]+)\}/gi, (_, k, v) => { out.ids[k.toLowerCase()] = v; return ' '; });
  s = s.replace(/\{edition-([^}]+)\}/gi, (_, v) => { out.edition.push(v.trim()); return ' '; });

  // ---- Step 1b: size bracket, CRC, leading [Group], trailing (GROUP-SITE)
  s = s.replace(/\s*\[(\d+(?:\.\d+)?\s?(?:GB|MB))\]\s*$/i, (_, v) => { out.sizeHint = v; return ''; });
  s = s.replace(/\s*\[([0-9A-Fa-f]{8})\]\s*$/, (_, v) => { out.hash = v.toUpperCase(); return ''; });
  let animeGroup = null;
  { const lg = s.match(/^\[([^\]]{2,30})\]\s*(?=[A-Za-z0-9])/);
    if (lg && !/fps|\d{3,4}p|bit|hdr|\d{4}|^[\d.\s]+$/i.test(lg[1]) && !PREFIX_SITE.test(lg[0])) { animeGroup = lg[1]; s = s.slice(lg[0].length); } }
  { const pg = s.match(/\s*\(([A-Za-z0-9]{2,15})-([A-Za-z0-9.]{2,30})\)\s*$/);
    if (pg) {
      const second = pg[2]; const isSite = new RegExp(`\\.(?:${TLDS})$`, 'i').test(second) || KNOWN_SITES.has(second.toLowerCase());
      if (isSite) { out.site = second; out.group = pg[1]; s = s.slice(0, pg.index); }
    } }

  // ---- Step 2: site anywhere (domain-like token)
  const dm = s.match(DOMAIN);
  if (dm && !out.site) { out.site = dm[1]; s = s.slice(0, dm.index) + ' ' + s.slice(dm.index + dm[0].length); }
  s = s.replace(/[\s._~-]+$/, '').replace(/^[\s._~-]+/, '');
  s = s.replace(/\[\s*\]/g, ' ').replace(/\(\s*\)/g, ' ');

  // ---- Step 2b: truncated input (unclosed bracket) and collection-index prefix
  const opens = (s.match(/[\[({]/g) || []).length, closes = (s.match(/[\])}]/g) || []).length;
  const truncated = opens > closes;
  if (truncated) {
    out.warnings.push('input truncated (unclosed bracket): later tracks may be missing');
    const lw = s.match(/([A-Za-z]+)$/);
    const KNOWNW = new Set([...Object.keys(LANG_LONG), ...Object.keys(LANG_SHORT), 'aac', 'dd', 'ddp', 'dts', 'truehd', 'atmos', 'ac3', 'eac3', 'hdma', 'ma', 'hd', 'kbps', 'ch', 'org', 'hs', 'dsnp']);
    if (lw && !KNOWNW.has(lw[1].toLowerCase()) && /[\s+&-]/.test(s[lw.index - 1] || ' ')) s = s.slice(0, lw.index);
    s = s.replace(/[\s+&~_-]+$/, '');
  }
  if (/\s/.test(s.split(/[\[(]/)[0])) {
    s = s.replace(/^\s*M\d{1,2}\s+(?=[A-Za-z])/, () => { out.warnings.push('collection index prefix removed'); return ''; });
    s = s.replace(/^\s*(?:\d{1,2}\.\s*|0\d\s+)(?=[A-Za-z])/, () => { out.warnings.push('collection index prefix removed'); return ''; });
  }

  // ---- Step 3: trailing group
  const groupCands = [];
  const isTechish = (w) => {
    const x = w.toLowerCase();
    return /^(dl|ma|hd|dual|multi|rip|webrip|web|bluray|x264|x265|hevc|mkv|mp4|sub|subs|esub|esubs|audio|hdr|dv|atmos|truehd|aac|ac3|dts|ddp|dd)$/.test(x) || LANG_LONG[x] || LANG_SHORT[x];
  };
  let m;
  while (!truncated) {
    if ((m = s.match(/\s*\[([A-Za-z0-9][A-Za-z0-9 ._-]{0,14})\]\s*$/)) && !isTechish(m[1]) && !/\d{3,4}p|bit|hdr|audio|sub|h\.?26[45]|x26[45]|mp4|mkv|hevc|avc/i.test(m[1]) && !/^[0-9A-F]{8}$/.test(m[1])) {
      groupCands.push({ v: m[1].trim(), c: 'bracket' }); s = s.slice(0, m.index); continue;
    }
    break;
  }
  s = s.replace(/[\s._~-]+$/, '');
  if (truncated) { /* no trailing group on truncated input */ }
  else if ((m = s.match(/(?:\s~\s*|\bBy~|\s_\s+)([A-Za-z0-9][A-Za-z0-9 ]{1,20}?)\s*~?$/))) {
    groupCands.unshift({ v: m[1].trim(), c: 'tilde' }); s = s.slice(0, m.index);
  } else if ((m = s.match(/\s-\s([A-Za-z0-9]{2,15})$/)) && !isTechish(m[1])) {
    groupCands.unshift({ v: m[1], c: 'dash-space' }); s = s.slice(0, m.index);
  } else if ((m = s.match(/[\s.]([A-Za-z0-9]+-RG)$/i))) {
    groupCands.unshift({ v: m[1], c: 'dash' }); s = s.slice(0, m.index);
  } else if ((m = s.match(/-([A-Za-z0-9]{1,20})$/)) && !isTechish(m[1]) && !/^\d+p$/i.test(m[1])) {
    groupCands.unshift({ v: m[1], c: 'dash' }); s = s.slice(0, m.index);
  }
  s = s.replace(/[\s._~-]+$/, '');
  for (const g of groupCands) if (KNOWN_SITES.has(g.v.toLowerCase())) { if (!out.site) out.site = g.v; g.v = null; }
  for (let i = groupCands.length - 1; i >= 0; i--) if (groupCands[i].v === null) groupCands.splice(i, 1);
  if (animeGroup) groupCands.unshift({ v: animeGroup, c: 'dash' });

  // ---- Step 4: normalize
  let n = normalizeDots(s);

  // ---- Step 5: title/year cut
  const TECH = B('2160p|m?1080[pi]|m?720p|576p|480p|4k|4krip\\d*|uhd|blu[ -]?ray|bdrip|brrip|bdremux|web[ -]?dl|web[ -]?rip|webdl|hdrip|hdtv|dvdrip|remux|x26[45]|h\\.?26[45]|hevc|avc|av1|hdr10\\+?|hdr|dv|3d|imax|multi|dual|truehd|dts|ddp|atmos');
  let yearIdx = -1, yearLen = 0;
  const parenYears = [...n.matchAll(/[(\[](19\d\d|20\d\d)[)\]]/g)];
  if (parenYears.length) { const y = parenYears[0]; out.year = +y[1]; yearIdx = y.index; yearLen = y[0].length; }
  else {
    const techM = [...n.matchAll(TECH)][0];
    const techIdx = techM ? techM.index : n.length;
    const ys = [...n.matchAll(/(?<!\d)(19\d\d|20\d\d)(?![\dpi])/g)];
    const before = ys.filter((y) => y.index < techIdx);
    const pick = before.length ? before[before.length - 1] : null;
    if (pick) { out.year = +pick[1]; yearIdx = pick.index; yearLen = 4; }
  }
  // series / anime episode detection
  let seriesM = null;
  const SX = [
    { re: /(?<![A-Za-z0-9])S(\d{1,2})[ ]?E(\d{1,3})((?:[ -]?E?\d{1,3})*)(?![A-Za-z0-9])/i, f: (m) => { const eps = [+m[2]]; const rest = (m[3] || '').match(/\d{1,3}/g) || []; if (rest.length === 1 && /-/.test(m[3]) && +rest[0] > eps[0]) { for (let e = eps[0] + 1; e <= +rest[0]; e++) eps.push(e); } else rest.forEach((e) => eps.push(+e)); return { season: +m[1], episodes: eps, complete: false }; } },
    { re: /(?<![A-Za-z0-9])(\d{1,2})x(\d{2,3})(?![A-Za-z0-9])/i, f: (m) => ({ season: +m[1], episodes: [+m[2]], complete: false }) },
    { re: /(?<![A-Za-z0-9])S(\d{1,2})(?:[ ]+(?:Complete|Full))?(?![A-Za-z0-9])(?=.*(?:complete|season))/i, f: (m) => ({ season: +m[1], episodes: [], complete: true }) },
    { re: /(?<![A-Za-z0-9])Season[ ]?(\d{1,2})(?![A-Za-z0-9])/i, f: (m) => ({ season: +m[1], episodes: [], complete: /complete/i.test(n) }) },
  ];
  for (const x of SX) { const m = n.match(x.re); if (m && (!seriesM || m.index < seriesM.index)) seriesM = { index: m.index, len: m[0].length, data: x.f(m) }; }
  if (!seriesM && animeGroup) { const m = n.match(/\s-\s(\d{1,4})(?:v\d)?(?=\s|\(|\[|$)/); if (m) seriesM = { index: m.index, len: m[0].length, data: { season: null, episodes: [+m[1]], complete: false, absolute: +m[1] } }; }
  if (seriesM) { out.type = 'series'; out.series = seriesM.data; }
  let titleEnd;
  if (yearIdx >= 0) titleEnd = yearIdx; else { const t = [...n.matchAll(TECH)][0]; titleEnd = t ? t.index : n.length; }
  if (seriesM && (yearIdx < 0 || seriesM.index < yearIdx)) { titleEnd = seriesM.index; yearIdx = -1; out.year = out.year && n.slice(seriesM.index).includes(String(out.year)) ? out.year : null; }
  let title = n.slice(0, titleEnd);
  let tail = n.slice(yearIdx >= 0 ? yearIdx + yearLen : (seriesM && titleEnd === seriesM.index ? titleEnd + seriesM.len : titleEnd));
  if (seriesM && yearIdx >= 0) { const sm = tail.match(SX[0].re) || tail.match(SX[1].re) || tail.match(SX[2].re) || tail.match(SX[3].re); if (sm) tail = tail.slice(0, sm.index) + ' '.repeat(sm[0].length) + tail.slice(sm.index + sm[0].length); }
  if (seriesM) { const t0 = [...tail.matchAll(TECH)][0]; const gapRaw = (t0 ? tail.slice(0, t0.index) : ''); const gap = gapRaw.replace(/[()\[\]]/g, ' ').replace(/\b(complete|full|season)\b/gi, ' ').replace(/\s+/g, ' ').trim(); if (t0 && out.series) { tail = ' '.repeat(t0.index) + tail.slice(t0.index); } if (/[A-Za-z]{2}/.test(gap) && out.series) { out.series.episodeTitle = gap; tail = ' '.repeat(t0.index) + tail.slice(t0.index); } }
  let w = ' '.repeat(titleEnd + (yearIdx >= 0 ? yearLen : 0)) + tail;      // working copy keeps positions
  w = w.slice(titleEnd + (yearIdx >= 0 ? yearLen : 0)); const base = 0; // positions relative to tail
  w = tail;

  // title cleanup
  title = title.replace(/^\s*\[[^\]]*\]\s*/, (mm) => { const f = mm.match(/(\d{2,3})\s?fps/i); if (f) out.fps = +f[1]; return ''; });
  title = title.replace(/^\s*M\d{1,2}\s+(?=[A-Za-z])/, (mm) => { out.warnings.push('collection index prefix removed'); return ''; });
  title = title.replace(/^\s*\d{1,2}\s*[.)]\s+(?=[A-Za-z])/, () => { out.warnings.push('collection index prefix removed'); return ''; });
  for (const re of [/\bIMAX Enhanced\b/i, /\bIMAX\b/i, /\bOpen Matte\b/i, /\bExtended(?: Cut)?\b/i, /\bUnrated\b/i, /\bRemastered\b/i]) {
    const mm = title.match(re); if (mm && title.slice(mm.index + mm[0].length).trim() === '') { out.edition.push(mm[0]); title = title.slice(0, mm.index); }
  }
  title = title.replace(/[\s(\[:\-–]+$/, '').replace(/\s+/g, ' ').trim();
  if (/^\d{1,2}\s+[A-Za-z]/.test(title) && /\s/.test(raw) && !out.warnings.length) out.warnings.push('title starts with number: maybe collection index');
  out.title = title || null;
  out.titleKey = title ? title.toLowerCase().replace(/[^a-z0-9]/g, '') : null;

  // ---- Step 6: consume features from the tail
  const stream = [];                       // audio token stream
  const bracketSpans = [...w.matchAll(/[\[({][^\]})]*[\]})]?/g)].map((x) => [x.index, x.index + x[0].length]);
  const inBracket = (i) => bracketSpans.some(([a, b]) => i >= a && i < b);
  const consume = (re, cb) => {
    re.lastIndex = 0; let mm; const hits = [];
    while ((mm = re.exec(w))) hits.push({ i: mm.index, t: mm[0], g: mm.slice(1) });
    for (const h of hits) { w = blank(w, h.i, h.t.length); cb(h); }
  };
  const nrm = (x) => x.toLowerCase().replace(/[ .-]/g, '');

  consume(/(?<![A-Za-z0-9.])(\d+(?:\.\d+)?)\s?(GB|MB)(?![A-Za-z0-9])/gi, (h) => { out.sizeHint = h.t.trim(); });
  consume(/\[?\b(\d{2,3})\s?fps\]?/gi, (h) => { out.fps = +h.g[0]; });
  consume(B('bd3d|3d|h-?sbs|half[ -]sbs|sbs'), (h) => { out.threeD = out.threeD && /sbs/i.test(out.threeD) ? out.threeD : (/sbs/i.test(h.t) ? 'HSBS' : '3D'); });
  consume(B('hdr10\\+|hdr10plus|hdr10 plus'), () => out.video.hdr.push('HDR10+'));
  consume(B('hdr10'), () => out.video.hdr.push('HDR10'));
  consume(B('hdr'), () => out.video.hdr.push('HDR10'));
  consume(B('dv|dovi|dolby[ ]vision'), () => out.video.hdr.push('DV'));
  consume(B('hlg'), () => out.video.hdr.push('HLG'));
  consume(B('sdr'), () => out.video.hdr.push('SDR'));
  out.video.hdr = [...new Set(out.video.hdr)];
  if (out.video.hdr.includes('HDR10+')) out.video.hdr = out.video.hdr.filter((x) => x !== 'HDR10');
  if (!out.video.hdr.includes('SDR') === false) { /* keep */ }

  // resolution
  consume(B('2160p|m?1080[pi]|m?720p|576p|480p|4320p|4k|4krip\\d*|8k'), (h) => {
    let r = h.t.toLowerCase().replace(/^m(?=\d)/, ''); if (/^4krip/.test(r)) r = '4k';
    const v = r === '4k' ? '2160p' : r === '8k' ? '4320p' : r.replace('i', 'p');
    if (!out.resolution) out.resolution = v;
  });
  consume(B('remux|bdremux'), () => { out.remux = true; });
  consume(/(?<![A-Za-z0-9])(?:web[ -]?dl|webdl|webrip|web[ -]?rip)(?:[- ]?rip)?(?![A-Za-z0-9])/gi, (h) => {
    const x = nrm(h.t); out.sourceRaw = h.t; if (!out.source) out.source = (x.includes('rip') ? 'WEBRip' : 'WEB-DL');
  });
  consume(B('web'), (h) => { if (!out.source) { out.source = 'WEB'; out.sourceRaw = h.t; } });
  consume(B('blu[ -]?ray(?: rip)?|bdrip|brrip|bd ?rip|bd|uhd ?rip|4k ?rip|uhdrip'), (h) => {
    if (/^bd$/i.test(h.t.trim()) && inBracket(h.i)) { w = w.slice(0, h.i) + h.t + w.slice(h.i + h.t.length); return; }
    if (!out.source) { out.source = 'BluRay'; out.sourceRaw = h.t; }
  });
  // restore BD tokens inside brackets (audio "BD 5.1") -- handled by re-scan below
  consume(B('hdrip'), (h) => { if (!out.source) { out.source = 'HDRip'; out.sourceRaw = h.t; } });
  consume(B('hdtv|pdtv'), (h) => { if (!out.source) { out.source = 'HDTV'; out.sourceRaw = h.t; } });
  consume(B('dvdrip|dvd'), (h) => { if (!out.source) { out.source = 'DVD'; out.sourceRaw = h.t; } });
  consume(B('hdcam|hq-hdcam|camrip|cam'), (h) => { out.source = 'CAM'; out.sourceRaw = h.t; });
  consume(B('hdts|telesync|ts'), (h) => { out.source = 'TS'; out.sourceRaw = h.t; });
  consume(B('uhd'), () => {});

  // video codec
  consume(B('x265'), () => { out.video.codec = 'H.265'; out.video.encoder = 'x265'; });
  consume(B('x264'), () => { out.video.codec = 'H.264'; out.video.encoder = 'x264'; });
  consume(B('h\\.?265|hevc'), () => { out.video.codec = out.video.codec || 'H.265'; });
  consume(B('h\\.?264|avc'), () => { out.video.codec = out.video.codec || 'H.264'; });
  consume(B('av1'), () => { out.video.codec = 'AV1'; });
  consume(B('xvid|divx'), () => { out.video.codec = 'MPEG-4'; });
  consume(/(?<![A-Za-z0-9])(8|10|12)[ -]?bit(?![A-Za-z])/gi, (h) => { out.video.bitDepth = +h.g[0]; });
  consume(B('hi10p?'), () => { out.video.bitDepth = 10; });

  // edition & flags
  consume(B('imax enhanced'), () => out.edition.push('IMAX Enhanced'));
  consume(B('imax'), () => { if (!out.edition.some((e) => /imax/i.test(e))) out.edition.push('IMAX'); });
  consume(B('open matte'), () => out.edition.push('Open Matte'));
  consume(B('extended(?: cut)?|unrated|theatrical|remastered|uncut|special edition'), (h) => out.edition.push(h.t));
  consume(B('proper|repack|rerip|internal|limited|hybrid'), (h) => out.flags.push(h.t.toUpperCase()));
  consume(B('ai[ ._-]?(?:upscaled?|enhanced)'), () => out.flags.push('AI_UPSCALED'));
  consume(B('untouch(?:ed)?'), () => out.flags.push('UNTOUCHED'));
  consume(B('rifftrax'), () => out.flags.push('COMMENTARY_TRACK'));

  // subtitles
  consume(/(?<![A-Za-z0-9])sub(?:s|titles?)?\s+((?:(?:[a-z]{3}(?![a-z]))(?:[\s+&.\/-]+)?)+)/gi, (h) => {
    for (const c of h.g[0].toLowerCase().match(/[a-z]{3}(?![a-z])/g) || []) if (LANG_SHORT[c]) out.subtitles.push(LANG_SHORT[c]);
  });
  consume(B('e-?subs?|engsubs?'), () => out.subtitles.push('English'));
  consume(B('msubs?|multi[ -]?subs?|multiple subtitle'), () => out.subtitles.push('Multiple'));
  consume(B('hc|hardsub'), () => out.subtitles.push('Hardcoded'));

  // audio tokens (order matters: specific codecs first)
  const CODECS = [
    ['DTS-HD MA', 'dts[ -]?hd[ -]?ma|dtshd[ -]?ma|dts[ -]?hdma'],
    ['DTS:X', 'dts[: -]x'],
    ['DTS-HD', 'dts[ -]?hd'],
    ['DTS', 'dts'],
    ['TrueHD', '(?:dolby )?true[ -]?hd'],
    ['DD+', 'ddp|dd\\+|e[ -]?ac[ -]?3|dolby digital plus'],
    ['HE-AAC', 'he[ -]?aac'],
    ['AAC', 'aac(?:[ -]?lc)?'],
    ['DD', 'dd|ac[ -]?3|dolby digital'],
    ['FLAC', 'flac'], ['Opus', 'opus'], ['MP3', 'mp3'], ['LPCM', 'lpcm'],
  ];
  for (const [name, src] of CODECS) {
    consume(new RegExp(`(?<![A-Za-z0-9])(?:${src})(?![A-Za-z+])`, 'gi'), (h) => stream.push({ k: 'codec', v: name, i: h.i }));
  }
  consume(/(?<![A-Za-z0-9])bd(?![A-Za-z0-9])/gi, (h) => stream.push({ k: 'codec', v: 'BD', i: h.i }));
  consume(/atmos/gi, (h) => stream.push({ k: 'atmos', v: true, i: h.i }));
  consume(/[~_-]?\s*(\d{2,4})\s?kbps/gi, (h) => stream.push({ k: 'br', v: +h.g[0], i: h.i }));
  consume(/(?<![\d.])([1-9]\.[01])(?:\s?ch)?(?![A-Za-z0-9])/gi, (h) => stream.push({ k: 'ch', v: h.g[0], i: h.i }));
  consume(/(?<![A-Za-z0-9])([2-8])ch(?![A-Za-z])/gi, (h) => stream.push({ k: 'ch', v: { 2: '2.0', 6: '5.1', 8: '7.1' }[h.g[0]] || h.g[0] + '.0', i: h.i }));
  consume(/(?<=\s)([5-7])-1(?=\s|$)/g, (h) => stream.push({ k: 'ch', v: h.g[0] + '.1', i: h.i }));

  // streaming services
  consume(B(Object.keys(SERVICES_STRONG).join('|')), (h) => {
    const svc = SERVICES_STRONG[h.t.toLowerCase()];
    stream.push({ k: 'svc', v: svc, i: h.i, inb: inBracket(h.i) });
  });
  consume(B(Object.keys(SERVICES_WEAK).join('|').replace('|it|', '|iT|')), (h) => {
    const near = /web/i.test(out.sourceRaw || '') || out.source === 'WEB-DL' || out.source === 'WEBRip' || out.source === 'WEB';
    const svc = SERVICES_WEAK[h.t.toLowerCase()];
    if (near || inBracket(h.i)) stream.push({ k: 'svc', v: svc, i: h.i, inb: inBracket(h.i) });
    else { w = w.slice(0, h.i) + h.t + w.slice(h.i + h.t.length); }
  });

  // languages
  const langHits = [];
  for (const re of [B(Object.keys(LANG_LONG).join('|')), B(Object.keys(LANG_SHORT).join('|'))]) {
    re.lastIndex = 0; let mm;
    while ((mm = re.exec(w))) {
      const key = mm[0].toLowerCase();
      langHits.push({ i: mm.index, t: mm[0], v: LANG_LONG[key] || LANG_SHORT[key], short: !!LANG_SHORT[key] && !LANG_LONG[key] });
    }
  }
  langHits.sort((a, b) => a.i - b.i);
  // cluster check using original w (before blanking langs)
  const kept = [];
  for (let j = 0; j < langHits.length; j++) {
    const h = langHits[j];
    if (!h.short) { kept.push(h); continue; }
    const prev = langHits[j - 1], next = langHits[j + 1];
    const adj = (a, b) => a && b && /^[\s+&\/.,-]*$/.test(w.slice(a.i + a.t.length, b.i));
    const afterDual = /(?:dual|multi)[\s.-]*$/i.test(w.slice(Math.max(0, h.i - 8), h.i));
    if (adj(prev, h) || adj(h, next) || inBracket(h.i) || afterDual) kept.push(h);
  }
  for (const h of kept) { w = blank(w, h.i, h.t.length); stream.push({ k: 'lang', v: h.v, i: h.i, inb: inBracket(h.i) }); }

  // service tokens inside a bracket only count as audio-origin when that bracket also holds a language
  for (const t of stream) if (t.k === 'svc' && t.inb) {
    const span = bracketSpans.find(([a, b]) => t.i >= a && t.i < b);
    const hasLang = span && stream.some((x) => x.k === 'lang' && x.i >= span[0] && x.i < span[1]);
    if (!hasLang) t.inb = false;
  }
  consume(B('original audios?|org|original'), (h) => stream.push({ k: 'org', v: true, i: h.i }));
  consume(B('dubbed|dubbing|dub|lektor'), (h) => stream.push({ k: 'dub', v: true, i: h.i }));
  let dualFlag = false, multiFlag = false;
  consume(B('dual[ -]?audio|dual'), () => { dualFlag = true; });
  consume(B('multi[ -]?audio|multi'), () => { multiFlag = true; });

  // '+' separators between audio tokens
  stream.sort((a, b) => a.i - b.i);
  const seps = [];
  for (const mm of w.matchAll(/\s*[+&]\s*/g)) seps.push(mm.index + mm[0].indexOf(mm[0].trim()));
  const hardSeps = [];
  for (const sp of seps) {
    const before = [...stream].reverse().find((t) => t.i < sp && ['lang', 'codec', 'ch', 'br'].includes(t.k));
    const after = stream.find((t) => t.i > sp && ['lang', 'codec', 'ch', 'br'].includes(t.k));
    if (before && after && /^[\s.\-~_]*$/.test(w.slice(before.i + 1, sp).replace(/[A-Za-z0-9]/g, ' ').slice(0, 0)) ) hardSeps.push(sp);
    else if (before && after && sp - before.i < 14 && after.i - sp < 14) hardSeps.push(sp);
  }

  // ---- Step 7: build audio tracks
  const audioToks = stream.filter((t) => ['lang', 'codec', 'ch', 'br', 'atmos', 'org', 'dub'].includes(t.k) || (t.k === 'svc' && t.inb));
  const svcGlobal = stream.filter((t) => t.k === 'svc' && !t.inb).map((t) => t.v);
  if (svcGlobal.length) out.service = svcGlobal[0];
  const parts = [[]];
  for (const t of audioToks) {
    while (hardSeps.length && hardSeps[0] < t.i && parts[parts.length - 1].length) { parts.push([]); hardSeps.shift(); }
    while (hardSeps.length && hardSeps[0] < t.i) hardSeps.shift();
    parts[parts.length - 1].push(t);
  }
  const tracks = [];
  const mkTrack = () => ({ codecs: [], language: null, codec: null, channels: null, bitrateKbps: null, atmos: false, original: false, dubbed: false, origin: null, inferred: false });
  const fill = (tr, toks) => {
    for (const t of toks) {
      if (t.k === 'lang') tr.language = tr.language || t.v;
      else if (t.k === 'codec') { if (t.v !== 'BD' && !tr.codecs.includes(t.v)) tr.codecs.push(t.v); if (!tr.codec || (tr.codec === 'BD' && t.v !== 'BD')) tr.codec = t.v; }
      else if (t.k === 'ch') tr.channels = tr.channels || t.v;
      else if (t.k === 'br') tr.bitrateKbps = t.v;
      else if (t.k === 'atmos') tr.atmos = true;
      else if (t.k === 'org') tr.original = true;
      else if (t.k === 'dub') tr.dubbed = true;
      else if (t.k === 'svc') tr.origin = t.v;
    }
    if (tr.codec === 'BD') { tr.codec = null; tr.origin = tr.origin || 'BD'; }
  };
  for (const part of parts) {
    if (!part.length) continue;
    const langs = part.filter((t) => t.k === 'lang');
    if (langs.length <= 1) {
      const tr = mkTrack(); fill(tr, part);
      if (!langs.length && part.filter((t) => t.k === 'codec').length > 1) {
        // codec run without language: one track per codec
        const codecs = part.filter((t) => t.k === 'codec');
        codecs.forEach((c, idx) => { const t2 = mkTrack(); t2.codec = c.v === 'BD' ? null : c.v; if (idx === codecs.length - 1) { fill(t2, part.filter((x) => x.k !== 'codec')); } tracks.push(t2); });
        out.warnings.push('multiple codecs without language: channels/atmos attached to last codec');
      } else tracks.push(tr);
    } else {
      const first = part.findIndex((t) => t.k === 'lang');
      const pre = part.slice(0, first).some((t) => ['codec', 'ch', 'br'].includes(t.k));
      const idxs = part.map((t, i) => (t.k === 'lang' ? i : -1)).filter((i) => i >= 0);
      const segs = [];
      if (pre) { let start = 0; for (const li of idxs) { segs.push(part.slice(start, li + 1)); start = li + 1; } if (start < part.length) segs[segs.length - 1].push(...part.slice(start)); }
      else { idxs.forEach((li, j) => { const s0 = j === 0 ? 0 : li - (part.slice(idxs[j - 1] + 1, li).filter((t) => t.k === 'org').length); segs.push([]); }); 
        // post mode: split at language-led starts (org markers belong to following lang)
        segs.length = 0; let cur = []; let seenLang = false;
        for (let i = 0; i < part.length; i++) {
          const t = part[i];
          if (t.k === 'lang' && seenLang) {
            // move trailing org/dub-pre markers (org before lang) into new seg
            const mv = []; while (cur.length && cur[cur.length - 1].k === 'org') mv.unshift(cur.pop());
            segs.push(cur); cur = mv;
          }
          if (t.k === 'lang') seenLang = true;
          cur.push(t);
        }
        segs.push(cur);
      }
      const trs = segs.map((sg) => { const tr = mkTrack(); fill(tr, sg); return tr; });
      // shared tail: attr-less leading tracks inherit from first track that has attrs (consecutive languages)
      const adjacent = (a, b) => { const ia = part.findIndex((t) => t === a), ib = part.findIndex((t) => t === b); return part.slice(ia + 1, ib).every((t) => ['org', 'dub', 'svc'].includes(t.k)); };
      const hasAttr = (tr) => tr.codec || tr.channels;
      if (!pre) {
        for (let j = trs.length - 2; j >= 0; j--) {
          if (!hasAttr(trs[j]) && hasAttr(trs[j + 1]) && adjacent(segs[j].find((t) => t.k === 'lang'), segs[j + 1].find((t) => t.k === 'lang'))) {
            Object.assign(trs[j], { codec: trs[j + 1].codec, codecs: [...trs[j + 1].codecs], channels: trs[j + 1].channels, inferred: true, atmos: trs[j].atmos || trs[j + 1].atmos });
          }
        }
      } else {
        for (let j = 1; j < trs.length; j++) {
          if (!hasAttr(trs[j]) && hasAttr(trs[j - 1]) && adjacent(segs[j - 1].find((t) => t.k === 'lang'), segs[j].find((t) => t.k === 'lang'))) {
            Object.assign(trs[j], { codec: trs[j - 1].codec, codecs: [...trs[j - 1].codecs], channels: trs[j - 1].channels, inferred: true, atmos: trs[j].atmos || trs[j - 1].atmos });
            trs[j - 1].atmos = trs[j - 1].atmos || trs[j].atmos;
          }
        }
      }
      for (const tr of trs) if (tr.codecs.length > 1 && !tr.inferred) out.warnings.push('multiple codecs for one language track (ambiguous)');
      tracks.push(...trs);
    }
  }
  // global attrs inheritance for attr-less tracks when a single global codec exists (not in bracket seg)
  out.audio = tracks;
  const langs = [];
  for (const t of tracks) if (t.language && !langs.includes(t.language)) langs.push(t.language);
  out.languages = langs;
  out.dubbed = tracks.some((t) => t.dubbed);
  const nl = langs.length;
  if (multiFlag && nl < 2) out.languageMode = 'multi';
  else if (nl >= 3) out.languageMode = 'multi';
  else if (nl === 2 || (dualFlag && nl <= 2)) out.languageMode = 'dual';
  else if (nl === 1) out.languageMode = 'single';
  if (multiFlag && nl >= 3) out.languageMode = 'multi';
  if (out.languageMode === 'dual' && nl === 0) out.warnings.push('Dual Audio: languages unknown');
  if (multiFlag && nl === 0) out.warnings.push('Multi audio: languages unknown');
  if (tracks.some((t) => t.inferred)) out.warnings.push('codec/channels shared across languages (inferred)');

  // ---- Step 8: leftovers -> tags / weak group
  const leftovers = [...w.matchAll(/[A-Za-z0-9][A-Za-z0-9'’]*/g)].map((x) => ({ v: x[0], i: x.index })).filter((x) => !/^\d+$/.test(x.v) || x.v.length > 2);
  const tail1 = leftovers[leftovers.length - 1];
  let weakGroup = null;
  const hasTech = !!(out.resolution || out.source || out.video.codec || out.remux);
  if (!truncated && hasTech && tail1 && !NOISE.has(tail1.v.toLowerCase()) && /[A-Za-z]/.test(tail1.v) && (tail1.v.length >= 3 || KNOWN_GROUPS.has(tail1.v.toLowerCase()))) {
    const lastKnown = Math.max(0, ...stream.map((t) => t.i));
    if (tail1.i >= lastKnown || KNOWN_GROUPS.has(tail1.v.toLowerCase())) weakGroup = tail1;
  }
  for (const l of leftovers) if (!weakGroup || l !== weakGroup) out.tags.push(l.v);
  // group resolution
  const gc = groupCands.find((g) => g.c !== 'bracket') || null;
  const bc = groupCands.find((g) => g.c === 'bracket') || null;
  if (gc) out.group = gc.v;
  else if (weakGroup) {
    out.group = weakGroup.v;
    if (!KNOWN_GROUPS.has(weakGroup.v.toLowerCase())) out.warnings.push(`group '${weakGroup.v}' low confidence`);
  } else if (bc) out.group = bc.v;
  if (bc && out.group !== bc.v) out.tags.push(bc.v);
  if (gc && weakGroup && weakGroup.v !== gc.v) out.tags.push(weakGroup.v);
  out.tags = out.tags.filter((t) => !NOISE.has(t.toLowerCase()) || ['mcu', 'hollywood', 'movie'].includes(t.toLowerCase()));
  if (out.remux && !out.source) { out.source = 'BluRay'; out.sourceRaw = 'inferred-from-REMUX'; out.warnings.push('source inferred from REMUX'); }
  if (!out.resolution) out.warnings.push('resolution missing');
  if (!out.year && out.type === 'movie') out.warnings.push('year missing');
  return out;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { parseName };
  if (typeof window !== 'undefined') window.parseMediaName = parseName;

})();
