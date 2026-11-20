'use strict';

const fs = require('fs');
const path = require('path');

const { fetchText, mapLimit, encodeId, cleanPath, normalizeTitle } = require('./util');
const { parseListing, parseMovie, parseSeries, qualityLabel } = require('./parse');

const SOURCES_FILE = process.env.SOURCES_FILE || path.join(__dirname, '..', 'sources.json');

function readSourcesConfig() {
  try {
    const data = JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8'));
    return data && Array.isArray(data.sources) ? data : { sources: [] };
  } catch {
    return { sources: [] };
  }
}

function writeSourcesConfig(config) {
  fs.writeFileSync(SOURCES_FILE, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

function slug(value) {
  return String(value || 'source')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'source';
}

function inferRootType(rootPath) {
  const value = String(rootPath || '').toLowerCase();
  if (/series|tv[ _-]?show|shows|episodes|season/.test(value)) return 'series';
  if (/movie|film|cinema/.test(value)) return 'movie';
  return 'mixed';
}

function normalizeSource(source) {
  let base = String(source.baseUrl || source.base || '').trim();
  if (!base) return null;
  if (!base.endsWith('/')) base += '/';
  const roots = Array.isArray(source.roots) && source.roots.length
    ? source.roots.map((root) => ({
        path: String(root.path || '').replace(/^\/+/, ''),
        type: root.type || inferRootType(root.path)
      }))
    : [{ path: '', type: 'mixed' }];
  return {
    key: slug(source.id || source.key || source.name || base),
    name: source.name || source.id || base,
    base,
    roots
  };
}

function expandDisks(spec) {
  const values = new Set();
  for (const part of String(spec || '1-11').split(',')) {
    const range = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!range) continue;
    const start = Number(range[1]);
    const end = Number(range[2] || range[1]);
    for (let n = start; n <= end; n++) values.add(n);
  }
  return [...values].sort((a, b) => a - b);
}

function defaultSources() {
  const configured = readSourcesConfig().sources.map(normalizeSource).filter(Boolean);
  if (configured.length) return configured;

  const enabled = new Set(String(process.env.ALLOW_SOURCES || 'ftp,movie').split(',').map((s) => s.trim()));
  const sources = [];

  if (enabled.has('ftp')) {
    sources.push({
      key: 'ftp',
      name: 'ctgfun FTP',
      base: 'https://ftp.ctgfun.com/',
      roots: [
        { path: 'English/', type: 'movie' },
        { path: 'Indian/', type: 'movie' },
        { path: 'Others/', type: 'mixed' },
        { path: 'TV_Series/', type: 'series' }
      ]
    });
  }

  if (enabled.has('movie')) {
    sources.push({
      key: 'movie',
      name: 'ctgfun Movies',
      base: 'https://movie.ctgfun.com/',
      roots: expandDisks(process.env.MOVIE_DISKS).map((n) => ({
        path: `disk${n}/English Movies/`,
        type: 'movie'
      }))
    });
  }

  return sources;
}

function defaultConfig() {
  return {
    sources: defaultSources(),
    concurrency: Number(process.env.CRAWL_CONCURRENCY || 8),
    maxDepth: Number(process.env.MAX_DEPTH || 5),
    maxRequests: Number(process.env.MAX_FOLDER_REQUESTS || 20000),
    requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 20000)
  };
}

