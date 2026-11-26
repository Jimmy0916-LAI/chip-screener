'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const { createEnv } = require('./harness.cjs');

const PYTHON_EXE = 'C:\\Users\\jerry\\AppData\\Local\\Programs\\Python\\Python310\\python.exe';

/** 為測試建立 CM.news 替身（以 CM.http 實作 httpGet 與 fetchYahooQuote） */
function attachNewsStub(CM) {
  CM.news = {
    async httpGet(url, timeoutSec = 12) {
      const res = await CM.http.getOk(url, { timeoutMs: timeoutSec * 1000 });
      return res.bytes;
    },
    async fetchYahooQuote(symbol) {
      const encoded = encodeURIComponent(symbol);
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=5d&interval=1d`;
      try {
        const bytes = await CM.news.httpGet(url, 10);
        const payload = JSON.parse(CM.util.utf8Decode(bytes));
        const res = payload.chart.result[0];
        const meta = res.meta || {};
        const price = Number(meta.regularMarketPrice);
        const prev = Number(meta.chartPreviousClose || price);
        const change = CM.util.pyRound(price - prev, 2);
        const changePct = prev ? CM.util.pyRound((change / prev) * 100, 2) : 0;
        return { price: CM.util.pyRound(price, 2), change, changePct, tradeTime: '2026-11-25 16:00' };
      } catch {
        return null;
      }
    }
  };
}

/** 建立合成 Yahoo v8 Chart 回應 */
function makeYahooChartPayload({
  symbol = 'NVDA',
  bars = 260,
  startPrice = 100,
  step = 0.25,
  gmtoffset = -18000,
  longName = 'NVIDIA Corporation',
  exchange = 'NasdaqGS',
  currency = 'USD',
  extraMeta = {}
} = {}) {
  const ts = [];
  const open = [];
  const high = [];
  const low = [];
  const close = [];
  const volume = [];
  // 2025-01-02 14:30:00 UTC (09:30 EST)
  let baseTs = Math.floor(Date.parse('2025-01-02T14:30:00Z') / 1000);
  let p = startPrice;
  for (let i = 0; i < bars; i++) {
    ts.push(baseTs + i * 86400);
    const wave = Math.sin(i * 0.2) * 1.1;
    const c = Math.max(5, Number((p + step + wave).toFixed(2)));
    const o = Number((c - 0.5).toFixed(2));
    const h = Number((Math.max(o, c) + 0.6).toFixed(2));
    const l = Number((Math.min(o, c) - 0.8).toFixed(2));
    open.push(o);
    high.push(h);
    low.push(l);
    close.push(c);
    volume.push(1500000 + i * 2000);
    p = c;
  }
  return {
    chart: {
      result: [
        {
          meta: {
            symbol,
            longName,
            fullExchangeName: exchange,
            currency,
            gmtoffset,
            regularMarketPrice: close[close.length - 1],
            chartPreviousClose: close[close.length - 2] || close[0],
            ...extraMeta
          },
          timestamp: ts,
          indicators: {
            quote: [{ open, high, low, close, volume }]
          }
        }
      ],
      error: null
    }
  };
}

function makeFakeUniverse(count = 420) {
  const list = [
    ['MMM', '3M', '工業'],
    ['NVDA', 'NVIDIA 輝達', '資訊科技'],
    ['AAPL', 'Apple 蘋果', '資訊科技'],
    ['BRK-B', '波克夏海瑟威 B', '金融']
  ];
  for (let i = list.length; i < count; i++) {
    const code = `T${String(i).padStart(3, '0')}`;
    list.push([code, `Test Corp ${i}`, i % 2 === 0 ? '資訊科技' : '金融']);
  }
  return list;
}

const plain = v => JSON.parse(JSON.stringify(v));

function assertDeepApproxEqual(actual, expected, tol = 1e-9, path = '$', roundingTies = []) {
  if (typeof expected === 'number' && typeof actual === 'number') {
    const diff = Math.abs(actual - expected);
    if (diff <= tol) return;
    // 允許 CM.util.pyRound（十進位 .5 取偶）與 Python IEEE-754 round 在恰為 .5 邊界的 1 單位差異
    if (Math.abs(diff - 0.01) < 1e-9 || Math.abs(diff - 0.001) < 1e-9 || Math.abs(diff - 0.0001) < 1e-9) {
      roundingTies.push({ path, actual, expected });
      return;
    }
    assert.ok(false, `${path}: expected ${expected}, got ${actual} (diff ${diff})`);
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${path}: expected array`);
    assert.equal(actual.length, expected.length, `${path}: length mismatch`);
    for (let i = 0; i < expected.length; i++) {
      assertDeepApproxEqual(actual[i], expected[i], tol, `${path}[${i}]`, roundingTies);
    }
    return;
  }
  if (expected && typeof expected === 'object') {
    assert.ok(actual && typeof actual === 'object', `${path}: expected object`);
    const expKeys = Object.keys(expected).sort();
    const actKeys = Object.keys(actual).sort();
    assert.deepEqual(actKeys, expKeys, `${path}: keys mismatch`);
    for (const k of expKeys) {
      assertDeepApproxEqual(actual[k], expected[k], tol, `${path}.${k}`, roundingTies);
    }
    return;
  }
  assert.equal(actual, expected, `${path}: mismatch`);
}

