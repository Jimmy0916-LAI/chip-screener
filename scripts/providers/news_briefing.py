"""每日 10:00 台美股自動晨報供應器
功能：
- 抓取隔夜美股四大指數、TSM ADR 與台股加權指數報價
- 聚合 Yahoo 奇摩股市、中央社財經、CNBC 財經公開 RSS，過濾生活雜訊並去重（強制保留原始來源與 URL）
- 追蹤固定驗收案例與自訂關注清單最新價量（台股自動附帶最近一期 TDCC 大戶週動向）
- 支援免 Key 規則式摘要與選填 Gemini API Key AI 濃縮（金鑰隔離保存於 %LOCALAPPDATA%，絕不進專案目錄）
- 支援手動開關每日 10:00 自動晨報（同步管理 Windows Task Scheduler）與隨時一鍵馬上製作
"""

import email.utils
import json
import os
import re
import subprocess
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

TAIPEI_TZ = timezone(timedelta(hours=8))
TASK_NAME = 'ChipScreener_DailyBriefing'

MARKET_INDICES = [
    ('^TWII', '台灣加權', 'TW'),
    ('^GSPC', 'S&P 500', 'US'),
    ('^IXIC', 'Nasdaq', 'US'),
    ('^DJI', '道瓊工業', 'US'),
    ('^SOX', '費城半導體', 'US'),
    ('TSM', '台積電 ADR', 'US'),
]

