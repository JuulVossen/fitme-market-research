# Fitme Market Research

Talent Map and a library of completed workplace research runs, ready for GitHub Pages.

The site lives in `docs/`. There is no build step or server dependency. Each run has a shareable `?run=<id>` map link and a compressed JSON download. Local JSON and gzip files can also be opened without uploading them.

## Included research

- Dishoom Greater London: 74,069 supported businesses; waiter/waitress pathways across the full Greater London boundary, with a 25-mile reference radius from Covent Garden. Supersedes the earlier neighbourhood runs.
- Unifi Aviation, Atlanta: 1,921 supported businesses; airport baggage handler pathways within 25 miles of ATL.
- Georgetown Home Care: 7,340 supported businesses; home care aide pathways and reviewed competitors within 25 miles of Georgetown.

Research evidence, scores, tiers and source metadata are preserved. Absolute local filesystem references are reduced to filenames. Original input hashes and published file hashes are recorded in `docs/runs/index.json`. The library contains the current completed outputs, not intermediate candidate exports.

## GitHub Pages

Create the public repository `fitme-market-research` under the intended account, push this directory to `main`, then select **Settings → Pages → Deploy from a branch → main → /docs**. GitHub publishes `https://<owner>.github.io/fitme-market-research/`. The `.nojekyll` file makes this a plain static site. All asset and dataset URLs work under the repository subpath.

Only `docs/` is published by Pages. Public repository contents and hosted run downloads are publicly accessible.

## Local preview and updates

Requires Node.js 20+; refreshing datasets also requires Python 3. No packages need installing.

```sh
node scripts/check.mjs
node scripts/preview.mjs
```

Open the printed local address. For refreshed research, update the explicit source selection in `scripts/prepare_runs.py` and run:

```sh
python scripts/prepare_runs.py --workspace "PATH_TO_MARKET_RESEARCH"
node scripts/check.mjs
```

Commit and push the changed files. Pages rebuilds from `main/docs` automatically. The preparation script packages existing research; it does not perform ESCO or workplace review. Preserve the user's Codex usage reserve when running batch work.

Compressed runs use the browser's native gzip decompressor. Current Chrome, Edge, Firefox and Safari support this. A browser without this feature can still open an externally decompressed JSON file. The Greater London run contains a large dataset and takes more memory and time to open than the other runs.

## Data and attribution

Workplace source data: [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), under the Open Database License, obtained through [Geofabrik](https://download.geofabrik.de/). Preserve OSM attribution when redistributing these datasets. Occupation taxonomy: [ESCO](https://esco.ec.europa.eu/). The bundled Leaflet 1.9.4 map library is distributed under its [BSD 2-Clause license](https://github.com/Leaflet/Leaflet/blob/v1.9.4/LICENSE).

Mapped workplaces suggest possible source occupations. Employment, individual capabilities and vacancies are unverified. Map tiles are requested from OpenStreetMap when a run is displayed. Local files are read in the browser and are not uploaded.
