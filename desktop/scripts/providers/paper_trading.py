"""模擬操盤核心引擎（純 Python 3.10 標準函式庫）
功能：
- 多存檔隔離儲存於 %LOCALAPPDATA%\\ChipScreener\\paper-trading-v1\\（絕不寫入專案目錄）
- 支援 TW（純台股 TWD）、US（純美股 USD）、MIXED（台美股混合，以 TWD 統一換算淨值與即時 USD/TWD 匯率）
- 真實台股（整張／零股、手續費折數與最低手續費、股票 0.3% / ETF 0.1% 證交稅）與美股（碎股、自訂費率）費稅計算
- 市價即時撮合（盤後／休市自動標示 simulatedAfterHours）與條件掛單（LIMIT / STOP_LOSS / TAKE_PROFIT）自動評估觸發
- 提供 AI 操盤手決策日誌、半自動提案審批與每日排程狀態查詢介面
"""

from __future__ import annotations

import json
import math
import os
import re
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from providers.live_quotes import LiveQuoteService, fetch_yahoo_chart_lite
from providers.secret_store import get_gemini_key_meta

TAIPEI_TZ = timezone(timedelta(hours=8))

TW_CODE_RE = re.compile(r'^(?:\d{4}|00\d{2,4}[A-Z]?)$')
US_CODE_RE = re.compile(r'^[A-Z][A-Z0-9-]{0,7}$')
SLOT_ID_RE = re.compile(r'^[A-Za-z0-9_-]{1,64}$')

DEFAULT_FX_USD_TWD = 32.5
FX_CACHE_TTL_SEC = 1800  # 30 分鐘快取

VALID_MARKETS = ('TW', 'US', 'MIXED')
VALID_MODES = ('manual', 'ai')
VALID_AUTONOMY = ('semi', 'full')
VALID_STYLES = ('conservative', 'balanced', 'aggressive')
VALID_SCHEDULE_MODES = ('manual', 'daily', 'intraday')
VALID_SIDES = ('BUY', 'SELL')
VALID_ORDER_TYPES = ('MARKET', 'LIMIT', 'STOP_LOSS', 'TAKE_PROFIT')

DEFAULT_FEES: dict[str, float] = {
    'twBuyFeeRate': 0.001425,
    'twSellFeeRate': 0.001425,
    'twFeeDiscount': 1.0,
    'twMinFee': 20.0,
    'twStockTaxRate': 0.003,
    'twEtfTaxRate': 0.001,
    'usFeeRate': 0.0,
    'usMinFee': 0.0,
}

DEFAULT_AI_TOOLS: dict[str, bool] = {
    'tdccScreener': True,
    'twDetail': True,
    'usScreener': True,
    'briefing': True,
    'watchlist': True,
    'channels': True,
    'liveQuotes': True,
    'portfolio': True,
}

DEFAULT_AI_GUARDRAILS: dict[str, float | int] = {
    'maxSingleStockPct': 25.0,
    'maxPositions': 8,
    'minCashFloorPct': 15.0,
    'defaultStopLossPct': 8.0,
    'defaultTakeProfitPct': 18.0,
}

DEFAULT_AI_CONFIG: dict = {
    'autonomy': 'semi',
    'style': 'balanced',
    'customPrompt': '',
    'scheduleMode': 'manual',
    'cooldownMinutes': 60,
    'tools': dict(DEFAULT_AI_TOOLS),
    'guardrails': dict(DEFAULT_AI_GUARDRAILS),
}

STYLE_GUARDRAIL_PRESETS: dict[str, dict[str, float | int]] = {
    'conservative': {
        'maxSingleStockPct': 15.0,
        'maxPositions': 10,
        'minCashFloorPct': 30.0,
        'defaultStopLossPct': 6.0,
        'defaultTakeProfitPct': 12.0,
    },
    'balanced': dict(DEFAULT_AI_GUARDRAILS),
    'aggressive': {
        'maxSingleStockPct': 35.0,
        'maxPositions': 6,
        'minCashFloorPct': 5.0,
        'defaultStopLossPct': 10.0,
        'defaultTakeProfitPct': 25.0,
    },
}

MAX_EQUITY_HISTORY = 365
MAX_AI_LOGS = 50
MAX_AI_PROPOSALS = 30
MAX_CLOSED_ORDERS = 200


def _taipei_now() -> str:
    return datetime.now(TAIPEI_TZ).isoformat(timespec='seconds')


def _taipei_today() -> str:
    return datetime.now(TAIPEI_TZ).strftime('%Y-%m-%d')


def _atomic_write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    stage = path.with_suffix('.json.tmp')
    stage.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(stage, path)


def _read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _to_float(val, field_name: str, *, allow_none: bool = False) -> float | None:
    if val is None or val == '':
        if allow_none:
            return None
        raise ValueError(f'{field_name} 不能為空')
    try:
        num = float(val)
    except (TypeError, ValueError) as exc:
        raise ValueError(f'{field_name} 必須為有效數字') from exc
    if not math.isfinite(num):
        raise ValueError(f'{field_name} 數值無效')
    return num


def normalize_code(raw: str) -> str:
    code = str(raw or '').strip().upper()
    if not code:
        raise ValueError('請輸入股票代號')
    return code


def classify_symbol_market(code: str) -> str:
    sym = normalize_code(code)
    if TW_CODE_RE.fullmatch(sym):
        return 'TW'
    if US_CODE_RE.fullmatch(sym):
        return 'US'
    raise ValueError(f'無效的股票代號：{sym}（台股請輸入 4 碼或 ETF 代號，美股請輸入英文 Ticker）')


def validate_symbol_for_slot(code: str, slot_market: str) -> tuple[str, str]:
    sym = normalize_code(code)
    sym_market = classify_symbol_market(sym)
    mkt = str(slot_market or 'TW').strip().upper()
    if mkt == 'TW' and sym_market != 'TW':
        raise ValueError(f'此存檔限定台股（TW），不可交易美股標的 {sym}')
    if mkt == 'US' and sym_market != 'US':
        raise ValueError(f'此存檔限定美股（US），不可交易台股標的 {sym}')
    return sym, sym_market


def validate_shares(raw_shares, sym_market: str) -> float | int:
    num = _to_float(raw_shares, '股數')
    assert num is not None
    if num <= 0:
        raise ValueError('股數必須大於 0')
    if sym_market == 'TW':
        rounded = round(num)
        if abs(num - rounded) > 1e-6 or rounded < 1:
            raise ValueError('台股股數必須為正整數（整張請輸入 1000 的倍數，零股請輸入 1~999 股）')
        return int(rounded)
    rounded_us = round(num, 4)
    if rounded_us < 0.0001:
        raise ValueError('美股股數最小單位為 0.0001 股')
    return rounded_us


def _merge_fees(base: dict | None, updates: dict | None) -> dict[str, float]:
    out = dict(DEFAULT_FEES)
    if isinstance(base, dict):
        for k in DEFAULT_FEES:
            if k in base:
                v = _to_float(base[k], k, allow_none=True)
                if v is not None and v >= 0:
                    out[k] = v
    if isinstance(updates, dict):
        for k in DEFAULT_FEES:
            if k not in updates:
                continue
            v = _to_float(updates[k], k)
            assert v is not None
            if v < 0:
                raise ValueError(f'費率設定 {k} 不可小於 0')
            if k.endswith('Rate') and v > 0.2:
                raise ValueError(f'費率設定 {k} 超過合理上限（20%）')
            if k == 'twFeeDiscount' and v > 5.0:
                raise ValueError('手續費折數超過合理上限')
            out[k] = round(v, 6)
    return out


