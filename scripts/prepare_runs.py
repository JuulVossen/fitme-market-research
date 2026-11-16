"""Package selected completed research; does not rerun the analysis."""
import argparse
import datetime
import gzip
import hashlib
import json
import pathlib
import re

PROJECT = pathlib.Path(__file__).resolve().parents[1]
SOURCES = [
    ('dishoom-greater-london', 'Dishoom Greater London', 'London, UK',
     'Waiter and waitress pathways across the full Greater London region, using Covent Garden as the reference point.',
     'baselines/baseline_greater_london/dishoom_waiter_greater_london/Dishoom_Greater_London_Talent_Map.json'),
    ('unifi-atlanta', 'Unifi Aviation', 'Atlanta, US',
     'Airport baggage handler pathways around Hartsfield-Jackson Atlanta International Airport, with reviewed workplace evidence.',
     'processed_esco_jobs/airport-baggage-handler-42945ea8c24e/21b6ff2f68e4aa57a223/atl_expanded/final/prospect_map.json'),
    ('georgetown-home-care', 'Georgetown Home Care', 'Washington, DC, US',
     'Home care aide pathways around Georgetown, with transfer tiers and a directory of reviewed competitors.',
     'baselines/baseline_georgetown_dc_25mi/prospect_market_competitors/prospect_map.json'),
]

def sanitize(value):
    if isinstance(value, dict):
        return {key: sanitize(item) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize(item) for item in value]
    if isinstance(value, str) and re.match(r'^(?:[A-Za-z]:[\\/]|/Users/|/home/)', value):
        return value.replace('\\', '/').rsplit('/', 1)[-1]
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--workspace', type=pathlib.Path, default=PROJECT.parents[1])
    args = parser.parse_args()
    destination = PROJECT / 'docs' / 'runs'
    destination.mkdir(exist_ok=True)
    entries = []
    for slug, title, region, description, relative in SOURCES:
        original = (args.workspace / relative).read_bytes()
        run = sanitize(json.loads(original))
        payload = json.dumps(run, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        compressed = gzip.compress(payload, compresslevel=9, mtime=0)
        target = destination / (slug + '.json.gz')
        if len(compressed) >= 100 * 1024 * 1024:
            raise ValueError('Run exceeds the GitHub file limit: ' + slug)
        target.write_bytes(compressed)
        entry = dict(id=slug, title=title, region=region, description=description,
                     occupation=run['target']['label'], worksites=len(run['worksites']),
                     baseline_date=run['baseline']['refreshed_at'][:10],
                     file='runs/' + target.name, bytes=len(compressed),
                     sha256=hashlib.sha256(compressed).hexdigest(),
                     source_sha256=hashlib.sha256(original).hexdigest())
        entries.append(entry)
        print(json.dumps({'run':slug,'worksites':entry['worksites'],'download_bytes':len(compressed)}), flush=True)
    catalog = dict(schema='fitme-run-library-v1', generated_at=datetime.datetime.now(datetime.timezone.utc).isoformat(), runs=entries)
    (destination / 'index.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

if __name__ == '__main__':
    main()
