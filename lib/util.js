'use strict';

/** Small dependency-free helpers. */

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodeId(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

function decodeId(id) {
  try {
    return JSON.parse(Buffer.from(id, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function cleanPath(pathname) {
  return safeDecode(pathname).replace(/\/+/g, '/').replace(/^\//, '').replace(/\/$/, '');
}

function normalizeTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[._-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarTitle(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const ta = new Set(na.split(' ').filter(Boolean));
  const tb = new Set(nb.split(' ').filter(Boolean));
  let shared = 0;
  for (const token of ta) if (tb.has(token)) shared++;
  return shared / Math.max(ta.size, tb.size, 1);
}

async function fetchText(url, { timeoutMs = 20000, retries = 2 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ctgfun-directory-addon/1.0)',
          Accept: 'text/html,application/json;q=0.9,*/*;q=0.8'
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function fetchJson(url, options) {
  const text = await fetchText(url, options);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${url}`);
  }
}

/** Run async tasks with a simple concurrency cap. */
async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await mapper(items[index], index);
      } catch (err) {
        results[index] = { __error: err && err.message ? err.message : String(err) };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

module.exports = {
  safeDecode,
  encodeId,
  decodeId,
  cleanPath,
  normalizeTitle,
  similarTitle,
  fetchText,
  fetchJson,
  mapLimit
};
