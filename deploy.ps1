# Rebuild the add-on and publish it to the gh-pages branch.
# Run from this folder:  .\deploy.ps1
# Add -Fresh to force a full re-scan of the source directories first.

param([switch]$Fresh)

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:EXPORT_SEARCH_FILES = 'true'
$env:EXPORT_RESOLVE_META = 'true'
# Public TMDB key shipped with Nuvio's own web client; override with your own if you prefer.
if (-not $env:TMDB_API_KEY) { $env:TMDB_API_KEY = '01926d2187b6a5d861eefc750e9df3e3' }
if ($Fresh) { $env:FORCE_SCAN = 'true' }

$env:GITHUB_TOKEN = gh auth token

Write-Host '[deploy] resolving IMDb IDs...'
Push-Location $repoRoot
node resolve-imdb.js
if ($LASTEXITCODE -ne 0) { throw 'IMDb resolution failed.' }

Write-Host '[deploy] building static add-on...'
npm run export
if ($LASTEXITCODE -ne 0) { throw 'Export failed.' }
Pop-Location

$staticDir = Join-Path $repoRoot 'static'
$tmp = Join-Path $env:TEMP 'nuvio-ghpages-deploy'
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $tmp | Out-Null
Copy-Item -Recurse -Force (Join-Path $staticDir '*') $tmp

Write-Host '[deploy] pushing to gh-pages...'
Push-Location $tmp
git init -b gh-pages 2>$null | Out-Null
git config user.name 'Nur-allhi'
git config user.email 'Nur-allhi@users.noreply.github.com'
git remote add origin "https://Nur-allhi:$env:GITHUB_TOKEN@github.com/Nur-allhi/streaming_addon_builder.git"
git add -A 2>$null
git commit -m 'Deploy Nuvio add-on' 2>$null | Out-Null
git push -u origin gh-pages --force 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Git push failed.' }
Pop-Location

Write-Host '[deploy] publishing IMDb episode stream aliases...'
Push-Location $repoRoot
node publish-aliases.js
if ($LASTEXITCODE -ne 0) { throw 'Alias publish failed.' }
Pop-Location

Write-Host '[deploy] done: https://Nur-allhi.github.io/streaming_addon_builder/manifest.json'
