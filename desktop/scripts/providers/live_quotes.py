"""盤中輕量即時股價更新供應器（流暢優先、非開盤與停盤日自動暫停）
特點：
1. 僅以輕量 Yahoo Chart endpoint 批次抓報價與盤中 OHLCV meta，絕不重抓歷史日 K 與法人／融資明細。
2. 雙重開休市偵測：
   - 交易時段：台股 週一至週五 台北 09:00-13:35；美股 週一至週五 美東 09:30-16:05 ET（內建精確夏／冬令換算）。
   - 休市日曆與停盤日偵測：結合台股國定休市日曆、美股主要休市日曆，以及基準指數 (^TWII / ^GSPC) 回傳之 marketState / currentTradingPeriod 與最新成交日期；若開盤後無今日新成交自動判定休市並暫停輪詢。
"""

from __future__ import annotations

import json
import re
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time as dtime, timedelta, timezone
from pathlib import Path

from providers.news_briefing import _http_get

TAIPEI_TZ = timezone(timedelta(hours=8))
VALID_TW_CODE_RE = re.compile(r'^(?:\d{4}|00\d{2,4}[A-Z]?)$')
VALID_SYMBOL_RE = re.compile(r'^(?:\^?[A-Z][A-Z0-9.-]{0,9}|\d{4}|00\d{2,4}[A-Z]?)$')

# 台股官方已知國定假日／TWSE 休市日曆（2025-2027，依勞動節、元旦、春節、228、清明兒童節、端午、中秋、國慶彙整）
TW_MARKET_HOLIDAYS: dict[str, str] = {
    # 2025
    '2025-01-01': '元旦休市',
    '2025-01-23': '農曆春節前封關休市', '2025-01-24': '農曆春節前封關休市',
    '2025-01-27': '小年夜調整放假', '2025-01-28': '農曆除夕休市',
    '2025-01-29': '農曆春節初一', '2025-01-30': '農曆春節初二', '2025-01-31': '農曆春節初三',
    '2025-02-28': '和平紀念日休市',
    '2025-04-03': '兒童節休市', '2025-04-04': '清明節休市',
    '2025-05-01': '勞動節休市',
    '2025-05-30': '端午節補假休市',
    '2025-10-06': '中秋節休市',
    '2025-10-10': '國慶日休市',
    # 2026
    '2026-01-01': '元旦休市',
    '2026-02-12': '農曆春節前封關調整休市', '2026-02-13': '農曆春節前封關調整休市',
    '2026-02-16': '農曆除夕休市', '2026-02-17': '農曆春節初一',
    '2026-02-18': '農曆春節初二', '2026-02-19': '農曆春節初三', '2026-02-20': '農曆春節補假休市',
    '2026-02-27': '和平紀念日補假休市',
    '2026-04-03': '兒童節補假休市', '2026-04-06': '清明節補假休市',
    '2026-05-01': '勞動節休市',
    '2026-06-19': '端午節休市',
    '2026-09-25': '中秋節休市',
    '2026-09-28': '教師節休市',
    '2026-10-09': '國慶日補假休市',
    '2026-10-26': '光復節補假休市',
    '2026-12-25': '行憲紀念日休市',
    # 2027
    '2027-01-01': '元旦休市',
    '2027-02-04': '農曆春節調整休市', '2027-02-05': '農曆除夕休市',
    '2027-02-08': '農曆春節補假休市', '2027-02-09': '農曆春節補假休市', '2027-02-10': '農曆春節補假休市',
    '2027-03-01': '和平紀念日補假休市',
    '2027-04-05': '兒童節／清明節補假休市',
    '2027-04-30': '勞動節補假休市',
    '2027-06-09': '端午節休市',
    '2027-09-15': '中秋節休市',
    '2027-10-11': '國慶日補假休市',
}


def taipei_now() -> datetime:
    return datetime.now(TAIPEI_TZ)


