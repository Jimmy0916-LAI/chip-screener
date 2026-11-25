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

# 過濾非財經生活／娛樂／政治／樂透雜訊
NOISE_KEYWORDS = (
    '發票', '樂透', '大樂透', '威力彩', '今彩539', '雙贏彩', '賓果', '開獎', '頭獎',
    '中獎', '幸運門市', '星座', '生肖', '運勢', '氣象', '颱風假', '抽獎', '超商',
    '咖啡買一送一', '美食', '旅遊', '飯店', '演唱會', '穿搭', '感情', '離婚', '網紅',
    '藝人', '球賽', '職棒', 'NBA', '市民之夜', '選舉', '造勢',
)

# 台股／財經正向訊號關鍵字（排除純軟體開發／生活科技廣告，保留真實股市／總經／法人報導）
FINANCE_KEYWORDS = (
    '股', '台積', '聯發科', '鴻海', 'ETF', '營收', '獲利', 'EPS', '法說', '外資', '投信',
    '央行', '利率', '降息', '升息', 'Fed', '聯準會', '通膨', 'CPI', '美債', '殖利率', '匯率',
    '美元', '台幣', '黃金', '油價', '半導體', '晶片', '輝達', 'NVIDIA', '蘋果', 'Apple',
    '關稅', '出口', 'GDP', '財報', '除息', '配息', '併購', '上市', '上櫃', '大盤', '指數',
    '買超', '賣超', '融資', '庫藏股', '資本支出', '供應鏈', '伺服器', '記憶體', '航運', '金融',
    '市值', '折價', '溢價', '那斯達克', '道瓊', '標普', '費半', '小摩', '高盛', '商辦', '房貸',
    'stock', 'market', 'Fed', 'tariff', 'earnings', 'chip', 'Nvidia', 'Treasury',
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

# 常見新聞股名／關鍵別名對照表（與 1,985 檔台股代號表及 S&P 500 搭配識別）
NEWS_STOCK_ALIASES = {
    '台積電': '2330', 'tsmc': '2330',
    '鴻海': '2317', '聯發科': '2454', '台達電': '2308', '廣達': '2382',
    '緯創': '3231', '緯穎': '6669', '日月光': '3711', '聯電': '2303',
    '華碩': '2357', '技嘉': '2376', '微星': '2377', '奇鋐': '3017',
    '雙鴻': '3324', '智邦': '2345', '台光電': '2383', '世芯': '3661',
    '創意': '3443', '光寶科': '2301', '和碩': '4938', '仁寶': '2324',
    '英業達': '2356', '南亞科': '2408', '華邦電': '2344', '旺宏': '2337',
    '群創': '3481', '友達': '2409', '大立光': '3008', '瑞昱': '2379',
    '聯詠': '3034', '力積電': '6770', '群聯': '8299', '欣興': '3037',
    '景碩': '3189', '南電': '8046', '勤誠': '8210', '川湖': '2059',
    '健策': '3653', '貿聯': '3665', '嘉澤': '3533', '華固': '2548', '瓦城': '2729',
    '富邦金': '2881', '國泰金': '2882', '中信金': '2891', '兆豐金': '2886',
    '玉山金': '2884', '凱基金': '2883', '元大金': '2885', '台新金': '2887',
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
    'oracle': 'ORCL', 'palantir': 'PLTR', 'netflix': 'NFLX', '網飛': 'NFLX', 'arm': 'ARM',
    '小摩': 'JPM', '摩根大通': 'JPM', 'jpmorgan': 'JPM',
    '大摩': 'MS', '摩根士丹利': 'MS', 'morgan stanley': 'MS',
    '高盛': 'GS', 'goldman': 'GS', '花旗': 'C', 'citigroup': 'C',
    '美銀': 'BAC', 'bank of america': 'BAC', '貝萊德': 'BLK', 'blackrock': 'BLK',
    '波克夏': 'BRK-B', 'berkshire': 'BRK-B', '沃爾瑪': 'WMT', 'walmart': 'WMT',
    '好市多': 'COST', 'costco': 'COST', '禮來': 'LLY', 'eli lilly': 'LLY',
    '波音': 'BA', 'boeing': 'BA', '迪士尼': 'DIS', 'disney': 'DIS',
    '星巴克': 'SBUX', 'starbucks': 'SBUX', '麥當勞': 'MCD', '耐吉': 'NKE', 'nike': 'NKE',
    '艾克森美孚': 'XOM', 'exxon': 'XOM', '雪佛龍': 'CVX', 'chevron': 'CVX',
    '應材': 'AMAT', 'applied materials': 'AMAT', '科林研發': 'LRCX', '思科': 'CSCO', 'cisco': 'CSCO',
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
        exch_tz = timezone(timedelta(seconds=int(meta.get('gmtoffset') or 0)))

        raw_ts = res.get('timestamp') or []
        raw_closes = (res.get('indicators', {}).get('quote') or [{}])[0].get('close') or []
        daily_by_day: dict[str, float] = {}
        for t, c in zip(raw_ts, raw_closes):
            if t is None or c is None:
                continue
            day_str = datetime.fromtimestamp(t, exch_tz).strftime('%Y-%m-%d')
            daily_by_day[day_str] = float(c)
        daily_bars = sorted(daily_by_day.items(), key=lambda x: x[0])

        price = meta.get('regularMarketPrice')
        if price is None and daily_bars:
            price = daily_bars[-1][1]
        if price is None:
            return None
        price = float(price)

        ts = meta.get('regularMarketTime')
        market_day = datetime.fromtimestamp(ts, exch_tz).strftime('%Y-%m-%d') if ts else ''

        # 取前一個交易日收盤價（嚴禁直接使用 range=5d 的 chartPreviousClose，該值為 5 日前收盤價）
        prev = None
        if daily_bars:
            if market_day:
                earlier = [c for d, c in daily_bars if d < market_day]
                if earlier:
                    prev = earlier[-1]
            if prev is None and len(daily_bars) >= 2:
                prev = daily_bars[-2][1]
        if prev is None:
            fallback_prev = meta.get('previousClose') or meta.get('chartPreviousClose')
            prev = float(fallback_prev) if fallback_prev is not None else None

        change = (price - prev) if prev else 0.0
        change_pct = (change / prev * 100.0) if prev else 0.0
        trade_time = datetime.fromtimestamp(ts, TAIPEI_TZ).strftime('%Y-%m-%d %H:%M') if ts else ''
        return {
            'price': round(price, 2),
            'prevClose': round(prev, 2) if prev is not None else None,
            'change': round(change, 2),
            'changePct': round(change_pct, 2),
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


def _fetch_news_pool(max_items: int = 10, selected_topics: list[str] | None = None) -> tuple[list[dict], list[dict]]:
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

    all_items = buckets['TW'] + buckets['US']
    all_items.sort(key=lambda x: (x['topicHits'] if is_custom_topics else 0, x['ts']), reverse=True)

    if is_custom_topics:
        matched = [x for x in all_items if x['topicHits'] > 0]
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

    strip = lambda lst: [{k: v for k, v in item.items() if k not in ('ts', 'topicHits')} for item in lst]
    return strip(merged[:max_items]), strip(all_items)


def _fetch_news_items(max_items: int = 10, selected_topics: list[str] | None = None) -> list[dict]:
    picked, _ = _fetch_news_pool(max_items=max_items, selected_topics=selected_topics)
    return picked


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

    def sync_shared_windows_task(self) -> str:
        """若晨報或收藏夾自動分析任一開啟，保留每日 10:00 Windows 排程；兩者皆關才刪除。"""
        b_cfg = self._read_json(self.config_file, {})
        w_cfg = self._read_json(self.user_dir / 'watchlists.json', {})
        need_task = bool(b_cfg.get('enabled', True)) or bool(w_cfg.get('autoEnabled', True))
        return self._sync_windows_task(need_task)

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
            self._write_json(self.config_file, current)
            self.sync_shared_windows_task()
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

    def _load_us_name_map(self) -> tuple[dict[str, str], list[tuple[str, str]]]:
        """從 data/sp500_universe.json 載入美股代碼與安全英文公司關鍵字（供名稱對照與新聞萃取）。"""
        name_map = {
            'TSM': '台積電 ADR', 'NVDA': 'NVIDIA', 'AAPL': 'Apple', 'MSFT': 'Microsoft',
            'GOOGL': 'Alphabet', 'AMZN': 'Amazon', 'META': 'Meta', 'TSLA': 'Tesla',
            'AMD': 'AMD', 'AVGO': 'Broadcom', 'JPM': 'JPMorgan', 'GS': 'Goldman Sachs',
            'MS': 'Morgan Stanley', 'BAC': 'Bank of America', 'WMT': 'Walmart',
            'COST': 'Costco', 'LLY': 'Eli Lilly', 'NFLX': 'Netflix', 'BRK-B': 'Berkshire Hathaway',
            'SPY': 'S&P 500 ETF', 'QQQ': 'Nasdaq 100 ETF', 'SOXX': 'iShares 半導體 ETF',
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
                    # 使用完整英文公司名稱（>=6 字元）精準比對，避免單字（如 Dollar）誤判一般財經用語
                    clean_en = re.sub(r',?\s+(?:Inc\.?|Corp\.?|Corporation|Ltd\.?|PLC|Co\.?|Group|Holdings)$', '', en_name, flags=re.I).strip()
                    if len(clean_en) >= 6:
                        keywords.append((clean_en, code))
            except Exception:
                pass
        return name_map, keywords

    def _fetch_one_tracked_quote(self, code: str, us_names: dict[str, str]) -> dict:
        is_tw = bool(re.fullmatch(r'(?:\d{4}|00\d{2,4}[A-Z]?)', code))
        if is_tw:
            quote = _fetch_yahoo_quote(f'{code}.TW') or _fetch_yahoo_quote(f'{code}.TWO')
        else:
            quote = _fetch_yahoo_quote(code)
        if is_tw:
            info = self.stock_names.get(code)
            name = info[0] if isinstance(info, list) and info else ('ETF' if code.startswith('00') else code)
            market = info[1] if isinstance(info, list) and len(info) > 1 else 'TWSE'
        else:
            name = us_names.get(code, code)
            market = 'US'

        return {
            'code': code,
            'name': name,
            'market': market,
            'price': quote['price'] if quote else None,
            'change': quote['change'] if quote else None,
            'changePct': quote['changePct'] if quote else None,
            'tradeTime': quote['tradeTime'] if quote else '',
            'chipNote': '台股集保可於個股頁核對' if is_tw else '美股即時／收盤報價',
        }

    def _fetch_tracked_quotes(self, symbols: list[str]) -> list[dict]:
        if not symbols:
            return []
        from concurrent.futures import ThreadPoolExecutor
        us_names, _ = self._load_us_name_map()
        with ThreadPoolExecutor(max_workers=6) as pool:
            return list(pool.map(lambda s: self._fetch_one_tracked_quote(s, us_names), symbols))

    def _extract_news_stocks(
        self,
        news: list[dict],
        exclude_codes: set[str],
        max_count: int = 8,
        extra_news: list[dict] | None = None,
    ) -> list[dict]:
        """從本次晨報新聞中萃取重點台美股代號／公司名稱並取得即時報價與漲跌幅。
        優先掃描精選重點新聞；若數量不足 max_count（例如當日重點偏總經或全命中自訂清單），
        再依時序掃描同梯次抓回的財經新聞池，確保穩定產出有效新聞重點股。
        """
        ignore_tickers = {
            'AI', 'US', 'TW', 'UK', 'EU', 'CN', 'JP', 'GDP', 'CPI', 'PCE', 'PPI',
            'FED', 'FOMC', 'ETF', 'EPS', 'IPO', 'ADR', 'YOY', 'QOQ', 'MOM', 'SEC',
            'CEO', 'CFO', 'CTO', 'USD', 'TWD', 'NTD', 'RMB', 'JPY', 'EUR', 'PE', 'PB',
            'WSJ', 'CNBC', 'CRN', 'IT', 'PC', 'NB', 'TV', 'EV', 'GPU', 'CPU', 'HBM',
        }
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

        hits: dict[str, dict] = {}
        soft_hits: dict[str, dict] = {}

        def register(code: str, article: dict) -> None:
            sym = code.strip().upper()
            if not sym:
                return
            src = article.get('source') or '財經新聞'
            title_short = article.get('title') or ''
            if len(title_short) > 26:
                title_short = title_short[:26] + '…'
            meta = {'mentionedIn': f"{src}：{title_short}"}
            if sym in exclude_codes:
                if sym not in soft_hits:
                    soft_hits[sym] = meta
                return
            if sym not in hits:
                hits[sym] = meta

        # 去重後先掃精選新聞，再掃完整財經 RSS 池
        seen_titles: set[str] = set()
        ordered_articles: list[dict] = []
        for lst in (news, extra_news or []):
            for art in lst:
                tkey = art.get('title', '')
                if tkey and tkey not in seen_titles:
                    seen_titles.add(tkey)
                    ordered_articles.append(art)

        for n in ordered_articles:
            text = f"{n.get('title', '')} {n.get('snippet', '')}"
            lower = text.lower()

            # 1. 別名關鍵字（台美主要權值、金融機構與熱門新聞標的）
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

            # 4. 安全比對 2 字台股公告（如「瓦城：...」、「華固...商辦」僅於明確公告／股價語境匹配）
            if len(hits) < max_count:
                for nm, code in short_tw_names:
                    if nm in text and re.search(
                        rf'(?:^|[，、\s「『(（【]){re.escape(nm)}(?:：|:|股價|營收|獲利|法說|財報|董事|買回|庫藏|增持|買超|賣超|大漲|重挫|跳空|領漲|除息)',
                        text,
                    ):
                        register(code, n)
                        if len(hits) >= max_count:
                            break

            # 5. S&P 500 英文完整公司名與括號／交易所美股代號
            for kw, sym in sp_keywords:
                if re.search(rf'(?<![A-Za-z0-9]){re.escape(kw)}(?![A-Za-z0-9])', text):
                    register(sym, n)
                    if len(hits) >= max_count:
                        break

            for m in re.finditer(r'(?:\(|(?:NASDAQ|NYSE)\s*[:：]\s*)([A-Z]{2,5}(?:-[A-Z])?)(?:\)|\b)', text):
                sym = m.group(1)
                if sym not in ignore_tickers:
                    register(sym, n)

            if len(hits) >= max_count:
                break

        chosen_hits = hits if hits else soft_hits
        if not chosen_hits:
            return []
        ordered_codes = list(chosen_hits.keys())[:max_count]
        quotes = self._fetch_tracked_quotes(ordered_codes)
        valid_quotes = []
        for q in quotes:
            if q.get('price') is None:
                continue
            meta = chosen_hits.get(q['code'], {})
            q['mentionedIn'] = meta.get('mentionedIn', '')
            if meta.get('mentionedIn'):
                q['chipNote'] = meta['mentionedIn']
            valid_quotes.append(q)
        return valid_quotes

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

            news, all_news_pool = _fetch_news_pool(max_items=10, selected_topics=selected_topics)

            track_codes = []
            for s in cfg['watchlist']:
                if s not in track_codes:
                    track_codes.append(s)
            tracked = self._fetch_tracked_quotes(track_codes[:10])
            news_stocks = self._extract_news_stocks(
                news,
                exclude_codes=set(track_codes),
                max_count=8,
                extra_news=all_news_pool,
            )

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
