'use strict';

/**
 * One-time sync: scans the two sites (or reuses the cached index) and writes a
 * completely static Stremio/Nuvio add-on to ./static.
 *
 * Host that folder on GitHub Pages / Cloudflare Pages / any static HTTPS host.
 * No server process is needed afterwards. Trade-off: no live `search=` support
 * (browse the paginated catalogs instead) and no automatic re-sync.
 */

const fs = require('fs');
const path = require('path');

const { createStore } = require('./lib/store');
const { crawl, defaultConfig } = require('./lib/crawler');
const { createResolver } = require('./lib/metadata');
const { normalizeTitle } = require('./lib/util');

let imdbCache = {};

function imdbKey(type, title, year) {
  return `${type}|${normalizeTitle(title)}|${year || ''}`;
}

function publicId(item) {
  const entry = imdbCache[imdbKey(item.type, item.title, item.year)];
  return entry && entry.imdbId ? entry.imdbId : item.id;
}

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const OUT_DIR = path.resolve(process.env.STATIC_DIR || path.join(__dirname, 'static'));
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 500);
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const RESOLVE_META = process.env.EXPORT_RESOLVE_META === 'true' || process.env.EXPORT_RESOLVE_META === '1';
const FORCE_SCAN = process.env.FORCE_SCAN === 'true' || process.env.FORCE_SCAN === '1';
const SEARCH_FILES = process.env.EXPORT_SEARCH_FILES === 'true' || process.env.EXPORT_SEARCH_FILES === '1';

const store = createStore(DATA_DIR);

