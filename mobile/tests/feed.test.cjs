'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createEnv } = require('./harness.cjs');

/** 跨 vm realm 轉為純 JSON 結構供 deepStrictEqual 比較 */
const plain = v => JSON.parse(JSON.stringify(v));

/** 建立可對帳的 17 級假集保列 */
function makeTdccLines(stamp, code, { baseShares = 1000, baseHolders = 10, adjShares = 0, adjHolders = 0, breakDen = false } = {}) {
  const lines = [];
  let sumShares = 0;
  let sumHolders = 0;
  for (let lv = 1; lv <= 15; lv++) {
    const shares = baseShares * lv;
    const holders = baseHolders + lv;
    sumShares += shares;
    sumHolders += holders;
    lines.push(`${stamp},${code},${lv},${holders},${shares},1.00`);
  }
  lines.push(`${stamp},${code},16,${adjHolders},${adjShares},0.00`);
  const den = breakDen ? sumShares - adjShares + 999 : sumShares - adjShares;
  lines.push(`${stamp},${code},17,${sumHolders},${den},100.00`);
  return lines;
}

function buildTdccCsv(stamp, specs, { bom = false } = {}) {
  const header = '資料日期,證券代號,持股分級,人數,股數,占集保庫存數比例%';
  const body = [header];
  for (const s of specs) {
    body.push(...makeTdccLines(stamp, s.code, s));
  }
  const text = body.join('\r\n') + '\r\n';
  return (bom ? '\uFEFF' : '') + text;
}

function makeTwseMonth(month, rows) {
  return {
    stat: 'OK',
    date: month.replace('-', '') + '01',
    fields: ['日期', '成交股數', '成交金額', '成交筆數', '發行量加權股價指數', '漲跌點數'],
    data: rows
  };
}

test('feed: calendarUrl 與 TDCC_URL', () => {
  const env = createEnv({ files: ['services/feed.js'] });
  const { calendarUrl, TDCC_URL } = env.CM.feed;
  assert.equal(TDCC_URL, 'https://opendata.tdcc.com.tw/getOD.ashx?id=1-5');
  assert.equal(
    calendarUrl('2026-11'),
    'https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date=20261101&response=json'
  );
});

test('feed: parseWeek 驗證 rows、bands、adjustments、extraRows 與 BOM 原始位元組 sha256', async () => {
  const env = createEnv({ files: ['services/feed.js'] });
  const { parseWeek } = env.CM.feed;

  const universe = ['2330', '2404', '2317', '2454'];
  const csv = buildTdccCsv(
    '20261120',
    [
      { code: '2330', baseShares: 1000, baseHolders: 10 },
      { code: '2404', baseShares: 2000, baseHolders: 5, adjShares: 500, adjHolders: 2 },
      { code: '2317', baseShares: 500, baseHolders: 20 },
      { code: '2454', baseShares: 800, baseHolders: 8 },
      { code: '0050', baseShares: 300, baseHolders: 3, adjShares: 100, adjHolders: 1 },
      { code: '9999', baseShares: 100, baseHolders: 1 } // 非母體且非 ETF，應忽略
    ],
    { bom: true }
  );
  const rawBytes = new TextEncoder().encode(csv);
  const expectedSha = crypto.createHash('sha256').update(rawBytes).digest('hex');

  const week = await parseWeek(rawBytes, universe, '2026-11-26T10:00:00.000+08:00');
  assert.equal(week.day, '2026-11-20');
  assert.equal(week.quality.sha256, expectedSha);
  assert.equal(week.quality.valid, 4);
  assert.equal(week.quality.invalid, 0);
  assert.equal(week.quality.universe, 4);
  assert.equal(week.quality.publication, null);
  assert.equal(week.quality.validation, '1–17 級日期、股數、戶數與固定母體覆蓋驗證通過');

  // 與 Python serve_local.parse_week 對同一輸入的對照結果完全一致
  assert.deepEqual(plain(week.rows['2330']), [120000, 270, 65000, 54000, 42000, 15000, 115, 94, 72, 25]);
  assert.deepEqual(plain(week.rows['2404']), [239500, 195, 130000, 108000, 84000, 30000, 90, 74, 57, 20]);
  assert.deepEqual(plain(week.extraRows['0050']), [35900, 165, 19500, 16200, 12600, 4500, 80, 66, 51, 18]);
  assert.deepEqual(plain(week.adjustments['2404']), [500, 2]);
  assert.deepEqual(plain(week.adjustments['0050']), [100, 1]);
  assert.equal(week.extraRows['9999'], undefined);
  assert.deepEqual(plain(week.issues), {});
});

