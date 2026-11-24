# Bleckmann Tableau viz extensions

Custom Marks-card visuals for Tableau (viz extensions, Tableau 2024.2+), in the
Bleckmann style. Static HTML/JS, hosted on GitHub Pages; the data never leaves
Tableau and the viewer's browser.

| Extension | What it draws |
|---|---|
| `kpi-cards` | One card per member: value, status vs target (green/amber/red), delta vs compare or previous period, sparkline, detail lines |

## Layout

```
lib/                  Tableau Extensions API (vendored, Apache 2.0)
shared/               bleckmann-ext.js (BX helpers), bleckmann.css, lib-loader.js, tableau-mock.js
extensions/<name>/    manifest.trex (source), index.html, <name>.js/.css, fixtures/, tests.json
extensions/_template  starting point for new extensions
trex/local|cloud/     generated, installable .trex files (do not edit)
tools/                serve.py, make_trex.py, check.py, new_extension.py
```

## Commands

```
python tools/new_extension.py <name> "<Title>"   # scaffold
python tools/check.py [<name>] [--shots]          # headless tests (+ screenshots in out/)
python tools/make_trex.py [<name>]                # validate + write trex/local and trex/cloud
python tools/serve.py                             # localhost:8765 for Tableau Desktop
```

## Use in Tableau

- **Desktop (development):** run `serve.py`, then on a worksheet set the Marks type
  to *Add Extension* > *Access Local Viz Extension* > `trex/local/<name>.trex`.
- **Cloud:** push to `main` (GitHub Pages serves the repo), then use
  `trex/cloud/<name>.trex`. A site admin must add the Pages URL
  (`config.json` > `pages_base`) to the extension allow list once.

Open any extension offline with mock data:
`http://localhost:8765/extensions/kpi-cards/index.html?mock=fixtures/full.json`
