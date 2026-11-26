'use strict';

/**
 * 端到端整合測試：同時載入全部 5 個行動版服務、三副本儲存 (MobileLocalStore) 與 /api/* 路由器，
 * 驗證無縫串接、錯誤碼映射、金鑰隔離與副本損毀自動復原。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./harness.cjs');

const ALL_FILES = [
  'platform/local-store.js',
  'services/feed.js',
  'services/tw-market.js',
  'services/news-briefing.js',
  'services/us-market.js',
  'services/watchlist.js',
  'platform/api-router.js'
];

function makeBase() {
  return {
    stocks: { '2330': ['台積電', 'TWSE'], '2404': ['漢唐', 'TWSE'] },
    series: {
      '2026-11-13': { '2330': [1000000, 1000, 800000, 750000, 700000, 650000, 100, 80, 60, 40] }
    },
    universe: ['2330', '2404'],
    sessions: ['2026-11-13', '2026-11-16'],
    hashes: { '2026-11-13': 'abc123' },
    usUniverse: [['NVDA', 'NVIDIA', 'Information Technology'], ['AAPL', 'Apple', 'Information Technology']]
  };
}

function fakeYahooChart(price = 120.5, prev = 118.0) {
  return {
    chart: {
      result: [
        {
          meta: {
            currency: 'USD',
            gmtoffset: -18000,
            regularMarketPrice: price,
            regularMarketTime: 1795640400,
            previousClose: prev
          },
          timestamp: [1795554000, 1795640400],
          indicators: {
            quote: [{ open: [prev, prev + 1], high: [prev + 2, price + 1], low: [prev - 1, prev], close: [prev, price], volume: [1000000, 1200000] }]
          }
        }
      ]
    }
  };
}

test('MobileApiRouter 整合所有 /api/* 路由與錯誤映射', async () => {
  const env = createEnv({
    files: ALL_FILES,
    base: makeBase(),
    now: '2026-11-26T10:30:00+08:00',
    routes: [
      { match: 'https://query1.finance.yahoo.com/', body: () => fakeYahooChart(125.5, 120.0) },
      { match: 'https://tw.stock.yahoo.com/rss', body: '<rss><channel><item><title>台積電法說報喜 外資買超半導體股</title><link>https://tw.stock.yahoo.com/news/1</link><pubDate>Thu, 26 Nov 2026 01:00:00 +0000</pubDate></item></channel></rss>' },
      { match: 'https://feeds.feedburner.com/', body: '<rss><channel></channel></rss>' },
      { match: 'https://search.cnbc.com/', body: '<rss><channel></channel></rss>' }
    ]
  });

  const router = new env.CM.router.MobileApiRouter(env.CM.base);
  router.installFetch(env.sandbox);

  // 1. /api/health & /api/official/read
  const h = await (await env.sandbox.fetch('/api/health')).json();
  assert.equal(h.status, 'ok');
  assert.equal(h.platform, 'android');
  assert.equal(h.latest, '2026-11-13');

  const off = await (await env.sandbox.fetch('/api/official/read')).json();
  assert.equal(Object.keys(off.weeks).length, 0);

  // 2. /api/watchlist CRUD + 錯誤碼 400
  const wl0 = await (await env.sandbox.fetch('/api/watchlist')).json();
  assert.equal(wl0.config.folders.length, 1);

  const created = await (
    await env.sandbox.fetch('/api/watchlist/folder/create', {
      method: 'POST',
      body: JSON.stringify({ name: '手機追蹤' })
    })
  ).json();
  assert.ok(created.createdFolderId);

  const badAdd = await env.sandbox.fetch('/api/watchlist/stock/add', {
    method: 'POST',
    body: JSON.stringify({ folderId: created.createdFolderId, code: '!!!INVALID' })
  });
  assert.equal(badAdd.status, 400);

  const okAdd = await env.sandbox.fetch('/api/watchlist/stock/add', {
    method: 'POST',
    body: JSON.stringify({ folderId: created.createdFolderId, code: 'NVDA' })
  });
  assert.equal(okAdd.status, 200);

  // 3. /api/briefing/config 寫入 Key 至 Keystore 金庫，而非一般檔案
  const cfgResp = await env.sandbox.fetch('/api/briefing/config', {
    method: 'POST',
    body: JSON.stringify({ enabled: true, time: '09:30', geminiApiKey: 'AIzaSyTestSecretKey1234567890' })
  });
  assert.equal(cfgResp.status, 200);
  const cfgData = await cfgResp.json();
  assert.equal(cfgData.config.hasGeminiKey, true);
  assert.equal(env.vault.get('geminiApiKey'), 'AIzaSyTestSecretKey1234567890');
  for (const [p, f] of env.memFs) {
    assert.ok(!f.data.includes('AIzaSyTestSecretKey1234567890'), `金鑰不應明文出現在檔案 ${p}`);
  }
  assert.equal(env.notifications.get(1001).hour, 9);
  assert.equal(env.notifications.get(1001).minute, 30);

  // 4. 404 與 400 參數驗證
  const notFound = await env.sandbox.fetch('/api/unknown');
  assert.equal(notFound.status, 404);

  const badDaily = await env.sandbox.fetch('/api/daily?code=BAD!');
  assert.equal(badDaily.status, 400);
});

test('MobileLocalStore 三副本原子儲存與損毀自動復原', async () => {
  const env = createEnv({ files: ['platform/local-store.js'] });
  const store1 = new env.CM.localStore.MobileLocalStore('store-v1', '0.6.0-android');
  await store1.init();
  store1.installGlobal(env.sandbox);

  const r0 = env.sandbox.desktopStore.read('settings');
  assert.equal(r0.ok, true);
  assert.equal(r0.value, null);

  env.sandbox.desktopStore.save('settings', { format: 'chip-screener-config-v1', v: 1 });
  env.sandbox.desktopStore.save('settings', { format: 'chip-screener-config-v1', v: 2 });
  await store1.flush();

  // 模擬 current 副本損毀
  env.memFs.set('store-v1/settings.current.json', { data: '{corrupted', mtime: Date.now() });

  const store2 = new env.CM.localStore.MobileLocalStore('store-v1', '0.6.0-android');
  await store2.init();
  const recovered = store2.readSync('settings');
  assert.equal(recovered.ok, true);
  assert.equal(recovered.slot, 'mirror');
  assert.equal(recovered.damaged, true);
  assert.equal(recovered.value.v, 2);
});
