'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const { createStore } = require('./lib/store');
const {
  crawl,
  defaultConfig,
  readSourcesConfig,
  writeSourcesConfig,
  normalizeSource
} = require('./lib/crawler');
const { createResolver } = require('./lib/metadata');
const { safeDecode, normalizeTitle } = require('./lib/util');
const { createZip } = require('./lib/zip');
const { WIZARD_HTML } = require('./lib/wizard');
const { runExport, OUT_DIR } = require('./export-static');

const PORT = Number(process.env.PORT || 7000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const REFRESH_HOURS = Number(process.env.REFRESH_HOURS || 12);
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const MAX_CATALOG_ITEMS = Number(process.env.MAX_CATALOG_ITEMS || 1000);
const ONE_TIME_SYNC = process.env.ONE_TIME_SYNC === 'true' || process.env.ONE_TIME_SYNC === '1';

const store = createStore(DATA_DIR);
let index = store.loadIndex();
let refreshing = false;
let lastZip = null;

const resolver = createResolver({
  tmdbKey: TMDB_API_KEY,
  cache: store.loadMetaCache(),
  onCacheChange: (cache) => store.saveMetaCache(cache)
});

const MANIFEST = {
  id: 'org.ctgfun.directories',
  version: '1.0.0',
  name: 'ctgfun Direct (Nuvio / Stremio)',
  description: 'Direct movie and series streams indexed from ftp.ctgfun.com and movie.ctgfun.com',
  types: ['movie', 'series'],
  resources: [
    { name: 'catalog', types: ['movie', 'series'], idPrefixes: ['ctg'] },
    { name: 'meta', types: ['movie', 'series'], idPrefixes: ['ctg'] },
    { name: 'stream', types: ['movie', 'series'], idPrefixes: ['ctg'] }
  ],
  catalogs: [
    { type: 'movie', id: 'ctg-movies', name: 'ctgfun Movies', extra: [{ name: 'search', isRequired: false }] },
    { type: 'series', id: 'ctg-series', name: 'ctgfun Series', extra: [{ name: 'search', isRequired: false }] }
  ],
  behaviorHints: { configurable: false }
};

function metaCacheKey(type, title, year) {
  return `${type}|${normalizeTitle(title)}|${year || ''}`;
}

function cachedMeta(item) {
  return resolver.cache[metaCacheKey(item.type, item.title, item.year)] || null;
}

function toPreview(item) {
  const meta = cachedMeta(item);
  return {
    id: item.id,
    type: item.type,
    name: item.title,
    poster: meta && meta.poster ? meta.poster : undefined,
    releaseInfo: item.year || undefined,
    description: `Indexed from ${item.source}`
  };
}

function toMeta(item) {
  const meta = cachedMeta(item);
  const result = {
    id: item.id,
    type: item.type,
    name: item.title,
    poster: meta && meta.poster ? meta.poster : undefined,
    background: meta && meta.background ? meta.background : undefined,
    releaseInfo: item.year || undefined,
    description: `Direct stream indexed from ${item.source}`
  };

  if (item.type === 'series') {
    result.videos = [...item.episodes]
      .sort((a, b) => a.season - b.season || a.episode - b.episode)
      .map((episode) => ({
        id: `${item.id}~${episode.season}~${episode.episode}`,
        title: `S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}`,
        season: episode.season,
        episode: episode.episode
      }));
  }

  return { meta: result };
}

function matchingSubtitles(item, file) {
  if (!item.subtitles || !item.subtitles.length) return [];
  const base = file.name.replace(/\.[^.]+$/, '').toLowerCase();
  return item.subtitles
    .filter((sub) => {
      const subBase = sub.name.replace(/\.[^.]+$/, '').toLowerCase();
      return subBase === base || subBase.includes(base.slice(0, 24)) || base.includes(subBase.slice(0, 24));
    })
    .map((sub) => ({ id: sub.name, url: sub.url, lang: 'en' }));
}

function buildStream(item, file) {
  const stream = {
    name: `${item.source} · Direct`,
    title: [file.quality, file.name.replace(/\.[^.]+$/, '')].filter(Boolean).join(' · '),
    url: file.url,
    behaviorHints: { notWebReady: false }
  };
  const subs = matchingSubtitles(item, file);
  if (subs.length) stream.subtitles = subs;
  return stream;
}

function handleCatalog(type, extra) {
  const all = type === 'movie' ? index.movies : index.series;
  let items = Array.isArray(all) ? all : [];
  const params = new URLSearchParams(extra || '');
  const query = params.get('search');
  if (query) {
    const needle = query.toLowerCase();
    items = items.filter((item) => item.title.toLowerCase().includes(needle));
  }
  items = items.slice(0, MAX_CATALOG_ITEMS);
  return { metas: items.map(toPreview) };
}

async function handleMeta(type, id) {
  const all = type === 'movie' ? index.movies : index.series;
  const item = (Array.isArray(all) ? all : []).find((entry) => entry.id === id);
  if (!item) return { meta: null };
  const meta = cachedMeta(item);
  if (!meta || !meta.poster) {
    await resolver.resolve(item.type, item.title, item.year);
  }
  return toMeta(item);
}

function handleStream(type, id) {
  if (type === 'movie') {
    const item = (index.movies || []).find((entry) => entry.id === id);
    if (!item) return { streams: [] };
    return { streams: item.files.map((file) => buildStream(item, file)) };
  }

  const separator = id.includes('~') ? '~' : ':';
  const parts = id.split(separator);
  const episode = Number(parts.pop());
  const season = Number(parts.pop());
  const baseId = parts.join(':');
  const item = (index.series || []).find((entry) => entry.id === baseId);
  if (!item || !Number.isFinite(season) || !Number.isFinite(episode)) return { streams: [] };

  const matches = item.episodes.filter((e) => e.season === season && e.episode === episode);
  if (!matches.length) return { streams: [] };
  return { streams: matches.map((file) => buildStream(item, file)) };
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

function zipDirectory(dir) {
  const files = [];
  function walk(current, relative) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, name);
      } else {
        files.push({ name, data: fs.readFileSync(full) });
      }
    }
  }
  walk(dir, '');
  return createZip(files);
}

