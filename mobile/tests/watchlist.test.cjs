'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./harness.cjs');

/** 跨 vm realm 比對時轉為當前 realm 純物件 */
const plain = v => JSON.parse(JSON.stringify(v));

/** 建立固定 65 日台股 K 線（供短中均線與量價測試，並與 Python 對照） */
function makeTwBars(count = 65, baseClose = 100, step = 0.5, lastCloseOverride = null, lastVolOverride = null) {
  const bars = [];
  for (let i = 0; i < count; i++) {
    const dayNum = i + 1;
    const m = String(Math.floor((dayNum - 1) / 28) + 8).padStart(2, '0');
    const d = String(((dayNum - 1) % 28) + 1).padStart(2, '0');
    const c = i === count - 1 && lastCloseOverride !== null ? lastCloseOverride : Number((baseClose + i * step).toFixed(2));
    const v = i === count - 1 && lastVolOverride !== null ? lastVolOverride : 1000 + (i % 5) * 100;
    bars.push([`2026-${m}-${d}`, c - 0.5, c + 1, c - 1, c, v]);
  }
  return bars;
}

function setupEnv(opts = {}) {
  const env = createEnv({
    files: ['services/watchlist.js'],
    now: opts.now || '2026-11-26T10:30:00+08:00',
  });
  const { CM } = env;

  const quoteMap = opts.quoteMap || {
    '2330.TW': { price: 1050, prevClose: 1030, change: 20, changePct: 1.94, tradeTime: '2026-11-26 13:30', currency: 'TWD', yahooSymbol: '2330.TW' },
    '6488.TWO': { price: 420.5, prevClose: 415, change: 5.5, changePct: 1.33, tradeTime: '2026-11-26 13:30', currency: 'TWD', yahooSymbol: '6488.TWO' },
    NVDA: { price: 145.25, prevClose: 140.0, change: 5.25, changePct: 3.75, tradeTime: '2026-11-26 05:00', currency: 'USD', yahooSymbol: 'NVDA' },
  };
  const fetchedQuoteSymbols = [];

  CM.news = {
    async fetchYahooQuote(symbol) {
      fetchedQuoteSymbols.push(symbol);
      return quoteMap[symbol] || null;
    },
    async httpGet() {
      return new Uint8Array();
    },
  };

  CM.usMarket = {
    US_UNIVERSE_MAP: {
      NVDA: ['NVIDIA 輝達', '資訊科技'],
      AAPL: ['Apple 蘋果', '資訊科技'],
    },
    UsMarketService: class StubUsMarketService {
      constructor(cacheDir) {
        this.cacheDir = cacheDir;
      }
      async init() {}
      async getDetail(code) {
        if (code === 'BADUS') throw new Error('查無 BADUS 美股資料');
        return {
          code,
          name: code === 'NVDA' ? 'NVIDIA 輝達' : code,
          tech: {
            price: 145.25,
            prevClose: 140.0,
            change: 5.25,
            changePct: 3.75,
            tradeDate: '2026-11-25',
            belowMa5: true,
            belowMa10: false,
            shortMa: { ma5: 146, ma10: 142, bias5Pct: -0.51, bias10Pct: 2.29, status: '低於 5日線、守 10日線', tone: 'neutral' },
            midMa: { ma20: 138, ma60: 130, ma200: 115, status: '站穩月線與季線', tone: 'up' },
            rsi: { value: 58.2, status: '偏多 (58.2)', tone: 'up' },
            macd: { dif: 2.1, dea: 1.5, hist: 0.6, status: '多頭格局', tone: 'up' },
            volume: { vol: 50000000, mv5: 45000000, volRatio: 1.11, status: '量能溫和 (1.11x)', tone: 'neutral' },
            range52w: { high: 152, low: 80, posPct: 90.6, fromHighPct: -4.44, status: '高檔區間', tone: 'up' },
            overall: { label: '美股多頭整理', tone: 'up', summary: '趨勢偏多', divergenceAlert: '動能背離觀察' },
          },
        };
      }
    },
  };

  const twDetails = opts.twDetails || {};
  const twMarketService = {
    async getDetail(code) {
      if (twDetails[code] instanceof Error) throw twDetails[code];
      return twDetails[code] || null;
    },
  };

  const service = new CM.watchlist.WatchlistService('', twMarketService, {
    stockNames: opts.stockNames || {
      '2330': ['台積電', 'TWSE'],
      '6488': ['環球晶', 'TPEx'],
      '0050': ['元大台灣50', 'TWSE'],
    },
    baseSeries: opts.baseSeries || {},
    feedService: opts.feedService || null,
  });

  return { env, CM, service, fetchedQuoteSymbols };
}

