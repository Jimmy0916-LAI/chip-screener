"""本機輕量級伺服器（純 Python 標準函式庫）
提供 build/dashboard.html 瀏覽與官方集保 (TDCC 1-5)／證交所交易日曆 (TWSE FMTQIK) 即時更新 API，
讓未安裝 Node.js / Electron 的 Windows 環境也能直接在瀏覽器中即時更新並保存集保週資料。
"""

import csv
from concurrent.futures import Future
from crawler_pool import CrawlerPool, closing
from market import SOURCES, parse_market
import hashlib
import io
import json
import math
import os
import re
import secrets
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INSTALL_ROOT = Path(os.environ.get('CHIP_INSTALL_ROOT') or ROOT).resolve()
DASHBOARD_FILE = ROOT / 'build' / 'dashboard.html'
FEED_BASE_FILE = INSTALL_ROOT / 'data' / 'feed-base.json'

import sys
if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
from providers import ai_router, full_update
from providers.data_repository import SharedDataClient, Unavailable
from providers.market_cache import MarketCache
from providers.verified_https import open_url
from providers.tw_market import TwMarketService
from providers.news_briefing import BriefingService
from providers.watchlist import WatchlistService
from providers.us_market import UsMarketService
from providers.updater import UpdaterService, mark_runtime_verified
from providers.live_quotes import LiveQuoteService
from providers.channels import ChannelService
from providers.paper_trading import PaperTradingService
from providers.ai_trader import AiTraderService

TDCC_URL = 'https://opendata.tdcc.com.tw/getOD.ashx?id=1-5'
TAIPEI_TZ = timezone(timedelta(hours=8))
MAX_RESPONSE_BYTES = 16 * 1024 * 1024
REQUEST_TIMEOUT_SEC = 40
REQUIRED_TDCC_FIELDS = ['資料日期', '證券代號', '持股分級', '人數', '股數', '占集保庫存數比例%']
BAND_START_LEVELS = (11, 12, 13, 15)
ETF_CODE_RE = re.compile(r'^00\d{2,4}[A-Z]?$')
COMMON_STOCK_CODE_RE = re.compile(r'^[1-9]\d{3}$')


def calendar_url(month: str) -> str:
    return f"https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date={month.replace('-', '')}01&response=json"


def taipei_now() -> str:
    return datetime.now(TAIPEI_TZ).isoformat(timespec='milliseconds')


def digest_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def check(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def parse_iso_day(text: str) -> str:
    check(bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}', text)), f'日期無效 {text}')
    parsed = date.fromisoformat(text)
    check(parsed.isoformat() == text, f'日期無效 {text}')
    return text


def next_month(month: str) -> str:
    y, m = map(int, month.split('-'))
    return f'{y + 1}-01' if m == 12 else f'{y:04d}-{m + 1:02d}'


def download_url(url: str) -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            'Cache-Control': 'no-cache',
            'User-Agent': 'ChipScreener/0.6 (weekly public data)',
        },
    )
    try:
        with open_url(req, timeout=REQUEST_TIMEOUT_SEC) as resp:
            if resp.status != 200:
                raise ValueError(f'官方 HTTP {resp.status}')
            chunks = []
            total = 0
            while True:
                part = resp.read(65536)
                if not part:
                    break
                total += len(part)
                if total > MAX_RESPONSE_BYTES:
                    raise ValueError('回應過大')
                chunks.append(part)
            return b''.join(chunks)
    except urllib.error.HTTPError as exc:
        raise ValueError(f'官方 HTTP {exc.code}') from exc
    except urllib.error.URLError as exc:
        raise ValueError(f'連線失敗 {exc.reason}') from exc
    except TimeoutError as exc:
        raise ValueError('連線失敗 逾時') from exc


