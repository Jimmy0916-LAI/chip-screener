"""本機輕量級伺服器（純 Python 標準函式庫）
提供 build/dashboard.html 瀏覽與官方集保 (TDCC 1-5)／證交所交易日曆 (TWSE FMTQIK) 即時更新 API，
讓未安裝 Node.js / Electron 的 Windows 環境也能直接在瀏覽器中即時更新並保存集保週資料。
"""

import csv
import hashlib
import io
import json
import math
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DASHBOARD_FILE = ROOT / 'build' / 'dashboard.html'
FEED_BASE_FILE = ROOT / 'data' / 'feed-base.json'

import sys
if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
from providers.tw_market import TwMarketService
from providers.news_briefing import BriefingService

TDCC_URL = 'https://opendata.tdcc.com.tw/getOD.ashx?id=1-5'
TAIPEI_TZ = timezone(timedelta(hours=8))
MAX_RESPONSE_BYTES = 16 * 1024 * 1024
REQUEST_TIMEOUT_SEC = 40
REQUIRED_TDCC_FIELDS = ['資料日期', '證券代號', '持股分級', '人數', '股數', '占集保庫存數比例%']
BAND_START_LEVELS = (11, 12, 13, 15)
ETF_CODE_RE = re.compile(r'^00\d{2,4}[A-Z]?$')


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
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SEC) as resp:
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
    lines = text.splitlines()
    check(len(lines) > 1, '集保內容為空')

    fields = [s.strip() for s in lines[0].split(',')]
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
        values = line.split(',')
        check(len(values) == len(fields), '集保欄數錯誤')
        stamp, code, lv, holders_s, shares_s = (values[i].strip() for i in col_idx[:5])

        if day is None:
            check(bool(re.fullmatch(r'\d{8}', stamp)), '統計日期格式錯誤')
            day = parse_iso_day(f'{stamp[:4]}-{stamp[4:6]}-{stamp[6:8]}')
            weekday = date.fromisoformat(day).weekday()
            check(day <= fetched[:10] and weekday not in (5, 6), '未來或非營業日的統計日期')
        check(stamp == day.replace('-', ''), '同份集保檔混有不同日期')
        if code not in pool and not ETF_CODE_RE.fullmatch(code):
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
    def __init__(self, cache_dir: Path, base: dict):
        self.cache_dir = cache_dir
        self.base = base
        self.weeks: dict[str, dict] = {}
        self.months: dict[str, dict] = {}
        self.notes: list[str] = []
        self._lock = threading.Lock()
        self._load_cache()

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
        target = self._bucket_file(kind, key)
        target.parent.mkdir(parents=True, exist_ok=True)
        stage = target.with_suffix('.json.tmp')
        raw = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
        stage.write_text(raw, encoding='utf-8')
        os.replace(stage, target)

    def latest(self) -> str:
        return sorted([*self.base['hashes'].keys(), *self.weeks.keys()])[-1]

    def initial(self) -> dict:
        return {'weeks': self.weeks, 'months': self.months, 'notes': self.notes}

    def _check_week(self) -> tuple[dict | None, str]:
        raw_bytes = download_url(TDCC_URL)
        week = parse_week(raw_bytes, self.base['universe'], taipei_now())
        latest_day = self.latest()
        day = week['day']

        if day < latest_day:
            raise ValueError(f'忽略舊回應 {day}，已保存 {latest_day}')
        if day == latest_day:
            known_hash = (self.weeks.get(day, {}).get('quality', {}).get('sha256') or self.base['hashes'].get(day))
            if known_hash != week['quality']['sha256']:
                raise ValueError(f'{day} 同期內容變更，保留已驗證版本待核')
            # 若舊快取缺少 ETF extraRows，就地補齊並回傳給前端
            if day in self.weeks and 'extraRows' not in self.weeks[day]:
                self.weeks[day]['extraRows'] = week.get('extraRows', {})
                self.weeks[day]['adjustments'].update(week.get('adjustments', {}))
                self._atomic_save('official', day, self.weeks[day])
                return self.weeks[day], f'已是最新 {day}（已補齊 ETF 資料）'
            return None, f'已是最新 {day}'

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
            months: dict[str, dict] = {}
            errors: list[str] = []
            week = None
            message = ''

            try:
                week, message = self._check_week()
            except Exception as exc:
                errors.append('集保：' + str(exc))

            try:
                self._check_calendar(months)
            except Exception as exc:
                errors.append('交易日曆：' + str(exc))

            if len(errors) == 2 and all('連線失敗' in e for e in errors):
                status = '離線'
            elif len(errors) == 2:
                status = '失敗'
            elif errors:
                status = '部分成功'
            elif week:
                status = '有新資料'
            else:
                status = '已是最新'

            return {
                'weeks': {week['day']: week} if week else {},
                'months': months,
                'status': status,
                'message': '｜'.join(part for part in [message, *errors] if part),
                'checked': taipei_now(),
            }


