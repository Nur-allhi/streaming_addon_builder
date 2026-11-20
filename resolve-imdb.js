'use strict';

const fs = require('fs');
const path = require('path');
const { createStore } = require('./lib/store');
const { lookupImdb } = require('./lib/imdb');
const { mapLimit, normalizeTitle } = require('./lib/util');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const store = createStore(DATA_DIR);
const CACHE_FILE = path.join(DATA_DIR, 'imdb-cache.json');

function keyFor(type, title, year) {
  return `${type}|${normalizeTitle(title)}|${year || ''}`;
}

async function main() {
  const index = store.loadIndex();
  const items = [...(index.movies || []), ...(index.series || [])];
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { /* new */ }

  const pending = items.filter((item) => !Object.prototype.hasOwnProperty.call(cache, keyFor(item.type, item.title, item.year)));
  console.log(`[imdb] ${items.length} items, ${pending.length} need lookup`);

  let done = 0;
  let resolved = 0;
  await mapLimit(pending, 8, async (item) => {
    const result = await lookupImdb(item.title, item.year, item.type);
    cache[keyFor(item.type, item.title, item.year)] = result || { imdbId: null };
    if (result && result.imdbId) resolved++;
    done++;
    if (done % 200 === 0) {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8');
      console.log(`[imdb] ${done}/${pending.length}, resolved ${resolved}`);
    }
  });

  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8');
  console.log(`[imdb] done: ${resolved}/${pending.length} resolved`);
}

main().catch((err) => { console.error('[imdb]', err); process.exit(1); });
