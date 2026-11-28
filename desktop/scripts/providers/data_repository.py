"""Read and validate versioned public market data without a disk cache."""

import csv
import gzip
import hashlib
import io
import json
import math
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict
from concurrent.futures import Future, TimeoutError as FutureTimeout
from datetime import date, datetime

from providers.verified_https import VerifiedHTTPS

DATASETS = ('tdcc', 'universe', 'daily', 'broker', 'volume-profile', 'calendar', 'corporate-actions')
REPOSITORY_OWNER = 'Jimmy0916-LAI'
CATALOG_REPOSITORY = 'chip-screener-data'
CATALOG_URL = f'https://raw.githubusercontent.com/{REPOSITORY_OWNER}/{CATALOG_REPOSITORY}/main/catalog.json'
MAX_DOCUMENT_BYTES = 4 * 1024 * 1024
MAX_SHARD_BYTES = 16 * 1024 * 1024
MAX_QUERY_BYTES = 24 * 1024 * 1024
MARKETS = {'TW', 'TWSE', 'TPEx', 'US'}
TDCC_URL = 'https://opendata.tdcc.com.tw/getOD.ashx?id=1-5'
TDCC_LICENSE_URL = 'https://data.gov.tw/dataset/11452'
IDENTIFIER = r'[A-Za-z0-9_.:-]{1,64}'
SHA256 = r'[0-9a-f]{64}'


class Unavailable(ValueError):
    """The requested shared data is unavailable or failed validation."""


def require(condition, message):
    if not condition:
        raise ValueError(message)