const MANIFEST = {
  id: 'org.ctgfun.directories.static',
  version: '1.0.0',
  name: 'Nuvio Streams',
  description: 'Direct movie and series streams from your configured directories',
  types: ['movie', 'series'],
  resources: [
    { name: 'catalog', types: ['movie', 'series'], idPrefixes: ['tt', 'ctg'] },
    { name: 'meta', types: ['movie', 'series'], idPrefixes: ['tt', 'ctg'] },
    { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt', 'ctg'] }
  ],
  catalogs: [], // filled per source in runExport()
  behaviorHints: { configurable: false }
};

function metaKey(type, title, year) {
  return `${type}|${normalizeTitle(title)}|${year || ''}`;
}

function getCached(item, cache) {
  return cache[metaKey(item.type, item.title, item.year)] || null;
}

function preview(item, cache) {
  const meta = getCached(item, cache);
  return {
    id: publicId(item),
    type: item.type,
    name: item.title,
    poster: meta && meta.poster ? meta.poster : undefined,
    releaseInfo: item.year || undefined,
    description: `Indexed from ${item.source}`
  };
}

function metaObject(item, cache) {
  const meta = getCached(item, cache);
  const id = publicId(item);
  const result = {
    id,
    type: item.type,
    name: item.title,
    poster: meta && meta.poster ? meta.poster : undefined,
    background: meta && meta.background ? meta.background : undefined,
    releaseInfo: item.year || undefined,
    description: `Direct stream indexed from ${item.source}`
  };

  // Inline streams let Nuvio play items opened from global search even when
  // the stream endpoint URL uses an ID format we cannot write to disk.
  if (item.type === 'movie') {
    result.videos = [{ id, title: item.title, streams: item.files.map((file) => streamObject(item, file)) }];
    result.behaviorHints = { defaultVideoId: id, hasScheduledVideos: false };
  } else {
    result.videos = [...item.episodes]
      .sort((a, b) => a.season - b.season || a.episode - b.episode)
      .map((episode) => ({
        id: `${id}:${episode.season}:${episode.episode}`,
        title: `S${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}`,
        season: episode.season,
        episode: episode.episode,
        streams: [streamObject(item, episode)]
      }));
    result.behaviorHints = { hasScheduledVideos: true };
  }
  return { meta: result };
}

function subtitlesFor(item, file) {
  if (!item.subtitles || !item.subtitles.length) return [];
  const base = file.name.replace(/\.[^.]+$/, '').toLowerCase();
  return item.subtitles
    .filter((sub) => {
      const subBase = sub.name.replace(/\.[^.]+$/, '').toLowerCase();
      return subBase === base || subBase.includes(base.slice(0, 24)) || base.includes(subBase.slice(0, 24));
    })
    .map((sub) => ({ id: sub.name, url: sub.url, lang: 'en' }));
}

function streamObject(item, file) {
  const stream = {
    name: `${item.source} · Direct`,
    title: [file.quality, file.name.replace(/\.[^.]+$/, '')].filter(Boolean).join(' · '),
    url: file.url,
    behaviorHints: { notWebReady: false }
  };
  const subs = subtitlesFor(item, file);
  if (subs.length) stream.subtitles = subs;
  return stream;
}

let fileCount = 0;
function write(relativePath, data) {
  const target = path.join(OUT_DIR, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(data));
  fileCount++;
}

/** One movie + one series catalog per configured source directory. */
function buildGroups(index) {
  const sources = new Map();
  for (const item of [...(index.movies || []), ...(index.series || [])]) {
    const key = String(item.sourceKey || 'other');
    if (!sources.has(key)) {
      sources.set(key, { key, name: item.source || key, movies: [], series: [] });
    }
    sources.get(key)[item.type === 'movie' ? 'movies' : 'series'].push(item);
  }

  const groups = [];
  for (const source of sources.values()) {
    groups.push({
      type: 'movie',
      id: `ctg-${source.key}-movies`,
      name: `${source.name} Movies`,
      items: source.movies
    });
    groups.push({
      type: 'series',
      id: `ctg-${source.key}-series`,
      name: `${source.name} Series`,
      items: source.series
    });
  }
  return groups;
}

async function runExport() {
  fileCount = 0;
  let index = store.loadIndex();
  if (FORCE_SCAN || !index.stats || !((index.movies || []).length + (index.series || []).length)) {
    console.log(FORCE_SCAN ? '[export] FORCE_SCAN set - running a fresh scan...' : '[export] no cached index found - running a one-time scan...');
    const result = await crawl(defaultConfig(), ({ requests }) => {
      if (requests % 500 === 0) console.log(`[export] scanned ${requests} folders`);
    });
    index = { movies: result.movies, series: result.series, stats: result.stats };
    store.saveIndex(index);
    console.log(`[export] scan complete: ${result.stats.movies} movies, ${result.stats.series} series`);
  } else {
    console.log('[export] using cached index from data/index.json');
  }

  const cache = store.loadMetaCache();
  const imdbFile = path.join(DATA_DIR, 'imdb-cache.json');
  try {
    imdbCache = JSON.parse(fs.readFileSync(imdbFile, 'utf8'));
  } catch {
    imdbCache = {};
  }
  if (RESOLVE_META) {
    console.log('[export] resolving posters/IMDb IDs (this may take a while)...');
    const resolver = createResolver({ tmdbKey: TMDB_API_KEY, cache, onCacheChange: store.saveMetaCache });
    await resolver.resolveAll(
      [...index.movies, ...index.series].map((item) => ({ type: item.type, title: item.title, year: item.year })),
      5
    );
  }

  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  fs.writeFileSync(path.join(OUT_DIR, '.nojekyll'), '');

  // Cloudflare Pages function: adds live search on top of the static files.
  fs.copyFileSync(path.join(__dirname, 'search-handler.mjs'), path.join(OUT_DIR, 'search-handler.mjs'));
  fs.mkdirSync(path.join(OUT_DIR, 'functions', 'catalog', '[type]', '[id]'), { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, 'functions', 'catalog', '[type]'), { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, 'functions', 'catalog', '[type]', '[id]', '[search].js'),
    "import { handleSearch } from '../../../../search-handler.mjs';\nexport const onRequestGet = handleSearch;\n"
  );
  fs.writeFileSync(
    path.join(OUT_DIR, 'functions', 'catalog', '[type]', '[search].js'),
    "import { handleSearch } from '../../../search-handler.mjs';\nexport const onRequestGet = handleSearch;\n"
  );

  const groups = buildGroups(index);
  MANIFEST.catalogs = groups.map((group) => ({
    type: group.type,
    id: group.id,
    name: group.name,
    extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }]
  }));
  write('manifest.json', MANIFEST);

  for (const group of groups) {
    for (let offset = 0; offset < group.items.length; offset += PAGE_SIZE) {
      const page = group.items.slice(offset, offset + PAGE_SIZE).map((item) => preview(item, cache));
      const relative = offset === 0
        ? `catalog/${group.type}/${group.id}.json`
        : `catalog/${group.type}/${group.id}/skip=${offset}.json`;
      write(relative, { metas: page });
    }

    for (const item of group.items) {
      const id = publicId(item);
      write(`meta/${item.type}/${id}.json`, metaObject(item, cache));

      if (item.type === 'movie') {
        write(`stream/movie/${id}.json`, { streams: item.files.map((file) => streamObject(item, file)) });
      } else {
        for (const episode of item.episodes) {
          const files = item.episodes.filter(
            (e) => e.season === episode.season && e.episode === episode.episode
          );
          write(`stream/series/${id}~${episode.season}~${episode.episode}.json`, {
            streams: files.map((file) => streamObject(item, file))
          });
        }
      }
    }
  }

  // GitHub Pages has no server-side functions, so pre-generate exact-title
  // search files. Typing a complete title works; partial searches do not.
  if (SEARCH_FILES) {
    for (const group of groups) {
      for (const item of group.items) {
        const safe = String(item.title || '')
          .replace(/[<>:"/\\|?*]/g, '-')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120);
        if (!safe) continue;
        const variants = new Set([`search=${safe}.json`, `search=${safe.toLowerCase()}.json`]);
        for (const variant of variants) {
          write(`catalog/${group.type}/${group.id}/${variant}`, { metas: [preview(item, cache)] });
        }
      }
    }
  }

  // Compact index used by the Cloudflare Pages function to answer Nuvio searches.
  const searchIndex = [...(index.movies || []), ...(index.series || [])].map((item) => {
    const meta = getCached(item, cache);
    return {
      id: publicId(item),
      type: item.type,
      name: item.title,
      year: item.year || null,
      poster: meta && meta.poster ? meta.poster : null
    };
  });
  write('search-index.json', searchIndex);

  console.log(`[export] done - ${fileCount} files written to ${OUT_DIR}`);
  console.log('[export] host this folder on GitHub Pages / Cloudflare Pages and install:');
  console.log('         https://<your-static-host>/manifest.json');
}

if (require.main === module) {
  runExport().catch((err) => {
    console.error('[export]', err);
    process.exit(1);
  });
}

module.exports = { runExport, MANIFEST, OUT_DIR };
