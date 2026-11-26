/**
 * 行動版每日 10:00 台美股自動晨報服務（移植自 scripts/providers/news_briefing.py）
 *
 * 行動版平台適配說明：
 * 1. Gemini API Key 僅保存於 Android Keystore 加密金庫（CM.vault，鍵名 'geminiApiKey'），
 *    絕不寫入一般 JSON 檔；init() 會自動將舊版 briefing-secrets.json 遷移至金庫並刪除原檔。
 * 2. Gemini API 請求改由 HTTP Header 'x-goog-api-key' 傳遞金鑰，避免金鑰出現在 URL 或日誌中。
 * 3. Windows 工作排程器（schtasks）改為本機每日通知（CM.notify，id=1001，預設 10:00）；
 *    為維持前端相容，狀態欄位鍵名仍保留 'windowsTaskStatus'，shouldAutoRun() 維持開啟補抓語意。
 * 4. 透過 CM.http（白名單 HTTPS）與 CM.fs（App 私有目錄相對路徑）執行網路與檔案存取。
 */
(function (CM) {
  'use strict';

  const VAULT_GEMINI_KEY = 'geminiApiKey';
  const DAILY_NOTIFY_ID = 1001;
  const DAILY_NOTIFY_TITLE = '籌碼雷達 每日晨報';
  const DAILY_NOTIFY_BODY = '台美股盤勢與重點財經新聞已就緒，點擊查看今日晨報。';
  const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

  const MARKET_INDICES = [
    ['^TWII', '台灣加權', 'TW'],
    ['^GSPC', 'S&P 500', 'US'],
    ['^IXIC', 'Nasdaq', 'US'],
    ['^DJI', '道瓊工業', 'US'],
    ['^SOX', '費城半導體', 'US'],
    ['TSM', '台積電 ADR', 'US']
  ];

  const RSS_SOURCES = [
    ['Yahoo 奇摩股市', 'TW', 'https://tw.stock.yahoo.com/rss'],
    ['中央社財經', 'TW', 'https://feeds.feedburner.com/rsscna/finance'],
    ['CNBC 財經', 'US', 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664']
  ];

  // 過濾非財經生活／娛樂／政治／樂透雜訊
  const NOISE_KEYWORDS = [
    '發票', '樂透', '大樂透', '威力彩', '今彩539', '雙贏彩', '賓果', '開獎', '頭獎',
    '中獎', '幸運門市', '星座', '生肖', '運勢', '氣象', '颱風假', '抽獎', '超商',
    '咖啡買一送一', '美食', '旅遊', '飯店', '演唱會', '穿搭', '感情', '離婚', '網紅',
    '藝人', '球賽', '職棒', 'NBA', '市民之夜', '選舉', '造勢'
  ];

  // 台股／財經正向訊號關鍵字
  const FINANCE_KEYWORDS = [
    '股', '台積', '聯發科', '鴻海', 'ETF', '營收', '獲利', 'EPS', '法說', '外資', '投信',
    '央行', '利率', '降息', '升息', 'Fed', '聯準會', '通膨', 'CPI', '美債', '殖利率', '匯率',
    '美元', '台幣', '黃金', '油價', '半導體', '晶片', '輝達', 'NVIDIA', '蘋果', 'Apple',
    '關稅', '出口', 'GDP', '財報', '除息', '配息', '併購', '上市', '上櫃', '大盤', '指數',
    '買超', '賣超', '融資', '庫藏股', '資本支出', '供應鏈', '伺服器', '記憶體', '航運', '金融',
    '市值', '折價', '溢價', '那斯達克', '道瓊', '標普', '費半', '小摩', '高盛', '商辦', '房貸',
    'stock', 'market', 'Fed', 'tariff', 'earnings', 'chip', 'Nvidia', 'Treasury',
    'inflation', 'GDP', 'economy', 'IPO', 'dividend', 'Wall Street', 'S&P', 'Nasdaq', 'Dow'
  ];
  const FINANCE_KEYWORDS_LOWER = FINANCE_KEYWORDS.map(k => k.toLowerCase());

  const DEFAULT_WATCHLIST = ['2330', '0050', 'TSM', 'NVDA'];

  const BRIEFING_TOPICS = [
    ['ai_semi', 'AI / 半導體', ['ai', '半導體', '晶圓', '台積', '輝達', 'nvidia', '晶片', '伺服器', '記憶體', '封測', 'asml', 'amd', 'intel', 'tsmc', 'chip', 'semiconductor', 'gpu', 'hbm']],
    ['macro_rate', '總經 / 利率 / 匯率', ['fed', '聯準會', '央行', '利率', '降息', '升息', 'cpi', '通膨', '關稅', 'gdp', '匯率', '美元', '台幣', '美債', '殖利率', 'inflation', 'tariff', 'treasury', 'economy', 'rate']],
    ['etf_fin', 'ETF / 高股息 / 金融', ['etf', '高股息', '配息', '除息', '金融', '金控', '銀行', '壽險', '債券', '0050', '0056', '00878', '00919', 'dividend']],
    ['us_tech', '美股科技 / 財報', ['美股', '那斯達克', '標普', '道瓊', '費半', '蘋果', '微軟', '谷歌', '亞馬遜', '特斯拉', 'apple', 'microsoft', 'alphabet', 'amazon', 'meta', 'tesla', 'earnings', 'nasdaq', 's&p', 'wall street']],
    ['tw_trad', '台股傳產 / 航運 / 能源', ['航運', '長榮', '陽明', '萬海', '重電', '綠電', '能源', '鋼鐵', '塑化', '生技', '軍工', '航空', '電價', 'oil', 'energy']]
  ];

  const TOPIC_MAP = Object.fromEntries(BRIEFING_TOPICS.map(([tid, label, kws]) => [tid, [label, kws]]));
  const DEFAULT_TOPIC_IDS = BRIEFING_TOPICS.map(([tid]) => tid);

  // 常見新聞股名／關鍵別名對照表
  const NEWS_STOCK_ALIASES = {
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
    '應材': 'AMAT', 'applied materials': 'AMAT', '科林研發': 'LRCX', '思科': 'CSCO', 'cisco': 'CSCO'
  };

  const MACRO_CAT_KWS = ['fed', '聯準會', '央行', 'cpi', '通膨', '利率', '關稅', 'gdp', '匯率', '美債', '油價', '黃金', 'economy', 'tariff', 'inflation'];
  const US_CAT_KWS = ['美股', '華爾街', '道瓊', '那斯達克', '標普', '費半', 'nvidia', 'apple', 'tesla', 'microsoft', 'wall street', 'nasdaq', 's&p'];

  const IGNORE_TICKERS = new Set([
    'AI', 'US', 'TW', 'UK', 'EU', 'CN', 'JP', 'GDP', 'CPI', 'PCE', 'PPI',
    'FED', 'FOMC', 'ETF', 'EPS', 'IPO', 'ADR', 'YOY', 'QOQ', 'MOM', 'SEC',
    'CEO', 'CFO', 'CTO', 'USD', 'TWD', 'NTD', 'RMB', 'JPY', 'EUR', 'PE', 'PB',
    'WSJ', 'CNBC', 'CRN', 'IT', 'PC', 'NB', 'TV', 'EV', 'GPU', 'CPU', 'HBM'
  ]);

  const DEFAULT_US_NAMES = {
    'TSM': '台積電 ADR', 'NVDA': 'NVIDIA', 'AAPL': 'Apple', 'MSFT': 'Microsoft',
    'GOOGL': 'Alphabet', 'AMZN': 'Amazon', 'META': 'Meta', 'TSLA': 'Tesla',
    'AMD': 'AMD', 'AVGO': 'Broadcom', 'JPM': 'JPMorgan', 'GS': 'Goldman Sachs',
    'MS': 'Morgan Stanley', 'BAC': 'Bank of America', 'WMT': 'Walmart',
    'COST': 'Costco', 'LLY': 'Eli Lilly', 'NFLX': 'Netflix', 'BRK-B': 'Berkshire Hathaway',
    'SPY': 'S&P 500 ETF', 'QQQ': 'Nasdaq 100 ETF', 'SOXX': 'iShares 半導體 ETF'
  };

  const pad2 = n => String(n).padStart(2, '0');

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function isAscii(s) {
    return /^[\x00-\x7F]*$/.test(s);
  }

  function formatDayWithOffset(tsSec, offsetSec) {
    const d = new Date((tsSec + offsetSec) * 1000);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }

  function fmtSigned(n, digits = 2) {
    return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`;
  }

  function fmtComma(n, digits = 2) {
    return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function fmtSignedComma(n, digits = 2) {
    return `${n >= 0 ? '+' : '-'}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  }

  function parseTimeHHMM(raw) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw || '').trim());
    if (!m) return { hour: 10, minute: 0, text: '10:00' };
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return { hour: 10, minute: 0, text: '10:00' };
    }
    return { hour, minute, text: `${pad2(hour)}:${pad2(minute)}` };
  }

  /**
   * 對應 Python _http_get(url, timeout=12) -> bytes
   * @param {string} url
   * @param {number} [timeoutSec=12]
   * @returns {Promise<Uint8Array>}
   */
  async function httpGet(url, timeoutSec = 12) {
    const res = await CM.http.getOk(url, { timeoutMs: timeoutSec * 1000 });
    return res.bytes;
  }

  /**
   * 對應 Python _fetch_yahoo_quote(yahoo_symbol) -> dict | None
   * 依交易所時區（gmtoffset）分日取得前一個交易日收盤價，避免誤用 range=5d 的 chartPreviousClose。
   * @param {string} yahooSymbol
   * @returns {Promise<object|null>}
   */
  async function fetchYahooQuote(yahooSymbol) {
    const encoded = encodeURIComponent(String(yahooSymbol));
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=5d&interval=1d`;
    try {
      const raw = await httpGet(url, 10);
      const payload = JSON.parse(CM.util.utf8Decode(raw));
      const res = payload.chart.result[0];
      const meta = res.meta;
      const offsetSec = Math.trunc(Number(meta.gmtoffset || 0));

      const rawTs = res.timestamp || [];
      const rawCloses = ((res.indicators && res.indicators.quote && res.indicators.quote[0]) || {}).close || [];
      const dailyByDay = new Map();
      const len = Math.min(rawTs.length, rawCloses.length);
      for (let i = 0; i < len; i++) {
        const t = rawTs[i];
        const c = rawCloses[i];
        if (t === null || t === undefined || c === null || c === undefined) continue;
        const numC = Number(c);
        if (!Number.isFinite(numC)) continue;
        dailyByDay.set(formatDayWithOffset(Number(t), offsetSec), numC);
      }
      const dailyBars = [...dailyByDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

      let price = meta.regularMarketPrice;
      if ((price === null || price === undefined) && dailyBars.length) {
        price = dailyBars[dailyBars.length - 1][1];
      }
      if (price === null || price === undefined) return null;
      price = Number(price);
      if (!Number.isFinite(price)) return null;

      const ts = meta.regularMarketTime;
      const marketDay = ts ? formatDayWithOffset(Number(ts), offsetSec) : '';

      // 取前一個交易日收盤價（嚴禁直接使用 range=5d 的 chartPreviousClose）
      let prev = null;
      if (dailyBars.length) {
        if (marketDay) {
          const earlier = dailyBars.filter(([d]) => d < marketDay);
          if (earlier.length) prev = earlier[earlier.length - 1][1];
        }
        if (prev === null && dailyBars.length >= 2) {
          prev = dailyBars[dailyBars.length - 2][1];
        }
      }
      if (prev === null) {
        const fallbackPrev = meta.previousClose || meta.chartPreviousClose;
        prev = fallbackPrev !== null && fallbackPrev !== undefined ? Number(fallbackPrev) : null;
      }

      const change = prev ? (price - prev) : 0.0;
      const changePct = prev ? ((change / prev) * 100.0) : 0.0;
      let tradeTime = '';
      if (ts) {
        const tp = CM.time.taipeiParts(Number(ts) * 1000);
        tradeTime = `${tp.date} ${tp.time}`;
      }
      return {
        price: CM.util.pyRound(price, 2),
        prevClose: prev !== null ? CM.util.pyRound(prev, 2) : null,
        change: CM.util.pyRound(change, 2),
        changePct: CM.util.pyRound(changePct, 2),
        tradeTime,
        currency: meta.currency || '',
        yahooSymbol
      };
    } catch {
      return null;
    }
  }

  /* ---------- 輕量 XML / RSS 解析與 RFC 2822 日期 ---------- */
  const NAMED_ENTITIES = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
  };

  function decodeXmlEntities(text) {
    if (!text || !text.includes('&')) return text || '';
    return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, code) => {
      if (code[0] === '#') {
        const num = code[1] === 'x' || code[1] === 'X'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
        if (Number.isFinite(num) && num >= 0 && num <= 0x10ffff) {
          try { return String.fromCodePoint(num); } catch { return m; }
        }
        return m;
      }
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, code) ? NAMED_ENTITIES[code] : m;
    });
  }

  function extractTagText(block, tagName) {
    const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const m = re.exec(block);
    if (!m) return '';
    const inner = m[1];
    // CDATA 內容保留原樣，其餘段落解碼 XML 實體（與 ElementTree 一致）
    const parts = inner.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/g);
    let out = '';
    for (const part of parts) {
      if (part.startsWith('<![CDATA[') && part.endsWith(']]>')) {
        out += part.slice(9, -3);
      } else {
        out += decodeXmlEntities(part);
      }
    }
    return out;
  }

  function extractRssItems(xmlText) {
    const items = [];
    const itemRe = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
    let m;
    while ((m = itemRe.exec(xmlText)) !== null) {
      const b = m[1];
      items.push({
        title: extractTagText(b, 'title'),
        link: extractTagText(b, 'link'),
        description: extractTagText(b, 'description'),
        pubDate: extractTagText(b, 'pubDate')
      });
    }
    if (items.length) return items;

    // Atom <entry> 備援
    const entryRe = /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi;
    while ((m = entryRe.exec(xmlText)) !== null) {
      const b = m[1];
      let link = extractTagText(b, 'link').trim();
      if (!link) {
        const hm = /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i.exec(b);
        if (hm) link = decodeXmlEntities(hm[1]);
      }
      items.push({
        title: extractTagText(b, 'title'),
        link,
        description: extractTagText(b, 'summary') || extractTagText(b, 'content'),
        pubDate: extractTagText(b, 'published') || extractTagText(b, 'updated')
      });
    }
    return items;
  }

  function parsePubDate(raw) {
    const text = String(raw || '').trim();
    if (!text) return ['', 0.0];
    try {
      let normalized = text.replace(/\bUT$/i, 'GMT');
      const hasTz = /(?:[+-]\d{2}:?\d{2}|Z|\b(?:GMT|UTC|EST|EDT|CST|CDT|MST|MDT|PST|PDT))$/i.test(normalized);
      if (!hasTz) normalized += ' GMT';
      const ms = Date.parse(normalized);
      if (!Number.isFinite(ms)) return [text.slice(0, 16), 0.0];
      const p = CM.time.taipeiParts(ms);
      return [`${pad2(p.month)}/${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}`, ms / 1000];
    } catch {
      return [text.slice(0, 16), 0.0];
    }
  }

  function cleanText(text) {
    if (!text) return '';
    return String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function isRelevantFinance(title, desc, marketHint) {
    const combined = `${title} ${desc}`;
    if (NOISE_KEYWORDS.some(bad => title.includes(bad))) return false;
    if (marketHint === 'US') return true;
    const lower = combined.toLowerCase();
    return FINANCE_KEYWORDS_LOWER.some(kw => lower.includes(kw));
  }

  function normalizeTitle(title) {
    // 對應 Python 3 re.sub(r'[\W_]+', '', title.lower())[:24]
    return String(title || '').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '').slice(0, 24);
  }

  function classifyCategory(title, defaultMarket) {
    const lower = title.toLowerCase();
    if (MACRO_CAT_KWS.some(k => lower.includes(k))) return '總經';
    if (defaultMarket === 'US' || US_CAT_KWS.some(k => lower.includes(k))) return '美股';
    return '台股';
  }

  function matchItemTopics(title, desc) {
    const text = `${title} ${desc}`.toLowerCase();
    const matched = [];
    for (const [tid, , kws] of BRIEFING_TOPICS) {
      if (kws.some(k => text.includes(k))) matched.push(tid);
    }
    return matched;
  }

  async function fetchNewsPool(maxItems = 10, selectedTopics = null) {
    let activeTopics = (selectedTopics || DEFAULT_TOPIC_IDS).filter(t => Object.prototype.hasOwnProperty.call(TOPIC_MAP, t));
    if (!activeTopics.length) activeTopics = [...DEFAULT_TOPIC_IDS];
    const activeSet = new Set(activeTopics);
    const isCustomTopics = activeSet.size !== DEFAULT_TOPIC_IDS.length || DEFAULT_TOPIC_IDS.some(t => !activeSet.has(t));

    const buckets = { TW: [], US: [] };
    const seenKeys = new Set();

    for (const [sourceName, marketHint, url] of RSS_SOURCES) {
      try {
        const raw = await httpGet(url, 10);
        const xmlText = CM.util.utf8Decode(raw);
        for (const item of extractRssItems(xmlText)) {
          const title = cleanText(item.title || '');
          const link = String(item.link || '').trim();
          const desc = cleanText(item.description || '');
          const [pubStr, pubTs] = parsePubDate(item.pubDate || '');
          if (!title || !link.startsWith('https://')) continue;
          if (!isRelevantFinance(title, desc, marketHint)) continue;
          const key = normalizeTitle(title);
          if (!key || seenKeys.has(key)) continue;
          seenKeys.add(key);
          const snippet = desc && desc !== title ? (desc.slice(0, 120) + (desc.length > 120 ? '…' : '')) : '';
          const itemTopics = matchItemTopics(title, desc);
          const topicHits = itemTopics.reduce((acc, t) => acc + (activeSet.has(t) ? 1 : 0), 0);
          buckets[marketHint].push({
            title,
            url: link,
            source: sourceName,
            category: classifyCategory(title, marketHint),
            published: pubStr,
            ts: pubTs,
            snippet,
            topicHits,
            topics: itemTopics.filter(t => activeSet.has(t)).map(t => TOPIC_MAP[t][0])
          });
        }
      } catch {
        continue;
      }
    }

    buckets.TW.sort((a, b) => b.ts - a.ts);
    buckets.US.sort((a, b) => b.ts - a.ts);

    const allItems = [...buckets.TW, ...buckets.US];
    allItems.sort((a, b) => {
      const ha = isCustomTopics ? a.topicHits : 0;
      const hb = isCustomTopics ? b.topicHits : 0;
      if (hb !== ha) return hb - ha;
      return b.ts - a.ts;
    });

    let merged;
    if (isCustomTopics) {
      const matched = allItems.filter(x => x.topicHits > 0);
      merged = matched.slice(0, maxItems);
      if (merged.length < 4) {
        const fallback = allItems.filter(x => x.topicHits === 0).sort((a, b) => b.ts - a.ts);
        merged.push(...fallback.slice(0, 4 - merged.length));
      }
    } else {
      const twPick = buckets.TW.slice(0, 6);
      const usPick = buckets.US.slice(0, 4);
      merged = [...twPick, ...usPick];
      if (merged.length < maxItems) {
        const rest = [...buckets.TW.slice(6), ...buckets.US.slice(4)].sort((a, b) => b.ts - a.ts);
        merged.push(...rest.slice(0, maxItems - merged.length));
      }
      merged.sort((a, b) => b.ts - a.ts);
    }

    const strip = lst => lst.map(item => {
      const { ts: _ts, topicHits: _th, ...rest } = item;
      return rest;
    });
    return [strip(merged.slice(0, maxItems)), strip(allItems)];
  }

  async function summarizeWithGemini(apiKey, indices, news, tracked) {
    if (!apiKey) return null;
    const idxLines = indices
      .filter(x => x.price !== null && x.price !== undefined)
      .map(x => `- ${x.name} (${x.symbol}): ${x.price} (${fmtSigned(x.changePct, 2)}%)`)
      .join('\n');
    const newsLines = news
      .map(n => `- [${n.category}｜${n.source}] ${n.title}`)
      .join('\n');
    const trackLines = tracked
      .filter(t => t.price !== null && t.price !== undefined)
      .map(t => `- ${t.code} ${t.name}: ${t.price} (${fmtSigned(t.changePct, 2)}%) ${t.chipNote || ''}`)
      .join('\n');
    const prompt =
      '你是專業台美股財經晨報編輯。請嚴格根據以下已查證的即時報價與新聞標題，撰寫 3 到 4 條精簡繁體中文重點摘要（每條不超過 60 字），' +
      '絕對禁止捏造未出現的數據或媒體，每條結尾請括號標示消息來源（例如：（Yahoo 奇摩股市）或（CNBC 財經））。' +
      '請直接輸出 JSON 陣列（例如 ["重點1", "重點2"]），不要加 Markdown 程式碼區塊。\n\n' +
      `【指數報價】\n${idxLines}\n\n【重點新聞】\n${newsLines}\n\n【追蹤標的】\n${trackLines}`;

    try {
      const res = await CM.http.postJson(
        GEMINI_ENDPOINT,
        { contents: [{ parts: [{ text: prompt }] }] },
        { timeoutMs: 20000, headers: { 'x-goog-api-key': apiKey } }
      );
      if (!res.ok) return null;
      const payload = res.json();
      let text = String(payload.candidates[0].content.parts[0].text || '').trim();
      text = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.length && parsed.every(x => typeof x === 'string')) {
        const cleaned = parsed.slice(0, 5).map(x => x.trim()).filter(Boolean);
        return cleaned.length ? cleaned : null;
      }
    } catch {
      return null;
    }
    return null;
  }

  function buildRuleSummary(indices, news, tracked) {
    const bullets = [];
    const usIdx = indices.filter(x => x.market === 'US' && x.price !== null && x.price !== undefined);
    const twIdx = indices.find(x => x.symbol === '^TWII' && x.price !== null && x.price !== undefined) || null;

    if (usIdx.length) {
      const parts = usIdx.slice(0, 4).map(x => `${x.name} ${fmtSigned(x.changePct, 2)}%`);
      bullets.push('隔夜美股表現：' + parts.join('、') + '（Yahoo Finance）。');
    }
    if (twIdx) {
      bullets.push(
        `台股加權指數目前 ${fmtComma(twIdx.price, 2)} 點（${fmtSigned(twIdx.change, 2)} / ${fmtSigned(twIdx.changePct, 2)}%，資料時間 ${twIdx.tradeTime || '最新'}，Yahoo Finance）。`
      );
    }
    if (tracked && tracked.length) {
      const validT = tracked.filter(t => t.price !== null && t.price !== undefined);
      if (validT.length) {
        const movers = [...validT].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 3);
        const desc = movers.map(m => `${m.code} ${m.name} (${fmtSigned(m.changePct, 2)}%)`).join('、');
        bullets.push(`追蹤標的波動焦點：${desc}。`);
      }
    }
    if (news && news.length) {
      const topTw = news.find(n => n.category === '台股') || null;
      const topUs = news.find(n => n.category === '美股' || n.category === '總經') || null;
      if (topTw) bullets.push(`台股焦點：${topTw.title}（${topTw.source}）。`);
      if (topUs) bullets.push(`國際／總經焦點：${topUs.title}（${topUs.source}）。`);
    }
    return bullets.length ? bullets : ['目前暫無可彙總之最新市場資訊，請稍後重試。'];
  }

  function appendMdStockTable(lines, heading, items) {
    if (!items || !items.length) return;
    lines.push('', heading, '', '| 代號 | 名稱 | 最新價 | 漲跌幅 | 籌碼／備註 |', '| --- | --- | ---: | ---: | --- |');
    for (const t of items) {
      const hasVal = t.price !== null && t.price !== undefined;
      const p = hasVal ? fmtComma(t.price, 2) : '—';
      const cp = hasVal ? `${fmtSigned(t.changePct, 2)}%` : '—';
      lines.push(`| \`${t.code}\` | ${t.name} | ${p} | ${cp} | ${t.chipNote || '—'} |`);
    }
  }

  function renderMarkdown(report) {
    const topicStr = (report.topicLabels && report.topicLabels.length) ? report.topicLabels.join('、') : '預設均衡';
    const lines = [
      `# 台美股財經晨報｜${report.date}`,
      `> 產出時間（台北）：${report.generatedAt} · 摘要模式：${report.summaryMode} · 觸發方式：${report.trigger} · 題材：${topicStr}`,
      '',
      '## 一、一分鐘重點總結'
    ];
    for (const b of report.summary) {
      lines.push(`- ${b}`);
    }
    lines.push('', '## 二、台美股盤勢快照', '', '| 指數／標的 | 市場 | 最新價 | 漲跌 | 漲跌幅 |', '| --- | --- | ---: | ---: | ---: |');
    for (const idx of report.indices) {
      const hasVal = idx.price !== null && idx.price !== undefined;
      const p = hasVal ? fmtComma(idx.price, 2) : '—';
      const c = hasVal ? fmtSignedComma(idx.change, 2) : '—';
      const cp = hasVal ? `${fmtSigned(idx.changePct, 2)}%` : '—';
      lines.push(`| ${idx.name} (\`${idx.symbol}\`) | ${idx.market} | ${p} | ${c} | ${cp} |`);
    }

    appendMdStockTable(lines, '## 三、自訂追蹤標的異動速覽', report.tracked || []);
    appendMdStockTable(lines, '## 四、晨報重點股票異動速覽', report.newsStocks || []);

    lines.push('', '## 五、重點新聞精選（附消息來源）');
    for (const n of report.news) {
      const pub = n.published ? ` · ${n.published}` : '';
      lines.push(`- **[${n.category}]** [${n.title}](${n.url}) — *${n.source}${pub}*`);
    }
    lines.push('');
    return lines.join('\n');
  }

  class BriefingService {
    constructor(appDataDir = '', stockNames = {}) {
      this.appDataDir = String(appDataDir || '');
      this.stockNames = stockNames || {};
      this.userDir = CM.fs.joinPath(this.appDataDir, 'user-v1');
      this.briefingsDir = CM.fs.joinPath(this.appDataDir, 'briefings-v1');
      this.configFile = CM.fs.joinPath(this.userDir, 'briefing-config.json');
      this.secretsFile = CM.fs.joinPath(this.userDir, 'briefing-secrets.json');
      this._generateInFlight = null;
    }

    /** 啟動初始化：若存在舊版明文金鑰檔，遷移至 CM.vault 後刪除 */
    async init() {
      const meta = await CM.fs.readJsonMeta(this.secretsFile);
      if (meta !== null) {
        if (!meta.damaged && meta.value && typeof meta.value === 'object') {
          const legacyKey = String(meta.value.geminiApiKey || '').trim();
          if (legacyKey) {
            const existing = await CM.vault.get(VAULT_GEMINI_KEY);
            if (!existing) await CM.vault.set(VAULT_GEMINI_KEY, legacyKey);
          }
        }
        await CM.fs.remove(this.secretsFile);
      }
    }

    _getStockNames() {
      if (this.stockNames && Object.keys(this.stockNames).length) return this.stockNames;
      return (CM.base && CM.base.stocks) || {};
    }

    async _readConfigRaw() {
      const data = await CM.fs.readJson(this.configFile, null);
      return (data && typeof data === 'object' && !Array.isArray(data)) ? { ...data } : {};
    }

    async _getApiKey() {
      return String((await CM.vault.get(VAULT_GEMINI_KEY)) || '').trim();
    }

    async _queryNotifyStatus(enabled, timeStr) {
      if (!enabled) return '已停用每日通知';
      const perm = await CM.notify.permission(false);
      if (perm !== 'granted') return '通知權限未開啟，請至系統設定允許通知';
      const { text } = parseTimeHHMM(timeStr);
      const pending = await CM.notify.pending();
      return pending.includes(DAILY_NOTIFY_ID) ? `已排程每日 ${text} 通知` : `未排程每日 ${text} 通知`;
    }

    async _syncNotification(enabled, timeStr, requestPermission = false) {
      if (!enabled) {
        await CM.notify.cancel(DAILY_NOTIFY_ID);
        return '已停用每日通知';
      }
      const perm = await CM.notify.permission(requestPermission);
      if (perm !== 'granted') return '通知權限未開啟，請至系統設定允許通知';
      const { hour, minute, text } = parseTimeHHMM(timeStr);
      const ok = await CM.notify.scheduleDaily({
        id: DAILY_NOTIFY_ID,
        hour,
        minute,
        title: DAILY_NOTIFY_TITLE,
        body: DAILY_NOTIFY_BODY
      });
      return ok ? `已排程每日 ${text} 通知` : '通知權限未開啟，請至系統設定允許通知';
    }

    async getConfig() {
      const raw = await this._readConfigRaw();
      const enabled = raw.enabled !== undefined ? Boolean(raw.enabled) : true;
      const { text: time } = parseTimeHHMM(raw.time || '10:00');
      let watchlist = Array.isArray(raw.watchlist) ? raw.watchlist : [...DEFAULT_WATCHLIST];
      watchlist = watchlist
        .map(s => String(s).trim().toUpperCase())
        .filter(s => /^[A-Za-z0-9]{2,8}$/.test(s));

      let topics;
      if (!Array.isArray(raw.topics)) {
        topics = [...DEFAULT_TOPIC_IDS];
      } else {
        topics = raw.topics
          .map(t => String(t).trim())
          .filter(t => Object.prototype.hasOwnProperty.call(TOPIC_MAP, t));
        if (!topics.length) topics = [...DEFAULT_TOPIC_IDS];
      }

      const key = await this._getApiKey();
      const masked = key.length >= 6 ? ('••••' + key.slice(-4)) : (key ? '已設定' : '');
      const windowsTaskStatus = await this._queryNotifyStatus(enabled, time);

      return {
        enabled,
        time,
        watchlist,
        topics,
        availableTopics: BRIEFING_TOPICS.map(([id, label]) => ({ id, label })),
        hasGeminiKey: Boolean(key),
        geminiKeyHint: masked,
        windowsTaskStatus
      };
    }

    async updateConfig(body) {
      const updates = (body && typeof body === 'object') ? body : {};
      const raw = await this._readConfigRaw();
      const current = {
        enabled: true,
        time: '10:00',
        watchlist: [...DEFAULT_WATCHLIST],
        topics: [...DEFAULT_TOPIC_IDS],
        ...raw
      };

      let needNotifySync = false;
      if ('enabled' in updates) {
        current.enabled = Boolean(updates.enabled);
        needNotifySync = true;
      }
      if ('time' in updates) {
        current.time = parseTimeHHMM(updates.time).text;
        needNotifySync = true;
      }
      if ('watchlist' in updates) {
        let items = updates.watchlist;
        if (typeof items === 'string') {
          items = items.split(/[\s,，、;；]+/);
        }
        if (Array.isArray(items)) {
          const cleaned = [];
          for (const sym of items) {
            const s = String(sym).trim().toUpperCase();
            if (/^[A-Za-z0-9]{2,8}$/.test(s) && !cleaned.includes(s)) {
              cleaned.push(s);
            }
          }
          current.watchlist = cleaned.slice(0, 15);
        }
      }
      if ('topics' in updates && Array.isArray(updates.topics)) {
        const cleanedTopics = [];
        for (const t of updates.topics) {
          const tid = String(t).trim();
          if (Object.prototype.hasOwnProperty.call(TOPIC_MAP, tid) && !cleanedTopics.includes(tid)) {
            cleanedTopics.push(tid);
          }
        }
        current.topics = cleanedTopics.length ? cleanedTopics : [...DEFAULT_TOPIC_IDS];
      }

      await CM.fs.writeJson(this.configFile, current);

      if (needNotifySync) {
        await this._syncNotification(Boolean(current.enabled), current.time, Boolean(current.enabled));
      }

      if ('geminiApiKey' in updates) {
        const newKey = String(updates.geminiApiKey || '').trim();
        if (newKey) {
          await CM.vault.set(VAULT_GEMINI_KEY, newKey);
        } else {
          await CM.vault.remove(VAULT_GEMINI_KEY);
        }
      } else if (updates.clearGeminiKey) {
        await CM.vault.remove(VAULT_GEMINI_KEY);
      }

      return this.getConfig();
    }

    async listDates() {
      const files = await CM.fs.list(this.briefingsDir);
      const dates = [];
      for (const f of files) {
        const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f.name);
        if (m) dates.push(m[1]);
      }
      dates.sort((a, b) => (b < a ? -1 : b > a ? 1 : 0));
      return dates;
    }

    async readReport(day = null) {
      const dates = await this.listDates();
      const target = (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) ? day : (dates[0] || null);
      if (!target) return null;
      return CM.fs.readJson(CM.fs.joinPath(this.briefingsDir, `${target}.json`), null);
    }

    async shouldAutoRun() {
      const cfg = await this.getConfig();
      if (!cfg.enabled) return false;
      const now = CM.time.taipeiParts();
      const { hour, minute } = parseTimeHHMM(cfg.time);
      if (now.hour < hour || (now.hour === hour && now.minute < minute)) return false;
      const existing = await CM.fs.readText(CM.fs.joinPath(this.briefingsDir, `${now.date}.json`));
      return !(existing && existing.exists);
    }

    _loadUsNameMap() {
      const nameMap = { ...DEFAULT_US_NAMES };
      const keywords = [];
      const universe = (CM.base && Array.isArray(CM.base.usUniverse)) ? CM.base.usUniverse : [];
      for (const item of universe) {
        let code = '';
        let disp = '';
        let enName = '';
        if (Array.isArray(item)) {
          code = String(item[0] || '').trim().toUpperCase();
          disp = String(item[1] || code).trim();
          enName = String(item[3] || disp.replace(/[\u4e00-\u9fff]+/g, '')).trim();
        } else if (item && typeof item === 'object') {
          code = String(item.code || '').trim().toUpperCase();
          disp = String(item.name || code).trim();
          enName = String(item.enName || '').trim();
        }
        if (!code) continue;
        if (!Object.prototype.hasOwnProperty.call(nameMap, code)) {
          nameMap[code] = disp;
        }
        const cleanEn = enName.replace(/,?\s+(?:Inc\.?|Corp\.?|Corporation|Ltd\.?|PLC|Co\.?|Group|Holdings)$/i, '').trim();
        if (cleanEn.length >= 6) {
          keywords.push([cleanEn, code]);
        }
      }
      return [nameMap, keywords];
    }

    async _fetchOneTrackedQuote(code, usNames) {
      const isTw = /^(?:\d{4}|00\d{2,4}[A-Z]?)$/.test(code);
      let quote;
      if (isTw) {
        quote = (await fetchYahooQuote(`${code}.TW`)) || (await fetchYahooQuote(`${code}.TWO`));
      } else {
        quote = await fetchYahooQuote(code);
      }

      const stockNames = this._getStockNames();
      let name;
      let market;
      if (isTw) {
        const info = stockNames[code];
        name = (Array.isArray(info) && info.length) ? info[0] : (code.startsWith('00') ? 'ETF' : code);
        market = (Array.isArray(info) && info.length > 1) ? info[1] : 'TWSE';
      } else {
        name = Object.prototype.hasOwnProperty.call(usNames, code) ? usNames[code] : code;
        market = 'US';
      }

      return {
        code,
        name,
        market,
        price: quote ? quote.price : null,
        change: quote ? quote.change : null,
        changePct: quote ? quote.changePct : null,
        tradeTime: quote ? quote.tradeTime : '',
        chipNote: isTw ? '台股集保可於個股頁核對' : '美股即時／收盤報價'
      };
    }

    async _fetchTrackedQuotes(symbols) {
      if (!symbols || !symbols.length) return [];
      const [usNames] = this._loadUsNameMap();
      return CM.util.pool(symbols, 6, sym => this._fetchOneTrackedQuote(sym, usNames));
    }

    async _extractNewsStocks(news, excludeCodes, maxCount = 8, extraNews = null) {
      const [, spKeywords] = this._loadUsNameMap();
      const stockNames = this._getStockNames();
      const longTwNames = [];
      const shortTwNames = [];
      for (const [code, info] of Object.entries(stockNames)) {
        if (!Array.isArray(info) || !info.length) continue;
        const nm = String(info[0]).trim();
        const upCode = String(code).toUpperCase();
        if (nm.length >= 3) longTwNames.push([nm, upCode]);
        else if (nm.length === 2) shortTwNames.push([nm, upCode]);
      }

      const hits = new Map();
      const softHits = new Map();

      function register(code, article) {
        const sym = String(code || '').trim().toUpperCase();
        if (!sym) return;
        const src = article.source || '財經新聞';
        let titleShort = article.title || '';
        if (titleShort.length > 26) titleShort = titleShort.slice(0, 26) + '…';
        const meta = { mentionedIn: `${src}：${titleShort}` };
        if (excludeCodes.has(sym)) {
          if (!softHits.has(sym)) softHits.set(sym, meta);
          return;
        }
        if (!hits.has(sym)) hits.set(sym, meta);
      }

      const seenTitles = new Set();
      const orderedArticles = [];
      for (const lst of [news, extraNews || []]) {
        for (const art of lst) {
          const tkey = art.title || '';
          if (tkey && !seenTitles.has(tkey)) {
            seenTitles.add(tkey);
            orderedArticles.push(art);
          }
        }
      }

      const aliasEntries = Object.entries(NEWS_STOCK_ALIASES);
      const codeRe = /(\()?(?<![\p{L}\p{N}_])(\d{4})(?![\p{L}\p{N}_])(\))?/gu;
      const usTickerRe = /(?:\(|(?:NASDAQ|NYSE)\s*[:：]\s*)([A-Z]{2,5}(?:-[A-Z])?)(?:\)|(?![\p{L}\p{N}_]))/gu;

      for (const n of orderedArticles) {
        const text = `${n.title || ''} ${n.snippet || ''}`;
        const lower = text.toLowerCase();

        // 1. 別名關鍵字
        for (const [alias, sym] of aliasEntries) {
          if (isAscii(alias)) {
            if (new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(alias)}(?![A-Za-z0-9])`).test(lower)) {
              register(sym, n);
            }
          } else if (text.includes(alias)) {
            register(sym, n);
          }
        }

        // 2. 明確 4 碼台股代號（排除單純年份 2020~2035）
        for (const m of text.matchAll(codeRe)) {
          const code = m[2];
          if (!Object.prototype.hasOwnProperty.call(stockNames, code)) continue;
          const codeNum = Number(code);
          const isYearLike = codeNum >= 2020 && codeNum <= 2035;
          const info = stockNames[code] || [];
          const nm = info[0] || '';
          if (isYearLike && !(m[1] && m[3]) && !(nm && text.includes(nm))) continue;
          register(code, n);
        }

        // 3. 完整 3 字以上台股公司名稱
        for (const [nm, code] of longTwNames) {
          if (text.includes(nm)) {
            register(code, n);
            if (hits.size >= maxCount) break;
          }
        }

        // 4. 安全比對 2 字台股公告語境
        if (hits.size < maxCount) {
          for (const [nm, code] of shortTwNames) {
            if (
              text.includes(nm) &&
              new RegExp(`(?:^|[，、\\s「『(（【])${escapeRegExp(nm)}(?:：|:|股價|營收|獲利|法說|財報|董事|買回|庫藏|增持|買超|賣超|大漲|重挫|跳空|領漲|除息)`).test(text)
            ) {
              register(code, n);
              if (hits.size >= maxCount) break;
            }
          }
        }

        // 5. S&P 500 英文完整公司名與括號／交易所美股代號
        for (const [kw, sym] of spKeywords) {
          if (new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(kw)}(?![A-Za-z0-9])`).test(text)) {
            register(sym, n);
            if (hits.size >= maxCount) break;
          }
        }

        for (const m of text.matchAll(usTickerRe)) {
          const sym = m[1];
          if (!IGNORE_TICKERS.has(sym)) register(sym, n);
        }

        if (hits.size >= maxCount) break;
      }

      const chosenHits = hits.size ? hits : softHits;
      if (!chosenHits.size) return [];
      const orderedCodes = [...chosenHits.keys()].slice(0, maxCount);
      const quotes = await this._fetchTrackedQuotes(orderedCodes);
      const validQuotes = [];
      for (const q of quotes) {
        if (!q || q.price === null || q.price === undefined) continue;
        const meta = chosenHits.get(q.code) || {};
        q.mentionedIn = meta.mentionedIn || '';
        if (meta.mentionedIn) q.chipNote = meta.mentionedIn;
        validQuotes.push(q);
      }
      return validQuotes;
    }

    async _generateImpl({ featuredCode = '', trigger = '手動馬上製作' } = {}) {
      void featuredCode; // 保留參數與 API 介面相容
      const now = CM.time.taipeiParts();
      const today = now.date;
      const cfg = await this.getConfig();

      const indices = await CM.util.pool(MARKET_INDICES, 6, async ([sym, name, mkt]) => {
        const q = await fetchYahooQuote(sym);
        return {
          symbol: sym,
          name,
          market: mkt,
          price: q ? q.price : null,
          change: q ? q.change : null,
          changePct: q ? q.changePct : null,
          tradeTime: q ? q.tradeTime : ''
        };
      });

      const selectedTopics = (cfg.topics && cfg.topics.length) ? cfg.topics : [...DEFAULT_TOPIC_IDS];
      const selSet = new Set(selectedTopics);
      const isDefaultTopics = selSet.size === DEFAULT_TOPIC_IDS.length && DEFAULT_TOPIC_IDS.every(t => selSet.has(t));
      const topicLabels = isDefaultTopics
        ? ['預設均衡（全部題材）']
        : selectedTopics.filter(t => Object.prototype.hasOwnProperty.call(TOPIC_MAP, t)).map(t => TOPIC_MAP[t][0]);

      const [news, allNewsPool] = await fetchNewsPool(10, selectedTopics);

      const trackCodes = [];
      for (const s of cfg.watchlist) {
        if (!trackCodes.includes(s)) trackCodes.push(s);
      }
      const tracked = await this._fetchTrackedQuotes(trackCodes.slice(0, 10));
      const newsStocks = await this._extractNewsStocks(
        news,
        new Set(trackCodes),
        8,
        allNewsPool
      );

      const apiKey = await this._getApiKey();
      const aiBullets = apiKey
        ? await summarizeWithGemini(apiKey, indices, news, [...tracked, ...newsStocks.slice(0, 3)])
        : null;
      let summary;
      let summaryMode;
      if (aiBullets) {
        summary = aiBullets;
        summaryMode = 'Gemini AI 濃縮摘要';
      } else {
        summary = buildRuleSummary(indices, news, tracked.length ? tracked : newsStocks);
        summaryMode = '規則式重點彙整（免 Key）';
      }

      const report = {
        date: today,
        generatedAt: `${today} ${pad2(now.hour)}:${pad2(now.minute)}:${pad2(now.second)} +08:00`,
        trigger: trigger || '手動馬上製作',
        topics: selectedTopics,
        topicLabels,
        summaryMode,
        summary,
        indices,
        tracked,
        newsStocks,
        news
      };
      report.markdown = renderMarkdown(report);

      await CM.fs.writeJson(CM.fs.joinPath(this.briefingsDir, `${today}.json`), report);
      await CM.fs.writeText(CM.fs.joinPath(this.briefingsDir, `${today}.md`), report.markdown);
      return report;
    }

    async generate(opts = {}) {
      if (this._generateInFlight) return this._generateInFlight;
      this._generateInFlight = this._generateImpl(opts).finally(() => {
        this._generateInFlight = null;
      });
      return this._generateInFlight;
    }
  }

  CM.news = {
    BriefingService,
    httpGet,
    fetchYahooQuote,
    BRIEFING_TOPICS,
    NEWS_STOCK_ALIASES,
    MARKET_INDICES,
    RSS_SOURCES,
    DEFAULT_WATCHLIST,
    TOPIC_MAP,
    DEFAULT_TOPIC_IDS,
    NOISE_KEYWORDS,
    FINANCE_KEYWORDS
  };
})(globalThis.ChipMobile = globalThis.ChipMobile || {});
