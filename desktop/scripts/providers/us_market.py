"""美股全市場（S&P 500 + 關鍵 ADR/ETF）資料與雙模式量化篩選供應器
整合 Yahoo Finance v8 Chart API（免 API Key、無 401 Crumb 限制），提供：
1. 美股總覽（四大指數、10 年期美債殖利率、VIX 恐慌指數與各產業領漲領跌快照）
2. S&P 500 全市場雙模式篩選：
   - 模式 A「機構資金吸籌」：CMF(20) 資金流向、20 日買賣量比 (Up/Down Vol)、OBV 能量潮、均線支撐與放量評分
   - 模式 B「超跌估值修正」：距 52 週高點回檔幅度、RSI(14) 超賣、布林通道 %B 下軌、月線乖離與承接保護評分
   - 支援非阻塞背景漸進式掃描（優先掃描 32 檔旗艦權值股，續掃全部 512 檔並寫入 4 小時本機快取）
3. 任意美股個股 2 年日 K、MA5/10/20/60/200、RSI(14)、MACD(12,26,9)、CMF(20)、52 週位階與結構評析
"""

from __future__ import annotations

import json
import math
import os
import re
import threading
import time
import urllib.error
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

from providers.news_briefing import _fetch_yahoo_quote, _http_get

TAIPEI_TZ = timezone(timedelta(hours=8))
VALID_US_SYMBOL_RE = re.compile(r'^[A-Z][A-Z0-9.-]{0,7}$')
ROOT = Path(__file__).resolve().parent.parent.parent
INSTALL_ROOT = Path(os.environ.get('CHIP_INSTALL_ROOT') or ROOT)
SP500_FILE = INSTALL_ROOT / 'data' / 'sp500_universe.json'

US_OVERVIEW_INDICES = [
    ('^GSPC', 'S&P 500', '指數'),
    ('^IXIC', 'Nasdaq', '指數'),
    ('^DJI', '道瓊工業', '指數'),
    ('^SOX', '費城半導體', '半導體'),
    ('^TNX', '美債10Y殖利率', '利率%'),
    ('^VIX', 'VIX 恐慌指數', '波動'),
]

# 32 檔優先掃描旗艦代表（確保首次載入數秒內即可呈現重點標的，同時背景續掃全部 S&P 500）
US_UNIVERSE = [
    ('AAPL', 'Apple 蘋果', '資訊科技'),
    ('MSFT', 'Microsoft 微軟', '資訊科技'),
    ('NVDA', 'NVIDIA 輝達', '資訊科技'),
    ('GOOGL', 'Alphabet 谷歌 A', '通訊服務'),
    ('AMZN', 'Amazon 亞馬遜', '非必需消費'),
    ('META', 'Meta 臉書', '通訊服務'),
    ('TSLA', 'Tesla 特斯拉', '非必需消費'),
    ('TSM', 'TSMC 台積電 ADR', '半導體 ADR / ETF'),
    ('AVGO', 'Broadcom 博通', '資訊科技'),
    ('AMD', 'AMD 超微', '資訊科技'),
    ('INTC', 'Intel 英特爾', '資訊科技'),
    ('MU', 'Micron 美光', '資訊科技'),
    ('ASML', 'ASML 艾司摩爾', '半導體 ADR / ETF'),
    ('QCOM', 'Qualcomm 高通', '資訊科技'),
    ('ARM', 'Arm 安謀', '半導體 ADR / ETF'),
    ('ORCL', 'Oracle 甲骨文', '資訊科技'),
    ('PLTR', 'Palantir', '資訊科技'),
    ('SMCI', 'Super Micro 美超微', '資訊科技'),
    ('SPY', 'SPDR S&P 500 ETF', '半導體 ADR / ETF'),
    ('QQQ', 'Invesco Nasdaq 100', '半導體 ADR / ETF'),
    ('SOXX', 'iShares 半導體 ETF', '半導體 ADR / ETF'),
    ('VOO', 'Vanguard S&P 500', '半導體 ADR / ETF'),
    ('TLT', '20年期美債 ETF', '半導體 ADR / ETF'),
    ('GLD', 'SPDR 黃金 ETF', '半導體 ADR / ETF'),
    ('BRK-B', '波克夏海瑟威 B', '金融'),
    ('JPM', 'JPMorgan 摩根大通', '金融'),
    ('V', 'Visa 威士卡', '金融'),
    ('COST', 'Costco 好市多', '必需消費'),
    ('NFLX', 'Netflix 網飛', '通訊服務'),
    ('LLY', 'Eli Lilly 禮來', '醫療保健'),
    ('UNH', 'UnitedHealth 聯合健康', '醫療保健'),
    ('XOM', 'ExxonMobil 埃克森美孚', '能源'),
]


def load_sp500_universe() -> list[tuple[str, str, str]]:
    """載入完整 S&P 500（+ 關鍵 ADR/ETF）清單，優先排列 32 檔旗艦代表便於漸進式先出結果。"""
    priority_codes = [c for c, _, _ in US_UNIVERSE]
    priority_rank = {c: i for i, c in enumerate(priority_codes)}
    if SP500_FILE.exists():
        try:
            doc = json.loads(SP500_FILE.read_text(encoding='utf-8'))
            items = doc.get('items') or []
            tuples = [(str(x['code']), str(x['name']), str(x['sector'])) for x in items if x.get('code')]
            tuples.sort(key=lambda t: (priority_rank.get(t[0], 9999), t[0]))
            if len(tuples) >= 400:
                return tuples
        except Exception:
            pass
    return list(US_UNIVERSE)


