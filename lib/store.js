'use strict';

const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value), 'utf8');
}

function createStore(dataDir) {
  const indexFile = path.join(dataDir, 'index.json');
  const metaFile = path.join(dataDir, 'meta-cache.json');

  return {
    indexFile,
    metaFile,
    loadIndex: () => readJson(indexFile, { movies: [], series: [], stats: null }),
    saveIndex: (index) => writeJson(indexFile, index),
    loadMetaCache: () => readJson(metaFile, {}),
    saveMetaCache: (cache) => writeJson(metaFile, cache)
  };
}

module.exports = { createStore };