class DailyService:
    """抓取並快取個股日 K 與發行股數（FinMind TaiwanStockPrice + TaiwanStockShareholding），供底峰研究模型使用。"""

    FINMIND_API = 'https://api.finmindtrade.com/api/v4/data'
    CACHE_TTL_SEC = 12 * 3600

    def __init__(self, cache_dir: Path, feed_service: LocalFeedService):
        self.cache_dir = cache_dir
        self.feed_service = feed_service
        self._lock = threading.Lock()

    def _fetch_finmind(self, dataset: str, code: str, start_date: str = '2024-01-01') -> list[dict]:
        qs = urllib.parse.urlencode({'dataset': dataset, 'data_id': code, 'start_date': start_date})
        raw = download_url(f'{self.FINMIND_API}?{qs}')
        payload = json.loads(raw.decode('utf-8'))
        if payload.get('status') != 200:
            raise ValueError(payload.get('msg') or f'FinMind 回應異常 ({payload.get("status")})')
        return payload.get('data', [])

    def _fallback_issued_shares(self, code: str) -> int:
        for day in sorted(self.feed_service.weeks.keys(), reverse=True):
            week = self.feed_service.weeks[day]
            row = week.get('rows', {}).get(code) or week.get('extraRows', {}).get(code)
            if row and row[0] > 0:
                return int(row[0])
        return 0

    def get_daily(self, code: str) -> dict:
        if not re.fullmatch(r'(?:\d{4}|00\d{2,4}[A-Z]?)', code):
            raise ValueError('請輸入有效四碼股票或 ETF 代號')

        cache_file = self.cache_dir / f'{code}.json'
        if cache_file.exists():
            try:
                age = time.time() - cache_file.stat().st_mtime
                if age < self.CACHE_TTL_SEC:
                    return json.loads(cache_file.read_text(encoding='utf-8'))
            except Exception:
                pass

        with self._lock:
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

            fallback_den = self._fallback_issued_shares(code)
            bars = []
            idx = 0
            last_issued = issued_by_date[0][1] if issued_by_date else fallback_den

            for p in prices:
                d = p.get('date', '')
                o = float(p.get('open') or 0)
                h = float(p.get('max') or 0)
                l = float(p.get('min') or 0)
                c = float(p.get('close') or 0)
                vol = int(p.get('Trading_Volume') or 0)

                while idx < len(issued_by_date) and issued_by_date[idx][0] <= d:
                    last_issued = issued_by_date[idx][1]
                    idx += 1

                issued = last_issued or fallback_den
                if l <= 0 or h < l or c <= 0 or o <= 0 or vol < 0 or issued <= 0:
                    continue
                turnover = vol / issued
                if turnover < 0 or turnover > 1:
                    continue
                bars.append([d, o, h, l, c, vol, issued, turnover, '', False])

            if not bars:
                raise ValueError(f'{code} 缺少有效日 K 或發行股數資料')

            result = {
                'code': code,
                'name': stock_name,
                'bars': bars,
                'source': 'FinMind (TaiwanStockPrice + TaiwanStockShareholding)',
                'fetched': taipei_now(),
            }
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            stage = cache_file.with_suffix('.json.tmp')
            stage.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
            os.replace(stage, cache_file)
            return result


def create_server(host: str = '127.0.0.1', port: int = 18765) -> ThreadingHTTPServer:
    base = json.loads(FEED_BASE_FILE.read_text(encoding='utf-8'))
    local_app_data = Path(os.environ.get('LOCALAPPDATA') or Path.home())
    service = LocalFeedService(local_app_data / 'ChipScreener' / 'tdcc-local-v1', base)
    daily_service = DailyService(local_app_data / 'ChipScreener' / 'daily-cache-v1', service)
    tw_market_service = TwMarketService(local_app_data / 'ChipScreener' / 'tw-detail-v1')
    stock_names = {}
    web_data_file = ROOT / 'data' / 'web_data.json'
    if web_data_file.exists():
        try:
            stock_names = json.loads(web_data_file.read_text(encoding='utf-8')).get('stocks', {})
        except Exception:
            pass
    briefing_service = BriefingService(local_app_data / 'ChipScreener', ROOT, stock_names)

    class Handler(BaseHTTPRequestHandler):
        def _send_json(self, code: int, payload: dict) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
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
                self._send_json(200, {'app': 'ChipScreener', 'status': 'ok', 'latest': service.latest()})
                return
            if parsed.path == '/api/official/read':
                self._send_json(200, service.initial())
                return
            if parsed.path == '/api/daily':
                params = urllib.parse.parse_qs(parsed.query)
                code = (params.get('code') or [''])[0].strip().upper()
                try:
                    self._send_json(200, daily_service.get_detail(code) if hasattr(daily_service, 'get_detail') else daily_service.get_daily(code))
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
            parsed = urllib.parse.urlsplit(self.path)
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
            self.send_error(404)

        def log_message(self, fmt: str, *args) -> None:
            pass

    return ThreadingHTTPServer((host, port), Handler)


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
