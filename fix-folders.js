'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const file = path.join(DATA_DIR, 'index.json');

function contentFolderFor(rel) {
  const parts = String(rel || '').split('/').filter(Boolean);
  if (parts.some((part) => /^english\s*movies$/i.test(part))) return 'English Movies';
  if (parts.some((part) => /^tv[ _-]?series$/i.test(part))) return 'TV Series';
  const folder = parts.find((part) => !/^disk\d+$/i.test(part) && !/^(19|20)\d{2}$/.test(part));
  return (folder || 'Other').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

const index = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const item of [...(index.movies || []), ...(index.series || [])]) {
  item.contentFolder = contentFolderFor(item.rel);
  item.shortKey = String(item.shortKey || (item.sourceKey === 'ctgfun-ftp' ? 'FTP' : 'MOVIES'));
}
fs.writeFileSync(file, JSON.stringify(index), 'utf8');
console.log('[fix] updated content folders for', (index.movies || []).length + (index.series || []).length, 'items');