def _merge_ai_config(base: dict | None, updates: dict | None) -> dict:
    cur = {
        'autonomy': DEFAULT_AI_CONFIG['autonomy'],
        'style': DEFAULT_AI_CONFIG['style'],
        'customPrompt': DEFAULT_AI_CONFIG['customPrompt'],
        'scheduleMode': DEFAULT_AI_CONFIG['scheduleMode'],
        'cooldownMinutes': DEFAULT_AI_CONFIG['cooldownMinutes'],
        'tools': dict(DEFAULT_AI_TOOLS),
        'guardrails': dict(DEFAULT_AI_GUARDRAILS),
    }

    for src in (base, updates):
        if not isinstance(src, dict):
            continue
        if 'autonomy' in src and src['autonomy'] is not None:
            val = str(src['autonomy']).strip().lower()
            if val not in VALID_AUTONOMY:
                raise ValueError(f'無效的 AI 自治等級：{val}')
            cur['autonomy'] = val
        if 'style' in src and src['style'] is not None:
            val = str(src['style']).strip().lower()
            if val not in VALID_STYLES:
                raise ValueError(f'無效的 AI 投資風格：{val}')
            cur['style'] = val
        if 'customPrompt' in src and src['customPrompt'] is not None:
            cur['customPrompt'] = str(src['customPrompt']).strip()[:2000]
        if 'scheduleMode' in src and src['scheduleMode'] is not None:
            val = str(src['scheduleMode']).strip().lower()
            if val not in VALID_SCHEDULE_MODES:
                raise ValueError(f'無效的 AI 排程模式：{val}')
            cur['scheduleMode'] = val
        if 'cooldownMinutes' in src and src['cooldownMinutes'] is not None:
            cd = _to_float(src['cooldownMinutes'], 'cooldownMinutes')
            assert cd is not None
            cd_int = int(round(cd))
            if cd_int < 0 or cd_int > 1440:
                raise ValueError('冷卻時間必須介於 0 到 1440 分鐘')
            cur['cooldownMinutes'] = cd_int
        if isinstance(src.get('tools'), dict):
            for tk in DEFAULT_AI_TOOLS:
                if tk in src['tools']:
                    cur['tools'][tk] = bool(src['tools'][tk])
        if isinstance(src.get('guardrails'), dict):
            gr = src['guardrails']
            if 'maxSingleStockPct' in gr and gr['maxSingleStockPct'] is not None:
                v = _to_float(gr['maxSingleStockPct'], 'maxSingleStockPct')
                assert v is not None
                if not (1.0 <= v <= 100.0):
                    raise ValueError('單一標的持股上限須介於 1% 至 100%')
                cur['guardrails']['maxSingleStockPct'] = round(v, 2)
            if 'maxPositions' in gr and gr['maxPositions'] is not None:
                v = _to_float(gr['maxPositions'], 'maxPositions')
                assert v is not None
                iv = int(round(v))
                if not (1 <= iv <= 100):
                    raise ValueError('最大同時持股檔數須介於 1 至 100')
                cur['guardrails']['maxPositions'] = iv
            if 'minCashFloorPct' in gr and gr['minCashFloorPct'] is not None:
                v = _to_float(gr['minCashFloorPct'], 'minCashFloorPct')
                assert v is not None
                if not (0.0 <= v <= 95.0):
                    raise ValueError('最低現金保留比例須介於 0% 至 95%')
                cur['guardrails']['minCashFloorPct'] = round(v, 2)
            if 'defaultStopLossPct' in gr and gr['defaultStopLossPct'] is not None:
                v = _to_float(gr['defaultStopLossPct'], 'defaultStopLossPct')
                assert v is not None
                if not (0.0 <= v <= 90.0):
                    raise ValueError('預設停損比例須介於 0% 至 90%')
                cur['guardrails']['defaultStopLossPct'] = round(v, 2)
            if 'defaultTakeProfitPct' in gr and gr['defaultTakeProfitPct'] is not None:
                v = _to_float(gr['defaultTakeProfitPct'], 'defaultTakeProfitPct')
                assert v is not None
                if not (0.0 <= v <= 500.0):
                    raise ValueError('預設停利比例須介於 0% 至 500%')
                cur['guardrails']['defaultTakeProfitPct'] = round(v, 2)
    return cur


def calculate_fees_and_tax(
    code: str,
    sym_market: str,
    side: str,
    shares: float,
    price: float,
    fees: dict,
) -> tuple[float, float, float]:
    """回傳原幣別 (gross, fee, tax)。"""
    gross = float(shares) * float(price)
    if sym_market == 'TW':
        if side == 'BUY':
            rate = float(fees.get('twBuyFeeRate', DEFAULT_FEES['twBuyFeeRate']))
            discount = float(fees.get('twFeeDiscount', DEFAULT_FEES['twFeeDiscount']))
            min_fee = float(fees.get('twMinFee', DEFAULT_FEES['twMinFee']))
            fee = 0.0 if rate <= 0 else max(min_fee, gross * rate * discount)
            tax = 0.0
        else:
            rate = float(fees.get('twSellFeeRate', DEFAULT_FEES['twSellFeeRate']))
            discount = float(fees.get('twFeeDiscount', DEFAULT_FEES['twFeeDiscount']))
            min_fee = float(fees.get('twMinFee', DEFAULT_FEES['twMinFee']))
            fee = 0.0 if rate <= 0 else max(min_fee, gross * rate * discount)
            is_etf = code.startswith('00')
            tax_rate = float(
                fees.get('twEtfTaxRate', DEFAULT_FEES['twEtfTaxRate'])
                if is_etf
                else fees.get('twStockTaxRate', DEFAULT_FEES['twStockTaxRate'])
            )
            tax = 0.0 if tax_rate <= 0 else gross * tax_rate
    else:
        rate = float(fees.get('usFeeRate', DEFAULT_FEES['usFeeRate']))
        min_fee = float(fees.get('usMinFee', DEFAULT_FEES['usMinFee']))
        fee = 0.0 if (rate <= 0 and min_fee <= 0) else max(min_fee, gross * rate)
        tax = 0.0
    return round(gross, 4), round(fee, 4), round(tax, 4)


