'use strict';

const { fetchJson, mapLimit, normalizeTitle, similarTitle } = require('./util');

/** Resolves IMDb ids + poster art. Works with or without a TMDB API key. */
function createResolver({ tmdbKey = '', cache = {}, onCacheChange = () => {} }) {
  let dirty = false;

  function keyFor(type, title, year) {
    return `${type}|${normalizeTitle(title)}|${year || ''}`;
  }

  function remember(key, value) {
    cache[key] = value;
    dirty = true;
  }

  function flush() {
    if (dirty) {
      dirty = false;
      onCacheChange(cache);
    }
  }

  function pickBest(candidates, title, year) {
    let best = null;
    let bestScore = 0;
    for (const item of candidates) {
      const score = similarTitle(title, item.name || item.title || '');
      const itemYear = String(item.year || item.releaseInfo || '').match(/(19\d{2}|20\d{2})/);
      const yearBonus = year && itemYear && Math.abs(Number(itemYear[1]) - Number(year)) <= 1 ? 0.15 : 0;
      const total = score + yearBonus;
      if (total > bestScore) {
        best = item;
        bestScore = total;
      }
    }
    return bestScore >= 0.6 ? best : null;
  }

  async function fromTmdb(type, title, year) {
    const path = type === 'movie' ? 'movie' : 'tv';
    const yearParam = type === 'movie'
      ? (year ? `&year=${encodeURIComponent(year)}` : '')
      : (year ? `&first_air_date_year=${encodeURIComponent(year)}` : '');
    const url = `https://api.themoviedb.org/3/search/${path}?api_key=${encodeURIComponent(tmdbKey)}&query=${encodeURIComponent(title)}${yearParam}&include_adult=false`;
    const data = await fetchJson(url);
    const chosen = pickBest((data.results || []).map((r) => ({
      id: r.id,
      name: type === 'movie' ? r.title : r.name,
      year: (type === 'movie' ? r.release_date : r.first_air_date || '').slice(0, 4),
      posterPath: r.poster_path || null,
      backdropPath: r.backdrop_path || null
    })), title, year);
    if (!chosen) return null;
    const external = await fetchJson(
      `https://api.themoviedb.org/3/${path}/${chosen.id}/external_ids?api_key=${encodeURIComponent(tmdbKey)}`
    );
    return {
      imdbId: external.imdb_id || null,
      poster: chosen.posterPath ? `https://image.tmdb.org/t/p/w500${chosen.posterPath}` : null,
      background: chosen.backdropPath ? `https://image.tmdb.org/t/p/w780${chosen.backdropPath}` : null,
      name: chosen.name
    };
  }

  async function fromCinemeta(type, title, year) {
    const url = `https://v3-cinemeta.strem.io/catalog/${type}/search=${encodeURIComponent(title)}.json`;
    const data = await fetchJson(url, { retries: 1 });
    const chosen = pickBest(data.metas || [], title, year);
    if (!chosen) return null;
    return {
      imdbId: chosen.imdb_id || chosen.id || null,
      poster: chosen.poster || null,
      background: chosen.background || null,
      name: chosen.name || title
    };
  }

  async function resolve(type, title, year) {
    if (!title) return null;
    const key = keyFor(type, title, year);
    if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];

    let result = null;
    try {
      if (tmdbKey) result = await fromTmdb(type, title, year);
    } catch {
      result = null;
    }
    if (!result || !result.imdbId) {
      try {
        const fallback = await fromCinemeta(type, title, year);
        if (fallback && (!result || !result.imdbId)) {
          result = { ...(result || {}), ...fallback };
        }
      } catch {
        /* keep whatever TMDB returned */
      }
    }

    result = result || { imdbId: null, poster: null, background: null, name: title };
    remember(key, result);
    return result;
  }

  async function resolveAll(titles, concurrency = 5) {
    await mapLimit(titles, concurrency, (item) => resolve(item.type, item.title, item.year));
    flush();
  }

  return { resolve, resolveAll, flush, cache };
}

module.exports = { createResolver };