async function crawl(config = defaultConfig(), onProgress = () => {}) {
  const state = {
    requests: 0,
    errors: 0,
    movies: new Map(),
    series: new Map(),
    startedAt: new Date().toISOString()
  };

  function titleOf(raw, type) {
    return type === 'series' ? parseSeries(raw) : parseMovie(raw);
  }

  function addMovie(source, folderUrl, videos, subs) {
    const rel = cleanPath(new URL(folderUrl).pathname);
    const name = decodeURIComponent(rel.split('/').pop() || rel);
    const parsed = parseMovie(name);
    const files = videos.map((v) => ({
      url: v.url,
      name: v.name,
      quality: qualityLabel(v.name)
    }));
    if (!files.length) return;
    const id = encodeId({ s: source.key, p: rel, t: 'movie' });
    state.movies.set(id, {
      id,
      type: 'movie',
      title: parsed.title || name,
      year: parsed.year,
      source: source.name,
      sourceKey: source.key,
      rel,
      files,
      subtitles: subs.map((s) => ({ url: s.url, name: s.name }))
    });
  }

  function addSeries(source, showName, currentName, parentName, videos, subs) {
    const folderParsed = parseSeries(currentName);
    const normalizedShow = normalizeTitle(showName);

    let id;
    const existing = [...state.series.values()].find(
      (item) => item.sourceKey === source.key && normalizeTitle(item.title) === normalizedShow
    );
    if (existing) {
      id = existing.id;
    } else {
      id = encodeId({ s: source.key, n: showName, t: 'series' });
      state.series.set(id, {
        id,
        type: 'series',
        title: showName,
        year: null,
        source: source.name,
        sourceKey: source.key,
        episodes: [],
        subtitles: []
      });
    }

    const item = state.series.get(id);
    for (const video of videos) {
      const parsed = parseSeries(video.name);
      const season = parsed.season || folderParsed.season || 1;
      const episode = parsed.episode || 1;
      const duplicate = item.episodes.some((e) => e.season === season && e.episode === episode);
      if (duplicate) continue;
      item.episodes.push({
        season,
        episode,
        url: video.url,
        name: video.name,
        quality: qualityLabel(video.name)
      });
    }
    for (const sub of subs) {
      if (!item.subtitles.some((s) => s.url === sub.url)) {
        item.subtitles.push({ url: sub.url, name: sub.name });
      }
    }
  }

  function ingest(ctx, folderUrl, videos, subs) {
    const currentName = ctx.currentName || 'Unknown';

    if (ctx.rootType === 'series') {
      const hasSeasonMarker = /\bS\d{1,2}\b/i.test(currentName);
      const showName = hasSeasonMarker
        ? (ctx.parentName && !/\bS\d{1,2}\b/i.test(ctx.parentName) ? ctx.parentName : parseSeries(currentName).title)
        : currentName;
      addSeries(ctx.source, showName || currentName, currentName, ctx.parentName, videos, subs);
      return;
    }

    if (ctx.rootType === 'mixed') {
      const looksLikeSeries = videos.some((v) => /\bS\d{1,2}\s*E\d{1,3}\b/i.test(v.name)) || /\bS\d{1,2}\b/i.test(currentName);
      if (looksLikeSeries) {
        const showName = parseSeries(currentName).title || currentName;
        addSeries(ctx.source, showName, currentName, ctx.parentName, videos, subs);
        return;
      }
    }

    addMovie(ctx.source, folderUrl, videos, subs);
  }

  async function getListing(url) {
    if (state.requests >= config.maxRequests) throw new Error('MAX_REQUESTS_REACHED');
    state.requests++;
    if (state.requests % 250 === 0) onProgress({ ...state });
    const html = await fetchText(url, { timeoutMs: config.requestTimeoutMs, retries: 1 });
    return parseListing(html, url);
  }

  async function walk(url, depth, ctx) {
    if (depth > config.maxDepth || state.requests >= config.maxRequests) return;
    let entries;
    try {
      entries = await getListing(url);
    } catch (err) {
      if (err.message !== 'MAX_REQUESTS_REACHED') state.errors++;
      return;
    }

    const videos = entries.filter((e) => e.isVideo);
    const subs = entries.filter((e) => e.isSub);
    const dirs = entries.filter((e) => e.isDir);

    if (videos.length) {
      try {
        ingest(ctx, url, videos, subs);
      } catch (err) {
        state.errors++;
      }
      return;
    }

    await mapLimit(dirs, config.concurrency, (dir) =>
      walk(dir.url, depth + 1, {
        source: ctx.source,
        rootType: ctx.rootType,
        parentName: ctx.currentName,
        currentName: dir.name
      })
    );
  }

  for (const source of config.sources) {
    for (const root of source.roots) {
      const rootName = root.path.replace(/\/$/, '').split('/').pop() || source.key;
      await walk(new URL(root.path, source.base).href, 0, {
        source,
        rootType: root.type,
        parentName: null,
        currentName: rootName
      });
    }
  }

  state.finishedAt = new Date().toISOString();
  return {
    movies: [...state.movies.values()],
    series: [...state.series.values()],
    stats: {
      requests: state.requests,
      errors: state.errors,
      movies: state.movies.size,
      series: state.series.size,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt
    }
  };
}

module.exports = {
  crawl,
  defaultConfig,
  defaultSources,
  expandDisks,
  readSourcesConfig,
  writeSourcesConfig,
  normalizeSource,
  inferRootType,
  SOURCES_FILE
};
