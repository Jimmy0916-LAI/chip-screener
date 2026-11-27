"""訂閱財經 YouTube 頻道、最新影片時間戳摘要與策略卡供應器（純 Python 標準函式庫）
功能：
- 免 YouTube API Key，透過公開頁面與官方 Atom RSS 解析頻道與最新影片
- 嚴格「只分析最新 1 支影片、絕不回補舊片」與每頻道最多 3 筆策略卡（FIFO 自動淘汰最舊）
- 三層影片解析管線：
  1. YouTube CC / 自動字幕 + 說明欄章節 -> Gemini 濃縮 (cc_gemini) 或免 Key 規則式摘要 (cc_rule)
  2. 無 CC 字幕但有設定 Gemini API Key -> Gemini 多模態直接解析 YouTube URL 音軌與硬字幕 (multimodal_gemini)
  3. 無字幕且無可用 AI -> 標記 waiting_subtitles（等待字幕），絕不以空標題捏造假策略
- 隔離儲存於 %LOCALAPPDATA%\\ChipScreener\\user-v1\\channels-config.json 與 channels-v1\\<channelId>.json，
  共用 briefing-secrets.json 的 geminiApiKey，絕不寫入專案目錄。
"""

from __future__ import annotations

import html
import json
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

from providers.news_briefing import (
    FINANCE_KEYWORDS,
    NEWS_STOCK_ALIASES,
    TAIPEI_TZ,
    _fetch_yahoo_quote,
    _http_get,
    taipei_now,
)
from providers import ai_router
from providers.secret_store import (
    get_gemini_key_meta,
)

MAX_STRATEGIES_PER_CHANNEL = 3
DEFAULT_COOLDOWN_MINUTES = 15
DEFAULT_MAX_VIDEO_MINUTES = 60
MIN_VIDEO_MINUTES = 10
MAX_VIDEO_MINUTES = 240

INNERTUBE_PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false'
INNERTUBE_CLIENTS = (
    {
        'clientName': 'ANDROID',
        'clientVersion': '20.10.38',
        'userAgent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
    },
    {
        'clientName': 'IOS',
        'clientVersion': '20.10.4',
        'userAgent': 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
    },
)

CHANNEL_ID_RE = re.compile(r'^UC[A-Za-z0-9_-]{22}$')
SAFE_CHANNEL_ID_RE = re.compile(r'^[A-Za-z0-9_-]{6,64}$')
VIDEO_ID_RE = re.compile(r'^[A-Za-z0-9_-]{11}$')
VALID_TW_CODE_RE = re.compile(r'^(?:\d{4}|00\d{2,4}[A-Z]?)$')
VALID_BANDS = ('200', '400', '600', '1000')
VALID_STANCES = ('偏多', '偏空', '中性觀望')

SKIPPED_NON_FINANCE_MSG = '此影片與財經／股票主題無關，已自動略過解析'

EXTRA_FINANCE_KEYWORDS = (
    '台股', '美股', '陸股', '港股', '日股', '韓股', '選股', '籌碼', '技術分析', 'k線',
    '基本面', '投資', '理財', '財報', '殖利率', '聯準會', '總經', '多頭', '空頭',
    '暴跌', '大漲', '重挫', '崩盤', '飆股', '交易', '均線', '停損', '估值', '本益比',
    'etf', '期貨', '選擇權', '匯率', '債券', '費半', '標普', '那斯達克', '道瓊',
    '砸盤', '抄底', '持股', '大戶', '集保', '法人', '外資', '投信', '融資', '融券',
    '股災', '牛市', '熊市', '降息', '升息', '通膨', '關稅', '半導體', '晶片', '記憶體',
    '美光', '摩根大通', '華爾街', '財經', '股市', '股票', '存股', '配息', '除息',
    '目標價', '毛利率', '資產配置', '買超', '賣超', '加碼', '減碼', '停利', '盤勢',
    'stocks', 'investing', 'trading', 'portfolio', 'valuation', 'nasdaq', 's&p',
    'fed', 'earnings', 'semiconductor', 'chip', 'macro', 'bonds', 'forex',
    'bull market', 'bear market', 'market crash', 'dividend', 'yield', 'bitcoin', '比特幣',
)
ALL_FINANCE_KEYWORDS = tuple(dict.fromkeys(
    k.lower() for k in (*FINANCE_KEYWORDS, *EXTRA_FINANCE_KEYWORDS) if k
))
CORE_MARKET_TERMS = (
    '股', '台股', '美股', '大盤', '指數', '財報', '營收', '獲利', '市值', '投資', '理財',
    '選股', '籌碼', '集保', '大戶', '技術分析', 'k線', '基本面', '估值', '本益比', '殖利率',
    '配息', '聯準會', '總經', '利率', '通膨', '債券', '匯率', '期貨', 'etf', '暴跌', '砸盤',
    '重挫', '崩盤', '飆股', '多頭', '空頭', '均線', '停損', '目標價', '買超', '賣超', '外資',
    '投信', '法說', '供應鏈', '概念股', '費半', '標普', '那斯達克', '道瓊', '華爾街', '財經',
    'stock', 'stocks', 'market', 'investing', 'trading', 'earnings', 'fed', 'macro', 'nasdaq',
    's&p', 'yield', 'bonds', 'dividend', 'valuation', 'portfolio', 'semiconductor',
)
NON_FINANCE_TITLE_KEYWORDS = (
    'vlog', '旅遊', '自由行', '美食', '吃播', '開箱', '實測', '評測', '遊戲', '實況',
    '穿搭', '美妝', '化妝', '抽獎', '音樂', '翻唱', '電影', '影評', '動漫', '體育',
    '球賽', '職棒', 'nba', '健身', '減肥', '日常', '閒聊', '露營', '料理', '食譜',
    '寵物', '貓咪', '狗狗', '搞笑', '整人', '戀愛', '情感', '星座', '算命', 'asmr',
    'unboxing', 'mukbang', 'gameplay', 'travel', 'recipe', 'mv',
)
NON_FINANCE_CATEGORIES = {
    'gaming', 'music', 'sports', 'comedy', 'film & animation',
    'pets & animals', 'travel & events',
}

IGNORE_TICKERS = {
    'AI', 'US', 'TW', 'UK', 'EU', 'CN', 'JP', 'GDP', 'CPI', 'PCE', 'PPI',
    'FED', 'FOMC', 'ETF', 'EPS', 'IPO', 'ADR', 'YOY', 'QOQ', 'MOM', 'SEC',
    'CEO', 'CFO', 'CTO', 'USD', 'TWD', 'NTD', 'RMB', 'JPY', 'EUR', 'PE', 'PB',
    'WSJ', 'CNBC', 'CRN', 'IT', 'PC', 'NB', 'TV', 'EV', 'GPU', 'CPU', 'HBM',
    'RSI', 'MACD', 'KD', 'MA', 'EMA', 'SMA', 'ATR', 'ROE', 'ROA', 'ROI', 'EPS',
    'CC', 'YT', 'URL', 'API', 'JSON', 'RSS', 'XML', 'HTTP', 'HTTPS', 'TDCC',
    'TWSE', 'TPEX', 'OTC', 'NYSE', 'NASDAQ', 'SPX', 'VIX', 'DXY', 'FOMO',
}

BULLISH_KEYWORDS = (
    '偏多', '看多', '買進', '加碼', '突破', '多頭', '上攻', '受惠', '創高',
    '拉回找買點', '逢低布局', '大戶買超', '轉強', '翻多', '站上', '看漲',
    '上修', '成長', '擴張', '強勢', 'bullish', 'buy', 'breakout', 'upside',
)
BEARISH_KEYWORDS = (
    '偏空', '看空', '賣出', '減碼', '跌破', '空頭', '回檔', '轉弱', '出貨',
    '警戒', '避開', '大戶賣超', '翻空', '下修', '破底', '停利', '保守',
    '套牢', '壓力重', 'bearish', 'sell', 'breakdown', 'downside',
)
ENTRY_KEYWORDS = (
    '進場', '布局', '佈局', '買點', '突破', '站上', '回測', '拉回', '量增',
    '分批', '承接', '加碼', '翻揚', '大戶連升', '集保', '均線', '切入',
    'entry', 'buy zone', 'breakout', 'support',
)
RISK_KEYWORDS = (
    '停損', '止損', '跌破', '減碼', '風險', '乖離', '警戒', '控管', '部位',
    '支撐', '壓力', '撤退', '防守', '破線', '爆量長黑', '高檔背離', '留意',
    'stop', 'risk', 'resistance', 'caution',
)
CHIP_PRESET_KEYWORDS = (
    '集保', '大戶', '籌碼', '400張', '1000張', '600張', '200張', '千張',
    '連升', '持股比', '篩選條件', '選股條件', '大戶持股', '籌碼集中',
)
FINANCE_SENTENCE_KEYWORDS = (
    '股', '大盤', '指數', '台積', '聯發科', '鴻海', '營收', '獲利', 'EPS',
    '目標價', '均線', '支撐', '壓力', '突破', '跌破', '買超', '賣超', '外資',
    '投信', '大戶', '籌碼', '集保', '利率', '聯準會', 'Fed', '通膨', 'CPI',
    '財報', '法說', '估值', '本益比', '殖利率', '配息', 'ETF', '半導體', 'AI',
    '停損', '進場', '布局', '加碼', '減碼', '多頭', '空頭', '量能', '成交量',
)

YT_ATOM_NS = {
    'atom': 'http://www.w3.org/2005/Atom',
    'yt': 'http://www.youtube.com/xml/schemas/2015',
    'media': 'http://search.yahoo.com/mrss/',
}