RSS_SOURCES = [
    ('Yahoo 奇摩股市', 'TW', 'https://tw.stock.yahoo.com/rss'),
    ('中央社財經', 'TW', 'https://feeds.feedburner.com/rsscna/finance'),
    ('CNBC 財經', 'US', 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664'),
]

# 過濾非財經生活／娛樂雜訊
NOISE_KEYWORDS = (
    '發票', '樂透', '大樂透', '威力彩', '中獎', '幸運門市', '星座', '生肖', '運勢',
    '氣象', '颱風假', '抽獎', '超商', '咖啡買一送一', '美食', '旅遊', '飯店', '演唱會',
    '穿搭', '感情', '離婚', '網紅', '藝人', '球賽', '職棒', 'NBA',
)

# 台股／財經正向訊號關鍵字（用來剔除 Yahoo 綜合頻道中的非財經稿）
FINANCE_KEYWORDS = (
    '股', '台積', '聯發科', '鴻海', 'ETF', '營收', '獲利', 'EPS', '法說', '外資', '投信',
    '央行', '利率', '降息', '升息', 'Fed', '聯準會', '通膨', 'CPI', '美債', '殖利率', '匯率',
    '美元', '台幣', '黃金', '油價', '半導體', 'AI', '晶片', '輝達', 'NVIDIA', '蘋果', 'Apple',
    '關稅', '出口', 'GDP', '財報', '除息', '配息', '併購', '上市', '上櫃', '大盤', '指數',
    '買超', '賣超', '融資', '庫藏股', '資本支出', '供應鏈', '伺服器', '記憶體', '航運', '金融',
    'stock', 'market', 'Fed', 'tariff', 'earnings', 'chip', 'AI', 'Nvidia', 'Treasury',
    'inflation', 'GDP', 'economy', 'IPO', 'dividend', 'Wall Street', 'S&P', 'Nasdaq', 'Dow',
)

DEFAULT_WATCHLIST = ['2330', '0050', 'TSM', 'NVDA']

BRIEFING_TOPICS = [
    ('ai_semi', 'AI / 半導體', ('ai', '半導體', '晶圓', '台積', '輝達', 'nvidia', '晶片', '伺服器', '記憶體', '封測', 'asml', 'amd', 'intel', 'tsmc', 'chip', 'semiconductor', 'gpu', 'hbm')),
    ('macro_rate', '總經 / 利率 / 匯率', ('fed', '聯準會', '央行', '利率', '降息', '升息', 'cpi', '通膨', '關稅', 'gdp', '匯率', '美元', '台幣', '美債', '殖利率', 'inflation', 'tariff', 'treasury', 'economy', 'rate')),
    ('etf_fin', 'ETF / 高股息 / 金融', ('etf', '高股息', '配息', '除息', '金融', '金控', '銀行', '壽險', '債券', '0050', '0056', '00878', '00919', 'dividend')),
    ('us_tech', '美股科技 / 財報', ('美股', '那斯達克', '標普', '道瓊', '費半', '蘋果', '微軟', '谷歌', '亞馬遜', '特斯拉', 'apple', 'microsoft', 'alphabet', 'amazon', 'meta', 'tesla', 'earnings', 'nasdaq', 's&p', 'wall street')),
    ('tw_trad', '台股傳產 / 航運 / 能源', ('航運', '長榮', '陽明', '萬海', '重電', '綠電', '能源', '鋼鐵', '塑化', '生技', '軍工', '航空', '電價', 'oil', 'energy')),
]
TOPIC_MAP = {tid: (label, kws) for tid, label, kws in BRIEFING_TOPICS}
DEFAULT_TOPIC_IDS = [tid for tid, _, _ in BRIEFING_TOPICS]

# 常見新聞股名／關鍵別名對照表（與 1,985 檔台股代號表搭配識別）
NEWS_STOCK_ALIASES = {
    '台積電': '2330', 'tsmc': '2330',
    '鴻海': '2317', '聯發科': '2454', '台達電': '2308', '廣達': '2382',
    '緯創': '3231', '緯穎': '6669', '日月光': '3711', '聯電': '2303',
    '華碩': '2357', '技嘉': '2376', '微星': '2377', '奇鋐': '3017',
    '雙鴻': '3324', '智邦': '2345', '台光電': '2383', '世芯': '3661',
    '創意': '3443', '光寶科': '2301', '和碩': '4938', '仁寶': '2324',
    '英業達': '2356', '南亞科': '2408', '華邦電': '2344', '旺宏': '2337',
    '群創': '3481', '友達': '2409', '大立光': '3008', '瑞昱': '2379',
    '聯詠': '3034', '富邦金': '2881', '國泰金': '2882', '中信金': '2891',
    '兆豐金': '2886', '玉山金': '2884', '凱基金': '2883', '元大金': '2885',
    '長榮': '2603', '陽明': '2609', '萬海': '2615', '華航': '2610',
    '長榮航': '2618', '中鋼': '2002', '中華電': '2412', '台塑': '1301',
    '南亞': '1303', '台化': '1326', '台塑化': '6505', '中興電': '1513',
    '華城': '1519', '士電': '1503', '亞力': '1514', '漢唐': '2404',
    '元大台灣50': '0050', '0050': '0050', '0056': '0056', '00878': '00878',
    '00919': '00919', '00929': '00929', '00713': '00713',
    '輝達': 'NVDA', 'nvidia': 'NVDA', '蘋果': 'AAPL', 'apple': 'AAPL',
    '微軟': 'MSFT', 'microsoft': 'MSFT', '谷歌': 'GOOGL', 'google': 'GOOGL',
    'alphabet': 'GOOGL', '亞馬遜': 'AMZN', 'amazon': 'AMZN', 'meta': 'META',
    '特斯拉': 'TSLA', 'tesla': 'TSLA', '超微': 'AMD', 'amd': 'AMD',
    '英特爾': 'INTC', 'intel': 'INTC', '博通': 'AVGO', 'broadcom': 'AVGO',
    '高通': 'QCOM', 'qualcomm': 'QCOM', '美光': 'MU', 'micron': 'MU',
    '艾司摩爾': 'ASML', 'asml': 'ASML', '美超微': 'SMCI', '甲骨文': 'ORCL',
    'oracle': 'ORCL', 'palantir': 'PLTR', 'netflix': 'NFLX', 'arm': 'ARM',
}


def taipei_now() -> datetime:
    return datetime.now(TAIPEI_TZ)


def _http_get(url: str, timeout: int = 12) -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ChipScreener/0.6',
            'Cache-Control': 'no-cache',
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _fetch_yahoo_quote(yahoo_symbol: str) -> dict | None:
    encoded = urllib.parse.quote(yahoo_symbol, safe='')
    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{encoded}?range=5d&interval=1d'
    try:
        payload = json.loads(_http_get(url, timeout=10).decode('utf-8'))
        res = payload['chart']['result'][0]
        meta = res['meta']
        closes = [c for c in (res.get('indicators', {}).get('quote', [{}])[0].get('close') or []) if c is not None]
        price = meta.get('regularMarketPrice') or (closes[-1] if closes else None)
        prev = meta.get('chartPreviousClose') or meta.get('previousClose')
        if len(closes) >= 2 and (prev is None or prev == price):
            prev = closes[-2]
        if price is None:
            return None
        change = (price - prev) if prev else 0.0
        change_pct = (change / prev * 100.0) if prev else 0.0
        ts = meta.get('regularMarketTime')
        trade_time = datetime.fromtimestamp(ts, TAIPEI_TZ).strftime('%Y-%m-%d %H:%M') if ts else ''
        return {
            'price': round(float(price), 2),
            'prevClose': round(float(prev), 2) if prev else None,
            'change': round(float(change), 2),
            'changePct': round(float(change_pct), 2),
            'tradeTime': trade_time,
            'currency': meta.get('currency', ''),
            'yahooSymbol': yahoo_symbol,
        }
    except Exception:
        return None


def _parse_pub_date(raw: str) -> tuple[str, float]:
    if not raw:
        return '', 0.0
    try:
        dt_obj = email.utils.parsedate_to_datetime(raw)
        if dt_obj.tzinfo is None:
            dt_obj = dt_obj.replace(tzinfo=timezone.utc)
        tpe = dt_obj.astimezone(TAIPEI_TZ)
        return tpe.strftime('%m/%d %H:%M'), tpe.timestamp()
    except Exception:
        return raw[:16], 0.0


def _clean_text(text: str) -> str:
    if not text:
        return ''
    plain = re.sub(r'<[^>]+>', ' ', text)
    plain = re.sub(r'\s+', ' ', plain).strip()
    return plain


def _is_relevant_finance(title: str, desc: str, market_hint: str) -> bool:
    combined = f'{title} {desc}'
    if any(bad in title for bad in NOISE_KEYWORDS):
        return False
    if market_hint == 'US':
        return True
    lower = combined.lower()
    return any(kw.lower() in lower for kw in FINANCE_KEYWORDS)


def _normalize_title(title: str) -> str:
    return re.sub(r'[\W_]+', '', title.lower())[:24]


def _classify_category(title: str, default_market: str) -> str:
    lower = title.lower()
    if any(k in lower for k in ('fed', '聯準會', '央行', 'cpi', '通膨', '利率', '關稅', 'gdp', '匯率', '美債', '油價', '黃金', 'economy', 'tariff', 'inflation')):
        return '總經'
    if default_market == 'US' or any(k in lower for k in ('美股', '華爾街', '道瓊', '那斯達克', '標普', '費半', 'nvidia', 'apple', 'tesla', 'microsoft', 'wall street', 'nasdaq', 's&p')):
        return '美股'
    return '台股'


def _match_item_topics(title: str, desc: str) -> list[str]:
    text = f'{title} {desc}'.lower()
    matched = []
    for tid, _, kws in BRIEFING_TOPICS:
        if any(k in text for k in kws):
            matched.append(tid)
    return matched


def _fetch_news_items(max_items: int = 10, selected_topics: list[str] | None = None) -> list[dict]:
    active_topics = [t for t in (selected_topics or DEFAULT_TOPIC_IDS) if t in TOPIC_MAP]
    if not active_topics:
        active_topics = list(DEFAULT_TOPIC_IDS)
    is_custom_topics = set(active_topics) != set(DEFAULT_TOPIC_IDS)

    buckets: dict[str, list[dict]] = {'TW': [], 'US': []}
    seen_keys: set[str] = set()

    for source_name, market_hint, url in RSS_SOURCES:
        try:
            raw = _http_get(url, timeout=10)
            root = ET.fromstring(raw)
            for item in root.findall('.//item'):
                title = _clean_text(item.findtext('title') or '')
                link = (item.findtext('link') or '').strip()
                desc = _clean_text(item.findtext('description') or '')
                pub_str, pub_ts = _parse_pub_date(item.findtext('pubDate') or '')
                if not title or not link.startswith('https://'):
                    continue
                if not _is_relevant_finance(title, desc, market_hint):
                    continue
                key = _normalize_title(title)
                if not key or key in seen_keys:
                    continue
                seen_keys.add(key)
                snippet = desc[:120] + ('…' if len(desc) > 120 else '') if desc and desc != title else ''
                item_topics = _match_item_topics(title, desc)
                topic_hits = sum(1 for t in item_topics if t in active_topics)
                buckets[market_hint].append({
                    'title': title,
                    'url': link,
                    'source': source_name,
                    'category': _classify_category(title, market_hint),
                    'published': pub_str,
                    'ts': pub_ts,
                    'snippet': snippet,
                    'topicHits': topic_hits,
                    'topics': [TOPIC_MAP[t][0] for t in item_topics if t in active_topics],
                })
        except Exception:
            continue

    buckets['TW'].sort(key=lambda x: x['ts'], reverse=True)
    buckets['US'].sort(key=lambda x: x['ts'], reverse=True)

    if is_custom_topics:
        all_items = buckets['TW'] + buckets['US']
        matched = [x for x in all_items if x['topicHits'] > 0]
        matched.sort(key=lambda x: (x['topicHits'], x['ts']), reverse=True)
        merged = matched[:max_items]
        if len(merged) < 4:
            fallback = [x for x in all_items if x['topicHits'] == 0]
            fallback.sort(key=lambda x: x['ts'], reverse=True)
            merged.extend(fallback[: 4 - len(merged)])
    else:
        # 預設平衡台股與美股／國際新聞（平均精選，不偏重單一產業）
        tw_pick = buckets['TW'][:6]
        us_pick = buckets['US'][:4]
        merged = tw_pick + us_pick
        if len(merged) < max_items:
            rest = buckets['TW'][6:] + buckets['US'][4:]
            rest.sort(key=lambda x: x['ts'], reverse=True)
            merged.extend(rest[: max_items - len(merged)])
        merged.sort(key=lambda x: x['ts'], reverse=True)

    return [{k: v for k, v in item.items() if k not in ('ts', 'topicHits')} for item in merged[:max_items]]


def _summarize_with_gemini(api_key: str, indices: list[dict], news: list[dict], tracked: list[dict]) -> list[str] | None:
    if not api_key:
        return None
    idx_lines = '\n'.join(
        f"- {x['name']} ({x['symbol']}): {x['price']} ({x['changePct']:+.2f}%)"
        for x in indices
        if x.get('price') is not None
    )
    news_lines = '\n'.join(
        f"- [{n['category']}｜{n['source']}] {n['title']}"
        for n in news
    )
    track_lines = '\n'.join(
        f"- {t['code']} {t['name']}: {t['price']} ({t['changePct']:+.2f}%) {t.get('chipNote', '')}"
        for t in tracked
        if t.get('price') is not None
    )
    prompt = (
        "你是專業台美股財經晨報編輯。請嚴格根據以下已查證的即時報價與新聞標題，撰寫 3 到 4 條精簡繁體中文重點摘要（每條不超過 60 字），"
        "絕對禁止捏造未出現的數據或媒體，每條結尾請括號標示消息來源（例如：（Yahoo 奇摩股市）或（CNBC 財經））。"
        "請直接輸出 JSON 陣列（例如 [\"重點1\", \"重點2\"]），不要加 Markdown 程式碼區塊。\n\n"
        f"【指數報價】\n{idx_lines}\n\n【重點新聞】\n{news_lines}\n\n【追蹤標的】\n{track_lines}"
    )
    url = f'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={urllib.parse.quote(api_key, safe="")}'
    body = json.dumps({'contents': [{'parts': [{'text': prompt}]}]}).encode('utf-8')
    req = urllib.request.Request(
        url,
        data=body,
        headers={'Content-Type': 'application/json', 'User-Agent': 'ChipScreener/0.6'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = json.loads(resp.read().decode('utf-8'))
        text = payload['candidates'][0]['content']['parts'][0]['text'].strip()
        text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text).strip()
        parsed = json.loads(text)
        if isinstance(parsed, list) and parsed and all(isinstance(x, str) for x in parsed):
            return [x.strip() for x in parsed[:5] if x.strip()]
    except Exception:
        return None
    return None


def _build_rule_summary(indices: list[dict], news: list[dict], tracked: list[dict]) -> list[str]:
    bullets = []
    us_idx = [x for x in indices if x['market'] == 'US' and x.get('price') is not None]
    tw_idx = next((x for x in indices if x['symbol'] == '^TWII' and x.get('price') is not None), None)

    if us_idx:
        parts = [f"{x['name']} {x['changePct']:+.2f}%" for x in us_idx[:4]]
        bullets.append('隔夜美股表現：' + '、'.join(parts) + '（Yahoo Finance）。')
    if tw_idx:
        bullets.append(
            f"台股加權指數目前 {tw_idx['price']:,.2f} 點（{tw_idx['change']:+.2f} / {tw_idx['changePct']:+.2f}%，資料時間 {tw_idx.get('tradeTime') or '最新'}，Yahoo Finance）。"
        )
    if tracked:
        valid_t = [t for t in tracked if t.get('price') is not None]
        if valid_t:
            movers = sorted(valid_t, key=lambda x: abs(x['changePct']), reverse=True)[:3]
            desc = '、'.join(f"{m['code']} {m['name']} ({m['changePct']:+.2f}%)" for m in movers)
            bullets.append(f'追蹤標的波動焦點：{desc}。')
    if news:
        top_tw = next((n for n in news if n['category'] == '台股'), None)
        top_us = next((n for n in news if n['category'] in ('美股', '總經')), None)
        if top_tw:
            bullets.append(f"台股焦點：{top_tw['title']}（{top_tw['source']}）。")
        if top_us:
            bullets.append(f"國際／總經焦點：{top_us['title']}（{top_us['source']}）。")
    return bullets or ['目前暫無可彙總之最新市場資訊，請稍後重試。']


def _append_md_stock_table(lines: list[str], heading: str, items: list[dict]) -> None:
    if not items:
        return
    lines.extend(['', heading, '', '| 代號 | 名稱 | 最新價 | 漲跌幅 | 籌碼／備註 |', '| --- | --- | ---: | ---: | --- |'])
    for t in items:
        p = f"{t['price']:,.2f}" if t.get('price') is not None else '—'
        cp = f"{t['changePct']:+.2f}%" if t.get('price') is not None else '—'
        lines.append(f"| `{t['code']}` | {t['name']} | {p} | {cp} | {t.get('chipNote') or '—'} |")


def _render_markdown(report: dict) -> str:
    topic_str = '、'.join(report.get('topicLabels') or []) or '預設均衡'
    lines = [
        f"# 台美股財經晨報｜{report['date']}",
        f"> 產出時間（台北）：{report['generatedAt']} · 摘要模式：{report['summaryMode']} · 觸發方式：{report['trigger']} · 題材：{topic_str}",
        '',
        '## 一、一分鐘重點總結',
    ]
    for b in report['summary']:
        lines.append(f'- {b}')
    lines.extend(['', '## 二、台美股盤勢快照', '', '| 指數／標的 | 市場 | 最新價 | 漲跌 | 漲跌幅 |', '| --- | --- | ---: | ---: | ---: |'])
    for idx in report['indices']:
        p = f"{idx['price']:,.2f}" if idx.get('price') is not None else '—'
        c = f"{idx['change']:+,.2f}" if idx.get('price') is not None else '—'
        cp = f"{idx['changePct']:+.2f}%" if idx.get('price') is not None else '—'
        lines.append(f"| {idx['name']} (`{idx['symbol']}`) | {idx['market']} | {p} | {c} | {cp} |")

    _append_md_stock_table(lines, '## 三、自訂追蹤標的異動速覽', report.get('tracked') or [])
    _append_md_stock_table(lines, '## 四、晨報重點股票異動速覽', report.get('newsStocks') or [])

    lines.extend(['', '## 五、重點新聞精選（附消息來源）'])
    for n in report['news']:
        pub = f" · {n['published']}" if n.get('published') else ''
        lines.append(f"- **[{n['category']}]** [{n['title']}]({n['url']}) — *{n['source']}{pub}*")
    lines.append('')
    return '\n'.join(lines)


class BriefingService:
    def __init__(self, app_data_dir: Path, project_root: Path, stock_names: dict | None = None):
        self.app_data_dir = app_data_dir
        self.project_root = project_root
        self.stock_names = stock_names or {}
        self.user_dir = app_data_dir / 'user-v1'
        self.briefings_dir = app_data_dir / 'briefings-v1'
        self.config_file = self.user_dir / 'briefing-config.json'
        self.secrets_file = self.user_dir / 'briefing-secrets.json'
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

    def _get_api_key(self) -> str:
        secrets = self._read_json(self.secrets_file, {})
        return str(secrets.get('geminiApiKey') or '').strip()

    def _query_windows_task(self) -> str:
        if os.name != 'nt':
            return '非 Windows 環境'
        try:
            proc = subprocess.run(
                ['schtasks', '/Query', '/TN', TASK_NAME],
                capture_output=True,
                text=True,
                timeout=5,
            )
            return '已註冊每日 10:00 Windows 排程' if proc.returncode == 0 else '未註冊 Windows 排程'
        except Exception:
            return '無法查詢 Windows 排程'

    def _sync_windows_task(self, enabled: bool) -> str:
        if os.name != 'nt':
            return '非 Windows 環境'
        if not enabled:
            try:
                subprocess.run(['schtasks', '/Delete', '/TN', TASK_NAME, '/F'], capture_output=True, timeout=6)
            except Exception:
                pass
            return '已停用 Windows 排程'

        runner = self.project_root / 'scripts' / 'daily_briefing_runner.py'
        pyw = Path(os.environ.get('WINDIR', r'C:\Windows')) / 'pyw.exe'
        exe = str(pyw) if pyw.exists() else sys.executable
        cmd = f'"{exe}" -B -X utf8 "{runner}"'
        try:
            proc = subprocess.run(
                ['schtasks', '/Create', '/TN', TASK_NAME, '/SC', 'DAILY', '/ST', '10:00', '/TR', cmd, '/F'],
                capture_output=True,
                text=True,
                timeout=8,
            )
            if proc.returncode == 0:
                return '已註冊每日 10:00 Windows 排程'
            return '軟體內 10:00 自動排程已啟用（系統排程註冊受限）'
        except Exception:
            return '軟體內 10:00 自動排程已啟用'

    def get_config(self) -> dict:
        raw = self._read_json(self.config_file, {})
        enabled = bool(raw.get('enabled', True))
        watchlist = raw.get('watchlist')
        if not isinstance(watchlist, list):
            watchlist = list(DEFAULT_WATCHLIST)
        watchlist = [str(s).strip().upper() for s in watchlist if re.fullmatch(r'[A-Za-z0-9]{2,8}', str(s).strip())]
        topics = raw.get('topics')
        if not isinstance(topics, list):
            topics = list(DEFAULT_TOPIC_IDS)
        else:
            topics = [str(t).strip() for t in topics if str(t).strip() in TOPIC_MAP]
            if not topics:
                topics = list(DEFAULT_TOPIC_IDS)
        key = self._get_api_key()
        masked = ('••••' + key[-4:]) if len(key) >= 6 else ('已設定' if key else '')
        return {
            'enabled': enabled,
            'time': '10:00',
            'watchlist': watchlist,
            'topics': topics,
            'availableTopics': [{'id': tid, 'label': label} for tid, label, _ in BRIEFING_TOPICS],
            'hasGeminiKey': bool(key),
            'geminiKeyHint': masked,
            'windowsTaskStatus': self._query_windows_task() if enabled else '已關閉（僅手動製作）',
        }

    def update_config(self, updates: dict) -> dict:
        current = self._read_json(
            self.config_file,
            {'enabled': True, 'watchlist': list(DEFAULT_WATCHLIST), 'topics': list(DEFAULT_TOPIC_IDS)},
        )
        if 'enabled' in updates:
            current['enabled'] = bool(updates['enabled'])
            self._sync_windows_task(current['enabled'])
        if 'watchlist' in updates:
            items = updates['watchlist']
            if isinstance(items, str):
                items = re.split(r'[\s,，、;；]+', items)
            if isinstance(items, list):
                cleaned = []
                for sym in items:
                    s = str(sym).strip().upper()
                    if re.fullmatch(r'[A-Za-z0-9]{2,8}', s) and s not in cleaned:
                        cleaned.append(s)
                current['watchlist'] = cleaned[:15]
        if 'topics' in updates and isinstance(updates['topics'], list):
            cleaned_topics = []
            for t in updates['topics']:
                tid = str(t).strip()
                if tid in TOPIC_MAP and tid not in cleaned_topics:
                    cleaned_topics.append(tid)
            current['topics'] = cleaned_topics or list(DEFAULT_TOPIC_IDS)
        self._write_json(self.config_file, current)

        if 'geminiApiKey' in updates:
            new_key = str(updates['geminiApiKey'] or '').strip()
            secrets = self._read_json(self.secrets_file, {})
            if new_key:
                secrets['geminiApiKey'] = new_key
            else:
                secrets.pop('geminiApiKey', None)
            self._write_json(self.secrets_file, secrets)
        elif updates.get('clearGeminiKey'):
            secrets = self._read_json(self.secrets_file, {})
            secrets.pop('geminiApiKey', None)
            self._write_json(self.secrets_file, secrets)

        return self.get_config()

    def list_dates(self) -> list[str]:
        if not self.briefings_dir.exists():
            return []
        return sorted(
            [p.stem for p in self.briefings_dir.glob('*.json') if re.fullmatch(r'\d{4}-\d{2}-\d{2}', p.stem)],
            reverse=True,
        )

    def read_report(self, day: str | None = None) -> dict | None:
        dates = self.list_dates()
        target = day if day and re.fullmatch(r'\d{4}-\d{2}-\d{2}', day) else (dates[0] if dates else None)
        if not target:
            return None
        file_path = self.briefings_dir / f'{target}.json'
        if not file_path.exists():
            return None
        try:
            return json.loads(file_path.read_text(encoding='utf-8'))
        except Exception:
            return None

    def should_auto_run(self) -> bool:
        cfg = self.get_config()
        if not cfg['enabled']:
            return False
        now = taipei_now()
        if now.hour < 10:
            return False
        today = now.strftime('%Y-%m-%d')
        return not (self.briefings_dir / f'{today}.json').exists()

    def _fetch_tracked_quotes(self, symbols: list[str]) -> list[dict]:
        results = []
        for code in symbols:
            is_tw = bool(re.fullmatch(r'(?:\d{4}|00\d{2,4}[A-Z]?)', code))
            quote = None
            if is_tw:
                quote = _fetch_yahoo_quote(f'{code}.TW') or _fetch_yahoo_quote(f'{code}.TWO')
            else:
                quote = _fetch_yahoo_quote(code)
            name = ''
            market = 'US'
            if is_tw:
                info = self.stock_names.get(code)
                name = info[0] if isinstance(info, list) and info else ('ETF' if code.startswith('00') else code)
                market = info[1] if isinstance(info, list) and len(info) > 1 else 'TWSE'
            else:
                name = {'TSM': '台積電 ADR', 'NVDA': 'NVIDIA', 'AAPL': 'Apple', 'MSFT': 'Microsoft', 'SPY': 'S&P 500 ETF', 'QQQ': 'Nasdaq 100 ETF'}.get(code, code)

            results.append({
                'code': code,
                'name': name,
                'market': market,
                'price': quote['price'] if quote else None,
                'change': quote['change'] if quote else None,
                'changePct': quote['changePct'] if quote else None,
                'tradeTime': quote['tradeTime'] if quote else '',
                'chipNote': '台股集保可於個股頁核對' if is_tw else '美股即時／收盤報價',
            })
        return results

    def _extract_news_stocks(self, news: list[dict], exclude_codes: set[str], max_count: int = 8) -> list[dict]:
        """從本次晨報新聞中萃取重點台美股代號／公司名稱並取得即時報價與漲跌幅。"""
        ignore_tickers = {
            'AI', 'US', 'TW', 'UK', 'EU', 'CN', 'JP', 'GDP', 'CPI', 'PCE', 'PPI',
            'FED', 'FOMC', 'ETF', 'EPS', 'IPO', 'ADR', 'YOY', 'QOQ', 'MOM',
            'CEO', 'CFO', 'CTO', 'USD', 'TWD', 'NTD', 'RMB', 'JPY', 'EUR', 'PE', 'PB',
        }
        hits: dict[str, dict] = {}
        # 預建長名稱索引（>=3字避免誤判常見中文雙字詞）
        long_tw_names = [
            (str(info[0]).strip(), str(code).upper())
            for code, info in self.stock_names.items()
            if isinstance(info, list) and info and len(str(info[0]).strip()) >= 3
        ]

        def register(code: str, article: dict) -> None:
            sym = code.strip().upper()
            if not sym or sym in exclude_codes or sym in hits:
                return
            src = article.get('source') or '財經新聞'
            title_short = article.get('title') or ''
            if len(title_short) > 26:
                title_short = title_short[:26] + '…'
            hits[sym] = {'mentionedIn': f"{src}：{title_short}"}

        for n in news:
            text = f"{n.get('title', '')} {n.get('snippet', '')}"
            lower = text.lower()

            # 1. 別名關鍵字（台美主要權值與熱門新聞標的）
            for alias, sym in NEWS_STOCK_ALIASES.items():
                if alias.isascii():
                    if re.search(rf'(?<![A-Za-z0-9]){re.escape(alias)}(?![A-Za-z0-9])', lower):
                        register(sym, n)
                elif alias in text:
                    register(sym, n)

            # 2. 明確 4 碼台股代號（排除單純年份 2020~2035，除非緊鄰括號或同框股名）
            for m in re.finditer(r'(\()?\b(\d{4})\b(\))?', text):
                code = m.group(2)
                if code not in self.stock_names:
                    continue
                is_year_like = 2020 <= int(code) <= 2035
                info = self.stock_names.get(code) or []
                nm = info[0] if info else ''
                if is_year_like and not (m.group(1) and m.group(3)) and not (nm and nm in text):
                    continue
                register(code, n)

            # 3. 完整 3 字以上台股公司名稱
            for nm, code in long_tw_names:
                if nm in text:
                    register(code, n)
                    if len(hits) >= max_count:
                        break

            # 4. 括號或交易所標示之美股代號，例如 (AAPL) 或 Nasdaq: MU
            for m in re.finditer(r'(?:\(|(?:NASDAQ|NYSE)\s*[:：]\s*)([A-Z]{2,5})(?:\)|\b)', text):
                sym = m.group(1)
                if sym not in ignore_tickers:
                    register(sym, n)

            if len(hits) >= max_count:
                break

        if not hits:
            return []
        ordered_codes = list(hits.keys())[:max_count]
        quotes = self._fetch_tracked_quotes(ordered_codes)
        for q in quotes:
            meta = hits.get(q['code'], {})
            q['mentionedIn'] = meta.get('mentionedIn', '')
            if meta.get('mentionedIn'):
                q['chipNote'] = meta['mentionedIn']
        return quotes

    def generate(self, featured_code: str = '', trigger: str = '手動馬上製作') -> dict:
        with self._lock:
            now = taipei_now()
            today = now.strftime('%Y-%m-%d')
            cfg = self.get_config()

            indices = []
            for sym, name, mkt in MARKET_INDICES:
                q = _fetch_yahoo_quote(sym)
                indices.append({
                    'symbol': sym,
                    'name': name,
                    'market': mkt,
                    'price': q['price'] if q else None,
                    'change': q['change'] if q else None,
                    'changePct': q['changePct'] if q else None,
                    'tradeTime': q['tradeTime'] if q else '',
                })

            selected_topics = cfg.get('topics') or list(DEFAULT_TOPIC_IDS)
            is_default_topics = set(selected_topics) == set(DEFAULT_TOPIC_IDS)
            topic_labels = ['預設均衡（全部題材）'] if is_default_topics else [TOPIC_MAP[t][0] for t in selected_topics if t in TOPIC_MAP]

            news = _fetch_news_items(max_items=10, selected_topics=selected_topics)

            track_codes = []
            for s in cfg['watchlist']:
                if s not in track_codes:
                    track_codes.append(s)
            tracked = self._fetch_tracked_quotes(track_codes[:10])
            news_stocks = self._extract_news_stocks(news, exclude_codes=set(track_codes), max_count=8)

            api_key = self._get_api_key()
            ai_bullets = _summarize_with_gemini(api_key, indices, news, tracked + news_stocks[:3]) if api_key else None
            if ai_bullets:
                summary = ai_bullets
                summary_mode = 'Gemini AI 濃縮摘要'
            else:
                summary = _build_rule_summary(indices, news, tracked or news_stocks)
                summary_mode = '規則式重點彙整（免 Key）'

            report = {
                'date': today,
                'generatedAt': now.strftime('%Y-%m-%d %H:%M:%S +08:00'),
                'trigger': trigger,
                'topics': selected_topics,
                'topicLabels': topic_labels,
                'summaryMode': summary_mode,
                'summary': summary,
                'indices': indices,
                'tracked': tracked,
                'newsStocks': news_stocks,
                'news': news,
            }
            report['markdown'] = _render_markdown(report)

            self.briefings_dir.mkdir(parents=True, exist_ok=True)
            self._write_json(self.briefings_dir / f'{today}.json', report)
            md_stage = self.briefings_dir / f'{today}.md.tmp'
            md_stage.write_text(report['markdown'], encoding='utf-8')
            os.replace(md_stage, self.briefings_dir / f'{today}.md')
            return report