def parse_week(raw_bytes: bytes, universe: list[str], fetched: str) -> dict:
    text = raw_bytes.decode('utf-8-sig').strip()
    lines = list(csv.reader(io.StringIO(text), strict=True))
    check(len(lines) > 1, '集保內容為空')

    fields = [s.strip() for s in lines[0]]
    col_idx = [fields.index(name) if name in fields else -1 for name in REQUIRED_TDCC_FIELDS]
    check(all(i >= 0 for i in col_idx) and len(set(fields)) == len(fields), '集保欄位缺失或重複')

    pool = set(universe)
    groups: dict[str, dict[int, tuple[int, int]]] = {}
    issues: dict[str, str] = {}
    adjustments: dict[str, list[int]] = {}
    rows: dict[str, list[int]] = {}
    extra_rows: dict[str, list[int]] = {}
    day = None

    for line in lines[1:]:
        values = line
        check(len(values) == len(fields), '集保欄數錯誤')
        stamp, code, lv, holders_s, shares_s = (values[i].strip() for i in col_idx[:5])

        if day is None:
            check(bool(re.fullmatch(r'\d{8}', stamp)), '統計日期格式錯誤')
            day = parse_iso_day(f'{stamp[:4]}-{stamp[4:6]}-{stamp[6:8]}')
            weekday = date.fromisoformat(day).weekday()
            check(day <= fetched[:10] and weekday not in (5, 6), '未來或非營業日的統計日期')
        check(stamp == day.replace('-', ''), '同份集保檔混有不同日期')
        if code not in pool and not (ETF_CODE_RE.fullmatch(code) or COMMON_STOCK_CODE_RE.fullmatch(code)):
            continue

        levels = groups.setdefault(code, {})
        if (
            not lv.isdigit()
            or not holders_s.isdigit()
            or not shares_s.isdigit()
        ):
            issues[code] = '重複級距或股數／戶數無效'
            continue
        level = int(lv)
        if level < 1 or level > 17 or level in levels:
            issues[code] = '重複級距或股數／戶數無效'
            continue
        levels[level] = (int(shares_s), int(holders_s))

    for code in universe:
        g = groups.get(code)
        if not g or len(g) != 17:
            issues.setdefault(code, '原表缺股或缺少級距')
        if code in issues:
            continue

        den, count = g[17]
        sum_shares = sum(g[i][0] for i in range(1, 16))
        sum_holders = sum(g[i][1] for i in range(1, 16))
        bands_shares = [sum(g[i][0] for i in range(start, 16)) for start in BAND_START_LEVELS]
        bands_holders = [sum(g[i][1] for i in range(start, 16)) for start in BAND_START_LEVELS]

        if (
            den <= 0
            or sum_shares - g[16][0] != den
            or sum_holders != count
            or any(n > den for n in bands_shares)
        ):
            issues[code] = '股數或戶數與第17級未對帳，待核'
            continue

        rows[code] = [den, count, *bands_shares, *bands_holders]
        if g[16][0] or g[16][1]:
            adjustments[code] = [g[16][0], g[16][1]]

    universe_issues = {k: v for k, v in issues.items() if k in pool}

    for code, g in groups.items():
        if code in pool or code in issues or len(g) != 17:
            continue
        den, count = g[17]
        sum_shares = sum(g[i][0] for i in range(1, 16))
        sum_holders = sum(g[i][1] for i in range(1, 16))
        bands_shares = [sum(g[i][0] for i in range(start, 16)) for start in BAND_START_LEVELS]
        bands_holders = [sum(g[i][1] for i in range(start, 16)) for start in BAND_START_LEVELS]
        if (
            den <= 0
            or sum_shares - g[16][0] != den
            or sum_holders != count
            or any(n > den for n in bands_shares)
        ):
            continue
        extra_rows[code] = [den, count, *bands_shares, *bands_holders]
        if g[16][0] or g[16][1]:
            adjustments[code] = [g[16][0], g[16][1]]

    valid = len(rows)
    check(bool(day) and valid >= math.ceil(len(pool) * 0.95), f'集保有效股票覆蓋不足 95%（{valid}/{len(pool)}）')

    return {
        'day': day,
        'rows': rows,
        'extraRows': extra_rows,
        'issues': universe_issues,
        'adjustments': adjustments,
        'observed': fetched,
        'quality': {
            'raw_source': TDCC_URL,
            'sha256': digest_bytes(raw_bytes),
            'valid': valid,
            'invalid': len(pool) - valid,
            'universe': len(pool),
            'fetched': fetched,
            'publication': None,
            'validation': '1–17 級日期、股數、戶數與固定母體覆蓋驗證通過',
        },
    }


def parse_month(raw_bytes: bytes, month: str, fetched: str, known: list[str]) -> dict:
    payload = json.loads(raw_bytes.decode('utf-8-sig'))
    check(
        payload.get('stat') == 'OK'
        and payload.get('fields', [None])[0] == '日期'
        and '成交股數' in payload.get('fields', [])
        and payload.get('date') == month.replace('-', '') + '01'
        and len(payload.get('data', [])) > 0,
        f'TWSE 日曆月份或欄位不符 {month}',
    )

    days = []
    for row in payload['data']:
        m = re.fullmatch(r'(\d{2,3})/(\d{2})/(\d{2})', str(row[0]).strip())
        vol = int(str(row[1]).replace(',', '').strip())
        check(bool(m) and vol > 0, 'TWSE 交易日列無效')
        iso = parse_iso_day(f'{int(m.group(1)) + 1911:04d}-{m.group(2)}-{m.group(3)}')
        days.append(iso)

    monotonic = all(
        d.startswith(month + '-') and d <= fetched[:10] and (i == 0 or d > days[i - 1])
        for i, d in enumerate(days)
    )
    check(monotonic and all(d in days for d in known), 'TWSE 日曆日期倒退、錯月或缺少已知交易日')

    return {
        'month': month,
        'days': days,
        'source': calendar_url(month),
        'sha256': digest_bytes(raw_bytes),
        'fetched': fetched,
    }