test('folder CRUD and validation', async () => {
  const { CM, service } = setupEnv();
  await service.init();

  const initial = await service.getState();
  assert.equal(initial.config.version, 1);
  assert.equal(initial.config.autoEnabled, true);
  assert.equal(initial.config.folders.length, 1);
  assert.equal(initial.config.folders[0].id, 'wl_default');
  assert.equal(initial.config.folders[0].name, '我的自選股');
  assert.equal(initial.config.storagePath, 'user-v1/watchlists.json');
  assert.equal(initial.analysis, null);
  assert.equal(initial.shouldAutoRun, false);

  await assert.rejects(() => service.createFolder('   '), err => err instanceof CM.ValueError && err.message === '收藏夾名稱不能為空');

  const longName = '半導體核心波段觀察名單超長名稱測試1234567890ABCDEFGHIJ';
  const created = await service.createFolder(`  ${longName}  `);
  assert.ok(created.createdFolderId.startsWith('wl_'));
  assert.equal(created.config.folders.length, 2);
  assert.equal(created.config.folders[1].name, longName.slice(0, 30));

  const renamed = await service.renameFolder(created.createdFolderId, 'AI 供應鏈');
  assert.equal(renamed.config.folders[1].name, 'AI 供應鏈');

  await assert.rejects(() => service.renameFolder(created.createdFolderId, ''), err => err instanceof CM.ValueError && err.message === '收藏夾名稱不能為空');
  await assert.rejects(() => service.renameFolder('no_such_id', 'X'), err => err instanceof CM.ValueError && err.message === '找不到指定收藏夾');

  const afterDel = await service.deleteFolder(created.createdFolderId);
  assert.equal(afterDel.config.folders.length, 1);

  // 刪除最後一個收藏夾後應自動補回 wl_default
  const reset = await service.deleteFolder('wl_default');
  assert.equal(reset.config.folders.length, 1);
  assert.equal(reset.config.folders[0].id, 'wl_default');

  await assert.rejects(() => service.deleteFolder('missing'), err => err instanceof CM.ValueError && err.message === '找不到指定收藏夾');
});

test('addStock, updateItem, removeItem and input validation', async () => {
  const { CM, service } = setupEnv();
  await service.init();

  await assert.rejects(
    () => service.addStock('wl_default', 'bad code!'),
    err => err instanceof CM.ValueError && err.message === '請輸入有效台股或美股代號（如 2330、0050、NVDA）'
  );
  await assert.rejects(
    () => service.addStock('missing_folder', '2330'),
    err => err instanceof CM.ValueError && err.message === '找不到指定收藏夾'
  );

  const s1 = await service.addStock('wl_default', ' 2330 ');
  const item = s1.config.folders[0].items[0];
  assert.equal(item.code, '2330');
  assert.equal(item.name, '台積電');
  assert.equal(item.market, 'TWSE');
  assert.equal(item.shares, 0);
  assert.equal(item.costPrice, null);
  assert.equal(item.showValuation, false);
  assert.equal(item.addedAt, '2026-11-26T10:30:00+08:00');
  assert.equal(s1.quotes['2330'].price, 1050);

  // 重複加入
  await assert.rejects(
    () => service.addStock('wl_default', '2330'),
    err => err instanceof CM.ValueError && err.message === '2330 已在此收藏夾中'
  );

  // 更新估值與自動分析
  const s2 = await service.updateItem('wl_default', '2330', {
    showValuation: true,
    shares: '1000',
    costPrice: '980.12346',
    autoAnalyze: true,
  });
  const updItem = s2.config.folders[0].items[0];
  assert.equal(updItem.showValuation, true);
  assert.equal(updItem.shares, 1000);
  assert.equal(updItem.costPrice, 980.1235);
  assert.equal(updItem.inAuto, true);
  assert.deepEqual(plain(s2.config.autoStocks), ['2330']);

  // 小數股數與清空成本
  const s3 = await service.updateItem('wl_default', '2330', { shares: 12.34567, costPrice: '', autoAnalyze: false });
  assert.equal(s3.config.folders[0].items[0].shares, 12.3457);
  assert.equal(s3.config.folders[0].items[0].costPrice, null);
  assert.deepEqual(plain(s3.config.autoStocks), []);

  // 驗證錯誤
  await assert.rejects(() => service.updateItem('wl_default', '2330', { shares: -1 }), err => err instanceof CM.ValueError && err.message === '持有股數不能為負數');
  await assert.rejects(() => service.updateItem('wl_default', '2330', { costPrice: 0 }), err => err instanceof CM.ValueError && err.message === '購入價格須大於 0（不填可留空）');
  await assert.rejects(() => service.updateItem('wl_default', '9999', { shares: 10 }), err => err instanceof CM.ValueError && err.message === '此收藏夾中找不到 9999');

  // 移除股票
  const s4 = await service.removeItem('wl_default', '2330');
  assert.equal(s4.config.folders[0].items.length, 0);
  await assert.rejects(() => service.removeItem('wl_default', '2330'), err => err instanceof CM.ValueError && err.message === '此收藏夾中找不到 2330');
});