test('feed: parseWeek 覆蓋率不足 95% 與格式錯誤', async () => {
  const env = createEnv({ files: ['services/feed.js'] });
  const { parseWeek } = env.CM.feed;
  const universe = ['2330', '2404', '2317', '2454'];

  // 1 檔未對帳 -> 3/4 < ceil(3.8)=4
  const badCsv = buildTdccCsv('20261120', [
    { code: '2330' },
    { code: '2404', breakDen: true },
    { code: '2317' },
    { code: '2454' }
  ]);
  await assert.rejects(
    () => parseWeek(new TextEncoder().encode(badCsv), universe, '2026-11-26T10:00:00+08:00'),
    err => err instanceof env.CM.ValueError && /集保有效股票覆蓋不足 95%（3\/4）/.test(err.message)
  );

  // 週末日期（2026-11-21 週六）
  const weekendCsv = buildTdccCsv('20261121', universe.map(code => ({ code })));
  await assert.rejects(
    () => parseWeek(new TextEncoder().encode(weekendCsv), universe, '2026-11-26T10:00:00+08:00'),
    err => err instanceof env.CM.ValueError && err.message === '未來或非營業日的統計日期'
  );
});

test('feed: parseMonth 解析民國日期與錯誤檢核', async () => {
  const env = createEnv({ files: ['services/feed.js'] });
  const { parseMonth } = env.CM.feed;

  const payload = makeTwseMonth('2026-11', [
    ['115/11/02', '4,123,456,789', '100', '10', '22000', '10'],
    ['115/11/03', '5,000,000,000', '100', '10', '22100', '100']
  ]);
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const expectedSha = crypto.createHash('sha256').update(bytes).digest('hex');

  const rec = await parseMonth(bytes, '2026-11', '2026-11-26T10:00:00.000+08:00', ['2026-11-02']);
  assert.equal(rec.month, '2026-11');
  assert.deepEqual(plain(rec.days), ['2026-11-02', '2026-11-03']);
  assert.equal(rec.sha256, expectedSha);

  // 缺少已知交易日
  await assert.rejects(
    () => parseMonth(bytes, '2026-11', '2026-11-26T10:00:00+08:00', ['2026-11-02', '2026-11-04']),
    err => err instanceof env.CM.ValueError && err.message === 'TWSE 日曆日期倒退、錯月或缺少已知交易日'
  );
});

