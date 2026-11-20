'use strict';

const { fetchJson, similarTitle } = require('./util');

/** Resolve a title/year to an IMDb id using IMDb's public suggestion endpoint. */
async function lookupImdb(title, year, type) {
  if (!title) return null;
  const clean = String(title).trim();

  // TMDB gives much better coverage for obscure/regional titles.
  if (process.env.TMDB_API_KEY) {
    try {
      const kind = type === 'series' ? 'tv' : 'movie';
      const yearParam = type === 'movie'
        ? (year ? `&year=${year}` : '')
        : (year ? `&first_air_date_year=${year}` : '');
      const url = `https://api.themoviedb.org/3/search/${kind}?api_key=${encodeURIComponent(process.env.TMDB_API_KEY)}&query=${encodeURIComponent(clean)}${yearParam}&include_adult=false`;
      const data = await fetchJson(url, { timeoutMs: 15000, retries: 1 });
      const candidates = (data.results || []).map((item) => ({
        id: item.id,
        name: type === 'movie' ? item.title : item.name,
        date: type === 'movie' ? item.release_date : item.first_air_date,
        poster: item.poster_path || null
      }));
      let best = null;
      let bestScore = 0;
      for (const candidate of candidates) {
        let score = similarTitle(clean, candidate.name || '');
        const candidateYear = String(candidate.date || '').slice(0, 4);
        if (year && candidateYear && Math.abs(Number(candidateYear) - Number(year)) <= 1) score += 0.3;
        if (score > bestScore) { best = candidate; bestScore = score; }
      }
      if (best && bestScore >= 0.6) {
        const external = await fetchJson(
          `https://api.themoviedb.org/3/${kind}/${best.id}/external_ids?api_key=${encodeURIComponent(process.env.TMDB_API_KEY)}`,
          { timeoutMs: 15000, retries: 1 }
        );
        if (external.imdb_id) {
          return {
            imdbId: external.imdb_id,
            name: best.name,
            year: String(best.date || '').slice(0, 4) || null,
            poster: best.poster ? `https://image.tmdb.org/t/p/w500${best.poster}` : null
          };
        }
      }
    } catch {
      /* fall through to IMDb suggestions */
    }
  }

  const first = (clean[0] || 'x').toLowerCase();
  const letter = /[a-z0-9]/.test(first) ? first : 'x';
  const url = `https://v3.sg.media-imdb.com/suggestion/${encodeURIComponent(letter)}/${encodeURIComponent(clean)}.json`;

  let data;
  try {
    data = await fetchJson(url, { timeoutMs: 15000, retries: 1 });
  } catch {
    return null;
  }

  const wantedSeries = type === 'series';
  const candidates = (data.d || []).filter((entry) => {
    if (!/^tt\d+$/.test(entry.id || '')) return false;
    const qid = String(entry.qid || '').toLowerCase();
    if (wantedSeries) {
      if (!/tvseries|tvminiseries|tvspecial/.test(qid)) return false;
    } else if (qid !== 'movie') {
      return false;
    }
    return similarTitle(clean, entry.l || '') >= 0.75;
  });

  let best = null;
  let bestScore = -1;
  for (const entry of candidates) {
    let score = similarTitle(clean, entry.l);
    if (year && entry.y && Math.abs(Number(entry.y) - Number(year)) <= 1) score += 0.3;
    else if (year && entry.y && Math.abs(Number(entry.y) - Number(year)) > 3) score -= 0.3;
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return best ? { imdbId: best.id, name: best.l, year: best.y || null } : null;
}

module.exports = { lookupImdb };
