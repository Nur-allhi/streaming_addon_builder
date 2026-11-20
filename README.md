# Nuvio Directory Add-on (personal use)

A small, dependency-free Stremio-protocol add-on that turns Apache directory listings into **movie + series catalogs** with direct HTTP stream links and subtitles for Nuvio.

Bundled sources:

- `https://ftp.ctgfun.com/`
- `https://movie.ctgfun.com/`

Nuvio hosts no media itself — it can only read add-ons that serve a `manifest.json`. This project is the bridge between plain folder listings and Nuvio.

---

## Recommended setup: Cloudflare Pages (no server to keep running)

Everything is built once into a static package and uploaded to Cloudflare. Your laptop can be off; the TV only downloads small JSON files and plays the videos. Search works for any text.

### 1. Build the add-on

```bash
cd C:\Users\EftynurPc\Documents\02_Work\Dev_Projects\nuvio_addons
npm run export
```

The first run scans both directory sites and can take several minutes. It writes the finished add-on to `static/`.

To make a ready-to-upload ZIP:

```bash
npm run zip
```

### 2. Upload to Cloudflare Pages

1. Go to **dash.cloudflare.com → Workers & Pages → Create → Pages → Upload assets**.
2. Drag in the `static/` folder (or the ZIP from `npm run zip`).
3. Deploy. No build command, no output directory needed.
4. Note your URL, e.g. `https://nuvio-addon.pages.dev`.

### 3. Install in Nuvio on the TV

**Addons → Install from URL** →

```
https://nuvio-addon.pages.dev/manifest.json
```

Then search for a movie/show or browse the **ctgfun Movies / ctgfun Series** catalogs and press Play.

### 4. Updating later

When you want fresh content:

```bash
FORCE_SCAN=true npm run export
npm run zip
```

Then replace the files in your Cloudflare Pages project (or drag the new ZIP into a new deployment). Nuvio will pick up the new manifest automatically.

---

## Optional: run it locally instead

```bash
npm start
```

- Manifest: `http://<your-pc-ip>:7000/manifest.json`
- Easy setup page: `http://localhost:7000/setup` (add/remove directories, scan, download ZIP)

This requires your PC to stay awake while you watch. Add `ONE_TIME_SYNC=true` to disable automatic re-scans.

---

## Adding or changing directories

Edit `sources.json`:

```json
{
  "sources": [
    { "id": "ctgfun-ftp", "name": "ctgfun FTP", "baseUrl": "https://ftp.ctgfun.com/" },
    { "id": "ctgfun-movies", "name": "ctgfun Movies", "baseUrl": "https://movie.ctgfun.com/" }
  ]
}
```

Leave out `roots` to scan the whole site. To limit it:

```json
"roots": [
  { "path": "English/", "type": "movie" },
  { "path": "TV_Series/", "type": "series" }
]
```

Types: `movie`, `series`, `mixed`. Then re-run the export.

---

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `7000` | Local server port |
| `DATA_DIR` | `./data` | Scan cache location |
| `STATIC_DIR` | `./static` | Export output folder |
| `FORCE_SCAN` | `false` | Ignore cache and rescan everything |
| `TMDB_API_KEY` | empty | Optional; better posters/IMDb IDs |
| `EXPORT_RESOLVE_META` | `false` | Resolve posters during export (slow) |
| `MAX_FOLDER_REQUESTS` | `20000` | Safety cap per scan |
| `CRAWL_CONCURRENCY` | `8` | Parallel requests |
| `REFRESH_HOURS` | `12` | Local server re-scan interval |
| `ONE_TIME_SYNC` | `false` | Disable local auto-re-scan |

---

## How it works

`lib/crawler.js` walks each Apache autoindex page, finds video files (`.mp4`, `.mkv`, …) and subtitles, parses release names into titles/years/seasons/episodes, and stores the result in `data/index.json`. `export-static.js` turns that into `manifest.json`, catalog pages, meta files, per-title stream files, a search index, and a small Cloudflare Pages function that answers searches.

---

## Limitations

- Multi-episode bundle files (`S01 E01-06`) are treated as one episode.
- APK/audio/image files are ignored.
- Streams are direct files from the source servers; speed and availability depend on them.
- Only stream content you are legally allowed to watch.

MIT License.
