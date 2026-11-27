"""Rebuild the chart-only history from archived TDCC 1-5 original CSV files."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from serve_local import parse_week, TDCC_URL

ARCHIVE = 'https://github.com/wirelessr/tdcc-opendata-archive'
BLOBS = {
    '2026-10-30': '0e797e8f70433380e9abfadbffac10f180e06c61',
    '2026-11-06': 'bde04e2a4e6f50bc31a5da620c5a430405a611f6',
    '2026-11-13': '2e11d4ea2ebd26a6c6aff412e51145fa755c61d0',
    '2026-11-20': '84caa2b2656fd3c9691174985b3b9bb03ad032e0',
}


def rebuild(csv_dir, universe, retrieved):
    weeks = {}
    for day, blob in BLOBS.items():
        raw = (csv_dir / f'{day}.csv').read_bytes()
        git_blob = f'blob {len(raw)}\0'.encode() + raw
        if hashlib.sha1(git_blob).hexdigest() != blob:
            raise ValueError(f'Archived bytes differ for {day}')
        week = parse_week(raw, universe, retrieved)
        if week['day'] != day:
            raise ValueError(f'Unexpected statistical date for {day}')
        weeks[day] = {
            'rows': {**week['rows'], **week['extraRows']},
            'source': f'{ARCHIVE}/blob/main/snapshots/2026/{day}.csv',
            'officialSource': TDCC_URL,
            'license': 'https://data.gov.tw/license',
            'blob': blob,
            'sha256': week['quality']['sha256'],
            'retrieved': retrieved,
            'publication': None,
        }
    return weeks


if __name__ == '__main__':
    base = json.loads(Path(sys.argv[2]).read_bytes())
    weeks = rebuild(Path(sys.argv[1]), base['universe'], sys.argv[3])
    out = ROOT / 'data' / 'tdcc-chart-history.json'
    out.write_text(json.dumps(weeks, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8')
    for day, packet in weeks.items():
        print(day, len(packet['rows']), packet['rows']['2330'][3], packet['rows']['2404'][3], packet['sha256'])