test('exports and lazy US_UNIVERSE_MAP getter', () => {
  // 先不給 usUniverse，載入腳本後才設定 CM.base，驗證惰性 getter
  const env = createEnv({
    files: ['services/us-market.js'],
    base: { stocks: {}, series: {}, universe: [], sessions: [], hashes: {}, usUniverse: [] }
  });
  const { CM } = env;

  assert.equal(typeof CM.usMarket.UsMarketService, 'function');
  assert.equal(typeof CM.usMarket.analyzeUsBars, 'function');
  assert.equal(typeof CM.usMarket.computeSma, 'function');
  assert.equal(typeof CM.usMarket.computeEma, 'function');
  assert.equal(typeof CM.usMarket.computeRsiSeries, 'function');
  assert.equal(typeof CM.usMarket.computeMacdSeries, 'function');
  assert.equal(typeof CM.usMarket.loadSp500Universe, 'function');

  const desc = Object.getOwnPropertyDescriptor(CM.usMarket, 'US_UNIVERSE_MAP');
  assert.equal(typeof desc.get, 'function', 'US_UNIVERSE_MAP must be a lazy getter');

  // 在存取 US_UNIVERSE_MAP 前才填入 CM.base.usUniverse
  CM.base.usUniverse = makeFakeUniverse(410);
  const loaded = CM.usMarket.loadSp500Universe();
  assert.equal(loaded.length, 410);
  // 旗艦股應優先排列：AAPL 在 NVDA 之前，且兩者皆在 MMM 之前
  assert.equal(loaded[0][0], 'AAPL');
  assert.equal(loaded[1][0], 'NVDA');
  assert.equal(loaded[2][0], 'BRK-B');
  assert.equal(loaded[3][0], 'MMM');

  const uMap = CM.usMarket.US_UNIVERSE_MAP;
  assert.deepEqual(plain(uMap['NVDA']), ['NVIDIA 輝達', '資訊科技']);
  assert.deepEqual(plain(uMap['T050']), ['Test Corp 50', '資訊科技']);
});

test('loadSp500Universe falls back to 32 flagship stocks when usUniverse < 400', () => {
  const env = createEnv({
    files: ['services/us-market.js'],
    base: { stocks: {}, series: {}, universe: [], sessions: [], hashes: {}, usUniverse: [['AAPL', 'Apple', 'Tech']] }
  });
  const loaded = env.CM.usMarket.loadSp500Universe();
  assert.equal(loaded.length, 32);
  assert.equal(loaded[0][0], 'AAPL');
});

