/* ======================================================================
   OpenStream - single-file build
   - No Node/Express backend needed. Talks to Cinemeta's public API
     directly from the browser.
   - Watchlist is stored in localStorage (server used to write it to
     data/saved.json on disk; a static HTML file can't write to disk,
     so localStorage replaces that).
   - Clicking a movie's banner/Play button, or an episode row on a series
     page, opens the in-app streams view (#streams route).
   ====================================================================== */

const CINEMETA = 'https://v3-cinemeta.strem.io';

// Stream addons are user-configurable (Settings -> gear icon). No addon is bundled.
const ADDONS_KEY = 'openstream_addons';
const LEGACY_ADDON_KEY = 'openstream_addon';
function parseAddonUrl(raw) {
  const s = (raw || '').trim().replace(/^stremio:\/\//i, 'https://');
  if (!/^https?:\/\//i.test(s)) return null;
  let u; try { u = new URL(s); } catch (_) { return null; }
  const path = u.pathname.replace(/\/manifest\.json$/i, '').replace(/\/+$/, '');
  return { base: u.origin + path, query: u.search };
}
function hostOf(u) { try { return new URL(u).host; } catch (_) { return u; } }
function loadAddons() {
  try {
    const raw = localStorage.getItem(ADDONS_KEY);
    if (raw) { const a = JSON.parse(raw); return Array.isArray(a) ? a.filter(x => x && typeof x.base === 'string') : []; }
    const old = localStorage.getItem(LEGACY_ADDON_KEY);
    const p = old && parseAddonUrl(old);
    if (p) {
      const list = [{ name: hostOf(p.base), base: p.base, query: p.query }];
      localStorage.setItem(ADDONS_KEY, JSON.stringify(list));
      localStorage.removeItem(LEGACY_ADDON_KEY);
      return list;
    }
  } catch (_) {}
  return [];
}
let ADDONS = loadAddons();
const TORRENT_KEY = 'openstream_torrents';
let TORRENTS_ON = false; // torrent links are off by default
try { TORRENTS_ON = localStorage.getItem(TORRENT_KEY) === '1'; } catch (_) {}
function saveAddons() { try { localStorage.setItem(ADDONS_KEY, JSON.stringify(ADDONS)); } catch (_) {} }
const addonEndpoint = (a, path) => a.base + path + (a.query || '');
function addonSupports(a, type, id) {
  const okType = !Array.isArray(a.types) || a.types.includes(type);
  const okId = !Array.isArray(a.idPrefixes) || a.idPrefixes.some(p => String(id).startsWith(p));
  return okType && okId;
}
const isType = t => t === 'movie' || t === 'series';
const segEnc = x => encodeURIComponent(x).replace(/%3A/gi, ':'); // keeps ids like tt123:1:2 readable in an address
const segDec = x => { try { return decodeURIComponent(x); } catch (_) { return x; } };
document.getElementById('brandBtn').addEventListener('click', () => location.reload());
let navDepth = 0; // how many in-app pages deep we are (0 = first page of this session)
function goBack() {
  if (navDepth > 0) { history.back(); return; }
  if (location.pathname !== '/') { try { history.replaceState({ d: 0 }, '', '/'); } catch (_) {} onNav(); }
  else location.hash = '';
}
const titleNames = new Map(); // id -> title name, so the streams page can show it at once
function goStreams(type, id, name) {
  if (name) titleNames.set(id, name);
  location.hash = `/streams/${type}/${segEnc(id)}`;
}
let streamsToken = 0;
let addonFilter = ''; // '' = All addons; otherwise the addon's name (remembered for this browser tab)
try { addonFilter = sessionStorage.getItem('openstream_afilter') || ''; } catch (_) {}
async function fetchAddonStreams(a, type, id) {
  const r = await fetch(addonEndpoint(a, `/stream/${type}/${encodeURIComponent(id)}.json`), { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  return (d.streams || []).map(s => ({ ...s, _addon: a.name }));
}
async function initStreamsView(type, id, name) {
  const box = document.getElementById('streamsContent');
  if (!type || !id || !isType(type)) {
    box.innerHTML = '<div class="state-msg error" style="padding-top:120px;">Missing title reference.</div>';
    return;
  }
  const token = ++streamsToken;
  name = name || titleNames.get(id) || '';
  const se = type === 'series' ? id.split(':') : null;
  box.innerHTML = `<div class="s-head">${esc(name || id)}</div>
    <div class="s-sub">${se ? `Season ${esc(se[1])} · Episode ${esc(se[2])}` : 'Movie'}</div>
    <div class="tabs qtabs" id="aTabs" style="display:none"></div>
    <div id="sList"><div class="state-msg">Loading streams...</div></div>`;
  if (!name) { // opened from a pasted / saved address: look the title name up
    const baseId = type === 'series' ? (id.split(':').slice(0, -2).join(':') || id) : id;
    getMeta(type, baseId).then(d => {
      const h = box.querySelector('.s-head');
      if (token === streamsToken && h && d && d.meta && d.meta.name) h.textContent = d.meta.name;
    }).catch(() => {});
  }
  const list = document.getElementById('sList');
  const aTabsEl = document.getElementById('aTabs');
  if (!ADDONS.length) {
    list.innerHTML = '<div class="state-msg">No stream addon added yet.<br><br><button class="s-set-btn" onclick="openSettings()">Add an addon</button></div>';
    return;
  }
  const active = ADDONS.filter(a => addonSupports(a, type, id));
  if (!active.length) { list.innerHTML = '<div class="state-msg">None of your addons support this title.</div>'; return; }
  const results = await Promise.allSettled(active.map(a => fetchAddonStreams(a, type, id)));
  if (token !== streamsToken) return; // user navigated away
  const failed = active.filter((a, i) => results[i].status === 'rejected').map(a => a.name);
  const all = [], torrents = [];
  let skipped = 0, hiddenTorrents = 0;
  results.forEach(r => (r.status === 'fulfilled' ? r.value : []).forEach(s => {
    const yt = (!s.url && s.ytId) ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(s.ytId) : '';
    if (s.url && /^https?:\/\//i.test(s.url)) all.push(s);
    else if (yt) all.push({ ...s, url: yt });
    else if (isInfoHash(s.infoHash)) { if (TORRENTS_ON) torrents.push(s); else hiddenTorrents++; }
    else skipped++;
  }));
  // Quality order: 4K -> 1080p -> 720p -> unknown -> 480p and below
  const qRank = x => qOrder(qualityOf(x));
  const seenU = new Set();
  const streams = all.filter(x => leftMs(x.url) > 0 && !seenU.has(x.url) && seenU.add(x.url)).sort((a, b) => qRank(a) - qRank(b));
  const seenH = new Set();
  const tors = torrents
    .filter(x => { const h = x.infoHash.trim().toLowerCase(); return !seenH.has(h) && seenH.add(h); })
    .sort((a, b) => qRank(a) - qRank(b) || torrentSeeds(b) - torrentSeeds(a));
  const groups = [], byKey = new Map();
  streams.forEach(s => {
    const k = mirrorKey(s);
    if (k && byKey.has(k)) { byKey.get(k)._members.push(s); return; }
    s._members = [s];
    groups.push(s);
    if (k) byKey.set(k, s);
  });
  const total = groups.length + tors.length;
  const names = [...new Set(active.map(a => a.name))]; // one tab per addon
  const paint = () => {
    // how many cards each addon has for this title
    const counts = {};
    names.forEach(n => { counts[n] = 0; });
    groups.forEach(g => new Set(g._members.map(m => m._addon)).forEach(n => { if (n in counts) counts[n]++; }));
    tors.forEach(x => { if (x._addon in counts) counts[x._addon]++; });
    const sel = (addonFilter && counts[addonFilter] > 0) ? addonFilter : ''; // chosen addon has nothing for this title: show everything
    aTabsEl.innerHTML = [''].concat(names).map(n => `<button type="button" data-a="${esc(n)}" class="${n === sel ? 'on' : ''}"${n && !counts[n] ? ' disabled' : ''}>${n ? esc(n) : 'All'}</button>`).join('');
    aTabsEl.style.display = total && names.length > 1 ? '' : 'none';
    const onTab = aTabsEl.querySelector('.on'); // keep the selected addon in view
    if (onTab) aTabsEl.scrollLeft = onTab.offsetLeft - (aTabsEl.clientWidth - onTab.offsetWidth) / 2;
    // with an addon selected, each card keeps only that addon's download buttons
    const g = !sel ? groups : groups.map(s => {
      const ms = s._members.filter(m => m._addon === sel);
      return ms.length ? { ...ms[0], _members: ms } : null;
    }).filter(Boolean);
    const t = !sel ? tors : tors.filter(x => x._addon === sel);
    cardItems = g.concat(t);
    let html = g.map((s, n) => streamCard(s, n)).join('');
    if (!total) {
      const msg = failed.length === active.length ? 'None of your addons responded. Check your connection or the addon URLs.'
        : all.length ? 'The addons returned expired links. Try again in a bit.'
        : hiddenTorrents ? 'No direct streams found.' : 'No streams found.';
      html = `<div class="state-msg">${msg}</div>`;
    } else if (!g.length) {
      html = '<div class="s-note">No direct streams' + (sel ? ' from ' + esc(sel) : '') + '.</div>';
    }
    if (t.length) html += `<div class="s-sec">Magnet links <span>${t.length}</span></div>` + t.map((s, n) => torrentCard(s, g.length + n)).join('');
    if (hiddenTorrents) html += `<div class="s-note">${hiddenTorrents} magnet link${hiddenTorrents > 1 ? 's' : ''} hidden. <a href="#" onclick="openSettings();return false;" style="color:var(--gold);text-decoration:underline;">Enable in Settings</a></div>`;
    if (skipped) html += `<div class="s-note">${skipped} stream${skipped > 1 ? 's' : ''} skipped (unsupported format).</div>`;
    if (failed.length && failed.length < active.length) html += `<div class="s-note err">Could not load from: ${esc(failed.join(', '))}</div>`;
    list.innerHTML = html;
  };
  aTabsEl.addEventListener('click', e => {
    const b = e.target.closest('button[data-a]');
    if (!b || b.disabled) return;
    addonFilter = b.dataset.a;
    try { sessionStorage.setItem('openstream_afilter', addonFilter); } catch (_) {}
    paint();
  });
  paint();
}

/* ======================================================================
   RELEASE INFO: reads quality, print type, codecs, audio... from the file name
   ====================================================================== */
const REL_RULES = [["remux",/remux/i],["web-dl",/web[-. ]?dl/i],["webrip",/webrip/i],["bluray",/blu[-. ]?ray|bdrip|brrip/i],["dvdrip",/dvdrip/i],["hdtv",/hdtv|pdtv/i],["scr",/(^|[._ -])(scr|dvdscr|screener)([._ -]|$)/i],["hdcam",/hdcam/i],["tc",/(^|[._ -])(hdtc|tc)([._ -]|$)/i],["ts",/(^|[._ -])(hdts|ts)([._ -]|$)/i],["camrip",/(^|[._ -])cam(rip)?([._ -]|$)/i]];
const REL_NAMES = {"4k":"4K UHD","camrip":"CAMRip","hdcam":"HDCAM","ts":"Telesync","tc":"Telecine","scr":"Screener","hdtv":"HDTV","dvdrip":"DVDRip","webrip":"WEBRip","web-dl":"WEB-DL","bluray":"BluRay","remux":"Remux"};
const REL_KD = {"camrip":"Recorded in a theatre with a camera or phone. Shaky video and poor audio.","hdcam":"Recorded in a theatre with an HD camera. Clearer than CAM, but theatre noise remains.","ts":"Camera on a tripod with audio taken from the hall's sound system.","tc":"Captured from the film reel or projector. Fairly clean video and audio.","scr":"Copy sent to reviewers or awards voters. Often has a watermark or on-screen text.","hdtv":"Recorded from a TV broadcast. Channel logos or ads may appear.","dvdrip":"Compressed from a DVD. Decent quality, usually 480p.","webrip":"Captured from a streaming platform and re-encoded. Slightly below WEB-DL.","web-dl":"Downloaded directly from a streaming service without re-encoding. Very good quality.","bluray":"Compressed from a Blu-ray disc. High quality in a smaller file.","remux":"Original Blu-ray video and audio in one file, with no compression. Very large (20-50 GB)."};
const REL_PROV = {"AMZN":"Amazon Prime Video","NF":"Netflix","MA":"Movies Anywhere","iT":"Apple iTunes","DSNP":"Disney+","ATVP":"Apple TV+","HMAX":"HBO Max","MAX":"Max","HULU":"Hulu","PCOK":"Peacock","PMTP":"Paramount+","SHO":"Showtime","ZEE5":"ZEE5","SONYLIV":"SonyLIV","JC":"JioCinema","HS":"Hotstar","SS":"Sun NXT"};
const REL_FD = {"REPACK":"Re-release that fixes a problem in an earlier upload.","PROPER":"Replacement release that fixes issues in a previous one.","IMAX":"Prepared from the IMAX version (taller picture in some scenes).","EXTENDED":"Extended cut with added scenes.","UNRATED":"Version without a rating cut.","REMASTERED":"Restored or remastered source.","HYBRID":"Combined from more than one source.","CORE":"Release tag used by some groups for IMAX/enhanced sources."};
const REL_RES = {"2160":"3840 x 2160 (4K UHD)","1440":"2560 x 1440 (QHD)","1080":"1920 x 1080 (Full HD)","720":"1280 x 720 (HD)","576":"1024 x 576 (SD)","480":"854 x 480 (SD)"};
const REL_LANGS = ["Hindi","English","Tamil","Telugu","Malayalam","Kannada","Bengali","Punjabi","Marathi","Gujarati","Spanish","French","German","Japanese","Korean","Chinese"];
const REL_SRV = {"10 Gbps":"Very high-speed server, download only. Resume is not supported, so use it only with a stable internet connection.","FSLv2":"This is the default HdHub server.","PixelDrain":"Free downloads are limited to about 6 GB per day. After that, speed drops to around 1 MiB/s until the limit resets."};
const INFO_IC = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="7.9" r="1.25" fill="currentColor"/><path d="M12 11.2v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const stripExt = n => String(n || '').replace(/\.[A-Za-z0-9]{2,4}$/, '');
// words after the year hold the release tags; skipping the title avoids false hits (e.g. a movie called "TS")
function releaseTail(base) {
  const toks = base.split(/[._ ]+/);
  for (let i = 1; i < toks.length; i++) {
    if (/^(19|20)[0-9][0-9]$/.test(toks[i].replace(/^[(\[]+|[)\]]+$/g, ''))) return toks.slice(i + 1).join('.');
  }
  return base;
}
function detectPrintType(file) {
  const tail = releaseTail(stripExt(file));
  for (const [key, re] of REL_RULES) if (re.test(tail)) return key;
  return null;
}
// icon + label for the "print" tag; the 4K icon only for a real 4K token (never "4kHdHub")
function printOf(file, quality) {
  const t = detectPrintType(file);
  const k = quality === '4K' ? '4k' : t;
  if (!k) return null;
  return { key: k, label: (t && REL_NAMES[t]) || REL_NAMES[k] };
}
function releaseRowsLegacy(file) {
  const ext = (String(file).match(/\.([A-Za-z0-9]{2,4})$/) || [])[1] || '';
  const base = stripExt(file);
  const g = base.match(/-([A-Za-z0-9]+(?:\.[A-Za-z]{2,4})?)$/);
  const group = g ? g[1] : '';
  const whole = g ? base.slice(0, g.index) : base;
  const body = releaseTail(whole);
  const toks = body.split(/[._ ]+/);
  const rows = [];
  const add = (l, v, d) => { if (v) rows.push([l, v, d || '']); };
  const q = detectQuality(file);
  const rm = /(?:^|[^A-Za-z0-9])(2160|1440|1080|720|576|480)p(?![0-9])/i.exec(body);
  add('Resolution', rm ? rm[1] + 'p' : (q === '4K' ? '4K' : ''), rm ? REL_RES[rm[1]] : '');
  const kind = detectPrintType(file);
  add('Print type', kind ? REL_NAMES[kind] : '', kind ? REL_KD[kind] : '');
  let pv = '';
  for (let i = 0; i < toks.length; i++) {
    if (Object.prototype.hasOwnProperty.call(REL_PROV, toks[i]) && !(i > 0 && /DTS|HD$/i.test(toks[i - 1]))) { pv = toks[i]; break; }
  }
  add('Source service', pv ? REL_PROV[pv] : '', pv ? 'Tag in filename: ' + pv : '');
  if (/H[. ]?265|HEVC|x265/i.test(body)) add('Video codec', 'H.265 / HEVC', 'Newer codec. Same quality in a smaller file; very old devices may not play it.');
  else if (/H[. ]?264|x264|AVC/i.test(body)) add('Video codec', 'H.264 / AVC', 'Most widely compatible video codec.');
  else if (/AV1/i.test(body)) add('Video codec', 'AV1', 'Modern, efficient codec; needs a recent device or player.');
  else if (/xvid/i.test(body)) add('Video codec', 'XviD', 'Old codec, low efficiency.');
  if (/10[- ]?bit/i.test(body)) add('Bit depth', '10-bit', 'Smoother colour gradients, less banding.');
  const hd = [];
  if (/(^|[._ -])(DV|DoVi)([._ -]|$)|dolby[._ -]?vision/i.test(body)) hd.push('Dolby Vision');
  if (/HDR10\+/i.test(body)) hd.push('HDR10+'); else if (/HDR10/i.test(body)) hd.push('HDR10'); else if (/HDR/i.test(body)) hd.push('HDR');
  if (hd.length) add('Dynamic range', hd.join(' + '), 'Better brightness and colour; needs a supported screen.');
  else if (rm || q === '4K') add('Dynamic range', 'SDR', 'Standard dynamic range.');
  let au = '', ad = '';
  if (/TrueHD/i.test(body)) { au = 'Dolby TrueHD'; ad = 'Lossless surround audio from Blu-ray.'; }
  else if (/DTS[-. ]?HD[-. ]?MA/i.test(body)) { au = 'DTS-HD Master Audio'; ad = 'Lossless surround audio from Blu-ray.'; }
  else if (/DTS[-. ]?X/i.test(body)) { au = 'DTS:X'; ad = 'Object-based DTS surround.'; }
  else if (/DTS/i.test(body)) { au = 'DTS'; ad = 'Surround audio, common on discs.'; }
  else if (/DDP|DD\+|E[-. ]?AC[-. ]?3/i.test(body)) { au = 'Dolby Digital Plus (E-AC-3)'; ad = 'Streaming-grade surround audio, better than Dolby Digital.'; }
  else if (/(^|[._ -])(DD|AC3)/i.test(body)) { au = 'Dolby Digital (AC-3)'; ad = 'Standard surround audio from DVD and TV.'; }
  else if (/AAC/i.test(body)) { au = 'AAC'; ad = 'Compact stereo-friendly audio.'; }
  else if (/FLAC/i.test(body)) { au = 'FLAC'; ad = 'Lossless audio.'; }
  else if (/opus/i.test(body)) { au = 'Opus'; ad = 'Efficient modern audio codec.'; }
  add('Audio codec', au, ad);
  const ch = body.match(/(?:DDP|DD\+|DD|AAC|DTS|TrueHD|FLAC|EAC3|AC3|MA)[._ -]?([1-9]\.[0-2])/i);
  if (ch) add('Audio channels', ch[1], ch[1] === '5.1' ? 'Five speakers plus a subwoofer.' : ch[1] === '7.1' ? 'Seven speakers plus a subwoofer.' : ch[1] === '2.0' ? 'Stereo (two channels).' : '');
  if (/atmos/i.test(body)) add('Spatial audio', 'Dolby Atmos', 'Object-based 3D sound; needs an Atmos-capable setup, otherwise falls back to the base track.');
  let lg = REL_LANGS.filter(L => new RegExp('(^|[._ -])' + L + '([._ -]|$)', 'i').test(body));
  if (/(^|[._ -])hin[-._ ]?eng([._ -]|$)/i.test(body) && !lg.length) lg = ['Hindi', 'English'];
  if (/multi/i.test(body)) add('Languages', lg.length ? 'Multi: ' + lg.join(', ') : 'Multi-audio', 'Several audio language tracks inside one file.');
  else if (/dual[._ -]?audio/i.test(body)) add('Languages', lg.length ? 'Dual audio: ' + lg.join(', ') : 'Dual audio', 'Two audio language tracks inside one file.');
  else if (lg.length) add('Languages', lg.join(', '));
  ['REPACK', 'PROPER', 'IMAX', 'EXTENDED', 'UNRATED', 'REMASTERED', 'HYBRID', 'CORE'].forEach(F => {
    if (new RegExp('(^|[._ -])' + F + '([._ -]|$)', 'i').test(body)) add('Edition / tag', F, REL_FD[F]);
  });
  add('Release group', group, 'Who encoded or uploaded this file.');
  const e = ext.toLowerCase();
  add('Container', ext.toUpperCase(), e === 'mkv' ? 'Matroska: holds several audio and subtitle tracks.' : e === 'mp4' ? 'MP4: plays on almost every device.' : '');
  return rows;
}
// where the file is hosted: "[FSL] name.mkv" style prefix from the addon, else a known host, else the addon name
const CODEC_UI = {
  'DD': ['Dolby Digital (AC-3)', 'Standard surround audio from DVD and TV.'],
  'DD+': ['Dolby Digital Plus (E-AC-3)', 'Streaming-grade surround audio, better than Dolby Digital.'],
  'DTS': ['DTS', 'Surround audio, common on discs.'],
  'DTS-HD': ['DTS-HD', 'Higher-quality DTS audio.'],
  'DTS-HD MA': ['DTS-HD Master Audio', 'Lossless surround audio from Blu-ray.'],
  'DTS:X': ['DTS:X', 'Object-based DTS surround.'],
  'TrueHD': ['Dolby TrueHD', 'Lossless surround audio from Blu-ray.'],
  'AAC': ['AAC', 'Compact, widely supported audio.'],
  'HE-AAC': ['HE-AAC', 'Very compact AAC for low bitrates.'],
  'FLAC': ['FLAC', 'Lossless audio.'], 'Opus': ['Opus', 'Efficient modern audio codec.'],
  'MP3': ['MP3', 'Older compressed audio.'], 'LPCM': ['LPCM', 'Uncompressed audio.']
};
const FLAG_UI = {
  UNTOUCHED: ['Untouched', 'Original disc video and audio, not re-encoded.'],
  AI_UPSCALED: ['AI upscaled', 'Resolution raised by AI; the source is not natively this sharp.'],
  COMMENTARY_TRACK: ['Commentary track', 'Contains a commentary audio track, not the normal movie.']
};
const SUB_UI = { Multiple: 'Multiple languages', Hardcoded: 'Hardcoded (burned into the picture)' };
function releaseRowsParsed(st, p, q) {
  const rows = [];
  const add = (l, v, d) => { if (v) rows.push([l, String(v), d || '']); };
  add('Title', p.title);
  add('Year', p.year);
  if (p.series && (p.series.season != null || p.series.absolute != null)) {
    const s = p.series;
    add('Season / episode', s.season != null ? 'S' + String(s.season).padStart(2, '0') + (s.complete ? ' (complete)' : (s.episodes && s.episodes.length ? ' E' + s.episodes.map(n => String(n).padStart(2, '0')).join(', E') : '')) : 'Episode ' + s.absolute, s.episodeTitle || '');
  }
  if (p.resolution) add('Resolution', p.resolution, REL_RES[String(p.resolution).replace(/p$/i, '')] || '');
  const pr = printOfStream(st, q);
  if (pr && pr.type) add('Print type', pr.label, pr.desc);
  if (p.service) add('Source service', REL_PROV[p.service] || p.service, 'Tag in file name: ' + p.service);
  const v = p.video || {};
  if (v.codec) {
    const hevc = v.codec === 'H.265', avc = v.codec === 'H.264';
    add('Video codec', (hevc ? 'H.265 / HEVC' : avc ? 'H.264 / AVC' : v.codec) + (v.encoder ? ' (' + v.encoder + ')' : ''),
      hevc ? 'Newer codec. Same quality in a smaller file; very old devices may not play it.' : avc ? 'Most widely compatible video codec.' : v.codec === 'AV1' ? 'Modern, efficient codec; needs a recent device or player.' : '');
  }
  if (v.bitDepth) add('Bit depth', v.bitDepth + '-bit', v.bitDepth >= 10 ? 'Smoother colour gradients, less banding.' : '');
  if (v.hdr && v.hdr.length) {
    const ord = ['DV', 'HDR10+', 'HDR10', 'HLG', 'SDR'];
    const names = { 'DV': 'Dolby Vision', 'HDR10': 'HDR10', 'HDR10+': 'HDR10+', 'HLG': 'HLG', 'SDR': 'SDR' };
    const list = v.hdr.slice().sort((a, b) => ord.indexOf(a) - ord.indexOf(b)).map(x => names[x] || x);
    add('Dynamic range', list.join(' + '), list[0] === 'SDR' ? 'Standard dynamic range.' : 'Better brightness and colour; needs a supported screen.');
  }
  // Tracks that share codec, channels and flags (e.g. Hindi + Tamil + Telugu all DD+ 5.1) are shown as one row
  const aGroups = [];
  (p.audio || []).forEach((a, i) => {
    const key = [a.codec, a.channels, a.atmos ? 1 : 0, a.bitrateKbps || '', a.original ? 1 : 0, a.dubbed ? 1 : 0, a.origin || ''].join('|');
    let g = aGroups.find(x => x.key === key);
    if (!g) { g = { key, a, langs: [], inferred: true, first: i }; aGroups.push(g); }
    if (a.language && !g.langs.includes(a.language)) g.langs.push(a.language);
    if (!a.inferred) g.inferred = false;
  });
  aGroups.forEach(g => {
    const a = g.a, L = g.langs, many = L.length > 1;
    const ci = CODEC_UI[a.codec] || [a.codec || '', ''];
    const val = [ci[0], a.channels, a.atmos ? 'Atmos' : '', a.bitrateKbps ? a.bitrateKbps + ' kbps' : ''].filter(Boolean).join(' \u00b7 ');
    const notes = [L.length > 3 ? L.join(', ') + '.' : '', ci[1]];
    if (a.original) notes.push(many ? 'Original language tracks.' : 'Original language track.');
    if (a.dubbed) notes.push(many ? 'Dubbed tracks.' : 'Dubbed track.');
    if (a.origin === 'BD') notes.push('Audio taken from the Blu-ray.');
    else if (a.origin) notes.push('Audio taken from ' + (REL_PROV[a.origin] || a.origin) + '.');
    if (g.inferred) notes.push('Guessed from the file name.');
    const label = !L.length ? 'Audio track ' + (g.first + 1) : L.length <= 3 ? L.join(', ') + ' audio' : 'Audio (' + L.length + ' languages)';
    add(label, val || 'Details not in the file name', notes.filter(Boolean).join(' '));
  });
  if ((p.audio || []).some(a => a.atmos)) add('Spatial audio', 'Dolby Atmos', 'Object-based 3D sound; needs an Atmos-capable setup, otherwise it falls back to the base track.');
  const langs = p.languages || [];
  if (p.languageMode === 'dual') add('Languages', 'Dual audio' + (langs.length ? ': ' + langs.join(', ') : ''), 'Two audio language tracks inside one file.');
  else if (p.languageMode === 'multi') add('Languages', 'Multi audio' + (langs.length ? ': ' + langs.join(', ') : ''), 'Several audio language tracks inside one file.');
  else if (langs.length) add('Languages', langs.join(', '));
  if ((p.subtitles || []).length) add('Subtitles', p.subtitles.map(s => SUB_UI[s] || s).join(', '));
  (p.edition || []).forEach(e => add('Edition / tag', e, REL_FD[String(e).split(' ')[0].toUpperCase()] || ''));
  (p.flags || []).forEach(f => { const fu = FLAG_UI[f]; add('Edition / tag', fu ? fu[0] : f, fu ? fu[1] : (REL_FD[f] || '')); });
  if (p.fps) add('Frame rate', p.fps + ' fps');
  if (p.threeD) add('3D', p.threeD, 'This is a 3D version, not a normal 2D movie.');
  add('Release group', p.group, 'Who encoded or uploaded this file.');
  add('Source site', p.site, 'Website named in the file name.');
  const ext = String(p.container || (fileNameOf(st).match(/\.([A-Za-z0-9]{2,4})$/) || [])[1] || '').toLowerCase();
  add('Container', ext.toUpperCase(), ext === 'mkv' ? 'Matroska: holds several audio and subtitle tracks.' : ext === 'mp4' ? 'MP4: plays on almost every device.' : '');
  return rows;
}
function serverOf(st) {
  const text = st.description || st.title || '';
  const raw = ((text.split('\n')[0].match(/^\[([^\]]*)\]/) || [])[1] || '').trim();
  let host = '';
  try { host = new URL(st.url || '').hostname; } catch (_) {}
  let label = '', desc = '';
  const downloadOnly = /10\s*-?\s*gbps/i.test(raw) || /download[\s-]*only/i.test(raw); // these links cannot be streamed
  if (/10\s*-?\s*gbps/i.test(raw)) { label = '10 Gbps'; desc = REL_SRV['10 Gbps']; }
  else if (/^fsl/i.test(raw)) { label = raw.slice(0, 24); desc = REL_SRV['FSLv2']; }
  else if (/pixel/i.test(raw) || /pixeldrain/i.test(host)) { label = 'PixelDrain'; desc = REL_SRV['PixelDrain']; }
  else if (raw) label = raw.slice(0, 24);
  else if (st._src) label = String(st._src).slice(0, 24); // torrent source
  else if (st._addon) label = String(st._addon).slice(0, 24);
  return { label, desc, downloadOnly, fromAddon: !raw && !!label && !/pixeldrain/i.test(host) };
}
function sizeOf(st) {
  const b = st.behaviorHints && st.behaviorHints.videoSize;
  if (b > 0) return b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : Math.max(1, Math.round(b / 1048576)) + ' MB';
  const m = (((st.description || st.title || '') + ' ' + (st.name || '')).match(/(\d+(?:[.,]\d+)?)\s*(TB|GB|MB)\b/i)) || [];
  return (m[1] && parseFloat(m[1].replace(',', '.')) > 0) ? m[1].replace(',', '.') + ' ' + m[2].toUpperCase() : '';
}
// Same file (identical name AND size) offered by several servers = one card with a button row per server
function mirrorKey(st) {
  const b = st.behaviorHints && st.behaviorHints.videoSize;
  const size = b > 0 ? 'b' + b : sizeOf(st);
  const name = fileNameOf(st);
  if (!size || name === 'Unknown file') return null;
  return name.toLowerCase().replace(/\s+/g, ' ').trim() + '|' + size;
}
function infoHtml(file, rows) {
  return '<div class="im-fname">' + esc(file) + '</div>' + rows.map(r => '<div class="im-row"><span class="im-l">' + esc(r[0]) + '</span><span class="im-v">' + esc(r[1]) + (r[2] ? '<em>' + esc(r[2]) + '</em>' : '') + '</span></div>').join('');
}
let cardItems = []; // the streams currently on screen, so the "i" button knows which one it belongs to
const infoModal = document.getElementById('infoModal');
let infoOpener = null;
function openInfo(st) {
  infoOpener = document.activeElement;
  const fi = resolveFile(st);
  const file = shownName(st);
  const pp = parsedOf(st);
  const rows = pp ? releaseRowsParsed(st, pp, qualityOf(st)) : releaseRowsLegacy(fi.name);
  if (fi.cut) rows.unshift(['Note', 'Name cut short', 'The addon shortened this file name, so later details (such as extra audio tracks) may be missing.']);
  const members = st._members || [st];
  const sv = serverOf(st);
  if (members.length > 1) rows.push(['Mirrors', members.length + ' servers', 'The same file (identical name and size) is offered by several servers. Pick any one.']);
  members.forEach((mm, i) => {
    const s2 = serverOf(mm);
    if (s2.label) rows.push([st._tor ? 'Source' : (s2.fromAddon ? 'Addon' : (members.length > 1 ? 'Server ' + (i + 1) : 'Server')), s2.label, s2.desc]);
  });
  const size = sizeOf(st);
  if (size) rows.push(['File size', size, '']);
  if (st._tor) { const sd = torrentSeeds(st); if (sd) rows.push(['Seeders', String(sd), 'Number of people sharing this magnet right now.']); }
  const m = st._tor ? Infinity : Math.min(...members.map(x => leftMs(x.url)));
  if (isFinite(m)) rows.push(['Link expires', 'in ' + Math.max(1, Math.round(m / 60000)) + ' min', 'This link is time-limited. Reload the page for a fresh one.']);
  if (st._addon && sv.label !== st._addon && !rows.some(r => r[1] === String(st._addon))) rows.push(['Addon', String(st._addon), '']);
  const seen = new Set();
  const uniq = rows.filter(r => { const k = r[0] + '\u0001' + r[1]; if (seen.has(k)) return false; seen.add(k); return true; });
  document.getElementById('infoBody').innerHTML = infoHtml(file, uniq);
  infoModal.classList.add('open');
  document.body.classList.add('lock');
  document.getElementById('infoClose').focus({ preventScroll: true });
}
function closeInfo() {
  if (!infoModal.classList.contains('open')) return;
  infoModal.classList.remove('open');
  document.body.classList.remove('lock');
  if (infoOpener && infoOpener.isConnected) infoOpener.focus({ preventScroll: true });
  infoOpener = null;
}
document.addEventListener('click', e => {
  const b = e.target.closest('.ib');
  if (b) { const st = cardItems[+b.dataset.n]; if (st) openInfo(st); return; }
  if (e.target === infoModal || e.target.closest('#infoClose')) closeInfo();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeInfo(); });
window.addEventListener('hashchange', closeInfo);
window.addEventListener('popstate', closeInfo);

// Resolution detection. Only whole tokens count, so a site tag like "4kHdHub" is never read as "4K".
function detectQuality(...texts) {
  for (const raw of texts) {
    if (!raw) continue;
    const t = String(raw);
    const p = /(?:^|[^A-Za-z0-9])(2160|1440|1080|720|576|480|360)p(?![0-9])/i.exec(t);
    if (p) return p[1] === '2160' ? '4K' : p[1] + 'p';
    if (/(?:^|[^A-Za-z0-9])(?:4k|uhd)(?![A-Za-z0-9])/i.test(t)) return '4K';
  }
  return '';
}
function qOrder(q) { return q === '4K' ? 0 : (q === '1440p' || q === '1080p') ? 1 : q === '720p' ? 2 : q ? 4 : 3; }
// ---- Which text is the real file name? (README section 2) ----
const VIDEO_EXT_RE = /\.(mkv|mp4|avi|m4v|ts|m2ts|webm|mov)$/i;
function resolveFile(st) {
  if (st._fi) return st._fi;
  let name = '', cut = false;
  const hint = st.behaviorHints && st.behaviorHints.filename;
  if (typeof hint === 'string' && hint.trim()) name = hint.trim();
  // The stream link often carries the complete name (signed links use response-content-disposition)
  if (!name && st.url) {
    try {
      const u = new URL(st.url);
      const cd = u.searchParams.get('response-content-disposition');
      if (cd) {
        const m = cd.match(/filename\*\s*=\s*(?:UTF-8'')?"?([^";]+)"?/i) || cd.match(/filename\s*=\s*"?([^";]+)"?/i);
        let v = m ? m[1] : cd;
        try { v = decodeURIComponent(v); } catch (_) {}
        v = v.trim().replace(/^["']+|["']+$/g, '');
        if (v && (m || VIDEO_EXT_RE.test(v))) name = v;
      }
      if (!name) {
        let seg = u.pathname.split('/').pop() || '';
        try { seg = decodeURIComponent(seg); } catch (_) {}
        if (VIDEO_EXT_RE.test(seg) && seg.length >= 12 && (seg.match(/[ ._-]/g) || []).length >= 2) name = seg; // ignore hash-like or tiny names
      }
    } catch (_) {}
  }
  // Torrentio style: the 2nd title line is "folder/file" inside the torrent
  if (!name && typeof st.title === 'string') {
    const l2 = st.title.split('\n')[1];
    if (l2 && !/^\s*\u{1F464}/u.test(l2)) {
      const last = l2.split('/').pop().trim();
      if (last && (VIDEO_EXT_RE.test(last) || l2.includes('/') || last.length >= 20)) name = last;
    }
  }
  // First line of description/title (addons like HdHub cut it short, ~100 characters)
  if (!name) {
    let first = String(st.description || st.title || '').split('\n')[0];
    for (let i = 0; i < 3; i++) { // drop "[FSL]" / "[PixelDrain]" / "[size]" prefixes
      const m = first.match(/^\s*\[([^\]]{1,28})\]\s*/);
      if (!m || /\d{3,4}p|\b(?:19|20)\d\d\b/.test(m[1])) break;
      first = first.slice(m[0].length);
    }
    first = first.trim();
    if (/(?:\u2026|\.\.\.)$/.test(first)) { first = first.replace(/(?:\u2026|\.\.\.)$/, '').trim(); cut = true; }
    else if (st.description && !VIDEO_EXT_RE.test(first) && first.length >= 90) cut = true;
    name = first;
  }
  if (!name) name = (st.name || '').split('\n')[0] || 'Unknown file';
  return (st._fi = { name, cut });
}
function fileNameOf(s) { return resolveFile(s).name; }
function shownName(s) { const f = resolveFile(s); return f.name + (f.cut ? '\u2026' : ''); }
function parsedOf(st) {
  if (st._p !== undefined) return st._p;
  let p = null;
  if (typeof window.parseMediaName === 'function') { try { p = window.parseMediaName(fileNameOf(st)); } catch (_) { p = null; } }
  return (st._p = p);
}
function qualityOf(st) {
  const p = parsedOf(st);
  if (p && p.resolution) return p.resolution === '2160p' ? '4K' : p.resolution;
  return detectQuality(fileNameOf(st), st.behaviorHints && st.behaviorHints.filename, st.name, st.description || st.title);
}
// print type (icon + label); the 4K icon only for a real 4K quality
const PRINT_FROM_SOURCE = { 'BluRay': ['bluray'], 'WEB-DL': ['web-dl'], 'WEB': ['web-dl', 'WEB', 'Web source; the exact type (WEB-DL or WEBRip) is not stated.'], 'WEBRip': ['webrip'], 'HDRip': ['webrip', 'HDRip', 'Re-encode of an HD source, not a direct disc or streaming copy.'], 'HDTV': ['hdtv'], 'DVD': ['dvdrip'], 'TS': ['ts'] };
function printOfStream(st, q) {
  const p = parsedOf(st);
  let t = null, label = '', desc = '';
  if (p) {
    if (p.remux) t = 'remux';
    else if (p.source === 'CAM') t = /hd/i.test(p.sourceRaw || '') ? 'hdcam' : 'camrip';
    else if (PRINT_FROM_SOURCE[p.source]) { const e = PRINT_FROM_SOURCE[p.source]; t = e[0]; label = e[1] || ''; desc = e[2] || ''; }
  }
  if (!t) t = detectPrintType(fileNameOf(st)); // things the parser does not know (HDTC, SCR...)
  const k = q === '4K' ? '4k' : t;
  if (!k) return null;
  return { key: k, type: t, label: label || (t && REL_NAMES[t]) || REL_NAMES[k], desc: desc || (t ? REL_KD[t] : '') || '' };
}
function streamFileLine(s) { return fileNameOf(s); }
function isInfoHash(h) { return typeof h === 'string' && /^(?:[a-fA-F0-9]{40}|[A-Za-z2-7]{32})$/.test(h.trim()); }
function torrentSeeds(s) { return +((s.description || s.title || '').match(/\u{1F464}\s*(\d+)/u) || [])[1] || 0; }
function magnetFor(s) {
  const text = s.description || s.title || '';
  const name = ((s.behaviorHints && s.behaviorHints.filename) || text.split('\n')[0] || '').trim().slice(0, 200);
  let m = 'magnet:?xt=urn:btih:' + s.infoHash.trim();
  if (name) m += '&dn=' + encodeURIComponent(name);
  (Array.isArray(s.sources) ? s.sources : []).filter(x => typeof x === 'string' && x.startsWith('tracker:')).slice(0, 20)
    .forEach(x => { m += '&tr=' + encodeURIComponent(x.slice(8)); });
  return m;
}
function torrentCard(st, n) {
  const text = st.description || st.title || '';
  const src = ((text.match(/\u2699\uFE0F?\s*([^\n]+)/) || [])[1] || '').trim();
  st._tor = true;
  st._src = src || 'Magnet';
  return `<div class="s-card tor">
    <button class="ib" type="button" data-n="${n}" aria-label="Show details">${INFO_IC}</button>
    ${releaseChips(st, false)}
    <div class="s-file">${esc(shownName(st))}</div>
    <div class="srv-list">${serverRow(`<div class="s-btns"><a class="dl" href="#" data-url="${esc(magnetFor(st))}" onclick="copyLink(this);return false;">${ICONS.copy} Copy magnet link</a></div>`)}</div>
  </div>`;
}
// Signed (S3/R2) links: work out the remaining time from X-Amz-Date + X-Amz-Expires
function leftMs(url) {
  try {
    const q = new URL(url).searchParams;
    const d = q.get('X-Amz-Date'), e = +q.get('X-Amz-Expires');
    if (!d || !e) return Infinity;
    const t = Date.UTC(+d.slice(0,4), +d.slice(4,6)-1, +d.slice(6,8), +d.slice(9,11), +d.slice(11,13), +d.slice(13,15));
    return t + e * 1000 - Date.now();
  } catch (_) { return Infinity; }
}
function copyLink(el) {
  const url = el.dataset.url;
  const done = () => { if (el.dataset.busy) return; el.dataset.busy = '1'; const t = el.innerHTML; el.innerHTML = el.classList.contains('cp') ? ICONS.check : ICONS.check + ' Copied'; el.classList.add('ok'); setTimeout(() => { el.innerHTML = t; el.classList.remove('ok'); delete el.dataset.busy; }, 1500); };
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = url; document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    if (ok) done(); else prompt('Copy this link:', url);
    ta.remove();
  };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(done, fallback);
  else fallback();
}
function seedChip(st) {
  if (!st._tor) return '';
  const m = (st.description || st.title || '').match(/\u{1F464}\s*(\d+)/u);
  if (!m) return '';
  return `<span class="rchip seed" title="Seeders: people sharing this magnet right now"><svg class="rci" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>${esc(m[1])} Seeders</span>`;
}
function releaseChips(st, showServer = true) {
  const q = qualityOf(st);
  const size = sizeOf(st);
  const sv = serverOf(st);
  const pr = printOfStream(st, q);
  return `<div class="rchips">`
    + (q ? `<span class="rchip ${q === '4K' ? 'res' : ''}">${esc(q)}</span>` : '')
    + (size ? `<span class="rchip">${esc(size)}</span>` : '')
    + seedChip(st)
    + (showServer && sv.label ? `<span class="rchip">${esc(sv.label)}</span>` : '')
    + (pr ? `<span class="rchip"><svg class="rci" viewBox="0 0 512 512" aria-hidden="true"><use href="#i-${pr.key}"/></svg>${esc(pr.label)}</span>` : '')
    + `</div>`;
}
// PixelDrain blocks direct hotlinks ("hotlink detected"), so open the file's detail page instead:
// https://pixeldrain.com/api/file/ID?download  ->  https://pixeldrain.com/u/ID
function downloadUrl(url) {
  const m = String(url || '').match(/^(https?:\/\/(?:[^\/?#]*\.)?pixeldrain\.[a-z]+)\/api\/file\/([^\/?#]+)/i);
  return m ? m[1] + '/u/' + m[2] : url;
}
function downloadLabel(label) {
  const l = String(label || '').trim().replace(/^10\s*-?\s*gbps$/i, '10Gbps');
  return l ? `Download (${l})` : 'Download';
}
// Two equal buttons per link: Copy link + Play in an external player (Outplayer on iPhone/iPad, MPV elsewhere)
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_ANDROID = /Android/i.test(navigator.userAgent);
// "Play in ..." can't ask the phone whether the app exists, so: open the app link and watch whether the page is left
// (the app opened). If the page just stays there, the app is most likely missing -> tell the person to install it.
let playToastTimer;
function showPlayToast(app, installUrl) {
  let t = document.getElementById('playToast');
  if (!t) { t = document.createElement('div'); t.id = 'playToast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.innerHTML = `<span>${esc(app)} is not installed. Please install it first.</span><a href="${esc(installUrl)}" target="_blank" rel="noopener noreferrer">Install</a><button type="button" aria-label="Close">&times;</button>`;
  t.querySelector('button').onclick = () => t.classList.remove('show');
  t.classList.add('show');
  clearTimeout(playToastTimer);
  playToastTimer = setTimeout(() => t.classList.remove('show'), 9000);
}
function launchApp(href, app, installUrl) {
  let left = false;
  const mark = () => { left = true; };
  const vis = () => { if (document.hidden) left = true; };
  window.addEventListener('blur', mark);
  window.addEventListener('pagehide', mark);
  document.addEventListener('visibilitychange', vis);
  location.href = href;
  setTimeout(() => {
    window.removeEventListener('blur', mark);
    window.removeEventListener('pagehide', mark);
    document.removeEventListener('visibilitychange', vis);
    if (!left && !document.hidden) showPlayToast(app, installUrl);
  }, 2200);
}
function playExternal(el) {
  const url = el.dataset.url || '';
  const m = url.match(/^(https?):\/\/(.+)$/i);
  if (!m) { copyLink(el); return; }
  const scheme = m[1].toLowerCase(), rest = m[2];
  // same link formats Stremio uses: Outplayer = "outplayer://host/path", Android = intent://host/path#Intent;...
  if (IS_IOS) launchApp('outplayer://' + rest, 'Outplayer', 'https://apps.apple.com/app/id1449923287');
  else if (IS_ANDROID) launchApp('intent://' + rest + '#Intent;package=is.xyz.mpv;type=video/any;scheme=' + scheme + ';end', 'MPV', 'https://play.google.com/store/apps/details?id=is.xyz.mpv');
  else copyLink(el); // computer: no app to open, so just copy the link
}
// 10Gbps servers are download-only (they can't be streamed), so they get a single Copy button
const isDownloadOnly = label => /^10\s*-?\s*gbps$/i.test(String(label || '').trim());
function streamButtons(m, label, dlOnly) {
  const play = IS_IOS ? 'Play in Outplayer' : 'Play in MPV';
  const name = label ? `<div class="srv-name">${esc(label)}</div>` : '';
  const copy = (txt) => `<button type="button" class="sb dl" data-url="${esc(m.url)}" onclick="copyLink(this)" aria-label="Copy original link">${ICONS.copy} ${txt}</button>`;
  if (dlOnly) return name + `<div class="s-btns one">${copy('Copy link (download only)')}</div>`;
  if (!IS_IOS && !IS_ANDROID) return name + `<div class="s-btns one">${copy('Copy link')}</div>`;
  return name + `<div class="s-btns"><button type="button" class="sb vlc" data-url="${esc(m.url)}" onclick="playExternal(this)">${ICONS.play} ${play}</button>${copy('Copy link')}</div>`;
}
function serverRow(buttons) {
  return `<div class="srv">${buttons}</div>`;
}
function streamCard(st, n) {
  const members = st._members || [st];
  const rows = members.map((m, i) => { const lb = serverOf(m).label, dl = isDownloadOnly(lb); return serverRow(streamButtons(m, (members.length > 1 || dl) ? (lb || 'Server ' + (i + 1)) : '', dl)); }).join('');
  return `<div class="s-card">
    <button class="ib" type="button" data-n="${n}" aria-label="Show details">${INFO_IC}</button>
    ${releaseChips(st, false)}
    <div class="s-file">${esc(shownName(st))}</div>
    <div class="srv-list">${rows}</div>
  </div>`;
}

/* ---------- localStorage-backed "saved" store (replaces data/saved.json) ---------- */
const SAVED_KEY = 'cinemeta_saved';
function readSaved() {
  try { const v = JSON.parse(localStorage.getItem(SAVED_KEY)); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
function writeSaved(list) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); return true; }
  catch (_) { return false; }
}
function addSaved({ id, type, name, poster, year, rating }) {
  const list = readSaved();
  if (!list.find((i) => i.id === id && i.type === type)) {
    list.unshift({ id, type, name, poster, year, rating, savedAt: new Date().toISOString() });
    writeSaved(list);
  }
  return list;
}
function removeSaved(type, id) {
  const list = readSaved().filter((i) => !(i.id === id && i.type === type));
  writeSaved(list);
  return list;
}

function cacheSet(map, key, val, max) {
  map.set(key, val);
  if (map.size > max) map.delete(map.keys().next().value);
}

// Search = IMDb only (its own suggestion endpoint). Tried straight from the browser first; if the browser
// cannot reach it (CORS / network) the Vercel proxy /api/imdb-search is used instead. No Cinemeta in search.
const imdbSearchCache = new Map();
let imdbDirectOk = true; // turns false after a failed direct call, so later searches go straight to the proxy
const IMDB_KIND = { movie: 'movie', tvMovie: 'movie', tvSeries: 'series', tvMiniSeries: 'series' };
async function imdbFetchJson(query) {
  const q = query.trim().toLowerCase();
  const first = /[a-z0-9]/.test(q[0]) ? q[0] : 'x';
  if (imdbDirectOk) {
    try {
      const r = await fetch(`https://v3.sg.media-imdb.com/suggestion/${first}/${encodeURIComponent(q)}.json`, { signal: AbortSignal.timeout(6000) });
      if (r.ok) return await r.json();
    } catch (_) {}
    imdbDirectOk = false;
  }
  const r = await fetch(`/api/imdb-search?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('imdb proxy ' + r.status);
  return r.json();
}
async function imdbSearch(query) {
  const key = query.trim().toLowerCase();
  if (key.length < 2) return [];
  const hit = imdbSearchCache.get(key);
  if (hit) return hit;
  const data = await imdbFetchJson(query);
  const items = (data.d || [])
    .filter(x => x && /^tt\d+$/.test(x.id || '') && IMDB_KIND[x.qid])
    .map(x => ({
      id: x.id, imdb_id: x.id, name: x.l, mediaType: IMDB_KIND[x.qid],
      poster: x.i && x.i.imageUrl ? x.i.imageUrl.replace(/\._V1_\.jpg$/, '._V1_UX200_.jpg') : '',
      releaseInfo: x.yr || (x.y ? String(x.y) : ''),
    }));
  cacheSet(imdbSearchCache, key, items, 60);
  return items;
}

async function searchTitles(query, onPartial, signal) {
  const items = await imdbSearch(query);
  if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return items;
}

async function getMeta(type, id) {
  return cinemetaJson(`/meta/${type}/${encodeURIComponent(id)}.json`);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

const ICONS = {
  bookmarkOutline: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
  bookmark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
  star: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
  imdb: `<svg class="imdb" viewBox="0 0 32 16" role="img" aria-label="IMDb"><rect width="32" height="16" rx="3" fill="#f5c518"/><text x="16" y="12.2" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="900" font-size="11.5" letter-spacing="-.2" fill="#000">IMDb</text></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/></svg>`,
  globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.500 5.700 12 3z"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>`,
  download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.500l4.500 4.500L19 7"/></svg>`,
  episodes: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/></svg>`
};

/* ======================================================================
   HOME VIEW (watchlist + search) — same behavior as the old app.js
   ====================================================================== */
const viewHome = document.getElementById('view-home');
const viewTitle = document.getElementById('view-title');

const stateEl = document.getElementById('state');
const listEl = document.getElementById('list');

const openSearchBtn = document.getElementById('openSearchBtn');
const closeSearchBtn = document.getElementById('closeSearchBtn');
const searchOverlay = document.getElementById('searchOverlay');
const qInput = document.getElementById('q');
const searchStateEl = document.getElementById('searchState');
const searchListEl = document.getElementById('searchList');

/* ---- search history (kept on this device) ---- */
const SH_KEY = 'openstream_search_history';
const searchHistEl = document.getElementById('searchHistory');
function loadHist() {
  try { const a = JSON.parse(localStorage.getItem(SH_KEY) || '[]'); return Array.isArray(a) ? a.filter(x => typeof x === 'string' && x.trim()).slice(0, 10) : []; } catch (_) { return []; }
}
function saveHist(list) { try { localStorage.setItem(SH_KEY, JSON.stringify(list.slice(0, 10))); } catch (_) {} }
function addHist(q) {
  q = (q || '').trim();
  if (q.length < 2) return;
  const l = loadHist().filter(x => x.toLowerCase() !== q.toLowerCase());
  l.unshift(q);
  saveHist(l);
}
const SH_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const SH_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
function renderHistory() {
  const list = loadHist();
  if (!list.length) { searchHistEl.innerHTML = ''; return false; }
  searchHistEl.innerHTML = `<div class="sh-head"><span>Recent searches</span><button type="button" class="sh-clear">Clear all</button></div>` +
    list.map((q, i) => `<div class="sh-row"><button type="button" class="sh-item" data-i="${i}">${SH_CLOCK}<span>${esc(q)}</span></button><button type="button" class="sh-del" data-i="${i}" aria-label="Remove ${esc(q)} from history">${SH_X}</button></div>`).join('');
  return true;
}
searchHistEl.addEventListener('click', e => {
  const list = loadHist();
  if (e.target.closest('.sh-clear')) { saveHist([]); renderSearch(); return; }
  const del = e.target.closest('.sh-del');
  if (del) { list.splice(+del.dataset.i, 1); saveHist(list); renderSearch(); return; }
  const it = e.target.closest('.sh-item');
  if (it && list[+it.dataset.i] != null) {
    const q = list[+it.dataset.i];
    qInput.value = q;
    addHist(q);
    searchHistEl.innerHTML = '';
    clearTimeout(debounceTimer);
    runSearch(q);
  }
});

let savedList = [];

function activeTypes() { return ['movie', 'series']; }
function setStateEl(el, msg, isError) {
  if (!msg) {
    el.className = 'state-msg hidden';
    el.textContent = '';
  } else {
    el.className = 'state-msg' + (isError ? ' error' : '');
    el.textContent = msg;
  }
}

/* ---- search box: results appear right here (IMDb only); recent searches show while the box is empty ---- */
let searchResults = [];
let debounceTimer = null, searchCtl = null, searchSeq = 0;
function openSearch() {
  searchOverlay.classList.add('open');
  document.body.classList.add('lock');
  qInput.focus();
  renderSearch();
}
openSearchBtn.addEventListener('click', () => openSearch());

/* ---- app-like feel: no pinch or double-tap zoom (the page also sets touch-action and the viewport tag) ---- */
['gesturestart', 'gesturechange', 'gestureend'].forEach(ev => document.addEventListener(ev, e => e.preventDefault())); // Safari

/* ---- theme: dark <-> light (choice is remembered; the <head> script applies it before first paint) ---- */
function applyTheme(light, save) {
  document.documentElement.classList.add('theme-anim'); // short colour fade while switching
  clearTimeout(applyTheme.t);
  applyTheme.t = setTimeout(() => document.documentElement.classList.remove('theme-anim'), 350);
  if (light) document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', light ? '#f3ecdc' : '#100e0c');
  const b = document.getElementById('themeBtn');
  if (b) { const l = light ? 'Switch to dark mode' : 'Switch to light mode'; b.setAttribute('aria-label', l); b.title = l; }
  if (save) { try { localStorage.setItem('os_theme', light ? 'light' : 'dark'); } catch (_) {} }
}
(function () {
  const light = document.documentElement.getAttribute('data-theme') === 'light';
  const b = document.getElementById('themeBtn');
  if (b) { const l = light ? 'Switch to dark mode' : 'Switch to light mode'; b.setAttribute('aria-label', l); b.title = l; }
  document.getElementById('themeBtn').addEventListener('click', () => applyTheme(document.documentElement.getAttribute('data-theme') !== 'light', true));
})();
closeSearchBtn.addEventListener('click', closeSearch);
// stop any pending / running search and forget its results
function cancelSearch() {
  clearTimeout(debounceTimer);
  if (searchCtl) { searchCtl.abort(); searchCtl = null; }
  searchSeq++;
  searchResults = [];
  searchListEl.innerHTML = '';
}
function closeSearch() {
  searchOverlay.classList.remove('open');
  document.body.classList.remove('lock');
  // start fresh next time: forget the old query and results
  cancelSearch();
  qInput.value = '';
  setStateEl(searchStateEl, 'Type to search.');
}
qInput.addEventListener('input', (e) => {
  clearTimeout(debounceTimer);
  const value = e.target.value;
  if (!value.trim()) { cancelSearch(); renderSearch(); return; }
  searchHistEl.innerHTML = '';
  if (!searchListEl.querySelector('.list-row:not(.sk)')) showSearching(); // never show an empty bar
  debounceTimer = setTimeout(() => runSearch(value), 400);
});
document.getElementById('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = qInput.value.trim();
  if (!v) return;
  clearTimeout(debounceTimer);
  addHist(v);
  runSearch(qInput.value);
});

// Search IMDb; grey placeholder rows show until the answer arrives
function runSearch(query) {
  clearTimeout(debounceTimer);
  if (searchCtl) searchCtl.abort();
  const ctl = searchCtl = new AbortController();
  const seq = ++searchSeq;
  const stale = () => ctl.signal.aborted || seq !== searchSeq || qInput.value !== query;
  searchResults = [];
  searchHistEl.innerHTML = '';
  renderSearch(true);
  searchTitles(query, (partial) => { if (stale()) return; searchResults = partial; renderSearch(true); }, ctl.signal)
    .then((res) => { if (stale()) return; searchResults = res; renderSearch(false); })
    .catch((err) => {
      if (stale() || (err && err.name === 'AbortError')) return;
      searchListEl.innerHTML = '';
      setStateEl(searchStateEl, 'Search failed. Check your connection and try again.', true);
    });
}

function loadSaved() {
  savedList = readSaved();
  renderWatchlist();
}

function normalizeSaved(s) {
  return { id: s.id, type: s.type, name: s.name, poster: s.poster, year: s.year, rating: s.rating };
}

function renderWatchlist() {
  const types = activeTypes();
  const items = savedList.map(normalizeSaved).filter(i => types.includes(i.type));
  const savedKeys = new Set(savedList.map(s => s.type + ':' + s.id));

  if (!items.length) {
    setStateEl(stateEl, !types.length ? 'Select at least one filter.' : (savedList.length ? 'No saved titles match the selected filters.' : 'Nothing saved yet.'));
    listEl.innerHTML = '';
    return;
  }
  setStateEl(stateEl, null);
  listEl.innerHTML = '';
  items.forEach(item => listEl.appendChild(renderRow(item, savedKeys, true)));
}

function normalizeSearch(m) {
  return { id: m.imdb_id || m.id, type: m.mediaType, name: m.name, poster: m.poster, year: m.releaseInfo, rating: m.imdbRating };
}
const SK_ROW = '<div class="list-row sk" aria-hidden="true"><div class="list-thumb"></div><div class="list-info"><div class="sk-t"></div><div class="sk-m"></div></div></div>';
// placeholder rows instead of an empty box while the search starts
function showSearching() {
  setStateEl(searchStateEl, null); // placeholder rows are enough, no text
  searchListEl.innerHTML = SK_ROW.repeat(3);
}
function renderSearch(loading) { // loading = a search is still running
  if (!qInput.value.trim()) { // nothing typed: show recent searches
    searchListEl.innerHTML = '';
    if (renderHistory()) { setStateEl(searchStateEl, null); return; }
    setStateEl(searchStateEl, 'Type to search.');
    return;
  }
  searchHistEl.innerHTML = '';
  const types = activeTypes();
  const items = searchResults.map(normalizeSearch).filter(i => types.includes(i.type));

  if (!items.length) {
    if (loading) { showSearching(); return; }
    setStateEl(searchStateEl, !types.length ? 'Select at least one filter.' : searchResults.length ? 'No results for the selected filters.' : 'No results found.');
    searchListEl.innerHTML = '';
    return;
  }
  setStateEl(searchStateEl, null);
  searchListEl.innerHTML = '';
  items.forEach(item => searchListEl.appendChild(renderRow(item, new Set(), false)));
  if (loading) searchListEl.insertAdjacentHTML('beforeend', SK_ROW.repeat(2));
}

const NO_POSTER = '<div class="no-poster" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/><path d="M4 4l16 16"/></svg><span>No poster</span></div>';
function renderRow(item, savedKeys, showSaveBtn) {
  const key = item.type + ':' + item.id;
  const isSaved = savedKeys.has(key);
  const row = document.createElement('div');
  row.className = 'list-row';

  const typeLabel = item.type === 'series' ? 'Series' : 'Movie';

  row.innerHTML = `
    <a class="list-thumb" href="#/title/${item.type}/${segEnc(item.id)}">
      ${item.poster ? `<img src="${esc(item.poster)}" alt="" loading="lazy">` : NO_POSTER}
    </a>
    <a class="list-info" href="#/title/${item.type}/${segEnc(item.id)}">
      <div class="list-title">${esc(item.name || 'Untitled')}</div>
      <div class="list-meta">
        <span>${typeLabel}</span>
        ${item.rating ? `<span class="dot">&middot;</span><span class="rating">${ICONS.star}${esc(item.rating)}</span>` : ''}
        ${item.year ? `<span class="dot">&middot;</span><span>${esc(item.year)}</span>` : ''}
      </div>
    </a>
    ${showSaveBtn ? `<button class="save-btn ${isSaved ? 'saved' : ''}" data-id="${esc(item.id)}" data-type="${item.type}" data-name="${esc(item.name || '')}" data-poster="${esc(item.poster || '')}" data-year="${esc(item.year || '')}" data-rating="${esc(item.rating || '')}">${ICONS.bookmarkOutline}</button>` : ''}
  `;

  row.querySelectorAll('a').forEach(a => a.addEventListener('click', () => { addHist(qInput.value); closeSearch(); }));

  if (showSaveBtn) {
    row.querySelector('.save-btn').addEventListener('click', (e) => toggleSave(e.currentTarget));
  }
  return row;
}

function toggleSave(btn) {
  const id = btn.dataset.id, type = btn.dataset.type;
  const key = type + ':' + id;
  const isCurrentlySaved = savedList.some(s => s.type + ':' + s.id === key);
  if (isCurrentlySaved) {
    removeSaved(type, id);
  } else {
    addSaved({ id, type, name: btn.dataset.name, poster: btn.dataset.poster, year: btn.dataset.year, rating: btn.dataset.rating });
  }
  loadSaved();
}

/* ======================================================================
   DISCOVER (Cinemeta catalogs) + full catalog view
   ====================================================================== */
const railsEl = document.getElementById('rails');
const browseStateEl = document.getElementById('browseState');
const paneDiscover = document.getElementById('pane-discover');
const paneWatch = document.getElementById('pane-watch');
const tabsEl = document.getElementById('tabs');
let homeTab = 'discover';

function setTab(tab) {
  homeTab = tab;
  tabsEl.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  paneDiscover.style.display = tab === 'discover' ? '' : 'none';
  paneWatch.style.display = tab === 'watchlist' ? '' : 'none';
  if (tab === 'discover') loadDiscover();
}
// the address follows the tab (replaces the entry, so Back still leaves the home page in one step)
function setTabUrl(tab) {
  const want = tab === 'watchlist' ? '/watchlist' : '/';
  try {
    if (location.pathname + location.hash !== want) {
      history.replaceState(history.state, '', want);
      onNav.k = location.pathname + location.search + location.hash;
    }
  } catch (_) {}
}
tabsEl.addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) { setTab(b.dataset.tab); setTabUrl(b.dataset.tab); } });

const catCache = new Map();
function cinemetaJson(path) {
  if (catCache.has(path)) return catCache.get(path);
  const p = fetch(CINEMETA + path, { signal: AbortSignal.timeout(15000) })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  catCache.set(path, p);
  p.catch(() => catCache.delete(path));
  return p;
}
const FALLBACK_CATALOGS = [
  { type: 'movie', id: 'top', name: 'Popular', genres: [] },
  { type: 'series', id: 'top', name: 'Popular', genres: [] }
];
let catalogsPromise = null;
function getCatalogs() {
  if (!catalogsPromise) {
    catalogsPromise = cinemetaJson('/manifest.json').then(m => {
      const out = (m.catalogs || [])
        .filter(c => c && c.id && (c.type === 'movie' || c.type === 'series'))
        .map(c => {
          const ex = Array.isArray(c.extra) ? c.extra : [];
          const exReq = Array.isArray(c.extraRequired) ? c.extraRequired : [];
          const required = ex.some(e => e && e.isRequired && e.name !== 'genre') || exReq.some(n => n !== 'genre');
          const genreRequired = ex.some(e => e && e.isRequired && e.name === 'genre') || exReq.includes('genre'); // e.g. "New": the genre slot is the year
          const g = ex.find(e => e && e.name === 'genre');
          const genres = (g && Array.isArray(g.options) ? g.options : (Array.isArray(c.genres) ? c.genres : [])).filter(Boolean);
          return { type: c.type, id: c.id, name: c.name || c.id, genres, required, genreRequired };
        })
        .filter(c => !c.required && (!c.genreRequired || c.genres.length));
      return out.length ? out : FALLBACK_CATALOGS;
    }).catch(() => { catalogsPromise = null; return FALLBACK_CATALOGS; });
  }
  return catalogsPromise;
}
function catalogPath(type, id, genre, skip) {
  const parts = [];
  if (genre) parts.push('genre=' + encodeURIComponent(genre));
  if (skip) parts.push('skip=' + skip);
  return `/catalog/${type}/${encodeURIComponent(id)}${parts.length ? '/' + parts.join('&') : ''}.json`;
}
const HIRES = matchMedia('(min-width: 900px)').matches || (window.devicePixelRatio || 1) >= 2;
function posterSrc(u) { return (HIRES && typeof u === 'string') ? u.replace('/poster/small/', '/poster/medium/') : u; }
function posterCard(m, type) {
  const id = m.imdb_id || m.id;
  const src = m.poster ? posterSrc(m.poster) : '';
  return `<a class="p-card" href="#/title/${type}/${segEnc(id)}" data-type="${type}" data-id="${esc(id)}" data-name="${esc(m.name || '')}" data-year="${esc(m.releaseInfo || '')}" data-rating="${esc(m.imdbRating || '')}" data-poster="${esc(m.poster || '')}">
    <div class="p-img">${src ? `<img src="${esc(src)}" data-fb="${esc(m.poster)}" alt="" loading="lazy">` : NO_POSTER}${m.imdbRating ? `<span class="p-rate">${esc(m.imdbRating)}</span>` : ''}</div>
    <div class="p-name">${esc(m.name || 'Untitled')}</div>
    <div class="p-year">${esc(m.releaseInfo || '')}</div>
  </a>`;
}
function applyBrowseFilter() {
  const types = activeTypes();
  railsEl.querySelectorAll('.rail-sec').forEach(s => { s.style.display = types.includes(s.dataset.type) ? '' : 'none'; });
  if (!types.length) setStateEl(browseStateEl, 'Select at least one filter.');
  else if (browseStateEl.textContent === 'Select at least one filter.') setStateEl(browseStateEl, null);
}
let discoverLoaded = false;
async function loadDiscover() {
  if (discoverLoaded) return;
  discoverLoaded = true;
  railsEl.innerHTML = '';
  setStateEl(browseStateEl, 'Loading catalogs...');
  const cats = await getCatalogs();
  setStateEl(browseStateEl, null);
  cats.forEach(c => {
    const sec = document.createElement('section');
    sec.className = 'rail-sec';
    sec.dataset.type = c.type;
    sec.innerHTML = `<div class="rail-head"><h2>${esc(c.name)} · ${c.type === 'movie' ? 'Movies' : 'Series'}</h2><div class="rail-actions"><span class="rail-nav"><button type="button" data-dir="-1" aria-label="Scroll left">&#8249;</button><button type="button" data-dir="1" aria-label="Scroll right">&#8250;</button></span><a href="#/catalog/${c.type}/${segEnc(c.id)}${c.genreRequired ? '/' + encodeURIComponent(c.genres[0]) : ''}">See all</a></div></div><div class="rail"><div class="state-msg" style="padding:30px 0;width:100%;">Loading...</div></div>`;
    railsEl.appendChild(sec);
    const rail = sec.querySelector('.rail');
    cinemetaJson(catalogPath(c.type, c.id, c.genreRequired ? c.genres[0] : '')).then(d => {
      const metas = (d.metas || []).slice(0, 20);
      rail.innerHTML = metas.length ? metas.map(m => posterCard(m, c.type)).join('') : '<div class="state-msg" style="padding:30px 0;width:100%;">Nothing here.</div>';
    }).catch(() => {
      rail.innerHTML = '<div class="state-msg error" style="padding:30px 0;width:100%;">Could not load this catalog. <a href="#" class="retry" style="text-decoration:underline;">Retry</a></div>';
    });
  });
  applyBrowseFilter();
}
railsEl.addEventListener('click', e => {
  const nb = e.target.closest('.rail-nav button');
  if (nb) { const r = nb.closest('.rail-sec').querySelector('.rail'); r.scrollBy({ left: +nb.dataset.dir * r.clientWidth * 0.85, behavior: 'smooth' }); return; }
  if (e.target.closest('.retry')) { e.preventDefault(); discoverLoaded = false; loadDiscover(); }
});

/* ---------- Hover preview popup (mouse / desktop only) ---------- */
const hoverMQ = matchMedia('(hover: hover) and (pointer: fine)');
const pop = document.createElement('div');
pop.className = 'hover-pop';
pop.setAttribute('role', 'dialog');
pop.setAttribute('aria-label', 'Title preview');
document.body.appendChild(pop);
let popCard = null, popOpenT = null, popHideT = null;
const PLUS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const ARROW_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const cssUrl = u => /^https?:\/\//i.test(u || '') ? u.replace(/[\\'"()\s]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')) : '';
const popIsSaved = d => readSaved().some(s => s.id === d.id && s.type === d.type);
function placePop(card) {
  const r = card.getBoundingClientRect();
  const W = pop.offsetWidth, H = pop.offsetHeight;
  const left = Math.max(12, Math.min(r.left + r.width / 2 - W / 2, innerWidth - W - 12));
  const top = Math.max(12, Math.min(r.top + r.height / 2 - H / 2, innerHeight - H - 12));
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  pop.style.setProperty('--ox', (r.left + r.width / 2 - left) + 'px');
  pop.style.setProperty('--oy', (r.top + r.height / 2 - top) + 'px');
}
const ptr = { x: -1, y: -1 }; // last known mouse position
const overPop = el => !!el && (pop.contains(el) || (popCard && popCard.contains(el)));
function cancelHidePop() { clearTimeout(popHideT); popHideT = null; }
function hidePopNow() {
  clearTimeout(popOpenT);
  cancelHidePop();
  pop.classList.remove('open');
  popCard = null;
}
function schedHidePop() {
  if (popHideT) return;
  popHideT = setTimeout(() => {
    popHideT = null;
    // only hide if the mouse is really outside both the popup and its card
    if (ptr.x >= 0 && overPop(document.elementFromPoint(ptr.x, ptr.y))) return;
    hidePopNow();
  }, 160);
}
function showPop(card) {
  if (!card.isConnected) return;
  cancelHidePop();
  const d = { ...card.dataset };
  popCard = card;
  Object.assign(pop.dataset, { id: d.id, type: d.type, name: d.name || '', poster: d.poster || '', year: d.year || '', rating: d.rating || '' });
  const saved = popIsSaved(d);
  const metaLine = [d.type === 'series' ? 'Series' : 'Movie', d.year, d.rating ? 'IMDb ' + d.rating : ''].filter(Boolean).join(' \u2022 ');
  pop.innerHTML = `<div class="hp-hero"><div class="hp-title">${esc(d.name)}</div></div>
    <div class="hp-body">
      <div class="hp-meta">${esc(metaLine)}</div>
      <div class="hp-genres"></div>
      <div class="hp-desc dim">Loading...</div>
      <div class="hp-actions">
        <a class="hp-view" href="#/title/${d.type}/${segEnc(d.id)}">View Details ${ARROW_SVG}</a>
        <button type="button" class="hp-save ${saved ? 'saved' : ''}" aria-label="${saved ? 'Remove from watchlist' : 'Add to watchlist'}">${saved ? ICONS.check : PLUS_SVG}</button>
      </div>
    </div>`;
  // restart the open animation from the card's position
  pop.style.transition = 'none';
  pop.classList.remove('open');
  placePop(card);
  void pop.offsetWidth;
  pop.style.transition = '';
  requestAnimationFrame(() => { if (popCard === card) pop.classList.add('open'); });
  cinemetaJson(`/meta/${d.type}/${encodeURIComponent(d.id)}.json`).then(res => {
    if (popCard !== card) return;
    const m = res.meta || {};
    const hero = pop.querySelector('.hp-hero');
    const bg = cssUrl(m.background || m.poster);
    if (bg) hero.style.backgroundImage = `url('${bg}')`;
    if (/^https?:\/\//i.test(m.logo || '')) {
      const img = new Image();
      img.className = 'hp-logo';
      img.alt = m.name || '';
      img.onload = () => { if (popCard !== card) return; hero.appendChild(img); const tt = hero.querySelector('.hp-title'); if (tt) tt.style.display = 'none'; };
      img.src = m.logo;
    }
    const g = Array.isArray(m.genres) ? m.genres : (Array.isArray(m.genre) ? m.genre : []);
    pop.querySelector('.hp-genres').textContent = g.slice(0, 3).join(' \u2022 ');
    const ml = [d.type === 'series' ? 'Series' : 'Movie', m.releaseInfo || d.year, (m.imdbRating || d.rating) ? 'IMDb ' + (m.imdbRating || d.rating) : ''].filter(Boolean).join(' \u2022 ');
    pop.querySelector('.hp-meta').textContent = ml;
    const ds = pop.querySelector('.hp-desc');
    ds.textContent = m.description || 'No description available.';
    ds.classList.toggle('dim', !m.description);
  }).catch(() => {
    if (popCard !== card) return;
    const ds = pop.querySelector('.hp-desc');
    ds.textContent = 'Details unavailable.';
  });
}
document.addEventListener('mouseover', e => {
  if (!hoverMQ.matches) return;
  const c = e.target.closest ? e.target.closest('.p-card[data-id]') : null;
  if (!c || c.contains(e.relatedTarget)) return;
  cancelHidePop(); clearTimeout(popOpenT);
  const open = pop.classList.contains('open');
  if (open && c === popCard) return;
  popOpenT = setTimeout(() => showPop(c), open ? 300 : 900);
});
document.addEventListener('mouseout', e => {
  const c = e.target.closest ? e.target.closest('.p-card[data-id]') : null;
  if (!c || c.contains(e.relatedTarget)) return;
  clearTimeout(popOpenT);
  if (e.relatedTarget && pop.contains(e.relatedTarget)) return;
  schedHidePop();
});
document.addEventListener('mousemove', e => {
  ptr.x = e.clientX; ptr.y = e.clientY;
  if (!pop.classList.contains('open')) return;
  if (overPop(e.target)) cancelHidePop(); else schedHidePop();
}, { passive: true });
pop.addEventListener('mouseenter', cancelHidePop);
pop.addEventListener('mouseleave', e => {
  if (popCard && e.relatedTarget && popCard.contains(e.relatedTarget)) return;
  schedHidePop();
});
pop.addEventListener('click', e => {
  const b = e.target.closest('.hp-save');
  if (b) {
    const d = pop.dataset;
    if (popIsSaved(d)) removeSaved(d.type, d.id);
    else addSaved({ id: d.id, type: d.type, name: d.name, poster: d.poster, year: d.year, rating: d.rating });
    loadSaved();
    const s = popIsSaved(d);
    b.classList.toggle('saved', s);
    b.innerHTML = s ? ICONS.check : PLUS_SVG;
    b.setAttribute('aria-label', s ? 'Remove from watchlist' : 'Add to watchlist');
    return;
  }
  if (e.target.closest('.hp-view')) hidePopNow();
});
document.addEventListener('scroll', hidePopNow, true);
window.addEventListener('resize', hidePopNow);
window.addEventListener('blur', hidePopNow);
window.addEventListener('hashchange', hidePopNow);
window.addEventListener('popstate', hidePopNow);
document.addEventListener('keydown', e => { if (e.key === 'Escape') hidePopNow(); });

/* ---------- Mouse wheel over a row scrolls it sideways (desktop) ---------- */
document.addEventListener('wheel', e => {
  if (!hoverMQ.matches || e.ctrlKey) return;
  const el = e.target.closest ? e.target.closest('.rail, .genre-row, .chip-row') : null;
  if (!el) return;
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // trackpad sideways swipe: native
  const max = el.scrollWidth - el.clientWidth;
  if (max <= 1) return;
  const delta = (e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * el.clientWidth : e.deltaY) * 1.5;
  const base = el._tx != null ? el._tx : el.scrollLeft;
  const now = performance.now();
  if ((delta < 0 && base <= 0) || (delta > 0 && base >= max - 1)) {
    // The row is at its end. If this is still the same wheel gesture that got it here, swallow the extra
    // notches so the page does not jump; only a fresh gesture (after a short pause) scrolls the page.
    if (now - (el._wheelAt || 0) < 450) { e.preventDefault(); el._wheelAt = now; }
    return;
  }
  e.preventDefault();
  el._wheelAt = now;
  el._tx = Math.max(0, Math.min(max, base + delta));
  if (!el._raf) el._raf = requestAnimationFrame(function step() {
    const d = el._tx - el.scrollLeft;
    if (Math.abs(d) < 1) { el.scrollLeft = el._tx; el._tx = null; el._raf = 0; return; }
    el.scrollLeft += Math.sign(d) * Math.max(1, Math.abs(d) * 0.18);
    el._raf = requestAnimationFrame(step);
  });
}, { passive: false });

let catState = null;
let catToken = 0;
let catObserver = null;
const catSnaps = new Map();
const catKey = s => `${s.type}|${s.id}|${s.genre}`;
function stopCatObserver() { if (catObserver) { catObserver.disconnect(); catObserver = null; } }
function saveCatSnapshot() {
  const grid = document.getElementById('catGrid');
  if (!catState || !grid) return;
  catSnaps.set(catKey(catState), { html: grid.innerHTML, skip: catState.skip, seen: [...catState.seen], done: catState.done, y: window.scrollY });
  if (catSnaps.size > 8) catSnaps.delete(catSnaps.keys().next().value);
}
async function initCatalogView(type, id, genre) {
  stopCatObserver();
  const box = document.getElementById('catalogContent');
  if (!id || (type !== 'movie' && type !== 'series')) {
    box.innerHTML = '<div class="state-msg error" style="padding-top:120px;">Missing catalog reference.</div>';
    return;
  }
  const token = ++catToken;
  box.innerHTML = '<div class="state-msg" style="padding-top:120px;">Loading...</div>';
  const cats = await getCatalogs();
  if (token !== catToken) return;
  catUiCats = cats;
  const typeCats = cats.filter(x => x.type === type);
  const found = typeCats.find(x => x.id === id);
  const c = found || { type, id, name: id, genres: [] };
  const catsFor = found ? typeCats : [c, ...typeCats];
  if (c.genreRequired && !genre && c.genres.length) genre = c.genres[0];
  const st = { type, id, genre: genre || '', skip: 0, seen: new Set(), done: false, loading: false };
  catState = st;
  const opt = (v, l, on) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(l)}</option>`;
  const dd = (k, label, opts, dis) => `<label class="dd"><select class="dd-sel" data-k="${k}" aria-label="${label}"${dis ? ' disabled' : ''}>${opts}</select></label>`;
  const typeDd = dd('type', 'Type', opt('movie', 'Movies', type === 'movie') + opt('series', 'Series', type === 'series'));
  const catDd = dd('id', 'Catalog', catsFor.map(x => opt(x.id, x.name, x.id === id)).join(''));
  const genreDd = dd('genre', c.genreRequired ? 'Year' : 'Genre', (c.genreRequired ? '' : opt('', 'All Genres', !genre)) + c.genres.map(g => opt(g, g, g === genre)).join(''), !c.genres.length);
  box.innerHTML = `<div class="s-head">Discover</div><div class="dd-row">${typeDd}${catDd}${genreDd}</div><div class="p-grid" id="catGrid"></div><div id="catFoot"></div>`;
  const snap = catSnaps.get(catKey(st));
  if (snap) { // coming back: restore the list and scroll position instead of starting over
    document.getElementById('catGrid').innerHTML = snap.html;
    st.skip = snap.skip; st.done = snap.done;
    snap.seen.forEach(k => st.seen.add(k));
    requestAnimationFrame(() => window.scrollTo(0, snap.y));
  }
  // endless scrolling: load the next page when the end of the list gets close
  catObserver = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) loadMoreCatalog(st); }, { rootMargin: '900px 0px' });
  catObserver.observe(document.getElementById('catFoot'));
  if (!snap) loadMoreCatalog(st);
}
async function loadMoreCatalog(st) {
  if (st !== catState || st.loading || st.done) return;
  const grid = document.getElementById('catGrid'), foot = document.getElementById('catFoot');
  if (!grid || !foot) return;
  st.loading = true;
  foot.innerHTML = '<div class="state-msg" style="padding:0;">Loading...</div>';
  let ok = false;
  try {
    const d = await cinemetaJson(catalogPath(st.type, st.id, st.genre, st.skip));
    if (st !== catState) return;
    const raw = d.metas || [];
    st.skip += raw.length;
    const fresh = raw.filter(m => { const k = m.imdb_id || m.id; if (!k || st.seen.has(k)) return false; st.seen.add(k); return true; });
    if (!raw.length || !fresh.length) st.done = true; // empty page, or a catalog that ignores paging and repeats itself
    grid.insertAdjacentHTML('beforeend', fresh.map(m => posterCard(m, st.type)).join(''));
    foot.innerHTML = (st.done && !st.seen.size) ? '<div class="state-msg" style="padding:0;">Nothing found.</div>' : '';
    ok = true;
  } catch (_) {
    if (st !== catState) return;
    foot.innerHTML = '<div class="state-msg error" style="padding:0;">Could not load more titles. <a href="#" class="retry-cat" style="text-decoration:underline;">Retry</a></div>';
  } finally { st.loading = false; }
  // on tall screens the end of the list can still be in view after a page: keep filling
  if (ok && !st.done) requestAnimationFrame(() => {
    const f = document.getElementById('catFoot');
    if (st === catState && f && f.getBoundingClientRect().top < innerHeight + 900) loadMoreCatalog(st);
  });
}
let catUiCats = [];
document.getElementById('catalogContent').addEventListener('change', e => {
  const sel = e.target.closest('.dd-sel');
  if (!sel || !catState) return;
  let { type, id, genre } = catState;
  if (sel.dataset.k === 'type') {
    type = sel.value;
    if (!catUiCats.some(x => x.type === type && x.id === id)) {
      const list = catUiCats.filter(x => x.type === type);
      id = (list.find(x => x.id === 'top') || list[0] || { id: 'top' }).id;
    }
  } else if (sel.dataset.k === 'id') id = sel.value;
  else genre = sel.value;
  const cur = catUiCats.find(x => x.type === type && x.id === id);
  if (cur && cur.genreRequired) { if (!cur.genres.includes(genre)) genre = cur.genres[0] || ''; }
  else if (genre && !(cur && cur.genres.includes(genre))) genre = '';
  router.replacing = true; // switching filters must not add history entries
  setTimeout(() => { router.replacing = false; }, 400); // safety: never leave the flag stuck if the address did not change
  location.replace(`#/catalog/${type}/${segEnc(id)}${genre ? '/' + encodeURIComponent(genre) : ''}`);
});
document.getElementById('catalogContent').addEventListener('click', e => {
  if (e.target.closest('.retry-cat')) { e.preventDefault(); loadMoreCatalog(catState); }
});

/* ======================================================================
   TITLE VIEW (detail page) — same behavior as the old title.js, plus
   the new "open in other app" click handlers.
   ====================================================================== */
const content = document.getElementById('content');
let titleSaved = false;
let currentType = null;
let currentId = null;

document.getElementById('backBtn').addEventListener('click', goBack);

let titleToken = 0;
async function initTitleView(type, id) {
  currentType = type;
  currentId = id;
  if (!type || !id || !isType(type)) {
    content.innerHTML = `<div class="state-msg" style="padding-top:120px;">Missing title reference.</div>`;
    return;
  }
  const tok = ++titleToken;
  content.innerHTML = `<div class="state-msg" style="padding-top:120px;">Loading...</div>`;
  try {
    const data = await getMeta(type, id);
    if (tok !== titleToken) return; // user already navigated elsewhere
    titleSaved = readSaved().some(s => s.id === id && s.type === type);
    renderTitle(data.meta);
  } catch (err) {
    if (tok !== titleToken) return;
    content.innerHTML = `<div class="state-msg error" style="padding-top:120px;">Could not load details. Check your connection and try again.</div>`;
  }
}

// Series: "Play S1 E1" = first episode of the first real season (specials / season 0 are skipped)
function firstEpisode(meta) {
  if (!Array.isArray(meta.videos)) return null;
  let best = null;
  meta.videos.forEach(v => {
    const ep = v.episode ?? v.number, se = v.season ?? 0;
    if (se <= 0 || ep == null) return;
    if (!best || se < best.season || (se === best.season && ep < best.episode)) best = { season: se, episode: ep };
  });
  return best;
}
function playBtnHtml(meta) {
  if (currentType === 'movie') return `<button class="play-btn" id="playBtn">${ICONS.play} Play</button>`;
  const f = currentType === 'series' ? firstEpisode(meta) : null;
  return f ? `<button class="play-btn" id="playBtn">${ICONS.play} Play S${f.season} E${f.episode}</button>` : '';
}

function renderTitle(meta) {
  if (!meta) {
    content.innerHTML = `<div class="state-msg error" style="padding-top:120px;">Title not found.</div>`;
    return;
  }
  const heroRaw = meta.background || meta.poster || '';
  const hero = /^https?:\/\//i.test(heroRaw) ? heroRaw.replace(/[\\'"()\s]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')) : '';
  const genres = meta.genre || meta.genres || [];
  const cast = (meta.cast || []).slice(0, 6).join(', ');
  const director = (meta.director || []).join(', ');
  const writer = (meta.writer || []).join(', ');

  content.innerHTML = `
    <div class="detail-body">
      <div class="hero-box" id="heroBanner"${hero ? ` style="background-image:url('${hero}')"` : ''}>${hero ? '' : NO_POSTER}</div>
      <div class="top-row">
        ${meta.imdbRating ? `<span class="rating-pill">${esc(meta.imdbRating)}</span>` : ''}
        <div class="chip-row">
          ${genres.slice(0, 4).map(g => `<span class="chip">${esc(g)}</span>`).join('')}
          ${meta.runtime ? `<span class="chip outline">${ICONS.clock}${esc(fmtRuntime(meta.runtime))}</span>` : ''}
        </div>
      </div>

      <h1 class="detail-title">${esc(meta.name || 'Untitled')}${meta.releaseInfo ? ` <span style="color:var(--muted); font-weight:500; font-size:0.6em;">${esc(meta.releaseInfo)}</span>` : ''}</h1>

      ${meta.description ? `<p class="description">${esc(meta.description)}</p>` : ''}

      ${playBtnHtml(meta)}
      <button class="watchlist-btn ${titleSaved ? 'saved' : ''}" id="saveBtn">${ICONS.bookmark} ${titleSaved ? 'Remove from Watchlist' : 'Add to Watchlist'}</button>

      ${director ? `<div class="fact-row"><b>Director</b><span>${esc(director)}</span></div>` : ''}
      ${writer ? `<div class="fact-row"><b>Writer</b><span>${esc(writer)}</span></div>` : ''}
      ${cast ? `<div class="fact-row"><b>Cast</b><span>${esc(cast)}</span></div>` : ''}

      ${renderEpisodes(meta)}
    </div>
  `;

  const chipRow = content.querySelector('.chip-row');
  if (chipRow) {
    const upd = () => chipRow.classList.toggle('fade', chipRow.scrollLeft + chipRow.clientWidth < chipRow.scrollWidth - 2);
    chipRow.addEventListener('scroll', upd, { passive: true });
    upd();
  }
  document.getElementById('saveBtn').addEventListener('click', () => toggleSaveTitle(meta));

  // --- Movie: only the Play button opens the streams page ---
  if (currentType === 'movie') {
    const refId = meta.imdb_id || meta.id || currentId;
    const playBtn = document.getElementById('playBtn');
    if (playBtn) playBtn.addEventListener('click', () => goStreams('movie', refId, meta.name));
  }

  // --- Series: the Play button opens the streams page of the first episode ---
  if (currentType === 'series') {
    const f = firstEpisode(meta);
    const playBtn = document.getElementById('playBtn');
    if (f && playBtn) playBtn.addEventListener('click', () => goStreams('series', `${meta.imdb_id || meta.id || currentId}:${f.season}:${f.episode}`, meta.name));
  }

  // --- Episode row click (series only): open the streams page for that episode ---
  if (currentType === 'series') {
    const refId = meta.imdb_id || meta.id || currentId;
    content.querySelectorAll('.episode-row').forEach(row => {
      row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); } });
      row.addEventListener('click', () => {
        const season = row.dataset.season;
        const episode = row.dataset.episode;
        if (!season || !episode) return;
        goStreams('series', `${refId}:${season}:${episode}`, meta.name);
      });
    });
  }
}

// Remember which season is open for each series, so coming back from a streams page shows the same season
const seasonMemo = new Map();
const SEASON_KEY = 'os_season_memo';
function recallSeason(id) {
  if (seasonMemo.has(id)) return seasonMemo.get(id);
  try { const o = JSON.parse(sessionStorage.getItem(SEASON_KEY) || '{}'); if (o && o[id] != null) return Number(o[id]); } catch (_) {}
  return null;
}
function rememberSeason(id, season) {
  seasonMemo.set(id, Number(season));
  if (seasonMemo.size > 40) seasonMemo.delete(seasonMemo.keys().next().value);
  try { sessionStorage.setItem(SEASON_KEY, JSON.stringify(Object.fromEntries(seasonMemo))); } catch (_) {}
}

// "112 min" -> "1h 52m", "123min" -> "2h 03m", "45 min" -> "45m"
function fmtRuntime(v) {
  const t = String(v == null ? '' : v).trim();
  if (!t) return '';
  const hm = t.match(/^(\d+)\s*h\w*\s*(?:(\d+)\s*m\w*)?$/i);
  let total = null;
  if (hm) total = (+hm[1]) * 60 + (+hm[2] || 0);
  else { const mm = t.match(/^(\d+)\s*(?:min\w*|m)?$/i); if (mm) total = +mm[1]; }
  if (total == null || !(total > 0)) return t;
  const h = Math.floor(total / 60), m = total % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
// episode date is after today (compared by calendar day) -> not aired yet
function isUpcoming(v) {
  if (!v) return false;
  const d = new Date(v);
  if (isNaN(d)) return false;
  const n = new Date();
  const today = n.getFullYear() * 10000 + (n.getMonth() + 1) * 100 + n.getDate();
  const ep = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  return ep > today;
}

// "2026-10-16T00:00:00.000Z" -> "16 October 2026" (UTC, so the day never shifts with the time zone)
function fmtEpDate(v) {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function episodeMeta(ep) {
  const raw = ep.released || ep.firstAired;
  const d = fmtEpDate(raw);
  if (!d) return '';
  const soon = d && isUpcoming(raw) ? ' <em class="ep-soon">(Upcoming)</em>' : '';
  return `<div class="episode-meta">${d ? `<span class="ep-date">${ICONS.calendar}<span>${esc(d)}${soon}</span></span>` : ''}</div>`;
}

function renderEpisodes(meta) {
  if (currentType !== 'series' || !Array.isArray(meta.videos) || !meta.videos.length) return '';

  const bySeason = {};
  meta.videos.forEach(v => {
    if (v.episode == null && v.number != null) v.episode = v.number;
    const s = v.season ?? 0;
    if (s <= 0) return; // skip specials ("Season 0")
    (bySeason[s] = bySeason[s] || []).push(v);
  });
  const seasons = Object.keys(bySeason).map(Number).sort((a, b) => a - b);
  if (!seasons.length) return '';

  const multi = seasons.length > 1;
  const want = recallSeason(currentId);
  const sel = seasons.includes(want) ? want : seasons[0]; // the season that was open before (else Season 1)
  const blocks = seasons.map((s, i) => {
    const eps = bySeason[s].sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
    const rows = eps.map(ep => `
      <div class="episode-row" role="button" tabindex="0" data-season="${s}" data-episode="${ep.episode ?? ''}">
        <div class="episode-num">${String(ep.episode ?? '').padStart(2, '0')}</div>
        <div class="episode-info">
          <div class="episode-title">${esc(ep.title || ep.name || ('Episode ' + ep.episode))}</div>
          ${episodeMeta(ep)}
          ${ep.overview ? `<div class="episode-overview">${esc(ep.overview)}</div>` : ''}
        </div>
      </div>
    `).join('');
    return `<div class="season-block${s === sel ? '' : ' hidden'}" data-s="${s}">${multi ? '' : `<div class="season-title">Season ${s}</div>`}${rows}</div>`;
  }).join('');
  const picker = multi
    ? `<div class="season-picker" role="tablist" aria-label="Seasons">${seasons.map((s, i) => `<button type="button" role="tab" class="${s === sel ? 'on' : ''}" aria-selected="${s === sel}" data-s="${s}" onclick="pickSeason(this)">Season ${s}</button>`).join('')}</div>`
    : '';

  const totalEpisodes = seasons.reduce((sum, s) => sum + bySeason[s].length, 0);
  const label = `${seasons.length} Season${seasons.length !== 1 ? 's' : ''}, ${totalEpisodes} Episode${totalEpisodes !== 1 ? 's' : ''}`;

  return `<div class="section-label">${ICONS.episodes} ${label}</div>${picker}${blocks}`;
}

function pickSeason(btn) {
  const s = btn.dataset.s;
  document.querySelectorAll('.season-picker button').forEach(b => { const on = b === btn; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  document.querySelectorAll('.season-block').forEach(b => b.classList.toggle('hidden', b.dataset.s !== s));
  rememberSeason(currentId, s);
}

function toggleSaveTitle(meta) {
  const btn = document.getElementById('saveBtn');
  if (titleSaved) {
    removeSaved(currentType, currentId);
    titleSaved = false;
  } else {
    addSaved({ id: currentId, type: currentType, name: meta.name, poster: meta.poster, year: meta.releaseInfo, rating: meta.imdbRating });
    titleSaved = true;
  }
  btn.classList.toggle('saved', titleSaved);
  btn.innerHTML = `${ICONS.bookmark} ${titleSaved ? 'Remove from Watchlist' : 'Add to Watchlist'}`;
}

/* ======================================================================
   Router (hash-based, replaces index.html / title.html navigation)
   ====================================================================== */
let homeScroll = 0;
/* Addresses of the app
     /                        home (Discover)          /watchlist                 home (Watchlist tab)
     /t/<type>/<id>           title page               /c/<type>/<id>[/<genre>]   "See all" catalog
     /#/streams/<type>/<id>   streams page
   Old links (#title?type=..&id=.. and so on) still open and are rewritten to the short form. */
function parseRoute() {
  const h = location.hash.slice(1);
  const p = location.pathname;
  let m;
  if (h.startsWith('/')) { // #/streams/movie/tt123
    const [page, a, b, c] = h.split('?')[0].split('/').slice(1).map(segDec);
    if ((page === 'streams' || page === 'title') && isType(a) && b) return { page, type: a, id: b };
    if (page === 'catalog' && isType(a) && b) return { page, type: a, id: b, genre: c || '' };
    if (page === 'watchlist') return { page };
  } else if (h) { // old style: #title?type=movie&id=tt123
    const page = h.split('?')[0];
    const q = new URLSearchParams(h.split('?')[1] || '');
    if (page === 'streams' || page === 'title' || page === 'catalog') return { page, type: q.get('type'), id: q.get('id'), genre: q.get('genre') || '', name: q.get('n') || '' };
  } else { // clean address: /t/movie/tt123
    if ((m = p.match(/^\/t\/(movie|series)\/([^/]+)\/?$/))) return { page: 'title', type: m[1], id: segDec(m[2]) };
    if ((m = p.match(/^\/c\/(movie|series)\/([^/]+)(?:\/([^/]+))?\/?$/))) return { page: 'catalog', type: m[1], id: segDec(m[2]), genre: m[3] ? segDec(m[3]) : '' };
    if (/^\/watchlist\/?$/.test(p)) return { page: 'watchlist' };
  }
  return { page: 'home' };
}
function canonFor(r) {
  if (r.page === 'title' && isType(r.type) && r.id) return `/t/${r.type}/${segEnc(r.id)}`;
  if (r.page === 'catalog' && isType(r.type) && r.id) return `/c/${r.type}/${segEnc(r.id)}` + (r.genre ? '/' + encodeURIComponent(r.genre) : '');
  if (r.page === 'streams' && isType(r.type) && r.id) return `/#/streams/${r.type}/${segEnc(r.id)}`;
  if (r.page === 'watchlist') return '/watchlist';
  return null;
}
function router() {
  // track in-app depth: new entries have no state yet; back/forward restores the stored depth
  if (router.replacing) { // same page depth: this navigation replaced the current history entry
    router.replacing = false;
    navDepth = router.last == null ? 0 : router.last;
    try { history.replaceState({ d: navDepth }, ''); } catch (_) {}
  } else if (history.state && typeof history.state.d === 'number') navDepth = history.state.d;
  else { navDepth = router.last == null ? 0 : router.last + 1; try { history.replaceState({ d: navDepth }, ''); } catch (_) {} }
  router.last = navDepth;
  if (document.getElementById('view-catalog').style.display !== 'none') saveCatSnapshot();
  const r = parseRoute();
  if (r.page !== 'catalog') stopCatObserver();
  if (viewHome.style.display !== 'none') homeScroll = window.scrollY;
  // address bar: every page gets a short, clean address
  try {
    let canon = canonFor(r);
    if (!canon && location.pathname !== '/') canon = '/' + location.hash;
    if (canon && location.pathname + location.hash !== canon) history.replaceState(history.state, '', canon);
  } catch (_) {}
  const vs = document.getElementById('view-streams'), vc = document.getElementById('view-catalog');
  viewHome.style.display = 'none'; viewTitle.style.display = 'none'; vs.style.display = 'none'; vc.style.display = 'none';
  if (r.page === 'streams') {
    vs.style.display = '';
    window.scrollTo(0, 0);
    initStreamsView(r.type, r.id, r.name);
  } else if (r.page === 'title') {
    viewTitle.style.display = '';
    window.scrollTo(0, 0);
    initTitleView(r.type, r.id);
  } else if (r.page === 'catalog') {
    vc.style.display = '';
    window.scrollTo(0, 0);
    initCatalogView(r.type, r.id, r.genre);
  } else {
    viewHome.style.display = '';
    loadSaved();
    setTab(r.page === 'watchlist' ? 'watchlist' : 'discover');
    const y = homeScroll;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }
}
// hashchange and popstate can both fire for one navigation, so only re-render when the address really changed
function onNav() {
  const k = location.pathname + location.search + location.hash;
  if (k === onNav.k) return;
  router();
  onNav.k = location.pathname + location.search + location.hash;
}
window.addEventListener('hashchange', onNav);
window.addEventListener('popstate', onNav);

/* ---------- Settings: addons, watchlist backup ---------- */
const setOverlay = document.getElementById('setOverlay');
const addonInput = document.getElementById('addonInput');
const addonStatus = document.getElementById('addonStatus');
const addonListEl = document.getElementById('addonList');
const addonAddBtn = document.getElementById('addonAdd');
const setStatus = (msg, cls) => { addonStatus.textContent = msg || ''; addonStatus.className = 'set-status ' + (cls || ''); };
let confirmRemove = -1;
function renderAddonList() {
  addonListEl.innerHTML = ADDONS.length
    ? ADDONS.map((a, i) => i === confirmRemove
        ? `<div class="addon-item"><div class="ai"><b>Remove ${esc(a.name)}?</b><span>You can add it again later.</span></div><button class="addon-cancel">Cancel</button><button class="addon-confirm danger">Remove</button></div>`
        : `<div class="addon-item"><div class="ai"><b>${esc(a.name)}</b><span>${esc(hostOf(a.base))}</span></div><button class="addon-remove" data-i="${i}">Remove</button></div>`).join('')
    : '<div class="addon-empty">No addons added yet.</div>';
}
function openSettings() {
  confirmRemove = -1;
  renderAddonList();
  addonInput.value = '';
  setStatus('');
  updateInstallBox();
  syncTorrentSwitch();
  setOverlay.classList.add('open');
  document.body.classList.add('lock');
}
function closeSettings() { setOverlay.classList.remove('open'); document.body.classList.remove('lock'); }
document.getElementById('addonClose').addEventListener('click', closeSettings);
setOverlay.addEventListener('click', e => { if (e.target === setOverlay) closeSettings(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSettings(); });
function refreshStreams() { if (parseRoute().page === 'streams') router(); }
addonListEl.addEventListener('click', e => {
  if (e.target.closest('.addon-remove')) { confirmRemove = +e.target.closest('.addon-remove').dataset.i; renderAddonList(); return; }
  if (e.target.closest('.addon-cancel')) { confirmRemove = -1; renderAddonList(); return; }
  if (e.target.closest('.addon-confirm')) {
    if (confirmRemove < 0 || confirmRemove >= ADDONS.length) return;
    const gone = ADDONS.splice(confirmRemove, 1)[0];
    confirmRemove = -1;
    saveAddons();
    renderAddonList();
    setStatus(`Removed ${gone.name}.`, 'ok');
    refreshStreams();
  }
});

// An https:// page cannot call plain http:// servers (browsers block it), except localhost.
function mixedContentBlocked(url, proto = location.protocol) {
  return proto === 'https:' && /^http:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(url);
}
class AddonError extends Error {}
async function addAddon() {
  if (!addonInput.value.trim()) { setStatus('Paste an addon URL first.', 'err'); return; }
  const p = parseAddonUrl(addonInput.value);
  if (!p) { setStatus('Enter a valid http(s):// or stremio:// URL.', 'err'); return; }
  if (ADDONS.some(a => a.base === p.base && (a.query || '') === p.query)) { setStatus('This addon is already added.', 'err'); return; }
  if (mixedContentBlocked(p.base)) { setStatus('This page runs on https, so the browser blocks http:// addon URLs. Use the https:// version of the addon URL.', 'err'); return; }
  setStatus('Checking addon...');
  addonAddBtn.disabled = true;
  try {
    const r = await fetch(p.base + '/manifest.json' + p.query, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new AddonError(`The addon server returned HTTP ${r.status}.`);
    let m;
    try { m = await r.json(); } catch (_) { throw new AddonError('That URL did not return a valid addon manifest.'); }
    const res = (Array.isArray(m.resources) ? m.resources : []).find(x => (typeof x === 'string' ? x : x && x.name) === 'stream');
    if (!res) throw new AddonError('This addon does not provide streams.');
    const types = (res && res.types) || m.types;
    const idPrefixes = (res && res.idPrefixes) || m.idPrefixes;
    if (Array.isArray(types) && !types.some(x => x === 'movie' || x === 'series')) throw new AddonError('This addon does not support movies or series.');
    const name = String(m.name || hostOf(p.base)).slice(0, 60);
    ADDONS.push({ name, base: p.base, query: p.query, types: Array.isArray(types) ? types : null, idPrefixes: Array.isArray(idPrefixes) ? idPrefixes : null });
    saveAddons();
    renderAddonList();
    addonInput.value = '';
    setStatus('Added: ' + name, 'ok');
    refreshStreams();
  } catch (e) {
    setStatus(e instanceof AddonError ? e.message
      : e && e.name === 'TimeoutError' ? 'The addon took too long to respond.'
      : e instanceof TypeError ? 'Could not reach the addon. Check your connection, or the server may block requests from browsers (CORS).'
      : 'Something went wrong while checking the addon.', 'err');
  } finally { addonAddBtn.disabled = false; }
}
addonAddBtn.addEventListener('click', addAddon);
addonInput.addEventListener('keydown', e => { if (e.key === 'Enter') addAddon(); });

const torrentSwitch = document.getElementById('torrentSwitch');
function syncTorrentSwitch() { torrentSwitch.setAttribute('aria-checked', TORRENTS_ON ? 'true' : 'false'); }
torrentSwitch.addEventListener('click', () => {
  TORRENTS_ON = !TORRENTS_ON;
  try { localStorage.setItem(TORRENT_KEY, TORRENTS_ON ? '1' : '0'); } catch (_) {}
  syncTorrentSwitch();
  setStatus(TORRENTS_ON ? 'Magnet links enabled.' : 'Magnet links disabled.', 'ok');
  refreshStreams();
});
syncTorrentSwitch();

const installBox = document.getElementById('installBox');
const installBtn = document.getElementById('installBtn');
const installHint = document.getElementById('installHint');
const dbFile = document.getElementById('dbFile');
// keep only known fields of an imported addon and re-validate its URL
function sanitizeAddon(a) {
  if (!a || typeof a.base !== 'string') return null;
  const p = parseAddonUrl(a.base + (typeof a.query === 'string' ? a.query : ''));
  if (!p) return null;
  const arr = v => Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 20) : null;
  const name = (typeof a.name === 'string' && a.name.trim()) ? a.name.trim() : hostOf(p.base);
  return { name: name.slice(0, 60), base: p.base, query: p.query, types: arr(a.types), idPrefixes: arr(a.idPrefixes) };
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
document.getElementById('dbExport').addEventListener('click', () => {
  const list = readSaved();
  if (!ADDONS.length && !list.length) { setStatus('Nothing to export yet. Add an addon or save a title first.', 'err'); return; }
  const blob = new Blob([JSON.stringify({ app: 'openstream', version: 2, exportedAt: new Date().toISOString(), addons: ADDONS, watchlist: list }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `openstream-database-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  setStatus(`Exported ${plural(ADDONS.length, 'addon')} and ${plural(list.length, 'title')}.`, 'ok');
});
document.getElementById('dbImport').addEventListener('click', () => dbFile.click());
dbFile.addEventListener('change', async () => {
  const f = dbFile.files[0];
  dbFile.value = '';
  if (!f) return;
  if (f.size > 2e6) { setStatus('That file is too large to be a database backup.', 'err'); return; }
  try {
    const data = JSON.parse(await f.text());
    const wl = Array.isArray(data) ? data : (data && data.watchlist); // old watchlist-only backups still work
    const ad = (data && !Array.isArray(data)) ? data.addons : undefined;
    if (!Array.isArray(wl) && !Array.isArray(ad)) throw new Error('bad format');
    let addedA = 0, addedW = 0, dup = 0, bad = 0;
    // addons
    const haveA = new Set(ADDONS.map(a => a.base + (a.query || '')));
    (Array.isArray(ad) ? ad : []).forEach(x => {
      const a = sanitizeAddon(x);
      if (!a) { bad++; return; }
      const k = a.base + a.query;
      if (haveA.has(k)) { dup++; return; }
      haveA.add(k);
      ADDONS.push(a);
      addedA++;
    });
    if (addedA) { saveAddons(); renderAddonList(); refreshStreams(); }
    // watchlist
    const str = v => (typeof v === 'string' || typeof v === 'number') ? String(v).slice(0, 500) : '';
    const have = readSaved();
    const keys = new Set(have.map(s => s.type + ':' + s.id));
    (Array.isArray(wl) ? wl : []).forEach(x => {
      if (!x || typeof x.id !== 'string' || !/^[\w:.-]+$/.test(x.id) || (x.type !== 'movie' && x.type !== 'series')) { bad++; return; }
      if (keys.has(x.type + ':' + x.id)) { dup++; return; }
      keys.add(x.type + ':' + x.id);
      have.push({ id: x.id, type: x.type, name: str(x.name), poster: /^https?:\/\//i.test(x.poster || '') ? str(x.poster) : '', year: str(x.year), rating: str(x.rating), savedAt: str(x.savedAt) || new Date().toISOString() });
      addedW++;
    });
    if (addedW) {
      if (!writeSaved(have)) { setStatus('Could not save the watchlist: browser storage is full or blocked.', 'err'); return; }
      loadSaved();
    }
    setStatus(`Imported ${plural(addedA, 'addon')} and ${plural(addedW, 'title')}` + (dup ? `, ${dup} already here` : '') + (bad ? `, ${bad} invalid skipped` : '') + '.', (addedA || addedW) ? 'ok' : '');
  } catch (_) { setStatus('That file is not a valid OpenStream database backup.', 'err'); }
});

/* ---------- Install as app (PWA) ---------- */
let deferredInstall = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
window.addEventListener('appinstalled', () => { deferredInstall = null; updateInstallBox(); });
function updateInstallBox() {
  installBox.style.display = isStandalone() ? 'none' : '';
  installBtn.style.display = deferredInstall ? '' : 'none';
  installHint.textContent = deferredInstall ? '' : (IS_IOS ? 'To install: tap Share, then "Add to Home Screen".' : 'To install: open your browser menu, then choose "Install app" or "Add to Home screen".');
}
installBtn.addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  try { await deferredInstall.userChoice; } catch (_) {}
  deferredInstall = null;
  updateInstallBox();
});
function drawIcon(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  x.fillStyle = '#100e0c'; x.fillRect(0, 0, size, size);
  const pad = size * 0.2;
  x.translate(pad, pad); x.scale((size - 2 * pad) / 24, (size - 2 * pad) / 24);
  x.strokeStyle = '#cda24e'; x.lineWidth = 2; x.lineCap = 'round'; x.lineJoin = 'round';
  x.stroke(new Path2D('M3 3h18v18H3z'));
  x.stroke(new Path2D('M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4'));
  return c.toDataURL('image/png');
}
function setupPwa() {
  if (!/^https?:$/.test(location.protocol)) return;
  try {
    const i192 = drawIcon(192), i512 = drawIcon(512);
    const link = (rel, href) => { const l = document.createElement('link'); l.rel = rel; l.href = href; document.head.appendChild(l); };
    link('icon', i192);
    link('apple-touch-icon', i192);
    const manifest = { name: 'OpenStream', short_name: 'OpenStream', start_url: location.origin + '/', scope: location.origin + '/', display: 'standalone', background_color: '#100e0c', theme_color: '#100e0c',
      icons: [{ src: i192, sizes: '192x192', type: 'image/png', purpose: 'any maskable' }, { src: i512, sizes: '512x512', type: 'image/png', purpose: 'any maskable' }] };
    link('manifest', URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' })));
  } catch (_) {}
}
setupPwa();

// Hide broken poster images instead of showing the browser's broken-image icon
document.addEventListener('error', e => {
  const i = e.target;
  if (!i || i.tagName !== 'IMG') return;
  const fb = i.dataset.fb;
  if (fb) { delete i.dataset.fb; i.src = fb; return; } // fall back to the original poster size
  const wrap = i.parentElement;
  if (wrap && wrap.matches('.p-img, .list-thumb')) { i.remove(); wrap.insertAdjacentHTML('afterbegin', NO_POSTER); return; } // poster failed to load
  i.style.visibility = 'hidden';
}, true);

loadSaved();
router();
onNav.k = location.pathname + location.search + location.hash;
// the old local title index is gone: free the space it used on this device
try { indexedDB.deleteDatabase('openstream_local'); } catch (_) {}
