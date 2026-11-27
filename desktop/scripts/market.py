"""Latest exchange lists and OHLC receipts, following the B06 market data contract."""
import json
import math
import re
from datetime import date

SOURCES = {
    'TWSE-list': 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L',
    'TWSE-day': 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
    'TPEx-list': 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O',
    'TPEx-day': 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes',
}


def parse_market(key, raw, fetched):
    listing = key.endswith('-list')
    tw = key.startswith('TWSE')
    rows, seen = {}, set()
    day = None
    for r in json.loads(raw.decode('utf-8-sig')):
        code = str(r.get('公司代號') or r.get('Code') or r.get('SecuritiesCompanyCode') or r.get('CompanyCode') or '').strip()
        if not re.fullmatch(r'[1-9]\d{3}', code):
            continue
        stamp = str(r.get('出表日期') or r.get('資料日期') or r.get('Date')).replace('/', '').replace('-', '')
        if not re.fullmatch(r'\d{7,8}', stamp):
            raise ValueError('官方日期格式異動')
        year = int(stamp[:-4]) + (1911 if len(stamp) == 7 else 0)
        current = date(year, int(stamp[-4:-2]), int(stamp[-2:])).isoformat()
        if current > fetched[:10] or day and day != current or code in seen:
            raise ValueError('日期混雜、未來日期或重複股票')
        day = current
        seen.add(code)
        if listing:
            name = r.get('公司簡稱') or r.get('CompanyAbbreviation') or r.get('CompanyName') or r.get('公司名稱')
            if isinstance(name, str) and name.strip():
                rows[code] = name.strip()
        else:
            fields = ('OpeningPrice', 'HighestPrice', 'LowestPrice', 'ClosingPrice') if tw else ('Open', 'High', 'Low', 'Close')
            try:
                o, h, l, c = [float(str(r[k]).replace(',', '')) for k in fields]
            except (ValueError, KeyError):
                continue
            if all(math.isfinite(v) for v in (o,h,l,c)) and 0 < l <= min(o,c) <= max(o,c) <= h:
                rows[code] = [current, o, h, l, c]
    if len(rows) < max(400, len(seen) * .90):
        raise ValueError(f'有效覆蓋不足 {len(rows)}/{len(seen)}')
    return {'day': day, 'rows': rows, 'source': SOURCES[key], 'fetched': fetched}