test('indicator math and analyzeUsBars match Python us_market.py on 260-bar series', { skip: !fs.existsSync(PYTHON_EXE) }, () => {
  const pyCode = `
import json, math, sys
from datetime import date, timedelta
sys.path.insert(0, r'D:\\project\\20261125\\chip-screener-0.6.0-b05.1\\scripts')
from providers import us_market as um

def gen_bars(n, mode):
    bars = []
    start = date(2025, 1, 2)
    price = 100.0
    for i in range(n):
        d = (start + timedelta(days=i)).isoformat()
        if mode == 'smart':
            drift = 0.25 if i < n - 30 else 0.75
            wave = math.sin(i * 0.25) * 1.2
            c = round(max(10.0, price + drift + wave), 2)
            o = round(c - 0.6, 2)
            h = round(c + 0.2, 2)
            l = round(min(o, c) - 1.1, 2)
            vol = int(1_000_000 + (i * 4000) + (600_000 if c > price else -200_000))
        elif mode == 'dip':
            if i < 180:
                price = 100.0 + i * 0.45 + math.sin(i * 0.2) * 1.5
            else:
                price = 181.0 - (i - 180) * 0.72 + math.sin(i * 0.3) * 0.8
            c = round(max(20.0, price), 2)
            o = round(c + 0.9, 2)
            h = round(o + 0.4, 2)
            l = round(c - (2.8 if i == n - 1 else 0.7), 2)
            vol = int(1_200_000 + (i % 7) * 50_000)
        else:
            c = round(100.0 + math.sin(i * 0.18) * 6.0 + math.cos(i * 0.07) * 2.5, 2)
            o = round(c - math.sin(i * 0.4) * 0.8, 2)
            h = round(max(o, c) + 0.9, 2)
            l = round(min(o, c) - 0.9, 2)
            vol = int(800_000 + (i % 11) * 35_000)
        bars.append([d, o, h, l, c, vol])
        price = c
    return bars

out = {}
for mode in ('smart', 'dip', 'osc'):
    bars = gen_bars(260, mode)
    closes = [b[4] for b in bars]
    out[mode] = {
        'bars': bars,
        'sma5': um.compute_sma(closes, 5),
        'sma200': um.compute_sma(closes, 200),
        'ema12': um.compute_ema(closes, 12),
        'rsi14': um.compute_rsi_series(closes, 14),
        'macd': um.compute_macd_series(closes),
        'tech': um.analyze_us_bars(bars),
    }
short_bars = gen_bars(10, 'osc')
out['short'] = {'bars': short_bars, 'tech': um.analyze_us_bars(short_bars)}
print(json.dumps(out, ensure_ascii=False))
`;
  const raw = execFileSync(PYTHON_EXE, ['-c', pyCode], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const pyOut = JSON.parse(raw);

  const env = createEnv({ files: ['services/us-market.js'] });
  const um = env.CM.usMarket;
  const ties = [];

  for (const mode of ['smart', 'dip', 'osc']) {
    const { bars } = pyOut[mode];
    const closes = bars.map(b => b[4]);
    assertDeepApproxEqual(um.computeSma(closes, 5), pyOut[mode].sma5, 1e-9, `${mode}.sma5`, ties);
    assertDeepApproxEqual(um.computeSma(closes, 200), pyOut[mode].sma200, 1e-9, `${mode}.sma200`, ties);
    assertDeepApproxEqual(um.computeEma(closes, 12), pyOut[mode].ema12, 1e-9, `${mode}.ema12`, ties);
    assertDeepApproxEqual(um.computeRsiSeries(closes, 14), pyOut[mode].rsi14, 1e-9, `${mode}.rsi14`, ties);
    assertDeepApproxEqual(um.computeMacdSeries(closes), pyOut[mode].macd, 1e-9, `${mode}.macd`, ties);
    assertDeepApproxEqual(um.analyzeUsBars(bars), pyOut[mode].tech, 1e-9, `${mode}.tech`, ties);
  }
  assertDeepApproxEqual(um.analyzeUsBars(pyOut.short.bars), pyOut.short.tech, 1e-9, 'short.tech', ties);
  // 驗證所有 1 ULP 差異皆發生在 CM.util.pyRound 取偶數（十進位 .5 邊界）
  for (const t of ties) {
    const diff = Math.abs(t.actual - t.expected);
    const digits = diff > 0.005 ? 2 : diff > 0.0005 ? 3 : 4;
    const scaled = Math.round(t.actual * 10 ** digits);
    assert.equal(scaled % 2, 0, `${t.path}: non-even tie difference ${JSON.stringify(t)}`);
  }

  // 確認雙模式確實有觸發 smartMoney 與 dipBuy
  assert.equal(pyOut.smart.tech.smartMoney.pass, true);
  assert.equal(pyOut.dip.tech.dipBuy.pass, true);
});

test('getDetail validates symbol, normalizes dot, caches with TTL, and retries 429', async () => {
  let nvdaHits = 0;
  let brkHits = 0;
  const env = createEnv({
    files: ['services/us-market.js'],
    now: '2026-11-26T10:00:00+08:00',
    routes: [
      {
        match: 'https://query1.finance.yahoo.com/v8/finance/chart/NVDA?range=2y&interval=1d',
        status: 200,
        body: () => {
          nvdaHits++;
          return makeYahooChartPayload({ symbol: 'NVDA', bars: 60 });
        }
      },
      {
        match: 'https://query1.finance.yahoo.com/v8/finance/chart/BRK-B?range=2y&interval=1d',
        body: () => {
          brkHits++;
          return makeYahooChartPayload({ symbol: 'BRK-B', bars: 40, longName: 'Berkshire Hathaway' });
        }
      },
      {
        match: 'https://query1.finance.yahoo.com/v8/finance/chart/EMPTY?range=2y&interval=1d',
        body: { chart: { result: null, error: { description: 'No data found' } } }
      },
      {
        match: 'https://query1.finance.yahoo.com/v8/finance/chart/BAD404?range=2y&interval=1d',
        status: 404,
        body: 'Not Found'
      }
    ]
  });
  attachNewsStub(env.CM);

  const svc = new env.CM.usMarket.UsMarketService('us-cache-v1');
  await svc.init();

  // 無效代號拋出 ValueError
  await assert.rejects(
    () => svc.getDetail('1234'),
    err => err instanceof env.CM.ValueError && err.message === '請輸入有效美股代號（如 NVDA、AAPL、TSM、SPY、BRK-B）'
  );
  await assert.rejects(() => svc.getDetail(''), err => err instanceof env.CM.ValueError);

  // 正常抓取並快取
  const d1 = await svc.getDetail(' nvda ');
  assert.equal(nvdaHits, 1);
  assert.equal(d1.code, 'NVDA');
  assert.equal(d1.name, 'NVIDIA 輝達');
  assert.equal(d1.sector, '資訊科技');
  assert.equal(d1.currency, 'USD');
  assert.equal(d1.source, 'Yahoo Finance (US 2Y Daily OHLCV)');
  assert.equal(d1.fetched, '2026-11-26 10:00:00 +08:00');
  assert.equal(d1.bars.length, 60);
  assert.equal(typeof d1.tech.cmf20, 'number');

  // 2 小時內應命中快取
  env.advance(3600 * 1000);
  const d2 = await svc.getDetail('NVDA');
  assert.equal(nvdaHits, 1);
  assert.equal(d2.code, 'NVDA');

  // forceRefresh 忽略快取
  await svc.getDetail('NVDA', true);
  assert.equal(nvdaHits, 2);

  // 超過 2 小時 TTL 後重新抓取
  env.advance(2 * 3600 * 1000 + 1000);
  await svc.getDetail('NVDA');
  assert.equal(nvdaHits, 3);

  // 點號轉連字號
  const brk = await svc.getDetail('brk.b');
  assert.equal(brk.code, 'BRK-B');
  assert.equal(brk.name, '波克夏海瑟威 B');
  assert.equal(brkHits, 1);

  // Yahoo 空結果拋 ValueError
  await assert.rejects(
    () => svc.getDetail('EMPTY'),
    err => err instanceof env.CM.ValueError && err.message === 'No data found'
  );

  // HTTP 404 不重試直接拋錯
  const before404 = env.requests.length;
  await assert.rejects(() => svc.getDetail('BAD404'), err => err.status === 404);
  assert.equal(env.requests.length - before404, 1);
});

test('background scan enforces max 6 concurrency, single-flight, lifecycle pause, and persists cache', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const env = createEnv({
    files: ['services/us-market.js'],
    now: '2026-11-26T10:00:00+08:00',
    routes: [
      {
        match: /^https:\/\/query1\.finance\.yahoo\.com\/v8\/finance\/chart\/[^?]+\?range=1y&interval=1d$/,
        body: async req => {
          inFlight++;
          if (inFlight > maxInFlight) maxInFlight = inFlight;
          await new Promise(r => setTimeout(r, 2));
          inFlight--;
          const m = req.url.match(/\/chart\/([^?]+)/);
          const sym = decodeURIComponent(m[1]);
          return makeYahooChartPayload({ symbol: sym, bars: 50, step: 0.3 });
        }
      }
    ]
  });
  attachNewsStub(env.CM);

  // 預設回退至 32 檔旗艦代表，足以觸發 >= 30 檔寫入快取且執行快速
  const svc = new env.CM.usMarket.UsMarketService('us-cache-v1');
  await svc.init();

  // 先放一個舊的 overview.json，確認掃描完成後會被刪除
  await env.CM.fs.writeJson('us-cache-v1/overview.json', { indices: [{}], universeCount: 32 });

  const started1 = await svc.startBackgroundScan();
  const started2 = await svc.startBackgroundScan();
  assert.equal(started1, true);
  assert.equal(started2, false, 'second startBackgroundScan must be single-flight');

  // 掃描進行中呼叫 getScreener 應回傳 scanning: true 與進度欄位
  const mid = await svc.getScreener(false);
  assert.equal(mid.universeTotal, 32);
  assert.equal(typeof mid.progress.done, 'number');
  assert.equal(mid.progress.total, 32);

  // 等待背景掃描完成
  await svc._scanPromise;
  assert.ok(maxInFlight <= 6, `concurrency exceeded 6: ${maxInFlight}`);
  assert.ok(maxInFlight >= 2, `expected concurrent requests, got maxInFlight=${maxInFlight}`);

  const saved = await env.CM.fs.readJson('us-cache-v1/sp500-screener.json');
  assert.ok(saved, 'sp500-screener.json should be persisted');
  assert.equal(saved.count, 32);
  assert.equal(saved.scanning, false);
  assert.deepEqual(plain(saved.progress), { done: 32, total: 32 });
  assert.equal(saved.counts.total, 32);
  assert.ok(Array.isArray(saved.sectors) && saved.sectors.length > 0);

  // 舊 overview.json 應已被清除
  const oldOv = await env.CM.fs.readJson('us-cache-v1/overview.json');
  assert.equal(oldOv, null);
});

