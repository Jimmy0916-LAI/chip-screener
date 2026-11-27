"""模擬操盤 AI 操盤手與程式碼強制硬性風控護欄供應器（純 Python 3.10 標準函式庫）
功能：
1. 8 組站內資料工具封裝（各存檔可獨立開關）：
   - portfolio: get_portfolio_state（模擬帳戶資產、現金、持倉、掛單與風控護欄）
   - tdccScreener: screen_tw_tdcc_chips（本機集保 400 張以上大戶連升篩選，零外部 HTTP）
   - twDetail: get_tw_stock_detail（台股均線乖離、三大法人與融資融券摘要）
   - usScreener: screen_us_sp500 / get_us_stock_detail（美股 S&P 500 篩選與個股技術摘要）
   - briefing: get_daily_briefing（每日晨報摘要、大盤指數與焦點股）
   - watchlist: get_watchlist_summary（自選收藏夾與六維自動分析結果）
   - channels: get_channel_strategies（訂閱財經頻道最新策略卡）
   - liveQuotes: get_live_quotes（盤中／最新即時報價查詢）
2. 雙引擎決策迴圈：
   - Engine A (gemini_fc): 透過 secret_store 解密讀取 Gemini API Key，依選定模型進行最多 6 輪
     Function Calling 查詢工具後輸出結構化 JSON 決策。
   - Engine B (rule_fallback): 未設定金鑰或 Gemini 失敗時，確定性呼叫已啟用工具並以多因子量化評分產出決策。
3. 程式碼強制硬性風控護欄（enforce_guardrails，不可被 Prompt 或 LLM 輸出覆寫）：
   - 市場範圍檢核（TW / US / MIXED）、有效報價檢核
   - 賣出上限強制鎖定於目前持股數（未持有則駁回）
   - 買進強制執行 maxPositions、minCashFloorPct、maxSingleStockPct（含手續費與匯率估算、跨多筆連算）
   - 違規自動縮減至合規股數（ADJUSTED）或駁回（REJECTED），新建倉自動補齊預設停損／停利百分比
4. 自治模式與審計日誌：
   - full: 自動下單並記錄成交 ID；semi: 產出 PENDING 提案待核准；全過程持久化至 aiLogs。
"""

from __future__ import annotations

import json
import math
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from providers import ai_router

TAIPEI_TZ = timezone(timedelta(hours=8))
MAX_FC_TURNS = 6
GEMINI_TIMEOUT_SEC = 28

VALID_TW_CODE_RE = re.compile(r'^(?:\d{4}|00\d{2,4}[A-Z]?)$')
VALID_US_CODE_RE = re.compile(r'^[A-Z][A-Z0-9-]{0,7}$')

DEFAULT_AI_TOOLS = {
    'tdccScreener': True,
    'twDetail': True,
    'usScreener': True,
    'briefing': True,
    'watchlist': True,
    'channels': True,
    'liveQuotes': True,
    'portfolio': True,
}

DEFAULT_GUARDRAILS = {
    'maxSingleStockPct': 25.0,
    'maxPositions': 8,
    'minCashFloorPct': 15.0,
    'defaultStopLossPct': 8.0,
    'defaultTakeProfitPct': 18.0,
}

DEFAULT_FEES = {
    'twBuyFeeRate': 0.001425,
    'twSellFeeRate': 0.001425,
    'twFeeDiscount': 1.0,
    'twMinFee': 20.0,
    'twStockTaxRate': 0.003,
    'twEtfTaxRate': 0.001,
    'usFeeRate': 0.0,
    'usMinFee': 0.0,
}

TOOL_GATE_MAP = {
    'get_portfolio_state': 'portfolio',
    'screen_tw_tdcc_chips': 'tdccScreener',
    'get_tw_stock_detail': 'twDetail',
    'screen_us_sp500': 'usScreener',
    'get_us_stock_detail': 'usScreener',
    'get_daily_briefing': 'briefing',
    'get_watchlist_summary': 'watchlist',
    'get_channel_strategies': 'channels',
    'get_live_quotes': 'liveQuotes',
}

STYLE_PROFILES = {
    'conservative': {
        'label': '保守穩健',
        'prompt': '重視本金保護與高現金水位，偏好大戶籌碼明確、均線多頭且低波動標的，單筆倉位偏保守並嚴守停損停利。',
        'buyScoreMin': 42.0,
        'maxNewBuys': 1,
        'targetWeightFactor': 0.65,
        'maxTargetWeightPct': 14.0,
        'stopLossTriggerPct': 6.0,
        'takeProfitTriggerPct': 12.0,
        'takeProfitTrimRatio': 0.5,
    },
    'balanced': {
        'label': '均衡波段',
        'prompt': '兼顧成長動能與風險控制，結合籌碼、法人、技術均線與頻道策略，分批布局具勝率之標的。',
        'buyScoreMin': 32.0,
        'maxNewBuys': 2,
        'targetWeightFactor': 0.80,
        'maxTargetWeightPct': 18.0,
        'stopLossTriggerPct': 8.0,
        'takeProfitTriggerPct': 18.0,
        'takeProfitTrimRatio': 0.5,
    },
    'aggressive': {
        'label': '積極動能',
        'prompt': '追求波段趨勢與強勢動能報酬，敢於在籌碼與資金流共振時集中配置，但仍嚴格遵守硬性風控護欄。',
        'buyScoreMin': 24.0,
        'maxNewBuys': 3,
        'targetWeightFactor': 0.95,
        'maxTargetWeightPct': 24.0,
        'stopLossTriggerPct': 10.0,
        'takeProfitTriggerPct': 25.0,
        'takeProfitTrimRatio': 0.5,
    },
}


def taipei_now() -> datetime:
    return datetime.now(TAIPEI_TZ)


def _sanitize_error(text: str) -> str:
    """確保任何錯誤訊息皆不包含 Gemini API Key 或查詢字串金鑰。"""
    msg = str(text or '').strip()
    if not msg:
        return ''
    msg = re.sub(r'([?&]key=)[^&\s"\']+', r'\1***', msg, flags=re.IGNORECASE)
    msg = re.sub(r'AIza[0-9A-Za-z_-]{10,}', 'AIza***', msg)
    return msg[:300]


def _normalize_symbol(code: str) -> tuple[str, str]:
    """回傳 (normalized_code, market)，無效則回傳 ('', '')。"""
    raw = str(code or '').strip().upper()
    if not raw:
        return '', ''
    if VALID_TW_CODE_RE.fullmatch(raw):
        return raw, 'TW'
    us_norm = raw.replace('.', '-')
    if VALID_US_CODE_RE.fullmatch(us_norm):
        return us_norm, 'US'
    return '', ''


def _parse_iso_datetime(raw: str) -> datetime | None:
    if not raw:
        return None
    text = str(raw).strip()
    try:
        if text.endswith('Z'):
            text = text[:-1] + '+00:00'
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=TAIPEI_TZ)
        return dt.astimezone(TAIPEI_TZ)
    except Exception:
        return None


def _safe_float(val, default: float | None = None) -> float | None:
    if val is None or val == '':
        return default
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return default
        return f
    except (TypeError, ValueError):
        return default


def _safe_int(val, default: int) -> int:
    f = _safe_float(val, None)
    if f is None:
        return default
    return int(round(f))


def _clamp(val: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, val))


def _floor_us_shares(val: float) -> float:
    if val <= 0:
        return 0.0
    return math.floor(val * 10000.0 + 1e-9) / 10000.0


def _floor_tw_shares(val: float) -> int:
    if val <= 0:
        return 0
    return int(math.floor(val + 1e-9))


def _compute_ma(values: list[float], period: int) -> float | None:
    if len(values) < period or period <= 0:
        return None
    return round(sum(values[-period:]) / period, 2)


def _pct_bias(price: float, ref: float | None) -> float | None:
    if not ref or ref <= 0:
        return None
    return round((price - ref) / ref * 100.0, 2)


