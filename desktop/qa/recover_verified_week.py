"""Rebuild the preserved 11/20 official week using the B05 acquisition receipt."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from serve_local import parse_week, TDCC_URL

DAY = '2026-11-20'
EVIDENCE = 'https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45024902778/artifacts/14755309598'
EXPECTED_SHA256 = 'af8528288555b0e0d3791d13893992f667ee28f4c4e8b12d2202668d41e8214d'


def recover(raw, universe, receipt):
    official = receipt['snapshots']['official']
    source = official['source']
    digest = hashlib.sha256(raw).hexdigest()
    if (official['day'] != DAY or official['calendar'] != DAY or source['raw_source'] != TDCC_URL
            or digest != source['sha256'] or digest != EXPECTED_SHA256):
        raise ValueError('原始統計日、來源、交易日或雜湊與 B05 紀錄不一致')
    week = parse_week(raw, universe, source['fetched'])
    if week['day'] != DAY or week['quality']['valid'] != source['valid']:
        raise ValueError('重建集保資料覆蓋與 B05 紀錄不一致')
    week['quality']['evidence'] = EVIDENCE
    return {'week': week, 'calendar': official['months'][-1], 'tradeDay': official['calendar']}


if __name__ == '__main__':
    raw, base, receipt = map(Path, sys.argv[1:])
    data = recover(raw.read_bytes(), json.loads(base.read_bytes())['universe'], json.loads(receipt.read_bytes()))
    output = ROOT / 'data' / 'verified-tdcc-2026-11-20.json'
    output.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(DAY, data['week']['observed'], data['week']['quality']['valid'])