test('getOverview returns 6 indices, syncs full screener cache, and ranks leaders/laggards', async () => {
  const fakeUniverse = makeFakeUniverse(410);
  const env = createEnv({
    files: ['services/us-market.js'],
    base: { stocks: {}, series: {}, universe: [], sessions: [], hashes: {}, usUniverse: fakeUniverse },
    now: '2026-11-26T10:00:00+08:00',
    routes: [
      {
        match: /^https:\/\/query1\.finance\.yahoo\.com\/v8\/finance\/chart\/%5E/,
        body: req => {
          const isVix = req.url.includes('%5EVIX');
          return makeYahooChartPayload({
            symbol: isVix ? '^VIX' : '^GSPC',
            bars: 5,
            startPrice: isVix ? 15 : 5800,
            step: isVix ? -0.3 : 12
          });
        }
      }
    ]
  });
  attachNewsStub(env.CM);

  // 預先寫入 410 檔完整的 sp500-screener.json 快取
  const rows = fakeUniverse.map(([code, name, sector], idx) => ({
    code,
    name,
    sector,
    change: Number(((idx - 200) * 0.1).toFixed(2)),
    changePct: Number(((idx - 200) * 0.05).toFixed(2)),
    price: 100 + idx,
    rsi14: 50,
    smartPass: idx < 20,
    dipPass: idx >= 390
  }));
  await env.CM.fs.writeJson('us-cache-v1/sp500-screener.json', {
    updatedAt: '2026-11-26 09:50:00 +08:00',
    count: rows.length,
    universeTotal: 410,
    scanning: false,
    progress: { done: 410, total: 410 },
    counts: { total: 410, smartMoney: 20, dipBuy: 20 },
    sectors: [
      { name: '資訊科技', count: 205, avgChangePct: 1.2, upCount: 150, downCount: 55 },
      { name: '金融', count: 205, avgChangePct: -0.4, upCount: 90, downCount: 115 }
    ],
    rows
  });

  const svc = new env.CM.usMarket.UsMarketService('us-cache-v1');
  await svc.init();

  const ov = await svc.getOverview(false);
  assert.equal(ov.indices.length, 6);
  assert.equal(ov.indices[0].symbol, '^GSPC');
  assert.equal(typeof ov.indices[0].price, 'number');
  assert.equal(ov.universeCount, 410);
  assert.equal(ov.scanning, false);
  assert.deepEqual(plain(ov.progress), { done: 410, total: 410 });
  assert.equal(ov.leaders.length, 5);
  assert.equal(ov.laggards.length, 5);
  assert.ok(ov.leaders[0].changePct > ov.leaders[4].changePct);
  assert.ok(ov.laggards[0].changePct < ov.laggards[4].changePct);
  assert.equal(ov.counts.smartMoney, 20);

  // overview.json 應已寫入長效快取（因 !scanning && rows.length >= 400）
  const cachedOv = await env.CM.fs.readJson('us-cache-v1/overview.json');
  assert.ok(cachedOv && cachedOv.universeCount === 410);

  // 10 分鐘內再次呼叫應直接命中快取，不新增 HTTP 請求
  const reqCount = env.requests.length;
  const ov2 = await svc.getOverview(false);
  assert.equal(env.requests.length, reqCount);
  assert.equal(ov2.universeCount, 410);

  // getScreener 也應直接命中 4 小時快取
  const scr = await svc.getScreener(false);
  assert.equal(scr.count, 410);
  assert.equal(scr.scanning, false);
  assert.deepEqual(plain(scr.progress), { done: 410, total: 410 });
});

