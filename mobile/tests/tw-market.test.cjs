'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./harness.cjs');

/** 跨 vm realm 轉為純 JSON 結構供 deepStrictEqual 比較 */
const plain = v => JSON.parse(JSON.stringify(v));

test('tw-market: 台股個股詳情（日K張數四捨五入、三大法人彙總、融資融券與 4h 快取）', async () => {
  let priceHits = 0;
  const env = createEnv({
    files: ['services/tw-market.js'],
    now: '2026-11-26T10:00:00+08:00',
    routes: [
      {
        match: url => url.includes('dataset=TaiwanStockPrice'),
        body: () => {
          priceHits++;
          return {
            status: 200,
            data: [
              // 2500/1000=2.5 -> pyRound=2, 3500/1000=3.5 -> pyRound=4
              { date: '2026-11-24', open: 100, max: 105, min: 99, close: 104, Trading_Volume: 2500 },
              { date: '2026-11-25', open: 0, max: 105, min: 99, close: 104, Trading_Volume: 1000 }, // 無效略過
              { date: '2026-11-26', open: 104, max: 108, min: 103, close: 107, Trading_Volume: 3500 }
            ]
          };
        }
      },
      {
        match: url => url.includes('dataset=TaiwanStockInstitutionalInvestorsBuySell'),
        body: {
          status: 200,
          data: [
            { date: '2026-11-26', name: 'Foreign_Investor', buy: 10500, sell: 5000 }, // 5.5 -> 6
            { date: '2026-11-26', name: 'Foreign_Dealer_Self', buy: 2500, sell: 0 }, // 2.5 -> 2 => Foreign=8
            { date: '2026-11-26', name: 'Investment_Trust', buy: 1000, sell: 3500 }, // -2.5 -> -2
            { date: '2026-11-26', name: 'Dealer_self', buy: 500, sell: 1000 }, // -0.5 -> 0
            { date: '2026-11-24', name: 'Dealer_Hedging', buy: 3000, sell: 1000 } // 2
          ]
        }
      },
      {
        match: url => url.includes('dataset=TaiwanStockMarginPurchaseShortSale'),
        body: {
          status: 200,
          data: [
            {
              date: '2026-11-24',
              MarginPurchaseTodayBalance: 1200,
              MarginPurchaseYesterdayBalance: 1150,
              ShortSaleTodayBalance: 80,
              ShortSaleYesterdayBalance: 90
            }
          ]
        }
      }
    ]
  });

  const svc = new env.CM.twMarket.TwMarketService('tw-detail-v1');
  await svc.init();

  const detail = await svc.getDetail(' 2330 ');
  assert.equal(detail.code, '2330');
  assert.equal(detail.source, 'FinMind (TaiwanStockPrice / Institutional / Margin)');
  assert.deepEqual(plain(detail.bars), [
    ['2026-11-24', 100, 105, 99, 104, 2],
    ['2026-11-26', 104, 108, 103, 107, 4]
  ]);
  assert.deepEqual(plain(detail.inst), [
    ['2026-11-24', 0, 0, 2],
    ['2026-11-26', 8, -2, 0]
  ]);
  assert.deepEqual(plain(detail.margin), [['2026-11-24', 1200, 50, 80, -10]]);
  assert.equal(priceHits, 1);

  // 4 小時內命中快取
  env.advance(2 * 3600 * 1000);
  await svc.getDetail('2330');
  assert.equal(priceHits, 1);

  // forceRefresh 強制重抓
  await svc.getDetail('2330', true);
  assert.equal(priceHits, 2);

  // 超過 4 小時過期重抓
  env.advance(5 * 3600 * 1000);
  await svc.getDetail('2330');
  assert.equal(priceHits, 3);
});

test('tw-market: 美股 Yahoo Finance 日線（台北時區日期與四捨五入）', async () => {
  const env = createEnv({
    files: ['services/tw-market.js'],
    now: '2026-11-26T10:00:00+08:00',
    routes: [
      {
        match: 'https://query1.finance.yahoo.com/v8/finance/chart/BRK.B',
        body: {
          chart: {
            result: [
              {
                // 2026-11-25T16:30:00Z = 2026-11-26T00:30:00+08:00（驗證使用台北時區）
                timestamp: [1795624200, 1795710600],
                indicators: {
                  quote: [
                    {
                      open: [450.125, null],
                      high: [455.555, 460],
                      low: [449.005, 450],
                      close: [452.235, 455],
                      volume: [1234567, 100]
                    }
                  ]
                }
              }
            ]
          }
        }
      }
    ]
  });

  const svc = new env.CM.twMarket.TwMarketService('tw-detail-v1');
  const res = await svc.getDetail('brk.b');
  assert.equal(res.code, 'BRK.B');
  assert.equal(res.source, 'Yahoo Finance (US Daily OHLCV)');
  assert.deepEqual(plain(res.inst), []);
  assert.deepEqual(plain(res.margin), []);
  assert.deepEqual(plain(res.bars), [['2026-11-26', 450.12, 455.56, 449, 452.24, 1234567]]);
});

test('tw-market: 法人／融資失敗降級為空陣列、錯誤處理與無效代號', async () => {
  const env = createEnv({
    files: ['services/tw-market.js'],
    now: '2026-11-26T10:00:00+08:00',
    routes: [
      {
        match: url => url.includes('dataset=TaiwanStockPrice') && url.includes('data_id=2404'),
        body: {
          status: 200,
          data: [{ date: '2026-11-26', open: 10, max: 12, min: 9, close: 11, Trading_Volume: 5000 }]
        }
      },
      {
        match: url => url.includes('dataset=TaiwanStockInstitutionalInvestorsBuySell'),
        status: 502,
        body: 'bad gateway'
      },
      {
        match: url => url.includes('dataset=TaiwanStockMarginPurchaseShortSale'),
        error: 'connection reset'
      },
      {
        match: url => url.includes('data_id=2317'),
        status: 503,
        body: 'unavailable'
      }
    ]
  });

  const svc = new env.CM.twMarket.TwMarketService('tw-detail-v1');
  const res = await svc.getDetail('2404');
  assert.equal(res.bars.length, 1);
  assert.deepEqual(plain(res.inst), []);
  assert.deepEqual(plain(res.margin), []);

  // 主價量上游 HTTP 503
  await assert.rejects(
    () => svc.getDetail('2317'),
    err => err instanceof env.CM.ValueError && err.message === '上游資料 HTTP 503'
  );

  // 無效代號
  await assert.rejects(
    () => svc.getDetail('../bad'),
    err => err instanceof env.CM.ValueError && err.message === '請輸入有效台股或美股代號（如 2330、2404、0050、NVDA）'
  );
});
