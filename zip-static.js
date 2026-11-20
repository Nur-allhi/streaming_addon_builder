'use strict';

const fs = require('fs');
const path = require('path');
const { createZip } = require('./lib/zip');

const OUT_DIR = path.resolve(process.env.STATIC_DIR || path.join(__dirname, 'static'));
const ZIP_FILE = path.resolve(process.env.ZIP_FILE || path.join(__dirname, 'nuvio-addon.zip'));

function collect(dir, relative = '', files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) collect(full, name, files);
    else files.push({ name, data: fs.readFileSync(full) });
  }
  return files;
}

if (!fs.existsSync(OUT_DIR)) {
  console.error('[zip] No static folder found. Run npm run export first.');
  process.exit(1);
}

const files = collect(OUT_DIR);
fs.writeFileSync(ZIP_FILE, createZip(files));
console.log(`[zip] wrote ${ZIP_FILE} (${files.length} files, ${fs.statSync(ZIP_FILE).size} bytes)`);