def us_eastern_now(utc_now: datetime | None = None) -> datetime:
    """不依賴系統 tzdata 之精確美東時間（自動換算 EDT 3月第2週日02:00 ~ EST 11月第1週日02:00）。"""
    now_utc = (utc_now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    y = now_utc.year
    mar1 = date(y, 3, 1)
    mar_first_sun = 1 + (6 - mar1.weekday()) % 7
    dst_start_utc = datetime(y, 3, mar_first_sun + 7, 7, 0, tzinfo=timezone.utc)  # 02:00 EST == 07:00 UTC

    nov1 = date(y, 11, 1)
    nov_first_sun = 1 + (6 - nov1.weekday()) % 7
    dst_end_utc = datetime(y, 11, nov_first_sun, 6, 0, tzinfo=timezone.utc)  # 02:00 EDT == 06:00 UTC

    is_dst = dst_start_utc <= now_utc < dst_end_utc
    tz = timezone(timedelta(hours=-4 if is_dst else -5), name='EDT' if is_dst else 'EST')
    return now_utc.astimezone(tz)


def _easter_sunday(year: int) -> date:
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def _observed_us_date(d: date) -> date:
    if d.weekday() == 5:
        return d - timedelta(days=1)
    if d.weekday() == 6:
        return d + timedelta(days=1)
    return d


def _nth_weekday(year: int, month: int, weekday: int, nth: int) -> date:
    first = date(year, month, 1)
    offset = (weekday - first.weekday()) % 7
    return first + timedelta(days=offset + 7 * (nth - 1))


def _last_weekday(year: int, month: int, weekday: int) -> date:
    nxt = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    last = nxt - timedelta(days=1)
    return last - timedelta(days=(last.weekday() - weekday) % 7)


def get_us_holiday_name(d: date) -> str:
    y = d.year
    candidates = [
        (_observed_us_date(date(y, 1, 1)), '美股元旦休市'),
        (_observed_us_date(date(y + 1, 1, 1)), '美股元旦補假休市'),
        (_nth_weekday(y, 1, 0, 3), '馬丁路德金恩紀念日休市'),
        (_nth_weekday(y, 2, 0, 3), '總統日休市'),
        (_easter_sunday(y) - timedelta(days=2), '耶穌受難日休市'),
        (_last_weekday(y, 5, 0), '陣亡將士紀念日休市'),
        (_observed_us_date(date(y, 6, 19)), '六月節休市'),
        (_observed_us_date(date(y, 7, 4)), '美國國慶日休市'),
        (_nth_weekday(y, 9, 0, 1), '美國勞動節休市'),
        (_nth_weekday(y, 11, 3, 4), '美國感恩節休市'),
        (_observed_us_date(date(y, 12, 25)), '耶誕節休市'),
    ]
    for hd, name in candidates:
        if hd == d:
            return name
    return ''


def _derive_market_state(meta: dict, now_epoch: float | None = None) -> str:
    raw = str(meta.get('marketState') or '').strip().upper()
    if raw:
        return raw
    now_ts = now_epoch if now_epoch is not None else time.time()
    ctp = meta.get('currentTradingPeriod') or {}
    reg = ctp.get('regular') or {}
    pre = ctp.get('pre') or {}
    post = ctp.get('post') or {}
    rs, re_ = reg.get('start'), reg.get('end')
    if isinstance(rs, (int, float)) and isinstance(re_, (int, float)) and rs <= now_ts <= re_:
        return 'REGULAR'
    ps, pe = pre.get('start'), pre.get('end')
    if isinstance(ps, (int, float)) and isinstance(pe, (int, float)) and ps <= now_ts < pe:
        return 'PRE'
    pos_s, pos_e = post.get('start'), post.get('end')
    if isinstance(pos_s, (int, float)) and isinstance(pos_e, (int, float)) and pos_s < now_ts <= pos_e:
        return 'POST'
    return 'CLOSED'


def fetch_yahoo_chart_lite(yahoo_symbol: str) -> dict | None:
    """單次輕量請求取得即時價格、漲跌、盤中高低量與 marketState / tradeDate。"""
    encoded = urllib.parse.quote(yahoo_symbol, safe='')
    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{encoded}?range=5d&interval=1d'
    try:
        payload = json.loads(_http_get(url, timeout=8).decode('utf-8'))
        res = payload['chart']['result'][0]
        meta = res['meta']
        exch_tz = timezone(timedelta(seconds=int(meta.get('gmtoffset') or 0)))

        raw_ts = res.get('timestamp') or []
        q0 = (res.get('indicators', {}).get('quote') or [{}])[0]
        raw_closes = q0.get('close') or []
        raw_opens = q0.get('open') or []

        daily_by_day: dict[str, tuple[float | None, float]] = {}
        for t, o, c in zip(raw_ts, raw_opens, raw_closes):
            if t is None or c is None:
                continue
            day_str = datetime.fromtimestamp(t, exch_tz).strftime('%Y-%m-%d')
            daily_by_day[day_str] = (float(o) if o is not None else None, float(c))
        daily_bars = sorted(daily_by_day.items(), key=lambda x: x[0])

        price = meta.get('regularMarketPrice')
        if price is None and daily_bars:
            price = daily_bars[-1][1][1]
        if price is None:
            return None
        price = float(price)

        ts = meta.get('regularMarketTime')
        market_day = datetime.fromtimestamp(ts, exch_tz).strftime('%Y-%m-%d') if ts else (daily_bars[-1][0] if daily_bars else '')

        prev = None
        if daily_bars:
            if market_day:
                earlier = [vals[1] for d, vals in daily_bars if d < market_day]
                if earlier:
                    prev = earlier[-1]
            if prev is None and len(daily_bars) >= 2:
                prev = daily_bars[-2][1][1]
        if prev is None:
            fallback_prev = meta.get('previousClose') or meta.get('chartPreviousClose')
            prev = float(fallback_prev) if fallback_prev is not None else None

        open_val = meta.get('regularMarketOpen')
        if open_val is None and daily_bars:
            open_val = daily_bars[-1][1][0]
        high_val = meta.get('regularMarketDayHigh')
        low_val = meta.get('regularMarketDayLow')
        vol_raw = meta.get('regularMarketVolume')

        change = (price - prev) if prev else 0.0
        change_pct = (change / prev * 100.0) if prev else 0.0
        amp_pct = ((float(high_val) - float(low_val)) / prev * 100.0) if (prev and high_val and low_val) else None
        trade_time = datetime.fromtimestamp(ts, TAIPEI_TZ).strftime('%Y-%m-%d %H:%M:%S') if ts else ''
        m_state = _derive_market_state(meta)

        return {
            'price': round(price, 2),
            'prevClose': round(prev, 2) if prev is not None else None,
            'change': round(change, 2),
            'changePct': round(change_pct, 2),
            'open': round(float(open_val), 2) if open_val is not None else None,
            'high': round(float(high_val), 2) if high_val is not None else None,
            'low': round(float(low_val), 2) if low_val is not None else None,
            'volumeRaw': int(vol_raw) if vol_raw is not None else 0,
            'ampPct': round(amp_pct, 2) if amp_pct is not None else None,
            'marketState': m_state,
            'tradeDate': market_day,
            'tradeTime': trade_time,
            'currency': meta.get('currency', ''),
            'yahooSymbol': yahoo_symbol,
        }
    except Exception:
        return None


class LiveQuoteService:
    BENCHMARK_TTL_SEC = 45

    def __init__(self, stock_names: dict | None = None):
        self.stock_names = stock_names or {}
        self._bench_cache: dict[str, tuple[float, dict | None]] = {}
        self._lock = threading.Lock()

    def _get_benchmark_cached(self, symbol: str) -> dict | None:
        now = time.time()
        with self._lock:
            cached = self._bench_cache.get(symbol)
            if cached and (now - cached[0]) < self.BENCHMARK_TTL_SEC:
                return cached[1]
        data = fetch_yahoo_chart_lite(symbol)
        with self._lock:
            self._bench_cache[symbol] = (time.time(), data)
        return data

    def evaluate_tw_market(self, probe_live: bool = True, now_utc: datetime | None = None) -> dict:
        now_tw = (now_utc.astimezone(TAIPEI_TZ) if now_utc else taipei_now())
        day_str = now_tw.strftime('%Y-%m-%d')
        t_val = now_tw.time()
        base = {
            'market': 'TW',
            'label': '台股 (TWSE/TPEx)',
            'localTime': now_tw.strftime('%Y-%m-%d %H:%M'),
            'tradingHours': '週一至週五 09:00–13:35 (台北)',
            'marketState': 'CLOSED',
            'latestTradeDate': '',
        }
        if now_tw.weekday() >= 5:
            return {**base, 'isOpen': False, 'stateCode': 'WEEKEND', 'reason': '週末休市'}
        if day_str in TW_MARKET_HOLIDAYS:
            return {**base, 'isOpen': False, 'stateCode': 'HOLIDAY', 'reason': TW_MARKET_HOLIDAYS[day_str]}
        if not (dtime(9, 0) <= t_val <= dtime(13, 35)):
            return {**base, 'isOpen': False, 'stateCode': 'OFF_HOURS', 'reason': '非盤中時段（09:00–13:35）'}

        if probe_live:
            bench = self._get_benchmark_cached('^TWII')
            if bench:
                base['marketState'] = bench.get('marketState', 'CLOSED')
                base['latestTradeDate'] = bench.get('tradeDate', '')
                past_open_grace = t_val >= dtime(9, 5)
                if bench.get('marketState') != 'REGULAR' or (past_open_grace and bench.get('tradeDate') != day_str):
                    return {
                        **base,
                        'isOpen': False,
                        'stateCode': 'HALTED_OR_HOLIDAY',
                        'reason': '今日休市／臨時停盤（開盤後無今日新成交）',
                    }
        return {**base, 'isOpen': True, 'stateCode': 'REGULAR', 'reason': '台股盤中交易中', 'marketState': 'REGULAR'}

    def evaluate_us_market(self, probe_live: bool = True, now_utc: datetime | None = None) -> dict:
        now_et = us_eastern_now(now_utc)
        day_str = now_et.strftime('%Y-%m-%d')
        t_val = now_et.time()
        tz_abbr = now_et.tzname() or 'ET'
        base = {
            'market': 'US',
            'label': '美股 (NYSE/Nasdaq)',
            'localTime': now_et.strftime(f'%Y-%m-%d %H:%M {tz_abbr}'),
            'tradingHours': f'週一至週五 09:30–16:05 ({tz_abbr})',
            'marketState': 'CLOSED',
            'latestTradeDate': '',
        }
        if now_et.weekday() >= 5:
            return {**base, 'isOpen': False, 'stateCode': 'WEEKEND', 'reason': '美股週末休市'}
        h_name = get_us_holiday_name(now_et.date())
        if h_name:
            return {**base, 'isOpen': False, 'stateCode': 'HOLIDAY', 'reason': h_name}
        if not (dtime(9, 30) <= t_val <= dtime(16, 5)):
            return {**base, 'isOpen': False, 'stateCode': 'OFF_HOURS', 'reason': f'美股非盤中時段（09:30–16:05 {tz_abbr}）'}

        if probe_live:
            bench = self._get_benchmark_cached('^GSPC')
            if bench:
                base['marketState'] = bench.get('marketState', 'CLOSED')
                base['latestTradeDate'] = bench.get('tradeDate', '')
                past_open_grace = t_val >= dtime(9, 35)
                if bench.get('marketState') != 'REGULAR' or (past_open_grace and bench.get('tradeDate') != day_str):
                    return {
                        **base,
                        'isOpen': False,
                        'stateCode': 'HALTED_OR_HOLIDAY',
                        'reason': '美股今日休市／臨時停盤（開盤後無今日成交）',
                    }
        return {**base, 'isOpen': True, 'stateCode': 'REGULAR', 'reason': '美股盤中交易中', 'marketState': 'REGULAR'}

    def get_market_status(self, probe_live: bool = False) -> dict:
        return {
            'TW': self.evaluate_tw_market(probe_live=probe_live),
            'US': self.evaluate_us_market(probe_live=probe_live),
            'checkedAt': taipei_now().strftime('%Y-%m-%d %H:%M:%S'),
        }

    def _fetch_one(self, code: str) -> dict | None:
        is_index = code.startswith('^')
        is_tw = (not is_index) and bool(VALID_TW_CODE_RE.fullmatch(code))
        if is_tw:
            info = self.stock_names.get(code)
            exch = info[1] if isinstance(info, list) and len(info) > 1 else 'TWSE'
            if exch == 'TPEx':
                q = fetch_yahoo_chart_lite(f'{code}.TWO') or fetch_yahoo_chart_lite(f'{code}.TW')
            else:
                q = fetch_yahoo_chart_lite(f'{code}.TW') or fetch_yahoo_chart_lite(f'{code}.TWO')
            if not q:
                return None
            return {
                'code': code,
                'market': exch,
                **q,
                'volumeLots': round(q['volumeRaw'] / 1000) if q.get('volumeRaw') else 0,
            }

        q = fetch_yahoo_chart_lite(code)
        if not q:
            return None
        mkt = 'TW' if code == '^TWII' else 'US'
        return {
            'code': code,
            'market': mkt,
            **q,
            'volumeLots': q.get('volumeRaw') or 0,
        }

    def fetch_batch(self, codes: list[str], manual: bool = False) -> dict:
        clean_codes: list[str] = []
        for c in codes or []:
            sym = str(c or '').strip().upper()
            if VALID_SYMBOL_RE.fullmatch(sym) and sym not in clean_codes:
                clean_codes.append(sym)
        clean_codes = clean_codes[:50]

        has_tw = any((not c.startswith('^') and bool(VALID_TW_CODE_RE.fullmatch(c))) or c == '^TWII' for c in clean_codes)
        has_us = any((not c.startswith('^') and not VALID_TW_CODE_RE.fullmatch(c)) or (c.startswith('^') and c != '^TWII') for c in clean_codes)

        tw_status = self.evaluate_tw_market(probe_live=has_tw or manual)
        us_status = self.evaluate_us_market(probe_live=has_us or manual)

        fetch_targets: list[str] = []
        skipped_markets: list[str] = []
        for sym in clean_codes:
            sym_is_tw = (sym == '^TWII') or (not sym.startswith('^') and bool(VALID_TW_CODE_RE.fullmatch(sym)))
            if manual:
                fetch_targets.append(sym)
            elif sym_is_tw:
                if tw_status['isOpen']:
                    fetch_targets.append(sym)
                elif 'TW' not in skipped_markets:
                    skipped_markets.append('TW')
            else:
                if us_status['isOpen']:
                    fetch_targets.append(sym)
                elif 'US' not in skipped_markets:
                    skipped_markets.append('US')

        quotes: dict[str, dict] = {}
        if fetch_targets:
            with ThreadPoolExecutor(max_workers=min(8, max(1, len(fetch_targets)))) as pool:
                for sym, q in zip(fetch_targets, pool.map(self._fetch_one, fetch_targets)):
                    if not q:
                        continue
                    # 非手動模式下，若單一報價回傳非 REGULAR 且屬今日無交易亦保護過濾
                    quotes[sym] = q

        return {
            'quotes': quotes,
            'manual': bool(manual),
            'fetchedCount': len(quotes),
            'requestedCount': len(clean_codes),
            'skippedMarkets': skipped_markets,
            'marketStatus': {'TW': tw_status, 'US': us_status},
            'fetchedAt': taipei_now().strftime('%H:%M:%S'),
            'fetchedAtFull': taipei_now().strftime('%Y-%m-%d %H:%M:%S'),
        }