class LocalFeedService:
    def __init__(self, cache_dir: Path, base: dict, *, persist_market=True, shared=None):
        self.cache_dir = cache_dir
        self.base = base
        self.persist_market = persist_market
        self.shared = shared
        self.weeks: dict[str, dict] = {}
        self.months: dict[str, dict] = {}
        self.notes: list[str] = []
        self._lock = threading.Lock()
        self._active = None
        self.market = {}
        if self.persist_market:
            self._load_cache()
            for key in SOURCES:
                path = self._bucket_file('market', key)
                if path.exists():
                    try:
                        data = json.loads(path.read_bytes())
                        if data['source'] == SOURCES[key] and data['rows']:
                            self.market[key] = data
                    except (ValueError, KeyError, OSError):
                        self.notes.append(f'{key} 快取待重新下載')

    def _bucket_file(self, kind: str, key: str) -> Path:
        return self.cache_dir / kind / f'{key}.json'

    def _load_cache(self) -> None:
        for kind, pattern, target in [
            ('official', r'\d{4}-\d{2}-\d{2}\.json', self.weeks),
            ('calendar', r'\d{4}-\d{2}\.json', self.months),
        ]:
            folder = self.cache_dir / kind
            if not folder.exists():
                continue
            for file in sorted(folder.iterdir()):
                if not re.fullmatch(pattern, file.name):
                    continue
                try:
                    data = json.loads(file.read_text(encoding='utf-8'))
                    key = file.stem
                    if (data.get('day') or data.get('month')) == key:
                        target[key] = data
                except Exception:
                    self.notes.append(f'{file.stem} 本機快取損毀略過')

    def _atomic_save(self, kind: str, key: str, value: dict) -> None:
        if closing.is_set():
            raise InterruptedError('籌碼雷達視窗已關閉')
        if not self.persist_market:
            return
        target = self._bucket_file(kind, key)
        target.parent.mkdir(parents=True, exist_ok=True)
        stage = target.with_suffix('.json.tmp')
        raw = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
        with stage.open('w', encoding='utf-8') as file:
            file.write(raw)
            file.flush()
            os.fsync(file.fileno())
        os.replace(stage, target)

    def latest(self) -> str:
        return sorted([*self.base['hashes'].keys(), *self.weeks.keys()])[-1]

    def initial(self) -> dict:
        return {'weeks': self.weeks.copy(), 'months': self.months.copy(), 'market': self.market.copy(), 'notes': self.notes[:]}

    def _check_week(self, raw_bytes: bytes) -> tuple[dict | None, str]:
        week = parse_week(raw_bytes, self.base['universe'], taipei_now())
        latest_day = self.latest()
        day = week['day']

        if day < latest_day:
            raise ValueError(f'忽略舊回應 {day}，已保存 {latest_day}')
        sessions = set(self.base['sessions'])
        for record in self.months.values():
            sessions.update(record['days'])
        observed_day = date.fromisoformat(day)
        end_of_week = observed_day + timedelta(days=4-observed_day.weekday())
        verified_later_session = any(day < d <= end_of_week.isoformat() for d in sessions)
        check(day in sessions and not verified_later_session, f'{day} 不是可確認的當週最後交易日')

        if day == latest_day:
            known_hash = (self.weeks.get(day, {}).get('quality', {}).get('sha256') or self.base['hashes'].get(day))
            previous = self.weeks.get(day)
            if previous and known_hash == week['quality']['sha256'] and 'extraRows' in previous:
                finished_weeks = [
                    d for d in sessions if date.fromisoformat(d).weekday() == 4
                ]
                next_pending = max(finished_weeks, default='') > day
                return None, f'新一期尚未發布（最新 {day}）' if next_pending else f'已是最新 {day}'
            if previous and known_hash != week['quality']['sha256']:
                revision = digest_bytes(json.dumps(previous, ensure_ascii=False).encode('utf-8'))
                self._atomic_save('revisions', f'{day}-{revision}', previous)

        self._atomic_save('official', day, week)
        self.weeks[day] = week
        return week, f'有新資料 {day}'

    def _check_calendar(self, changed: dict) -> None:
        month = sorted(self.months.keys())[-1] if self.months else self.base['sessions'][-1][:7]
        today_month = taipei_now()[:7]
        while month <= today_month:
            old = self.months.get(month, {}).get('days') or [d for d in self.base['sessions'] if d.startswith(month)]
            record = parse_month(download_url(calendar_url(month)), month, taipei_now(), old)
            if len(record['days']) > len(old):
                self._atomic_save('calendar', month, record)
                self.months[month] = record
                changed[month] = record
            month = next_month(month)

    def update(self) -> dict:
        with self._lock:
            task = self._active
            owner = task is None
            if owner:
                task = self._active = Future()
        if not owner:
            return task.result()
        try:
            result = self._refresh()
            task.set_result(result)
            return result
        except Exception as exc:
            task.set_exception(exc)
            raise
        finally:
            with self._lock:
                self._active = None

    def _refresh_market(self, key):
        raw = download_url(SOURCES[key])
        record = parse_market(key, raw, taipei_now())
        record['sha256'] = digest_bytes(raw)
        old = self.market.get(key)
        if old and record['day'] < old['day']:
            raise ValueError('回應早於已驗證行情')
        if not old or record['sha256'] != old.get('sha256'):
            self._atomic_save('market', key, record)
            self.market[key] = record

    def _shared_weeks(self) -> tuple[dict, str]:
        if self.shared is None:
            return {}, ''
        now = taipei_now()
        today = date.fromisoformat(now[:10])
        sessions = set(self.base['sessions'])
        for record in self.months.values():
            sessions.update(record['days'])
        week_ends = {}
        for day in sorted(sessions):
            trading_day = date.fromisoformat(day)
            monday = trading_day - timedelta(days=trading_day.weekday())
            week_ends[monday] = day
        elapsed = [day for monday, day in sorted(week_ends.items())
                   if monday + timedelta(days=4) < today or (day == now[:10] and now[11:16] >= '13:30'
                       and today.weekday() == 4)]
        target = max(elapsed, default='')
        if not target:
            return {}, ''
        start = (today - timedelta(days=45)).isoformat()
        if start > target:
            return {}, ''
        shards = self.shared.read('tdcc', start, target, market='TW',
                                  skip_dates=self.base['hashes'].keys() | self.weeks.keys())
        added = {}
        for entry, raw in shards:
            day = entry['statistic_date']
            if (day not in elapsed or entry['date_from'] != day or entry['date_to'] != day
                    or entry['code'] is not None or entry['source']['url'] != TDCC_URL
                    or entry['asset']['format'] != 'csv'):
                continue
            week = parse_week(raw, self.base['universe'], entry['retrieved_at'])
            check(day == week['day'], '共享集保統計日不符')
            week['observed'] = entry['published_at'] or entry['observed_at']
            if week['observed'] is None:
                continue
            week['quality'].update(publication=entry['published_at'], data_version=entry['data_version'],
                                   revision=entry['revision'], shared=True)
            added[day] = week
        self.weeks.update(added)
        return added, target

    def _refresh(self):
        months, errors, changed_weeks = {}, [], {}
        message, shared_message = '', ''
        with CrawlerPool(max_workers=6) as pool:
            # Legacy tests and archived builds can exercise the original persistent update path.
            weekly = pool.submit(download_url, TDCC_URL) if self.shared is None else None
            calendar = pool.submit(self._check_calendar, months)
            jobs = {key: pool.submit(self._refresh_market, key) for key in SOURCES}
            try:
                calendar.result()
            except Exception as exc:
                errors.append(f'交易日曆：{exc}')
            target = ''
            try:
                shared, target = self._shared_weeks()
                changed_weeks.update(shared)
            except InterruptedError:
                raise
            except (OSError, ValueError) as exc:
                shared_message = '共享集保暫不可用：' + str(exc)
            try:
                if target in changed_weeks:
                    message = f'共享集保已取得 {target}'
                else:
                    raw = weekly.result() if weekly is not None else download_url(TDCC_URL)
                    week, message = self._check_week(raw)
                    if week:
                        changed_weeks[week['day']] = week
            except Exception as exc:
                errors.append('集保更新失敗，保留上次資料：' + str(exc))
            for key, task in jobs.items():
                try:
                    task.result()
                except Exception as exc:
                    errors.append(f'{key}：{exc}')
        status = '更新成功' if changed_weeks else '新一期尚未發布' if message.startswith('新一期') else '已是最新'
        if errors:
            status = '更新失敗，已保留上次資料' if len(errors) == len(jobs)+2 else '部分成功'
        return {'weeks': changed_weeks, 'months': months,
                'market': self.market.copy(), 'status': status,
                'message': '｜'.join(filter(None, [message, shared_message, *errors])), 'checked': taipei_now()}