def _yt_get(url: str, timeout: int = 15) -> bytes:
    """抓取 YouTube 公開頁面／字幕；帶繁中語系與同意 Cookie。"""
    req = urllib.request.Request(
        url,
        headers={
            'User-Agent': (
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
            ),
            'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
            'Cookie': 'CONSENT=YES+cb; SOCS=CAI',
            'Cache-Control': 'no-cache',
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _yt_post_json(url: str, payload: dict, user_agent: str, timeout: int = 15) -> dict | None:
    body = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            'Content-Type': 'application/json',
            'User-Agent': user_agent,
            'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
            'Cookie': 'CONSENT=YES+cb; SOCS=CAI',
        },
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        parsed = json.loads(resp.read().decode('utf-8', errors='replace'))
        return parsed if isinstance(parsed, dict) else None


def _parse_iso8601_duration(raw: str) -> int | None:
    if not raw:
        return None
    m = re.fullmatch(r'PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?', raw.strip().upper())
    if not m or not any(m.groups()):
        return None
    h = int(m.group(1) or 0)
    mins = int(m.group(2) or 0)
    secs = int(m.group(3) or 0)
    return h * 3600 + mins * 60 + secs


def _format_time_label(sec: int) -> str:
    s = max(0, int(sec))
    h, rem = divmod(s, 3600)
    m, s = divmod(rem, 60)
    if h > 0:
        return f'{h:02d}:{m:02d}:{s:02d}'
    return f'{m:02d}:{s:02d}'


def _build_timestamp_url(video_id: str, sec: int) -> str:
    return f'https://www.youtube.com/watch?v={video_id}&t={max(0, int(sec))}s'


def _parse_iso_to_taipei(raw: str) -> tuple[str, float]:
    if not raw:
        return '', 0.0
    text = raw.strip()
    try:
        iso = text[:-1] + '+00:00' if text.endswith('Z') else text
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        tpe = dt.astimezone(TAIPEI_TZ)
        return tpe.isoformat(timespec='seconds'), tpe.timestamp()
    except Exception:
        return text[:19], 0.0


def _extract_balanced_json(html_text: str, marker: str) -> dict | None:
    """從 HTML 腳本中以括號配對安全擷取 JSON 物件（如 ytInitialPlayerResponse）。"""
    idx = html_text.find(marker)
    if idx < 0:
        return None
    brace_start = html_text.find('{', idx + len(marker))
    if brace_start < 0:
        return None

    depth = 0
    in_str = False
    escaped = False
    end_idx = -1
    limit = min(len(html_text), brace_start + 2_000_000)
    for i in range(brace_start, limit):
        ch = html_text[i]
        if in_str:
            if escaped:
                escaped = False
            elif ch == '\\':
                escaped = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                end_idx = i + 1
                break
    if end_idx < 0:
        return None
    try:
        parsed = json.loads(html_text[brace_start:end_idx])
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def _decode_json_str(raw: str) -> str:
    if not raw:
        return ''
    try:
        return json.loads(f'"{raw}"')
    except Exception:
        return html.unescape(raw)


def _parse_chapters_from_description(description: str) -> list[tuple[int, str]]:
    """從影片說明欄萃取時間戳章節（支援 MM:SS 與 HH:MM:SS）。"""
    if not description:
        return []
    chapters: list[tuple[int, str]] = []
    seen_secs: set[int] = set()
    pattern = re.compile(
        r'^\s*(?:[\[\(【])?(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[\]\)】])?\s*[-–—:|•·]?\s*(.+?)\s*$'
    )
    for line in description.splitlines():
        m = pattern.match(line)
        if not m:
            continue
        h = int(m.group(1) or 0)
        mins = int(m.group(2))
        secs = int(m.group(3))
        if mins >= 60 or secs >= 60:
            continue
        total_sec = h * 3600 + mins * 60 + secs
        title = re.sub(r'\s+', ' ', m.group(4)).strip(' -–—:|')
        if not title or len(title) < 2 or total_sec in seen_secs:
            continue
        seen_secs.add(total_sec)
        chapters.append((total_sec, title[:80]))
    chapters.sort(key=lambda x: x[0])
    return chapters


def _select_caption_track(tracks: list[dict]) -> dict | None:
    """依語言偏好挑選最佳字幕軌：zh-Hant/zh-TW > zh* > en* > 第一條可用字幕。"""
    valid = [t for t in tracks if isinstance(t, dict) and t.get('baseUrl')]
    if not valid:
        return None

    def score(track: dict) -> tuple[int, int]:
        lang = str(track.get('languageCode') or '').lower()
        is_asr = 1 if str(track.get('kind') or '').lower() == 'asr' else 0
        if lang in ('zh-hant', 'zh-tw', 'zh-hk'):
            return (0, is_asr)
        if lang.startswith('zh'):
            return (1, is_asr)
        if lang == 'en' or lang.startswith('en-'):
            return (2, is_asr)
        return (3, is_asr)

    valid.sort(key=score)
    return valid[0]


def _parse_json3_captions(raw_bytes: bytes) -> list[tuple[int, str]]:
    try:
        doc = json.loads(raw_bytes.decode('utf-8'))
    except Exception:
        return []
    events = doc.get('events') or []
    segments: list[tuple[int, str]] = []
    for ev in events:
        if not isinstance(ev, dict):
            continue
        segs = ev.get('segs')
        if not isinstance(segs, list):
            continue
        text = ''.join(str(s.get('utf8') or '') for s in segs if isinstance(s, dict))
        text = re.sub(r'\s+', ' ', html.unescape(text)).strip()
        if not text:
            continue
        start_ms = ev.get('tStartMs')
        try:
            sec = max(0, int(int(start_ms) // 1000))
        except (TypeError, ValueError):
            sec = 0
        segments.append((sec, text))
    return segments


def _parse_xml_captions(raw_bytes: bytes) -> list[tuple[int, str]]:
    try:
        root = ET.fromstring(raw_bytes)
    except Exception:
        return []
    segments: list[tuple[int, str]] = []
    # 傳統 timedtext <text start="12.3">
    for node in root.findall('.//text'):
        text = ''.join(node.itertext())
        text = re.sub(r'\s+', ' ', html.unescape(text)).strip()
        if not text:
            continue
        try:
            sec = max(0, int(float(node.attrib.get('start') or 0)))
        except ValueError:
            sec = 0
        segments.append((sec, text))
    if segments:
        return segments
    # srv3 格式 <p t="12300">
    for node in root.findall('.//p'):
        text = ''.join(node.itertext())
        text = re.sub(r'\s+', ' ', html.unescape(text)).strip()
        if not text:
            continue
        try:
            sec = max(0, int(int(node.attrib.get('t') or 0) // 1000))
        except ValueError:
            sec = 0
        segments.append((sec, text))
    return segments


def _merge_caption_segments(
    segments: list[tuple[int, str]],
    window_sec: int = 22,
    max_chars: int = 160,
) -> list[tuple[int, str]]:
    """將碎裂的字幕片語依時間視窗與句點合併為可讀段落，同時保留準確起始秒數。"""
    if not segments:
        return []
    merged: list[tuple[int, str]] = []
    cur_sec, cur_text = segments[0]
    for sec, txt in segments[1:]:
        sep = '' if (cur_text and ord(cur_text[-1]) > 127 and txt and ord(txt[0]) > 127) else ' '
        candidate = (cur_text + sep + txt).strip()
        ends_sentence = cur_text.endswith(('。', '！', '？', '.', '!', '?'))
        if (sec - cur_sec >= window_sec) or len(candidate) > max_chars or (ends_sentence and len(cur_text) >= 24):
            merged.append((cur_sec, cur_text.strip()))
            cur_sec, cur_text = sec, txt
        else:
            cur_text = candidate
    if cur_text.strip():
        merged.append((cur_sec, cur_text.strip()))
    return merged


def _strip_json_fences(text: str) -> str:
    cleaned = text.strip()
    cleaned = re.sub(r'^```(?:json)?\s*', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\s*```$', '', cleaned)
    return cleaned.strip()


def _parse_json_object_from_text(text: str) -> dict | None:
    cleaned = _strip_json_fences(text)
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


def _normalize_screener_preset(raw: dict | None, fallback_name: str = '頻道籌碼策略') -> dict | None:
    if not isinstance(raw, dict):
        return None
    band = str(raw.get('band') or '400').strip()
    if band not in VALID_BANDS:
        # 嘗試對應數字
        digits = re.sub(r'\D', '', band)
        band = digits if digits in VALID_BANDS else '400'
    try:
        weeks = int(round(float(raw.get('weeks', 2))))
    except (TypeError, ValueError):
        weeks = 2
    weeks = max(1, min(4, weeks))

    try:
        min_pp = round(float(raw.get('minPp', 0.2)), 2)
    except (TypeError, ValueError):
        min_pp = 0.2
    min_pp = max(0.0, min(20.0, min_pp))

    try:
        weekly_min = round(float(raw.get('weeklyMin', 0.0)), 2)
    except (TypeError, ValueError):
        weekly_min = 0.0
    weekly_min = max(0.0, min(10.0, weekly_min))

    need_shares = bool(raw.get('needShares', True))
    name = str(raw.get('name') or fallback_name).strip()[:36] or fallback_name
    return {
        'name': name,
        'band': band,
        'weeks': weeks,
        'minPp': min_pp,
        'weeklyMin': weekly_min,
        'needShares': need_shares,
    }


def _extract_screener_preset_by_rule(text: str, channel_name: str) -> dict | None:
    """僅於影片字幕／說明實際提及籌碼或選股條件時，才產出 screenerPreset，否則回傳 None。"""
    lower = text.lower()
    if not any(kw in lower for kw in CHIP_PRESET_KEYWORDS):
        return None

    band = '400'
    if any(k in text for k in ('1000張', '千張', '1,000張')):
        band = '1000'
    elif '600張' in text:
        band = '600'
    elif '200張' in text:
        band = '200'
    elif '400張' in text:
        band = '400'

    weeks = 2
    m_weeks = re.search(r'(?:連[續升增]*\s*([1-4])\s*[週周]|([1-4])\s*[週周]\s*連[升增])', text)
    if m_weeks:
        weeks = int(m_weeks.group(1) or m_weeks.group(2))

    min_pp = 0.2
    m_pp = re.search(
        r'(?:增加|上升|提高|增幅|大於|超過|至少|門檻)[^\d]{0,8}(\d+(?:\.\d+)?)\s*(?:%|百分比|百分點|pp)',
        text,
        flags=re.IGNORECASE,
    )
    if m_pp:
        try:
            min_pp = max(0.0, min(20.0, round(float(m_pp.group(1)), 2)))
        except ValueError:
            min_pp = 0.2

    weekly_min = 0.0
    m_wmin = re.search(
        r'(?:單[週周]|每[週周])[^\d]{0,8}(\d+(?:\.\d+)?)\s*(?:%|百分比|百分點|pp)',
        text,
        flags=re.IGNORECASE,
    )
    if m_wmin:
        try:
            weekly_min = max(0.0, min(10.0, round(float(m_wmin.group(1)), 2)))
        except ValueError:
            weekly_min = 0.0

    need_shares = '不限股數' not in text
    prefix = (channel_name or '頻道').strip()[:10]
    return {
        'name': f'{prefix}｜{band}張連升{weeks}週',
        'band': band,
        'weeks': weeks,
        'minPp': min_pp,
        'weeklyMin': weekly_min,
        'needShares': need_shares,
    }


def _parse_time_value(raw) -> int:
    if isinstance(raw, (int, float)):
        return max(0, int(raw))
    text = str(raw or '').strip()
    if text.isdigit():
        return max(0, int(text))
    m = re.match(r'^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$', text)
    if m:
        return int(m.group(1) or 0) * 3600 + int(m.group(2)) * 60 + int(m.group(3))
    return 0


class ChannelService:
    def __init__(
        self,
        app_data_dir: Path,
        project_root: Path,
        stock_names: dict | None = None,
        feed_service=None,
    ):
        self.app_data_dir = Path(app_data_dir)
        self.project_root = Path(project_root)
        self.stock_names = stock_names or {}
        self.feed_service = feed_service
        self.user_dir = self.app_data_dir / 'user-v1'
        self.channels_dir = self.app_data_dir / 'channels-v1'
        self.config_file = self.user_dir / 'channels-config.json'
        self.secrets_file = self.user_dir / 'briefing-secrets.json'
        self._lock = threading.Lock()
        self._us_cache: tuple[dict[str, str], list[tuple[str, str]]] | None = None

    # ---------- JSON 讀寫與金鑰 ----------

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

    def _channel_file(self, channel_id: str) -> Path:
        if not SAFE_CHANNEL_ID_RE.fullmatch(channel_id):
            raise ValueError('無效的頻道 ID')
        return self.channels_dir / f'{channel_id}.json'

    def _load_config_raw(self) -> dict:
        raw = self._read_json(self.config_file, {})
        auto_daily = bool(raw.get('autoDailyEnabled', False))
        try:
            cooldown = int(raw.get('cooldownMinutes', DEFAULT_COOLDOWN_MINUTES))
        except (TypeError, ValueError):
            cooldown = DEFAULT_COOLDOWN_MINUTES
        cooldown = max(1, min(1440, cooldown))

        try:
            max_vid_mins = int(raw.get('maxVideoMinutes', DEFAULT_MAX_VIDEO_MINUTES))
        except (TypeError, ValueError):
            max_vid_mins = DEFAULT_MAX_VIDEO_MINUTES
        max_vid_mins = max(MIN_VIDEO_MINUTES, min(MAX_VIDEO_MINUTES, max_vid_mins))

        channels: list[dict] = []
        seen: set[str] = set()
        for ch in raw.get('channels') or []:
            if not isinstance(ch, dict):
                continue
            cid = str(ch.get('id') or '').strip()
            if not SAFE_CHANNEL_ID_RE.fullmatch(cid) or cid in seen:
                continue
            seen.add(cid)
            channels.append({
                'id': cid,
                'name': str(ch.get('name') or cid).strip(),
                'handle': str(ch.get('handle') or '').strip(),
                'url': str(ch.get('url') or f'https://www.youtube.com/channel/{cid}').strip(),
                'addedAt': str(ch.get('addedAt') or ''),
            })
        return {
            'version': 1,
            'autoDailyEnabled': auto_daily,
            'cooldownMinutes': cooldown,
            'maxVideoMinutes': max_vid_mins,
            'channels': channels,
        }

    def _load_channel_state(self, meta: dict) -> dict:
        cid = meta['id']
        path = self._channel_file(cid)
        cached = self._read_json(path, {})
        strategies = cached.get('strategies')
        if not isinstance(strategies, list):
            strategies = []
        raw_dur = cached.get('lastVideoDurationSec')
        try:
            dur_sec = int(raw_dur) if raw_dur is not None and raw_dur != '' else None
            if dur_sec is not None and dur_sec < 0:
                dur_sec = None
        except (TypeError, ValueError):
            dur_sec = None
        return {
            'id': cid,
            'name': str(cached.get('name') or meta.get('name') or cid),
            'handle': str(cached.get('handle') or meta.get('handle') or ''),
            'url': str(cached.get('url') or meta.get('url') or f'https://www.youtube.com/channel/{cid}'),
            'addedAt': str(cached.get('addedAt') or meta.get('addedAt') or ''),
            'lastCheckedAt': str(cached.get('lastCheckedAt') or ''),
            'lastVideoId': str(cached.get('lastVideoId') or ''),
            'lastVideoTitle': str(cached.get('lastVideoTitle') or ''),
            'lastVideoUrl': str(cached.get('lastVideoUrl') or ''),
            'lastVideoPublishedAt': str(cached.get('lastVideoPublishedAt') or ''),
            'lastVideoDurationSec': dur_sec,
            'status': str(cached.get('status') or 'idle'),
            'statusMessage': str(cached.get('statusMessage') or ''),
            'strategies': strategies[:MAX_STRATEGIES_PER_CHANNEL],
        }

    def _save_channel_state(self, ch_state: dict) -> None:
        cid = ch_state['id']
        to_save = dict(ch_state)
        to_save['strategies'] = list(to_save.get('strategies') or [])[:MAX_STRATEGIES_PER_CHANNEL]
        self._write_json(self._channel_file(cid), to_save)

    # ---------- 美股與台股名稱表 ----------

    def _load_us_name_map(self) -> tuple[dict[str, str], list[tuple[str, str]]]:
        if self._us_cache is not None:
            return self._us_cache
        name_map = {
            'TSM': '台積電 ADR', 'NVDA': 'NVIDIA', 'AAPL': 'Apple', 'MSFT': 'Microsoft',
            'GOOGL': 'Alphabet', 'AMZN': 'Amazon', 'META': 'Meta', 'TSLA': 'Tesla',
            'AMD': 'AMD', 'AVGO': 'Broadcom', 'JPM': 'JPMorgan', 'GS': 'Goldman Sachs',
            'MS': 'Morgan Stanley', 'BAC': 'Bank of America', 'WMT': 'Walmart',
            'COST': 'Costco', 'LLY': 'Eli Lilly', 'NFLX': 'Netflix', 'BRK-B': 'Berkshire Hathaway',
            'SPY': 'S&P 500 ETF', 'QQQ': 'Nasdaq 100 ETF', 'SOXX': 'iShares 半導體 ETF',
            'VOO': 'Vanguard S&P 500', 'DIA': 'SPDR 道瓊 ETF', 'IWM': 'iShares 羅素 2000',
            'TLT': '20年期美債 ETF', 'GLD': 'SPDR 黃金 ETF', 'ASML': 'ASML', 'INTC': 'Intel',
            'MU': 'Micron', 'QCOM': 'Qualcomm', 'ARM': 'Arm', 'ORCL': 'Oracle', 'PLTR': 'Palantir',
            'SMCI': 'Super Micro',
        }
        keywords: list[tuple[str, str]] = []
        sp_file = self.project_root / 'data' / 'sp500_universe.json'
        if sp_file.exists():
            try:
                doc = json.loads(sp_file.read_text(encoding='utf-8'))
                for item in doc.get('items') or []:
                    code = str(item.get('code') or '').strip().upper()
                    disp = str(item.get('name') or code).strip()
                    en_name = str(item.get('enName') or '').strip()
                    if not code:
                        continue
                    name_map.setdefault(code, disp)
                    clean_en = re.sub(
                        r',?\s+(?:Inc\.?|Corp\.?|Corporation|Ltd\.?|PLC|Co\.?|Group|Holdings)$',
                        '',
                        en_name,
                        flags=re.IGNORECASE,
                    ).strip()
                    if len(clean_en) >= 6:
                        keywords.append((clean_en, code))
            except Exception:
                pass
        self._us_cache = (name_map, keywords)
        return self._us_cache

    def _stock_meta(self, code: str, fallback_name: str = '') -> tuple[str, str]:
        sym = code.strip().upper()
        is_tw = bool(VALID_TW_CODE_RE.fullmatch(sym))
        if is_tw:
            info = self.stock_names.get(sym)
            if isinstance(info, list) and info:
                return str(info[0]), str(info[1] if len(info) > 1 else 'TWSE')
            return (fallback_name or ('ETF' if sym.startswith('00') else sym)), 'TWSE'
        us_names, _ = self._load_us_name_map()
        return us_names.get(sym) or fallback_name or sym, 'US'

    # ---------- YouTube 頻道解析與 RSS ----------

    def _fetch_text(self, url: str, timeout: int = 15) -> str:
        raw = _yt_get(url, timeout=timeout)
        return raw.decode('utf-8', errors='replace')

    def _extract_channel_meta_from_html(
        self,
        page_html: str,
        hint_channel_id: str = '',
        hint_handle: str = '',
        is_video: bool = False,
    ) -> tuple[str, str, str]:
        channel_id = hint_channel_id
        if not channel_id:
            id_patterns = (
                r'<meta\s+itemprop="identifier"\s+content="(UC[A-Za-z0-9_-]{22})"',
                r'<meta\s+itemprop="channelId"\s+content="(UC[A-Za-z0-9_-]{22})"',
                r'<link\s+rel="canonical"\s+href="https?://(?:www\.)?youtube\.com/channel/(UC[A-Za-z0-9_-]{22})"',
                r'"externalId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"',
                r'"channelId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"',
                r'"browseId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"',
                r'https?://(?:www\.)?youtube\.com/channel/(UC[A-Za-z0-9_-]{22})',
            )
            for pat in id_patterns:
                m = re.search(pat, page_html)
                if m:
                    channel_id = m.group(1)
                    break

        handle = hint_handle
        if not handle:
            handle_patterns = (
                r'"vanityChannelUrl"\s*:\s*"https?://(?:www\.)?youtube\.com/(@[^"/?&#\\]+)"',
                r'"canonicalBaseUrl"\s*:\s*"/(@[^"/?&#\\]+)"',
                r'https?://(?:www\.)?youtube\.com/(@[A-Za-z0-9._%-]+)',
            )
            for pat in handle_patterns:
                m = re.search(pat, page_html)
                if m:
                    handle = urllib.parse.unquote(m.group(1))
                    break

        name = ''
        name_patterns = (
            (
                r'"ownerChannelName"\s*:\s*"((?:[^"\\]|\\.)+)"',
                r'"channelMetadataRenderer"\s*:\s*\{[^{}]{0,600}?"title"\s*:\s*"((?:[^"\\]|\\.)+)"',
                r'"author"\s*:\s*"((?:[^"\\]|\\.)+)"',
                r'<link\s+itemprop="name"\s+content="([^"]+)"',
            )
            if is_video
            else (
                r'"ownerChannelName"\s*:\s*"((?:[^"\\]|\\.)+)"',
                r'"channelMetadataRenderer"\s*:\s*\{[^{}]{0,600}?"title"\s*:\s*"((?:[^"\\]|\\.)+)"',
                r'"author"\s*:\s*"((?:[^"\\]|\\.)+)"',
                r'<meta\s+property="og:title"\s+content="([^"]+)"',
                r'<meta\s+itemprop="name"\s+content="([^"]+)"',
                r'<link\s+itemprop="name"\s+content="([^"]+)"',
                r'<title>\s*(.*?)\s*(?:-\s*YouTube)?\s*</title>',
            )
        )
        for pat in name_patterns:
            m = re.search(pat, page_html, flags=re.DOTALL)
            if m:
                cand = _decode_json_str(m.group(1)).strip()
                cand = re.sub(r'\s*-\s*YouTube\s*$', '', cand).strip()
                if cand and cand.lower() != 'youtube':
                    name = cand
                    break

        return channel_id, name, handle

    def _normalize_input_target(self, raw_input: str) -> tuple[str, str, str, bool]:
        """回傳 (fetch_url, hint_channel_id, hint_handle, is_video_url)。"""
        text = str(raw_input or '').strip()
        if not text:
            raise ValueError('請輸入 YouTube 頻道網址、@handle、頻道 ID 或影片連結')

        if CHANNEL_ID_RE.fullmatch(text):
            return f'https://www.youtube.com/channel/{text}', text, '', False

        if text.startswith('@'):
            handle = text.split('/')[0].split('?')[0].strip()
            if len(handle) < 2:
                raise ValueError('無效的 YouTube @handle')
            enc = urllib.parse.quote(handle, safe='@._-')
            return f'https://www.youtube.com/{enc}', '', handle, False

        url_str = text
        if not re.match(r'^https?://', url_str, flags=re.IGNORECASE):
            if any(h in url_str.lower() for h in ('youtube.com', 'youtu.be')):
                url_str = 'https://' + url_str
            else:
                raise ValueError('請輸入有效的 YouTube 頻道網址、@handle、UC 頻道 ID 或影片連結')

        parsed = urllib.parse.urlsplit(url_str)
        host = (parsed.netloc or '').lower()
        if host.startswith('www.'):
            host = host[4:]
        if host.startswith('m.'):
            host = host[2:]
        if host not in ('youtube.com', 'youtu.be', 'music.youtube.com'):
            raise ValueError('僅支援 YouTube 頻道或影片連結')

        path = parsed.path.strip('/')
        qs = urllib.parse.parse_qs(parsed.query)

        # youtu.be/<videoId>
        if host == 'youtu.be':
            vid = path.split('/')[0] if path else ''
            if not VIDEO_ID_RE.fullmatch(vid):
                raise ValueError('無效的 youtu.be 影片連結')
            return f'https://www.youtube.com/watch?v={vid}', '', '', True

        # youtube.com/watch?v=<videoId>
        if path == 'watch' or path.startswith('watch/'):
            vid = (qs.get('v') or [''])[0].strip()
            if not VIDEO_ID_RE.fullmatch(vid):
                raise ValueError('無效的 YouTube 影片連結（缺少有效 v 參數）')
            return f'https://www.youtube.com/watch?v={vid}', '', '', True

        # youtube.com/shorts/<videoId> 或 /live/<videoId>
        parts = [p for p in path.split('/') if p]
        if len(parts) >= 2 and parts[0] in ('shorts', 'live', 'embed'):
            vid = parts[1]
            if not VIDEO_ID_RE.fullmatch(vid):
                raise ValueError('無效的 YouTube 影片連結')
            return f'https://www.youtube.com/watch?v={vid}', '', '', True

        # youtube.com/channel/UC...
        if len(parts) >= 2 and parts[0] == 'channel':
            cid = parts[1]
            if not CHANNEL_ID_RE.fullmatch(cid):
                raise ValueError('無效的 YouTube 頻道 ID（應為 UC 開頭 24 碼）')
            return f'https://www.youtube.com/channel/{cid}', cid, '', False

        # youtube.com/@handle
        if parts and parts[0].startswith('@'):
            handle = urllib.parse.unquote(parts[0])
            enc = urllib.parse.quote(handle, safe='@._-')
            return f'https://www.youtube.com/{enc}', '', handle, False

        # youtube.com/c/... 或 /user/...
        if len(parts) >= 2 and parts[0] in ('c', 'user'):
            enc_seg = urllib.parse.quote(urllib.parse.unquote(parts[1]), safe='._-')
            return f'https://www.youtube.com/{parts[0]}/{enc_seg}', '', '', False

        # youtube.com/<customName>
        if len(parts) == 1 and parts[0] not in ('feed', 'playlist', 'results', 'gaming'):
            enc_seg = urllib.parse.quote(urllib.parse.unquote(parts[0]), safe='@._-')
            return f'https://www.youtube.com/{enc_seg}', '', '', False

        raise ValueError('無法辨識的 YouTube 網址格式，請貼上頻道頁、@handle 或影片連結')

    def resolve_channel(self, raw_input: str) -> dict:
        fetch_url, hint_cid, hint_handle, is_video = self._normalize_input_target(raw_input)
        page_html = ''
        fetch_err = ''
        try:
            page_html = self._fetch_text(fetch_url, timeout=15)
        except Exception as exc:
            fetch_err = str(exc)

        cid, name, handle = self._extract_channel_meta_from_html(
            page_html,
            hint_channel_id=hint_cid,
            hint_handle=hint_handle,
            is_video=is_video,
        )

        # 若輸入為影片頁且還沒有取得完整頻道 handle，可保留影片頁抽出的 ownerChannelName 與 channelId
        if not cid or not CHANNEL_ID_RE.fullmatch(cid):
            detail = f'（{fetch_err}）' if fetch_err else ''
            raise ValueError(f'無法從該連結解析 YouTube 頻道 ID{detail}')

        # 若頁面未抓到名稱（例如頁面擋住但已有 UC ID），嘗試從 RSS 補頻道名稱
        if not name:
            try:
                rss_name, _ = self._fetch_rss_videos(cid)
                if rss_name:
                    name = rss_name
            except Exception:
                pass

        if not name:
            name = handle or cid

        if is_video and name == cid:
            name = handle or cid

        canonical_url = (
            f'https://www.youtube.com/{urllib.parse.quote(handle, safe="@._-")}'
            if handle.startswith('@')
            else f'https://www.youtube.com/channel/{cid}'
        )
        return {
            'id': cid,
            'name': name,
            'handle': handle,
            'url': canonical_url,
        }

    def _fetch_rss_videos(self, channel_id: str) -> tuple[str, list[dict]]:
        rss_url = f'https://www.youtube.com/feeds/videos.xml?channel_id={urllib.parse.quote(channel_id, safe="")}'
        raw = _http_get(rss_url, timeout=15)
        root = ET.fromstring(raw)

        feed_title = (root.findtext('atom:title', '', YT_ATOM_NS) or '').strip()
        author_name = (root.findtext('atom:author/atom:name', '', YT_ATOM_NS) or '').strip()
        channel_name = author_name or feed_title

        entries: list[dict] = []
        for entry in root.findall('atom:entry', YT_ATOM_NS):
            vid = (entry.findtext('yt:videoId', '', YT_ATOM_NS) or '').strip()
            if not vid:
                atom_id = (entry.findtext('atom:id', '', YT_ATOM_NS) or '').strip()
                if atom_id.startswith('yt:video:'):
                    vid = atom_id[len('yt:video:'):]
            if not vid:
                continue
            title = (
                entry.findtext('atom:title', '', YT_ATOM_NS)
                or entry.findtext('media:group/media:title', '', YT_ATOM_NS)
                or ''
            ).strip()
            link_url = ''
            for lnk in entry.findall('atom:link', YT_ATOM_NS):
                if lnk.attrib.get('rel', 'alternate') == 'alternate' and lnk.attrib.get('href'):
                    link_url = lnk.attrib['href'].strip()
                    break
            if not link_url:
                link_url = f'https://www.youtube.com/watch?v={vid}'
            pub_raw = (entry.findtext('atom:published', '', YT_ATOM_NS) or '').strip()
            pub_iso, pub_ts = _parse_iso_to_taipei(pub_raw)
            desc = (entry.findtext('media:group/media:description', '', YT_ATOM_NS) or '').strip()
            entries.append({
                'videoId': vid,
                'title': title,
                'url': link_url,
                'publishedAt': pub_iso,
                'publishedTs': pub_ts,
                'description': desc,
            })

        entries.sort(key=lambda x: x['publishedTs'], reverse=True)
        return channel_name, entries

    # ---------- 影片中繼資料、前置過濾與 Tier 1 字幕擷取 ----------

    def _fetch_innertube_player(self, video_id: str, client_cfg: dict) -> dict | None:
        payload = {
            'videoId': video_id,
            'context': {
                'client': {
                    'clientName': client_cfg['clientName'],
                    'clientVersion': client_cfg['clientVersion'],
                    'hl': 'zh-TW',
                    'gl': 'TW',
                }
            },
        }
        try:
            resp = _yt_post_json(
                INNERTUBE_PLAYER_URL,
                payload,
                user_agent=client_cfg['userAgent'],
                timeout=15,
            )
            if isinstance(resp, dict):
                return resp
        except Exception:
            return None
        return None

    def _fetch_video_metadata(self, video_id: str, rss_description: str = '') -> dict:
        watch_url = f'https://www.youtube.com/watch?v={video_id}'
        description = rss_description or ''
        duration_sec: int | None = None
        is_live_now = False
        keywords: list[str] = []
        category = ''
        watch_tracks: list[dict] = []
        innertube_cache: dict[str, dict | None] = {}

        try:
            watch_html = self._fetch_text(watch_url, timeout=15)
        except Exception:
            watch_html = ''

        def apply_player_resp(player_resp: dict) -> None:
            nonlocal description, duration_sec, is_live_now, keywords, category
            vd = player_resp.get('videoDetails') or {}
            short_desc = vd.get('shortDescription')
            if isinstance(short_desc, str) and len(short_desc) >= len(description):
                description = short_desc
            if duration_sec is None and vd.get('lengthSeconds') not in (None, ''):
                try:
                    val = int(vd['lengthSeconds'])
                    if val >= 0:
                        duration_sec = val
                except (TypeError, ValueError):
                    pass
            if bool(vd.get('isLive')) or (bool(vd.get('isLiveContent')) and (duration_sec is None or duration_sec == 0)):
                is_live_now = True
            if not keywords and isinstance(vd.get('keywords'), list):
                keywords = [str(k).strip() for k in vd['keywords'] if str(k).strip()]
            if not category:
                mf = (player_resp.get('microformat') or {}).get('playerMicroformatRenderer') or {}
                cat = str(mf.get('category') or '').strip()
                if cat:
                    category = cat

        if watch_html:
            player_resp = _extract_balanced_json(watch_html, 'ytInitialPlayerResponse')
            if player_resp:
                apply_player_resp(player_resp)
                watch_tracks = (
                    (player_resp.get('captions') or {})
                    .get('playerCaptionsTracklistRenderer', {})
                    .get('captionTracks')
                    or []
                )
            if duration_sec is None:
                m_dur = re.search(r'<meta\s+itemprop="duration"\s+content="(PT[^"]+)"', watch_html, flags=re.IGNORECASE)
                if m_dur:
                    duration_sec = _parse_iso8601_duration(m_dur.group(1))
            if not category:
                m_cat = re.search(r'<meta\s+itemprop="genre"\s+content="([^"]+)"', watch_html, flags=re.IGNORECASE)
                if m_cat:
                    category = html.unescape(m_cat.group(1)).strip()

        # 若 watch 頁未提供 lengthSeconds，嘗試 Innertube 補齊基本資訊（並快取供字幕複用）
        if duration_sec is None and not watch_tracks:
            for cli in INNERTUBE_CLIENTS:
                cname = cli['clientName']
                resp = self._fetch_innertube_player(video_id, cli)
                innertube_cache[cname] = resp
                if resp and resp.get('videoDetails'):
                    apply_player_resp(resp)
                    break

        return {
            'description': description,
            'durationSec': duration_sec,
            'isLiveNow': is_live_now,
            'keywords': keywords,
            'category': category,
            'watchTracks': watch_tracks,
            'innertubeCache': innertube_cache,
        }

    def _fetch_video_captions(
        self,
        video_id: str,
        watch_tracks: list[dict] | None = None,
        innertube_cache: dict[str, dict | None] | None = None,
    ) -> list[tuple[int, str]]:
        # 1. 先嘗試 watch 頁取得的字幕軌（相容單元測試與快速路徑）
        if watch_tracks:
            track = _select_caption_track(watch_tracks)
            if track and track.get('baseUrl'):
                segs = self._download_caption_track(str(track['baseUrl']))
                if segs:
                    return segs

        # 2. YouTube WEB 頁面 timedtext 常因缺少 PO token 回傳空內容 -> 透過 Innertube ANDROID / IOS 補抓
        cache = innertube_cache if isinstance(innertube_cache, dict) else {}
        for cli in INNERTUBE_CLIENTS:
            cname = cli['clientName']
            if cname in cache:
                resp = cache[cname]
            else:
                resp = self._fetch_innertube_player(video_id, cli)
                cache[cname] = resp
            if not resp:
                continue
            tracks = (
                (resp.get('captions') or {})
                .get('playerCaptionsTracklistRenderer', {})
                .get('captionTracks')
                or []
            )
            track = _select_caption_track(tracks)
            if not track or not track.get('baseUrl'):
                continue
            segs = self._download_caption_track(str(track['baseUrl']))
            if segs:
                return segs
        return []

    def _fetch_video_captions_and_chapters(
        self,
        video_id: str,
        rss_description: str = '',
    ) -> tuple[list[tuple[int, str]], list[tuple[int, str]], str]:
        meta = self._fetch_video_metadata(video_id, rss_description=rss_description)
        segments = self._fetch_video_captions(
            video_id,
            watch_tracks=meta['watchTracks'],
            innertube_cache=meta['innertubeCache'],
        )
        chapters = _parse_chapters_from_description(meta['description'])
        return segments, chapters, meta['description']

    def _download_caption_track(self, base_url: str) -> list[tuple[int, str]]:
        parsed = urllib.parse.urlsplit(base_url)
        q = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
        q['fmt'] = ['json3']
        json3_url = urllib.parse.urlunsplit((
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            urllib.parse.urlencode(q, doseq=True),
            parsed.fragment,
        ))
        try:
            raw = _yt_get(json3_url, timeout=15)
            if raw:
                segs = _parse_json3_captions(raw) or _parse_xml_captions(raw)
                if segs:
                    return segs
        except Exception:
            pass

        # 退回原始 XML / srv3 timedtext
        try:
            raw_xml = _yt_get(base_url, timeout=15)
            if raw_xml:
                return _parse_xml_captions(raw_xml) or _parse_json3_captions(raw_xml)
        except Exception:
            return []
        return []

    def _count_finance_signals(self, text: str) -> tuple[int, int, int]:
        """回傳 (all_finance_kw_hits, core_market_hits, ticker_hits)。"""
        if not text:
            return 0, 0, 0
        lower = text.lower()
        kw_hits = 0
        for kw in ALL_FINANCE_KEYWORDS:
            if kw.isascii():
                if re.search(rf'(?<![a-z0-9]){re.escape(kw)}(?![a-z0-9])', lower):
                    kw_hits += 1
            elif kw in lower:
                kw_hits += 1

        core_hits = 0
        for kw in CORE_MARKET_TERMS:
            if kw.isascii():
                if re.search(rf'(?<![a-z0-9]){re.escape(kw)}(?![a-z0-9])', lower):
                    core_hits += 1
            elif kw in lower:
                core_hits += 1

        ticker_hits = len(self._extract_tickers_from_text(text, max_count=4))
        return kw_hits, core_hits, ticker_hits

    def _has_off_topic_signal(self, title: str, category: str = '') -> bool:
        lower_title = (title or '').lower()
        if (category or '').strip().lower() in NON_FINANCE_CATEGORIES:
            return True
        for kw in NON_FINANCE_TITLE_KEYWORDS:
            if kw.isascii():
                if re.search(rf'(?<![a-z0-9]){re.escape(kw)}(?![a-z0-9])', lower_title):
                    return True
            elif kw in lower_title:
                return True
        return False

    def _evaluate_finance_relevance(
        self,
        title: str,
        description: str,
        keywords: list[str] | None = None,
        category: str = '',
        caption_sample: str = '',
    ) -> str:
        """評估影片與財經／股票主題關聯性，回傳 'pass' | 'reject' | 'ambiguous'。"""
        kw_text = ' '.join(keywords or [])
        meta_text = f'{title}\n{description}\n{kw_text}'
        title_kw, title_core, title_tickers = self._count_finance_signals(title)
        meta_kw, meta_core, meta_tickers = self._count_finance_signals(meta_text)
        off_topic = self._has_off_topic_signal(title, category=category)

        # 標題有明確非財經訊號（旅遊/開箱/美食/遊戲/Vlog 等）時，須具備明確股市／投資詞才放行
        if off_topic:
            if title_core >= 1 or meta_core >= 2:
                return 'pass'
            if caption_sample:
                _, cap_core, cap_tickers = self._count_finance_signals(caption_sample)
                return 'pass' if (cap_core >= 2 or (cap_core >= 1 and cap_tickers >= 1)) else 'reject'
            return 'reject'

        # 標題本身已命中財經／標的關鍵字
        if title_core >= 1 or title_tickers >= 1 or title_kw >= 2:
            return 'pass'

        # 標題未明寫但說明欄＋標籤具備足夠財經訊號
        if (meta_core >= 2) or (meta_kw >= 2 and meta_tickers >= 1) or (meta_tickers >= 2):
            return 'pass'

        # 若已提供字幕樣本，作最終判定
        if caption_sample:
            comb_kw, comb_core, comb_tickers = self._count_finance_signals(f'{meta_text}\n{caption_sample}')
            if comb_core >= 2 or (comb_core >= 1 and comb_tickers >= 1) or (comb_kw >= 3):
                return 'pass'
            return 'reject'

        return 'ambiguous'

    # ---------- 股票標的抽取與即時報價豐富化 ----------

    def _extract_tickers_from_text(self, text: str, max_count: int = 8) -> list[dict]:
        if not text:
            return []
        _, sp_keywords = self._load_us_name_map()
        long_tw_names = [
            (str(info[0]).strip(), str(code).upper())
            for code, info in self.stock_names.items()
            if isinstance(info, list) and info and len(str(info[0]).strip()) >= 3
        ]
        short_tw_names = [
            (str(info[0]).strip(), str(code).upper())
            for code, info in self.stock_names.items()
            if isinstance(info, list) and info and len(str(info[0]).strip()) == 2
        ]

        hits: dict[str, str] = {}
        lower = text.lower()

        def find_snippet(needle: str) -> str:
            idx = lower.find(needle.lower())
            if idx < 0:
                return ''
            start = max(0, idx - 14)
            end = min(len(text), idx + len(needle) + 26)
            snip = re.sub(r'\s+', ' ', text[start:end]).strip()
            return snip[:48]

        def register(code: str, needle: str) -> None:
            sym = code.strip().upper()
            if not sym or sym in IGNORE_TICKERS or sym in hits or len(hits) >= max_count:
                return
            hits[sym] = find_snippet(needle)

        # 1. 別名表（避免「東南亞／南亞科」「台塑化」「長榮航」等子字串誤判）
        alias_guards = {
            '南亞': r'(?<!東)南亞(?!科)',
            '台塑': r'台塑(?!化)',
            '長榮': r'長榮(?!航)',
        }
        for alias, sym in NEWS_STOCK_ALIASES.items():
            if alias.isascii():
                if re.search(rf'(?<![A-Za-z0-9]){re.escape(alias)}(?![A-Za-z0-9])', lower):
                    register(sym, alias)
            elif alias in alias_guards:
                if re.search(alias_guards[alias], text):
                    register(sym, alias)
            elif alias in text:
                register(sym, alias)

        # 2. 明確 4 碼台股代號與 00xxx ETF（排除單純年份 2020~2035，支援緊鄰中文字）
        for m in re.finditer(r'([\(（])?(?<![A-Za-z0-9])(00[5-9]\d{1,3}[A-Z]?|\d{4})(?![A-Za-z0-9])([\)）])?', text):
            code = m.group(2).upper()
            if code.startswith('00'):
                if code in self.stock_names or re.fullmatch(r'00[5-9]\d{1,3}[A-Z]?', code):
                    register(code, code)
                continue
            if code not in self.stock_names:
                continue
            is_year_like = 2020 <= int(code) <= 2035
            info = self.stock_names.get(code) or []
            nm = info[0] if info else ''
            if is_year_like and not (m.group(1) and m.group(3)) and not (nm and nm in text):
                continue
            register(code, code)

        # 3. 3 字以上台股公司名
        for nm, code in long_tw_names:
            if nm in text:
                register(code, nm)
                if len(hits) >= max_count:
                    break

        # 4. 2 字台股名（需在明確股市語境）
        if len(hits) < max_count:
            for nm, code in short_tw_names:
                if nm in text and re.search(
                    rf'(?:^|[，、\s「『(（【]){re.escape(nm)}(?:：|:|股價|營收|獲利|法說|財報|買超|賣超|大漲|重挫|突破|跌破|目標價|籌碼|大戶)',
                    text,
                ):
                    register(code, nm)
                    if len(hits) >= max_count:
                        break

        # 5. S&P 500 英文完整公司名
        for kw, sym in sp_keywords:
            if re.search(rf'(?<![A-Za-z0-9]){re.escape(kw)}(?![A-Za-z0-9])', text, flags=re.IGNORECASE):
                register(sym, kw)
                if len(hits) >= max_count:
                    break

        # 6. 括號 / $ / 交易所標註的美股代號
        for m in re.finditer(
            r'(?:[\(（]|(?:NASDAQ|NYSE)\s*[:：]\s*|\$)([A-Z]{2,5}(?:-[A-Z])?)(?:[\)）]|(?![A-Za-z0-9]))',
            text,
        ):
            sym = m.group(1).upper()
            if sym not in IGNORE_TICKERS:
                register(sym, sym)

        return [{'code': code, 'name': '', 'note': note} for code, note in hits.items()]

    def _enrich_single_ticker(self, item: dict) -> dict:
        code = str(item.get('code') or '').strip().upper()
        fallback_name = str(item.get('name') or '').strip()
        note = str(item.get('note') or '').strip()[:80]
        name, market = self._stock_meta(code, fallback_name=fallback_name)

        is_tw = bool(VALID_TW_CODE_RE.fullmatch(code))
        quote = None
        try:
            if is_tw:
                quote = _fetch_yahoo_quote(f'{code}.TW') or _fetch_yahoo_quote(f'{code}.TWO')
            else:
                quote = _fetch_yahoo_quote(code)
        except Exception:
            quote = None

        return {
            'code': code,
            'name': name,
            'market': market,
            'price': quote['price'] if quote else None,
            'change': quote['change'] if quote else None,
            'changePct': quote['changePct'] if quote else None,
            'note': note,
        }

    def _enrich_tickers(self, raw_tickers: list[dict], max_count: int = 8) -> list[dict]:
        cleaned: list[dict] = []
        seen: set[str] = set()
        for t in raw_tickers:
            if isinstance(t, str):
                code = t.strip().upper()
                item = {'code': code, 'name': '', 'note': ''}
            elif isinstance(t, dict):
                code = str(t.get('code') or '').strip().upper()
                item = {
                    'code': code,
                    'name': str(t.get('name') or '').strip(),
                    'note': str(t.get('note') or '').strip(),
                }
            else:
                continue
            # 過濾不合法或雜訊代號
            if not code or code in IGNORE_TICKERS or code in seen:
                continue
            if not (VALID_TW_CODE_RE.fullmatch(code) or re.fullmatch(r'[A-Z]{1,5}(?:-[A-Z])?', code)):
                continue
            seen.add(code)
            cleaned.append(item)
            if len(cleaned) >= max_count:
                break

        if not cleaned:
            return []
        with ThreadPoolExecutor(max_workers=6) as pool:
            return list(pool.map(self._enrich_single_ticker, cleaned))

    # ---------- Gemini 呼叫（Tier 1a & Tier 2） ----------

    def _build_strategy_prompt(
        self,
        channel_name: str,
        video_title: str,
        mode: str,
        transcript_block: str = '',
        chapters_block: str = '',
        context: tuple = (),
    ) -> str:
        base_schema = (
            '請嚴格只輸出一個 JSON 物件（不要加 Markdown 程式碼區塊或額外解釋），欄位如下：\n'
            '{\n'
            '  "stance": "偏多" | "偏空" | "中性觀望",\n'
            '  "coreThesis": "1~2 句精簡繁體中文核心投資論點（不超過 100 字）",\n'
            '  "summaryBullets": [\n'
            '    {"timeSec": 95, "text": "該時間點重點摘要（繁體中文，不超過 65 字）"}\n'
            '  ],\n'
            '  "tickers": [\n'
            '    {"code": "2330 或 NVDA", "name": "公司名稱", "note": "影片中對該標的觀點（不超過 40 字）"}\n'
            '  ],\n'
            '  "entryConditions": ["明確進場或觀察觸發條件（1~4 條）"],\n'
            '  "riskControls": ["明確停損、風險或失效條件（1~4 條）"],\n'
            '  "catalysts": ["尚待驗證的催化劑與時間"],\n'
            '  "crossChecks": ["逐項對照影片觀點與給定本機日期及數據，標示一致、背離或待證"],\n'
            '  "counterRisks": ["觀點反面的風險或驗證條件"],\n'

            '  "screenerPreset": null 或 {"name": "策略名稱", "band": "200"|"400"|"600"|"1000", "weeks": 1~4整數, "minPp": 0~20數值, "weeklyMin": 0~10數值, "needShares": true}\n'
            '}\n'
            '規則：\n'
            '1. 全程使用繁體中文，嚴禁捏造影片未提及的標的、價格或數據。\n'
            '2. summaryBullets 產出 3~6 條，timeSec 必須為影片真實秒數（整數）。\n'
            '3. screenerPreset 只有在影片明確討論台股集保大戶籌碼／選股篩選條件時才填寫物件，否則一律填 null。\n'
        )
        base_schema += '\n本機資料僅供交叉核對，空缺標示待證。\n' + json.dumps(context, ensure_ascii=False)
        if mode == 'multimodal':
            return (
                f'你是專業台美股財經策略分析師。請直接聆聽這支 YouTube 影片的音軌，並閱讀畫面中的硬字幕與圖表。\n'
                f'頻道：{channel_name}\n影片標題：{video_title}\n\n'
                + base_schema
            )
        return (
            f'你是專業台美股財經策略分析師。請根據以下 YouTube 影片的帶時間戳字幕與章節資訊，萃取結構化策略卡。\n'
            f'頻道：{channel_name}\n影片標題：{video_title}\n'
            + (f'\n【影片章節】\n{chapters_block}\n' if chapters_block else '')
            + f'\n【帶時間戳字幕】\n{transcript_block}\n\n'
            + base_schema
        )

    def _normalize_strategy(
        self,
        raw: dict,
        video: dict,
        channel_name: str,
        source_mode: str,
        fallback_text: str = '',
    ) -> dict:
        vid = video['videoId']
        stance = str(raw.get('stance') or '中性觀望').strip()
        if stance not in VALID_STANCES:
            if any(k in stance for k in ('多', '買', '漲', 'bull')):
                stance = '偏多'
            elif any(k in stance for k in ('空', '賣', '跌', 'bear')):
                stance = '偏空'
            else:
                stance = '中性觀望'

        core_thesis = str(raw.get('coreThesis') or '').strip()[:220]
        if not core_thesis:
            core_thesis = f"影片〈{video['title']}〉重點觀點整理（立場：{stance}）。"

        bullets_out: list[dict] = []
        for b in raw.get('summaryBullets') or []:
            if not isinstance(b, dict):
                continue
            txt = str(b.get('text') or '').strip()
            if not txt:
                continue
            sec = _parse_time_value(b.get('timeSec'))
            bullets_out.append({
                'timeSec': sec,
                'timeLabel': _format_time_label(sec),
                'url': _build_timestamp_url(vid, sec),
                'text': txt[:140],
            })
        bullets_out.sort(key=lambda x: x['timeSec'])
        bullets_out = bullets_out[:6]

        raw_tickers = raw.get('tickers') if isinstance(raw.get('tickers'), list) else []
        if not raw_tickers and fallback_text:
            raw_tickers = self._extract_tickers_from_text(fallback_text)
        tickers = self._enrich_tickers(raw_tickers)

        entry_conditions = [
            str(x).strip()[:120]
            for x in (raw.get('entryConditions') or [])
            if str(x).strip()
        ][:5]
        risk_controls = [
            str(x).strip()[:120]
            for x in (raw.get('riskControls') or [])
            if str(x).strip()
        ][:5]

        preset = _normalize_screener_preset(
            raw.get('screenerPreset'),
            fallback_name=f'{channel_name[:10]}｜籌碼篩選',
        )

        now = taipei_now()
        return {
            'id': f'strat_{vid}_{int(now.timestamp())}',
            'videoId': vid,
            'videoTitle': video['title'],
            'videoUrl': video['url'],
            'publishedAt': video['publishedAt'],
            'analyzedAt': now.isoformat(timespec='seconds'),
            'sourceMode': source_mode,
            'stance': stance,
            'coreThesis': core_thesis,
            'summaryBullets': bullets_out,
            'tickers': tickers,
            'entryConditions': entry_conditions,
            'riskControls': risk_controls,
            'screenerPreset': preset,
        }

    # ---------- Tier 1b：規則式摘要器 ----------

    def _summarize_by_rule(
        self,
        video: dict,
        channel_name: str,
        merged_segments: list[tuple[int, str]],
        chapters: list[tuple[int, str]],
        description: str,
    ) -> dict:
        full_transcript = ' '.join(txt for _, txt in merged_segments)
        combined_text = f"{video['title']}\n{description}\n{full_transcript}"

        # 1. 立場推斷
        lower_all = combined_text.lower()
        bull_hits = sum(lower_all.count(k.lower()) for k in BULLISH_KEYWORDS)
        bear_hits = sum(lower_all.count(k.lower()) for k in BEARISH_KEYWORDS)
        if bull_hits >= bear_hits + 2 and bull_hits > 0:
            stance = '偏多'
        elif bear_hits >= bull_hits + 2 and bear_hits > 0:
            stance = '偏空'
        else:
            stance = '中性觀望'

        # 2. 時間戳重點（優先結合章節與對應字幕，否則依財經關鍵字權重挑選時間分散片段）
        bullets: list[dict] = []
        if chapters:
            for idx, (c_sec, c_title) in enumerate(chapters[:6]):
                next_sec = chapters[idx + 1][0] if idx + 1 < len(chapters) else c_sec + 180
                nearby = [txt for s, txt in merged_segments if c_sec <= s < next_sec]
                snippet = nearby[0][:70] if nearby else ''
                b_text = f'{c_title}：{snippet}' if snippet and c_title not in snippet else c_title
                bullets.append({'timeSec': c_sec, 'text': b_text[:130]})

        if len(bullets) < 3 and merged_segments:
            scored: list[tuple[int, int, str]] = []
            for sec, txt in merged_segments:
                sc = sum(1 for kw in FINANCE_SENTENCE_KEYWORDS if kw.lower() in txt.lower())
                if re.search(r'\d+(?:\.\d+)?%', txt):
                    sc += 2
                if re.search(r'\b\d{4}\b', txt):
                    sc += 1
                scored.append((sc, sec, txt))
            scored.sort(key=lambda x: (x[0], len(x[2])), reverse=True)
            chosen_secs = {b['timeSec'] for b in bullets}
            for _, sec, txt in scored:
                if len(bullets) >= 5:
                    break
                if any(abs(sec - existing) < 20 for existing in chosen_secs):
                    continue
                chosen_secs.add(sec)
                bullets.append({'timeSec': sec, 'text': txt[:120]})

        if not bullets and merged_segments:
            sec, txt = merged_segments[0]
            bullets.append({'timeSec': sec, 'text': txt[:120]})

        bullets.sort(key=lambda x: x['timeSec'])

        # 3. 標的抽取
        raw_tickers = self._extract_tickers_from_text(combined_text, max_count=8)

        # 4. 進場條件與風險控管
        sentences = [
            s.strip()
            for s in re.split(r'[。！？\n;；]+', full_transcript)
            if len(s.strip()) >= 8
        ]
        if not sentences:
            sentences = [txt for _, txt in merged_segments if len(txt) >= 8]

        entry_conditions: list[str] = []
        risk_controls: list[str] = []
        for sent in sentences:
            s_low = sent.lower()
            if len(entry_conditions) < 3 and any(k in s_low for k in ENTRY_KEYWORDS):
                clean = sent[:100]
                if clean not in entry_conditions:
                    entry_conditions.append(clean)
            if len(risk_controls) < 3 and any(k in s_low for k in RISK_KEYWORDS):
                clean = sent[:100]
                if clean not in risk_controls:
                    risk_controls.append(clean)

        if not entry_conditions:
            entry_conditions = ['影片未明列固定進場價位，建議搭配時間戳重點與量價均線確認。']
        if not risk_controls:
            risk_controls = ['影片未明列具體停損點，建議自行設定關鍵支撐與單筆部位上限。']

        # 5. 核心論點
        ticker_codes = '、'.join(t['code'] for t in raw_tickers[:4])
        lead_text = bullets[0]['text'] if bullets else video['title']
        if ticker_codes:
            core_thesis = f'立場{stance}，聚焦 {ticker_codes}；核心觀察：{lead_text[:95]}'
        else:
            core_thesis = f'立場{stance}；核心觀察：{lead_text[:110]}'

        # 6. 可選 screenerPreset（僅在討論籌碼／大戶條件時生成）
        preset = _extract_screener_preset_by_rule(combined_text, channel_name)

        return self._normalize_strategy(
            raw={
                'stance': stance,
                'coreThesis': core_thesis,
                'summaryBullets': bullets,
                'tickers': raw_tickers,
                'entryConditions': entry_conditions,
                'riskControls': risk_controls,
                'screenerPreset': preset,
            },
            video=video,
            channel_name=channel_name,
            source_mode='cc_rule',
            fallback_text=combined_text,
        )

    # ---------- 三層影片解析總控 ----------

    def _analyze_video(
        self,
        video: dict,
        channel_name: str,
        max_video_minutes: int = DEFAULT_MAX_VIDEO_MINUTES,
    ) -> tuple[str, str, dict | None, int | None]:
        """回傳 (status, statusMessage, strategy_or_None, durationSec_or_None)。"""
        meta = self._fetch_video_metadata(
            video['videoId'],
            rss_description=video.get('description', ''),
        )
        duration_sec: int | None = meta['durationSec']
        description: str = meta['description']

        # 前置過濾 1：超長影片或進行中直播（不抓字幕、不呼叫 AI）
        if meta['isLiveNow']:
            return (
                'skipped_too_long',
                '此影片為進行中直播，暫無法確認完整長度與字幕，已自動略過解析',
                None,
                duration_sec,
            )
        if duration_sec is not None and duration_sec > max_video_minutes * 60:
            approx_mins = max(1, round(duration_sec / 60))
            return (
                'skipped_too_long',
                f'影片長度約 {approx_mins} 分鐘，超過上限 {max_video_minutes} 分鐘，已自動略過解析',
                None,
                duration_sec,
            )

        # 前置過濾 2：財經／股票主題關聯性（先依標題／說明／標籤判斷）
        rel = self._evaluate_finance_relevance(
            title=video.get('title', ''),
            description=description,
            keywords=meta['keywords'],
            category=meta['category'],
        )
        if rel == 'reject':
            return 'skipped_non_finance', SKIPPED_NON_FINANCE_MSG, None, duration_sec

        ai = ai_router.session(self.app_data_dir, 'channels')
        status = ai.status
        segments = self._fetch_video_captions(
            video['videoId'],
            watch_tracks=meta['watchTracks'],
            innertube_cache=meta['innertubeCache'],
        )
        chapters = _parse_chapters_from_description(description)

        # 若標題／說明語意模糊，改以短段字幕樣本複判；無字幕時亦不浪費 AI 額度
        if rel == 'ambiguous':
            sample_text = ' '.join(txt for _, txt in segments[:30])[:800] if segments else ''
            final_rel = self._evaluate_finance_relevance(
                title=video.get('title', ''),
                description=description,
                keywords=meta['keywords'],
                category=meta['category'],
                caption_sample=sample_text or ' ',
            )
            if final_rel != 'pass':
                return 'skipped_non_finance', SKIPPED_NON_FINANCE_MSG, None, duration_sec

        merged = _merge_caption_segments(segments) if segments else []
        transcript = '\n'.join(f'[{_format_time_label(sec)}] {line}' for sec, line in merged)
        if len(transcript) > 26000:
            transcript = transcript[:18000] + '\n...\n' + transcript[-7500:]
        fallback_text = f"{video['title']}\n{description}\n{transcript}"
        if ai.status == 'ready' and (merged or ai.video):
            try:
                mode = 'cc' if merged else 'multimodal'
                context = self._strategy_context(fallback_text)
                prompt = self._build_strategy_prompt(
                    channel_name, video['title'], mode, transcript,
                    '\n'.join(f'[{_format_time_label(sec)}] {text}' for sec, text in chapters[:20]),
                    context,
                )
                video_url = None if merged else f"https://www.youtube.com/watch?v={video['videoId']}"
                raw = ai.generate(prompt, video_url=video_url)
                if not isinstance(raw.get('coreThesis'), str) or not raw['coreThesis'].strip():
                    raise RuntimeError('策略卡缺少核心觀點')
                strategy = self._normalize_strategy(
                    raw, video, channel_name, 'cc_ai' if merged else 'video_ai', fallback_text,
                )
                strategy['ai'] = ai.metadata('success')
                strategy['analysis'] = {key: ai_router.text_items(raw.get(key))
                                        for key in ('catalysts', 'crossChecks', 'counterRisks')}
                return 'ready', '', strategy, duration_sec
            except (RuntimeError, ValueError, TypeError):
                status = 'failed'

        if merged:
            strategy = self._summarize_by_rule(video, channel_name, merged, chapters, description)
            strategy['ai'] = ai.metadata(status)
            return 'ready', '', strategy, duration_sec
        status = 'unsupported_video' if status == 'ready' else status
        return 'waiting_subtitles', '尚無字幕。' + ai.metadata(status)['message'], None, duration_sec

    def _strategy_context(self, text):
        if self.feed_service is None:
            return []
        data = self.feed_service.initial()
        weeks = data['weeks']
        day = max(weeks, default='')
        rows = weeks.get(day, {}).get('rows', {})
        market = data['market']
        result = []
        for ticker in self._extract_tickers_from_text(text, max_count=5):
            code = ticker['code']
            row = rows.get(code)
            item = {'code': code}
            if row and row[0] > 0:
                item.update(tdccDate=day, tdcc400Shares=row[3], tdccTotal=row[0])
            for key in ('TWSE-day', 'TPEx-day'):
                bar = (market.get(key) or {}).get('rows', {}).get(code)
                if bar:
                    item.update(priceDate=bar[0], close=bar[4], marketSource=key)
                    break
            if len(item) > 1:
                result.append(item)
        return result

    # ---------- 公開狀態與操作 API ----------

    def get_state(self) -> dict:
        cfg = self._load_config_raw()
        ai_meta = get_gemini_key_meta(self.app_data_dir)
        channels = [self._load_channel_state(meta) for meta in cfg['channels']]
        return {
            'config': {
                'autoDailyEnabled': cfg['autoDailyEnabled'],
                'cooldownMinutes': cfg['cooldownMinutes'],
                'maxVideoMinutes': cfg['maxVideoMinutes'],
                'ai': ai_router.session(self.app_data_dir, 'channels').metadata(),
                'hasGeminiKey': ai_meta['hasGeminiKey'],
                'geminiKeyHint': ai_meta['geminiKeyHint'],
                'secretStorageMode': ai_meta['secretStorageMode'],
            },
            'channels': channels,
        }

    def _is_within_cooldown(self, last_checked_at: str, cooldown_minutes: int, now: datetime) -> bool:
        if not last_checked_at:
            return False
        try:
            iso = last_checked_at[:-1] + '+00:00' if last_checked_at.endswith('Z') else last_checked_at
            dt = datetime.fromisoformat(iso)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=TAIPEI_TZ)
            return (now - dt) < timedelta(minutes=cooldown_minutes)
        except Exception:
            return False

    def _check_one_channel(
        self,
        ch_state: dict,
        max_video_minutes: int = DEFAULT_MAX_VIDEO_MINUTES,
        force: bool = False,
    ) -> tuple[dict, bool]:
        """檢查單一頻道最新 1 支影片（絕不回補舊片），回傳 (updated_state, did_update_strategy)。"""
        now_iso = taipei_now().isoformat(timespec='seconds')
        updated = dict(ch_state)
        updated['lastCheckedAt'] = now_iso

        try:
            rss_name, entries = self._fetch_rss_videos(updated['id'])
        except Exception as exc:
            updated['status'] = 'error'
            updated['statusMessage'] = f'無法取得頻道 RSS：{exc}'
            self._save_channel_state(updated)
            return updated, False

        if rss_name and (not updated['name'] or updated['name'] == updated['id']):
            updated['name'] = rss_name

        if not entries:
            updated['status'] = 'idle'
            updated['statusMessage'] = '此頻道目前尚無公開影片'
            self._save_channel_state(updated)
            return updated, False

        # 嚴格只取最新 1 支影片，絕不回補舊片
        newest = entries[0]
        prev_vid = updated.get('lastVideoId') or ''
        prev_status = updated.get('status') or 'idle'
        is_new_video = newest['videoId'] != prev_vid
        is_retry_waiting = (newest['videoId'] == prev_vid and prev_status == 'waiting_subtitles')
        is_retry_too_long = (force and newest['videoId'] == prev_vid and prev_status == 'skipped_too_long')
        is_retry_empty_error = (
            newest['videoId'] == prev_vid
            and prev_status == 'error'
            and not any(s.get('videoId') == newest['videoId'] for s in (updated.get('strategies') or []))
        )

        if not (is_new_video or is_retry_waiting or is_retry_too_long or is_retry_empty_error):
            # 同一支已完成分析（或已略過）的影片，更新檢查時間即可
            self._save_channel_state(updated)
            return updated, False

        updated['lastVideoId'] = newest['videoId']
        updated['lastVideoTitle'] = newest['title']
        updated['lastVideoUrl'] = newest['url']
        updated['lastVideoPublishedAt'] = newest['publishedAt']

        try:
            status, status_msg, strategy, duration_sec = self._analyze_video(
                newest,
                updated['name'],
                max_video_minutes=max_video_minutes,
            )
        except Exception as exc:
            updated['status'] = 'error'
            updated['statusMessage'] = f'影片解析失敗：{exc}'
            self._save_channel_state(updated)
            return updated, False

        updated['lastVideoDurationSec'] = duration_sec
        updated['status'] = status
        updated['statusMessage'] = status_msg
        did_update = False
        if strategy is not None:
            existing = [
                s for s in (updated.get('strategies') or [])
                if s.get('videoId') != strategy['videoId']
            ]
            # 最新置頂，最多保留 3 筆（FIFO 淘汰最舊）
            updated['strategies'] = [strategy, *existing][:MAX_STRATEGIES_PER_CHANNEL]
            did_update = True

        self._save_channel_state(updated)
        return updated, did_update

    def add_channel(self, raw_url: str) -> dict:
        meta = self.resolve_channel(raw_url)
        now_iso = taipei_now().isoformat(timespec='seconds')
        entry = {
            'id': meta['id'],
            'name': meta['name'],
            'handle': meta['handle'],
            'url': meta['url'],
            'addedAt': now_iso,
        }
        with self._lock:
            cfg = self._load_config_raw()
            if any(c['id'] == entry['id'] for c in cfg['channels']):
                raise ValueError(f"頻道「{entry['name']}」已在訂閱清單中")
            cfg['channels'].append(entry)
            self._write_json(self.config_file, cfg)
            initial_state = self._load_channel_state(entry)
            self._save_channel_state(initial_state)
            max_vid_mins = cfg['maxVideoMinutes']

        # 新增後立即只分析最新 1 支影片（絕不回補舊片）
        updated_channel, _ = self._check_one_channel(initial_state, max_video_minutes=max_vid_mins, force=True)
        return {
            'channel': updated_channel,
            'state': self.get_state(),
        }

    def remove_channel(self, channel_id: str) -> dict:
        cid = str(channel_id or '').strip()
        if not cid:
            raise ValueError('請指定要移除的頻道 ID')
        with self._lock:
            cfg = self._load_config_raw()
            before = len(cfg['channels'])
            cfg['channels'] = [c for c in cfg['channels'] if c['id'] != cid]
            if len(cfg['channels']) == before:
                raise ValueError('找不到指定的訂閱頻道')
            self._write_json(self.config_file, cfg)
            if SAFE_CHANNEL_ID_RE.fullmatch(cid):
                cache_file = self._channel_file(cid)
                if cache_file.exists():
                    try:
                        cache_file.unlink()
                    except OSError:
                        pass
        return self.get_state()

    def check_updates(self, channel_id: str | None = None, force: bool = False) -> dict:
        cfg = self._load_config_raw()
        cooldown = cfg['cooldownMinutes']
        max_vid_mins = cfg['maxVideoMinutes']
        now = taipei_now()

        if channel_id:
            cid = str(channel_id).strip()
            targets = [c for c in cfg['channels'] if c['id'] == cid]
            if not targets:
                raise ValueError('找不到指定的訂閱頻道')
        else:
            targets = list(cfg['channels'])

        checked: list[str] = []
        updated_count = 0
        for meta in targets:
            ch_state = self._load_channel_state(meta)
            if not force and self._is_within_cooldown(ch_state.get('lastCheckedAt', ''), cooldown, now):
                continue
            checked.append(meta['id'])
            _, did_update = self._check_one_channel(
                ch_state,
                max_video_minutes=max_vid_mins,
                force=force,
            )
            if did_update:
                updated_count += 1

        return {
            'checked': checked,
            'updatedCount': updated_count,
            'state': self.get_state(),
        }

    def delete_strategy(self, channel_id: str, strategy_id: str) -> dict:
        cid = str(channel_id or '').strip()
        sid = str(strategy_id or '').strip()
        if not cid or not sid:
            raise ValueError('缺少頻道 ID 或策略 ID')
        with self._lock:
            cfg = self._load_config_raw()
            meta = next((c for c in cfg['channels'] if c['id'] == cid), None)
            if not meta:
                raise ValueError('找不到指定的訂閱頻道')
            ch_state = self._load_channel_state(meta)
            before = len(ch_state['strategies'])
            ch_state['strategies'] = [s for s in ch_state['strategies'] if s.get('id') != sid]
            if len(ch_state['strategies']) == before:
                raise ValueError('找不到指定的策略卡')
            self._save_channel_state(ch_state)
        return self.get_state()

    def update_config(self, updates: dict) -> dict:
        if not isinstance(updates, dict):
            updates = {}
        with self._lock:
            cfg = self._load_config_raw()
            if 'autoDailyEnabled' in updates:
                cfg['autoDailyEnabled'] = bool(updates['autoDailyEnabled'])
            if 'cooldownMinutes' in updates:
                try:
                    cd = int(updates['cooldownMinutes'])
                    cfg['cooldownMinutes'] = max(1, min(1440, cd))
                except (TypeError, ValueError):
                    raise ValueError('冷卻時間須為正整數分鐘')
            if 'maxVideoMinutes' in updates:
                try:
                    mv = int(updates['maxVideoMinutes'])
                except (TypeError, ValueError):
                    raise ValueError(f'影片長度上限須為 {MIN_VIDEO_MINUTES} 至 {MAX_VIDEO_MINUTES} 分鐘')
                if mv < MIN_VIDEO_MINUTES or mv > MAX_VIDEO_MINUTES:
                    raise ValueError(f'影片長度上限須為 {MIN_VIDEO_MINUTES} 至 {MAX_VIDEO_MINUTES} 分鐘')
                cfg['maxVideoMinutes'] = mv
            self._write_json(self.config_file, cfg)
        return self.get_state()

    def get_all_latest_strategies(self, limit: int = 15) -> list[dict]:
        """彙整所有訂閱頻道的最新策略卡（供 Phase B AI 操盤手作為市場觀點訊號來源）。"""
        state = self.get_state()
        collected: list[dict] = []
        for ch in state['channels']:
            for s in ch.get('strategies') or []:
                collected.append({
                    **s,
                    'channelId': ch['id'],
                    'channelName': ch['name'],
                    'channelHandle': ch['handle'],
                })
        collected.sort(
            key=lambda x: str(x.get('analyzedAt') or x.get('publishedAt') or ''),
            reverse=True,
        )
        return collected[: max(0, int(limit))]