test('toggleAutoStock, setAutoEnabled and shouldAutoRun timing logic', async () => {
  const { env, CM, service } = setupEnv({ now: '2026-11-26T09:59:59+08:00' });
  await service.init();

  await assert.rejects(() => service.toggleAutoStock('$$$', true), err => err instanceof CM.ValueError && err.message === '股票代號格式無效');

  // 尚未 10:00
  let state = await service.toggleAutoStock('2330', true);
  assert.deepEqual(plain(state.config.autoStocks), ['2330']);
  assert.equal(state.shouldAutoRun, false);

  // 到達 10:00 -> shouldAutoRun 為 true
  env.setNow('2026-11-26T10:00:00+08:00');
  assert.equal(await service.shouldAutoRun(), true);

  // 關閉自動分析 -> shouldAutoRun 為 false
  let synced = false;
  CM.news.BriefingService = class StubBriefing {
    async init() {}
    async syncSharedSchedule() {
      synced = true;
    }
  };
  state = await service.setAutoEnabled(false);
  assert.equal(synced, true);
  assert.equal(state.config.autoEnabled, false);
  assert.equal(state.shouldAutoRun, false);

  // 重新開啟並執行今日分析 -> 當日不再自動跑，隔日 10:00 後再次為 true
  await service.setAutoEnabled(true);
  assert.equal(await service.shouldAutoRun(), true);
  await service.runAutoAnalysis('測試觸發');
  assert.equal(await service.shouldAutoRun(), false);

  env.setNow('2026-11-27T10:01:00+08:00');
  assert.equal(await service.shouldAutoRun(), true);

  // 移出自動分析
  state = await service.toggleAutoStock('2330', false);
  assert.deepEqual(plain(state.config.autoStocks), []);
  assert.equal(state.shouldAutoRun, false);
});

test('refreshQuotes fetches TW (.TW -> .TWO fallback) and US quotes', async () => {
  const { service, fetchedQuoteSymbols } = setupEnv();
  await service.init();
  await service.addStock('wl_default', '2330');
  await service.addStock('wl_default', '6488');
  await service.toggleAutoStock('NVDA', true);
  fetchedQuoteSymbols.length = 0;

  const state = await service.refreshQuotes(null);
  assert.equal(state.quotes['2330'].price, 1050);
  assert.equal(state.quotes['2330'].market, 'TWSE');
  assert.equal(state.quotes['6488'].price, 420.5);
  assert.equal(state.quotes['6488'].market, 'TPEx');
  assert.equal(state.quotes['NVDA'].price, 145.25);
  assert.equal(state.quotes['NVDA'].name, 'NVIDIA 輝達');
  assert.equal(state.quotes['NVDA'].market, 'US');
  assert.equal(state.quotesUpdatedAt, '2026-11-26 10:30:00');
  assert.ok(fetchedQuoteSymbols.includes('6488.TW'));
  assert.ok(fetchedQuoteSymbols.includes('6488.TWO'));

  // 指定子清單更新
  fetchedQuoteSymbols.length = 0;
  await service.refreshQuotes(['nvda']);
  assert.deepEqual(fetchedQuoteSymbols, ['NVDA']);
});