class DailyService:
    """抓取並快取個股日 K 與發行股數（FinMind TaiwanStockPrice + TaiwanStockShareholding），供底峰研究模型使用。"""

    FINMIND_API = 'https://api.finmindtrade.com/api/v4/data'
    CACHE_TTL_SEC = 12 * 3600

    def __init__(self, cache_dir: Path, feed_service: LocalFeedService, *, persist_market=True):
        self.cache_dir = cache_dir
        self.feed_service = feed_service
        self.persist_market = persist_market
        self._ram = MarketCache(capacity=72)
        self._lock = threading.RLock()

    def _fetch_finmind(self, dataset: str, code: str, start_date: str = '2024-01-01') -> list[dict]:
        qs = urllib.parse.urlencode({'dataset': dataset, 'data_id': code, 'start_date': start_date})
        raw = download_url(f'{self.FINMIND_API}?{qs}')
        payload = json.loads(raw.decode('utf-8'))
        if payload.get('status') != 200:
            raise ValueError(payload.get('msg') or f'FinMind 回應異常 ({payload.get("status")})')
        return payload.get('data', [])

    def get_daily(self, code: str) -> dict:
        if not re.fullmatch(r'(?:\d{4}|00\d{2,4}[A-Z]?)', code):
            raise ValueError('請輸入有效四碼股票或 ETF 代號')

        cache_file = self.cache_dir / f'{code}.json'
        with self._lock:
            fresh = self._ram.get(code, self.CACHE_TTL_SEC)
            if fresh is not None:
                return fresh
            cached = self._ram.get(code)
            if cached is None:
                try:
                    candidate = json.loads(cache_file.read_bytes())
                    if candidate['code'] == code and candidate['bars']:
                        cached = candidate
                        if self.persist_market and time.time() - cache_file.stat().st_mtime < self.CACHE_TTL_SEC:
                            return cached
                except (ValueError, OSError, KeyError, TypeError):
                    pass
            try:
                return self._download_daily(code, cache_file)
            except (ValueError, OSError) as exc:
                if cached:
                    return {**cached, 'stale': True, 'warning': str(exc)}
                raise

    def screening_prices(self):
        prices = {}
        with self._lock:
            packets = self._ram.items()
            if self.persist_market:
                for path in self.cache_info()['files']:
                    try:
                        item = json.loads(path.read_bytes())
                        if item['code'] == path.stem and isinstance(item['bars'], list):
                            packets.setdefault(path.stem, item)
                    except (OSError, ValueError, KeyError, TypeError):
                        continue
            for code, item in packets.items():
                prices[code] = {
                    'bars': [bar[:5] for bar in item['bars'] if isinstance(bar, list)],
                    'fetched': item.get('fetched'),
                }
        return prices

    def cache_info(self):
        with self._lock:
            files = [p for p in self.cache_dir.glob('*.json')
                     if re.fullmatch(r'(?:\d{4}|00\d{2,4}[A-Z]?)', p.stem) and p.is_file() and not p.is_symlink()]
            entries = [(p, p.stat()) for p in files]
            ram = self._ram.items()
            return {
                'path': str(self.cache_dir),
                'ramCount': len(ram),
                'memoryOnly': not self.persist_market,
                'bytes': sum(stat.st_size for _, stat in entries),
                'count': len(entries),
                'last': max((datetime.fromtimestamp(stat.st_mtime, TAIPEI_TZ).isoformat(timespec='seconds')
                             for _, stat in entries), default=None),
                'files': files,
            }

    def clear_cache(self):
        with self._lock:
            info = self.cache_info()
            files = info.pop('files')
            self._ram.clear()
            if self.persist_market:
                for path in files:
                    path.unlink()
            return info

    def _download_daily(self, code, cache_file):
        prices = self._fetch_finmind('TaiwanStockPrice', code)
        if not prices:
            raise ValueError(f'查無 {code} 的日行情資料')

        shares_rows = self._fetch_finmind('TaiwanStockShareholding', code)
        issued_by_date: list[tuple[str, int, str]] = []
        stock_name = ''
        for r in shares_rows:
            n = int(r.get('NumberOfSharesIssued') or 0)
            if n > 0:
                issued_by_date.append((r['date'], n, r.get('stock_name') or ''))
                if not stock_name and r.get('stock_name'):
                    stock_name = r['stock_name']
        issued_by_date.sort(key=lambda x: x[0])

        bars = []
        idx = 0
        last_issued = None

        for p in sorted(prices, key=lambda item: item.get('date', '')):
            d = p.get('date', '')
            o = float(p.get('open') or 0)
            h = float(p.get('max') or 0)
            l = float(p.get('min') or 0)
            c = float(p.get('close') or 0)
            vol = int(p.get('Trading_Volume') or 0)

            while idx < len(issued_by_date) and issued_by_date[idx][0] <= d:
                last_issued = issued_by_date[idx][1]
                idx += 1

            if l <= 0 or h < l or c <= 0 or o <= 0 or vol < 0:
                continue
            turnover = vol / last_issued if last_issued else None
            bars.append([d, o, h, l, c, vol, last_issued, turnover, '', False])

        if not bars:
            raise ValueError(f'{code} 缺少有效日 K 或發行股數資料')

        result = {
            'code': code,
            'name': stock_name,
            'bars': bars,
            'source': 'FinMind (TaiwanStockPrice + TaiwanStockShareholding)',
            'fetched': taipei_now(),
        }
        self._save_daily(cache_file, result)
        return result

    def _save_daily(self, cache_file, result):
        if self.persist_market:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            stage = cache_file.with_suffix('.json.tmp')
            stage.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
            os.replace(stage, cache_file)
        self._ram.put(result['code'], result)