FULL_US_UNIVERSE = load_sp500_universe()
US_UNIVERSE_MAP = {sym: (name, sector) for sym, name, sector in FULL_US_UNIVERSE}


def taipei_now() -> datetime:
    return datetime.now(TAIPEI_TZ)


def compute_sma(values: list[float], period: int) -> list[float | None]:
    out: list[float | None] = []
    running = 0.0
    for i, v in enumerate(values):
        running += v
        if i >= period:
            running -= values[i - period]
        out.append(round(running / period, 4) if i + 1 >= period else None)
    return out


def compute_ema(values: list[float], period: int) -> list[float | None]:
    if not values:
        return []
    k = 2.0 / (period + 1)
    out: list[float | None] = []
    ema_val: float | None = None
    for i, v in enumerate(values):
        if i + 1 < period:
            out.append(None)
        elif i + 1 == period:
            ema_val = sum(values[:period]) / period
            out.append(ema_val)
        else:
            ema_val = (v - ema_val) * k + ema_val
            out.append(ema_val)
    return out


def compute_rsi_series(closes: list[float], period: int = 14) -> list[float | None]:
    n = len(closes)
    if n <= period:
        return [None] * n
    gains = [0.0] * n
    losses = [0.0] * n
    for i in range(1, n):
        diff = closes[i] - closes[i - 1]
        if diff > 0:
            gains[i] = diff
        else:
            losses[i] = -diff

    out: list[float | None] = [None] * n
    avg_gain = sum(gains[1 : period + 1]) / period
    avg_loss = sum(losses[1 : period + 1]) / period
    out[period] = 100.0 if avg_loss == 0 else round(100.0 - (100.0 / (1.0 + avg_gain / avg_loss)), 2)
    for i in range(period + 1, n):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        out[i] = 100.0 if avg_loss == 0 else round(100.0 - (100.0 / (1.0 + avg_gain / avg_loss)), 2)
    return out


def compute_macd_series(closes: list[float]) -> dict[str, list[float | None]]:
    ema12 = compute_ema(closes, 12)
    ema26 = compute_ema(closes, 26)
    dif: list[float | None] = [
        round(a - b, 4) if (a is not None and b is not None) else None
        for a, b in zip(ema12, ema26)
    ]
    valid_dif = [(i, v) for i, v in enumerate(dif) if v is not None]
    dea: list[float | None] = [None] * len(closes)
    hist: list[float | None] = [None] * len(closes)
    if len(valid_dif) >= 9:
        k = 2.0 / 10.0
        ema_d = sum(v for _, v in valid_dif[:9]) / 9.0
        first_idx = valid_dif[8][0]
        dea[first_idx] = round(ema_d, 4)
        hist[first_idx] = round(dif[first_idx] - ema_d, 4)
        for idx, val in valid_dif[9:]:
            ema_d = (val - ema_d) * k + ema_d
            dea[idx] = round(ema_d, 4)
            hist[idx] = round(val - ema_d, 4)
    return {'dif': dif, 'dea': dea, 'hist': hist}


def _compute_cmf20(bars: list[list]) -> float | None:
    """Chaikin Money Flow (20 日機構資金流向指標)，範圍 [-1, +1]。"""
    window = bars[-20:]
    if len(window) < 15:
        return None
    mf_vol_sum = 0.0
    vol_sum = 0.0
    for b in window:
        h, l, c, v = float(b[2]), float(b[3]), float(b[4]), float(b[5])
        if v <= 0:
            continue
        mult = ((c - l) - (h - c)) / (h - l) if h > l else 0.0
        mf_vol_sum += mult * v
        vol_sum += v
    if vol_sum <= 0:
        return None
    return round(mf_vol_sum / vol_sum, 3)


def _compute_ud_vol_ratio(bars: list[list]) -> float | None:
    """20 日上漲成交量／下跌成交量比（IBD 機構吃貨量比）。"""
    if len(bars) < 16:
        return None
    window = bars[-21:]
    up_v = 0.0
    dn_v = 0.0
    for i in range(1, len(window)):
        c_cur = float(window[i][4])
        c_prev = float(window[i - 1][4])
        v = float(window[i][5])
        if c_cur > c_prev:
            up_v += v
        elif c_cur < c_prev:
            dn_v += v
    if up_v <= 0 and dn_v <= 0:
        return None
    if dn_v <= 0:
        return 5.0
    return round(min(9.99, up_v / dn_v), 2)


def _compute_obv_rising(bars: list[list]) -> bool:
    """OBV 能量潮是否站上 20 日均線且近 20 日淨上升。"""
    if len(bars) < 25:
        return False
    obv = [0.0]
    for i in range(1, len(bars)):
        cur_c, prev_c, v = float(bars[i][4]), float(bars[i - 1][4]), float(bars[i][5])
        if cur_c > prev_c:
            obv.append(obv[-1] + v)
        elif cur_c < prev_c:
            obv.append(obv[-1] - v)
        else:
            obv.append(obv[-1])
    obv_ma20 = sum(obv[-20:]) / 20.0
    return obv[-1] > obv_ma20 and obv[-1] > obv[-21]