def _strip_json_fences(text: str) -> str:
    cleaned = str(text or '').strip()
    cleaned = re.sub(r'^```(?:json)?\s*', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\s*```$', '', cleaned)
    return cleaned.strip()


def _parse_json_object_from_text(text: str) -> dict | None:
    cleaned = _strip_json_fences(text)
    if not cleaned:
        return None
    try:
        obj = json.loads(cleaned)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass
    first = cleaned.find('{')
    last = cleaned.rfind('}')
    if first >= 0 and last > first:
        try:
            obj = json.loads(cleaned[first : last + 1])
            if isinstance(obj, dict):
                return obj
        except Exception:
            pass
    return None


def _to_base_currency(amount_native: float, sym_market: str, slot_currency: str, fx_rate: float) -> float:
    fx = fx_rate if fx_rate > 0 else 32.5
    if slot_currency == 'TWD' and sym_market == 'US':
        return amount_native * fx
    if slot_currency == 'USD' and sym_market == 'TW':
        return amount_native / fx
    return amount_native


def _from_base_currency(amount_base: float, sym_market: str, slot_currency: str, fx_rate: float) -> float:
    fx = fx_rate if fx_rate > 0 else 32.5
    if slot_currency == 'TWD' and sym_market == 'US':
        return amount_base / fx
    if slot_currency == 'USD' and sym_market == 'TW':
        return amount_base * fx
    return amount_base


def _estimate_buy_fee_native(gross_native: float, sym_market: str, fees: dict) -> float:
    if gross_native <= 0:
        return 0.0
    if sym_market == 'TW':
        rate = max(0.0, _safe_float(fees.get('twBuyFeeRate'), DEFAULT_FEES['twBuyFeeRate']) or 0.0)
        disc = max(0.0, _safe_float(fees.get('twFeeDiscount'), DEFAULT_FEES['twFeeDiscount']) or 1.0)
        min_fee = max(0.0, _safe_float(fees.get('twMinFee'), DEFAULT_FEES['twMinFee']) or 0.0)
        if rate <= 0:
            return 0.0
        return max(min_fee, gross_native * rate * disc)
    rate = max(0.0, _safe_float(fees.get('usFeeRate'), DEFAULT_FEES['usFeeRate']) or 0.0)
    min_fee = max(0.0, _safe_float(fees.get('usMinFee'), DEFAULT_FEES['usMinFee']) or 0.0)
    if rate <= 0 and min_fee <= 0:
        return 0.0
    return max(min_fee, gross_native * rate)


def _estimate_sell_net_native(gross_native: float, sym_market: str, code: str, fees: dict) -> float:
    if gross_native <= 0:
        return 0.0
    if sym_market == 'TW':
        rate = max(0.0, _safe_float(fees.get('twSellFeeRate'), DEFAULT_FEES['twSellFeeRate']) or 0.0)
        disc = max(0.0, _safe_float(fees.get('twFeeDiscount'), DEFAULT_FEES['twFeeDiscount']) or 1.0)
        min_fee = max(0.0, _safe_float(fees.get('twMinFee'), DEFAULT_FEES['twMinFee']) or 0.0)
        fee = 0.0 if rate <= 0 else max(min_fee, gross_native * rate * disc)
        etf_tax = max(0.0, _safe_float(fees.get('twEtfTaxRate'), DEFAULT_FEES['twEtfTaxRate']) or 0.0)
        stk_tax = max(0.0, _safe_float(fees.get('twStockTaxRate'), DEFAULT_FEES['twStockTaxRate']) or 0.0)
        tax_rate = etf_tax if code.startswith('00') else stk_tax
        tax = gross_native * tax_rate
        return max(0.0, gross_native - fee - tax)
    rate = max(0.0, _safe_float(fees.get('usFeeRate'), DEFAULT_FEES['usFeeRate']) or 0.0)
    min_fee = max(0.0, _safe_float(fees.get('usMinFee'), DEFAULT_FEES['usMinFee']) or 0.0)
    fee = 0.0 if (rate <= 0 and min_fee <= 0) else max(min_fee, gross_native * rate)
    return max(0.0, gross_native - fee)


def _build_gemini_tool_declarations(enabled_tools: dict[str, bool]) -> list[dict]:
    """僅組裝已啟用工具之 Gemini Function Declarations。"""
    all_decls: list[tuple[str, dict]] = [
        (
            'portfolio',
            {
                'name': 'get_portfolio_state',
                'description': '讀取目前模擬帳戶的總資產、現金水位、持倉損益、待執行條件掛單、近期成交紀錄與硬性風控護欄設定。',
                'parameters': {'type': 'OBJECT', 'properties': {}},
            },
        ),
        (
            'tdccScreener',
            {
                'name': 'screen_tw_tdcc_chips',
                'description': '以本機集保資料篩選近 N 週連續 400 張以上大戶持股比例上升之台股候選名單（速度快、無外部網路延遲）。',
                'parameters': {
                    'type': 'OBJECT',
                    'properties': {
                        'weeks': {'type': 'INTEGER', 'description': '連續上升週數（1~4，預設 2）'},
                        'min_pp': {'type': 'NUMBER', 'description': '累積大戶占比增幅下限百分點（預設 0.3）'},
                        'limit': {'type': 'INTEGER', 'description': '回傳最多筆數（1~20，預設 12）'},
                    },
                },
            },
        ),
        (
            'twDetail',
            {
                'name': 'get_tw_stock_detail',
                'description': '查詢指定台股代號的近期收盤價、MA5/MA20/MA60 乖離率、近 5 日三大法人買賣超與融資融券變化。',
                'parameters': {
                    'type': 'OBJECT',
                    'properties': {
                        'code': {'type': 'STRING', 'description': '台股代號（如 2330、2454、0050）'},
                    },
                    'required': ['code'],
                },
            },
        ),
        (
            'usScreener',
            {
                'name': 'screen_us_sp500',
                'description': '讀取美股 S&P 500 量化篩選候選名單，支援機構吸籌（smart_money）與超跌修正（dip_buy）模式。',
                'parameters': {
                    'type': 'OBJECT',
                    'properties': {
                        'mode': {
                            'type': 'STRING',
                            'description': '篩選模式：smart_money 或 dip_buy（預設 smart_money）',
                        },
                        'limit': {'type': 'INTEGER', 'description': '回傳最多筆數（1~20，預設 12）'},
                    },
                },
            },
        ),
        (
            'usScreener',
            {
                'name': 'get_us_stock_detail',
                'description': '查詢指定美股代號之日線均線、RSI(14)、MACD、CMF(20) 資金流與 52 週位階摘要。',
                'parameters': {
                    'type': 'OBJECT',
                    'properties': {
                        'code': {'type': 'STRING', 'description': '美股代號（如 NVDA、AAPL、TSM、SPY）'},
                    },
                    'required': ['code'],
                },
            },
        ),
        (
            'briefing',
            {
                'name': 'get_daily_briefing',
                'description': '讀取最新一份每日財經晨報之重點摘要、台美股大盤指數、晨報焦點股與頭條新聞。',
                'parameters': {'type': 'OBJECT', 'properties': {}},
            },
        ),
        (
            'watchlist',
            {
                'name': 'get_watchlist_summary',
                'description': '讀取使用者自選收藏夾清單與最新六維自動分析結果（短中均線、集保大戶、三大法人、量能、融資）。',
                'parameters': {'type': 'OBJECT', 'properties': {}},
            },
        ),
        (
            'channels',
            {
                'name': 'get_channel_strategies',
                'description': '讀取已訂閱財經 YouTube 頻道最新解析出的策略卡（多空立場、核心論點、提及標的、進場與風控條件）。',
                'parameters': {
                    'type': 'OBJECT',
                    'properties': {
                        'limit': {'type': 'INTEGER', 'description': '回傳最新策略筆數（1~15，預設 10）'},
                    },
                },
            },
        ),
        (
            'liveQuotes',
            {
                'name': 'get_live_quotes',
                'description': '批次查詢指定台股或美股代號之最新即時／收盤報價與漲跌幅。',
                'parameters': {
                    'type': 'OBJECT',
                    'properties': {
                        'codes': {
                            'type': 'ARRAY',
                            'items': {'type': 'STRING'},
                            'description': '欲查詢報價的股票代號清單（如 ["2330", "NVDA"]）',
                        },
                    },
                    'required': ['codes'],
                },
            },
        ),
    ]
    return [decl for gate, decl in all_decls if enabled_tools.get(gate, True)]


class AiTraderService:
    def __init__(
        self,
        app_data_dir: Path,
        project_root: Path,
        paper_service,
        feed_service=None,
        tw_market_service=None,
        us_market_service=None,
        briefing_service=None,
        watchlist_service=None,
        channel_service=None,
        live_quote_service=None,
        stock_names: dict | None = None,
        base_series: dict | None = None,
    ):
        self.app_data_dir = Path(app_data_dir)
        self.project_root = Path(project_root)
        self.paper = paper_service
        self.feed_service = feed_service
        self.tw_market = tw_market_service
        self.us_market = us_market_service
        self.briefing = briefing_service
        self.watchlist = watchlist_service
        self.channels = channel_service
        self.live_quotes = live_quote_service
        self.stock_names = stock_names or {}
        self.base_series = base_series or {}

    # ------------------------------------------------------------------
    # 內部輔助：設定正規化、報價與投資組合指標
    # ------------------------------------------------------------------

    def _get_ai_config(self, slot: dict) -> dict:
        raw = slot.get('aiConfig') if isinstance(slot.get('aiConfig'), dict) else {}
        autonomy = str(raw.get('autonomy') or 'semi').strip().lower()
        if autonomy not in ('semi', 'full'):
            autonomy = 'semi'
        style = str(raw.get('style') or 'balanced').strip().lower()
        if style not in STYLE_PROFILES:
            style = 'balanced'
        schedule_mode = str(raw.get('scheduleMode') or 'manual').strip().lower()
        if schedule_mode not in ('manual', 'daily', 'intraday'):
            schedule_mode = 'manual'
        cooldown = max(0, min(1440, _safe_int(raw.get('cooldownMinutes'), 60)))

        raw_tools = raw.get('tools') if isinstance(raw.get('tools'), dict) else {}
        tools = {k: bool(raw_tools.get(k, default_v)) for k, default_v in DEFAULT_AI_TOOLS.items()}

        raw_g = raw.get('guardrails') if isinstance(raw.get('guardrails'), dict) else {}
        guardrails = {
            'maxSingleStockPct': _clamp(
                _safe_float(raw_g.get('maxSingleStockPct'), DEFAULT_GUARDRAILS['maxSingleStockPct']) or 25.0,
                1.0,
                100.0,
            ),
            'maxPositions': max(1, min(100, _safe_int(raw_g.get('maxPositions'), DEFAULT_GUARDRAILS['maxPositions']))),
            'minCashFloorPct': _clamp(
                _safe_float(raw_g.get('minCashFloorPct'), DEFAULT_GUARDRAILS['minCashFloorPct'])
                if raw_g.get('minCashFloorPct') is not None
                else DEFAULT_GUARDRAILS['minCashFloorPct'],
                0.0,
                99.0,
            ),
            'defaultStopLossPct': _clamp(
                _safe_float(raw_g.get('defaultStopLossPct'), DEFAULT_GUARDRAILS['defaultStopLossPct'])
                if raw_g.get('defaultStopLossPct') is not None
                else DEFAULT_GUARDRAILS['defaultStopLossPct'],
                0.0,
                90.0,
            ),
            'defaultTakeProfitPct': _clamp(
                _safe_float(raw_g.get('defaultTakeProfitPct'), DEFAULT_GUARDRAILS['defaultTakeProfitPct'])
                if raw_g.get('defaultTakeProfitPct') is not None
                else DEFAULT_GUARDRAILS['defaultTakeProfitPct'],
                0.0,
                500.0,
            ),
        }

        return {
            'autonomy': autonomy,
            'style': style,
            'customPrompt': str(raw.get('customPrompt') or '').strip()[:1000],
            'scheduleMode': schedule_mode,
            'cooldownMinutes': cooldown,
            'tools': tools,
            'guardrails': guardrails,
        }

    def _get_fx_rate(self) -> float:
        try:
            if hasattr(self.paper, 'get_fx_usd_twd'):
                fx = _safe_float(self.paper.get_fx_usd_twd(), 32.5)
                if fx and fx > 0:
                    return fx
        except Exception:
            pass
        return 32.5

    def _stock_name(self, code: str, fallback: str = '') -> str:
        norm, mkt = _normalize_symbol(code)
        if mkt == 'TW':
            info = self.stock_names.get(norm)
            if isinstance(info, (list, tuple)) and info:
                return str(info[0])
            return fallback or ('ETF' if norm.startswith('00') else norm)
        return fallback or norm

    def _compute_portfolio_snapshot(self, slot: dict, fx_rate: float) -> dict:
        """取得投資組合關鍵指標，優先委派 PaperTradingService.compute_slot_metrics。"""
        if hasattr(self.paper, 'compute_slot_metrics'):
            try:
                metrics = self.paper.compute_slot_metrics(slot, fx_rate)
                if isinstance(metrics, dict) and 'totalEquity' in metrics:
                    return metrics
            except Exception:
                pass

        slot_currency = str(slot.get('currency') or ('USD' if slot.get('market') == 'US' else 'TWD')).upper()
        cash = float(_safe_float(slot.get('cash'), 0.0) or 0.0)
        initial_cap = float(_safe_float(slot.get('initialCapital'), cash) or cash or 1.0)
        positions_raw = slot.get('positions') if isinstance(slot.get('positions'), dict) else {}

        pos_list: list[dict] = []
        market_value = 0.0
        unrealized_pnl = 0.0

        for code, pos in positions_raw.items():
            if not isinstance(pos, dict):
                continue
            shares = float(_safe_float(pos.get('shares'), 0.0) or 0.0)
            if shares <= 0:
                continue
            sym_mkt = str(pos.get('market') or _normalize_symbol(code)[1] or 'TW').upper()
            avg_cost = float(_safe_float(pos.get('avgCost'), 0.0) or 0.0)
            cur_price = float(_safe_float(pos.get('lastPrice'), avg_cost) or avg_cost)
            mv_base = _to_base_currency(shares * cur_price, sym_mkt, slot_currency, fx_rate)
            cost_base = _to_base_currency(shares * avg_cost, sym_mkt, slot_currency, fx_rate)
            upnl = mv_base - cost_base
            upnl_pct = ((cur_price - avg_cost) / avg_cost * 100.0) if avg_cost > 0 else 0.0
            market_value += mv_base
            unrealized_pnl += upnl
            pos_list.append({
                'code': str(pos.get('code') or code).upper(),
                'name': str(pos.get('name') or self._stock_name(code)),
                'market': sym_mkt,
                'shares': shares,
                'avgCost': round(avg_cost, 4),
                'costCurrency': str(pos.get('costCurrency') or ('USD' if sym_mkt == 'US' else 'TWD')),
                'currentPrice': round(cur_price, 4),
                'marketValue': round(mv_base, 2),
                'costBasis': round(cost_base, 2),
                'unrealizedPnl': round(upnl, 2),
                'unrealizedPnlPct': round(upnl_pct, 2),
                'weightPct': 0.0,
            })

        total_equity = cash + market_value
        for p in pos_list:
            p['weightPct'] = round((p['marketValue'] / total_equity * 100.0) if total_equity > 0 else 0.0, 2)
        pos_list.sort(key=lambda x: x['marketValue'], reverse=True)

        cash_pct = round((cash / total_equity * 100.0) if total_equity > 0 else 100.0, 2)
        invested_pct = round(max(0.0, 100.0 - cash_pct), 2)
        total_ret = round(((total_equity - initial_cap) / initial_cap * 100.0) if initial_cap > 0 else 0.0, 2)

        return {
            'totalEquity': round(total_equity, 2),
            'marketValue': round(market_value, 2),
            'cash': round(cash, 2),
            'cashPct': cash_pct,
            'investedPct': invested_pct,
            'unrealizedPnl': round(unrealized_pnl, 2),
            'realizedPnl': 0.0,
            'totalPnl': round(total_equity - initial_cap, 2),
            'totalReturnPct': total_ret,
            'positionsList': pos_list,
        }

    def _safe_get_quote(self, code: str, quote_cache: dict[str, dict | None]) -> dict | None:
        norm, mkt = _normalize_symbol(code)
        if not norm:
            return None
        if norm in quote_cache:
            return quote_cache[norm]

        quote: dict | None = None
        if hasattr(self.paper, 'get_quote'):
            try:
                q = self.paper.get_quote(norm)
                if isinstance(q, dict) and (_safe_float(q.get('price'), 0.0) or 0.0) > 0:
                    quote = dict(q)
            except Exception:
                quote = None

        if quote is None and self.live_quotes is not None:
            try:
                batch = self.live_quotes.fetch_batch([norm], manual=True)
                q = (batch.get('quotes') or {}).get(norm) if isinstance(batch, dict) else None
                if isinstance(q, dict) and (_safe_float(q.get('price'), 0.0) or 0.0) > 0:
                    quote = dict(q)
            except Exception:
                quote = None

        if quote is not None:
            quote.setdefault('code', norm)
            quote.setdefault('market', mkt)
            quote.setdefault('name', self._stock_name(norm))
        quote_cache[norm] = quote
        return quote

    # ------------------------------------------------------------------
    # 8 組 App 工具封裝（皆受 aiConfig.tools 開關控管）
    # ------------------------------------------------------------------

    def _record_tool(self, tools_used: list[dict], tool_name: str, args: dict, summary: str) -> None:
        tools_used.append({
            'tool': tool_name,
            'args': dict(args or {}),
            'summary': str(summary or '')[:160],
        })

    def _tool_get_portfolio_state(self, slot: dict, fx_rate: float, tools_used: list[dict]) -> dict:
        ai_cfg = self._get_ai_config(slot)
        metrics = self._compute_portfolio_snapshot(slot, fx_rate)
        pending_orders = [
            {
                'id': o.get('id', ''),
                'code': o.get('code', ''),
                'side': o.get('side', ''),
                'orderType': o.get('orderType', ''),
                'shares': o.get('shares', 0),
                'triggerPrice': o.get('triggerPrice', 0),
            }
            for o in (slot.get('orders') or [])
            if isinstance(o, dict) and str(o.get('status') or '').upper() == 'PENDING'
        ]
        recent_trades = [
            {
                'timestamp': t.get('timestamp', ''),
                'side': t.get('side', ''),
                'code': t.get('code', ''),
                'shares': t.get('shares', 0),
                'price': t.get('price', 0),
                'realizedPnl': t.get('realizedPnl'),
                'source': t.get('source', ''),
            }
            for t in (slot.get('trades') or [])[:8]
            if isinstance(t, dict)
        ]
        result = {
            'slotId': slot.get('id', ''),
            'name': slot.get('name', ''),
            'market': str(slot.get('market') or 'TW').upper(),
            'currency': str(slot.get('currency') or 'TWD').upper(),
            'fxUsdTwd': round(fx_rate, 4),
            'cash': metrics['cash'],
            'totalEquity': metrics['totalEquity'],
            'marketValue': metrics['marketValue'],
            'cashPct': metrics['cashPct'],
            'investedPct': metrics['investedPct'],
            'totalReturnPct': metrics.get('totalReturnPct', 0.0),
            'positions': metrics.get('positionsList') or [],
            'pendingOrders': pending_orders,
            'recentTrades': recent_trades,
            'guardrails': ai_cfg['guardrails'],
        }
        self._record_tool(
            tools_used,
            'get_portfolio_state',
            {},
            (
                f"總資產 {result['totalEquity']:,.0f} {result['currency']}，"
                f"現金 {result['cashPct']:.1f}%，持倉 {len(result['positions'])} 檔，"
                f"掛單 {len(pending_orders)} 筆"
            ),
        )
        return result

    def _collect_tdcc_weeks(self) -> list[tuple[str, dict]]:
        merged: dict[str, dict] = {}
        if isinstance(self.base_series, dict):
            for day, rows in self.base_series.items():
                if isinstance(rows, dict):
                    merged[str(day)] = rows
        if self.feed_service is not None and getattr(self.feed_service, 'weeks', None):
            for day, doc in self.feed_service.weeks.items():
                if not isinstance(doc, dict):
                    continue
                rows = dict(doc.get('rows') or {})
                rows.update(doc.get('extraRows') or {})
                merged[str(day)] = rows
        elif not merged:
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

    def _tool_screen_tw_tdcc_chips(
        self,
        args: dict,
        tools_used: list[dict],
    ) -> dict:
        weeks_req = max(1, min(4, _safe_int(args.get('weeks'), 2)))
        min_pp = max(0.0, _safe_float(args.get('min_pp'), 0.3) or 0.0)
        limit = max(1, min(25, _safe_int(args.get('limit'), 12)))

        all_weeks = self._collect_tdcc_weeks()
        if len(all_weeks) < 2:
            res = {'latestWeek': all_weeks[-1][0] if all_weeks else '', 'weeksChecked': 0, 'candidates': []}
            self._record_tool(
                tools_used,
                'screen_tw_tdcc_chips',
                {'weeks': weeks_req, 'min_pp': min_pp, 'limit': limit},
                '本機集保週數不足（少於 2 週），無篩選結果',
            )
            return res

        eff_weeks = min(weeks_req, len(all_weeks) - 1)
        window = all_weeks[-(eff_weeks + 1) :]
        latest_day, latest_rows = window[-1]
        candidates: list[dict] = []

        for code, cur_r in latest_rows.items():
            if not VALID_TW_CODE_RE.fullmatch(str(code)):
                continue
            if not isinstance(cur_r, list) or len(cur_r) < 6 or cur_r[0] <= 0:
                continue
            series_rows: list[list] = []
            valid = True
            for _, rows in window:
                r = rows.get(code)
                if not isinstance(r, list) or len(r) < 6 or r[0] <= 0:
                    valid = False
                    break
                series_rows.append(r)
            if not valid:
                continue

            pcts_400 = [100.0 * r[3] / r[0] for r in series_rows]
            deltas = [pcts_400[i] - pcts_400[i - 1] for i in range(1, len(pcts_400))]
            if not all(d > 0 for d in deltas):
                continue
            total_delta_pp = pcts_400[-1] - pcts_400[0]
            if total_delta_pp < min_pp:
                continue
            delta_shares_400 = int(series_rows[-1][3] - series_rows[0][3])
            if delta_shares_400 <= 0:
                continue

            pct1000_cur = 100.0 * series_rows[-1][5] / series_rows[-1][0]
            pct1000_prev = 100.0 * series_rows[0][5] / series_rows[0][0]
            info = self.stock_names.get(code)
            name = str(info[0]) if isinstance(info, (list, tuple)) and info else code
            exch = str(info[1]) if isinstance(info, (list, tuple)) and len(info) > 1 else 'TWSE'
            candidates.append({
                'code': code,
                'name': name,
                'market': 'TW',
                'exchange': exch,
                'latestWeek': latest_day,
                'pct400': round(pcts_400[-1], 3),
                'totalDeltaPp400': round(total_delta_pp, 3),
                'weeklyDeltasPp': [round(d, 3) for d in deltas],
                'deltaPp1000': round(pct1000_cur - pct1000_prev, 3),
                'deltaShares400': delta_shares_400,
            })

        candidates.sort(key=lambda x: (x['totalDeltaPp400'], x['deltaPp1000']), reverse=True)
        picked = candidates[:limit]
        result = {
            'latestWeek': latest_day,
            'weeksChecked': eff_weeks,
            'totalMatched': len(candidates),
            'candidates': picked,
        }
        top_hint = '、'.join(f"{c['code']}({c['totalDeltaPp400']:+.2f}pp)" for c in picked[:3])
        summary = f"集保400張連升{eff_weeks}週篩出 {len(picked)}/{len(candidates)} 檔（{latest_day}）"
        if top_hint:
            summary += f"：{top_hint}"
        self._record_tool(
            tools_used,
            'screen_tw_tdcc_chips',
            {'weeks': eff_weeks, 'min_pp': min_pp, 'limit': limit},
            summary,
        )
        return result

    def _tool_get_tw_stock_detail(self, args: dict, tools_used: list[dict]) -> dict:
        raw_code = str(args.get('code') or '').strip().upper()
        norm, mkt = _normalize_symbol(raw_code)
        if mkt != 'TW':
            res = {'code': raw_code, 'available': False, 'error': '非有效台股代號'}
            self._record_tool(tools_used, 'get_tw_stock_detail', {'code': raw_code}, f'{raw_code} 非有效台股代號')
            return res
        if self.tw_market is None:
            res = {'code': norm, 'available': False, 'error': '未掛載台股詳情服務'}
            self._record_tool(tools_used, 'get_tw_stock_detail', {'code': norm}, f'{norm} 台股詳情服務未啟用')
            return res

        try:
            detail = self.tw_market.get_detail(norm, force_refresh=False)
        except Exception as exc:
            err = _sanitize_error(str(exc))
            res = {'code': norm, 'available': False, 'error': err}
            self._record_tool(tools_used, 'get_tw_stock_detail', {'code': norm}, f'{norm} 查詢失敗：{err[:60]}')
            return res

        bars = detail.get('bars') or []
        if not bars:
            res = {'code': norm, 'available': False, 'error': '無日 K 資料'}
            self._record_tool(tools_used, 'get_tw_stock_detail', {'code': norm}, f'{norm} 尚無日 K 資料')
            return res

        closes = [float(b[4]) for b in bars]
        vols = [float(b[5]) for b in bars]
        last = bars[-1]
        prev = bars[-2] if len(bars) >= 2 else last
        close = float(last[4])
        prev_close = float(prev[4])
        chg_pct = round(((close - prev_close) / prev_close * 100.0) if prev_close > 0 else 0.0, 2)

        ma5 = _compute_ma(closes, 5)
        ma20 = _compute_ma(closes, 20)
        ma60 = _compute_ma(closes, 60)
        mv5 = _compute_ma(vols, 5)
        bias5 = _pct_bias(close, ma5)
        bias20 = _pct_bias(close, ma20)
        bias60 = _pct_bias(close, ma60)
        vol_ratio = round(float(last[5]) / mv5, 2) if (mv5 and mv5 > 0) else 1.0

        inst_rows = detail.get('inst') or []
        inst5 = None
        foreign5 = None
        trust5 = None
        dealer5 = None
        if inst_rows:
            r5 = inst_rows[-5:]
            foreign5 = sum(int(r[1]) for r in r5)
            trust5 = sum(int(r[2]) for r in r5)
            dealer5 = sum(int(r[3]) for r in r5)
            inst5 = foreign5 + trust5 + dealer5

        margin_rows = detail.get('margin') or []
        margin_bal = None
        margin5_delta = None
        short_bal = None
        short5_delta = None
        if margin_rows:
            margin_bal = int(margin_rows[-1][1])
            margin5_delta = sum(int(r[2]) for r in margin_rows[-5:])
            short_bal = int(margin_rows[-1][3])
            short5_delta = sum(int(r[4]) for r in margin_rows[-5:])

        name = self._stock_name(norm)
        result = {
            'code': norm,
            'name': name,
            'available': True,
            'tradeDate': str(last[0]),
            'close': round(close, 2),
            'changePct': chg_pct,
            'ma5': ma5,
            'ma20': ma20,
            'ma60': ma60,
            'bias5Pct': bias5,
            'bias20Pct': bias20,
            'bias60Pct': bias60,
            'volLots': int(last[5]),
            'volRatio5': vol_ratio,
            'inst5Total': inst5,
            'foreign5': foreign5,
            'trust5': trust5,
            'dealer5': dealer5,
            'marginBal': margin_bal,
            'margin5Delta': margin5_delta,
            'shortBal': short_bal,
            'short5Delta': short5_delta,
        }
        b20_str = f'{bias20:+.1f}%' if bias20 is not None else '—'
        inst_str = f'{inst5:+,}張' if inst5 is not None else '無資料'
        self._record_tool(
            tools_used,
            'get_tw_stock_detail',
            {'code': norm},
            f'{norm} {name} 收 {close:.2f}（{chg_pct:+.2f}%），MA20乖離 {b20_str}，近5日法人 {inst_str}',
        )
        return result

    def _read_us_screener_safely(self) -> dict | None:
        """優先讀取本機快取或進行中之掃描結果，避免 AI 決策時阻塞數分鐘。"""
        if self.us_market is None:
            return None
        # 1. 若為真實 UsMarketService 且有本機 sp500-screener.json 快取或掃描中結果，直接讀取
        cache_dir = getattr(self.us_market, 'cache_dir', None)
        if isinstance(cache_dir, Path):
            scan_rows = getattr(self.us_market, '_scan_rows', None)
            if isinstance(scan_rows, list) and scan_rows:
                return {'rows': list(scan_rows), 'updatedAt': getattr(self.us_market, '_scan_updated_at', '')}
            cache_file = cache_dir / 'sp500-screener.json'
            if cache_file.exists():
                try:
                    doc = json.loads(cache_file.read_text(encoding='utf-8'))
                    if isinstance(doc, dict) and doc.get('rows'):
                        return doc
                except Exception:
                    pass
        # 2. 退回呼叫 get_screener(force_refresh=False)（真實服務最多等前 36 檔 3 秒，測試 mock 直接回傳）
        if hasattr(self.us_market, 'get_screener'):
            try:
                doc = self.us_market.get_screener(force_refresh=False)
                if isinstance(doc, dict):
                    return doc
            except Exception:
                return None
        return None

    def _tool_screen_us_sp500(self, args: dict, tools_used: list[dict]) -> dict:
        mode = str(args.get('mode') or 'smart_money').strip().lower()
        if mode not in ('smart_money', 'dip_buy'):
            mode = 'smart_money'
        limit = max(1, min(25, _safe_int(args.get('limit'), 12)))

        doc = self._read_us_screener_safely()
        rows = list(doc.get('rows') or []) if isinstance(doc, dict) else []
        if not rows:
            res = {'mode': mode, 'updatedAt': '', 'candidates': []}
            self._record_tool(
                tools_used,
                'screen_us_sp500',
                {'mode': mode, 'limit': limit},
                '美股 S&P 500 篩選尚無快取資料',
            )
            return res

        if mode == 'dip_buy':
            ranked = sorted(
                rows,
                key=lambda r: (
                    1 if r.get('dipPass') else 0,
                    _safe_float(r.get('dipScore'), 0.0) or 0.0,
                    -(_safe_float(r.get('changePct'), 0.0) or 0.0),
                ),
                reverse=True,
            )
        else:
            ranked = sorted(
                rows,
                key=lambda r: (
                    1 if r.get('smartPass') else 0,
                    _safe_float(r.get('smartScore'), 0.0) or 0.0,
                    _safe_float(r.get('cmf20'), -1.0) or -1.0,
                ),
                reverse=True,
            )

        picked = [
            {
                'code': r.get('code', ''),
                'name': r.get('name', ''),
                'sector': r.get('sector', ''),
                'market': 'US',
                'price': r.get('price'),
                'changePct': r.get('changePct'),
                'ret20Pct': r.get('ret20Pct'),
                'rsi14': r.get('rsi14'),
                'cmf20': r.get('cmf20'),
                'smartPass': bool(r.get('smartPass')),
                'smartScore': r.get('smartScore', 0),
                'dipPass': bool(r.get('dipPass')),
                'dipScore': r.get('dipScore', 0),
                'overallLabel': r.get('overallLabel', ''),
                'overallTone': r.get('overallTone', 'neutral'),
            }
            for r in ranked[:limit]
            if isinstance(r, dict) and r.get('code')
        ]
        result = {
            'mode': mode,
            'updatedAt': str(doc.get('updatedAt') or ''),
            'totalScanned': len(rows),
            'candidates': picked,
        }
        top_hint = '、'.join(
            f"{c['code']}({c['smartScore'] if mode == 'smart_money' else c['dipScore']}分)"
            for c in picked[:3]
        )
        summary = f"美股S&P500({mode})篩出 {len(picked)} 檔（母體 {len(rows)} 檔）"
        if top_hint:
            summary += f"：{top_hint}"
        self._record_tool(tools_used, 'screen_us_sp500', {'mode': mode, 'limit': limit}, summary)
        return result

    def _tool_get_us_stock_detail(self, args: dict, tools_used: list[dict]) -> dict:
        raw_code = str(args.get('code') or '').strip().upper()
        norm, mkt = _normalize_symbol(raw_code)
        if mkt != 'US':
            res = {'code': raw_code, 'available': False, 'error': '非有效美股代號'}
            self._record_tool(tools_used, 'get_us_stock_detail', {'code': raw_code}, f'{raw_code} 非有效美股代號')
            return res
        if self.us_market is None:
            res = {'code': norm, 'available': False, 'error': '未掛載美股詳情服務'}
            self._record_tool(tools_used, 'get_us_stock_detail', {'code': norm}, f'{norm} 美股詳情服務未啟用')
            return res

        try:
            detail = self.us_market.get_detail(norm, force_refresh=False)
        except Exception as exc:
            err = _sanitize_error(str(exc))
            res = {'code': norm, 'available': False, 'error': err}
            self._record_tool(tools_used, 'get_us_stock_detail', {'code': norm}, f'{norm} 查詢失敗：{err[:60]}')
            return res

        tech = detail.get('tech') if isinstance(detail, dict) else {}
        if not isinstance(tech, dict) or not tech:
            res = {'code': norm, 'available': False, 'error': '無美股技術指標資料'}
            self._record_tool(tools_used, 'get_us_stock_detail', {'code': norm}, f'{norm} 無技術指標資料')
            return res

        rsi_val = (tech.get('rsi') or {}).get('value') if isinstance(tech.get('rsi'), dict) else None
        overall = tech.get('overall') if isinstance(tech.get('overall'), dict) else {}
        result = {
            'code': norm,
            'name': str(detail.get('name') or norm),
            'sector': str(detail.get('sector') or ''),
            'available': True,
            'price': tech.get('price'),
            'changePct': tech.get('changePct'),
            'ret20Pct': tech.get('ret20Pct'),
            'ma5': tech.get('ma5'),
            'ma20': tech.get('ma20'),
            'ma60': tech.get('ma60'),
            'ma200': tech.get('ma200'),
            'bias20Pct': tech.get('bias20Pct'),
            'rsi14': rsi_val,
            'cmf20': tech.get('cmf20'),
            'macdStatus': (tech.get('macd') or {}).get('status', ''),
            'macdTone': (tech.get('macd') or {}).get('tone', 'neutral'),
            'smartMoney': tech.get('smartMoney') or {},
            'dipBuy': tech.get('dipBuy') or {},
            'range52w': tech.get('range52w') or {},
            'overallLabel': overall.get('label', ''),
            'overallTone': overall.get('tone', 'neutral'),
        }
        self._record_tool(
            tools_used,
            'get_us_stock_detail',
            {'code': norm},
            f"{norm} 收 {result['price']} USD（{result['changePct'] or 0:+.2f}%），RSI {rsi_val if rsi_val is not None else '—'}，{result['overallLabel'] or '已讀取'}",
        )
        return result

    def _tool_get_daily_briefing(self, tools_used: list[dict]) -> dict:
        if self.briefing is None or not hasattr(self.briefing, 'read_report'):
            res = {'available': False, 'message': '每日晨報服務未掛載'}
            self._record_tool(tools_used, 'get_daily_briefing', {}, '每日晨報服務未掛載')
            return res
        try:
            report = self.briefing.read_report()
        except Exception as exc:
            err = _sanitize_error(str(exc))
            res = {'available': False, 'message': err}
            self._record_tool(tools_used, 'get_daily_briefing', {}, f'晨報讀取失敗：{err[:50]}')
            return res

        if not isinstance(report, dict):
            res = {'available': False, 'message': '尚未產生每日晨報'}
            self._record_tool(tools_used, 'get_daily_briefing', {}, '尚未產生每日晨報')
            return res

        indices = [
            {
                'symbol': x.get('symbol', ''),
                'name': x.get('name', ''),
                'market': x.get('market', ''),
                'price': x.get('price'),
                'changePct': x.get('changePct'),
            }
            for x in (report.get('indices') or [])[:8]
            if isinstance(x, dict)
        ]
        news_stocks = [
            {
                'code': x.get('code', ''),
                'name': x.get('name', ''),
                'market': x.get('market', ''),
                'price': x.get('price'),
                'changePct': x.get('changePct'),
                'mentionedIn': x.get('mentionedIn', ''),
            }
            for x in (report.get('newsStocks') or [])[:8]
            if isinstance(x, dict)
        ]
        headlines = [
            {
                'category': n.get('category', ''),
                'source': n.get('source', ''),
                'title': n.get('title', ''),
            }
            for n in (report.get('news') or [])[:8]
            if isinstance(n, dict)
        ]
        summary_lines = [str(s) for s in (report.get('summary') or [])[:5]]
        result = {
            'available': True,
            'date': str(report.get('date') or ''),
            'generatedAt': str(report.get('generatedAt') or ''),
            'summary': summary_lines,
            'indices': indices,
            'newsStocks': news_stocks,
            'headlines': headlines,
        }
        self._record_tool(
            tools_used,
            'get_daily_briefing',
            {},
            f"讀取 {result['date'] or '最新'} 晨報（{len(summary_lines)} 條摘要、{len(news_stocks)} 檔焦點股）",
        )
        return result

    def _tool_get_watchlist_summary(self, tools_used: list[dict]) -> dict:
        if self.watchlist is None or not hasattr(self.watchlist, 'get_state'):
            res = {'available': False, 'folders': [], 'analysisItems': []}
            self._record_tool(tools_used, 'get_watchlist_summary', {}, '自選收藏夾服務未掛載')
            return res
        try:
            state = self.watchlist.get_state()
        except Exception as exc:
            err = _sanitize_error(str(exc))
            res = {'available': False, 'error': err, 'folders': [], 'analysisItems': []}
            self._record_tool(tools_used, 'get_watchlist_summary', {}, f'自選收藏夾讀取失敗：{err[:50]}')
            return res

        cfg = state.get('config') if isinstance(state, dict) else {}
        folders_out = []
        unique_codes: set[str] = set()
        for f in (cfg.get('folders') or []) if isinstance(cfg, dict) else []:
            if not isinstance(f, dict):
                continue
            codes = [str(it.get('code') or '').upper() for it in (f.get('items') or []) if isinstance(it, dict) and it.get('code')]
            unique_codes.update(codes)
            folders_out.append({'name': str(f.get('name') or ''), 'codes': codes[:20]})

        analysis = state.get('analysis') if isinstance(state, dict) else None
        analysis_items = []
        if isinstance(analysis, dict):
            for it in (analysis.get('items') or [])[:20]:
                if not isinstance(it, dict) or not it.get('code'):
                    continue
                analysis_items.append({
                    'code': str(it.get('code') or '').upper(),
                    'name': str(it.get('name') or ''),
                    'market': 'TW' if it.get('isTw', VALID_TW_CODE_RE.fullmatch(str(it.get('code') or ''))) else 'US',
                    'price': it.get('price'),
                    'changePct': it.get('changePct'),
                    'overall': it.get('overall') or {},
                    'tdcc': it.get('tdcc') or {},
                    'inst': it.get('inst') or {},
                    'shortMa': it.get('shortMa') or {},
                    'filterFlags': it.get('filterFlags') or [],
                })

        result = {
            'available': True,
            'folders': folders_out,
            'autoStocks': list(cfg.get('autoStocks') or []) if isinstance(cfg, dict) else [],
            'analysisDate': str(analysis.get('date') or '') if isinstance(analysis, dict) else '',
            'analysisItems': analysis_items,
        }
        self._record_tool(
            tools_used,
            'get_watchlist_summary',
            {},
            f"收藏夾 {len(folders_out)} 組共 {len(unique_codes)} 檔，六維分析 {len(analysis_items)} 檔",
        )
        return result

    def _tool_get_channel_strategies(self, args: dict, tools_used: list[dict]) -> dict:
        limit = max(1, min(15, _safe_int(args.get('limit'), 10)))
        if self.channels is None or not hasattr(self.channels, 'get_all_latest_strategies'):
            res = {'available': False, 'strategies': []}
            self._record_tool(tools_used, 'get_channel_strategies', {'limit': limit}, '訂閱頻道服務未掛載')
            return res
        try:
            raw_list = self.channels.get_all_latest_strategies(limit=limit) or []
        except Exception as exc:
            err = _sanitize_error(str(exc))
            res = {'available': False, 'error': err, 'strategies': []}
            self._record_tool(tools_used, 'get_channel_strategies', {'limit': limit}, f'頻道策略讀取失敗：{err[:50]}')
            return res

        items = []
        for s in raw_list[:limit]:
            if not isinstance(s, dict):
                continue
            tickers = [
                {
                    'code': str(t.get('code') or '').upper(),
                    'name': str(t.get('name') or ''),
                    'market': str(t.get('market') or ''),
                    'note': str(t.get('note') or ''),
                }
                for t in (s.get('tickers') or [])[:8]
                if isinstance(t, dict) and t.get('code')
            ]
            items.append({
                'channelName': str(s.get('channelName') or ''),
                'videoTitle': str(s.get('videoTitle') or ''),
                'publishedAt': str(s.get('publishedAt') or ''),
                'stance': str(s.get('stance') or '中性觀望'),
                'coreThesis': str(s.get('coreThesis') or '')[:260],
                'tickers': tickers,
                'entryConditions': list(s.get('entryConditions') or [])[:4],
                'riskControls': list(s.get('riskControls') or [])[:4],
            })
        result = {'available': True, 'count': len(items), 'strategies': items}
        self._record_tool(
            tools_used,
            'get_channel_strategies',
            {'limit': limit},
            f"讀取 {len(items)} 則訂閱頻道最新策略卡",
        )
        return result

    def _tool_get_live_quotes(
        self,
        args: dict,
        tools_used: list[dict],
        quote_cache: dict[str, dict | None],
    ) -> dict:
        raw_codes = args.get('codes')
        if isinstance(raw_codes, str):
            raw_codes = re.split(r'[\s,，、;]+', raw_codes)
        if not isinstance(raw_codes, list):
            raw_codes = []

        norm_codes: list[str] = []
        for c in raw_codes:
            norm, _ = _normalize_symbol(str(c or ''))
            if norm and norm not in norm_codes:
                norm_codes.append(norm)
        norm_codes = norm_codes[:20]

        quotes_out: dict[str, dict] = {}
        missing: list[str] = []
        for c in norm_codes:
            if c in quote_cache and quote_cache[c]:
                quotes_out[c] = quote_cache[c]
            else:
                missing.append(c)

        if missing and self.live_quotes is not None and hasattr(self.live_quotes, 'fetch_batch'):
            try:
                batch = self.live_quotes.fetch_batch(missing, manual=True)
                fetched = (batch.get('quotes') or {}) if isinstance(batch, dict) else {}
                for c, q in fetched.items():
                    if isinstance(q, dict) and (_safe_float(q.get('price'), 0.0) or 0.0) > 0:
                        norm_c, mkt_c = _normalize_symbol(c)
                        if norm_c:
                            enriched = {**q, 'code': norm_c, 'market': mkt_c, 'name': self._stock_name(norm_c)}
                            quotes_out[norm_c] = enriched
                            quote_cache[norm_c] = enriched
            except Exception:
                pass

        for c in norm_codes:
            if c not in quotes_out:
                q = self._safe_get_quote(c, quote_cache)
                if q:
                    quotes_out[c] = q

        compact = {
            c: {
                'price': q.get('price'),
                'changePct': q.get('changePct'),
                'marketState': q.get('marketState', ''),
                'tradeTime': q.get('tradeTime', ''),
            }
            for c, q in quotes_out.items()
        }
        self._record_tool(
            tools_used,
            'get_live_quotes',
            {'codes': norm_codes},
            f"查詢 {len(norm_codes)} 檔報價，取得 {len(compact)} 筆",
        )
        return {'quotes': compact}

    def call_tool(
        self,
        slot: dict,
        tool_name: str,
        args: dict | None,
        tools_used: list[dict],
        fx_rate: float | None = None,
        quote_cache: dict[str, dict | None] | None = None,
    ) -> dict:
        """依 aiConfig.tools 權限開關安全呼叫單一 App 工具。"""
        ai_cfg = self._get_ai_config(slot)
        gate_key = TOOL_GATE_MAP.get(tool_name)
        if not gate_key:
            return {'error': f'未知工具：{tool_name}'}
        if not ai_cfg['tools'].get(gate_key, True):
            return {'error': f'工具 {tool_name}（{gate_key}）已在存檔設定中關閉'}

        clean_args = args if isinstance(args, dict) else {}
        fx = fx_rate if fx_rate is not None else self._get_fx_rate()
        qcache = quote_cache if quote_cache is not None else {}

        if tool_name == 'get_portfolio_state':
            return self._tool_get_portfolio_state(slot, fx, tools_used)
        if tool_name == 'screen_tw_tdcc_chips':
            return self._tool_screen_tw_tdcc_chips(clean_args, tools_used)
        if tool_name == 'get_tw_stock_detail':
            return self._tool_get_tw_stock_detail(clean_args, tools_used)
        if tool_name == 'screen_us_sp500':
            return self._tool_screen_us_sp500(clean_args, tools_used)
        if tool_name == 'get_us_stock_detail':
            return self._tool_get_us_stock_detail(clean_args, tools_used)
        if tool_name == 'get_daily_briefing':
            return self._tool_get_daily_briefing(tools_used)
        if tool_name == 'get_watchlist_summary':
            return self._tool_get_watchlist_summary(tools_used)
        if tool_name == 'get_channel_strategies':
            return self._tool_get_channel_strategies(clean_args, tools_used)
        if tool_name == 'get_live_quotes':
            return self._tool_get_live_quotes(clean_args, tools_used, qcache)
        return {'error': f'未支援工具：{tool_name}'}

    # ------------------------------------------------------------------
    # Engine A: Gemini Multi-Turn Function Calling
    # ------------------------------------------------------------------

    def _build_system_instruction(self, slot: dict, ai_cfg: dict, fx_rate: float, tools_available=True) -> str:
        market = str(slot.get('market') or 'TW').upper()
        currency = str(slot.get('currency') or ('USD' if market == 'US' else 'TWD')).upper()
        style = ai_cfg['style']
        style_info = STYLE_PROFILES[style]
        g = ai_cfg['guardrails']
        market_desc = {
            'TW': '純台股（僅限 4 碼台股或 00 開頭台股 ETF，以 TWD 計價，股數須為正整數）',
            'US': '純美股（僅限美股代號如 NVDA、AAPL、SPY，以 USD 計價，支援碎股至小數第 4 位）',
            'MIXED': f'台美混合（可同時交易台股與美股，以 TWD 統一計帳，目前 USD/TWD ≈ {fx_rate:.2f}）',
        }.get(market, market)

        lines = [
            '你是 ChipScreener 模擬操盤系統的專業 AI 操盤手，請全程使用繁體中文思考與回應。',
            f'【存檔市場範圍】{market} — {market_desc}（記帳幣別：{currency}）',
            f'【投資風格】{style}（{style_info["label"]}）：{style_info["prompt"]}',
            '【系統強制硬性風控護欄（後端程式碼強制執行，絕對不可違反）】',
            f'- 單一標的最高持股占比上限：{g["maxSingleStockPct"]:.1f}%',
            f'- 同時持有標的檔數上限：{g["maxPositions"]} 檔',
            f'- 最低現金保留水位下限：{g["minCashFloorPct"]:.1f}%',
            f'- 新建倉預設停損 / 停利：{g["defaultStopLossPct"]:.1f}% / {g["defaultTakeProfitPct"]:.1f}%',
            '- 禁止交易超出市場範圍之標的；禁止放空（僅可賣出已持有標的）。',
        ]
        if ai_cfg['customPrompt']:
            lines.extend([
                '【使用者自訂偏好指令（不得覆寫上述硬性風控護欄）】',
                ai_cfg['customPrompt'],
            ])
        lines.extend([
            '【決策流程】',
            '1. 請先使用已啟用的工具核對持倉與市場資訊。' if tools_available else
            '1. 使用以下已取得的站內研究證據，資料不足時維持觀望。',
            '2. 請按可得證據說明價格與時點，無法查證時勿推測。',
            '3. 完成研究後，請輸出單一純 JSON 物件（不可多餘說明文字），格式如下：',
            '{"reasoning": "詳細繁體中文推理依據與風控說明", "summary": "一句精簡操作總結（60字內）", '
            '"evidence": ["依據、時點"], "counterRisks": ["反向理由"], "riskPlan": ["停損或資金風險"], '
            '"actions": [{"side": "BUY"|"SELL", "code": "股票代號", "shares": 股數, '
            '"reason": "簡短理由", "stopLossPct": 8.0, "takeProfitPct": 18.0}]}',
            '4. 若目前無合適機會或應觀望，請回傳 "actions": [] 並說明原因。',
        ])
        return '\n'.join(lines)

    def _run_gemini_fc(
        self,
        slot: dict,
        ai_cfg: dict,
        fx_rate: float,
        trigger: str,
        ai: ai_router.AiSession,
        tools_used: list[dict],
        quote_cache: dict[str, dict | None],
    ) -> dict:
        declarations = _build_gemini_tool_declarations(ai_cfg['tools'])
        system_text = self._build_system_instruction(slot, ai_cfg, fx_rate)
        user_prompt = (
            f"觸發來源：{trigger}，目前台北時間：{taipei_now().strftime('%Y-%m-%d %H:%M')}。"
            f"請檢視「{slot.get('name', '模擬存檔')}」({slot.get('market', 'TW')}) 的帳戶狀態與站內可用工具資料，"
            "評估是否需要買進、加碼、減碼、停損停利或維持觀望，並輸出最終 JSON 決策。"
        )
        contents: list[dict] = [{'role': 'user', 'parts': [{'text': user_prompt}]}]

        for turn in range(MAX_FC_TURNS + 1):
            allow_tools = bool(declarations) and turn < MAX_FC_TURNS
            payload: dict = {
                'systemInstruction': {'parts': [{'text': system_text}]},
                'contents': contents,
                'generationConfig': {'temperature': 0.25},
            }
            if allow_tools:
                payload['tools'] = [{'functionDeclarations': declarations}]

            resp_data = ai.send(payload, GEMINI_TIMEOUT_SEC)
            if not isinstance(resp_data, dict):
                raise RuntimeError('AI 回應格式無效')

            candidates = resp_data.get('candidates') or []
            if not candidates:
                raise RuntimeError('Gemini 回傳空候選結果')
            content = candidates[0].get('content') or {}
            parts = content.get('parts') or []
            if not isinstance(parts, list) or not parts:
                raise RuntimeError('Gemini 回傳空內容')

            fc_parts = [p for p in parts if isinstance(p, dict) and isinstance(p.get('functionCall'), dict)]
            if fc_parts and turn < MAX_FC_TURNS:
                contents.append({'role': 'model', 'parts': parts})
                fn_responses: list[dict] = []
                for p in fc_parts:
                    fc = p['functionCall']
                    fn_name = str(fc.get('name') or '').strip()
                    fn_args = fc.get('args') if isinstance(fc.get('args'), dict) else {}
                    fn_result = self.call_tool(
                        slot,
                        fn_name,
                        fn_args,
                        tools_used,
                        fx_rate=fx_rate,
                        quote_cache=quote_cache,
                    )
                    fn_responses.append({
                        'functionResponse': {
                            'name': fn_name,
                            'response': {'result': fn_result},
                        }
                    })
                if turn == MAX_FC_TURNS - 1:
                    fn_responses.append({
                        'text': '已達工具呼叫上限，請根據目前已取得之資訊立即輸出最終 JSON 決策（不要再呼叫工具）。'
                    })
                contents.append({'role': 'user', 'parts': fn_responses})
                continue

            text_chunks = [str(p.get('text') or '') for p in parts if isinstance(p, dict) and p.get('text')]
            full_text = '\n'.join(text_chunks).strip()
            parsed = _parse_json_object_from_text(full_text)
            if not isinstance(parsed, dict):
                raise RuntimeError('Gemini 回應無法解析為有效決策 JSON')

            return self._normalize_ai_decision(parsed)

        raise RuntimeError('Gemini 多輪工具呼叫超過上限仍未產出最終決策')

    def _normalize_ai_decision(self, raw):
        actions = raw.get('actions')
        if not isinstance(actions, list) or any(not isinstance(item, dict) for item in actions):
            raise RuntimeError('AI 決策缺少有效的 actions')
        summary = str(raw.get('summary') or '').strip()[:120]
        reasoning = str(raw.get('reasoning') or '').strip()[:4000]
        if not summary and not reasoning:
            raise RuntimeError('AI 決策缺少說明')
        return {
            'summary': summary or '模擬決策已完成',
            'reasoning': reasoning or summary,
            'actions': actions,
            'analysis': {name: ai_router.text_items(raw.get(name))
                         for name in ('evidence', 'counterRisks', 'riskPlan')},
        }

    def _run_provider_decision(self, ai, slot, ai_cfg, fx_rate, trigger, tools_used, quote_cache):
        market = str(slot.get('market') or 'TW').upper()
        tool_requests = [
            ('get_portfolio_state', {}, True),
            ('screen_tw_tdcc_chips', {'weeks': 2, 'min_pp': 0.2, 'limit': 8}, market in ('TW', 'MIXED')),
            ('screen_us_sp500', {'mode': 'smart_money', 'limit': 8}, market in ('US', 'MIXED')),
            ('get_watchlist_summary', {}, True),
            ('get_daily_briefing', {}, True),
            ('get_channel_strategies', {'limit': 5}, True),
        ]
        evidence = {}
        for tool, args, applicable in tool_requests:
            if applicable and ai_cfg['tools'].get(TOOL_GATE_MAP[tool]):
                data = self.call_tool(slot, tool, args, tools_used, fx_rate, quote_cache)
                serialized = json.dumps(data, ensure_ascii=False, default=str)
                evidence[tool] = data if len(serialized) <= 6000 else {
                    'summary': tools_used[-1]['summary'] if tools_used else '',
                    'note': '資料過長，僅提供站內摘要',
                }
        prompt = self._build_system_instruction(slot, ai_cfg, fx_rate, tools_available=False)
        prompt += '\n觸發來源：' + trigger + '\n研究證據：' + json.dumps(evidence, ensure_ascii=False, default=str)
        return self._normalize_ai_decision(ai.generate(prompt))

    # ------------------------------------------------------------------
    # Engine B: Deterministic Multi-Factor Rule Fallback
    # ------------------------------------------------------------------

    def _run_rule_fallback(
        self,
        slot: dict,
        ai_cfg: dict,
        fx_rate: float,
        tools_used: list[dict],
        quote_cache: dict[str, dict | None],
        fallback_note: str = '',
    ) -> dict:
        slot_market = str(slot.get('market') or 'TW').upper()
        slot_currency = str(slot.get('currency') or ('USD' if slot_market == 'US' else 'TWD')).upper()
        tools_cfg = ai_cfg['tools']
        guardrails = ai_cfg['guardrails']
        style = ai_cfg['style']
        profile = STYLE_PROFILES[style]

        # 1. 確定性呼叫所有已啟用且相關的站內工具
        portfolio_data = None
        if tools_cfg.get('portfolio', True):
            portfolio_data = self.call_tool(slot, 'get_portfolio_state', {}, tools_used, fx_rate, quote_cache)
        else:
            metrics = self._compute_portfolio_snapshot(slot, fx_rate)
            portfolio_data = {
                'cash': metrics['cash'],
                'totalEquity': metrics['totalEquity'],
                'positions': metrics.get('positionsList') or [],
            }

        tdcc_data = None
        if slot_market in ('TW', 'MIXED') and tools_cfg.get('tdccScreener', True):
            tdcc_data = self.call_tool(
                slot,
                'screen_tw_tdcc_chips',
                {'weeks': 2, 'min_pp': 0.2, 'limit': 12},
                tools_used,
                fx_rate,
                quote_cache,
            )

        us_data = None
        if slot_market in ('US', 'MIXED') and tools_cfg.get('usScreener', True):
            us_mode = 'dip_buy' if style == 'conservative' else 'smart_money'
            us_data = self.call_tool(
                slot,
                'screen_us_sp500',
                {'mode': us_mode, 'limit': 12},
                tools_used,
                fx_rate,
                quote_cache,
            )

        wl_data = None
        if tools_cfg.get('watchlist', True):
            wl_data = self.call_tool(slot, 'get_watchlist_summary', {}, tools_used, fx_rate, quote_cache)

        ch_data = None
        if tools_cfg.get('channels', True):
            ch_data = self.call_tool(slot, 'get_channel_strategies', {'limit': 10}, tools_used, fx_rate, quote_cache)

        brief_data = None
        if tools_cfg.get('briefing', True):
            brief_data = self.call_tool(slot, 'get_daily_briefing', {}, tools_used, fx_rate, quote_cache)

        # 2. 多因子評分（僅納入符合存檔市場範圍之標的）
        def market_allowed(sym_mkt: str) -> bool:
            return slot_market == 'MIXED' or slot_market == sym_mkt

        score_map: dict[str, dict] = {}

        def add_signal(code_raw: str, pts: float, reason: str, name_hint: str = '', price_hint: float | None = None) -> None:
            norm, sym_mkt = _normalize_symbol(code_raw)
            if not norm or not market_allowed(sym_mkt):
                return
            entry = score_map.setdefault(norm, {
                'code': norm,
                'market': sym_mkt,
                'name': name_hint or self._stock_name(norm),
                'score': 0.0,
                'reasons': [],
                'priceHint': None,
            })
            entry['score'] += pts
            if reason and reason not in entry['reasons']:
                entry['reasons'].append(reason)
            if name_hint and entry['name'] == norm:
                entry['name'] = name_hint
            if price_hint and price_hint > 0 and entry['priceHint'] is None:
                entry['priceHint'] = float(price_hint)

        if isinstance(tdcc_data, dict):
            for c in tdcc_data.get('candidates') or []:
                delta = _safe_float(c.get('totalDeltaPp400'), 0.0) or 0.0
                pts = 28.0 + min(22.0, delta * 10.0)
                add_signal(
                    c.get('code', ''),
                    pts,
                    f"集保400張連升{tdcc_data.get('weeksChecked', 2)}週(+{delta:.2f}pp)",
                    name_hint=str(c.get('name') or ''),
                )

        if isinstance(us_data, dict):
            for c in us_data.get('candidates') or []:
                smart_score = _safe_float(c.get('smartScore'), 0.0) or 0.0
                dip_score = _safe_float(c.get('dipScore'), 0.0) or 0.0
                if c.get('smartPass'):
                    add_signal(
                        c.get('code', ''),
                        30.0 + smart_score * 0.25,
                        f"美股機構吸籌達標({smart_score:.0f}分)",
                        name_hint=str(c.get('name') or ''),
                        price_hint=_safe_float(c.get('price')),
                    )
                elif smart_score >= 50:
                    add_signal(
                        c.get('code', ''),
                        18.0 + smart_score * 0.15,
                        f"美股資金動能偏強({smart_score:.0f}分)",
                        name_hint=str(c.get('name') or ''),
                        price_hint=_safe_float(c.get('price')),
                    )
                if c.get('dipPass'):
                    add_signal(
                        c.get('code', ''),
                        22.0 + dip_score * 0.2,
                        f"美股超跌修正浮現({dip_score:.0f}分)",
                        name_hint=str(c.get('name') or ''),
                        price_hint=_safe_float(c.get('price')),
                    )

        if isinstance(wl_data, dict):
            for it in wl_data.get('analysisItems') or []:
                code = str(it.get('code') or '')
                overall = it.get('overall') or {}
                tone = str(overall.get('tone') or 'neutral')
                tdcc_tone = str((it.get('tdcc') or {}).get('tone') or 'neutral')
                inst_tone = str((it.get('inst') or {}).get('tone') or 'neutral')
                price_h = _safe_float(it.get('price'))
                nm = str(it.get('name') or '')
                if tone == 'up':
                    add_signal(code, 26.0, f"六維分析偏多({overall.get('label', '偏多')})", nm, price_h)
                elif tone == 'down':
                    add_signal(code, -26.0, f"六維分析轉弱({overall.get('label', '偏弱')})", nm, price_h)
                if tdcc_tone == 'up':
                    add_signal(code, 10.0, '集保大戶買超', nm, price_h)
                elif tdcc_tone == 'down':
                    add_signal(code, -10.0, '集保大戶賣超', nm, price_h)
                if inst_tone == 'up':
                    add_signal(code, 10.0, '三大法人買超', nm, price_h)
                elif inst_tone == 'down':
                    add_signal(code, -10.0, '三大法人賣超', nm, price_h)

        if isinstance(ch_data, dict):
            for s in ch_data.get('strategies') or []:
                stance = str(s.get('stance') or '中性觀望')
                ch_name = str(s.get('channelName') or '訂閱頻道')[:12]
                for t in s.get('tickers') or []:
                    if stance == '偏多':
                        add_signal(t.get('code', ''), 22.0, f'頻道「{ch_name}」偏多觀點', str(t.get('name') or ''))
                    elif stance == '偏空':
                        add_signal(t.get('code', ''), -26.0, f'頻道「{ch_name}」偏空警戒', str(t.get('name') or ''))

        if isinstance(brief_data, dict) and brief_data.get('available'):
            for ns in brief_data.get('newsStocks') or []:
                chg = _safe_float(ns.get('changePct'), 0.0) or 0.0
                if 0.5 <= chg <= 6.5:
                    add_signal(
                        ns.get('code', ''),
                        10.0,
                        f"晨報焦點轉強({chg:+.1f}%)",
                        str(ns.get('name') or ''),
                        _safe_float(ns.get('price')),
                    )
                elif chg <= -4.0:
                    add_signal(
                        ns.get('code', ''),
                        -10.0,
                        f"晨報焦點走弱({chg:+.1f}%)",
                        str(ns.get('name') or ''),
                        _safe_float(ns.get('price')),
                    )

        # 3. 對排名靠前之台股候選補充個股詳情確認（若啟用 twDetail 且有掛載服務）
        if tools_cfg.get('twDetail', True) and self.tw_market is not None:
            tw_top = sorted(
                [v for v in score_map.values() if v['market'] == 'TW' and v['score'] >= 20],
                key=lambda x: x['score'],
                reverse=True,
            )[:2]
            for item in tw_top:
                det = self.call_tool(slot, 'get_tw_stock_detail', {'code': item['code']}, tools_used, fx_rate, quote_cache)
                if det.get('available'):
                    bias20 = _safe_float(det.get('bias20Pct'))
                    inst5 = _safe_float(det.get('inst5Total'))
                    if bias20 is not None and bias20 >= 0 and (inst5 is None or inst5 >= 0):
                        add_signal(item['code'], 12.0, f"站穩月線(乖離{bias20:+.1f}%)")
                    elif bias20 is not None and bias20 < -3.0 and (inst5 is not None and inst5 < 0):
                        add_signal(item['code'], -16.0, '跌破月線且法人賣超')

        # 4. 收集需要查詢報價的代號（現有持倉 + 高分候選）
        held_positions = portfolio_data.get('positions') or []
        held_codes = [str(p['code']).upper() for p in held_positions if p.get('code')]
        ranked_buys = sorted(
            [v for v in score_map.values() if v['score'] >= profile['buyScoreMin']],
            key=lambda x: x['score'],
            reverse=True,
        )
        quote_targets = list(dict.fromkeys(held_codes + [c['code'] for c in ranked_buys[:6]]))
        if quote_targets and tools_cfg.get('liveQuotes', True):
            self.call_tool(slot, 'get_live_quotes', {'codes': quote_targets}, tools_used, fx_rate, quote_cache)

        # 5. 評估現有持倉 SELL 訊號（停損、停利、多因子轉空）
        actions: list[dict] = []
        sell_codes: set[str] = set()
        sl_thresh = min(profile['stopLossTriggerPct'], guardrails['defaultStopLossPct'] or profile['stopLossTriggerPct'])
        tp_thresh = min(profile['takeProfitTriggerPct'], guardrails['defaultTakeProfitPct'] or profile['takeProfitTriggerPct'])

        for pos in held_positions:
            code = str(pos.get('code') or '').upper()
            sym_mkt = str(pos.get('market') or _normalize_symbol(code)[1] or 'TW').upper()
            shares = float(_safe_float(pos.get('shares'), 0.0) or 0.0)
            avg_cost = float(_safe_float(pos.get('avgCost'), 0.0) or 0.0)
            if shares <= 0:
                continue
            q = self._safe_get_quote(code, quote_cache)
            cur_price = _safe_float((q or {}).get('price'), _safe_float(pos.get('currentPrice'), avg_cost)) or 0.0
            pnl_pct = ((cur_price - avg_cost) / avg_cost * 100.0) if (avg_cost > 0 and cur_price > 0) else 0.0
            sig = score_map.get(code)
            sig_score = sig['score'] if sig else 0.0

            sell_reason = ''
            sell_shares = 0.0
            if sl_thresh > 0 and pnl_pct <= -sl_thresh:
                sell_shares = shares
                sell_reason = f'觸及風格停損門檻（未實現 {pnl_pct:.1f}% <= -{sl_thresh:.1f}%），全數停損出清'
            elif tp_thresh > 0 and pnl_pct >= tp_thresh:
                raw_trim = shares * profile['takeProfitTrimRatio']
                sell_shares = _floor_tw_shares(raw_trim) if sym_mkt == 'TW' else _floor_us_shares(raw_trim)
                if sell_shares <= 0:
                    sell_shares = shares
                sell_reason = f'達停利目標（未實現 +{pnl_pct:.1f}% >= +{tp_thresh:.1f}%），分批獲利了結'
            elif sig_score <= -20.0:
                sell_shares = shares
                why = '、'.join((sig.get('reasons') or [])[:2])
                sell_reason = f'多因子訊號轉空（{sig_score:.0f}分：{why}），執行風險減碼出清'

            if sell_shares > 0:
                sell_codes.add(code)
                actions.append({
                    'side': 'SELL',
                    'code': code,
                    'shares': int(sell_shares) if sym_mkt == 'TW' else round(sell_shares, 4),
                    'reason': sell_reason,
                    'stopLossPct': None,
                    'takeProfitPct': None,
                })

        # 6. 評估新進場／加碼 BUY 訊號
        total_equity = float(_safe_float(portfolio_data.get('totalEquity'), 0.0) or 0.0)
        target_weight_pct = min(
            profile['maxTargetWeightPct'],
            guardrails['maxSingleStockPct'] * profile['targetWeightFactor'],
        )
        new_buy_count = 0
        for cand in ranked_buys:
            if new_buy_count >= profile['maxNewBuys']:
                break
            code = cand['code']
            if code in sell_codes:
                continue
            sym_mkt = cand['market']
            q = self._safe_get_quote(code, quote_cache)
            price = _safe_float((q or {}).get('price'), cand.get('priceHint')) or 0.0
            if price <= 0:
                continue

            target_val_base = total_equity * (target_weight_pct / 100.0)
            unit_base = _to_base_currency(price, sym_mkt, slot_currency, fx_rate)
            if unit_base <= 0:
                continue
            raw_shares = target_val_base / unit_base
            if sym_mkt == 'TW':
                shares = _floor_tw_shares(raw_shares)
                if shares >= 1000:
                    shares = (shares // 1000) * 1000
                elif shares >= 100:
                    shares = (shares // 100) * 100
                if shares < 1:
                    continue
            else:
                shares = _floor_us_shares(raw_shares)
                if shares < 0.0001:
                    continue

            reasons_text = '；'.join(cand['reasons'][:3])
            actions.append({
                'side': 'BUY',
                'code': code,
                'shares': shares,
                'reason': f"多因子評分 {cand['score']:.0f} 分：{reasons_text}",
                'stopLossPct': guardrails['defaultStopLossPct'] or None,
                'takeProfitPct': guardrails['defaultTakeProfitPct'] or None,
            })
            new_buy_count += 1

        # 7. 組合清晰繁體中文推理與摘要
        reason_parts: list[str] = []
        if fallback_note:
            reason_parts.append(fallback_note)
        reason_parts.append(
            f"本次採量化多因子規則引擎（風格：{profile['label']}，市場：{slot_market}），"
            f"共呼叫 {len(tools_used)} 項站內資料工具並評估 {len(score_map)} 檔候選標的與 {len(held_positions)} 檔既有持倉。"
        )
        if ranked_buys:
            top_txt = '、'.join(f"{c['code']} {c['name']}({c['score']:.0f}分)" for c in ranked_buys[:3])
            reason_parts.append(f"多因子高分候選：{top_txt}。")
        if actions:
            act_txt = '、'.join(f"{a['side']} {a['code']}×{a['shares']}" for a in actions)
            reason_parts.append(f"擬定操作指令：{act_txt}（將交由硬性風控護欄逐筆審核）。")
            summary = f"量化規則建議 {len(actions)} 筆操作：{act_txt}"
        else:
            reason_parts.append('目前無符合風格門檻之明確買賣訊號，維持現有配置與現金水位觀望。')
            summary = '量化規則評估完成：暫無符合門檻之操作，維持觀望'

        return {
            'reasoning': '\n'.join(reason_parts),
            'summary': summary[:120],
            'actions': actions,
        }

    # ------------------------------------------------------------------
    # 程式碼強制硬性風控護欄（不可被 Prompt 或 LLM 覆寫）
    # ------------------------------------------------------------------

    def enforce_guardrails(
        self,
        slot: dict,
        raw_actions: list[dict],
        fx_rate: float | None = None,
        quote_lookup: Callable[[str], dict | None] | None = None,
    ) -> tuple[list[dict], list[dict]]:
        """對每一筆擬定操作執行程式碼層級硬性風控檢核。

        回傳 (compliant_actions, guardrail_checks)。
        """
        fx = fx_rate if (fx_rate is not None and fx_rate > 0) else self._get_fx_rate()
        ai_cfg = self._get_ai_config(slot)
        guardrails = ai_cfg['guardrails']
        fees = dict(DEFAULT_FEES)
        if isinstance(slot.get('fees'), dict):
            fees.update(slot['fees'])

        slot_market = str(slot.get('market') or 'TW').upper()
        slot_currency = str(slot.get('currency') or ('USD' if slot_market == 'US' else 'TWD')).upper()

        max_single_pct = float(guardrails['maxSingleStockPct'])
        max_positions = int(guardrails['maxPositions'])
        min_cash_floor_pct = float(guardrails['minCashFloorPct'])
        default_sl_pct = float(guardrails['defaultStopLossPct'])
        default_tp_pct = float(guardrails['defaultTakeProfitPct'])

        qcache: dict[str, dict | None] = {}

        def get_quote(sym: str) -> dict | None:
            if quote_lookup is not None:
                if sym not in qcache:
                    try:
                        qcache[sym] = quote_lookup(sym)
                    except Exception:
                        qcache[sym] = None
                return qcache[sym]
            return self._safe_get_quote(sym, qcache)

        # 建立模擬帳戶狀態（跨同批次多筆指令持續更新，防止分拆繞過上限）
        sim_cash = float(_safe_float(slot.get('cash'), 0.0) or 0.0)
        sim_positions: dict[str, dict] = {}
        total_mv_base = 0.0
        for raw_code, pos in (slot.get('positions') or {}).items():
            if not isinstance(pos, dict):
                continue
            norm_c, mkt_c = _normalize_symbol(str(pos.get('code') or raw_code))
            sh = float(_safe_float(pos.get('shares'), 0.0) or 0.0)
            if not norm_c or sh <= 0:
                continue
            q = get_quote(norm_c)
            price = _safe_float((q or {}).get('price'), _safe_float(pos.get('lastPrice'), _safe_float(pos.get('avgCost'), 0.0))) or 0.0
            sim_positions[norm_c] = {
                'code': norm_c,
                'name': str(pos.get('name') or self._stock_name(norm_c)),
                'market': mkt_c,
                'shares': sh,
                'price': price,
            }
            total_mv_base += _to_base_currency(sh * price, mkt_c, slot_currency, fx)

        total_equity = max(sim_cash + total_mv_base, sim_cash, 0.0)
        min_cash_required = total_equity * (min_cash_floor_pct / 100.0)
        max_single_val_base = total_equity * (max_single_pct / 100.0)

        compliant_actions: list[dict] = []
        guardrail_checks: list[dict] = []

        for raw in (raw_actions or []):
            if not isinstance(raw, dict):
                continue
            side = str(raw.get('side') or '').strip().upper()
            raw_code = str(raw.get('code') or '').strip().upper()
            req_shares_raw = _safe_float(raw.get('shares'), 0.0) or 0.0
            reason = str(raw.get('reason') or '').strip()[:240]

            def reject(note: str, code_label: str = raw_code) -> None:
                guardrail_checks.append({
                    'code': code_label or 'UNKNOWN',
                    'side': side or 'UNKNOWN',
                    'requestedShares': round(req_shares_raw, 4),
                    'finalShares': 0,
                    'status': 'REJECTED',
                    'note': note,
                })

            if side not in ('BUY', 'SELL'):
                reject(f'無效買賣方向：{side}')
                continue

            code, sym_market = _normalize_symbol(raw_code)
            if not code:
                reject(f'無效股票代號：{raw_code}')
                continue

            if req_shares_raw <= 0:
                reject('申請股數須大於 0', code)
                continue

            # 1. 硬性市場範圍檢核
            if slot_market == 'TW' and sym_market != 'TW':
                reject(f'市場範圍不符：此存檔限台股 (TW)，禁止交易美股 {code}', code)
                continue
            if slot_market == 'US' and sym_market != 'US':
                reject(f'市場範圍不符：此存檔限美股 (US)，禁止交易台股 {code}', code)
                continue

            # 2. 硬性有效報價檢核
            quote = get_quote(code)
            price = _safe_float((quote or {}).get('price'), 0.0) or 0.0
            if price <= 0:
                reject(f'無法取得 {code} 有效報價，拒絕下單', code)
                continue
            name = str((quote or {}).get('name') or self._stock_name(code))

            # 3. SELL 硬性檢核：必須已持有，上限鎖定目前持股數
            if side == 'SELL':
                pos = sim_positions.get(code)
                held = float(pos['shares']) if (pos and pos.get('shares', 0) > 0) else 0.0
                if held <= 0:
                    reject(f'目前未持有 {code}，禁止放空或賣出', code)
                    continue

                req_q = _floor_tw_shares(req_shares_raw) if sym_market == 'TW' else _floor_us_shares(req_shares_raw)
                if req_q <= 0:
                    reject(f'賣出股數不足最小交易單位（申請 {req_shares_raw}）', code)
                    continue

                adjusted = False
                note_parts: list[str] = []
                final_shares = req_q
                if final_shares > held:
                    final_shares = _floor_tw_shares(held) if sym_market == 'TW' else _floor_us_shares(held)
                    adjusted = True
                    note_parts.append(f'賣出股數超過持股，自動下修至持有上限 {final_shares}')

                if final_shares <= 0:
                    reject('可賣出股數不足最小單位', code)
                    continue

                # 更新模擬狀態
                rem = held - final_shares
                if rem <= 1e-6:
                    sim_positions.pop(code, None)
                else:
                    sim_positions[code]['shares'] = rem
                net_native = _estimate_sell_net_native(final_shares * price, sym_market, code, fees)
                sim_cash += _to_base_currency(net_native, sym_market, slot_currency, fx)

                status = 'ADJUSTED' if adjusted else 'PASSED'
                note = '；'.join(note_parts) if note_parts else '通過賣出風控檢核'
                guardrail_checks.append({
                    'code': code,
                    'side': 'SELL',
                    'requestedShares': req_q,
                    'finalShares': final_shares,
                    'status': status,
                    'note': note,
                })
                compliant_actions.append({
                    'side': 'SELL',
                    'code': code,
                    'name': name,
                    'market': sym_market,
                    'shares': final_shares,
                    'estPrice': round(price, 4),
                    'stopLossPct': None,
                    'takeProfitPct': None,
                    'reason': reason or 'AI 賣出決策',
                    'guardrailAdjusted': adjusted,
                    'guardrailNote': note if adjusted else '',
                })
                continue

            # 4. BUY 硬性檢核：maxPositions + minCashFloorPct + maxSingleStockPct + 自動 SL/TP
            req_q = _floor_tw_shares(req_shares_raw) if sym_market == 'TW' else _floor_us_shares(req_shares_raw)
            if req_q <= 0:
                reject(f'買進股數不足最小交易單位（申請 {req_shares_raw}）', code)
                continue

            existing_pos = sim_positions.get(code)
            already_held = bool(existing_pos and existing_pos.get('shares', 0) > 0)
            active_pos_count = sum(1 for p in sim_positions.values() if p.get('shares', 0) > 0)

            if (not already_held) and active_pos_count >= max_positions:
                reject(f'已達同時持股檔數上限 ({active_pos_count}/{max_positions})，拒絕新建倉 {code}', code)
                continue

            # 4a. 單一標的最高持股占比上限（maxSingleStockPct）
            existing_shares = float(existing_pos['shares']) if already_held else 0.0
            existing_val_base = _to_base_currency(existing_shares * price, sym_market, slot_currency, fx)
            max_add_val_base = max(0.0, max_single_val_base - existing_val_base)
            unit_base = _to_base_currency(price, sym_market, slot_currency, fx)
            cap_by_weight_raw = (max_add_val_base / unit_base) if unit_base > 0 else 0.0
            cap_by_weight = _floor_tw_shares(cap_by_weight_raw) if sym_market == 'TW' else _floor_us_shares(cap_by_weight_raw)

            # 4b. 最低現金保留水位下限（minCashFloorPct，含預估買進手續費）
            max_spendable_base = max(0.0, sim_cash - min_cash_required)
            budget_native = _from_base_currency(max_spendable_base, sym_market, slot_currency, fx)
            if sym_market == 'TW':
                eff_rate = max(0.0, (_safe_float(fees.get('twBuyFeeRate'), 0.001425) or 0.0) * (_safe_float(fees.get('twFeeDiscount'), 1.0) or 1.0))
                min_fee = max(0.0, _safe_float(fees.get('twMinFee'), 20.0) or 0.0) if eff_rate > 0 else 0.0
            else:
                eff_rate = max(0.0, _safe_float(fees.get('usFeeRate'), 0.0) or 0.0)
                min_fee = max(0.0, _safe_float(fees.get('usMinFee'), 0.0) or 0.0)

            if budget_native <= 0:
                max_gross_native = 0.0
            else:
                g1 = budget_native / (1.0 + eff_rate)
                g2 = max(0.0, budget_native - min_fee) if min_fee > 0 else g1
                max_gross_native = min(g1, g2)

            cap_by_cash_raw = (max_gross_native / price) if price > 0 else 0.0
            cap_by_cash = _floor_tw_shares(cap_by_cash_raw) if sym_market == 'TW' else _floor_us_shares(cap_by_cash_raw)

            # 嚴格複驗實際含費總額 <= max_spendable_base，防止浮點誤差越線
            step = 1 if sym_market == 'TW' else 0.0001
            while cap_by_cash > 0:
                g_nat = cap_by_cash * price
                f_nat = _estimate_buy_fee_native(g_nat, sym_market, fees)
                g_base = round(_to_base_currency(g_nat, sym_market, slot_currency, fx), 2)
                f_base = round(_to_base_currency(f_nat, sym_market, slot_currency, fx), 2)
                if round(g_base + f_base, 2) <= max_spendable_base + 1e-6:
                    break
                cap_by_cash = (cap_by_cash - 1) if sym_market == 'TW' else _floor_us_shares(cap_by_cash - step)

            final_shares = min(req_q, cap_by_weight, cap_by_cash)
            note_parts = []
            if req_q > cap_by_weight:
                note_parts.append(f'單一標的上限 {max_single_pct:.1f}%（上限 {cap_by_weight} 股）')
            if req_q > cap_by_cash:
                note_parts.append(f'最低現金水位 {min_cash_floor_pct:.1f}%（可用上限 {cap_by_cash} 股）')

            if final_shares <= 0:
                reject('受硬性風控護欄限制無法買進：' + ('、'.join(note_parts) or '可用額度不足'), code)
                continue

            adjusted = final_shares < req_q

            # 4c. 自動補齊預設停損／停利百分比（硬性保護）
            sl_val = _safe_float(raw.get('stopLossPct'), None)
            if sl_val is None or sl_val <= 0 or sl_val > 90:
                sl_val = default_sl_pct if default_sl_pct > 0 else None
            else:
                sl_val = round(sl_val, 2)

            tp_val = _safe_float(raw.get('takeProfitPct'), None)
            if tp_val is None or tp_val <= 0 or tp_val > 500:
                tp_val = default_tp_pct if default_tp_pct > 0 else None
            else:
                tp_val = round(tp_val, 2)

            # 更新模擬狀態（供同批次後續指令連算）
            gross_nat = final_shares * price
            fee_nat = _estimate_buy_fee_native(gross_nat, sym_market, fees)
            sim_cash = max(0.0, sim_cash - _to_base_currency(gross_nat + fee_nat, sym_market, slot_currency, fx))
            if already_held:
                sim_positions[code]['shares'] = existing_shares + final_shares
                sim_positions[code]['price'] = price
            else:
                sim_positions[code] = {
                    'code': code,
                    'name': name,
                    'market': sym_market,
                    'shares': final_shares,
                    'price': price,
                }

            status = 'ADJUSTED' if adjusted else 'PASSED'
            note = (
                f"已自動縮減股數（{req_q} -> {final_shares}）：{'、'.join(note_parts)}"
                if adjusted
                else '通過硬性風控護欄檢核'
            )
            guardrail_checks.append({
                'code': code,
                'side': 'BUY',
                'requestedShares': req_q,
                'finalShares': final_shares,
                'status': status,
                'note': note,
            })
            compliant_actions.append({
                'side': 'BUY',
                'code': code,
                'name': name,
                'market': sym_market,
                'shares': final_shares,
                'estPrice': round(price, 4),
                'stopLossPct': sl_val,
                'takeProfitPct': tp_val,
                'reason': reason or 'AI 買進決策',
                'guardrailAdjusted': adjusted,
                'guardrailNote': note if adjusted else '',
            })

        return compliant_actions, guardrail_checks

    # ------------------------------------------------------------------
    # 公開入口：單存檔決策與每日排程
    # ------------------------------------------------------------------

    def _check_cooldown(self, slot: dict, ai_cfg: dict, force: bool) -> None:
        if force:
            return
        cooldown_min = int(ai_cfg.get('cooldownMinutes') or 0)
        if cooldown_min <= 0:
            return
        last_dt = _parse_iso_datetime(str(slot.get('lastAiRunAt') or ''))
        if last_dt is None:
            return
        elapsed = (taipei_now() - last_dt).total_seconds()
        need_sec = cooldown_min * 60
        if 0 <= elapsed < need_sec:
            rem_min = max(1, math.ceil((need_sec - elapsed) / 60.0))
            raise ValueError(f'AI 決策冷卻保護中，請約 {rem_min} 分鐘後再試（或啟用強制執行）')

    def run_decision(self, slot_id: str, trigger: str = '手動觸發', force: bool = False) -> dict:
        slot = self.paper.load_slot(slot_id)
        if not isinstance(slot, dict):
            raise ValueError(f'找不到模擬存檔：{slot_id}')

        ai_cfg = self._get_ai_config(slot)
        self._check_cooldown(slot, ai_cfg, force=force)

        fx_rate = self._get_fx_rate()
        tools_used: list[dict] = []
        quote_cache: dict[str, dict | None] = {}
        engine_mode = 'rule_fallback'
        error_str = ''

        ai = ai_router.session(self.app_data_dir, 'trader')
        ai_status = ai.status
        decision = None
        if ai_status == 'ready':
            try:
                if ai.provider == 'gemini':
                    decision = self._run_gemini_fc(slot, ai_cfg, fx_rate, trigger, ai, tools_used, quote_cache)
                    engine_mode = 'gemini_fc'
                else:
                    decision = self._run_provider_decision(ai, slot, ai_cfg, fx_rate, trigger, tools_used, quote_cache)
                    engine_mode = ai.provider + '_analysis'
                ai_status = 'success'
            except Exception:
                ai_status = 'failed'
                error_str = ai.metadata(ai_status)['message']
        if decision is None:
            decision = self._run_rule_fallback(
                slot, ai_cfg, fx_rate, tools_used, quote_cache,
                fallback_note=ai.metadata(ai_status)['message'],
            )

        raw_actions = decision.get('actions') or []
        compliant_actions, guardrail_checks = self.enforce_guardrails(
            slot=slot,
            raw_actions=raw_actions,
            fx_rate=fx_rate,
            quote_lookup=lambda c: self._safe_get_quote(c, quote_cache),
        )

        now_iso = taipei_now().isoformat(timespec='seconds')
        ts_ms = int(time.time() * 1000)
        rand_hex = uuid.uuid4().hex[:6]
        log_id = f'ailog_{ts_ms}_{rand_hex}'
        autonomy = ai_cfg['autonomy']

        executed_trades: list[str] = []
        proposal: dict | None = None
        exec_errors: list[str] = []

        if autonomy == 'full':
            for act in compliant_actions:
                order_body = {
                    'side': act['side'],
                    'code': act['code'],
                    'shares': act['shares'],
                    'orderType': 'MARKET',
                    'stopLossPct': act['stopLossPct'] if act['side'] == 'BUY' else None,
                    'takeProfitPct': act['takeProfitPct'] if act['side'] == 'BUY' else None,
                    'note': act['reason'] or 'AI 全自動決策下單',
                }
                try:
                    res = self.paper.place_order(slot_id, order_body, source='ai')
                    trade = res.get('trade') if isinstance(res, dict) else None
                    if isinstance(trade, dict) and trade.get('id'):
                        executed_trades.append(str(trade['id']))
                except Exception as exc:
                    exec_errors.append(f"{act['side']} {act['code']} 失敗：{_sanitize_error(str(exc))}")
        else:
            if compliant_actions:
                prop_id = f'prop_{ts_ms}_{rand_hex}'
                proposal = {
                    'id': prop_id,
                    'createdAt': now_iso,
                    'status': 'PENDING',
                    'engineMode': engine_mode,
                    'summary': str(decision.get('summary') or '')[:120],
                    'actions': [
                        {
                            'actionId': f'act_{idx + 1}',
                            'side': act['side'],
                            'code': act['code'],
                            'name': act['name'],
                            'market': act['market'],
                            'shares': act['shares'],
                            'estPrice': act['estPrice'],
                            'stopLossPct': act['stopLossPct'],
                            'takeProfitPct': act['takeProfitPct'],
                            'reason': act['reason'],
                            'guardrailAdjusted': act['guardrailAdjusted'],
                            'guardrailNote': act['guardrailNote'],
                        }
                        for idx, act in enumerate(compliant_actions)
                    ],
                    'decisionLogId': log_id,
                }

        if exec_errors:
            joined_err = '；'.join(exec_errors)
            error_str = f'{error_str}；{joined_err}' if error_str else joined_err

        log_entry = {
            'id': log_id,
            'timestamp': now_iso,
            'trigger': str(trigger or '手動觸發'),
            'engineMode': engine_mode,
            'autonomy': autonomy,
            'toolsUsed': tools_used,
            'reasoning': str(decision.get('reasoning') or ''),
            'ai': ai.metadata(ai_status),
            'analysis': decision.get('analysis', {}),
            'summary': str(decision.get('summary') or ''),
            'guardrailChecks': guardrail_checks,
            'executedTrades': executed_trades,
            'proposalId': proposal['id'] if proposal else None,
            'error': error_str,
        }

        self.paper.save_ai_run_result(slot_id, log_entry, proposal=proposal)
        state = self.paper.get_state(slot_id=slot_id)
        return {
            'ok': True,
            'log': log_entry,
            'proposal': proposal,
            'executedCount': len(executed_trades),
            'state': state,
        }

    def run_scheduled_slots(self, trigger: str = '每日 10:00 自動排程') -> list[dict]:
        """巡檢所有模擬存檔，自動執行 mode == 'ai' 且 scheduleMode == 'daily' 之存檔。"""
        results: list[dict] = []
        summaries = self.paper.list_slots_summary() if hasattr(self.paper, 'list_slots_summary') else []
        for s in summaries or []:
            if not isinstance(s, dict):
                continue
            sid = str(s.get('id') or '').strip()
            if not sid or str(s.get('mode') or '').lower() != 'ai':
                continue
            schedule_mode = (s.get('aiConfig') or {}).get('scheduleMode') if isinstance(s.get('aiConfig'), dict) else None
            if schedule_mode is None:
                try:
                    full_slot = self.paper.load_slot(sid)
                    schedule_mode = (full_slot.get('aiConfig') or {}).get('scheduleMode')
                except Exception:
                    continue
            if str(schedule_mode or '').lower() != 'daily':
                continue
            try:
                res = self.run_decision(sid, trigger=trigger, force=False)
                results.append({
                    'slotId': sid,
                    'ok': True,
                    'executedCount': res.get('executedCount', 0),
                    'proposalId': (res.get('proposal') or {}).get('id'),
                    'engineMode': (res.get('log') or {}).get('engineMode', ''),
                })
            except Exception as exc:
                results.append({
                    'slotId': sid,
                    'ok': False,
                    'error': _sanitize_error(str(exc)),
                })
        return results
