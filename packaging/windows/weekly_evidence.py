"""Verify raw frozen OD 1-5 rows and use actual TWSE market sessions."""
import csv
import gzip
import hashlib
import io
import json
from collections import defaultdict
from datetime import date
from zipfile import ZipFile

def enrich(data, archive):
    with ZipFile(archive) as z:
        meta = json.loads(z.read(f"evidence/runs/{data['run']}.json"))
        def raw(key):
            digest = meta[key]['sha256']
            body = gzip.decompress(z.read(f'evidence/raw/{digest}.gz'))
            if hashlib.sha256(body).hexdigest() != digest:
                raise ValueError(f'Raw source checksum mismatch: {key}')
            return body
        days = []
        for key in sorted(k for k in meta if k.startswith('日曆_')):
            market = json.loads(raw(key))
            assert market['stat'].upper() == 'OK'
            for row in market['data']:
                y,m,d = map(int,row[0].split('/'))
                days.append(date(y+1911,m,d).isoformat())
        assert days == sorted(set(days))
        assert days == [r['date'] for r in json.loads(raw('日曆備援'))['data']]
        data['sessions'] = days
        data['universe'] = sorted(data['stocks'])
        data['adjustments'], data['issues'] = {}, {}
        assert raw('集保官方最新') == raw('TDCC_2026-11-13')
        for day in data['dates']:
            groups = defaultdict(dict)
            issues, adjustments, rows = {}, {}, {}
            for row in csv.DictReader(io.StringIO(raw('TDCC_'+day).decode('utf-8-sig'))):
                code = row['證券代號'].strip()
                if code not in data['stocks']:
                    continue
                level = int(row['持股分級'])
                if level in groups[code] or row['資料日期'] != day.replace('-',''):
                    issues[code] = '日期或重複級距待核'
                groups[code][level] = (int(row['股數']),int(row['人數']))
            for code in data['universe']:
                g = groups.get(code,{})
                if set(g) != set(range(1,18)):
                    issues[code] = '原表缺股或缺少級距'
                if code in issues:
                    continue
                den,holders = g[17]
                if (den <= 0 or any(min(v)<0 for v in g.values()) or
                    sum(g[i][0] for i in range(1,16))-g[16][0] != den or
                    sum(g[i][1] for i in range(1,16)) != holders):
                    issues[code] = '股數或戶數與第17級未對帳，待核'
                    continue
                bands = [sum(g[i][col] for i in range(start,16))
                         for col in (0,1) for start in (11,12,13,15)]
                if any(n > den for n in bands[:4]):
                    issues[code] = '累計級距超過總股數，待核'
                    continue
                rows[code] = [den,holders,*bands]
                if any(g[16]):
                    adjustments[code] = g[16]
            data['series'][day] = rows
            data['issues'][day] = issues
            data['adjustments'][day] = adjustments
            data['quality'][day].update(valid=len(rows),invalid=len(issues),excludedIncompleteOrInvalid=len(issues),
                                        incomplete=sum('缺' in v for v in issues.values()))
    return data