def day_key(value):
    require(isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', value), '日期須為 YYYY-MM-DD')
    return date.fromisoformat(value)


def aware_time(value):
    require(isinstance(value, str) and 'T' in value, '時間須包含日期及時區')
    stamp = datetime.fromisoformat(value)
    require(stamp.utcoffset() is not None, '時間須包含時區')
    return stamp


def months_between(start, end):
    month = start.replace(day=1)
    while month <= end:
        yield f'{month.year:04d}-{month.month:02d}'
        if (month.year, month.month) == (end.year, end.month):
            break
        month = date(month.year + 1, 1, 1) if month.month == 12 else date(month.year, month.month + 1, 1)


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def object_document(value, kind):
    require(isinstance(value, dict) and type(value.get('schema_version')) is int
            and value['schema_version'] == 1 and value.get('kind') == kind, f'{kind} schema 無效')
    return value


def data_url(repository, path):
    return f'https://raw.githubusercontent.com/{REPOSITORY_OWNER}/{repository}/main/{path}'


def validate_catalog(value):
    object_document(value, 'catalog')
    years = value.get('years')
    require(isinstance(years, dict), '年度目錄無效')
    for year, record in years.items():
        require(re.fullmatch(r'\d{4}', year) and isinstance(record, dict)
                and record.get('repository') == f'{CATALOG_REPOSITORY}-{year}'
                and record.get('manifest') == 'manifest.json', '年度資料庫路由無效')
    return years


def validate_year(value, year):
    object_document(value, 'year')
    require(value.get('year') == year and value.get('datasets') == list(DATASETS), '年度資料集無效')
    months = value.get('months')
    require(isinstance(months, dict), '月份索引目錄無效')
    for month, index in months.items():
        require(re.fullmatch(re.escape(year) + r'-(0[1-9]|1[0-2])', month) and isinstance(index, dict),
                '月份路由無效')
        digest = index.get('sha256')
        require(isinstance(digest, str) and re.fullmatch(SHA256, digest)
                and index.get('path') == f'indexes/{month}/{digest}.json'
                and type(index.get('bytes')) is int and 0 < index['bytes'] <= MAX_DOCUMENT_BYTES,
                '月份索引校驗資料無效')
    return months


def https_url(value):
    if not isinstance(value, str):
        return False
    parsed = urllib.parse.urlsplit(value)
    return parsed.scheme == 'https' and bool(parsed.hostname) and not parsed.username and not parsed.password


def entry_identity(entry):
    return tuple(entry[key] for key in ('dataset', 'market', 'instrument_id', 'code', 'date_from', 'date_to'))


def validate_entry(entry, month, dataset):
    require(isinstance(entry, dict) and entry.get('dataset') == dataset, '分片資料集無效')
    require(entry.get('market') in MARKETS, '市場代號無效')
    instrument = entry.get('instrument_id')
    code = entry.get('code')
    require((instrument is None and code is None)
            or (isinstance(instrument, str) and isinstance(code, str)
                and re.fullmatch(IDENTIFIER, instrument) and re.fullmatch(IDENTIFIER, code)), '分片證券代號無效')

    start, end = day_key(entry.get('date_from')), day_key(entry.get('date_to'))
    require(start <= end and all(day.strftime('%Y-%m') == month for day in (start, end)), '分片日期超出月份')
    require(all(key in entry for key in ('statistic_date', 'observed_at', 'published_at', 'retrieved_at')),
            '分片缺時點欄位')
    if entry['statistic_date'] is not None:
        statistic_day = day_key(entry['statistic_date'])
        require(start <= statistic_day <= end, '統計日超出分片日期')
    retrieved = aware_time(entry['retrieved_at'])
    for key in ('observed_at', 'published_at'):
        if entry[key] is not None:
            stamp = aware_time(entry[key])
            require(start <= stamp.date() and stamp <= retrieved, '分片可用時點不在合理區間')
    require(end <= retrieved.date(), '資料日期晚於取得日期')

    revision, version = entry.get('revision'), entry.get('data_version')
    require(type(revision) is int and revision >= 1 and isinstance(version, str)
            and re.fullmatch(IDENTIFIER, version), '分片修訂或版本無效')
    source = entry.get('source')
    require(isinstance(source, dict) and source.get('redistributable') is True
            and https_url(source.get('url')) and https_url(source.get('license_url'))
            and isinstance(source.get('license'), str) and bool(source['license'].strip()), '未確認可再散布授權')
    coverage = entry.get('coverage')
    require(isinstance(coverage, dict) and type(coverage.get('complete')) is bool
            and isinstance(coverage.get('missing'), list)
            and all(isinstance(reason, str) and reason for reason in coverage['missing'])
            and (not coverage['complete'] or not coverage['missing']), '分片涵蓋與缺漏無效')
    require(type(entry.get('row_count')) is int and entry['row_count'] >= 1, '分片筆數無效')
    require(all(isinstance(entry.get(key), str) and entry[key].strip() for key in ('unit', 'trading_scope')),
            '分片缺單位或交易範圍')

    asset = entry.get('asset')
    require(isinstance(asset, dict), '缺少分片資產')
    fmt, compression, digest = (asset.get(key) for key in ('format', 'compression', 'sha256'))
    require(fmt in ('csv', 'json') and compression in ('none', 'gzip') and isinstance(digest, str)
            and re.fullmatch(SHA256, digest) and type(asset.get('bytes')) is int
            and 0 < asset['bytes'] <= MAX_SHARD_BYTES, '分片格式、壓縮、大小或 SHA-256 無效')
    ext = f'.{fmt}' + ('.gz' if compression == 'gzip' else '')
    require(asset.get('path') == f'shards/{month}/{dataset}/{digest}{ext}', '分片位置無效')
    validation = entry.get('validation')
    require(isinstance(validation, dict) and validation.get('status') == 'passed'
            and isinstance(validation.get('method'), str) and bool(validation['method'].strip()), '分片未通過驗證')
    require(aware_time(validation.get('verified_at')) >= retrieved, '分片驗證時間早於取得時間')
    return entry


def validate_month(value, month):
    object_document(value, 'month')
    datasets = value.get('datasets')
    require(value.get('month') == month and isinstance(datasets, dict) and set(datasets) == set(DATASETS),
            '月份資料集無效')
    for dataset, entries in datasets.items():
        require(isinstance(entries, list), '月份分片列表無效')
        seen = set()
        for entry in entries:
            validate_entry(entry, month, dataset)
            key = (*entry_identity(entry), entry['revision'])
            require(key not in seen, '月份分片修訂重複')
            seen.add(key)
    return datasets


def verify_bytes(data, asset):
    if len(data) != asset['bytes'] or sha256(data) != asset['sha256']:
        raise Unavailable('資料大小或 SHA-256 不符')
    return data


def decode_shard(raw, entry):
    asset = entry['asset']
    verify_bytes(raw, asset)
    if asset['compression'] == 'gzip':
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
                raw = stream.read(MAX_SHARD_BYTES + 1)
        except (OSError, EOFError) as exc:
            raise ValueError('分片 gzip 壓縮損毀') from exc
    require(len(raw) <= MAX_SHARD_BYTES, '解壓後分片過大')
    return raw


DATASET_FIELDS = {
    'tdcc': {'code', 'level', 'holders', 'shares'},
    'universe': {'instrument_id', 'code', 'name'},
    'daily': {'code', 'open', 'high', 'low', 'close', 'volume'},
    'broker': {'code', 'broker_code', 'buy', 'sell'},
    'volume-profile': {'code', 'price', 'volume'},
    'calendar': {'is_trading_day'},
    'corporate-actions': {'code', 'action_type'},
}
TDCC_FIELDS = {'資料日期', '證券代號', '持股分級', '人數', '股數', '占集保庫存數比例%'}


def finite_number(value):
    try:
        return not isinstance(value, bool) and math.isfinite(float(value))
    except (TypeError, ValueError, OverflowError):
        return False


def reject_nonfinite(value):
    raise ValueError(f'非有限值 {value}')


def payload_rows(raw, entry):
    """Check shared payload rows and return the decoded rows."""
    text = raw.decode('utf-8-sig')
    if entry['asset']['format'] == 'json':
        rows = json.loads(text, parse_constant=reject_nonfinite)
    else:
        reader = csv.DictReader(io.StringIO(text), strict=True)
        require(reader.fieldnames and len(set(reader.fieldnames)) == len(reader.fieldnames), 'CSV 欄名缺失或重複')
        rows = list(reader)

    require(isinstance(rows, list) and len(rows) == entry['row_count'], '分片列數不符')
    dataset = entry['dataset']
    start, end = day_key(entry['date_from']), day_key(entry['date_to'])
    seen = set()
    for row in rows:
        require(isinstance(row, dict) and None not in row and None not in row.values(), '資料列欄位不完整')
        official_tdcc = dataset == 'tdcc' and TDCC_FIELDS.issubset(row)
        if official_tdcc:
            require(entry['source']['url'] == TDCC_URL and entry['source']['license_url'] == TDCC_LICENSE_URL,
                    '集保原檔來源或授權不是官方資料目錄')
            date_text, code = row['資料日期'], row['證券代號']
            require(isinstance(date_text, str) and re.fullmatch(r'\d{8}', date_text), '集保日期格式無效')
            day = day_key(f'{date_text[:4]}-{date_text[4:6]}-{date_text[6:]}')
            key = (day, code, int(row['持股分級']))
            require(1 <= key[2] <= 17 and str(row['人數']).isdigit() and str(row['股數']).isdigit(),
                    '集保級距、股數或戶數無效')
        else:
            require(DATASET_FIELDS[dataset].issubset(row), '缺少資料集必要欄位')
            day, code = day_key(row.get('date')), row.get('code')
            suffix = {
                'tdcc': 'level', 'broker': 'broker_code',
                'volume-profile': 'price', 'corporate-actions': 'action_type',
            }.get(dataset)
            key = (day, code, row.get(suffix))
            if dataset in ('tdcc', 'broker', 'volume-profile'):
                fields = {'tdcc': ('holders', 'shares'), 'broker': ('buy', 'sell'),
                          'volume-profile': ('volume',)}[dataset]
                require(all(str(row[field]).isdigit() for field in fields), '數量須為非負整數')
            if dataset == 'tdcc':
                require(str(row['level']).isdigit() and 1 <= int(row['level']) <= 17, '集保級距無效')
            if dataset == 'volume-profile':
                require(finite_number(row['price']) and float(row['price']) > 0, '交易價位無效')
            if dataset == 'daily':
                require(all(finite_number(row[field]) for field in ('open', 'high', 'low', 'close', 'volume')),
                        '日行情數字無效')
                o, h, l, c, vol = (float(row[field]) for field in ('open', 'high', 'low', 'close', 'volume'))
                require(0 < l <= min(o, c) <= max(o, c) <= h and vol >= 0, '日行情範圍無效')
        require(start <= day <= end and (entry['code'] is None or code == entry['code']), '資料列超出分片範圍')
        if entry['instrument_id'] is not None and 'instrument_id' in row:
            require(row['instrument_id'] == entry['instrument_id'], '資料列證券 ID 不符')
        require(key not in seen, '資料列鍵值重複')
        seen.add(key)
    return rows


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Unavailable('資料中心回應轉址')


class SharedDataClient:
    """Read-only catalog client with bounded memory and coalesced URL requests."""

    def __init__(self, *, download=None, cancel=None, timeout=4, ttl=180, max_entries=96,
                 max_bytes=32 * 1024 * 1024, clock=time.monotonic):
        self.cancel = cancel or threading.Event()
        self.timeout = timeout
        self.ttl = ttl
        self.max_entries = max_entries
        self.max_bytes = max_bytes
        self.clock = clock
        self.download = download or self.download_asset
        self._lock = threading.Lock()
        self._cache = OrderedDict()
        self._inflight = {}
        self._cached_bytes = 0

    def _check_cancel(self):
        if self.cancel.is_set():
            raise InterruptedError('資料查詢已取消')

    def download_asset(self, url, limit, deadline):
        self._check_cancel()
        request = urllib.request.Request(url, headers={'User-Agent': 'ChipScreener market data'})
        opener = urllib.request.build_opener(VerifiedHTTPS(), _NoRedirect)
        with opener.open(request, timeout=max(0.1, min(self.timeout, deadline - self.clock()))) as response:
            data = bytearray()
            while chunk := response.read1(min(65536, limit + 1 - len(data))):
                self._check_cancel()
                if self.clock() >= deadline:
                    raise Unavailable('資料查詢逾時')
                data.extend(chunk)
                if len(data) > limit:
                    raise Unavailable('資料中心回應過大')
            return bytes(data)

    def _cached_request(self, url, limit, deadline):
        self._check_cancel()
        with self._lock:
            cached = self._cache.pop(url, None)
            if cached:
                if cached[0] > self.clock():
                    self._cache[url] = cached
                    return cached[1].result()
                self._cached_bytes -= cached[2]
            future = self._inflight.get(url)
            owner = future is None
            if owner:
                future = self._inflight[url] = Future()

        if not owner:
            while self.clock() < deadline:
                self._check_cancel()
                try:
                    return future.result(timeout=min(0.1, max(0.01, deadline - self.clock())))
                except FutureTimeout:
                    continue
            raise Unavailable('等待資料查詢逾時')

        try:
            for attempt in range(2):
                self._check_cancel()
                if self.clock() >= deadline:
                    raise Unavailable('資料查詢逾時')
                try:
                    raw = self.download(url, limit, deadline)
                    require(isinstance(raw, bytes) and len(raw) <= limit, '資料中心回應大小無效')
                except urllib.error.HTTPError as exc:
                    if exc.code not in (429, 500, 502, 503, 504) or attempt:
                        raise Unavailable(f'資料中心 HTTP {exc.code}') from exc
                except OSError as exc:
                    self._check_cancel()
                    if attempt:
                        raise Unavailable('資料中心連線失敗') from exc
                else:
                    self._check_cancel()
                    future.set_result(raw)
                    self._remember(url, future, len(raw), self.ttl)
                    break
                self.cancel.wait(min(0.2, max(0, deadline - self.clock())))
        except Exception as exc:
            future.set_exception(exc)
            if isinstance(exc, (Unavailable, ValueError)):
                self._remember(url, future, 0, min(15, self.ttl))
        finally:
            with self._lock:
                del self._inflight[url]
        return future.result()

    def _remember(self, url, future, size, ttl):
        with self._lock:
            self._cache[url] = (self.clock() + ttl, future, size)
            self._cached_bytes += size
            while len(self._cache) > self.max_entries or self._cached_bytes > self.max_bytes:
                _, (_, _, size) = self._cache.popitem(last=False)
                self._cached_bytes -= size

    def _json(self, url, deadline, asset=None):
        raw = self._cached_request(url, MAX_DOCUMENT_BYTES, deadline)
        if asset:
            verify_bytes(raw, asset)
        return json.loads(raw)

    def read(self, dataset, start, end, *, market=None, instrument_id=None, code=None, as_of=None,
             skip_dates=()):
        require(dataset in DATASETS and (market is None or market in MARKETS), '資料集或市場無效')
        for value in (instrument_id, code):
            require(value is None or isinstance(value, str) and re.fullmatch(IDENTIFIER, value), '查詢證券代號無效')
        first, last = day_key(start), day_key(end)
        require(first <= last and (last - first).days <= 185, '共享資料每次可查 186 個日曆日')
        cutoff = aware_time(as_of) if as_of is not None else None
        deadline = self.clock() + 3 * self.timeout
        selected = {}
        skipped = set(skip_dates)
        try:
            years = validate_catalog(self._json(CATALOG_URL, deadline))
            manifests = {}
            for month in months_between(first, last):
                year = month[:4]
                if year not in years:
                    continue
                repo = years[year]['repository']
                if year not in manifests:
                    manifests[year] = validate_year(self._json(data_url(repo, years[year]['manifest']), deadline), year)
                index = manifests[year].get(month)
                if not index:
                    continue
                entries = validate_month(self._json(data_url(repo, index['path']), deadline, index), month)[dataset]
                for entry in entries:
                    if (entry['date_to'] < start or entry['date_from'] > end
                            or (entry['date_from'] == entry['date_to'] and entry['date_from'] in skipped)
                            or (market and entry['market'] != market)
                            or (code and entry['code'] not in (None, code))
                            or (instrument_id and entry['instrument_id'] not in (None, instrument_id))):
                        continue
                    known = entry['published_at'] or entry['observed_at']
                    if cutoff and (known is None or aware_time(known) > cutoff):
                        continue
                    key = entry_identity(entry)
                    if key not in selected or entry['revision'] > selected[key][0]['revision']:
                        selected[key] = (entry, repo)

            require(len(selected) <= 24, '分片過多，請縮短查詢日期或指定個股')
            size = 0
            result = []
            for entry, repo in sorted(selected.values(), key=lambda value: (value[0]['date_from'], value[0]['code'] or '')):
                asset = entry['asset']
                raw = self._cached_request(data_url(repo, asset['path']), asset['bytes'], deadline)
                decoded = decode_shard(raw, entry)
                size += len(decoded)
                require(size <= MAX_QUERY_BYTES, '資料查詢結果過大')
                # Metadata was validated at publication; recheck user-visible payload after the checksum.
                payload_rows(decoded, entry)
                result.append((entry, decoded))
            return result
        except (UnicodeError, KeyError, TypeError, ValueError, csv.Error) as exc:
            raise Unavailable(str(exc)) from exc