class WindowLeases:
    """Track live dashboard documents and allow short reload/navigation gaps."""
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.lock = threading.Lock()
        self.clients = {}
        self.deadline = clock() + 90

    def update(self, client, active):
        with self.lock:
            now = self.clock()
            if active:
                self.deadline = now + 4
                self.clients[client] = now + 150
            elif self.clients.pop(client, None) is not None:
                self.deadline = now + 4

    def expired(self):
        with self.lock:
            now = self.clock()
            self.clients = {key: end for key, end in self.clients.items() if end > now}
            return not self.clients and now >= self.deadline


def create_server(host: str = '127.0.0.1', port: int = 18765) -> ThreadingHTTPServer:
    leases = WindowLeases()
    base = json.loads(FEED_BASE_FILE.read_text(encoding='utf-8'))
    local_app_data = Path(os.environ.get('LOCALAPPDATA') or Path.home())
    app_data_root = local_app_data / 'ChipScreener'
    shared_data = SharedDataClient(cancel=closing)
    service = LocalFeedService(app_data_root / 'tdcc-local-v1', base, persist_market=False, shared=shared_data)
    daily_service = DailyService(app_data_root / 'daily-cache-v1', service, persist_market=False)
    tw_market_service = TwMarketService(app_data_root / 'tw-detail-v1', persist_market=False)
    stock_names = {}
    base_series = {}
    web_data_file = INSTALL_ROOT / 'data' / 'web_data.json'
    if web_data_file.exists():
        try:
            wd = json.loads(web_data_file.read_text(encoding='utf-8'))
            stock_names = wd.get('stocks', {})
            base_series = wd.get('series', {})
        except Exception:
            pass
    for etf_code, etf_name in {
        '0050': '元大台灣50', '0056': '元大高股息', '00878': '國泰永續高股息',
        '00919': '群益台灣精選高息', '00929': '復華台灣科技優息', '00713': '元大台灣高息低波',
        '006208': '富邦台50', '00881': '國泰台灣5G+',
    }.items():
        stock_names.setdefault(etf_code, [etf_name, 'TWSE'])

    briefing_service = BriefingService(app_data_root, INSTALL_ROOT, stock_names)
    briefing_service.sync_shared_windows_task()
    us_market_service = UsMarketService(app_data_root / 'us-cache-v1', persist_market=False)
    watchlist_service = WatchlistService(
        app_data_root,
        INSTALL_ROOT,
        tw_market_service,
        stock_names=stock_names,
        base_series=base_series,
        feed_service=service,
    )
    updater_service = UpdaterService(app_data_root, INSTALL_ROOT, ROOT)
    application = full_update.FullUpdate(app_data_root, INSTALL_ROOT.parent)
    server_id = secrets.token_hex(16)

    def software_state():
        state = updater_service.get_state()
        state.update(application.display())
        for key in ('hasToken', 'tokenHint'):
            state['config'].pop(key, None)
        state['ai'] = ai_router.public_state(app_data_root)
        state['marketStatus'] = live_quote_service.get_market_status(probe_live=False)
        return state

    def stop_server():
        application.close_event.set()
        closing.set()
        server.shutdown()
    live_quote_service = LiveQuoteService(stock_names=stock_names)
    channel_service = ChannelService(app_data_root, INSTALL_ROOT, stock_names=stock_names, feed_service=service)
    paper_service = PaperTradingService(
        app_data_root,
        INSTALL_ROOT,
        live_quote_service=live_quote_service,
        stock_names=stock_names,
    )
    ai_trader_service = AiTraderService(
        app_data_root,
        INSTALL_ROOT,
        paper_service,
        feed_service=service,
        tw_market_service=tw_market_service,
        us_market_service=us_market_service,
        briefing_service=briefing_service,
        watchlist_service=watchlist_service,
        channel_service=channel_service,
        live_quote_service=live_quote_service,
        stock_names=stock_names,
        base_series=base_series,
    )

    class Handler(BaseHTTPRequestHandler):
        def _send_json(self, code: int, payload: dict) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def local_request(self):
            host_header = self.headers.get('Host')
            if host_header not in {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}:
                self._send_json(403, {'error': '請從本機股票雷達操作'})
                return False
            return True

        def do_GET(self) -> None:
            if not self.local_request():
                return
            parsed = urllib.parse.urlsplit(self.path)
            if parsed.path in ('/', '/dashboard.html', '/index.html'):
                html = DASHBOARD_FILE.read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(len(html)))
                self.end_headers()
                self.wfile.write(html)
                return
            if parsed.path == '/api/health':
                v_info = updater_service.get_version_info()
                update_session = getattr(self.server, 'update_session', '')
                authorized = bool(update_session) and secrets.compare_digest(
                    self.headers.get('X-Chip-Update-Session', ''), update_session,
                )
                if authorized:
                    # Keep a boot probe read-only and verify the view and datasets actually load.
                    try:
                        dashboard = DASHBOARD_FILE.read_bytes()
                        if b'<!DOCTYPE html>' not in dashboard[:200] and b'<!doctype html>' not in dashboard[:200]:
                            raise ValueError('畫面資源格式無效')
                        json.loads(web_data_file.read_bytes())
                    except (ValueError, OSError):
                        self._send_json(503, {'app': 'ChipScreener', 'status': 'unhealthy'})
                        return
                elif not update_session:
                    mark_runtime_verified(app_data_root)
                self._send_json(200, {
                    'app': 'ChipScreener',
                    'status': 'ok',
                    'latest': None if authorized else service.latest(),
                    'appVersion': v_info['appVersion'],
                    'shellVersion': v_info['shellVersion'],
                    'usingRuntime': v_info['usingRuntime'],
                    'sourceCommit': (application.current or {}).get('commit'),
                    'serverId': server_id,
                    'updateSession': update_session if authorized else None,
                    'updateResult': full_update.application_state(application.root).get('lastResult'),
                })
                return
            if parsed.path == '/api/software/ai':
                self._send_json(200, ai_router.public_state(app_data_root))
                return
            if parsed.path == '/api/software/state':
                self._send_json(200, software_state())
                return
            if parsed.path == '/api/software/update/progress':
                self._send_json(200, application.get_progress())
                return
            if parsed.path == '/api/quotes/market-status':
                params = urllib.parse.parse_qs(parsed.query)
                probe = (params.get('probe') or ['0'])[0] == '1'
                self._send_json(200, live_quote_service.get_market_status(probe_live=probe))
                return
            if parsed.path == '/api/data/read':
                params = urllib.parse.parse_qs(parsed.query)
                def param(key, default=None):
                    return (params.get(key) or [default])[0]
                try:
                    shards = shared_data.read(param('dataset'), param('from'), param('to'),
                                              market=param('market'), code=param('code'),
                                              instrument_id=param('instrument_id'), as_of=param('as_of'))
                    rows = [{'metadata': entry, 'data': raw.decode('utf-8-sig')} for entry, raw in shards]
                    self._send_json(200, {'status': 'available' if rows else 'missing', 'shards': rows})
                except (Unavailable, InterruptedError) as exc:
                    self._send_json(503, {'status': 'unavailable', 'error': str(exc), 'shards': []})
                except ValueError as exc:
                    self._send_json(400, {'status': 'invalid', 'error': str(exc), 'shards': []})
                return
            if parsed.path == '/api/official/read':
                self._send_json(200, service.initial())
                return
            if parsed.path == '/api/cache':
                info = daily_service.cache_info()
                info.pop('files')
                self._send_json(200, {'history': info, 'root': str(app_data_root)})
                return
            if parsed.path == '/api/signals/prices':
                self._send_json(200, daily_service.screening_prices())
                return
            if parsed.path == '/api/daily':
                params = urllib.parse.parse_qs(parsed.query)
                code = (params.get('code') or [''])[0].strip().upper()
                try:
                    self._send_json(200, daily_service.get_daily(code))
                except Exception as exc:
                    self._send_json(400, {'error': str(exc)})
                return
            if parsed.path == '/api/tw/detail':
                params = urllib.parse.parse_qs(parsed.query)
                code = (params.get('code') or [''])[0].strip().upper()
                force = (params.get('refresh') or ['0'])[0] == '1'
                try:
                    self._send_json(200, tw_market_service.get_detail(code, force_refresh=force))
                except Exception as exc:
                    self._send_json(400, {'error': str(exc)})
                return
            if parsed.path == '/api/briefing':
                params = urllib.parse.parse_qs(parsed.query)
                day = (params.get('date') or [None])[0]
                self._send_json(200, {
                    'config': briefing_service.get_config(),
                    'dates': briefing_service.list_dates(),
                    'report': briefing_service.read_report(day),
                    'shouldAutoRun': briefing_service.should_auto_run(),
                })
                return
            if parsed.path == '/api/watchlist':
                self._send_json(200, watchlist_service.get_state())
                return
            if parsed.path == '/api/channels':
                self._send_json(200, channel_service.get_state())
                return
            if parsed.path == '/api/paper':
                params = urllib.parse.parse_qs(parsed.query)
                slot_id = (params.get('slotId') or [''])[0].strip() or None
                refresh = (params.get('refresh') or ['0'])[0] == '1'
                try:
                    self._send_json(200, paper_service.get_state(slot_id=slot_id, refresh_quotes=refresh))
                except ValueError as exc:
                    self._send_json(400, {'error': str(exc)})
                except Exception as exc:
                    self._send_json(500, {'error': str(exc)})
                return
            if parsed.path == '/api/us/overview':
                params = urllib.parse.parse_qs(parsed.query)
                force = (params.get('refresh') or ['0'])[0] == '1'
                try:
                    self._send_json(200, us_market_service.get_overview(force_refresh=force))
                except Exception as exc:
                    self._send_json(500, {'error': str(exc)})
                return
            if parsed.path == '/api/us/screener':
                params = urllib.parse.parse_qs(parsed.query)
                force = (params.get('refresh') or ['0'])[0] == '1'
                try:
                    self._send_json(200, us_market_service.get_screener(force_refresh=force))
                except Exception as exc:
                    self._send_json(500, {'error': str(exc)})
                return
            if parsed.path == '/api/us/detail':
                params = urllib.parse.parse_qs(parsed.query)
                code = (params.get('code') or [''])[0].strip().upper()
                force = (params.get('refresh') or ['0'])[0] == '1'
                try:
                    self._send_json(200, us_market_service.get_detail(code, force_refresh=force))
                except Exception as exc:
                    self._send_json(400, {'error': str(exc)})
                return
            self.send_error(404)

        def _read_json_body(self) -> dict:
            length = int(self.headers.get('Content-Length') or '0')
            if length <= 0 or length > 256 * 1024:
                return {}
            try:
                return json.loads(self.rfile.read(length).decode('utf-8'))
            except Exception:
                return {}

        def do_POST(self) -> None:
            if not self.local_request():
                return
            origin = self.headers.get('Origin')
            if origin and urllib.parse.urlsplit(origin).netloc != self.headers.get('Host'):
                self._send_json(403, {'error': '請從本機股票雷達操作'})
                return
            parsed = urllib.parse.urlsplit(self.path)
            if parsed.path == '/api/window/lease':
                body = self._read_json_body()
                client, active = body.get('client'), body.get('active')
                if origin != f"http://{self.headers.get('Host')}" or not isinstance(client, str) or not re.fullmatch('[a-f0-9-]{36}', client) or type(active) is not bool:
                    self._send_json(400, {'error': '無效視窗識別'})
                    return
                leases.update(client, active)
                self._send_json(200, {'active': active})
                return
            if parsed.path == '/api/software/stop':
                if origin != f"http://{self.headers.get('Host')}" or self._read_json_body().get('confirm') is not True:
                    self._send_json(403, {'error': '請從軟體設定確認停止服務'})
                    return
                if application.is_busy():
                    self._send_json(409, {'error': '更新進行中，請等待版本交接'})
                    return
                self._send_json(200, {'stopped': True})
                stop_server()
                return
            if parsed.path == '/api/cache/history/clear':
                if self._read_json_body().get('confirm') is not True:
                    self._send_json(400, {'error': '請先確認清除範圍'})
                    return
                try:
                    self._send_json(200, daily_service.clear_cache())
                except OSError as exc:
                    self._send_json(500, {'error': str(exc)})
                return
            if parsed.path == '/api/official/update':
                try:
                    self._send_json(200, service.update())
                except Exception as exc:
                    self._send_json(500, {'status': '失敗', 'message': str(exc), 'weeks': {}, 'months': {}, 'checked': taipei_now()})
                return
            if parsed.path == '/api/briefing/generate':
                body = self._read_json_body()
                try:
                    report = briefing_service.generate(
                        featured_code=str(body.get('featuredCode') or '2404'),
                        trigger=str(body.get('trigger') or '手動馬上製作'),
                    )
                    self._send_json(200, {
                        'config': briefing_service.get_config(),
                        'dates': briefing_service.list_dates(),
                        'report': report,
                        'shouldAutoRun': False,
                    })
                except Exception as exc:
                    self._send_json(500, {'error': str(exc)})
                return
            if parsed.path == '/api/briefing/config':
                body = self._read_json_body()
                try:
                    cfg = briefing_service.update_config(body)
                    self._send_json(200, {
                        'config': cfg,
                        'dates': briefing_service.list_dates(),
                        'shouldAutoRun': briefing_service.should_auto_run(),
                    })
                except Exception as exc:
                    self._send_json(400, {'error': str(exc)})
                return
            if parsed.path.startswith('/api/watchlist/'):
                body = self._read_json_body()
                action = parsed.path[len('/api/watchlist/'):]
                try:
                    if action == 'folder/create':
                        res = watchlist_service.create_folder(str(body.get('name') or ''))
                    elif action == 'folder/rename':
                        res = watchlist_service.rename_folder(str(body.get('folderId') or ''), str(body.get('name') or ''))
                    elif action == 'folder/delete':
                        res = watchlist_service.delete_folder(str(body.get('folderId') or ''))
                    elif action == 'stock/add':
                        res = watchlist_service.add_stock(str(body.get('folderId') or ''), str(body.get('code') or ''))
                    elif action == 'stock/update':
                        res = watchlist_service.update_item(str(body.get('folderId') or ''), str(body.get('code') or ''), body)
                    elif action == 'stock/remove':
                        res = watchlist_service.remove_item(str(body.get('folderId') or ''), str(body.get('code') or ''))
                    elif action == 'auto/toggle':
                        res = watchlist_service.toggle_auto_stock(str(body.get('code') or ''), bool(body.get('enabled', True)))
                    elif action == 'auto/config':
                        res = watchlist_service.set_auto_enabled(bool(body.get('enabled', True)))
                    elif action == 'prices/refresh':
                        res = watchlist_service.refresh_quotes(body.get('codes') if isinstance(body.get('codes'), list) else None)
                    elif action == 'analyze':
                        res = watchlist_service.run_auto_analysis(trigger=str(body.get('trigger') or '手動立即更新分析'))
                    else:
                        self.send_error(404)
                        return
                    self._send_json(200, res)
                except ValueError as exc:
                    self._send_json(400, {'error': str(exc)})
                except Exception as exc:
                    self._send_json(500, {'error': str(exc)})
                return
            if parsed.path.startswith('/api/channels/'):
                body = self._read_json_body()
                action = parsed.path[len('/api/channels/'):]
                try:
                    if action == 'add':
                        res = channel_service.add_channel(str(body.get('url') or ''))
                    elif action == 'remove':
                        res = channel_service.remove_channel(str(body.get('channelId') or ''))
                    elif action == 'check':
                        ch_id = str(body.get('channelId') or '').strip() or None
                        force = bool(body.get('force', False))
                        res = channel_service.check_updates(channel_id=ch_id, force=force)
                    elif action == 'strategy/delete':
                        res = channel_service.delete_strategy(
                            str(body.get('channelId') or ''),
                            str(body.get('strategyId') or ''),
                        )
                    elif action == 'config':
                        res = channel_service.update_config(body)
                        if 'autoDailyEnabled' in body:
                            briefing_service.sync_shared_windows_task()
                    else:
                        self.send_error(404)
                        return
                    self._send_json(200, res)
                except ValueError as exc:
                    self._send_json(400, {'error': str(exc)})
                except Exception as exc:
                    self._send_json(500, {'error': str(exc)})
                return
            if parsed.path.startswith('/api/paper/'):
                body = self._read_json_body()
                action = parsed.path[len('/api/paper/'):]
                try:
                    if action == 'slot/create':
                        res = paper_service.create_slot(body)
                        ai_cfg = body.get('aiConfig') if isinstance(body.get('aiConfig'), dict) else {}
                        if str(body.get('mode') or '').strip().lower() == 'ai' and str(ai_cfg.get('scheduleMode') or '').strip().lower() == 'daily':
                            briefing_service.sync_shared_windows_task()
                    elif action == 'slot/update':
                        slot_id = str(body.get('slotId') or '').strip()
                        res = paper_service.update_slot(slot_id, body)
                        if 'aiConfig' in body or 'mode' in body:
                            briefing_service.sync_shared_windows_task()
                    elif action == 'slot/reset':
                        slot_id = str(body.get('slotId') or '').strip()
                        init_cap = body.get('initialCapital') if 'initialCapital' in body else None
                        res = paper_service.reset_slot(slot_id, initial_capital=init_cap)
                    elif action == 'slot/delete':
                        slot_id = str(body.get('slotId') or '').strip()
                        res = paper_service.delete_slot(slot_id)
                        briefing_service.sync_shared_windows_task()
                    elif action == 'order':
                        slot_id = str(body.get('slotId') or '').strip()
                        res = paper_service.place_order(slot_id, body, source='manual')
                    elif action == 'order/cancel':
                        slot_id = str(body.get('slotId') or '').strip()
                        order_id = str(body.get('orderId') or '').strip()
                        res = paper_service.cancel_order(slot_id, order_id)
                    elif action == 'orders/evaluate':
                        slot_id = str(body.get('slotId') or '').strip()
                        res = paper_service.evaluate_orders(slot_id)
                    elif action == 'ai/run':
                        slot_id = str(body.get('slotId') or '').strip()
                        force = bool(body.get('force', False))
                        trigger = str(body.get('trigger') or '手動觸發').strip() or '手動觸發'
                        res = ai_trader_service.run_decision(slot_id, trigger=trigger, force=force)
                    elif action == 'ai/proposal':
                        slot_id = str(body.get('slotId') or '').strip()
                        proposal_id = str(body.get('proposalId') or '').strip()
                        decision = str(body.get('decision') or '').strip()
                        res = paper_service.resolve_proposal(slot_id, proposal_id, decision)
                    else:
                        self.send_error(404)
                        return
                    self._send_json(200, res)
                except ValueError as exc:
                    self._send_json(400, {'error': str(exc)})
                except Exception as exc:
                    self._send_json(500, {'error': str(exc)})
                return
            if parsed.path == '/api/software/ai':
                if origin != f"http://{self.headers.get('Host')}":
                    self._send_json(403, {'error': '請從本機軟體設定操作'})
                    return
                try:
                    self._send_json(200, ai_router.update_settings(app_data_root, self._read_json_body()))
                except ValueError as exc:
                    self._send_json(400, {'error': str(exc)})
                except OSError:
                    self._send_json(500, {'error': '無法儲存本機 AI 設定'})
                return
            if parsed.path in (
                '/api/software/config', '/api/software/update/check', '/api/software/update/install',
                '/api/software/update/apply', '/api/software/rollback',
            ):
                if origin != f"http://{self.headers.get('Host')}":
                    self._send_json(403, {'error': '請從本機軟體設定操作'})
                    return
                body = self._read_json_body()
                try:
                    if not isinstance(body, dict):
                        raise ValueError('無效軟體設定')
                    if parsed.path == '/api/software/config':
                        if 'channel' in body and (
                            body.get('confirmChannel') is not True or application.is_busy()
                        ):
                            raise ValueError('請確認切換通道，並等待現有更新完成')
                        fields = {'channel', 'liveQuoteEnabled', 'liveQuoteIntervalSec'}
                        updater_service.update_config({key: body[key] for key in fields & body.keys()})
                        self._send_json(200, software_state())
                    elif parsed.path == '/api/software/update/check':
                        channel = updater_service.get_state()['config']['channel']
                        version = updater_service.get_version_info()['appVersion']
                        res = application.check(channel, version)
                        self._send_json(200, {'check': res, 'state': software_state()})
                    elif parsed.path == '/api/software/update/install':
                        if body.get('confirm') is not True:
                            raise ValueError('請先確認安裝固定入口')
                        application.install()
                        self._send_json(200, software_state())
                    else:
                        channel = updater_service.get_state()['config']['channel']
                        action = 'apply' if parsed.path.endswith('/apply') else 'rollback'
                        res = application.request(action, body, channel, self.server.server_port, stop_server)
                        self._send_json(202, res)
                except (OSError, ValueError, subprocess.SubprocessError) as exc:
                    self._send_json(400, {'error': str(exc)})
                return
            if parsed.path == '/api/software/notice/dismiss':
                try:
                    updater_service.dismiss_release_notice()
                    self._send_json(200, software_state())
                except Exception as exc:
                    self._send_json(500, {'error': str(exc)})
                return
            if parsed.path == '/api/quotes/live':
                body = self._read_json_body()
                codes = body.get('codes') if isinstance(body.get('codes'), list) else []
                manual = bool(body.get('manual', False))
                try:
                    self._send_json(200, live_quote_service.fetch_batch(codes, manual=manual))
                except Exception as exc:
                    self._send_json(500, {'error': str(exc)})
                return
            self.send_error(404)

        def log_message(self, fmt: str, *args) -> None:
            pass

    class _ReusableThreadingHTTPServer(ThreadingHTTPServer):
        allow_reuse_address = os.name != 'nt'
        daemon_threads = True
        stop_with_windows = False

        def service_actions(self):
            if self.stop_with_windows and leases.expired():
                self.stop_with_windows = False
                threading.Thread(target=stop_server, daemon=True).start()

        def server_bind(self):
            if os.name == 'nt':
                self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            super().server_bind()

    server = _ReusableThreadingHTTPServer((host, port), Handler)
    updater_service.bind_server(server, port)
    return server


if __name__ == '__main__':
    port = int(os.environ.get('CHIP_PORT', '18765'))
    server = create_server('127.0.0.1', port)
    print(f'ChipScreener local server running at http://127.0.0.1:{port}/dashboard.html', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
