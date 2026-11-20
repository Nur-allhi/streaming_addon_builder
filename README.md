# Nuvio Directory Add-on (personal use)

A small, dependency-free Stremio-protocol add-on that turns Apache directory listings into **movie + series catalogs** with direct HTTP stream links and subtitles for Nuvio.

Bundled sources:

- `https://ftp.ctgfun.com/`
- `https://movie.ctgfun.com/`

Nuvio hosts no media itself — it can only read add-ons that serve a `manifest.json`. This project is the bridge between plain folder listings and Nuvio.

---

## Live setup: GitHub Pages (no server to keep running)

The full add-on is built once and published to the `gh-pages` branch of:

**https://github.com/Nur-allhi/streaming_addon_builder**

Your laptop can be off — the TV only downloads small JSON files and plays the videos straight from the source servers.

### Add-on URL for Nuvio

```
https://raw.githubusercontent.com/Nur-allhi/streaming_addon_builder/gh-pages/manifest.json
```

Note: GitHub Pages cannot build this add-on because the IMDb episode stream files contain `:` in their filenames. The `raw.githubusercontent.com` URL above serves the exact same files correctly and is the address to use in Nuvio.

In Nuvio: **Addons → Install from URL** → paste the address above. Each directory gets its own catalogs, e.g. **ctgfun FTP Movies**, **ctgfun FTP Series**, **ctgfun Movies Movies**, **ctgfun Movies Series**. Posters are included. You can also use Nuvio's global Search — titles are mapped to IMDb IDs so playback works from search results too.

### Updating later

One command rebuilds everything and republishes it:

```powershell
cd C:\Users\EftynurPc\Documents\02_Work\Dev_Projects\nuvio_addons
.\deploy.ps1
```

Add `-Fresh` to force a full re-scan of the source directories:

```powershell
.\deploy.ps1 -Fresh
```

`deploy.ps1` builds the static files (with exact-title search), pushes them to `gh-pages`, and makes sure GitHub Pages is enabled. No other steps needed.

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

`lib/crawler.js` walks each Apache autoindex page, finds video files (`.mp4`, `.mkv`, …) and subtitles, parses release names into titles/years/seasons/episodes, and stores the result in `data/index.json`. `export-static.js` turns that into `manifest.json`, catalog pages, meta files, per-title stream files, and pre-generated exact-title search files. `deploy.ps1` publishes the result to the `gh-pages` branch.

---

## Limitations

- Multi-episode bundle files (`S01 E01-06`) are treated as one episode.
- APK/audio/image files are ignored.
- Streams are direct files from the source servers; speed and availability depend on them.
- Only stream content you are legally allowed to watch.

MIT License.
