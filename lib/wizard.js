'use strict';

const WIZARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nuvio Add-on Setup</title>
<style>
  :root { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color:#1b1f24; background:#f6f7f9; }
  body { margin:0; padding:32px 16px; }
  .wrap { max-width:820px; margin:0 auto; }
  h1 { margin:0 0 4px; font-size:28px; }
  .sub { color:#667; margin-bottom:24px; }
  .card { background:#fff; border:1px solid #e3e6ea; border-radius:12px; padding:20px; margin-bottom:16px; box-shadow:0 1px 2px rgba(0,0,0,.03); }
  h2 { font-size:17px; margin:0 0 12px; }
  label { display:block; font-size:13px; font-weight:600; margin:12px 0 4px; }
  input, textarea { width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #ccd2d9; border-radius:8px; font:inherit; font-size:14px; }
  textarea { min-height:74px; resize:vertical; }
  .hint { font-size:12px; color:#778; margin-top:4px; }
  button { border:0; border-radius:8px; padding:10px 16px; font:inherit; font-size:14px; font-weight:600; cursor:pointer; margin:12px 8px 0 0; }
  .primary { background:#2563eb; color:#fff; }
  .secondary { background:#e8edf5; color:#1b1f24; }
  .danger { background:#fee; color:#a33; padding:6px 10px; margin:0; }
  button:disabled { opacity:.5; cursor:not-allowed; }
  ul { list-style:none; padding:0; margin:0; }
  li { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:10px 0; border-bottom:1px solid #eef0f3; }
  li:last-child { border-bottom:0; }
  .url { font-size:12px; color:#667; word-break:break-all; }
  #status { white-space:pre-wrap; font-family:ui-monospace, Consolas, monospace; font-size:12px; background:#111827; color:#d1fae5; padding:14px; border-radius:8px; min-height:60px; }
  a.button { display:inline-block; text-decoration:none; background:#16a34a; color:#fff; border-radius:8px; padding:10px 16px; font-weight:600; margin-top:12px; }
  code { background:#eef0f3; padding:2px 6px; border-radius:4px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Nuvio Add-on Setup</h1>
  <div class="sub">Add directory websites, scan them once, then download a ready-to-upload package. Nothing to install on the TV.</div>

  <div class="card">
    <h2>1. Your directories</h2>
    <ul id="sources"></ul>
    <label for="name">Display name</label>
    <input id="name" placeholder="My Movie Server">
    <label for="url">Website address</label>
    <input id="url" placeholder="https://example.com/movies/">
    <div class="hint">Paste the link you open in a browser to see the list of folders/files.</div>
    <label for="roots">Sub-folders (optional)</label>
    <textarea id="roots" placeholder="English/ | movie
TV_Series/ | series"></textarea>
    <div class="hint">Leave blank to scan the whole website automatically. Otherwise one folder per line: <code>folder | movie</code>, <code>folder | series</code>, or <code>folder | mixed</code>.</div>
    <button class="primary" id="addBtn">Add directory</button>
  </div>

  <div class="card">
    <h2>2. Scan &amp; build</h2>
    <button class="secondary" id="scanBtn">Scan now</button>
    <button class="primary" id="exportBtn">Build download ZIP</button>
    <div id="status">Ready.</div>
    <div id="download"></div>
  </div>

  <div class="card">
    <h2>3. Publish (one time, free)</h2>
    <ol>
      <li>Download the ZIP above.</li>
      <li>Go to <b> dash.cloudflare.com </b> → <b>Workers &amp; Pages</b> → <b>Create</b> → <b>Pages</b> → <b>Upload assets</b>.</li>
      <li>Drag the ZIP in and deploy. No build settings needed.</li>
      <li>Copy your new address, e.g. <code>https://my-addon.pages.dev</code>.</li>
      <li>In Nuvio on the TV: <b>Addons → Install from URL</b> and paste
        <code>https://my-addon.pages.dev/manifest.json</code>.</li>
    </ol>
    <div class="hint">Search works on everything in the ZIP. To add new media later, come back here, press “Build download ZIP” again, and replace the files on Cloudflare.</div>
  </div>
</div>

<script>
const $ = (id) => document.getElementById(id);
const status = (text) => { $('status').textContent = text; };

async function api(url, options) {
  const res = await fetch(url, options);
  return res.json();
}

async function loadSources() {
  const data = await api('/api/sources');
  const list = $('sources');
  list.innerHTML = '';
  if (!data.sources.length) {
    list.innerHTML = '<li><span>No directories added yet.</span></li>';
    return;
  }
  for (const source of data.sources) {
    const li = document.createElement('li');
    const left = document.createElement('div');
    left.innerHTML = '<b></b><div class="url"></div>';
    left.querySelector('b').textContent = source.name || source.id;
    left.querySelector('.url').textContent = source.baseUrl;
    const remove = document.createElement('button');
    remove.className = 'danger';
    remove.textContent = 'Remove';
    remove.onclick = async () => {
      await api('/api/sources?id=' + encodeURIComponent(source.id), { method: 'DELETE' });
      loadSources();
    };
    li.append(left, remove);
    list.append(li);
  }
}

$('addBtn').onclick = async () => {
  const name = $('name').value.trim();
  const baseUrl = $('url').value.trim();
  if (!baseUrl) { status('Please enter a website address first.'); return; }
  const roots = $('roots').value.split('\\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [path, type] = line.split('|').map((part) => part.trim());
    return { path, type: type || 'mixed' };
  });
  status('Adding directory...');
  const result = await api('/api/sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name || baseUrl, baseUrl, roots })
  });
  status(result.message || 'Added.');
  $('name').value = '';
  $('url').value = '';
  $('roots').value = '';
  loadSources();
};

$('scanBtn').onclick = async () => {
  status('Starting scan... this can take a few minutes for large sites.');
  await api('/api/scan', { method: 'POST' });
  poll();
};

$('exportBtn').onclick = async () => {
  status('Building the ZIP... this can take a minute.');
  $('download').innerHTML = '';
  await api('/api/export', { method: 'POST' });
  status('ZIP ready.');
  $('download').innerHTML = '<a class="button" href="/api/download" download="nuvio-addon.zip">Download nuvio-addon.zip</a>';
};

async function poll() {
  const data = await api('/api/status');
  const stats = data.stats || {};
  status((data.refreshing ? 'Scanning...' : 'Last scan finished.') + '\\n' +
    'Folders checked: ' + (stats.requests || 0) + '\\n' +
    'Movies: ' + (data.counts ? data.counts.movies : 0) + '\\n' +
    'Series: ' + (data.counts ? data.counts.series : 0));
  if (data.refreshing) setTimeout(poll, 2000);
}

loadSources();
poll();
</script>
</body>
</html>`;

module.exports = { WIZARD_HTML };
