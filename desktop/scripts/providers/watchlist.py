"""股票收藏夾與自動分析服務
隔離儲存自訂收藏夾與持股估算設定至 %LOCALAPPDATA%\\ChipScreener\\user-v1\\watchlists.json（絕不寫入 Git），
並提供批次報價更新與整合 MA5/MA10/MA20/MA60、TDCC 大戶、三大法人、量價與融資融券之六大維度自動分析。
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
import urllib.parse
from crawler_pool import CrawlerPool
from datetime import datetime, timedelta, timezone
from pathlib import Path

from providers.news_briefing import _fetch_yahoo_quote, _http_get
from providers.us_market import US_UNIVERSE_MAP, UsMarketService

TAIPEI_TZ = timezone(timedelta(hours=8))
VALID_TW_CODE_RE = re.compile(r'^(?:\d{4}|00\d{2,4}[A-Z]?)$')
VALID_SYMBOL_RE = re.compile(r'^(?:\d{4}|00\d{2,4}[A-Z]?|[A-Z][A-Z0-9.-]{0,7})$')
US_NAME_FALLBACK = {sym: name for sym, (name, _) in US_UNIVERSE_MAP.items()}


def taipei_now() -> datetime:
    return datetime.now(TAIPEI_TZ)


def _compute_ma_last(values: list[float], period: int) -> float | None:
    if len(values) < period:
        return None
    return round(sum(values[-period:]) / period, 2)


def _pct_bias(price: float, ref: float | None) -> float | None:
    if not ref or ref <= 0:
        return None
    return round((price - ref) / ref * 100.0, 2)


class WatchlistService:
    def __init__(
        self,
        app_data_dir: Path,
        project_root: Path,
        tw_market_service,
        stock_names: dict | None = None,
        base_series: dict | None = None,
        feed_service=None,
    ):
        self.app_data_dir = app_data_dir
        self.project_root = project_root
        self.tw_market = tw_market_service
        self.stock_names = stock_names or {}
        self.base_series = base_series or {}
        self.feed_service = feed_service

        self.user_dir = app_data_dir / 'user-v1'
        self.watchlists_file = self.user_dir / 'watchlists.json'
        self.analysis_dir = app_data_dir / 'watchlist-analysis-v1'
        self.quotes_file = self.analysis_dir / 'quotes.json'
        self.latest_analysis_file = self.analysis_dir / 'latest.json'
        self._lock = threading.Lock()

    def _read_json(self, path: Path, default: dict) -> dict:
        if not path.exists():
            return dict(default)
        try:
            data = json.loads(path.read_text(encoding='utf-8'))
            return data if isinstance(data, dict) else dict(default)
        except Exception:
            return dict(default)

    def _write_json(self, path: Path, payload: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        stage = path.with_suffix('.json.tmp')
        stage.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
        os.replace(stage, path)

    def _stock_meta(self, code: str) -> tuple[str, str]:
        is_tw = bool(VALID_TW_CODE_RE.fullmatch(code))
        if is_tw:
            info = self.stock_names.get(code)
            if isinstance(info, list) and info:
                return str(info[0]), str(info[1] if len(info) > 1 else 'TWSE')
            return ('ETF' if code.startswith('00') else code), 'TWSE'
        return US_NAME_FALLBACK.get(code, code), 'US'

    def _normalize_store(self, raw: dict | None = None) -> dict:
        data = raw if isinstance(raw, dict) else self._read_json(self.watchlists_file, {})
        auto_enabled = bool(data.get('autoEnabled', True))

        raw_auto = data.get('autoStocks')
        auto_stocks: list[str] = []
        if isinstance(raw_auto, list):
            for s in raw_auto:
                sym = str(s or '').strip().upper()
                if VALID_SYMBOL_RE.fullmatch(sym) and sym not in auto_stocks:
                    auto_stocks.append(sym)

        raw_folders = data.get('folders')
        folders: list[dict] = []
        seen_ids: set[str] = set()
        if isinstance(raw_folders, list):
            for idx, f in enumerate(raw_folders):
                if not isinstance(f, dict):
                    continue
                fid = re.sub(r'[^A-Za-z0-9_-]', '', str(f.get('id') or f'wl_{idx + 1}')) or f'wl_{idx + 1}'
                while fid in seen_ids:
                    fid = f'{fid}_{len(seen_ids) + 1}'
                seen_ids.add(fid)
                fname = str(f.get('name') or '未命名收藏夾').strip()[:30] or '未命名收藏夾'
                items: list[dict] = []
                seen_codes: set[str] = set()
                for it in f.get('items') or []:
                    if not isinstance(it, dict):
                        continue
                    code = str(it.get('code') or '').strip().upper()
                    if not VALID_SYMBOL_RE.fullmatch(code) or code in seen_codes:
                        continue
                    seen_codes.add(code)
                    shares_raw = it.get('shares')
                    try:
                        shares = float(shares_raw) if shares_raw not in (None, '') else 0.0
                        if shares < 0:
                            shares = 0.0
                    except (TypeError, ValueError):
                        shares = 0.0
                    cost_raw = it.get('costPrice')
                    cost_price = None
                    if cost_raw not in (None, ''):
                        try:
                            cp = float(cost_raw)
                            if cp > 0:
                                cost_price = round(cp, 4)
                        except (TypeError, ValueError):
                            cost_price = None
                    items.append({
                        'code': code,
                        'shares': int(shares) if shares.is_integer() else round(shares, 4),
                        'costPrice': cost_price,
                        'showValuation': bool(it.get('showValuation', False)),
                        'addedAt': str(it.get('addedAt') or ''),
                    })
                folders.append({'id': fid, 'name': fname, 'items': items})

        if not folders:
            folders = [{'id': 'wl_default', 'name': '我的自選股', 'items': []}]

        return {
            'version': 1,
            'autoEnabled': auto_enabled,
            'folders': folders,
            'autoStocks': auto_stocks,
        }

    def _enrich_store(self, store: dict) -> dict:
        auto_set = set(store['autoStocks'])
        enriched_folders = []
        for f in store['folders']:
            e_items = []
            for it in f['items']:
                name, market = self._stock_meta(it['code'])
                e_items.append({
                    **it,
                    'name': name,
                    'market': market,
                    'inAuto': it['code'] in auto_set,
                })
            enriched_folders.append({'id': f['id'], 'name': f['name'], 'items': e_items})

        auto_meta = []
        for code in store['autoStocks']:
            name, market = self._stock_meta(code)
            auto_meta.append({'code': code, 'name': name, 'market': market})

        return {
            'version': 1,
            'autoEnabled': store['autoEnabled'],
            'folders': enriched_folders,
            'autoStocks': store['autoStocks'],
            'autoStockMeta': auto_meta,
            'storagePath': str(self.watchlists_file),
        }

    def get_quotes(self) -> dict:
        raw = self._read_json(self.quotes_file, {'quotes': {}, 'updatedAt': ''})
        return raw if isinstance(raw.get('quotes'), dict) else {'quotes': {}, 'updatedAt': ''}

    def get_latest_analysis(self) -> dict | None:
        if not self.latest_analysis_file.exists():
            return None
        try:
            data = json.loads(self.latest_analysis_file.read_text(encoding='utf-8'))
            return data if isinstance(data, dict) else None
        except Exception:
            return None

    def should_auto_run(self) -> bool:
        store = self._normalize_store()
        if not store['autoEnabled'] or not store['autoStocks']:
            return False
        now = taipei_now()
        if now.hour < 10:
            return False
        today = now.strftime('%Y-%m-%d')
        return not (self.analysis_dir / f'{today}.json').exists()

    def get_state(self) -> dict:
        store = self._normalize_store()
        quotes_doc = self.get_quotes()
        return {
            'config': self._enrich_store(store),
            'quotes': quotes_doc.get('quotes', {}),
            'quotesUpdatedAt': quotes_doc.get('updatedAt', ''),
            'analysis': self.get_latest_analysis(),
            'shouldAutoRun': self.should_auto_run(),
        }

    def _save_and_state(self, store: dict) -> dict:
        self._write_json(self.watchlists_file, store)
        return self.get_state()

    def create_folder(self, name: str) -> dict:
        clean = str(name or '').strip()[:30]
        if not clean:
            raise ValueError('收藏夾名稱不能為空')
        with self._lock:
            store = self._normalize_store()
            existing_ids = {f['id'] for f in store['folders']}
            idx = len(store['folders']) + 1
            fid = f'wl_{int(time.time())}_{idx}'
            while fid in existing_ids:
                idx += 1
                fid = f'wl_{int(time.time())}_{idx}'
            store['folders'].append({'id': fid, 'name': clean, 'items': []})
            return {**self._save_and_state(store), 'createdFolderId': fid}

    def rename_folder(self, folder_id: str, name: str) -> dict:
        clean = str(name or '').strip()[:30]
        if not clean:
            raise ValueError('收藏夾名稱不能為空')
        with self._lock:
            store = self._normalize_store()
            target = next((f for f in store['folders'] if f['id'] == folder_id), None)
            if not target:
                raise ValueError('找不到指定收藏夾')
            target['name'] = clean
            return self._save_and_state(store)

    def delete_folder(self, folder_id: str) -> dict:
        with self._lock:
            store = self._normalize_store()
            before = len(store['folders'])
            store['folders'] = [f for f in store['folders'] if f['id'] != folder_id]
            if len(store['folders']) == before:
                raise ValueError('找不到指定收藏夾')
            if not store['folders']:
                store['folders'] = [{'id': 'wl_default', 'name': '我的自選股', 'items': []}]
            return self._save_and_state(store)

    def add_stock(self, folder_id: str, code: str) -> dict:
        sym = str(code or '').strip().upper()
        if not VALID_SYMBOL_RE.fullmatch(sym):
            raise ValueError('請輸入有效台股或美股代號（如 2330、0050、NVDA）')
        with self._lock:
            store = self._normalize_store()
            target = next((f for f in store['folders'] if f['id'] == folder_id), None)
            if not target:
                raise ValueError('找不到指定收藏夾')
            if any(it['code'] == sym for it in target['items']):
                raise ValueError(f'{sym} 已在此收藏夾中')
            target['items'].append({
                'code': sym,
                'shares': 0,
                'costPrice': None,
                'showValuation': False,
                'addedAt': taipei_now().isoformat(timespec='seconds'),
            })
            self._write_json(self.watchlists_file, store)

        # 即時補捉單檔報價（不阻斷失敗）
        q = self._fetch_single_quote(sym)
        if q:
            quotes_doc = self.get_quotes()
            quotes_doc['quotes'][sym] = q
            quotes_doc['updatedAt'] = taipei_now().strftime('%Y-%m-%d %H:%M:%S')
            self._write_json(self.quotes_file, quotes_doc)

        return self.get_state()

    def update_item(self, folder_id: str, code: str, updates: dict) -> dict:
        sym = str(code or '').strip().upper()
        with self._lock:
            store = self._normalize_store()
            target = next((f for f in store['folders'] if f['id'] == folder_id), None)
            if not target:
                raise ValueError('找不到指定收藏夾')
            item = next((it for it in target['items'] if it['code'] == sym), None)
            if not item:
                raise ValueError(f'此收藏夾中找不到 {sym}')

            if 'showValuation' in updates:
                item['showValuation'] = bool(updates['showValuation'])
            if 'shares' in updates:
                raw_shares = updates['shares']
                if raw_shares in (None, ''):
                    item['shares'] = 0
                else:
                    val = float(raw_shares)
                    if val < 0:
                        raise ValueError('持有股數不能為負數')
                    item['shares'] = int(val) if val.is_integer() else round(val, 4)
            if 'costPrice' in updates:
                raw_cost = updates['costPrice']
                if raw_cost in (None, ''):
                    item['costPrice'] = None
                else:
                    cp = float(raw_cost)
                    if cp <= 0:
                        raise ValueError('購入價格須大於 0（不填可留空）')
                    item['costPrice'] = round(cp, 4)
            if 'autoAnalyze' in updates:
                want_auto = bool(updates['autoAnalyze'])
                if want_auto and sym not in store['autoStocks']:
                    store['autoStocks'].append(sym)
                elif not want_auto:
                    store['autoStocks'] = [c for c in store['autoStocks'] if c != sym]

            return self._save_and_state(store)

    def remove_item(self, folder_id: str, code: str) -> dict:
        sym = str(code or '').strip().upper()
        with self._lock:
            store = self._normalize_store()
            target = next((f for f in store['folders'] if f['id'] == folder_id), None)
            if not target:
                raise ValueError('找不到指定收藏夾')
            before = len(target['items'])
            target['items'] = [it for it in target['items'] if it['code'] != sym]
            if len(target['items']) == before:
                raise ValueError(f'此收藏夾中找不到 {sym}')
            return self._save_and_state(store)

    def toggle_auto_stock(self, code: str, enabled: bool) -> dict:
        sym = str(code or '').strip().upper()
        if not VALID_SYMBOL_RE.fullmatch(sym):
            raise ValueError('股票代號格式無效')
        with self._lock:
            store = self._normalize_store()
            if enabled:
                if sym not in store['autoStocks']:
                    store['autoStocks'].append(sym)
            else:
                store['autoStocks'] = [c for c in store['autoStocks'] if c != sym]
            return self._save_and_state(store)

    def set_auto_enabled(self, enabled: bool) -> dict:
        with self._lock:
            store = self._normalize_store()
            store['autoEnabled'] = bool(enabled)
            self._write_json(self.watchlists_file, store)
        from providers.news_briefing import BriefingService
        BriefingService(self.app_data_dir, self.project_root, self.stock_names).sync_shared_windows_task()
        return self.get_state()

    def _fetch_single_quote(self, code: str) -> dict | None:
        is_tw = bool(VALID_TW_CODE_RE.fullmatch(code))
        if is_tw:
            q = _fetch_yahoo_quote(f'{code}.TW') or _fetch_yahoo_quote(f'{code}.TWO')
        else:
            q = _fetch_yahoo_quote(code)
        if not q:
            return None
        name, market = self._stock_meta(code)
        return {
            'code': code,
            'name': name,
            'market': market,
            **q,
        }

    def refresh_quotes(self, codes: list[str] | None = None) -> dict:
        store = self._normalize_store()
        all_codes: list[str] = []
        if codes:
            for c in codes:
                s = str(c or '').strip().upper()
                if VALID_SYMBOL_RE.fullmatch(s) and s not in all_codes:
                    all_codes.append(s)
        else:
            for f in store['folders']:
                for it in f['items']:
                    if it['code'] not in all_codes:
                        all_codes.append(it['code'])
            for c in store['autoStocks']:
                if c not in all_codes:
                    all_codes.append(c)

        quotes_doc = self.get_quotes()
        quotes_map = dict(quotes_doc.get('quotes') or {})

        if all_codes:
            with CrawlerPool(max_workers=6) as pool:
                for sym, q in zip(all_codes, pool.map(self._fetch_single_quote, all_codes)):
                    if q:
                        quotes_map[sym] = q

        now_str = taipei_now().strftime('%Y-%m-%d %H:%M:%S')
        updated_doc = {'quotes': quotes_map, 'updatedAt': now_str}
        self._write_json(self.quotes_file, updated_doc)
        return self.get_state()

    def _latest_tdcc_series(self) -> list[tuple[str, dict]]:
        merged: dict[str, dict] = {}
        if isinstance(self.base_series, dict):
            for day, rows in self.base_series.items():
                if isinstance(rows, dict):
                    merged[day] = rows
        if self.feed_service and getattr(self.feed_service, 'weeks', None):
            for day, doc in self.feed_service.weeks.items():
                rows = dict(doc.get('rows') or {})
                rows.update(doc.get('extraRows') or {})
                merged[day] = rows
        else:
            official_dir = self.app_data_dir / 'tdcc-local-v1' / 'official'
            if official_dir.exists():
                for file in sorted(official_dir.glob('*.json')):
                    try:
                        doc = json.loads(file.read_text(encoding='utf-8'))
                        rows = dict(doc.get('rows') or {})
                        rows.update(doc.get('extraRows') or {})
                        merged[file.stem] = rows
                    except Exception:
                        continue
        return sorted(merged.items(), key=lambda x: x[0])

    def _compute_tdcc_dim(self, code: str, weeks: list[tuple[str, dict]]) -> dict:
        matched: list[tuple[str, list[int]]] = []
        for day, rows in weeks:
            row = rows.get(code)
            if isinstance(row, list) and len(row) >= 10 and row[0] > 0:
                matched.append((day, row))
        if len(matched) < 2:
            if len(matched) == 1:
                day, r = matched[-1]
                pct400 = round(100.0 * r[3] / r[0], 3)
                return {
                    'weekDay': day,
                    'pct400': pct400,
                    'deltaPp400': None,
                    'deltaShares400': None,
                    'deltaPp1000': None,
                    'status': '僅單週集保快照',
                    'tone': 'neutral',
                }
            return {
                'weekDay': '',
                'pct400': None,
                'deltaPp400': None,
                'deltaShares400': None,
                'deltaPp1000': None,
                'status': '無集保資料',
                'tone': 'neutral',
            }

        prev_day, prev_r = matched[-2]
        cur_day, cur_r = matched[-1]
        pct400_cur = 100.0 * cur_r[3] / cur_r[0]
        pct400_prev = 100.0 * prev_r[3] / prev_r[0]
        pct1000_cur = 100.0 * cur_r[5] / cur_r[0]
        pct1000_prev = 100.0 * prev_r[5] / prev_r[0]
        delta_pp_400 = round(pct400_cur - pct400_prev, 3)
        delta_shares_400 = int(cur_r[3] - prev_r[3])
        delta_pp_1000 = round(pct1000_cur - pct1000_prev, 3)

        if delta_pp_400 > 0.005:
            status, tone = '大戶買超', 'up'
        elif delta_pp_400 < -0.005:
            status, tone = '大戶賣超', 'down'
        else:
            status, tone = '大戶持平', 'neutral'

        return {
            'weekDay': cur_day,
            'prevDay': prev_day,
            'pct400': round(pct400_cur, 3),
            'deltaPp400': delta_pp_400,
            'deltaShares400': delta_shares_400,
            'deltaPp1000': delta_pp_1000,
            'status': status,
            'tone': tone,
        }

    def _fetch_us_bars(self, code: str) -> list[list]:
        encoded = urllib.parse.quote(code, safe='')
        url = f'https://query1.finance.yahoo.com/v8/finance/chart/{encoded}?range=6mo&interval=1d'
        try:
            payload = json.loads(_http_get(url, timeout=12).decode('utf-8'))
            res = payload['chart']['result'][0]
            ts_list = res.get('timestamp') or []
            q = (res.get('indicators', {}).get('quote') or [{}])[0]
            opens, highs, lows, closes, vols = (
                q.get('open') or [],
                q.get('high') or [],
                q.get('low') or [],
                q.get('close') or [],
                q.get('volume') or [],
            )
            bars = []
            for ts, o, h, l, c, v in zip(ts_list, opens, highs, lows, closes, vols):
                if None in (ts, o, h, l, c):
                    continue
                d = datetime.fromtimestamp(ts, TAIPEI_TZ).strftime('%Y-%m-%d')
                bars.append([d, float(o), float(h), float(l), float(c), int(v or 0)])
            return bars
        except Exception:
            return []

    def _analyze_one(self, code: str, weeks: list[tuple[str, dict]]) -> dict:
        is_tw = bool(VALID_TW_CODE_RE.fullmatch(code))
        name, market = self._stock_meta(code)
        detail = None
        err_msg = ''

        if not is_tw:
            try:
                us_svc = UsMarketService(self.app_data_dir / 'us-cache-v1')
                us_detail = us_svc.get_detail(code, force_refresh=True)
                tech = us_detail['tech']
                flags: list[str] = []
                if tech['belowMa5']:
                    flags.append('belowMa5')
                if tech['belowMa10']:
                    flags.append('belowMa10')
                if tech['overall'].get('divergenceAlert'):
                    flags.append('divergence')
                return {
                    'code': us_detail['code'],
                    'name': us_detail.get('name') or name,
                    'market': 'US',
                    'isTw': False,
                    'price': tech['price'],
                    'prevClose': tech['prevClose'],
                    'change': tech['change'],
                    'changePct': tech['changePct'],
                    'tradeDate': tech['tradeDate'],
                    'shortMa': tech['shortMa'],
                    'midMa': tech['midMa'],
                    'rsi': tech['rsi'],
                    'macd': tech['macd'],
                    'volume': tech['volume'],
                    'range52w': tech['range52w'],
                    'overall': tech['overall'],
                    'filterFlags': flags,
                }
            except Exception as exc:
                return {
                    'code': code,
                    'name': name,
                    'market': 'US',
                    'isTw': False,
                    'error': str(exc) or f'無法取得 {code} 美股日行情',
                    'price': None,
                    'change': None,
                    'changePct': None,
                    'filterFlags': [],
                }

        try:
            detail = self.tw_market.get_detail(code, force_refresh=True)
        except Exception as exc:
            err_msg = str(exc)

        if not detail or not detail.get('bars'):
            return {
                'code': code,
                'name': name,
                'market': market,
                'error': err_msg or '暫無行情資料',
                'price': None,
                'change': None,
                'changePct': None,
                'filterFlags': [],
            }

        bars = detail['bars']
        closes = [float(b[4]) for b in bars]
        vols = [int(b[5]) for b in bars]
        last = bars[-1]
        prev = bars[-2] if len(bars) >= 2 else last
        close = float(last[4])
        chg = round(close - float(prev[4]), 2)
        chg_pct = round((chg / float(prev[4]) * 100.0) if prev[4] else 0.0, 2)

        ma5 = _compute_ma_last(closes, 5)
        ma10 = _compute_ma_last(closes, 10)
        ma20 = _compute_ma_last(closes, 20)
        ma60 = _compute_ma_last(closes, 60)
        mv5 = _compute_ma_last([float(v) for v in vols], 5)

        bias5 = _pct_bias(close, ma5)
        bias10 = _pct_bias(close, ma10)
        bias20 = _pct_bias(close, ma20)
        bias60 = _pct_bias(close, ma60)

        below_ma5 = ma5 is not None and close < ma5
        below_ma10 = ma10 is not None and close < ma10

        if ma5 is None or ma10 is None:
            short_status, short_tone = '日K天數不足', 'neutral'
        elif not below_ma5 and not below_ma10:
            short_status, short_tone = '站上 5日 / 10日線', 'up'
        elif below_ma5 and below_ma10:
            short_status, short_tone = '低於 5日與 10日線', 'down'
        elif below_ma5:
            short_status, short_tone = '低於 5日線、守 10日線', 'neutral'
        else:
            short_status, short_tone = '站上 5日線、壓 10日線', 'neutral'

        if ma20 is None or ma60 is None:
            mid_status, mid_tone = '均線天數不足', 'neutral'
        elif close >= ma20 and close >= ma60:
            mid_status, mid_tone = '站穩月線與季線', 'up'
        elif close < ma20 and close < ma60:
            mid_status, mid_tone = '位於月季線之下', 'down'
        elif close >= ma60:
            mid_status, mid_tone = '月線下守季線', 'neutral'
        else:
            mid_status, mid_tone = '站月線壓季線', 'neutral'

        vol = int(last[5])
        vol_ratio = round(vol / mv5, 2) if mv5 and mv5 > 0 else 1.0
        if chg > 0 and vol_ratio >= 1.15:
            vol_status, vol_tone = f'價漲量增 ({vol_ratio:.2f}x)', 'up'
        elif chg < 0 and vol_ratio >= 1.2:
            vol_status, vol_tone = f'帶量回檔 ({vol_ratio:.2f}x)', 'down'
        elif vol_ratio < 0.75:
            vol_status, vol_tone = f'量縮整理 ({vol_ratio:.2f}x)', 'neutral'
        else:
            vol_status, vol_tone = f'量能溫和 ({vol_ratio:.2f}x)', 'neutral'

        # 維度3：TDCC 大戶
        if is_tw:
            tdcc_dim = self._compute_tdcc_dim(code, weeks)
        else:
            tdcc_dim = {
                'weekDay': '', 'pct400': None, 'deltaPp400': None,
                'deltaShares400': None, 'deltaPp1000': None,
                'status': '美股不適用台股集保', 'tone': 'neutral',
            }

        # 維度4：三大法人
        inst_rows = detail.get('inst') or []
        if is_tw and inst_rows:
            r5 = inst_rows[-5:]
            f5 = sum(int(r[1]) for r in r5)
            t5 = sum(int(r[2]) for r in r5)
            d5 = sum(int(r[3]) for r in r5)
            inst5 = f5 + t5 + d5
            last_inst = int(inst_rows[-1][1] + inst_rows[-1][2] + inst_rows[-1][3])
            inst_status = '法人買超' if inst5 > 0 else '法人賣超' if inst5 < 0 else '法人持平'
            inst_tone = 'up' if inst5 > 0 else 'down' if inst5 < 0 else 'neutral'
            inst_dim = {
                'lastDate': inst_rows[-1][0],
                'lastTotal': last_inst,
                'inst5Total': inst5,
                'foreign5': f5,
                'trust5': t5,
                'dealer5': d5,
                'status': inst_status,
                'tone': inst_tone,
            }
        else:
            inst_dim = {
                'lastDate': '', 'lastTotal': None, 'inst5Total': None,
                'foreign5': None, 'trust5': None, 'dealer5': None,
                'status': '美股無三大法人' if not is_tw else '無法人資料',
                'tone': 'neutral',
            }

        # 維度6：融資融券
        margin_rows = detail.get('margin') or []
        if is_tw and margin_rows:
            lm = margin_rows[-1]
            m5 = sum(int(r[2]) for r in margin_rows[-5:])
            s5 = sum(int(r[4]) for r in margin_rows[-5:])
            mb = int(lm[1])
            sb = int(lm[3])
            ratio = round((sb / mb * 100.0), 2) if mb > 0 else 0.0
            if m5 < 0 and chg >= 0:
                m_status, m_tone = '資減籌碼沉澱', 'up'
            elif m5 > 0 and chg < 0:
                m_status, m_tone = '跌勢資增須留意', 'down'
            else:
                m_status, m_tone = f'資{"增" if m5 >= 0 else "減"} {abs(m5):,} 張', 'neutral'
            margin_dim = {
                'lastDate': lm[0],
                'marginBal': mb,
                'margin5Delta': m5,
                'shortBal': sb,
                'short5Delta': s5,
                'shortMarginRatio': ratio,
                'status': m_status,
                'tone': m_tone,
            }
        else:
            margin_dim = {
                'lastDate': '', 'marginBal': None, 'margin5Delta': None,
                'shortBal': None, 'short5Delta': None, 'shortMarginRatio': None,
                'status': '美股無信用資料' if not is_tw else '無融資融券資料',
                'tone': 'neutral',
            }

        # 綜合訊號與背離標籤
        short_bull = ma5 is not None and ma10 is not None and not below_ma5 and not below_ma10
        short_weak = below_ma5 or below_ma10
        chip_bull = tdcc_dim['tone'] == 'up' or inst_dim['tone'] == 'up'
        chip_bear = tdcc_dim['tone'] == 'down' or inst_dim['tone'] == 'down'

        divergence_alert = ''
        if short_weak and chip_bull:
            overall_label, overall_tone = '價弱籌碼有撐（低檔承接）', 'neutral'
            divergence_alert = '底背離留意：股價破短均但大戶／法人仍買超'
            summary = '短線股價低於 5 日或 10 日線，惟集保大戶或三大法人維持偏多買超，具低檔承接觀察價值。'
        elif short_bull and chip_bear and tdcc_dim['tone'] != 'up' and inst_dim['tone'] != 'up':
            overall_label, overall_tone = '價強籌碼背離（留意調節）', 'neutral'
            divergence_alert = '高檔背離警戒：股價站短均但大戶與法人同步賣超'
            summary = '股價站穩短均線之上，但大戶與法人呈調節賣超，追價宜留意量價與籌碼延續性。'
        elif short_bull and chip_bull:
            overall_label, overall_tone = '價強籌碼穩（偏多結構）', 'up'
            summary = '股價站上 5 日與 10 日均線且獲大戶或法人買盤支撐，多方格局一致。'
        elif not is_tw and short_bull:
            overall_label, overall_tone = '美股短多均線強勢', 'up'
            summary = '收盤站上 5 日與 10 日均線，短中期趨勢偏多。'
        else:
            overall_label, overall_tone = '均線承壓（偏弱觀察）', 'down'
            summary = '股價低於短期均線且籌碼動能偏保守，宜待站回 5 日／10 日線或法人轉買。'

        flags: list[str] = []
        if below_ma5:
            flags.append('belowMa5')
        if below_ma10:
            flags.append('belowMa10')
        if tdcc_dim['tone'] == 'up':
            flags.append('tdccBuy')
        elif tdcc_dim['tone'] == 'down':
            flags.append('tdccSell')
        if inst_dim['tone'] == 'up':
            flags.append('instBuy')
        elif inst_dim['tone'] == 'down':
            flags.append('instSell')
        if divergence_alert:
            flags.append('divergence')

        return {
            'code': code,
            'name': name,
            'market': market,
            'isTw': is_tw,
            'price': round(close, 2),
            'prevClose': round(float(prev[4]), 2),
            'change': chg,
            'changePct': chg_pct,
            'tradeDate': last[0],
            'shortMa': {
                'ma5': ma5, 'ma10': ma10, 'bias5Pct': bias5, 'bias10Pct': bias10,
                'belowMa5': below_ma5, 'belowMa10': below_ma10,
                'status': short_status, 'tone': short_tone,
            },
            'midMa': {
                'ma20': ma20, 'ma60': ma60, 'bias20Pct': bias20, 'bias60Pct': bias60,
                'status': mid_status, 'tone': mid_tone,
            },
            'tdcc': tdcc_dim,
            'inst': inst_dim,
            'volume': {'vol': vol, 'mv5': round(mv5, 0) if mv5 else None, 'volRatio': vol_ratio, 'status': vol_status, 'tone': vol_tone},
            'margin': margin_dim,
            'overall': {'label': overall_label, 'tone': overall_tone, 'summary': summary, 'divergenceAlert': divergence_alert},
            'filterFlags': flags,
        }

    def run_auto_analysis(self, trigger: str = '手動立即更新分析') -> dict:
        store = self._normalize_store()
        now = taipei_now()
        today = now.strftime('%Y-%m-%d')
        auto_codes = store['autoStocks']
        weeks = self._latest_tdcc_series()

        items: list[dict] = []
        if auto_codes:
            with CrawlerPool(max_workers=4) as pool:
                items = list(pool.map(lambda c: self._analyze_one(c, weeks), auto_codes))

        # 順便同步寫入最新收盤價快取（若未有盤中報價則補齊）
        quotes_doc = self.get_quotes()
        quotes_map = dict(quotes_doc.get('quotes') or {})
        for it in items:
            if it.get('price') is not None:
                quotes_map[it['code']] = {
                    'code': it['code'],
                    'name': it['name'],
                    'market': it['market'],
                    'price': it['price'],
                    'prevClose': it['prevClose'],
                    'change': it['change'],
                    'changePct': it['changePct'],
                    'tradeTime': it['tradeDate'],
                }
        if items:
            self._write_json(self.quotes_file, {'quotes': quotes_map, 'updatedAt': now.strftime('%Y-%m-%d %H:%M:%S')})

        counts = {
            'total': len(items),
            'belowMa5': sum('belowMa5' in (x.get('filterFlags') or []) for x in items),
            'belowMa10': sum('belowMa10' in (x.get('filterFlags') or []) for x in items),
            'tdccBuy': sum('tdccBuy' in (x.get('filterFlags') or []) for x in items),
            'tdccSell': sum('tdccSell' in (x.get('filterFlags') or []) for x in items),
            'instBuy': sum('instBuy' in (x.get('filterFlags') or []) for x in items),
            'instSell': sum('instSell' in (x.get('filterFlags') or []) for x in items),
            'divergence': sum('divergence' in (x.get('filterFlags') or []) for x in items),
        }

        report = {
            'date': today,
            'generatedAt': now.strftime('%Y-%m-%d %H:%M:%S +08:00'),
            'trigger': trigger,
            'counts': counts,
            'items': items,
        }
        self.analysis_dir.mkdir(parents=True, exist_ok=True)
        self._write_json(self.latest_analysis_file, report)
        self._write_json(self.analysis_dir / f'{today}.json', report)
        return self.get_state()
