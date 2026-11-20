'use strict';

const { fetchJson, similarTitle } = require('./util');

/** Resolve a title/year to an IMDb id using IMDb's public suggestion endpoint. */
async function lookupImdb(title, year, type) {
  if (!title) return null;
  const clean = String(title).trim();
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