async function refresh() {
  if (refreshing) return { skipped: true };
  refreshing = true;
  try {
    const config = defaultConfig();
    console.log(`[scan] starting ${config.sources.length} source(s), concurrency ${config.concurrency}`);
    const result = await crawl(config, ({ requests, errors }) => {
      if (requests % 500 === 0) console.log(`[scan] ${requests} folders, ${errors} errors`);
    });
    index = { movies: result.movies, series: result.series, stats: result.stats };
    store.saveIndex(index);
    console.log(`[scan] done: ${result.stats.movies} movies, ${result.stats.series} series in ${result.stats.requests} requests`);

    // Populate posters/IMDb ids in the background so catalog responses stay fast.
    const titles = [...result.movies, ...result.series]
      .filter((item) => !cachedMeta(item))
      .map((item) => ({ type: item.type, title: item.title, year: item.year }));
    resolver.resolveAll(titles, 5).catch((err) => console.error('[meta]', err.message));

    return result.stats;
  } finally {
    refreshing = false;
  }
}

function send(res, status, body, contentType = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Cache-Control': 'no-store'
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (pathname === '/manifest.json') return send(res, 200, MANIFEST);
    if (pathname === '/' || pathname === '/api/status') {
      return send(res, 200, {
        ok: true,
        refreshing,
        manifest: `http://${req.headers.host}/manifest.json`,
        stats: index.stats,
        counts: { movies: (index.movies || []).length, series: (index.series || []).length },
        metaCacheEntries: Object.keys(resolver.cache).length
      });
    }

    if (pathname === '/api/refresh') {
      if (ADMIN_TOKEN && url.searchParams.get('token') !== ADMIN_TOKEN) {
        return send(res, 403, { error: 'forbidden' });
      }
      return send(res, 200, await refresh());
    }

    // ---- Browser setup wizard (non-technical friendly) ----
    if (pathname === '/setup') {
      return send(res, 200, WIZARD_HTML, 'text/html; charset=utf-8');
    }

    if (pathname === '/api/sources') {
      if (req.method === 'GET') {
        return send(res, 200, readSourcesConfig());
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        const normalized = normalizeSource(body);
        if (!normalized) return send(res, 400, { message: 'A website address is required.' });
        const config = readSourcesConfig();
        let id = normalized.key;
        let suffix = 2;
        while (config.sources.some((source) => source.id === id)) id = `${normalized.key}-${suffix++}`;
        const entry = { id, name: normalized.name, baseUrl: normalized.base };
        const realRoots = normalized.roots.filter((root) => root.path || root.type !== 'mixed');
        if (realRoots.length) entry.roots = realRoots;
        config.sources.push(entry);
        writeSourcesConfig(config);
        return send(res, 200, { message: `Added “${normalized.name}”.`, id });
      }
      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id');
        const config = readSourcesConfig();
        config.sources = config.sources.filter((source) => source.id !== id);
        writeSourcesConfig(config);
        return send(res, 200, { message: 'Directory removed.' });
      }
    }

    if (pathname === '/api/scan' && req.method === 'POST') {
      refresh().catch((err) => console.error('[scan]', err));
      return send(res, 200, { started: true });
    }

    if (pathname === '/api/export' && req.method === 'POST') {
      if (refreshing) return send(res, 409, { message: 'A scan is still running. Please wait.' });
      await runExport();
      lastZip = zipDirectory(OUT_DIR);
      return send(res, 200, { message: 'ZIP ready.', size: lastZip.length });
    }

    if (pathname === '/api/download' && req.method === 'GET') {
      if (!lastZip) return send(res, 404, { message: 'Build the ZIP first.' });
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="nuvio-addon.zip"',
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(lastZip);
    }

    let match = pathname.match(/^\/catalog\/([^/]+)\/([^/]+?)(?:\/([^/]+))?\.json$/);
    if (match) {
      const type = safeDecode(match[1]);
      const extra = match[3] ? safeDecode(match[3]) : '';
      return send(res, 200, handleCatalog(type, extra));
    }

    match = pathname.match(/^\/meta\/([^/]+)\/([^/]+?)\.json$/);
    if (match) {
      return send(res, 200, await handleMeta(safeDecode(match[1]), safeDecode(match[2])));
    }

    match = pathname.match(/^\/stream\/([^/]+)\/([^/]+?)\.json$/);
    if (match) {
      return send(res, 200, handleStream(safeDecode(match[1]), safeDecode(match[2])));
    }

    return send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error('[http]', err);
    return send(res, 500, { error: err.message || 'internal error' });
  }
});

async function main() {
  if (process.argv.includes('--scan-once')) {
    const stats = await refresh();
    console.log(JSON.stringify(stats, null, 2));
    resolver.flush();
    process.exit(0);
  }

  server.listen(PORT, HOST, () => {
    console.log(`ctgfun add-on listening on http://${HOST}:${PORT}`);
    console.log(`Manifest URL: http://<this-host>:${PORT}/manifest.json`);
    console.log(`Easy setup page: http://<this-host>:${PORT}/setup`);
  });

  const isStale = !index.stats || !index.stats.finishedAt ||
    Date.now() - new Date(index.stats.finishedAt).getTime() > REFRESH_HOURS * 3600 * 1000;

  if (isStale) refresh().catch((err) => console.error('[scan]', err));
  if (!ONE_TIME_SYNC) {
    setInterval(() => {
      refresh().catch((err) => console.error('[scan]', err));
    }, REFRESH_HOURS * 3600 * 1000).unref();
  } else {
    console.log('[scan] ONE_TIME_SYNC enabled - no automatic re-scan.');
  }
}

main();