def _compute_bb_pos(closes: list[float]) -> float | None:
    """20 日 2 倍標準差布林通道 %B 位階（0 = 下軌、0.5 = 中軌、1 = 上軌）。"""
    if len(closes) < 20:
        return None
    w = closes[-20:]
    mean = sum(w) / 20.0
    var = sum((x - mean) ** 2 for x in w) / 20.0
    std = math.sqrt(var)
    if std <= 1e-9:
        return 0.5
    lower = mean - 2.0 * std
    upper = mean + 2.0 * std
    return round((closes[-1] - lower) / (upper - lower), 3)


def analyze_us_bars(bars: list[list], meta: dict | None = None) -> dict:
    """從美股日 K 陣列 [date, o, h, l, c, v] 計算六大技術維度與「大資金進場／跌深撿便宜」雙模式評分。"""
    closes = [float(b[4]) for b in bars]
    vols = [float(b[5]) for b in bars]
    last = bars[-1]
    prev = bars[-2] if len(bars) >= 2 else last
    close = float(last[4])
    open_p = float(last[1])
    high_p = float(last[2])
    low_p = float(last[3])
    prev_close = float(prev[4])
    chg = round(close - prev_close, 2)
    chg_pct = round((chg / prev_close * 100.0) if prev_close else 0.0, 2)
    ret20_pct = round(((close - closes[-21]) / closes[-21] * 100.0), 2) if len(closes) >= 21 and closes[-21] > 0 else None

    ma5 = compute_sma(closes, 5)[-1]
    ma10 = compute_sma(closes, 10)[-1]
    ma20 = compute_sma(closes, 20)[-1]
    ma60 = compute_sma(closes, 60)[-1]
    ma200 = compute_sma(closes, 200)[-1]
    mv5 = compute_sma(vols, 5)[-1]
    mv20 = compute_sma(vols, 20)[-1]
    rsi_arr = compute_rsi_series(closes, 14)
    rsi14 = rsi_arr[-1]
    macd_obj = compute_macd_series(closes)
    dif_last = macd_obj['dif'][-1]
    dea_last = macd_obj['dea'][-1]
    hist_last = macd_obj['hist'][-1]
    hist_prev = macd_obj['hist'][-2] if len(bars) >= 2 else None

    cmf20 = _compute_cmf20(bars)
    ud_vol_ratio = _compute_ud_vol_ratio(bars)
    obv_rising = _compute_obv_rising(bars)
    bb_pos = _compute_bb_pos(closes)
    vol_trend = round(mv5 / mv20, 2) if (mv5 and mv20 and mv20 > 0) else 1.0

    recent_year = bars[-252:]
    hi52 = float((meta or {}).get('fiftyTwoWeekHigh') or max(b[2] for b in recent_year))
    lo52 = float((meta or {}).get('fiftyTwoWeekLow') or min(b[3] for b in recent_year))
    pos52 = round(((close - lo52) / (hi52 - lo52) * 100.0), 1) if hi52 > lo52 else 50.0
    from_hi52_pct = round(((close - hi52) / hi52 * 100.0), 2) if hi52 > 0 else 0.0

    bias5 = round((close - ma5) / ma5 * 100.0, 2) if ma5 else None
    bias10 = round((close - ma10) / ma10 * 100.0, 2) if ma10 else None
    bias20 = round((close - ma20) / ma20 * 100.0, 2) if ma20 else None
    bias60 = round((close - ma60) / ma60 * 100.0, 2) if ma60 else None
    bias200 = round((close - ma200) / ma200 * 100.0, 2) if ma200 else None

    below_ma5 = ma5 is not None and close < ma5
    below_ma10 = ma10 is not None and close < ma10
    above_ma200 = ma200 is not None and close >= ma200

    if ma5 is None or ma10 is None:
        short_status, short_tone = '均線天數不足', 'neutral'
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
    elif close >= ma20 and close >= ma60 and (ma200 is None or close >= ma200):
        mid_status, mid_tone = '站穩月線、季線與年線', 'up'
    elif close < ma20 and close < ma60:
        mid_status, mid_tone = '位於月季線之下' + ('（失守年線）' if ma200 and close < ma200 else ''), 'down'
    else:
        mid_status, mid_tone = '中期均線震盪整理', 'neutral'

    if rsi14 is None:
        rsi_status, rsi_tone = 'RSI 資料不足', 'neutral'
    elif rsi14 >= 70:
        rsi_status, rsi_tone = f'高檔超買 ({rsi14:.1f})', 'up'
    elif rsi14 >= 55:
        rsi_status, rsi_tone = f'動能偏強 ({rsi14:.1f})', 'up'
    elif rsi14 <= 30:
        rsi_status, rsi_tone = f'低檔超賣 ({rsi14:.1f})', 'down'
    elif rsi14 <= 45:
        rsi_status, rsi_tone = f'動能偏弱 ({rsi14:.1f})', 'down'
    else:
        rsi_status, rsi_tone = f'動能中性 ({rsi14:.1f})', 'neutral'

    if hist_last is None:
        macd_status, macd_tone = 'MACD 資料不足', 'neutral'
    elif hist_prev is not None and hist_prev <= 0 < hist_last:
        macd_status, macd_tone = 'MACD 黃金交叉轉強', 'up'
    elif hist_prev is not None and hist_prev >= 0 > hist_last:
        macd_status, macd_tone = 'MACD 死亡交叉轉弱', 'down'
    elif hist_last > 0:
        macd_status, macd_tone = 'MACD 多頭紅柱', 'up'
    else:
        macd_status, macd_tone = 'MACD 空頭綠柱', 'down'

    vol = int(last[5])
    vol_ratio = round(vol / mv5, 2) if mv5 and mv5 > 0 else 1.0
    if chg > 0 and vol_ratio >= 1.2:
        vol_status, vol_tone = f'價漲量增 ({vol_ratio:.2f}x)', 'up'
    elif chg < 0 and vol_ratio >= 1.2:
        vol_status, vol_tone = f'帶量回檔 ({vol_ratio:.2f}x)', 'down'
    elif vol_ratio < 0.75:
        vol_status, vol_tone = f'量縮整理 ({vol_ratio:.2f}x)', 'neutral'
    else:
        vol_status, vol_tone = f'量能溫和 ({vol_ratio:.2f}x)', 'neutral'

    if pos52 >= 80:
        pos_status, pos_tone = f'52週高檔區 ({pos52:.0f}%)', 'up'
    elif pos52 <= 25:
        pos_status, pos_tone = f'52週低檔區 ({pos52:.0f}%)', 'down'
    else:
        pos_status, pos_tone = f'52週中軸區 ({pos52:.0f}%)', 'neutral'

    # ----- 模式 A：大資金進場 (Smart Money Accumulation) -----
    smart_score = 0
    smart_reasons: list[str] = []
    if cmf20 is not None:
        if cmf20 >= 0.12:
            smart_score += 30
            smart_reasons.append(f'CMF強吸籌 +{cmf20:.2f}')
        elif cmf20 >= 0.05:
            smart_score += 20
            smart_reasons.append(f'CMF資金淨流入 +{cmf20:.2f}')
        elif cmf20 > 0:
            smart_score += 8
    if ud_vol_ratio is not None:
        if ud_vol_ratio >= 1.5:
            smart_score += 25
            smart_reasons.append(f'20日買賣量比 {ud_vol_ratio:.2f}x')
        elif ud_vol_ratio >= 1.2:
            smart_score += 16
            smart_reasons.append(f'買盤量佔優 {ud_vol_ratio:.2f}x')
    if obv_rising:
        smart_score += 15
        smart_reasons.append('OBV能量潮走揚')
    if ma20 is not None and close >= ma20:
        if ma60 is not None and close >= ma60:
            smart_score += 15
            smart_reasons.append('站穩月季線')
        else:
            smart_score += 8
            smart_reasons.append('站上月線')
    if above_ma200:
        smart_score += 5
    if vol_trend >= 1.15 or (close > open_p and vol_ratio >= 1.25):
        smart_score += 10
        smart_reasons.append('量能升溫放量')
    smart_pass = (
        cmf20 is not None
        and cmf20 >= 0.05
        and ud_vol_ratio is not None
        and ud_vol_ratio >= 1.2
        and ma20 is not None
        and close >= ma20
        and smart_score >= 55
    )

    # ----- 模式 B：跌深撿便宜 (Deep Oversold / Mean-Reversion Dip) -----
    dip_score = 0
    dip_reasons: list[str] = []
    if from_hi52_pct <= -25.0:
        dip_score += 25
        dip_reasons.append(f'距高點回檔 {from_hi52_pct:.1f}%')
    elif from_hi52_pct <= -15.0:
        dip_score += 18
        dip_reasons.append(f'自高點修正 {from_hi52_pct:.1f}%')
    elif from_hi52_pct <= -10.0:
        dip_score += 10
        dip_reasons.append(f'回檔 {from_hi52_pct:.1f}%')
    if rsi14 is not None:
        if rsi14 <= 30:
            dip_score += 30
            dip_reasons.append(f'RSI深度超賣 {rsi14:.1f}')
        elif rsi14 <= 38:
            dip_score += 20
            dip_reasons.append(f'RSI低檔 {rsi14:.1f}')
        elif rsi14 <= 45:
            dip_score += 10
    if bb_pos is not None:
        if bb_pos <= 0.12:
            dip_score += 20
            dip_reasons.append('觸及布林下軌')
        elif bb_pos <= 0.25:
            dip_score += 12
            dip_reasons.append('近布林下緣')
    if bias20 is not None and bias20 <= -6.0:
        dip_score += 10
        dip_reasons.append(f'負乖離 {bias20:.1f}%')
    elif bias20 is not None and bias20 <= -3.0:
        dip_score += 5
    if above_ma200:
        dip_score += 10
        dip_reasons.append('守200日年線')
    elif cmf20 is not None and cmf20 > -0.05:
        dip_score += 10
        dip_reasons.append('修正期間資金穩定')
    lower_wick = ((min(open_p, close) - low_p) / (high_p - low_p)) if high_p > low_p else 0.0
    if lower_wick >= 0.4:
        dip_score += 5
        dip_reasons.append('下影線承接')
    dip_pass = (
        from_hi52_pct <= -12.0
        and ((rsi14 is not None and rsi14 <= 38) or (bb_pos is not None and bb_pos <= 0.15))
        and dip_score >= 50
    )

    # 綜合結構與背離提醒
    short_bull = ma5 is not None and ma10 is not None and not below_ma5 and not below_ma10
    divergence = ''
    if (below_ma5 or below_ma10) and rsi14 is not None and rsi14 <= 32:
        ov_label, ov_tone = '短線超賣區（留意止跌反彈）', 'neutral'
        divergence = f'RSI 超賣提醒 ({rsi14:.1f})'
        ov_summary = f'收盤低於短期均線且 RSI(14) 進入 {rsi14:.1f} 超賣區，可留意量縮止跌或站回 5 日線訊號。'
    elif smart_pass:
        ov_label, ov_tone = '機構資金吸籌偏多結構', 'up'
        ov_summary = f'符合機構資金吸籌條件（{" · ".join(smart_reasons[:3])}），量價與資金流向一致偏多。'
    elif short_bull and macd_tone == 'up':
        ov_label, ov_tone = '美股均線與 MACD 多頭共振', 'up'
        ov_summary = f'站上 5 日與 10 日均線且 {macd_status}，RSI(14)={rsi14 if rsi14 is not None else "—"}，多方動能一致。'
    elif short_bull and rsi14 is not None and rsi14 >= 72:
        ov_label, ov_tone = '強勢高檔（RSI 過熱留意乖離）', 'up'
        divergence = f'RSI 過熱警戒 ({rsi14:.1f})'
        ov_summary = f'股價維持多頭但 RSI(14) 達 {rsi14:.1f} 且 52 週位階 {pos52:.0f}%，宜留意短線乖離修正。'
    elif not short_bull and macd_tone == 'down':
        ov_label, ov_tone = '短均承壓且 MACD 偏空', 'down'
        ov_summary = '收盤位於 5 日／10 日均線之下且 MACD 維持空方柱，建議靜待均線重新站回與動能翻多。'
    else:
        ov_label, ov_tone = '均線震盪整理格局', 'neutral'
        ov_summary = f'短中期均線與指標呈分歧震盪（{short_status}、{macd_status}），宜觀察量能變化與支撐守穩情況。'

    return {
        'price': round(close, 2),
        'prevClose': round(prev_close, 2),
        'change': chg,
        'changePct': chg_pct,
        'ret20Pct': ret20_pct,
        'tradeDate': last[0],
        'ma5': round(ma5, 2) if ma5 is not None else None,
        'ma10': round(ma10, 2) if ma10 is not None else None,
        'ma20': round(ma20, 2) if ma20 is not None else None,
        'ma60': round(ma60, 2) if ma60 is not None else None,
        'ma200': round(ma200, 2) if ma200 is not None else None,
        'bias5Pct': bias5,
        'bias10Pct': bias10,
        'bias20Pct': bias20,
        'bias60Pct': bias60,
        'bias200Pct': bias200,
        'belowMa5': below_ma5,
        'belowMa10': below_ma10,
        'aboveMa200': above_ma200,
        'cmf20': cmf20,
        'udVolRatio': ud_vol_ratio,
        'obvRising': obv_rising,
        'bbPos': bb_pos,
        'volTrend': vol_trend,
        'smartMoney': {'pass': smart_pass, 'score': min(100, smart_score), 'reasons': smart_reasons},
        'dipBuy': {'pass': dip_pass, 'score': min(100, dip_score), 'reasons': dip_reasons},
        'shortMa': {'ma5': round(ma5, 2) if ma5 else None, 'ma10': round(ma10, 2) if ma10 else None, 'bias5Pct': bias5, 'bias10Pct': bias10, 'belowMa5': below_ma5, 'belowMa10': below_ma10, 'status': short_status, 'tone': short_tone},
        'midMa': {'ma20': round(ma20, 2) if ma20 else None, 'ma60': round(ma60, 2) if ma60 else None, 'ma200': round(ma200, 2) if ma200 else None, 'bias20Pct': bias20, 'bias60Pct': bias60, 'bias200Pct': bias200, 'status': mid_status, 'tone': mid_tone},
        'rsi': {'value': rsi14, 'status': rsi_status, 'tone': rsi_tone},
        'macd': {'dif': round(dif_last, 3) if dif_last is not None else None, 'dea': round(dea_last, 3) if dea_last is not None else None, 'hist': round(hist_last, 3) if hist_last is not None else None, 'status': macd_status, 'tone': macd_tone},
        'volume': {'vol': vol, 'mv5': round(mv5, 0) if mv5 else None, 'volRatio': vol_ratio, 'status': vol_status, 'tone': vol_tone},
        'range52w': {'high': round(hi52, 2), 'low': round(lo52, 2), 'posPct': pos52, 'fromHighPct': from_hi52_pct, 'status': pos_status, 'tone': pos_tone},
        'overall': {'label': ov_label, 'tone': ov_tone, 'summary': ov_summary, 'divergenceAlert': divergence},
        'rsiSeries': rsi_arr[-60:],
        'macdSeries': {
            'dates': [b[0] for b in bars[-60:]],
            'dif': macd_obj['dif'][-60:],
            'dea': macd_obj['dea'][-60:],
            'hist': macd_obj['hist'][-60:],
        },
    }


