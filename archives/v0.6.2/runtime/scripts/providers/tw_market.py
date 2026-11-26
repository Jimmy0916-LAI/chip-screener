"""台股個股詳情資料供應器
整合 FinMind 日 K 線（TaiwanStockPrice）、三大法人買賣超（TaiwanStockInstitutionalInvestorsBuySell）
與融資融券餘額變化（TaiwanStockMarginPurchaseShortSale），提供本機快取與單位換算（張）。
"""

import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

TAIPEI_TZ = timezone(timedelta(hours=8))
VALID_TW_CODE_RE = re.compile(r'^(?:\d{4}|00\d{2,4}[A-Z]?)$')
VALID_US_CODE_RE = re.compile(r'^[A-Z][A-Z0-9.-]{0,7}$')


def _taipei_now() -> str:
    return datetime.now(TAIPEI_TZ).isoformat(timespec='milliseconds')


class TwMarketService:
    FINMIND_API = 'https://api.finmindtrade.com/api/v4/data'
    CACHE_TTL_SEC = 4 * 3600
    REQUEST_TIMEOUT_SEC = 25

    def __init__(self, cache_dir: Path):
        self.cache_dir = cache_dir
        self._lock = threading.Lock()

    def _fetch_finmind(self, dataset: str, code: str, start_date: str) -> list[dict]:
        qs = urllib.parse.urlencode({'dataset': dataset, 'data_id': code, 'start_date': start_date})
        req = urllib.request.Request(
            f'{self.FINMIND_API}?{qs}',
            headers={
                'Cache-Control': 'no-cache',
                'User-Agent': 'ChipScreener/0.6 (Taiwan market detail)',
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self.REQUEST_TIMEOUT_SEC) as resp:
                if resp.status != 200:
                    raise ValueError(f'上游資料 HTTP {resp.status}')
                payload = json.loads(resp.read().decode('utf-8'))
        except urllib.error.HTTPError as exc:
            raise ValueError(f'上游資料 HTTP {exc.code}') from exc
        except urllib.error.URLError as exc:
            raise ValueError(f'連線失敗 {exc.reason}') from exc

        if payload.get('status') != 200:
            raise ValueError(payload.get('msg') or f'資料服務回應異常 ({payload.get("status")})')
        return payload.get('data', [])

    def _fetch_us_yahoo_bars(self, code: str) -> list[list]:
        encoded = urllib.parse.quote(code, safe='')
        url = f'https://query1.finance.yahoo.com/v8/finance/chart/{encoded}?range=1y&interval=1d'
        req = urllib.request.Request(
            url,
            headers={'Cache-Control': 'no-cache', 'User-Agent': 'Mozilla/5.0 ChipScreener/0.6'},
        )
        try:
            with urllib.request.urlopen(req, timeout=self.REQUEST_TIMEOUT_SEC) as resp:
                payload = json.loads(resp.read().decode('utf-8'))
            res = payload['chart']['result'][0]
            ts_list = res.get('timestamp') or []
            q = (res.get('indicators', {}).get('quote') or [{}])[0]
            opens, highs, lows, closes, vols = (
                q.get('open') or [], q.get('high') or [], q.get('low') or [], q.get('close') or [], q.get('volume') or [],
            )
            bars = []
            for ts, o, h, l, c, v in zip(ts_list, opens, highs, lows, closes, vols):
                if None in (ts, o, h, l, c) or o <= 0 or h < l or l <= 0 or c <= 0:
                    continue
                d = datetime.fromtimestamp(ts, TAIPEI_TZ).strftime('%Y-%m-%d')
                bars.append([d, round(float(o), 2), round(float(h), 2), round(float(l), 2), round(float(c), 2), int(v or 0)])
            return bars
        except Exception as exc:
            raise ValueError(f'無法取得美股 {code} 日線資料：{exc}') from exc

    def get_detail(self, code: str, force_refresh: bool = False) -> dict:
        code = code.strip().upper()
        is_tw = bool(VALID_TW_CODE_RE.fullmatch(code))
        is_us = not is_tw and bool(VALID_US_CODE_RE.fullmatch(code))
        if not is_tw and not is_us:
            raise ValueError('請輸入有效台股或美股代號（如 2330、2404、0050、NVDA）')

        cache_file = self.cache_dir / f'{code}.json'
        if not force_refresh and cache_file.exists():
            try:
                if time.time() - cache_file.stat().st_mtime < self.CACHE_TTL_SEC:
                    return json.loads(cache_file.read_text(encoding='utf-8'))
            except Exception:
                pass

        with self._lock:
            if not force_refresh and cache_file.exists():
                try:
                    if time.time() - cache_file.stat().st_mtime < self.CACHE_TTL_SEC:
                        return json.loads(cache_file.read().decode('utf-8') if False else cache_file.read_text(encoding='utf-8'))
                except Exception:
                    pass

            if not is_tw:
                bars = self._fetch_us_yahoo_bars(code)
                if not bars:
                    raise ValueError(f'查無 {code} 的有效美股日行情資料')
                result = {
                    'code': code,
                    'bars': bars,
                    'inst': [],
                    'margin': [],
                    'source': 'Yahoo Finance (US Daily OHLCV)',
                    'fetched': _taipei_now(),
                }
                self.cache_dir.mkdir(parents=True, exist_ok=True)
                stage = cache_file.with_suffix('.json.tmp')
                stage.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
                os.replace(stage, cache_file)
                return result

            # 1. 日 K 價量（取 2024-01-01 起完整交易日，供日/週/月 K 與 MA60 計算）
            raw_prices = self._fetch_finmind('TaiwanStockPrice', code, '2024-01-01')
            bars = []
            for p in raw_prices:
                o = float(p.get('open') or 0)
                h = float(p.get('max') or 0)
                l = float(p.get('min') or 0)
                c = float(p.get('close') or 0)
                vol_lots = round(float(p.get('Trading_Volume') or 0) / 1000)
                if o <= 0 or h < l or l <= 0 or c <= 0:
                    continue
                bars.append([p['date'], o, h, l, c, vol_lots])

            if not bars:
                raise ValueError(f'查無 {code} 的有效日行情資料')

            # 2. 三大法人買賣超（近期 45 個交易日，換算為張）
            inst_start = bars[max(0, len(bars) - 50)][0]
            inst_by_date: dict[str, list[int]] = {}
            try:
                raw_inst = self._fetch_finmind('TaiwanStockInstitutionalInvestorsBuySell', code, inst_start)
                for r in raw_inst:
                    d = r.get('date')
                    if not d:
                        continue
                    bucket = inst_by_date.setdefault(d, [0, 0, 0])
                    net_lots = round((float(r.get('buy') or 0) - float(r.get('sell') or 0)) / 1000)
                    name = r.get('name', '')
                    if 'Foreign' in name:
                        bucket[0] += net_lots
                    elif name == 'Investment_Trust':
                        bucket[1] += net_lots
                    else:
                        bucket[2] += net_lots
            except Exception:
                inst_by_date = {}
            inst = [[d, *vals] for d, vals in sorted(inst_by_date.items())][-30:]

            # 3. 融資融券餘額變化（近期 30 個交易日，單位：張）
            margin = []
            try:
                raw_margin = self._fetch_finmind('TaiwanStockMarginPurchaseShortSale', code, inst_start)
                for r in raw_margin:
                    mb = int(r.get('MarginPurchaseTodayBalance') or 0)
                    mp = int(r.get('MarginPurchaseYesterdayBalance') or 0)
                    sb = int(r.get('ShortSaleTodayBalance') or 0)
                    sp = int(r.get('ShortSaleYesterdayBalance') or 0)
                    margin.append([r['date'], mb, mb - mp, sb, sb - sp])
            except Exception:
                margin = []
            margin = margin[-30:]

            result = {
                'code': code,
                'bars': bars,
                'inst': inst,
                'margin': margin,
                'source': 'FinMind (TaiwanStockPrice / Institutional / Margin)',
                'fetched': _taipei_now(),
            }

            self.cache_dir.mkdir(parents=True, exist_ok=True)
            stage = cache_file.with_suffix('.json.tmp')
            stage.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
            os.replace(stage, cache_file)
            return result