def compute_slot_metrics(slot: dict, fx_rate: float = DEFAULT_FX_USD_TWD) -> dict:
    """計算帳戶總淨值、損益、勝率、最大回撤與加值持倉清單（統一換算為存檔記帳幣別）。"""
    slot_currency = str(slot.get('currency') or ('USD' if slot.get('market') == 'US' else 'TWD'))
    initial_capital = float(slot.get('initialCapital') or 0.0)
    cash = round(float(slot.get('cash') or 0.0), 2)
    positions_map = slot.get('positions') if isinstance(slot.get('positions'), dict) else {}

    raw_positions: list[dict] = []
    for code, pos in positions_map.items():
        if not isinstance(pos, dict):
            continue
        shares = float(pos.get('shares') or 0.0)
        if shares <= 0:
            continue
        avg_cost = float(pos.get('avgCost') or 0.0)
        last_price = float(pos.get('lastPrice') or avg_cost)
        cost_ccy = str(pos.get('costCurrency') or ('USD' if pos.get('market') == 'US' else 'TWD'))
        pos_fx = float(fx_rate) if (cost_ccy == 'USD' and slot_currency == 'TWD') else 1.0

        market_value = round(shares * last_price * pos_fx, 2)
        cost_basis = round(shares * avg_cost * pos_fx, 2)
        unrealized_pnl = round(market_value - cost_basis, 2)
        unrealized_pnl_pct = round(((last_price - avg_cost) / avg_cost) * 100.0, 2) if avg_cost > 0 else 0.0

        raw_positions.append({
            'code': str(pos.get('code') or code),
            'name': str(pos.get('name') or code),
            'market': str(pos.get('market') or ('US' if cost_ccy == 'USD' else 'TW')),
            'shares': int(shares) if pos.get('market') == 'TW' and abs(shares - round(shares)) < 1e-6 else round(shares, 4),
            'avgCost': round(avg_cost, 4),
            'costCurrency': cost_ccy,
            'openedAt': str(pos.get('openedAt') or ''),
            'lastPrice': round(last_price, 4),
            'lastPriceAt': str(pos.get('lastPriceAt') or ''),
            'currentPrice': round(last_price, 4),
            'fxRate': round(pos_fx, 4),
            'marketValue': market_value,
            'costBasis': cost_basis,
            'unrealizedPnl': unrealized_pnl,
            'unrealizedPnlPct': unrealized_pnl_pct,
            'weightPct': 0.0,
        })

    market_value_total = round(sum(p['marketValue'] for p in raw_positions), 2)
    total_equity = round(cash + market_value_total, 2)

    for p in raw_positions:
        p['weightPct'] = round((p['marketValue'] / total_equity) * 100.0, 2) if total_equity > 0 else 0.0
    raw_positions.sort(key=lambda x: x['marketValue'], reverse=True)

    cash_pct = round((cash / total_equity) * 100.0, 2) if total_equity > 0 else 0.0
    invested_pct = round((market_value_total / total_equity) * 100.0, 2) if total_equity > 0 else 0.0
    unrealized_pnl_total = round(sum(p['unrealizedPnl'] for p in raw_positions), 2)

    trades = slot.get('trades') if isinstance(slot.get('trades'), list) else []
    closed_trades = [t for t in trades if isinstance(t, dict) and t.get('side') == 'SELL' and t.get('realizedPnl') is not None]
    closed_trade_count = len(closed_trades)
    realized_pnl_total = round(sum(float(t['realizedPnl']) for t in closed_trades), 2)
    win_count = sum(1 for t in closed_trades if float(t['realizedPnl']) > 0)
    win_rate_pct = round((win_count / closed_trade_count) * 100.0, 2) if closed_trade_count > 0 else 0.0

    total_pnl = round(total_equity - initial_capital, 2)
    total_return_pct = round((total_pnl / initial_capital) * 100.0, 2) if initial_capital > 0 else 0.0

    # 最大回撤（含初始本金、歷史淨值點與當前總資產）
    eq_points: list[float] = []
    if initial_capital > 0:
        eq_points.append(initial_capital)
    for pt in (slot.get('equityHistory') or []):
        if isinstance(pt, dict) and pt.get('equity') is not None:
            try:
                eq_points.append(float(pt['equity']))
            except (TypeError, ValueError):
                pass
    eq_points.append(total_equity)

    peak = 0.0
    max_dd = 0.0
    for eq in eq_points:
        if eq > peak:
            peak = eq
        if peak > 0:
            dd = (peak - eq) / peak * 100.0
            if dd > max_dd:
                max_dd = dd

    return {
        'totalEquity': total_equity,
        'marketValue': market_value_total,
        'cash': cash,
        'cashPct': cash_pct,
        'investedPct': invested_pct,
        'unrealizedPnl': unrealized_pnl_total,
        'realizedPnl': realized_pnl_total,
        'totalPnl': total_pnl,
        'totalReturnPct': total_return_pct,
        'winRatePct': win_rate_pct,
        'closedTradeCount': closed_trade_count,
        'maxDrawdownPct': round(max_dd, 2),
        'positionsList': raw_positions,
    }


def has_any_daily_ai_slot_in_dir(app_data_dir: Path) -> bool:
    """輕量檢查指定 app_data_dir 下是否存在任一每日自動排程 AI 存檔（供排程同步共用）。"""
    slots_dir = Path(app_data_dir) / 'paper-trading-v1' / 'slots'
    if not slots_dir.exists():
        return False
    for file in slots_dir.glob('*.json'):
        doc = _read_json(file)
        if doc.get('mode') == 'ai' and (doc.get('aiConfig') or {}).get('scheduleMode') == 'daily':
            return True
    return False