test('background scan pauses while CM.lifecycle.active is false and resumes when active', async () => {
  let hits = 0;
  let waitCalls = 0;
  const env = createEnv({
    files: ['services/us-market.js'],
    now: '2026-11-26T10:00:00+08:00',
    routes: [
      {
        match: /^https:\/\/query1\.finance\.yahoo\.com\/v8\/finance\/chart\//,
        body: req => {
          hits++;
          const m = req.url.match(/\/chart\/([^?]+)/);
          return makeYahooChartPayload({ symbol: decodeURIComponent(m[1]), bars: 30 });
        }
      }
    ]
  });
  attachNewsStub(env.CM);

  // 覆寫 waitActive 以避免 1000ms 輪詢延遲，同時驗證背景暫停與恢復
  let resumeFn = null;
  env.CM.lifecycle.active = false;
  env.CM.lifecycle.waitActive = async () => {
    waitCalls++;
    if (!env.CM.lifecycle.active) {
      await new Promise(resolve => {
        resumeFn = resolve;
      });
    }
  };

  const svc = new env.CM.usMarket.UsMarketService('us-cache-v1');
  await svc.init();
  await svc.startBackgroundScan();
  await new Promise(r => setTimeout(r, 10));

  // 背景狀態下不應發送任何 Yahoo 請求
  assert.equal(hits, 0);
  assert.ok(waitCalls >= 1);

  // 恢復前景後應完成全部 32 檔掃描
  env.CM.lifecycle.active = true;
  if (resumeFn) resumeFn();
  await svc._scanPromise;
  assert.equal(hits, 32);
});