test('runAutoAnalysis produces exact 6-dim TW + US output and matches Python numbers', async () => {
  // 2330: 強多結構 (站上短中均、量增、TDCC 買超、法人買超、資減)
  const bars2330 = makeTwBars(65, 100, 0.5, 134.0, 2000);
  // 6488: 底背離 (破短均但 TDCC 大戶買超 + 法人買超)
  const bars6488 = makeTwBars(65, 200, 0.2, 205.0, 1800);

  const { env, service } = setupEnv({
    baseSeries: {
      '2026-11-13': {
        '2330': [1000000, 50000, 750000, 700000, 650000, 600000, 500, 300, 200, 100],
        '6488': [500000, 20000, 300000, 250000, 220000, 200000, 200, 120, 80, 50],
      },
    },
    feedService: {
      weeks: {
        '2026-11-20': {
          rows: {
            '2330': [1000000, 50000, 760000, 712500, 660000, 615000, 510, 305, 202, 102],
            '6488': [500000, 20000, 310000, 260000, 230000, 205000, 205, 125, 82, 52],
          },
          extraRows: {
            '0050': [800000, 100000, 400000, 320000, 300000, 250000, 400, 200, 150, 80],
          },
        },
      },
    },
    twDetails: {
      '2330': {
        bars: bars2330,
        inst: [
          ['2026-11-19', 100, 20, 10],
          ['2026-11-20', 200, 30, -5],
          ['2026-11-21', 150, 10, 0],
          ['2026-11-24', 300, 40, 15],
          ['2026-11-25', 250, 50, 20],
        ],
        margin: [
          ['2026-11-20', 10500, -100, 500, 10],
          ['2026-11-21', 10400, -100, 520, 20],
          ['2026-11-24', 10200, -200, 540, 20],
          ['2026-11-25', 10000, -200, 550, 10],
        ],
      },
      '6488': {
        bars: bars6488,
        inst: [['2026-11-25', 50, 10, 0]],
        margin: [['2026-11-25', 8000, 1500, 200, 0]],
      },
      '0050': {
        bars: makeTwBars(15, 180, 0.1),
        inst: [],
        margin: [],
      },
      '9999': new Error('查無 9999 行情'),
    },
  });

  await service.init();
  for (const sym of ['2330', '6488', '0050', '9999', 'NVDA', 'BADUS']) {
    await service.toggleAutoStock(sym, true);
  }

  const state = await service.runAutoAnalysis('手動立即更新分析');
  const rep = state.analysis;
  assert.equal(rep.date, '2026-11-26');
  assert.equal(rep.generatedAt, '2026-11-26 10:30:00 +08:00');
  assert.equal(rep.trigger, '手動立即更新分析');
  assert.equal(rep.items.length, 6);

  const byCode = Object.fromEntries(rep.items.map(x => [x.code, x]));

  // 2330: 與 Python WatchlistService.run_auto_analysis 輸出逐欄完全比對
  const pyExpected2330 = {
    code: '2330',
    name: '台積電',
    market: 'TWSE',
    isTw: true,
    price: 134,
    prevClose: 131.5,
    change: 2.5,
    changePct: 1.9,
    tradeDate: '2026-10-09',
    shortMa: {
      ma5: 131.4,
      ma10: 129.95,
      bias5Pct: 1.98,
      bias10Pct: 3.12,
      belowMa5: false,
      belowMa10: false,
      status: '站上 5日 / 10日線',
      tone: 'up',
    },
    midMa: {
      ma20: 127.35,
      ma60: 117.28,
      bias20Pct: 5.22,
      bias60Pct: 14.26,
      status: '站穩月線與季線',
      tone: 'up',
    },
    tdcc: {
      weekDay: '2026-11-20',
      prevDay: '2026-11-13',
      pct400: 71.25,
      deltaPp400: 1.25,
      deltaShares400: 12500,
      deltaPp1000: 1.5,
      status: '大戶買超',
      tone: 'up',
    },
    inst: {
      lastDate: '2026-11-25',
      lastTotal: 320,
      inst5Total: 1190,
      foreign5: 1000,
      trust5: 150,
      dealer5: 40,
      status: '法人買超',
      tone: 'up',
    },
    volume: {
      vol: 2000,
      mv5: 1320,
      volRatio: 1.52,
      status: '價漲量增 (1.52x)',
      tone: 'up',
    },
    margin: {
      lastDate: '2026-11-25',
      marginBal: 10000,
      margin5Delta: -600,
      shortBal: 550,
      short5Delta: 60,
      shortMarginRatio: 5.5,
      status: '資減籌碼沉澱',
      tone: 'up',
    },
    overall: {
      label: '價強籌碼穩（偏多結構）',
      tone: 'up',
      summary: '股價站上 5 日與 10 日均線且獲大戶或法人買盤支撐，多方格局一致。',
      divergenceAlert: '',
    },
    filterFlags: ['tdccBuy', 'instBuy'],
  };
  assert.deepEqual(plain(byCode['2330']), pyExpected2330);

  // 6488: 底背離
  const i6488 = byCode['6488'];
  assert.equal(i6488.overall.label, '價弱籌碼有撐（低檔承接）');
  assert.ok(i6488.filterFlags.includes('belowMa5'));
  assert.ok(i6488.filterFlags.includes('belowMa10'));
  assert.ok(i6488.filterFlags.includes('divergence'));
  assert.equal(i6488.margin.status, '跌勢資增須留意');

  // 0050: extraRows 單週集保快照
  const i0050 = byCode['0050'];
  assert.equal(i0050.tdcc.status, '僅單週集保快照');
  assert.equal(i0050.tdcc.pct400, 40);
  assert.equal(i0050.midMa.status, '均線天數不足');

  // 9999 & BADUS: 錯誤回傳形狀
  assert.equal(byCode['9999'].error, '查無 9999 行情');
  assert.equal(byCode['9999'].price, null);
  assert.equal(byCode['BADUS'].isTw, false);
  assert.equal(byCode['BADUS'].error, '查無 BADUS 美股資料');

  // NVDA: 美股委派結果
  assert.equal(byCode['NVDA'].isTw, false);
  assert.equal(byCode['NVDA'].market, 'US');
  assert.deepEqual(plain(byCode['NVDA'].filterFlags), ['belowMa5', 'divergence']);

  // counts 與檔案寫入驗證
  assert.equal(rep.counts.total, 6);
  assert.equal(rep.counts.belowMa5, 2);
  assert.equal(rep.counts.belowMa10, 1);
  assert.equal(rep.counts.tdccBuy, 2);
  assert.equal(rep.counts.instBuy, 2);
  assert.equal(rep.counts.divergence, 2);

  assert.ok(env.memFs.has('watchlist-analysis-v1/latest.json'));
  assert.ok(env.memFs.has('watchlist-analysis-v1/2026-11-26.json'));
  assert.equal(state.quotes['2330'].price, 134);
  assert.equal(state.quotes['NVDA'].price, 145.25);
});