class PaperTradingService:
    def __init__(
        self,
        app_data_dir: Path,
        project_root: Path | None = None,
        live_quote_service: LiveQuoteService | None = None,
        stock_names: dict | None = None,
    ):
        self.app_data_dir = Path(app_data_dir)
        self.project_root = Path(project_root) if project_root else Path(__file__).resolve().parent.parent.parent
        self.root_dir = self.app_data_dir / 'paper-trading-v1'
        self.slots_dir = self.root_dir / 'slots'
        self.index_file = self.root_dir / 'index.json'
        self.stock_names = stock_names or {}
        self.live_quote_service = live_quote_service or LiveQuoteService(stock_names=self.stock_names)
        self._us_names = self._load_us_name_map()
        self._fx_cache: tuple[float, float] | None = None
        self._lock = threading.RLock()

    def _load_us_name_map(self) -> dict[str, str]:
        names = {
            'TSM': '台積電 ADR', 'NVDA': 'NVIDIA', 'AAPL': 'Apple', 'MSFT': 'Microsoft',
            'GOOGL': 'Alphabet', 'AMZN': 'Amazon', 'META': 'Meta', 'TSLA': 'Tesla',
            'AMD': 'AMD', 'AVGO': 'Broadcom', 'JPM': 'JPMorgan', 'GS': 'Goldman Sachs',
            'BRK-B': 'Berkshire Hathaway', 'SPY': 'S&P 500 ETF', 'QQQ': 'Nasdaq 100 ETF',
            'SOXX': 'iShares 半導體 ETF', 'VOO': 'Vanguard S&P 500 ETF',
        }
        sp_file = self.project_root / 'data' / 'sp500_universe.json'
        if sp_file.exists():
            try:
                doc = json.loads(sp_file.read_text(encoding='utf-8'))
                for item in doc.get('items') or []:
                    code = str(item.get('code') or '').strip().upper()
                    disp = str(item.get('name') or item.get('enName') or code).strip()
                    if code:
                        names.setdefault(code, disp)
            except Exception:
                pass
        return names

    def resolve_symbol_name(self, code: str, sym_market: str) -> str:
        if sym_market == 'TW':
            info = self.stock_names.get(code)
            if isinstance(info, (list, tuple)) and info:
                return str(info[0])
            if isinstance(info, str) and info:
                return info
            return code
        return self._us_names.get(code, code)

    def _slot_path(self, slot_id: str) -> Path:
        sid = str(slot_id or '').strip()
        if not SLOT_ID_RE.fullmatch(sid):
            raise ValueError(f'無效的存檔編號：{slot_id}')
        return self.slots_dir / f'{sid}.json'

    def _read_index(self) -> dict:
        doc = _read_json(self.index_file)
        slots = doc.get('slots') if isinstance(doc.get('slots'), list) else []
        valid_slots = [s for s in slots if isinstance(s, dict) and SLOT_ID_RE.fullmatch(str(s.get('id') or ''))]
        active_id = str(doc.get('activeSlotId') or '')
        if active_id and not any(s['id'] == active_id for s in valid_slots):
            active_id = valid_slots[0]['id'] if valid_slots else ''
        elif not active_id and valid_slots:
            active_id = valid_slots[0]['id']
        return {
            'version': 1,
            'activeSlotId': active_id,
            'slots': valid_slots,
        }

    def _write_index(self, index_doc: dict) -> None:
        _atomic_write_json(self.index_file, index_doc)

    def _normalize_slot(self, doc: dict) -> dict:
        market = str(doc.get('market') or 'TW').strip().upper()
        if market not in VALID_MARKETS:
            market = 'TW'
        currency = 'USD' if market == 'US' else 'TWD'
        mode = str(doc.get('mode') or 'manual').strip().lower()
        if mode not in VALID_MODES:
            mode = 'manual'
        init_cap = float(doc.get('initialCapital') or (100000.0 if market == 'US' else 1000000.0))
        cash = float(doc.get('cash') if doc.get('cash') is not None else init_cap)

        return {
            'id': str(doc.get('id') or ''),
            'name': str(doc.get('name') or '未命名存檔'),
            'market': market,
            'currency': currency,
            'initialCapital': round(init_cap, 2),
            'cash': round(cash, 2),
            'mode': mode,
            'createdAt': str(doc.get('createdAt') or _taipei_now()),
            'updatedAt': str(doc.get('updatedAt') or _taipei_now()),
            'lastAiRunAt': str(doc.get('lastAiRunAt') or ''),
            'fees': _merge_fees(doc.get('fees'), None),
            'aiConfig': _merge_ai_config(doc.get('aiConfig'), None),
            'positions': doc.get('positions') if isinstance(doc.get('positions'), dict) else {},
            'orders': doc.get('orders') if isinstance(doc.get('orders'), list) else [],
            'trades': doc.get('trades') if isinstance(doc.get('trades'), list) else [],
            'equityHistory': doc.get('equityHistory') if isinstance(doc.get('equityHistory'), list) else [],
            'aiProposals': doc.get('aiProposals') if isinstance(doc.get('aiProposals'), list) else [],
            'aiLogs': doc.get('aiLogs') if isinstance(doc.get('aiLogs'), list) else [],
        }

    def load_slot(self, slot_id: str) -> dict:
        with self._lock:
            path = self._slot_path(slot_id)
            if not path.exists():
                raise ValueError(f'找不到模擬存檔：{slot_id}')
            doc = _read_json(path)
            if not doc or not doc.get('id'):
                raise ValueError(f'模擬存檔損毀或無效：{slot_id}')
            return self._normalize_slot(doc)

    def _save_slot(self, slot: dict, set_active: bool = False) -> None:
        slot['updatedAt'] = _taipei_now()
        _atomic_write_json(self._slot_path(slot['id']), slot)

        idx = self._read_index()
        meta = {
            'id': slot['id'],
            'name': slot['name'],
            'market': slot['market'],
            'currency': slot['currency'],
            'mode': slot['mode'],
            'createdAt': slot['createdAt'],
            'updatedAt': slot['updatedAt'],
        }
        replaced = False
        for i, item in enumerate(idx['slots']):
            if item.get('id') == slot['id']:
                idx['slots'][i] = meta
                replaced = True
                break
        if not replaced:
            idx['slots'].append(meta)
        if set_active or not idx['activeSlotId']:
            idx['activeSlotId'] = slot['id']
        self._write_index(idx)

    def _record_equity_point(self, slot: dict, fx_rate: float) -> dict:
        metrics = compute_slot_metrics(slot, fx_rate)
        today = _taipei_today()
        point = {
            'date': today,
            'equity': metrics['totalEquity'],
            'cash': metrics['cash'],
            'marketValue': metrics['marketValue'],
        }
        hist = slot.setdefault('equityHistory', [])
        if hist and isinstance(hist[-1], dict) and hist[-1].get('date') == today:
            hist[-1] = point
        else:
            hist.append(point)
        if len(hist) > MAX_EQUITY_HISTORY:
            slot['equityHistory'] = hist[-MAX_EQUITY_HISTORY:]
        return metrics

    def get_fx_usd_twd(self, force: bool = False) -> float:
        now = time.time()
        with self._lock:
            if not force and self._fx_cache and (now - self._fx_cache[0]) < FX_CACHE_TTL_SEC:
                return self._fx_cache[1]

        fetched = fetch_yahoo_chart_lite('TWD=X')
        rate: float | None = None
        if fetched and fetched.get('price') is not None:
            try:
                val = float(fetched['price'])
                if 15.0 <= val <= 60.0:
                    rate = round(val, 4)
            except (TypeError, ValueError):
                rate = None

        with self._lock:
            if rate is not None:
                self._fx_cache = (time.time(), rate)
                return rate
            if self._fx_cache:
                return self._fx_cache[1]
            return DEFAULT_FX_USD_TWD

    def is_market_open(self, sym_market: str, quote: dict | None = None) -> bool:
        if sym_market == 'TW':
            st = self.live_quote_service.evaluate_tw_market(probe_live=False)
        else:
            st = self.live_quote_service.evaluate_us_market(probe_live=False)
        if not st.get('isOpen'):
            return False
        m_state = str((quote or {}).get('marketState') or '').strip().upper()
        if m_state and m_state != 'REGULAR':
            return False
        return True

    def get_quote(self, code: str) -> dict:
        sym = normalize_code(code)
        sym_market = classify_symbol_market(sym)
        q = self.live_quote_service._fetch_one(sym)
        if not q or q.get('price') is None:
            raise ValueError(f'無法取得 {sym} 最新報價，請確認代號是否正確或稍後再試')
        price = float(q['price'])
        if not math.isfinite(price) or price <= 0:
            raise ValueError(f'{sym} 報價異常（{price}）')
        is_open = self.is_market_open(sym_market, q)
        return {
            'code': sym,
            'name': self.resolve_symbol_name(sym, sym_market),
            'market': sym_market,
            'exchange': str(q.get('market') or ('TWSE' if sym_market == 'TW' else 'US')),
            'price': round(price, 4 if sym_market == 'US' else 2),
            'prevClose': q.get('prevClose'),
            'change': q.get('change', 0.0),
            'changePct': q.get('changePct', 0.0),
            'currency': 'TWD' if sym_market == 'TW' else 'USD',
            'marketState': str(q.get('marketState') or 'CLOSED'),
            'isMarketOpen': is_open,
            'tradeTime': str(q.get('tradeTime') or ''),
        }

    def list_slots_summary(self, fx_rate: float | None = None) -> list[dict]:
        with self._lock:
            idx = self._read_index()
            has_mixed = any(s.get('market') == 'MIXED' for s in idx['slots'])
            fx = fx_rate if fx_rate is not None else (self.get_fx_usd_twd() if has_mixed else DEFAULT_FX_USD_TWD)
            summaries: list[dict] = []
            for entry in idx['slots']:
                sid = entry['id']
                try:
                    slot = self.load_slot(sid)
                except ValueError:
                    continue
                m = compute_slot_metrics(slot, fx)
                ai_cfg = slot.get('aiConfig') or {}
                summaries.append({
                    'id': slot['id'],
                    'name': slot['name'],
                    'market': slot['market'],
                    'currency': slot['currency'],
                    'mode': slot['mode'],
                    'initialCapital': slot['initialCapital'],
                    'totalEquity': m['totalEquity'],
                    'totalReturnPct': m['totalReturnPct'],
                    'realizedPnl': m['realizedPnl'],
                    'unrealizedPnl': m['unrealizedPnl'],
                    'cash': m['cash'],
                    'cashPct': m['cashPct'],
                    'positionCount': len(m['positionsList']),
                    'winRatePct': m['winRatePct'],
                    'maxDrawdownPct': m['maxDrawdownPct'],
                    'scheduleMode': ai_cfg.get('scheduleMode', 'manual'),
                    'autonomy': ai_cfg.get('autonomy', 'semi'),
                    'aiConfig': ai_cfg,
                    'createdAt': slot['createdAt'],
                    'updatedAt': slot['updatedAt'],
                })
            return summaries

    def _enrich_slot_for_response(self, slot: dict, fx_rate: float) -> dict:
        m = compute_slot_metrics(slot, fx_rate)
        positions_list = m.pop('positionsList')
        enriched = dict(slot)
        enriched['positionsList'] = positions_list
        enriched['metrics'] = m
        return enriched

    def get_state(self, slot_id: str | None = None, refresh_quotes: bool = False) -> dict:
        with self._lock:
            idx = self._read_index()
            target_id = str(slot_id or '').strip()
            if target_id:
                # 驗證存在並記錄為 activeSlotId
                self.load_slot(target_id)
                if idx['activeSlotId'] != target_id:
                    idx['activeSlotId'] = target_id
                    self._write_index(idx)
            else:
                target_id = idx['activeSlotId']

            slot_obj = None
            if target_id:
                try:
                    slot_obj = self.load_slot(target_id)
                except ValueError:
                    slot_obj = None

            need_fx = refresh_quotes or (slot_obj is not None and slot_obj.get('market') == 'MIXED') or any(
                s.get('market') == 'MIXED' for s in idx['slots']
            )
            fx_rate = self.get_fx_usd_twd(force=refresh_quotes) if need_fx else (
                self._fx_cache[1] if self._fx_cache else DEFAULT_FX_USD_TWD
            )

            if refresh_quotes and slot_obj is not None:
                self.evaluate_orders(slot_obj['id'])
                slot_obj = self.load_slot(slot_obj['id'])

            summaries = self.list_slots_summary(fx_rate=fx_rate)
            enriched_slot = self._enrich_slot_for_response(slot_obj, fx_rate) if slot_obj is not None else None
            ai_meta = get_gemini_key_meta(self.app_data_dir)
            return {
                'activeSlotId': slot_obj['id'] if slot_obj else '',
                'fxUsdTwd': fx_rate,
                'hasGeminiKey': ai_meta['hasGeminiKey'],
                'geminiKeyHint': ai_meta['geminiKeyHint'],
                'secretStorageMode': ai_meta['secretStorageMode'],
                'slots': summaries,
                'slot': enriched_slot,
            }

    def create_slot(self, body: dict) -> dict:
        if not isinstance(body, dict):
            raise ValueError('請求格式無效')
        name = str(body.get('name') or '').strip()
        if not name:
            raise ValueError('請輸入存檔名稱')
        name = name[:40]

        market = str(body.get('market') or 'TW').strip().upper()
        if market not in VALID_MARKETS:
            raise ValueError(f'無效的市場設定：{market}（僅支援 TW / US / MIXED）')
        currency = 'USD' if market == 'US' else 'TWD'

        default_cap = 100000.0 if market == 'US' else 1000000.0
        init_cap = _to_float(body.get('initialCapital', default_cap), '初始本金')
        assert init_cap is not None
        if init_cap <= 0 or init_cap > 1e12:
            raise ValueError('初始本金必須大於 0 且不超過 1 兆')
        init_cap = round(init_cap, 2)

        mode = str(body.get('mode') or 'manual').strip().lower()
        if mode not in VALID_MODES:
            raise ValueError(f'無效的操作模式：{mode}（僅支援 manual / ai）')

        fees = _merge_fees(DEFAULT_FEES, body.get('fees'))
        ai_cfg_input = body.get('aiConfig') if isinstance(body.get('aiConfig'), dict) else {}
        base_ai = dict(DEFAULT_AI_CONFIG)
        # 若指定風格且未覆寫護欄，套用對應風格預設護欄
        style_hint = str(ai_cfg_input.get('style') or '').strip().lower()
        if style_hint in STYLE_GUARDRAIL_PRESETS and 'guardrails' not in ai_cfg_input:
            base_ai = {**DEFAULT_AI_CONFIG, 'guardrails': dict(STYLE_GUARDRAIL_PRESETS[style_hint])}
        ai_config = _merge_ai_config(base_ai, ai_cfg_input)

        now = _taipei_now()
        slot_id = f'slot_{uuid.uuid4().hex[:10]}'
        slot = {
            'id': slot_id,
            'name': name,
            'market': market,
            'currency': currency,
            'initialCapital': init_cap,
            'cash': init_cap,
            'mode': mode,
            'createdAt': now,
            'updatedAt': now,
            'lastAiRunAt': '',
            'fees': fees,
            'aiConfig': ai_config,
            'positions': {},
            'orders': [],
            'trades': [],
            'equityHistory': [
                {'date': _taipei_today(), 'equity': init_cap, 'cash': init_cap, 'marketValue': 0.0},
            ],
            'aiProposals': [],
            'aiLogs': [],
        }

        with self._lock:
            self._save_slot(slot, set_active=True)
            return self.get_state(slot_id=slot_id)

    def update_slot(self, slot_id: str, body: dict) -> dict:
        if not isinstance(body, dict):
            raise ValueError('請求格式無效')
        with self._lock:
            slot = self.load_slot(slot_id)
            if 'name' in body and body['name'] is not None:
                name = str(body['name']).strip()
                if not name:
                    raise ValueError('存檔名稱不能為空')
                slot['name'] = name[:40]
            if 'mode' in body and body['mode'] is not None:
                mode = str(body['mode']).strip().lower()
                if mode not in VALID_MODES:
                    raise ValueError(f'無效的操作模式：{mode}')
                slot['mode'] = mode
            if 'fees' in body and isinstance(body['fees'], dict):
                slot['fees'] = _merge_fees(slot['fees'], body['fees'])
            if 'aiConfig' in body and isinstance(body['aiConfig'], dict):
                slot['aiConfig'] = _merge_ai_config(slot['aiConfig'], body['aiConfig'])
            self._save_slot(slot)
            return self.get_state(slot_id=slot_id)

    def reset_slot(self, slot_id: str, initial_capital: float | None = None) -> dict:
        with self._lock:
            slot = self.load_slot(slot_id)
            if initial_capital is not None and initial_capital != '':
                cap = _to_float(initial_capital, '初始本金')
                assert cap is not None
                if cap <= 0 or cap > 1e12:
                    raise ValueError('初始本金必須大於 0 且不超過 1 兆')
                slot['initialCapital'] = round(cap, 2)
            cap_val = slot['initialCapital']
            slot['cash'] = cap_val
            slot['positions'] = {}
            slot['orders'] = []
            slot['trades'] = []
            slot['aiProposals'] = []
            slot['aiLogs'] = []
            slot['lastAiRunAt'] = ''
            slot['equityHistory'] = [
                {'date': _taipei_today(), 'equity': cap_val, 'cash': cap_val, 'marketValue': 0.0},
            ]
            self._save_slot(slot)
            return self.get_state(slot_id=slot_id)

    def delete_slot(self, slot_id: str) -> dict:
        with self._lock:
            path = self._slot_path(slot_id)
            if not path.exists():
                raise ValueError(f'找不到模擬存檔：{slot_id}')
            path.unlink(missing_ok=True)
            idx = self._read_index()
            idx['slots'] = [s for s in idx['slots'] if s.get('id') != slot_id]
            if idx['activeSlotId'] == slot_id:
                idx['activeSlotId'] = idx['slots'][0]['id'] if idx['slots'] else ''
            self._write_index(idx)
            return self.get_state()

    def _cancel_sibling_sl_tp(self, slot: dict, code: str, exclude_order_id: str = '') -> None:
        for order in slot.get('orders') or []:
            if (
                order.get('id') != exclude_order_id
                and order.get('code') == code
                and order.get('status') == 'PENDING'
                and order.get('orderType') in ('STOP_LOSS', 'TAKE_PROFIT')
            ):
                order['status'] = 'CANCELLED'

    def _trim_closed_orders(self, slot: dict) -> None:
        orders = slot.get('orders') or []
        pending = [o for o in orders if o.get('status') == 'PENDING']
        closed = [o for o in orders if o.get('status') != 'PENDING']
        if len(closed) > MAX_CLOSED_ORDERS:
            closed = closed[:MAX_CLOSED_ORDERS]
        slot['orders'] = pending + closed

    def _execute_trade_on_slot(
        self,
        slot: dict,
        *,
        code: str,
        name: str,
        sym_market: str,
        side: str,
        order_type: str,
        shares: float | int,
        price: float,
        is_market_open: bool,
        fx_rate: float,
        source: str,
        note: str,
        stop_loss_pct: float | None = None,
        take_profit_pct: float | None = None,
        exclude_order_id: str = '',
    ) -> tuple[dict, list[dict]]:
        """在已鎖定的 slot dict 上原子執行一筆買賣成交，回傳 (trade, auto_orders)。"""
        slot_currency = slot['currency']
        price_currency = 'TWD' if sym_market == 'TW' else 'USD'
        eff_fx = fx_rate if (price_currency == 'USD' and slot_currency == 'TWD') else 1.0

        gross_native, fee_native, tax_native = calculate_fees_and_tax(
            code, sym_market, side, float(shares), price, slot['fees']
        )
        gross_base = round(gross_native * eff_fx, 2)
        fee_base = round(fee_native * eff_fx, 2)
        tax_base = round(tax_native * eff_fx, 2)

        now_iso = _taipei_now()
        auto_orders: list[dict] = []
        realized_pnl: float | None = None

        if side == 'BUY':
            net_base = round(gross_base + fee_base + tax_base, 2)
            if slot['cash'] + 1e-6 < net_base:
                raise ValueError(
                    f"可用現金不足：需 {net_base:,.2f} {slot_currency}（含手續費 {fee_base:,.2f}），目前現金 {slot['cash']:,.2f} {slot_currency}"
                )
            slot['cash'] = round(max(0.0, slot['cash'] - net_base), 2)

            pos = slot['positions'].get(code)
            if pos:
                old_shares = float(pos['shares'])
                old_avg = float(pos['avgCost'])
                new_shares = old_shares + float(shares)
                new_avg = ((old_shares * old_avg) + (float(shares) * price)) / new_shares
                pos['shares'] = int(round(new_shares)) if sym_market == 'TW' else round(new_shares, 4)
                pos['avgCost'] = round(new_avg, 4)
                pos['lastPrice'] = round(price, 4 if sym_market == 'US' else 2)
                pos['lastPriceAt'] = now_iso
                if name:
                    pos['name'] = name
            else:
                slot['positions'][code] = {
                    'code': code,
                    'name': name,
                    'market': sym_market,
                    'shares': int(shares) if sym_market == 'TW' else round(float(shares), 4),
                    'avgCost': round(price, 4),
                    'costCurrency': price_currency,
                    'openedAt': now_iso,
                    'lastPrice': round(price, 4 if sym_market == 'US' else 2),
                    'lastPriceAt': now_iso,
                }

            # 自動掛載停損／停利條件單
            precision = 4 if sym_market == 'US' else 2
            if stop_loss_pct and stop_loss_pct > 0:
                sl_trigger = round(price * (1.0 - stop_loss_pct / 100.0), precision)
                if sl_trigger > 0:
                    sl_order = {
                        'id': f'ord_{uuid.uuid4().hex[:10]}',
                        'code': code,
                        'name': name,
                        'market': sym_market,
                        'side': 'SELL',
                        'orderType': 'STOP_LOSS',
                        'shares': int(shares) if sym_market == 'TW' else round(float(shares), 4),
                        'triggerPrice': sl_trigger,
                        'status': 'PENDING',
                        'createdAt': now_iso,
                        'triggeredAt': '',
                        'source': 'auto_guardrail',
                        'note': f'自動停損 (-{stop_loss_pct:g}%)',
                    }
                    slot['orders'].insert(0, sl_order)
                    auto_orders.append(sl_order)

            if take_profit_pct and take_profit_pct > 0:
                tp_trigger = round(price * (1.0 + take_profit_pct / 100.0), precision)
                if tp_trigger > 0:
                    tp_order = {
                        'id': f'ord_{uuid.uuid4().hex[:10]}',
                        'code': code,
                        'name': name,
                        'market': sym_market,
                        'side': 'SELL',
                        'orderType': 'TAKE_PROFIT',
                        'shares': int(shares) if sym_market == 'TW' else round(float(shares), 4),
                        'triggerPrice': tp_trigger,
                        'status': 'PENDING',
                        'createdAt': now_iso,
                        'triggeredAt': '',
                        'source': 'auto_guardrail',
                        'note': f'自動停利 (+{take_profit_pct:g}%)',
                    }
                    slot['orders'].insert(0, tp_order)
                    auto_orders.append(tp_order)
        else:
            pos = slot['positions'].get(code)
            if not pos or float(pos.get('shares') or 0) <= 0:
                raise ValueError(f'目前未持有 {code}，無法賣出')
            held_shares = float(pos['shares'])
            sell_shares = float(shares)
            if sell_shares > held_shares + 1e-6:
                raise ValueError(f'持股不足：{code} 目前僅持有 {held_shares:g} 股，無法賣出 {sell_shares:g} 股')
            if abs(held_shares - sell_shares) <= 1e-6:
                sell_shares = held_shares
                shares = int(round(held_shares)) if sym_market == 'TW' else round(held_shares, 4)

            net_base = round(gross_base - fee_base - tax_base, 2)
            cost_base = round(sell_shares * float(pos['avgCost']) * eff_fx, 2)
            realized_pnl = round(net_base - cost_base, 2)

            slot['cash'] = round(slot['cash'] + net_base, 2)
            remaining = held_shares - sell_shares
            if remaining <= 1e-6:
                slot['positions'].pop(code, None)
                self._cancel_sibling_sl_tp(slot, code, exclude_order_id=exclude_order_id)
            else:
                pos['shares'] = int(round(remaining)) if sym_market == 'TW' else round(remaining, 4)
                pos['lastPrice'] = round(price, 4 if sym_market == 'US' else 2)
                pos['lastPriceAt'] = now_iso

        trade = {
            'id': f'trd_{uuid.uuid4().hex[:10]}',
            'timestamp': now_iso,
            'code': code,
            'name': name,
            'market': sym_market,
            'side': side,
            'orderType': order_type,
            'shares': int(shares) if sym_market == 'TW' else round(float(shares), 4),
            'price': round(price, 4 if sym_market == 'US' else 2),
            'priceCurrency': price_currency,
            'fxRate': round(eff_fx, 4),
            'grossAmount': gross_base,
            'fee': fee_base,
            'tax': tax_base,
            'netAmount': net_base,
            'realizedPnl': realized_pnl,
            'simulatedAfterHours': not bool(is_market_open),
            'source': source,
            'note': str(note or '').strip()[:200],
        }
        slot['trades'].insert(0, trade)
        self._trim_closed_orders(slot)
        self._record_equity_point(slot, fx_rate)
        return trade, auto_orders

    def place_order(self, slot_id: str, body: dict, source: str = 'manual') -> dict:
        if not isinstance(body, dict):
            raise ValueError('下單參數格式無效')
        side = str(body.get('side') or '').strip().upper()
        if side not in VALID_SIDES:
            raise ValueError('買賣方向僅支援 BUY 或 SELL')
        order_type = str(body.get('orderType') or 'MARKET').strip().upper()
        if order_type not in VALID_ORDER_TYPES:
            raise ValueError(f'無效的委託類型：{order_type}')
        if order_type in ('STOP_LOSS', 'TAKE_PROFIT') and side != 'SELL':
            raise ValueError('停損單（STOP_LOSS）與停利單（TAKE_PROFIT）僅支援賣出（SELL）')

        sl_pct = _to_float(body.get('stopLossPct'), '停損百分比', allow_none=True)
        tp_pct = _to_float(body.get('takeProfitPct'), '停利百分比', allow_none=True)
        if sl_pct is not None and (sl_pct < 0 or sl_pct >= 100):
            raise ValueError('停損百分比須介於 0 至 99.9 之間')
        if tp_pct is not None and (tp_pct < 0 or tp_pct > 1000):
            raise ValueError('停利百分比須介於 0 至 1000 之間')
        note = str(body.get('note') or '').strip()[:200]

        with self._lock:
            slot = self.load_slot(slot_id)
            code, sym_market = validate_symbol_for_slot(str(body.get('code') or ''), slot['market'])
            shares = validate_shares(body.get('shares'), sym_market)
            name = self.resolve_symbol_name(code, sym_market)

            if order_type == 'MARKET':
                quote = self.get_quote(code)
                name = quote.get('name') or name
                fx_rate = self.get_fx_usd_twd() if (sym_market == 'US' and slot['currency'] == 'TWD') else 1.0
                trade, auto_orders = self._execute_trade_on_slot(
                    slot,
                    code=code,
                    name=name,
                    sym_market=sym_market,
                    side=side,
                    order_type='MARKET',
                    shares=shares,
                    price=float(quote['price']),
                    is_market_open=bool(quote['isMarketOpen']),
                    fx_rate=fx_rate,
                    source=source,
                    note=note,
                    stop_loss_pct=sl_pct if (side == 'BUY' and sl_pct and sl_pct > 0) else None,
                    take_profit_pct=tp_pct if (side == 'BUY' and tp_pct and tp_pct > 0) else None,
                )
                self._save_slot(slot)
                side_zh = '買進' if side == 'BUY' else '賣出'
                after_zh = '（以最新收盤價模擬）' if trade['simulatedAfterHours'] else ''
                auto_zh = f'，並自動建立 {len(auto_orders)} 筆停損／停利條件單' if auto_orders else ''
                msg = f"已市價{side_zh} {code} {name} {trade['shares']:g} 股，成交價 {trade['price']:g} {trade['priceCurrency']}{after_zh}{auto_zh}"
                return {
                    'trade': trade,
                    'order': None,
                    'autoOrders': auto_orders,
                    'message': msg,
                    'state': self.get_state(slot_id=slot_id),
                }

            # 條件掛單（LIMIT / STOP_LOSS / TAKE_PROFIT）
            trigger_price = _to_float(body.get('triggerPrice'), '觸發價格')
            assert trigger_price is not None
            if trigger_price <= 0:
                raise ValueError('條件掛單觸發價格必須大於 0')
            if side == 'SELL':
                pos = slot['positions'].get(code)
                if not pos or float(pos.get('shares') or 0) + 1e-6 < float(shares):
                    held = float(pos.get('shares') or 0) if pos else 0.0
                    raise ValueError(f'持股不足：{code} 目前持有 {held:g} 股，無法掛賣 {shares:g} 股')

            now_iso = _taipei_now()
            order = {
                'id': f'ord_{uuid.uuid4().hex[:10]}',
                'code': code,
                'name': name,
                'market': sym_market,
                'side': side,
                'orderType': order_type,
                'shares': int(shares) if sym_market == 'TW' else round(float(shares), 4),
                'triggerPrice': round(trigger_price, 4 if sym_market == 'US' else 2),
                'status': 'PENDING',
                'createdAt': now_iso,
                'triggeredAt': '',
                'source': source,
                'note': note,
            }
            if side == 'BUY' and sl_pct and sl_pct > 0:
                order['stopLossPct'] = round(sl_pct, 2)
            if side == 'BUY' and tp_pct and tp_pct > 0:
                order['takeProfitPct'] = round(tp_pct, 2)

            slot['orders'].insert(0, order)
            self._save_slot(slot)
            type_zh = {'LIMIT': '限價單', 'STOP_LOSS': '停損單', 'TAKE_PROFIT': '停利單'}[order_type]
            side_zh = '買進' if side == 'BUY' else '賣出'
            msg = f"已掛出 {code} {name} {type_zh}（{side_zh} {order['shares']:g} 股 @ {order['triggerPrice']:g}）"
            return {
                'trade': None,
                'order': order,
                'autoOrders': [],
                'message': msg,
                'state': self.get_state(slot_id=slot_id),
            }

    def cancel_order(self, slot_id: str, order_id: str) -> dict:
        oid = str(order_id or '').strip()
        if not oid:
            raise ValueError('請指定欲撤銷的掛單編號')
        with self._lock:
            slot = self.load_slot(slot_id)
            target = next((o for o in slot['orders'] if o.get('id') == oid), None)
            if not target:
                raise ValueError(f'找不到條件掛單：{oid}')
            if target.get('status') != 'PENDING':
                raise ValueError(f"掛單狀態為 {target.get('status')}，無法撤單")
            target['status'] = 'CANCELLED'
            self._save_slot(slot)
            return self.get_state(slot_id=slot_id)

    def _normalize_quote_map_entry(self, code: str, raw_val) -> dict | None:
        sym_market = classify_symbol_market(code)
        if isinstance(raw_val, (int, float)):
            p = float(raw_val)
            if not math.isfinite(p) or p <= 0:
                return None
            return {
                'price': round(p, 4 if sym_market == 'US' else 2),
                'isMarketOpen': self.is_market_open(sym_market, None),
            }
        if isinstance(raw_val, dict) and raw_val.get('price') is not None:
            p = float(raw_val['price'])
            if not math.isfinite(p) or p <= 0:
                return None
            is_open = (
                bool(raw_val['isMarketOpen'])
                if 'isMarketOpen' in raw_val
                else self.is_market_open(sym_market, raw_val)
            )
            return {
                'price': round(p, 4 if sym_market == 'US' else 2),
                'isMarketOpen': is_open,
            }
        return None

    def evaluate_orders(self, slot_id: str, quotes_map: dict | None = None) -> dict:
        with self._lock:
            slot = self.load_slot(slot_id)
            pending_orders = [o for o in slot['orders'] if o.get('status') == 'PENDING']
            codes_needed: list[str] = []
            for code in slot['positions'].keys():
                if code not in codes_needed:
                    codes_needed.append(code)
            for order in pending_orders:
                c = str(order.get('code') or '').upper()
                if c and c not in codes_needed:
                    codes_needed.append(c)

            resolved_quotes: dict[str, dict] = {}
            if quotes_map is not None:
                for k, v in quotes_map.items():
                    sym = str(k or '').strip().upper()
                    if not sym:
                        continue
                    try:
                        entry = self._normalize_quote_map_entry(sym, v)
                    except ValueError:
                        entry = None
                    if entry:
                        resolved_quotes[sym] = entry
            elif codes_needed:
                batch = self.live_quote_service.fetch_batch(codes_needed, manual=True)
                for sym, q in (batch.get('quotes') or {}).items():
                    try:
                        entry = self._normalize_quote_map_entry(sym, q)
                    except ValueError:
                        entry = None
                    if entry:
                        resolved_quotes[sym] = entry

            changed = False
            now_iso = _taipei_now()
            for code, pos in slot['positions'].items():
                q_entry = resolved_quotes.get(code)
                if q_entry:
                    pos['lastPrice'] = q_entry['price']
                    pos['lastPriceAt'] = now_iso
                    changed = True

            fx_rate = self.get_fx_usd_twd() if slot['market'] == 'MIXED' else 1.0
            triggered: list[dict] = []

            # 依掛單建立順序（由舊到新）檢查觸發
            for order in reversed(pending_orders):
                if order.get('status') != 'PENDING':
                    continue
                code = str(order.get('code') or '').upper()
                q_entry = resolved_quotes.get(code)
                if not q_entry:
                    continue
                price = float(q_entry['price'])
                trigger_price = float(order.get('triggerPrice') or 0.0)
                side = str(order.get('side') or '').upper()
                otype = str(order.get('orderType') or '').upper()

                should_trigger = False
                if otype == 'LIMIT' and side == 'BUY':
                    should_trigger = price <= trigger_price
                elif otype == 'LIMIT' and side == 'SELL':
                    should_trigger = price >= trigger_price
                elif otype == 'STOP_LOSS' and side == 'SELL':
                    should_trigger = price <= trigger_price
                elif otype == 'TAKE_PROFIT' and side == 'SELL':
                    should_trigger = price >= trigger_price

                if not should_trigger:
                    continue

                sym_market = str(order.get('market') or classify_symbol_market(code))
                exec_shares = order['shares']
                if side == 'SELL':
                    pos = slot['positions'].get(code)
                    held = float(pos.get('shares') or 0) if pos else 0.0
                    if held <= 1e-6:
                        order['status'] = 'CANCELLED'
                        changed = True
                        continue
                    if float(exec_shares) > held:
                        exec_shares = int(round(held)) if sym_market == 'TW' else round(held, 4)

                try:
                    trade, _ = self._execute_trade_on_slot(
                        slot,
                        code=code,
                        name=str(order.get('name') or self.resolve_symbol_name(code, sym_market)),
                        sym_market=sym_market,
                        side=side,
                        order_type=otype,
                        shares=exec_shares,
                        price=price,
                        is_market_open=bool(q_entry['isMarketOpen']),
                        fx_rate=fx_rate,
                        source='order_trigger',
                        note=str(order.get('note') or f'條件單觸發 ({otype})'),
                        stop_loss_pct=order.get('stopLossPct') if side == 'BUY' else None,
                        take_profit_pct=order.get('takeProfitPct') if side == 'BUY' else None,
                        exclude_order_id=str(order.get('id') or ''),
                    )
                except ValueError:
                    # 例如現金不足時暫不觸發，保留掛單
                    continue

                order['status'] = 'FILLED'
                order['triggeredAt'] = _taipei_now()
                changed = True
                triggered.append({
                    'orderId': order['id'],
                    'tradeId': trade['id'],
                    'code': code,
                    'name': trade['name'],
                    'side': side,
                    'orderType': otype,
                    'shares': trade['shares'],
                    'price': trade['price'],
                    'trade': trade,
                })

            if changed:
                self._record_equity_point(slot, fx_rate)
                self._save_slot(slot)

            return {
                'triggered': triggered,
                'state': self.get_state(slot_id=slot_id, refresh_quotes=False),
            }

    def save_ai_run_result(self, slot_id: str, log_entry: dict, proposal: dict | None = None) -> dict:
        with self._lock:
            slot = self.load_slot(slot_id)
            now_iso = str(log_entry.get('timestamp') or _taipei_now())
            slot['lastAiRunAt'] = now_iso
            slot['aiLogs'].insert(0, dict(log_entry))
            if len(slot['aiLogs']) > MAX_AI_LOGS:
                slot['aiLogs'] = slot['aiLogs'][:MAX_AI_LOGS]

            if proposal is not None:
                for old in slot['aiProposals']:
                    if isinstance(old, dict) and old.get('status') == 'PENDING':
                        old['status'] = 'EXPIRED'
                slot['aiProposals'].insert(0, dict(proposal))
                if len(slot['aiProposals']) > MAX_AI_PROPOSALS:
                    slot['aiProposals'] = slot['aiProposals'][:MAX_AI_PROPOSALS]

            self._save_slot(slot)
            return slot

    def resolve_proposal(self, slot_id: str, proposal_id: str, decision: str) -> dict:
        pid = str(proposal_id or '').strip()
        dec = str(decision or '').strip().lower()
        if dec not in ('approve', 'reject'):
            raise ValueError('提案決議僅支援 approve 或 reject')
        if not pid:
            raise ValueError('請指定提案編號')

        with self._lock:
            slot = self.load_slot(slot_id)
            prop = next((p for p in slot['aiProposals'] if isinstance(p, dict) and p.get('id') == pid), None)
            if not prop:
                raise ValueError(f'找不到 AI 操作提案：{pid}')
            if prop.get('status') != 'PENDING':
                raise ValueError(f"此提案已處理（目前狀態：{prop.get('status')}）")

            if dec == 'reject':
                prop['status'] = 'REJECTED'
                prop['resolvedAt'] = _taipei_now()
                self._save_slot(slot)
                return {
                    'ok': True,
                    'executedCount': 0,
                    'message': '已駁回 AI 操作提案',
                    'state': self.get_state(slot_id=slot_id),
                }

            actions = list(prop.get('actions') or [])
            decision_log_id = str(prop.get('decisionLogId') or '')
            executed_ids: list[str] = []
            errors: list[str] = []

            for act in actions:
                if not isinstance(act, dict):
                    continue
                order_body = {
                    'side': act.get('side'),
                    'code': act.get('code'),
                    'shares': act.get('shares'),
                    'orderType': 'MARKET',
                    'stopLossPct': act.get('stopLossPct'),
                    'takeProfitPct': act.get('takeProfitPct'),
                    'note': act.get('reason') or '核准 AI 提案下單',
                }
                try:
                    res = self.place_order(slot_id, order_body, source='ai')
                    if res.get('trade') and res['trade'].get('id'):
                        executed_ids.append(res['trade']['id'])
                except ValueError as exc:
                    errors.append(f"{act.get('code')}: {exc}")

            # 重新載入最新存檔以寫入提案核准狀態（避免覆蓋 place_order 的持倉與現金變動）
            slot = self.load_slot(slot_id)
            prop = next((p for p in slot['aiProposals'] if isinstance(p, dict) and p.get('id') == pid), None)
            if prop:
                prop['status'] = 'APPROVED'
                prop['resolvedAt'] = _taipei_now()
                prop['executedTrades'] = executed_ids
                if errors:
                    prop['executionErrors'] = errors
            if decision_log_id and executed_ids:
                for lg in slot['aiLogs']:
                    if isinstance(lg, dict) and lg.get('id') == decision_log_id:
                        existing = list(lg.get('executedTrades') or [])
                        existing.extend(executed_ids)
                        lg['executedTrades'] = existing
                        break
            self._save_slot(slot)

            if errors and not executed_ids:
                msg = f"提案已標記核准，但執行時發生限制：{'；'.join(errors)}"
            elif errors:
                msg = f"已核准並成交 {len(executed_ids)} 筆，部分略過：{'；'.join(errors)}"
            else:
                msg = f'已核准並執行 {len(executed_ids)} 筆 AI 建議委託'

            return {
                'ok': True,
                'executedCount': len(executed_ids),
                'errors': errors,
                'message': msg,
                'state': self.get_state(slot_id=slot_id),
            }

    def has_any_daily_ai_slot(self) -> bool:
        with self._lock:
            return has_any_daily_ai_slot_in_dir(self.app_data_dir)
