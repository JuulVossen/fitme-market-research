# Fitme Market Research

A GitHub Pages site with two sections: **Simulated Impact** for hiring outcome models and **Vertical Network Synergy** for Talent Map and completed workplace research.

The site lives in `docs/`. There is no build step or server dependency.

## Site structure

- `/` — market research home and section navigation.
- `/simulated-impact/` — hiring simulation library.
- `/simulated-impact/prime/` — Prime one-year FitScore Hiring Simulator.
- `/simulated-impact/paper-transport/` — Paper Transport experienced/inexperienced-driver recruitment simulator.
- `/vertical-network-synergy/` — Talent Map and completed research runs.
- `/runs/` — existing research downloads and catalog; their URLs are unchanged.

Map links use `vertical-network-synergy/?run=<id>`. Previously shared root `?run=<id>` links redirect to the same run in the new section, preserving the query and fragment. Local JSON and gzip files can still be opened without uploading them.

## Prime simulator

The dashboard uses the approved built-in FitScore distribution and a fixed one-year horizon. Defaults are 6,000 annual driver hires, minimum FitScore 20, attraction 20%, USD 15,000 per churn event and USD 30,000 per accident. Minimum FitScore and attraction are adjustable; reset and CSV export use the same assumptions.

The embedded fitted models use the values supplied on 19 November 2026:

- Churn risk: `1 - exp(-0.782142826804488 * exp(-0.0026205 * FitScore))`.
- Expected accidents: `365 * exp(-6.541252 - 0.001003 * FitScore)`.

Trainer and tenure contributions are held at zero in prediction, as requested; the adjusted FitScore coefficient is retained. Accident exposure is 365 days per hire and is not reduced for churn. The simulator runs in the browser. Only its web page is published; conversation imports and local archives are not included.

For updates, edit `docs/simulated-impact/prime/index.html` and preserve the shared section navigation. The standalone local Prime project remains separate.

## Paper Transport simulator

This is the recruitment-round simulator with **experienced and inexperienced drivers**, separate Match thresholds and exit costs, and a **60-day exit horizon**. It displays expected exits, exit costs, recruitment rounds and threshold-combination heatmaps.

Defaults are 1,000 candidates, 10% experienced candidates, 100 target hires and 25 candidates per recruitment round. Experienced/inexperienced thresholds are 40/60 and costs per 60-day exit are USD 9,000/32,000. The existing simulation and model are preserved; they are separate from the Prime model.

For updates, edit `docs/simulated-impact/paper-transport/index.html`. Its navigation styles are embedded to preserve the standalone dashboard's restrictive content security policy.

## Dashboard identities

Confirmed by the user on 17 November 2026: **Prime** is the one-year churn/accident dashboard; **Paper Transport** is the experienced/inexperienced-driver dashboard. The initial hosted Paper Transport label was incorrect. Both are now listed separately under Simulated Impact.

## Included research

- Dishoom Greater London: 74,069 supported businesses; waiter/waitress pathways across the full Greater London boundary, with a 25-mile reference radius from Covent Garden. Supersedes the earlier neighbourhood runs.
- Unifi Aviation, Atlanta: 1,921 supported businesses; airport baggage handler pathways within 25 miles of ATL.
- Georgetown Home Care: 7,340 supported businesses; home care aide pathways and reviewed competitors within 25 miles of Georgetown.

Research evidence, scores, tiers and source metadata are preserved. Absolute local filesystem references are reduced to filenames. Original input hashes and published file hashes are recorded in `docs/runs/index.json`. The library contains the current completed outputs, not intermediate candidate exports.

## GitHub Pages

Repository: [JuulVossen/fitme-market-research](https://github.com/JuulVossen/fitme-market-research).

Live site: [Fitme Market Research](https://juulvossen.github.io/fitme-market-research/).

Pages deploys from **main → /docs**. Commit and push site changes to `main` to publish. The `.nojekyll` file makes this a plain static site. All asset and dataset URLs work under the repository subpath.

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
