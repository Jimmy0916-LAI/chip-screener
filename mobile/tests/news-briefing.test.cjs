'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./harness.cjs');

// Normalize objects/arrays created inside vm.createContext realm for deepStrictEqual
const plain = v => JSON.parse(JSON.stringify(v));

function makeYahooChart({
  gmtoffset = 28800,
  currency = 'TWD',
  regularMarketPrice = 1000.0,
  regularMarketTime = 1795656600, // 2026-11-26 09:30 +08:00
  timestamps = [],
  closes = [],
  previousClose = undefined,
  chartPreviousClose = 900.0
} = {}) {
  const meta = {
    gmtoffset,
    currency,
    regularMarketPrice,
    regularMarketTime,
    chartPreviousClose
  };
  if (previousClose !== undefined) meta.previousClose = previousClose;
  return {
    chart: {
      result: [
        {
          meta,
          timestamp: timestamps,
          indicators: { quote: [{ close: closes }] }
        }
      ]
    }
  };
}

test('httpGet returns bytes on 200, throws HTTP status on error, enforces allowlist', async () => {
  const env = createEnv({
    files: ['services/news-briefing.js'],
    routes: [
      { match: 'https://tw.stock.yahoo.com/ok', status: 200, body: 'hello' },
      { match: 'https://tw.stock.yahoo.com/missing', status: 404, body: 'nope' }
    ]
  });
  const { httpGet } = env.CM.news;

  const bytes = await httpGet('https://tw.stock.yahoo.com/ok', 5);
  assert.ok(ArrayBuffer.isView(bytes) && bytes.constructor.name === 'Uint8Array');
  assert.equal(env.CM.util.utf8Decode(bytes), 'hello');

  await assert.rejects(
    () => httpGet('https://tw.stock.yahoo.com/missing', 5),
    err => err.message === 'HTTP 404' && err.status === 404
  );

  await assert.rejects(
    () => httpGet('https://evil.example.com/data', 5),
    /未授權網域/
  );
});

test('fetchYahooQuote uses exchange-timezone day bucketing and avoids 5d chartPreviousClose', async () => {
  // Cross-checked against Python 3.10 _fetch_yahoo_quote:
  // {"price": 145.68, "prevClose": 140.0, "change": 5.68, "changePct": 4.05, "tradeTime": "2026-11-26 05:00", "currency": "USD", "yahooSymbol": "NVDA"}
  const env = createEnv({
    files: ['services/news-briefing.js'],
    routes: [
      {
        match: 'https://query1.finance.yahoo.com/v8/finance/chart/NVDA',
        body: makeYahooChart({
          gmtoffset: -18000,
          currency: 'USD',
          regularMarketPrice: 145.675,
          regularMarketTime: 1795640400,
          timestamps: [1795467600, 1795554000, 1795640400],
          closes: [130.0, 140.0, 145.675],
          chartPreviousClose: 120.0 // 5d ago close - MUST NOT be used
        })
      },
      {
        match: 'https://query1.finance.yahoo.com/v8/finance/chart/FALLBACK',
        body: makeYahooChart({
          gmtoffset: -18000,
          currency: 'USD',
          regularMarketPrice: 52.0,
          regularMarketTime: 1795640400,
          timestamps: [],
          closes: [],
          previousClose: 50.0,
          chartPreviousClose: 45.0
        })
      },
      {
        match: 'https://query1.finance.yahoo.com/v8/finance/chart/FAIL',
        status: 500,
        body: 'err'
      }
    ]
  });

  const q = await env.CM.news.fetchYahooQuote('NVDA');
  assert.deepEqual(plain(q), {
    price: 145.68,
    prevClose: 140.0,
    change: 5.68,
    changePct: 4.05,
    tradeTime: '2026-11-26 05:00',
    currency: 'USD',
    yahooSymbol: 'NVDA'
  });

  const fb = await env.CM.news.fetchYahooQuote('FALLBACK');
  assert.equal(fb.prevClose, 50.0);
  assert.equal(fb.change, 2.0);
  assert.equal(fb.changePct, 4.0);

  const fail = await env.CM.news.fetchYahooQuote('FAIL');
  assert.equal(fail, null);
});