test('normalizes malformed watchlists.json safely', async () => {
  const { env, service } = setupEnv();
  env.memFs.set('user-v1/watchlists.json', {
    data: JSON.stringify({
      autoEnabled: false,
      autoStocks: ['2330', '2330', 'invalid!!', 'nvda'],
      folders: [
        {
          id: 'dup',
          name: '第一組',
          items: [
            { code: '2330', shares: -5, costPrice: -10, showValuation: 1 },
            { code: '2330', shares: 10 },
            { code: 'bad!', shares: 10 },
          ],
        },
        { id: 'dup', name: '', items: [{ code: '0050', shares: '100', costPrice: '185.5' }] },
      ],
    }),
    mtime: Date.now(),
  });

  const state = await service.getState();
  assert.equal(state.config.autoEnabled, false);
  assert.deepEqual(plain(state.config.autoStocks), ['2330', 'NVDA']);
  assert.equal(state.config.folders.length, 2);
  assert.equal(state.config.folders[0].id, 'dup');
  assert.notEqual(state.config.folders[1].id, 'dup');
  assert.equal(state.config.folders[1].name, '未命名收藏夾');
  assert.equal(state.config.folders[0].items.length, 1);
  assert.equal(state.config.folders[0].items[0].shares, 0);
  assert.equal(state.config.folders[0].items[0].costPrice, null);
  assert.equal(state.config.folders[1].items[0].shares, 100);
  assert.equal(state.config.folders[1].items[0].costPrice, 185.5);
});