test('feed: LocalFeedService 載入快取、更新、同期補齊 ETF、離線與單飛', async () => {
  const universe = ['2330', '2404', '2317', '2454'];
  const csvNew = buildTdccCsv('20261120', [
    ...universe.map(code => ({ code })),
    { code: '0050', baseShares: 200, baseHolders: 2 }
  ]);
  const twseNov = makeTwseMonth('2026-11', [
    ['115/11/02', '4,000,000', '1', '1', '22000', '1'],
    ['115/11/03', '4,100,000', '1', '1', '22010', '10']
  ]);

  let tdccHits = 0;
  const env = createEnv({
    files: ['services/feed.js'],
    now: '2026-11-26T10:00:00+08:00',
    base: {
      universe,
      sessions: ['2026-11-02'],
      hashes: { '2026-11-13': 'oldhash' }
    },
    routes: [
      {
        match: 'https://opendata.tdcc.com.tw/getOD.ashx?id=1-5',
        body: () => {
          tdccHits++;
          return csvNew;
        }
      },
      {
        match: 'https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK',
        body: twseNov
      }
    ]
  });

  // 預先放入一筆損毀快取檔
  env.memFs.set('tdcc-local-v1/official/2026-11-06.json', { data: '{broken', mtime: Date.now() });

  const svc = new env.CM.feed.LocalFeedService('tdcc-local-v1', env.CM.base);
  await svc.init();
  assert.deepEqual(plain(svc.notes), ['2026-11-06 本機快取損毀略過']);
  assert.equal(await svc.latest(), '2026-11-13');

  // 併發呼叫 update() 應為單飛
  const [res1, res2] = await Promise.all([svc.update(), svc.update()]);
  assert.equal(tdccHits, 1);
  assert.equal(res1.status, '有新資料');
  assert.equal(res2.status, '有新資料');
  assert.ok(res1.weeks['2026-11-20']);
  assert.ok(res1.months['2026-11']);
  assert.equal(await svc.latest(), '2026-11-20');

  // 再更新一次應回「已是最新」
  const resSame = await svc.update();
  assert.equal(resSame.status, '已是最新');
  assert.deepEqual(plain(resSame.weeks), {});

  // 模擬舊快取缺少 extraRows -> 應就地補齊
  delete svc.weeks['2026-11-20'].extraRows;
  const resBackfill = await svc.update();
  assert.equal(resBackfill.status, '有新資料');
  assert.match(resBackfill.message, /已補齊 ETF 資料/);
  assert.ok(svc.weeks['2026-11-20'].extraRows['0050']);

  // 離線錯誤映射
  env.routes.length = 0;
  env.routes.push(
    { match: 'https://opendata.tdcc.com.tw/', error: 'request timed out' },
    { match: 'https://www.twse.com.tw/', error: 'network unreachable' }
  );
  const resOffline = await svc.update();
  assert.equal(resOffline.status, '離線');
  assert.match(resOffline.message, /集保：連線失敗 逾時/);
  assert.match(resOffline.message, /交易日曆：連線失敗/);

  // HTTP 503 映射為「官方 HTTP 503」
  env.routes.length = 0;
  env.routes.push(
    { match: 'https://opendata.tdcc.com.tw/', status: 503, body: 'busy' },
    { match: 'https://www.twse.com.tw/', status: 500, body: 'err' }
  );
  const resHttpErr = await svc.update();
  assert.equal(resHttpErr.status, '失敗');
  assert.match(resHttpErr.message, /集保：官方 HTTP 503/);
  assert.match(resHttpErr.message, /交易日曆：官方 HTTP 500/);
});

test('feed: DailyService 計算日 K 換手率、12h 快取與集保股數備援', async () => {
  let priceHits = 0;
  const env = createEnv({
    files: ['services/feed.js'],
    now: '2026-11-26T10:00:00+08:00',
    routes: [
      {
        match: url => url.includes('dataset=TaiwanStockPrice'),
        body: () => {
          priceHits++;
          return {
            status: 200,
            data: [
              { date: '2026-11-24', open: 100, max: 105, min: 99, close: 104, Trading_Volume: 100000 },
              { date: '2026-11-25', open: 104, max: 103, min: 105, close: 104, Trading_Volume: 100000 }, // h < l 應略過
              { date: '2026-11-26', open: 104, max: 108, min: 103, close: 107, Trading_Volume: 200000 }
            ]
          };
        }
      },
      {
        match: url => url.includes('dataset=TaiwanStockShareholding'),
        body: {
          status: 200,
          data: [
            { date: '2026-11-24', NumberOfSharesIssued: 10000000, stock_name: '台積電' }
          ]
        }
      }
    ]
  });

  const feedSvc = new env.CM.feed.LocalFeedService('tdcc-local-v1', env.CM.base);
  const dailySvc = new env.CM.feed.DailyService('daily-cache-v1', feedSvc);
  await dailySvc.init();

  const d1 = await dailySvc.getDaily('2330');
  assert.equal(d1.code, '2330');
  assert.equal(d1.name, '台積電');
  assert.equal(d1.bars.length, 2);
  assert.deepEqual(plain(d1.bars[0]), ['2026-11-24', 100, 105, 99, 104, 100000, 10000000, 0.01, '', false]);
  assert.deepEqual(plain(d1.bars[1]), ['2026-11-26', 104, 108, 103, 107, 200000, 10000000, 0.02, '', false]);
  assert.equal(priceHits, 1);

  // 12 小時內命中快取
  env.advance(6 * 3600 * 1000);
  await dailySvc.getDaily('2330');
  assert.equal(priceHits, 1);

  // 超過 12 小時重新抓取
  env.advance(7 * 3600 * 1000);
  await dailySvc.getDaily('2330');
  assert.equal(priceHits, 2);

  // 無效代號
  await assert.rejects(
    () => dailySvc.getDaily('NVDA'),
    err => err instanceof env.CM.ValueError && err.message === '請輸入有效四碼股票或 ETF 代號'
  );
});