test('BriefingService config persistence, vault migration, masked hint, and notifications', async () => {
  let permState = 'granted';
  const permRequests = [];
  const env = createEnv({
    files: ['services/news-briefing.js'],
    now: '2026-11-26T09:30:00+08:00'
  });
  env.CM.native.notifyPermission = async ({ request }) => {
    permRequests.push(Boolean(request));
    return { display: permState };
  };

  // Seed legacy secrets file to test migration
  env.memFs.set('user-v1/briefing-secrets.json', {
    data: JSON.stringify({ geminiApiKey: 'AIzaLegacyKey9876' }),
    mtime: Date.now()
  });

  const svc = new env.CM.news.BriefingService('', {});
  await svc.init();

  // Legacy file deleted, key moved to vault
  assert.equal(env.memFs.has('user-v1/briefing-secrets.json'), false);
  assert.equal(env.vault.get('geminiApiKey'), 'AIzaLegacyKey9876');

  let cfg = await svc.getConfig();
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.time, '10:00');
  assert.deepEqual(plain(cfg.watchlist), ['2330', '0050', 'TSM', 'NVDA']);
  assert.equal(cfg.hasGeminiKey, true);
  assert.equal(cfg.geminiKeyHint, '••••9876');
  assert.equal(cfg.availableTopics.length, 5);

  // Update config: enable schedules notification & requests permission, sets new key in vault only
  cfg = await svc.updateConfig({
    enabled: true,
    watchlist: '2330, nvda，bad!sym, 2330, 0050',
    topics: ['ai_semi', 'invalid_topic', 'us_tech'],
    geminiApiKey: 'AIzaNewSecret4321'
  });
  assert.deepEqual(plain(cfg.watchlist), ['2330', 'NVDA', '0050']);
  assert.deepEqual(plain(cfg.topics), ['ai_semi', 'us_tech']);
  assert.equal(cfg.hasGeminiKey, true);
  assert.equal(cfg.geminiKeyHint, '••••4321');
  assert.equal(cfg.windowsTaskStatus, '已排程每日 10:00 通知');
  assert.ok(permRequests.includes(true));
  assert.equal(env.notifications.has(1001), true);
  assert.deepEqual(plain(env.notifications.get(1001)), {
    id: 1001,
    hour: 10,
    minute: 0,
    title: '籌碼雷達 每日晨報',
    body: '台美股盤勢與重點財經新聞已就緒，點擊查看今日晨報。'
  });

  // Custom HH:MM time reschedules notification
  cfg = await svc.updateConfig({ time: '08:30' });
  assert.equal(cfg.time, '08:30');
  assert.equal(cfg.windowsTaskStatus, '已排程每日 08:30 通知');
  assert.equal(env.notifications.get(1001).hour, 8);
  assert.equal(env.notifications.get(1001).minute, 30);

  // Ensure API key is NOT in memFs anywhere
  for (const [, f] of env.memFs) {
    assert.equal(f.data.includes('AIzaNewSecret4321'), false);
  }
  assert.equal(env.memFs.has('user-v1/briefing-secrets.json'), false);
  assert.equal(env.vault.get('geminiApiKey'), 'AIzaNewSecret4321');

  // Short key (< 6 chars) shows '已設定'
  cfg = await svc.updateConfig({ geminiApiKey: 'short' });
  assert.equal(cfg.geminiKeyHint, '已設定');

  // Clear key
  cfg = await svc.updateConfig({ clearGeminiKey: true });
  assert.equal(cfg.hasGeminiKey, false);
  assert.equal(cfg.geminiKeyHint, '');
  assert.equal(env.vault.has('geminiApiKey'), false);

  // Disable cancels notification
  cfg = await svc.updateConfig({ enabled: false });
  assert.equal(env.notifications.has(1001), false);
  assert.equal(cfg.windowsTaskStatus, '已停用每日通知');

  // Re-enable when permission denied
  permState = 'denied';
  cfg = await svc.updateConfig({ enabled: true });
  assert.equal(cfg.windowsTaskStatus, '通知權限未開啟，請至系統設定允許通知');
  assert.equal(env.notifications.has(1001), false);
});

