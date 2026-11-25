"""從凍結研究壓縮包驗證原始 TDCC 1-5 級距與證交所實際交易日曆，並擴充前端基準資料。"""

import csv
import gzip
import hashlib
import io
import json
import re
from collections import defaultdict
from datetime import date
from zipfile import ZipFile

ETF_CODE_RE = re.compile(r'^00\d{2,4}[A-Z]?$')


def enrich(data, archive):
    with ZipFile(archive) as z:
        meta = json.loads(z.read(f"evidence/runs/{data['run']}.json"))

        def raw(key):
            digest = meta[key]['sha256']
            body = gzip.decompress(z.read(f'evidence/raw/{digest}.gz'))
            if hashlib.sha256(body).hexdigest() != digest:
                raise ValueError(f'Raw source checksum mismatch: {key}')
            return body

        # 驗證並載入 697 個 TWSE 實際交易日
        days = []
        for key in sorted(k for k in meta if k.startswith('日曆_')):
            market = json.loads(raw(key))
            assert market['stat'].upper() == 'OK'
            for row in market['data']:
                y, m, d = map(int, row[0].split('/'))
                days.append(date(y + 1911, m, d).isoformat())
        assert days == sorted(set(days))
        assert days == [r['date'] for r in json.loads(raw('日曆備援'))['data']]

        data['sessions'] = days
        # 全市場篩選母體維持原本 1,985 檔非 0 開頭四碼個股
        data['universe'] = sorted(k for k in data['stocks'] if len(k) == 4 and k[0] != '0')
        universe_set = set(data['universe'])

        # 額外載入 00 開頭 ETF 名稱（如 0050、0056 等），供固定驗收案例與個股研究查詢
        if '行情備份' in meta:
            market_symbols = json.loads(raw('行情備份')).get('symbols', {})
            for code, info in market_symbols.items():
                if ETF_CODE_RE.fullmatch(code) and code not in data['stocks']:
                    data['stocks'][code] = [info.get('name', ''), info.get('market', 'TWSE')]

        data['adjustments'] = {}
        data['issues'] = {}

        # 核對最新集保與官方原檔逐位元相符
        assert raw('集保官方最新') == raw('TDCC_2026-11-13')

        for day in data['dates']:
            groups = defaultdict(dict)
            issues = {}
            adjustments = {}
            rows = {}

            for row in csv.DictReader(io.StringIO(raw('TDCC_' + day).decode('utf-8-sig'))):
                code = row['證券代號'].strip()
                if code not in universe_set and not ETF_CODE_RE.fullmatch(code):
                    continue
                level = int(row['持股分級'])
                if level in groups[code] or row['資料日期'] != day.replace('-', ''):
                    issues[code] = '日期或重複級距待核'
                groups[code][level] = (int(row['股數']), int(row['人數']))

            for code in data['universe']:
                g = groups.get(code, {})
                if set(g) != set(range(1, 18)):
                    issues[code] = '原表缺股或缺少級距'
                if code in issues:
                    continue

                den, holders = g[17]
                shares_balanced = sum(g[i][0] for i in range(1, 16)) - g[16][0] == den
                holders_balanced = sum(g[i][1] for i in range(1, 16)) == holders
                if den <= 0 or any(min(v) < 0 for v in g.values()) or not shares_balanced or not holders_balanced:
                    issues[code] = '股數或戶數與第17級未對帳，待核'
                    continue

                bands = [
                    sum(g[i][col] for i in range(start, 16))
                    for col in (0, 1)
                    for start in (11, 12, 13, 15)
                ]
                if any(n > den for n in bands[:4]):
                    issues[code] = '累計級距超過總股數，待核'
                    continue

                rows[code] = [den, holders, *bands]
                if any(g[16]):
                    adjustments[code] = g[16]

            universe_valid = len(rows)
            universe_issues = {k: v for k, v in issues.items() if k in universe_set}

            # 額外納入對帳通過的 00 開頭 ETF 集保資料（不計入 1,985 檔母體品質統計）
            for code, g in groups.items():
                if code in universe_set or code in issues or set(g) != set(range(1, 18)):
                    continue
                den, holders = g[17]
                if (
                    den <= 0
                    or any(min(v) < 0 for v in g.values())
                    or sum(g[i][0] for i in range(1, 16)) - g[16][0] != den
                    or sum(g[i][1] for i in range(1, 16)) != holders
                ):
                    continue
                bands = [
                    sum(g[i][col] for i in range(start, 16))
                    for col in (0, 1)
                    for start in (11, 12, 13, 15)
                ]
                if any(n > den for n in bands[:4]):
                    continue
                rows[code] = [den, holders, *bands]
                if any(g[16]):
                    adjustments[code] = g[16]
                if code not in data['stocks']:
                    data['stocks'][code] = ['ETF', 'TWSE']

            data['series'][day] = rows
            data['issues'][day] = universe_issues
            data['adjustments'][day] = adjustments
            data['quality'][day].update(
                valid=universe_valid,
                invalid=len(universe_issues),
                excludedIncompleteOrInvalid=len(universe_issues),
                incomplete=sum('缺' in v for v in universe_issues.values()),
            )

    return data