def _summarize_screener_rows(rows: list[dict], total_universe: int, done: int, scanning: bool, updated_at: str) -> dict:
    sector_buckets: dict[str, list[dict]] = {}
    for r in rows:
        sector_buckets.setdefault(r['sector'], []).append(r)
    sectors = []
    for sec_name, sec_rows in sorted(sector_buckets.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        avg_chg = round(sum(r['changePct'] for r in sec_rows) / len(sec_rows), 2)
        up_cnt = sum(1 for r in sec_rows if r['changePct'] > 0)
        sectors.append({
            'name': sec_name,
            'count': len(sec_rows),
            'avgChangePct': avg_chg,
            'upCount': up_cnt,
            'downCount': len(sec_rows) - up_cnt,
        })

    smart_cnt = sum(1 for r in rows if r.get('smartPass'))
    dip_cnt = sum(1 for r in rows if r.get('dipPass'))
    return {
        'updatedAt': updated_at,
        'count': len(rows),
        'universeTotal': total_universe,
        'scanning': scanning,
        'progress': {'done': done, 'total': total_universe},
        'counts': {'total': len(rows), 'smartMoney': smart_cnt, 'dipBuy': dip_cnt},
        'sectors': sectors,
        'rows': rows,
    }


class UsMarketService:
    OVERVIEW_TTL = 10 * 60
    SCREENER_TTL = 4 * 3600
    DETAIL_TTL = 2 * 3600

    def __init__(self, cache_dir: Path):
        self.cache_dir = cache_dir
        self._lock = threading.Lock()
        self._scan_lock = threading.Lock()
        self._scanning = False
        self._scan_done = 0
        self._scan_total = len(FULL_US_UNIVERSE)
        self._scan_rows: list[dict] = []
        self._scan_updated_at = ''

    def _read_fresh(self, path: Path, ttl: int) -> dict | None:
        if not path.exists():
            return None
        try:
            if time.time() - path.stat().st_mtime < ttl:
                return json.loads(path.read_text(encoding='utf-8'))
        except Exception:
            return None
        return None

    def _read_any(self, path: Path) -> dict | None:
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding='utf-8'))
        except Exception:
            return None

    def _write_json(self, path: Path, payload: dict) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        stage = path.with_suffix('.json.tmp')
        stage.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        os.replace(stage, path)

    def _fetch_chart_raw(self, code: str, range_str: str = '1y') -> tuple[list[list], dict]:
        encoded = urllib.parse.quote(code, safe='')
        url = f'https://query1.finance.yahoo.com/v8/finance/chart/{encoded}?range={range_str}&interval=1d'
        last_exc: Exception | None = None
        for attempt in range(2):
            try:
                payload = json.loads(_http_get(url, timeout=11).decode('utf-8'))
                results = payload.get('chart', {}).get('result')
                if not results:
                    err = payload.get('chart', {}).get('error', {}).get('description') or f'查無美股代號 {code}'
                    raise ValueError(err)
                res = results[0]
                meta = res.get('meta') or {}
                exch_tz = timezone(timedelta(seconds=int(meta.get('gmtoffset') or -18000)))
                ts_list = res.get('timestamp') or []
                q = (res.get('indicators', {}).get('quote') or [{}])[0]
                opens, highs, lows, closes, vols = (
                    q.get('open') or [], q.get('high') or [], q.get('low') or [], q.get('close') or [], q.get('volume') or [],
                )
                by_day: dict[str, list] = {}
                for ts, o, h, l, c, v in zip(ts_list, opens, highs, lows, closes, vols):
                    if None in (ts, o, h, l, c) or o <= 0 or h < l or l <= 0 or c <= 0:
                        continue
                    d = datetime.fromtimestamp(ts, exch_tz).strftime('%Y-%m-%d')
                    by_day[d] = [d, round(float(o), 2), round(float(h), 2), round(float(l), 2), round(float(c), 2), int(v or 0)]
                bars = [by_day[k] for k in sorted(by_day.keys())]
                if not bars:
                    raise ValueError(f'查無 {code} 的有效美股日行情資料')
                return bars, meta
            except urllib.error.HTTPError as exc:
                last_exc = exc
                if exc.code == 429 and attempt == 0:
                    time.sleep(0.7)
                    continue
                raise
            except Exception as exc:
                last_exc = exc
                if attempt == 0:
                    time.sleep(0.35)
                    continue
                raise
        raise last_exc or ValueError(f'無法取得 {code}')

    def get_detail(self, code: str, force_refresh: bool = False) -> dict:
        sym = str(code or '').strip().upper().replace('.', '-')
        if not VALID_US_SYMBOL_RE.fullmatch(sym):
            raise ValueError('請輸入有效美股代號（如 NVDA、AAPL、TSM、SPY、BRK-B）')

        cache_file = self.cache_dir / f'detail-{sym}.json'
        if not force_refresh:
            cached = self._read_fresh(cache_file, self.DETAIL_TTL)
            if cached and 'cmf20' in (cached.get('tech') or {}):
                return cached

        bars, meta = self._fetch_chart_raw(sym, range_str='2y')
        tech = analyze_us_bars(bars, meta)
        preset_name, preset_sector = US_UNIVERSE_MAP.get(sym, ('', ''))
        display_name = preset_name or meta.get('longName') or meta.get('shortName') or sym
        result = {
            'code': sym,
            'name': display_name,
            'sector': preset_sector or (meta.get('instrumentType') or 'EQUITY'),
            'exchange': meta.get('fullExchangeName') or meta.get('exchangeName') or 'US',
            'currency': meta.get('currency') or 'USD',
            'bars': bars,
            'tech': tech,
            'source': 'Yahoo Finance (US 2Y Daily OHLCV)',
            'fetched': taipei_now().strftime('%Y-%m-%d %H:%M:%S +08:00'),
        }
        self._write_json(cache_file, result)
        return result

    def _scan_one_screener(self, entry: tuple[str, str, str]) -> dict | None:
        sym, name, sector = entry
        try:
            bars, meta = self._fetch_chart_raw(sym, range_str='1y')
            tech = analyze_us_bars(bars, meta)
            flags: list[str] = []
            if not tech['belowMa5'] and not tech['belowMa10']:
                flags.append('aboveShortMa')
            if tech['belowMa5']:
                flags.append('belowMa5')
            if tech['belowMa10']:
                flags.append('belowMa10')
            if tech['aboveMa200']:
                flags.append('aboveMa200')
            if tech['macd']['tone'] == 'up':
                flags.append('macdBull')
            if tech['cmf20'] is not None and tech['cmf20'] >= 0.05:
                flags.append('cmfPos')
            rsi_val = tech['rsi']['value']
            if rsi_val is not None and rsi_val >= 60:
                flags.append('rsiStrong')
            if rsi_val is not None and rsi_val <= 35:
                flags.append('rsiLow')
            if tech['volume']['volRatio'] >= 1.3:
                flags.append('volSurge')
            if tech['smartMoney']['pass']:
                flags.append('smartMoney')
            if tech['dipBuy']['pass']:
                flags.append('dipBuy')
            return {
                'code': sym,
                'name': name,
                'sector': sector,
                'exchange': meta.get('fullExchangeName') or 'US',
                'price': tech['price'],
                'change': tech['change'],
                'changePct': tech['changePct'],
                'ret20Pct': tech['ret20Pct'],
                'tradeDate': tech['tradeDate'],
                'ma5': tech['ma5'],
                'ma10': tech['ma10'],
                'ma20': tech['ma20'],
                'ma60': tech['ma60'],
                'ma200': tech['ma200'],
                'rsi14': rsi_val,
                'cmf20': tech['cmf20'],
                'udVolRatio': tech['udVolRatio'],
                'obvRising': tech['obvRising'],
                'bbPos': tech['bbPos'],
                'macdStatus': tech['macd']['status'],
                'macdTone': tech['macd']['tone'],
                'vol': tech['volume']['vol'],
                'volRatio': tech['volume']['volRatio'],
                'pos52w': tech['range52w']['posPct'],
                'fromHighPct': tech['range52w']['fromHighPct'],
                'shortStatus': tech['shortMa']['status'],
                'shortTone': tech['shortMa']['tone'],
                'smartPass': tech['smartMoney']['pass'],
                'smartScore': tech['smartMoney']['score'],
                'smartReasons': tech['smartMoney']['reasons'],
                'dipPass': tech['dipBuy']['pass'],
                'dipScore': tech['dipBuy']['score'],
                'dipReasons': tech['dipBuy']['reasons'],
                'overallLabel': tech['overall']['label'],
                'overallTone': tech['overall']['tone'],
                'flags': flags,
            }
        except Exception:
            return None

    def _run_full_scan_worker(self) -> None:
        cache_file = self.cache_dir / 'sp500-screener.json'
        universe = FULL_US_UNIVERSE
        total = len(universe)
        collected: list[dict] = []
        done = 0
        batch_size = 36

        try:
            with ThreadPoolExecutor(max_workers=12) as pool:
                for start in range(0, total, batch_size):
                    chunk = universe[start : start + batch_size]
                    results = list(pool.map(self._scan_one_screener, chunk))
                    for item in results:
                        if item:
                            collected.append(item)
                    done = min(total, start + len(chunk))
                    now_str = taipei_now().strftime('%Y-%m-%d %H:%M:%S +08:00')
                    with self._scan_lock:
                        self._scan_done = done
                        self._scan_rows = list(collected)
                        self._scan_updated_at = now_str

            final_ts = taipei_now().strftime('%Y-%m-%d %H:%M:%S +08:00')
            payload = _summarize_screener_rows(collected, total, total, False, final_ts)
            if len(collected) >= 30:
                self._write_json(cache_file, payload)
                # 完整掃描完成後清除舊的 32 檔總覽快取，確保總覽與全市場篩選數字完全同步
                ov_file = self.cache_dir / 'overview.json'
                if ov_file.exists():
                    try:
                        ov_file.unlink()
                    except Exception:
                        pass
        finally:
            with self._scan_lock:
                self._scanning = False
                self._scan_done = total

    def start_background_scan(self) -> bool:
        with self._scan_lock:
            if self._scanning:
                return False
            self._scanning = True
            self._scan_done = 0
            self._scan_total = len(FULL_US_UNIVERSE)
            if not self._scan_rows:
                # 若有舊快取先留著顯示，避免畫面空白
                old = self._read_any(self.cache_dir / 'sp500-screener.json')
                if old and old.get('rows'):
                    self._scan_rows = list(old['rows'])
                    self._scan_updated_at = old.get('updatedAt', '')
        t = threading.Thread(target=self._run_full_scan_worker, name='SP500Scanner', daemon=True)
        t.start()
        return True

    def get_screener(self, force_refresh: bool = False) -> dict:
        cache_file = self.cache_dir / 'sp500-screener.json'
        if not force_refresh:
            with self._scan_lock:
                if self._scanning:
                    return _summarize_screener_rows(
                        list(self._scan_rows),
                        self._scan_total,
                        self._scan_done,
                        True,
                        self._scan_updated_at or taipei_now().strftime('%Y-%m-%d %H:%M:%S +08:00'),
                    )
            cached = self._read_fresh(cache_file, self.SCREENER_TTL)
            if cached and cached.get('count', 0) >= 400 and cached.get('counts'):
                return {**cached, 'scanning': False, 'progress': {'done': cached['count'], 'total': len(FULL_US_UNIVERSE)}}

        self.start_background_scan()
        # 首次無快取時先短等前 36 檔（約 1.5–2.5 秒），讓畫面立即有旗艦資料與進度列
        deadline = time.time() + 3.0
        while time.time() < deadline:
            with self._scan_lock:
                if self._scan_rows or not self._scanning:
                    break
            time.sleep(0.15)

        with self._scan_lock:
            return _summarize_screener_rows(
                list(self._scan_rows),
                self._scan_total,
                self._scan_done,
                self._scanning,
                self._scan_updated_at or taipei_now().strftime('%Y-%m-%d %H:%M:%S +08:00'),
            )

    def get_overview(self, force_refresh: bool = False) -> dict:
        cache_file = self.cache_dir / 'overview.json'
        sp_cache = self._read_fresh(self.cache_dir / 'sp500-screener.json', self.SCREENER_TTL)
        sp_ready = bool(sp_cache and sp_cache.get('count', 0) >= 400 and sp_cache.get('counts'))

        if not force_refresh:
            cached = self._read_fresh(cache_file, self.OVERVIEW_TTL)
            if cached and cached.get('indices') and not self._scanning:
                if cached.get('universeCount', 0) >= 400:
                    return cached
                if sp_ready:
                    rows = sp_cache.get('rows') or []
                    ranked = sorted(rows, key=lambda r: r['changePct'], reverse=True)
                    synced = {
                        **cached,
                        'sectors': (sp_cache.get('sectors') or [])[:8],
                        'counts': sp_cache['counts'],
                        'leaders': ranked[:5],
                        'laggards': list(reversed(ranked[-5:])) if len(ranked) >= 5 else [],
                        'universeCount': sp_cache['count'],
                        'scanning': False,
                        'progress': {'done': sp_cache['count'], 'total': len(FULL_US_UNIVERSE)},
                    }
                    self._write_json(cache_file, synced)
                    return synced

        def fetch_idx(item: tuple[str, str, str]) -> dict:
            sym, name, tag = item
            q = _fetch_yahoo_quote(sym)
            return {
                'symbol': sym,
                'name': name,
                'tag': tag,
                'price': q['price'] if q else None,
                'change': q['change'] if q else None,
                'changePct': q['changePct'] if q else None,
                'tradeTime': q['tradeTime'] if q else '',
            }

        with ThreadPoolExecutor(max_workers=6) as pool:
            indices = list(pool.map(fetch_idx, US_OVERVIEW_INDICES))

        scanning_now = False
        done_cnt = len(FULL_US_UNIVERSE)
        if not force_refresh and sp_ready:
            rows = sp_cache.get('rows') or []
            sectors = sp_cache.get('sectors') or []
            counts = sp_cache.get('counts') or {}
            done_cnt = len(rows)
        else:
            # 啟動或讀取背景 S&P 500 掃描進度；若剛開始且尚未有批次資料，先短等前 36 檔
            self.start_background_scan()
            deadline = time.time() + 3.0
            while time.time() < deadline:
                with self._scan_lock:
                    if self._scan_rows or not self._scanning:
                        break
                time.sleep(0.15)
            with self._scan_lock:
                rows = list(self._scan_rows)
                scanning_now = self._scanning
                done_cnt = self._scan_done or len(rows)
            summary = _summarize_screener_rows(rows, len(FULL_US_UNIVERSE), done_cnt, scanning_now, '')
            sectors = summary['sectors']
            counts = summary['counts']

        ranked = sorted(rows, key=lambda r: r['changePct'], reverse=True)
        result = {
            'updatedAt': taipei_now().strftime('%Y-%m-%d %H:%M:%S +08:00'),
            'indices': indices,
            'sectors': sectors[:8],
            'counts': counts,
            'leaders': ranked[:5],
            'laggards': list(reversed(ranked[-5:])) if len(ranked) >= 5 else [],
            'universeCount': len(rows),
            'scanning': scanning_now,
            'progress': {'done': done_cnt, 'total': len(FULL_US_UNIVERSE)},
        }
        # 僅在掃描完成且覆蓋完整母體時才寫入長效總覽快取，避免過渡數字殘留
        if not scanning_now and len(rows) >= 400:
            self._write_json(cache_file, result)
        return result