test('shouldAutoRun respects enabled flag, 10:00 Taipei cutoff, and existing report', async () => {
  const env = createEnv({
    files: ['services/news-briefing.js'],
    now: '2026-11-26T09:59:00+08:00'
  });
  const svc = new env.CM.news.BriefingService('', {});
  await svc.init();

  assert.equal(await svc.shouldAutoRun(), false);

  env.setNow('2026-11-26T10:00:00+08:00');
  assert.equal(await svc.shouldAutoRun(), true);

  await svc.updateConfig({ enabled: false });
  assert.equal(await svc.shouldAutoRun(), false);

  await svc.updateConfig({ enabled: true });
  assert.equal(await svc.shouldAutoRun(), true);

  // Once today's report exists -> false
  env.memFs.set('briefings-v1/2026-11-26.json', { data: JSON.stringify({ date: '2026-11-26' }), mtime: Date.now() });
  assert.equal(await svc.shouldAutoRun(), false);
});

test('generate() produces exact report shape, filters RSS, extracts newsStocks, supports rule & Gemini modes', async () => {
  const yahooRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title><![CDATA[台積電(2330)法說報喜 聯發科同步大漲 & 展望佳]]></title>
    <link>https://tw.stock.yahoo.com/news/tsmc-1</link>
    <description><![CDATA[<p>台積電與聯發科帶動半導體族群上攻，2026年資本支出看增。</p>]]></description>
    <pubDate>Thu, 26 Nov 2026 08:30:00 +0800</pubDate>
  </item>
  <item>
    <title>大樂透頭獎開獎 幸運門市出爐</title>
    <link>https://tw.stock.yahoo.com/news/lotto</link>
    <description>頭獎上看兩億元</description>
    <pubDate>Thu, 26 Nov 2026 08:20:00 +0800</pubDate>
  </item>
  <item>
    <title>不安全連結台股新聞</title>
    <link>http://tw.stock.yahoo.com/news/insecure</link>
    <description>台積電營收</description>
    <pubDate>Thu, 26 Nov 2026 08:10:00 +0800</pubDate>
  </item>
</channel></rss>`;

  const cnaRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>台積電(2330)法說報喜 聯發科同步大漲 &amp; 展望佳</title>
    <link>https://www.cna.com.tw/news/dup</link>
    <description>重複標題應被去重</description>
    <pubDate>Thu, 26 Nov 2026 08:35:00 +0800</pubDate>
  </item>
  <item>
    <title>華固營收創高 商辦大案入帳</title>
    <link>https://www.cna.com.tw/news/2548</link>
    <description>建商獲利亮眼</description>
    <pubDate>Thu, 26 Nov 2026 07:45:00 +0800</pubDate>
  </item>
</channel></rss>`;

  const cnbcRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>Fed signals steady rate path as inflation cools</title>
    <link>https://www.cnbc.com/2026/11/25/fed-rate.html</link>
    <description>Wall Street rallies while Broadcom (NASDAQ: AVGO) and Apple lead tech gains.</description>
    <pubDate>Wed, 25 Nov 2026 17:00:00 EST</pubDate>
  </item>
</channel></rss>`;

  const quotesBySym = {
    '%5ETWII': makeYahooChart({ gmtoffset: 28800, regularMarketPrice: 23000.0, regularMarketTime: 1795658400, timestamps: [1795572000, 1795658400], closes: [22800.0, 23000.0] }),
    '%5EGSPC': makeYahooChart({ gmtoffset: -18000, currency: 'USD', regularMarketPrice: 6000.0, regularMarketTime: 1795640400, timestamps: [1795554000, 1795640400], closes: [5940.0, 6000.0] }),
    '%5EIXIC': makeYahooChart({ gmtoffset: -18000, currency: 'USD', regularMarketPrice: 19000.0, regularMarketTime: 1795640400, timestamps: [1795554000, 1795640400], closes: [18800.0, 19000.0] }),
    '%5EDJI': makeYahooChart({ gmtoffset: -18000, currency: 'USD', regularMarketPrice: 44000.0, regularMarketTime: 1795640400, timestamps: [1795554000, 1795640400], closes: [44200.0, 44000.0] }),
    '%5ESOX': makeYahooChart({ gmtoffset: -18000, currency: 'USD', regularMarketPrice: 5100.0, regularMarketTime: 1795640400, timestamps: [1795554000, 1795640400], closes: [5000.0, 5100.0] }),
    'TSM': makeYahooChart({ gmtoffset: -18000, currency: 'USD', regularMarketPrice: 195.0, regularMarketTime: 1795640400, timestamps: [1795554000, 1795640400], closes: [190.0, 195.0] }),
    '2330.TW': makeYahooChart({ gmtoffset: 28800, regularMarketPrice: 1050.0, regularMarketTime: 1795658400, timestamps: [1795572000, 1795658400], closes: [1030.0, 1050.0] }),
    '0050.TW': makeYahooChart({ gmtoffset: 28800, regularMarketPrice: 192.5, regularMarketTime: 1795658400, timestamps: [1795572000, 1795658400], closes: [190.0, 192.5] }),
    'NVDA': makeYahooChart({ gmtoffset: -18000, currency: 'USD', regularMarketPrice: 145.0, regularMarketTime: 1795640400, timestamps: [1795554000, 1795640400], closes: [140.0, 145.0] }),
    '2454.TW': makeYahooChart({ gmtoffset: 28800, regularMarketPrice: 1300.0, regularMarketTime: 1795658400, timestamps: [1795572000, 1795658400], closes: [1250.0, 1300.0] }),
    '2548.TW': makeYahooChart({ gmtoffset: 28800, regularMarketPrice: 120.0, regularMarketTime: 1795658400, timestamps: [1795572000, 1795658400], closes: [118.0, 120.0] }),
    'AVGO': makeYahooChart({ gmtoffset: -18000, currency: 'USD', regularMarketPrice: 180.0, regularMarketTime: 1795640400, timestamps: [1795554000, 1795640400], closes: [175.0, 180.0] }),
    'AAPL': makeYahooChart({ gmtoffset: -18000, currency: 'USD', regularMarketPrice: 230.0, regularMarketTime: 1795640400, timestamps: [1795554000, 1795640400], closes: [228.0, 230.0] })
  };

  let geminiReqSeen = null;
  let geminiFail = false;
  const env = createEnv({
    files: ['services/news-briefing.js'],
    now: '2026-11-26T10:05:12+08:00',
    base: {
      stocks: {
        '2330': ['台積電', 'TWSE'],
        '0050': ['元大台灣50', 'TWSE'],
        '2454': ['聯發科', 'TWSE'],
        '2548': ['華固', 'TWSE'],
        '2026': ['測試年份股', 'TWSE']
      },
      usUniverse: [['AVGO', 'Broadcom', '科技', 'Broadcom Inc.']]
    },
    routes: [
      { match: 'https://tw.stock.yahoo.com/rss', body: yahooRss },
      { match: 'https://feeds.feedburner.com/rsscna/finance', body: cnaRss },
      { match: 'https://search.cnbc.com/rs/search/', body: cnbcRss },
      {
        match: /^https:\/\/query1\.finance\.yahoo\.com\/v8\/finance\/chart\/([^?]+)/,
        body: req => {
          const m = /\/chart\/([^?]+)/.exec(req.url);
          const sym = m && m[1];
          if (sym && quotesBySym[sym]) return quotesBySym[sym];
          throw new Error('not found');
        }
      },
      {
        match: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
        body: req => {
          geminiReqSeen = req;
          if (geminiFail) throw new Error('Gemini unavailable');
          return {
            candidates: [
              {
                content: {
                  parts: [
                    { text: '```json\n["美股走揚帶動台積電表現（Yahoo 奇摩股市）", "聯準會釋出利率平穩訊號（CNBC 財經）"]\n```' }
                  ]
                }
              }
            ]
          };
        }
      }
    ]
  });

  const svc = new env.CM.news.BriefingService('', env.CM.base.stocks);
  await svc.init();

  // 1. Rule-based summary mode (no Gemini key) + single-flight concurrency check
  const [report, report2] = await Promise.all([
    svc.generate({ featuredCode: '2404', trigger: '手動馬上製作' }),
    svc.generate({ featuredCode: '2404', trigger: '手動馬上製作' })
  ]);
  assert.strictEqual(report, report2);

  assert.equal(report.date, '2026-11-26');
  assert.equal(report.generatedAt, '2026-11-26 10:05:12 +08:00');
  assert.equal(report.trigger, '手動馬上製作');
  assert.equal(report.summaryMode, '規則式重點彙整（免 Key）');
  assert.deepEqual(plain(report.topicLabels), ['預設均衡（全部題材）']);
  assert.equal(report.indices.length, 6);
  assert.equal(report.indices[0].symbol, '^TWII');
  assert.equal(report.indices[0].price, 23000.0);

  // RSS filtering & deduplication: 3 valid items (lotto filtered, http filtered, CNA dup removed)
  assert.equal(report.news.length, 3);
  assert.equal(report.news[0].title, '台積電(2330)法說報喜 聯發科同步大漲 & 展望佳');
  assert.equal(report.news[0].published, '11/26 08:30');
  assert.equal(report.news[1].title, '華固營收創高 商辦大案入帳');
  assert.equal(report.news[2].category, '總經');
  assert.equal(report.news[2].published, '11/26 06:00'); // 17:00 EST -> 06:00 +08:00

  // Extracted newsStocks should include 2454, 2548, AVGO, AAPL (and NOT 2330 in watchlist, NOT 2026 year)
  const nsCodes = report.newsStocks.map(x => x.code);
  assert.ok(nsCodes.includes('2454'));
  assert.ok(nsCodes.includes('2548'));
  assert.ok(nsCodes.includes('AVGO'));
  assert.ok(nsCodes.includes('AAPL'));
  assert.equal(nsCodes.includes('2330'), false);
  assert.equal(nsCodes.includes('2026'), false);

  // Markdown & persistence
  assert.ok(report.markdown.includes('# 台美股財經晨報｜2026-11-26'));
  assert.ok(env.memFs.has('briefings-v1/2026-11-26.json'));
  assert.ok(env.memFs.has('briefings-v1/2026-11-26.md'));
  assert.deepEqual(plain(await svc.listDates()), ['2026-11-26']);
  const reread = await svc.readReport('2026-11-26');
  assert.equal(reread.date, '2026-11-26');

  // 2. Gemini AI mode: key passed via header x-goog-api-key, NOT query param
  await svc.updateConfig({ geminiApiKey: 'AIzaGeminiTestKey7777', topics: ['macro_rate'] });
  const aiReport = await svc.generate({ trigger: 'AI 測試' });
  assert.equal(aiReport.summaryMode, 'Gemini AI 濃縮摘要');
  assert.deepEqual(plain(aiReport.topicLabels), ['總經 / 利率 / 匯率']);
  assert.deepEqual(plain(aiReport.summary), [
    '美股走揚帶動台積電表現（Yahoo 奇摩股市）',
    '聯準會釋出利率平穩訊號（CNBC 財經）'
  ]);
  assert.ok(geminiReqSeen);
  assert.equal(geminiReqSeen.url.includes('key='), false);
  assert.equal(geminiReqSeen.headers['x-goog-api-key'], 'AIzaGeminiTestKey7777');

  // 3. Gemini failure gracefully falls back to rule summary
  geminiFail = true;
  const fallbackReport = await svc.generate({ trigger: '降級測試' });
  assert.equal(fallbackReport.summaryMode, '規則式重點彙整（免 Key）');
  assert.ok(fallbackReport.summary.length >= 1);
});
