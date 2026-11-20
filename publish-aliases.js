'use strict';

/**
 * Publishes stream files named with IMDb episode IDs (tt123:1:2) directly into
 * the gh-pages git tree. Windows cannot create filenames containing ':', but
 * GitHub's Linux git trees can, and Nuvio requests exactly these URLs when a
 * series is opened from global search.
 */

const fs = require('fs');
const path = require('path');
const { normalizeTitle } = require('./lib/util');

const OWNER = 'Nur-allhi';
const REPO = 'streaming_addon_builder';
const BRANCH = 'gh-pages';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const TOKEN = process.env.GITHUB_TOKEN;

if (!TOKEN) {
  console.error('[aliases] GITHUB_TOKEN is required. Run: $env:GITHUB_TOKEN = gh auth token');
  process.exit(1);
}

async function api(apiPath, options = {}) {
  const response = await fetch(`https://api.github.com${apiPath}`, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${apiPath}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

function imdbKey(type, title, year) {
  return `${type}|${normalizeTitle(title)}|${year || ''}`;
}

function subsFor(item, file) {
  if (!item.subtitles || !item.subtitles.length) return [];
  const base = file.name.replace(/\.[^.]+$/, '').toLowerCase();
  return item.subtitles
    .filter((sub) => {
      const subBase = sub.name.replace(/\.[^.]+$/, '').toLowerCase();
      return subBase === base || subBase.includes(base.slice(0, 24)) || base.includes(subBase.slice(0, 24));
    })
    .map((sub) => ({ id: sub.name, url: sub.url, lang: 'en' }));
}

function streamContent(item, file) {
  const stream = {
    name: `${item.source} · Direct`,
    title: [file.quality, file.name.replace(/\.[^.]+$/, '')].filter(Boolean).join(' · '),
    url: file.url,
    behaviorHints: { notWebReady: false }
  };
  const subs = subsFor(item, file);
  if (subs.length) stream.subtitles = subs;
  return { streams: [stream] };
}

async function main() {
  const index = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'index.json'), 'utf8'));
  const imdb = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'imdb-cache.json'), 'utf8'));

  const tree = [];
  let count = 0;
  for (const item of index.series || []) {
    const entry = imdb[imdbKey('series', item.title, item.year)];
    if (!entry || !entry.imdbId) continue;
    for (const episode of item.episodes || []) {
      const files = item.episodes.filter(
        (e) => e.season === episode.season && e.episode === episode.episode
      );
      tree.push({
        path: `stream/series/${entry.imdbId}:${episode.season}:${episode.episode}.json`,
        mode: '100644',
        type: 'blob',
        content: JSON.stringify(streamContent(item, files[0] || episode))
      });
      count++;
    }
  }

  // Skip anything already published (safe to re-run after a partial failure).
  const ref0 = await api(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  const commit0 = await api(`/repos/${OWNER}/${REPO}/git/commits/${ref0.object.sha}`);
  const remoteTree = await api(`/repos/${OWNER}/${REPO}/git/trees/${commit0.tree.sha}?recursive=1`);
  const existing = new Set((remoteTree.tree || []).map((entry) => entry.path));
  const missing = tree.filter((entry) => !existing.has(entry.path));
  const deletions = [
    { path: 'probe%3Atest.json', mode: '100644', type: 'blob', sha: null },
    { path: 'zz-test.json', mode: '100644', type: 'blob', sha: null }
  ].filter((entry) => existing.has(entry.path));

  const pending = [...missing, ...deletions];
  console.log(`[aliases] ${tree.length} wanted, ${missing.length} missing, ${deletions.length} temp files to remove`);

  const BATCH = 400;
  for (let offset = 0; offset < pending.length; offset += BATCH) {
    const batch = pending.slice(offset, offset + BATCH);
    let published = false;
    for (let attempt = 1; attempt <= 4 && !published; attempt++) {
      try {
        const ref = await api(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
        const commitSha = ref.object.sha;
        const commit = await api(`/repos/${OWNER}/${REPO}/git/commits/${commitSha}`);
        const newTree = await api(`/repos/${OWNER}/${REPO}/git/trees`, {
          method: 'POST',
          body: { base_tree: commit.tree.sha, tree: batch }
        });
        const newCommit = await api(`/repos/${OWNER}/${REPO}/git/commits`, {
          method: 'POST',
          body: {
            message: `Add IMDb episode stream aliases (${offset + 1}-${offset + batch.length})`,
            tree: newTree.sha,
            parents: [commitSha]
          }
        });
        await api(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
          method: 'PATCH',
          body: { sha: newCommit.sha, force: false }
        });
        published = true;
      } catch (error) {
        console.log(`[aliases] batch ${offset + 1} attempt ${attempt} failed: ${error.message.slice(0, 120)}`);
        if (attempt === 4) throw error;
      }
    }
    console.log(`[aliases] ${Math.min(offset + BATCH, pending.length)}/${pending.length}`);
  }
  console.log(`[aliases] published ${count} aliases total`);
}

main().catch((err) => { console.error('[aliases]', err.message); process.exit(1); });
