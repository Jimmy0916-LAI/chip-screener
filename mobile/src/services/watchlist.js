/**
 * 股票收藏夾與自動分析服務（行動版移植自 scripts/providers/watchlist.py）
 * - 以 CM.fs 隔離儲存自訂收藏夾與持股估算設定至 user-v1/watchlists.json
 * - 提供批次報價更新（併發上限 6）與六大維度自動分析（短均、中均、TDCC 大戶、三大法人、量價、融資融券；美股委由 UsMarketService）
 * - 行動版差異：setAutoEnabled 不操作 Windows Task Scheduler，改於 CM.news.BriefingService 提供排程同步方法時委派通知排程同步
 */
(function (CM) {
  'use strict';

  const VALID_TW_CODE_RE = /^(?:\d{4}|00\d{2,4}[A-Z]?)$/;
  const VALID_SYMBOL_RE = /^(?:\d{4}|00\d{2,4}[A-Z]?|[A-Z][A-Z0-9.-]{0,7})$/;

  const pad2 = n => String(n).padStart(2, '0');

  function roundPy(x, digits = 0) {
    const r = CM.util.pyRound(x, digits);
    return r === 0 ? 0 : r;
  }

  function formatTaipeiDateTime(ms = Date.now()) {
    const p = CM.time.taipeiParts(ms);
    return `${p.date} ${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`;
  }

  function formatIntWithCommas(n) {
    return String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function computeMaLast(values, period) {
    if (!values || values.length < period) return null;
    let sum = 0;
    for (let i = values.length - period; i < values.length; i++) sum += values[i];
    return roundPy(sum / period, 2);
  }

  function pctBias(price, ref) {
    if (!ref || ref <= 0) return null;
    return roundPy(((price - ref) / ref) * 100.0, 2);
  }

  function lookupUsName(code) {
    const map = CM.usMarket && CM.usMarket.US_UNIVERSE_MAP;
    if (map && Object.prototype.hasOwnProperty.call(map, code)) {
      const entry = map[code];
      if (Array.isArray(entry) && entry.length > 0) return String(entry[0]);
      if (entry && typeof entry === 'object' && entry.name) return String(entry.name);
      if (typeof entry === 'string') return entry;
    }
    const baseList = CM.base && CM.base.usUniverse;
    if (Array.isArray(baseList)) {
      for (const row of baseList) {
        if (Array.isArray(row) && row[0] === code && row[1]) return String(row[1]);
      }
    }
    return code;
  }

  class WatchlistService {
    constructor(appDataDir = '', twMarketService = null, { stockNames = {}, baseSeries = {}, feedService = null } = {}) {
      const baseDir = String(appDataDir || '').replace(/^\/+|\/+$/g, '');
      this.appDataDir = baseDir;
      this.twMarket = twMarketService;
      this.stockNames = stockNames || {};
      this.baseSeries = baseSeries || {};
      this.feedService = feedService || null;

      this.userDir = CM.fs.joinPath(baseDir, 'user-v1');
      this.watchlistsFile = CM.fs.joinPath(this.userDir, 'watchlists.json');
      this.analysisDir = CM.fs.joinPath(baseDir, 'watchlist-analysis-v1');
      this.quotesFile = CM.fs.joinPath(this.analysisDir, 'quotes.json');
      this.latestAnalysisFile = CM.fs.joinPath(this.analysisDir, 'latest.json');
      this._lockChain = Promise.resolve();
    }

    async init() {
      // 狀態採按需讀取，無須於初始化階段預載
    }

    _withLock(fn) {
      const prev = this._lockChain;
      let release;
      this._lockChain = new Promise(resolve => {
        release = resolve;
      });
      return prev.then(fn).finally(release);
    }

    async _readJson(path, fallback) {
      const data = await CM.fs.readJson(path, null);
      return data && typeof data === 'object' && !Array.isArray(data) ? data : { ...fallback };
    }

    async _writeJson(path, payload) {
      await CM.fs.writeJson(path, payload);
    }

    _stockMeta(code) {
      const isTw = VALID_TW_CODE_RE.test(code);
      if (isTw) {
        const info = this.stockNames[code];
        if (Array.isArray(info) && info.length > 0) {
          return [String(info[0]), String(info.length > 1 ? info[1] : 'TWSE')];
        }
        return [code.startsWith('00') ? 'ETF' : code, 'TWSE'];
      }
      return [lookupUsName(code), 'US'];
    }

    async _normalizeStore(raw = null) {
      const data =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? raw
          : await this._readJson(this.watchlistsFile, {});
      const autoEnabled = Object.prototype.hasOwnProperty.call(data, 'autoEnabled')
        ? Boolean(data.autoEnabled)
        : true;

      const autoStocks = [];
      if (Array.isArray(data.autoStocks)) {
        for (const s of data.autoStocks) {
          const sym = String(s ?? '').trim().toUpperCase();
          if (VALID_SYMBOL_RE.test(sym) && !autoStocks.includes(sym)) {
            autoStocks.push(sym);
          }
        }
      }

      const folders = [];
      const seenIds = new Set();
      if (Array.isArray(data.folders)) {
        for (let idx = 0; idx < data.folders.length; idx++) {
          const f = data.folders[idx];
          if (!f || typeof f !== 'object' || Array.isArray(f)) continue;
          let fid = String(f.id || `wl_${idx + 1}`).replace(/[^A-Za-z0-9_-]/g, '') || `wl_${idx + 1}`;
          while (seenIds.has(fid)) {
            fid = `${fid}_${seenIds.size + 1}`;
          }
          seenIds.add(fid);
          const fname = String(f.name || '未命名收藏夾').trim().slice(0, 30) || '未命名收藏夾';
          const items = [];
          const seenCodes = new Set();
          const rawItems = Array.isArray(f.items) ? f.items : [];
          for (const it of rawItems) {
            if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
            const code = String(it.code || '').trim().toUpperCase();
            if (!VALID_SYMBOL_RE.test(code) || seenCodes.has(code)) continue;
            seenCodes.add(code);

            let shares = 0;
            const sharesRaw = it.shares;
            if (sharesRaw !== null && sharesRaw !== undefined && sharesRaw !== '') {
              const parsed = Number(sharesRaw);
              if (Number.isFinite(parsed) && parsed >= 0) shares = parsed;
            }

            let costPrice = null;
            const costRaw = it.costPrice;
            if (costRaw !== null && costRaw !== undefined && costRaw !== '') {
              const cp = Number(costRaw);
              if (Number.isFinite(cp) && cp > 0) costPrice = roundPy(cp, 4);
            }

            items.push({
              code,
              shares: Number.isInteger(shares) ? shares : roundPy(shares, 4),
              costPrice,
              showValuation: Boolean(it.showValuation),
              addedAt: String(it.addedAt || ''),
            });
          }
          folders.push({ id: fid, name: fname, items });
        }
      }

      if (!folders.length) {
        folders.push({ id: 'wl_default', name: '我的自選股', items: [] });
      }

      return {
        version: 1,
        autoEnabled,
        folders,
        autoStocks,
      };
    }

    _enrichStore(store) {
      const autoSet = new Set(store.autoStocks);
      const enrichedFolders = store.folders.map(f => ({
        id: f.id,
        name: f.name,
        items: f.items.map(it => {
          const [name, market] = this._stockMeta(it.code);
          return {
            ...it,
            name,
            market,
            inAuto: autoSet.has(it.code),
          };
        }),
      }));

      const autoMeta = store.autoStocks.map(code => {
        const [name, market] = this._stockMeta(code);
        return { code, name, market };
      });

      return {
        version: 1,
        autoEnabled: store.autoEnabled,
        folders: enrichedFolders,
        autoStocks: store.autoStocks,
        autoStockMeta: autoMeta,
        storagePath: this.watchlistsFile,
      };
    }

    async getQuotes() {
      const raw = await this._readJson(this.quotesFile, { quotes: {}, updatedAt: '' });
      return raw && raw.quotes && typeof raw.quotes === 'object' && !Array.isArray(raw.quotes)
        ? raw
        : { quotes: {}, updatedAt: '' };
    }

    async getLatestAnalysis() {
      const data = await CM.fs.readJson(this.latestAnalysisFile, null);
      return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
    }

    async shouldAutoRun() {
      const store = await this._normalizeStore();
      if (!store.autoEnabled || !store.autoStocks.length) return false;
      const now = CM.time.taipeiParts();
      if (now.hour < 10) return false;
      const todayFile = CM.fs.joinPath(this.analysisDir, `${now.date}.json`);
      const res = await CM.fs.readText(todayFile);
      return !(res && res.exists);
    }

    async getState() {
      const store = await this._normalizeStore();
      const quotesDoc = await this.getQuotes();
      return {
        config: this._enrichStore(store),
        quotes: quotesDoc.quotes || {},
        quotesUpdatedAt: quotesDoc.updatedAt || '',
        analysis: await this.getLatestAnalysis(),
        shouldAutoRun: await this.shouldAutoRun(),
      };
    }

    async _saveAndState(store) {
      await this._writeJson(this.watchlistsFile, store);
      return this.getState();
    }

    async createFolder(name) {
      const clean = String(name ?? '').trim().slice(0, 30);
      if (!clean) throw new CM.ValueError('收藏夾名稱不能為空');
      return this._withLock(async () => {
        const store = await this._normalizeStore();
        const existingIds = new Set(store.folders.map(f => f.id));
        let idx = store.folders.length + 1;
        let fid = `wl_${Math.floor(Date.now() / 1000)}_${idx}`;
        while (existingIds.has(fid)) {
          idx += 1;
          fid = `wl_${Math.floor(Date.now() / 1000)}_${idx}`;
        }
        store.folders.push({ id: fid, name: clean, items: [] });
        const state = await this._saveAndState(store);
        return { ...state, createdFolderId: fid };
      });
    }

    async renameFolder(folderId, name) {
      const clean = String(name ?? '').trim().slice(0, 30);
      if (!clean) throw new CM.ValueError('收藏夾名稱不能為空');
      return this._withLock(async () => {
        const store = await this._normalizeStore();
        const target = store.folders.find(f => f.id === folderId);
        if (!target) throw new CM.ValueError('找不到指定收藏夾');
        target.name = clean;
        return this._saveAndState(store);
      });
    }

    async deleteFolder(folderId) {
      return this._withLock(async () => {
        const store = await this._normalizeStore();
        const before = store.folders.length;
        store.folders = store.folders.filter(f => f.id !== folderId);
        if (store.folders.length === before) throw new CM.ValueError('找不到指定收藏夾');
        if (!store.folders.length) {
          store.folders = [{ id: 'wl_default', name: '我的自選股', items: [] }];
        }
        return this._saveAndState(store);
      });
    }

    async addStock(folderId, code) {
      const sym = String(code ?? '').trim().toUpperCase();
      if (!VALID_SYMBOL_RE.test(sym)) {
        throw new CM.ValueError('請輸入有效台股或美股代號（如 2330、0050、NVDA）');
      }
      await this._withLock(async () => {
        const store = await this._normalizeStore();
        const target = store.folders.find(f => f.id === folderId);
        if (!target) throw new CM.ValueError('找不到指定收藏夾');
        if (target.items.some(it => it.code === sym)) {
          throw new CM.ValueError(`${sym} 已在此收藏夾中`);
        }
        target.items.push({
          code: sym,
          shares: 0,
          costPrice: null,
          showValuation: false,
          addedAt: CM.time.taipeiIso(undefined, 'seconds'),
        });
        await this._writeJson(this.watchlistsFile, store);
      });

      // 即時補捉單檔報價（不阻斷失敗）
      const q = await this._fetchSingleQuote(sym);
      if (q) {
        const quotesDoc = await this.getQuotes();
        const quotesMap = { ...(quotesDoc.quotes || {}), [sym]: q };
        await this._writeJson(this.quotesFile, {
          quotes: quotesMap,
          updatedAt: formatTaipeiDateTime(),
        });
      }

      return this.getState();
    }

    async updateItem(folderId, code, updates) {
      const sym = String(code ?? '').trim().toUpperCase();
      const upd = updates && typeof updates === 'object' ? updates : {};
      return this._withLock(async () => {
        const store = await this._normalizeStore();
        const target = store.folders.find(f => f.id === folderId);
        if (!target) throw new CM.ValueError('找不到指定收藏夾');
        const item = target.items.find(it => it.code === sym);
        if (!item) throw new CM.ValueError(`此收藏夾中找不到 ${sym}`);

        if ('showValuation' in upd) {
          item.showValuation = Boolean(upd.showValuation);
        }
        if ('shares' in upd) {
          const rawShares = upd.shares;
          if (rawShares === null || rawShares === undefined || rawShares === '') {
            item.shares = 0;
          } else {
            const val = Number(rawShares);
            if (!Number.isFinite(val)) throw new CM.ValueError('持有股數格式無效');
            if (val < 0) throw new CM.ValueError('持有股數不能為負數');
            item.shares = Number.isInteger(val) ? val : roundPy(val, 4);
          }
        }
        if ('costPrice' in upd) {
          const rawCost = upd.costPrice;
          if (rawCost === null || rawCost === undefined || rawCost === '') {
            item.costPrice = null;
          } else {
            const cp = Number(rawCost);
            if (!Number.isFinite(cp)) throw new CM.ValueError('購入價格格式無效');
            if (cp <= 0) throw new CM.ValueError('購入價格須大於 0（不填可留空）');
            item.costPrice = roundPy(cp, 4);
          }
        }
        if ('autoAnalyze' in upd) {
          const wantAuto = Boolean(upd.autoAnalyze);
          if (wantAuto && !store.autoStocks.includes(sym)) {
            store.autoStocks.push(sym);
          } else if (!wantAuto) {
            store.autoStocks = store.autoStocks.filter(c => c !== sym);
          }
        }

        return this._saveAndState(store);
      });
    }

    async removeItem(folderId, code) {
      const sym = String(code ?? '').trim().toUpperCase();
      return this._withLock(async () => {
        const store = await this._normalizeStore();
        const target = store.folders.find(f => f.id === folderId);
        if (!target) throw new CM.ValueError('找不到指定收藏夾');
        const before = target.items.length;
        target.items = target.items.filter(it => it.code !== sym);
        if (target.items.length === before) throw new CM.ValueError(`此收藏夾中找不到 ${sym}`);
        return this._saveAndState(store);
      });
    }

    async toggleAutoStock(code, enabled) {
      const sym = String(code ?? '').trim().toUpperCase();
      if (!VALID_SYMBOL_RE.test(sym)) throw new CM.ValueError('股票代號格式無效');
      return this._withLock(async () => {
        const store = await this._normalizeStore();
        if (enabled) {
          if (!store.autoStocks.includes(sym)) store.autoStocks.push(sym);
        } else {
          store.autoStocks = store.autoStocks.filter(c => c !== sym);
        }
        return this._saveAndState(store);
      });
    }

    async setAutoEnabled(enabled) {
      await this._withLock(async () => {
        const store = await this._normalizeStore();
        store.autoEnabled = Boolean(enabled);
        await this._writeJson(this.watchlistsFile, store);
      });
      // 行動版以本機每日通知取代 Windows Task Scheduler，若 BriefingService 可用則同步排程
      try {
        const BriefingCls = CM.news && CM.news.BriefingService;
        if (typeof BriefingCls === 'function') {
          const svc = new BriefingCls(this.appDataDir, this.stockNames);
          if (typeof svc.init === 'function') await svc.init();
          if (typeof svc.syncSharedSchedule === 'function') {
            await svc.syncSharedSchedule();
          } else if (typeof svc.syncSharedWindowsTask === 'function') {
            await svc.syncSharedWindowsTask();
          }
        }
      } catch {
        // 通知排程同步失敗不影響收藏夾設定儲存
      }
      return this.getState();
    }

    async _fetchSingleQuote(code) {
      const fetchQuote = CM.news && CM.news.fetchYahooQuote;
      if (typeof fetchQuote !== 'function') return null;
      const isTw = VALID_TW_CODE_RE.test(code);
      let q = null;
      try {
        if (isTw) {
          q = (await fetchQuote(`${code}.TW`)) || (await fetchQuote(`${code}.TWO`));
        } else {
          q = await fetchQuote(code);
        }
      } catch {
        return null;
      }
      if (!q) return null;
      const [name, market] = this._stockMeta(code);
      return {
        code,
        name,
        market,
        ...q,
      };
    }

    async refreshQuotes(codes = null) {
      const store = await this._normalizeStore();
      const allCodes = [];
      if (Array.isArray(codes) && codes.length > 0) {
        for (const c of codes) {
          const s = String(c ?? '').trim().toUpperCase();
          if (VALID_SYMBOL_RE.test(s) && !allCodes.includes(s)) {
            allCodes.push(s);
          }
        }
      } else {
        for (const f of store.folders) {
          for (const it of f.items) {
            if (!allCodes.includes(it.code)) allCodes.push(it.code);
          }
        }
        for (const c of store.autoStocks) {
          if (!allCodes.includes(c)) allCodes.push(c);
        }
      }

      const quotesDoc = await this.getQuotes();
      const quotesMap = { ...(quotesDoc.quotes || {}) };

      if (allCodes.length > 0) {
        const fetched = await CM.util.pool(allCodes, 6, async sym => {
          await CM.lifecycle.waitActive();
          return this._fetchSingleQuote(sym);
        });
        for (let i = 0; i < allCodes.length; i++) {
          if (fetched[i]) quotesMap[allCodes[i]] = fetched[i];
        }
      }

      const updatedDoc = { quotes: quotesMap, updatedAt: formatTaipeiDateTime() };
      await this._writeJson(this.quotesFile, updatedDoc);
      return this.getState();
    }

    async _latestTdccSeries() {
      const merged = Object.create(null);
      if (this.baseSeries && typeof this.baseSeries === 'object') {
        for (const [day, rows] of Object.entries(this.baseSeries)) {
          if (rows && typeof rows === 'object') merged[day] = rows;
        }
      }
      const feedWeeks = this.feedService && this.feedService.weeks;
      if (feedWeeks && typeof feedWeeks === 'object' && Object.keys(feedWeeks).length > 0) {
        for (const [day, doc] of Object.entries(feedWeeks)) {
          const rows = Object.assign({}, (doc && doc.rows) || {}, (doc && doc.extraRows) || {});
          merged[day] = rows;
        }
      } else {
        const officialDir = CM.fs.joinPath(this.appDataDir, 'tdcc-local-v1', 'official');
        const entries = (await CM.fs.list(officialDir))
          .filter(f => f.name.endsWith('.json'))
          .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const entry of entries) {
          const doc = await CM.fs.readJson(CM.fs.joinPath(officialDir, entry.name), null);
          if (doc && typeof doc === 'object') {
            const rows = Object.assign({}, doc.rows || {}, doc.extraRows || {});
            merged[entry.name.slice(0, -5)] = rows;
          }
        }
      }
      return Object.entries(merged).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    }

    _computeTdccDim(code, weeks) {
      const matched = [];
      for (const [day, rows] of weeks) {
        const row = rows && rows[code];
        if (Array.isArray(row) && row.length >= 10 && row[0] > 0) {
          matched.push([day, row]);
        }
      }
      if (matched.length < 2) {
        if (matched.length === 1) {
          const [day, r] = matched[0];
          const pct400 = roundPy((100.0 * r[3]) / r[0], 3);
          return {
            weekDay: day,
            pct400,
            deltaPp400: null,
            deltaShares400: null,
            deltaPp1000: null,
            status: '僅單週集保快照',
            tone: 'neutral',
          };
        }
        return {
          weekDay: '',
          pct400: null,
          deltaPp400: null,
          deltaShares400: null,
          deltaPp1000: null,
          status: '無集保資料',
          tone: 'neutral',
        };
      }

      const [prevDay, prevR] = matched[matched.length - 2];
      const [curDay, curR] = matched[matched.length - 1];
      const pct400Cur = (100.0 * curR[3]) / curR[0];
      const pct400Prev = (100.0 * prevR[3]) / prevR[0];
      const pct1000Cur = (100.0 * curR[5]) / curR[0];
      const pct1000Prev = (100.0 * prevR[5]) / prevR[0];
      const deltaPp400 = roundPy(pct400Cur - pct400Prev, 3);
      const deltaShares400 = Math.trunc(curR[3] - prevR[3]);
      const deltaPp1000 = roundPy(pct1000Cur - pct1000Prev, 3);

      let status;
      let tone;
      if (deltaPp400 > 0.005) {
        status = '大戶買超';
        tone = 'up';
      } else if (deltaPp400 < -0.005) {
        status = '大戶賣超';
        tone = 'down';
      } else {
        status = '大戶持平';
        tone = 'neutral';
      }

      return {
        weekDay: curDay,
        prevDay,
        pct400: roundPy(pct400Cur, 3),
        deltaPp400,
        deltaShares400,
        deltaPp1000,
        status,
        tone,
      };
    }

    async _fetchUsBars(code) {
      const httpGet = CM.news && CM.news.httpGet;
      if (typeof httpGet !== 'function') return [];
      const encoded = encodeURIComponent(code);
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=6mo&interval=1d`;
      try {
        const raw = await httpGet(url, 12);
        const payload = JSON.parse(CM.util.utf8Decode(raw));
        const res = payload.chart.result[0];
        const tsList = res.timestamp || [];
        const q = ((res.indicators && res.indicators.quote) || [{}])[0] || {};
        const opens = q.open || [];
        const highs = q.high || [];
        const lows = q.low || [];
        const closes = q.close || [];
        const vols = q.volume || [];
        const len = Math.min(tsList.length, opens.length, highs.length, lows.length, closes.length, vols.length);
        const bars = [];
        for (let i = 0; i < len; i++) {
          const ts = tsList[i];
          const o = opens[i];
          const h = highs[i];
          const l = lows[i];
          const c = closes[i];
          const v = vols[i];
          if (ts == null || o == null || h == null || l == null || c == null) continue;
          const d = CM.time.taipeiParts(ts * 1000).date;
          bars.push([d, Number(o), Number(h), Number(l), Number(c), Math.trunc(v || 0)]);
        }
        return bars;
      } catch {
        return [];
      }
    }

    async _analyzeOne(code, weeks) {
      const isTw = VALID_TW_CODE_RE.test(code);
      const [name, market] = this._stockMeta(code);
      let detail = null;
      let errMsg = '';

      if (!isTw) {
        try {
          const UsSvcCls = CM.usMarket && CM.usMarket.UsMarketService;
          if (typeof UsSvcCls !== 'function') {
            throw new Error(`無法取得 ${code} 美股日行情`);
          }
          const usSvc = new UsSvcCls(CM.fs.joinPath(this.appDataDir, 'us-cache-v1'));
          if (typeof usSvc.init === 'function') await usSvc.init();
          const usDetail = await usSvc.getDetail(code, true);
          const tech = usDetail.tech;
          const flags = [];
          if (tech.belowMa5) flags.push('belowMa5');
          if (tech.belowMa10) flags.push('belowMa10');
          if (tech.overall && tech.overall.divergenceAlert) flags.push('divergence');
          return {
            code: usDetail.code,
            name: usDetail.name || name,
            market: 'US',
            isTw: false,
            price: tech.price,
            prevClose: tech.prevClose,
            change: tech.change,
            changePct: tech.changePct,
            tradeDate: tech.tradeDate,
            shortMa: tech.shortMa,
            midMa: tech.midMa,
            rsi: tech.rsi,
            macd: tech.macd,
            volume: tech.volume,
            range52w: tech.range52w,
            overall: tech.overall,
            filterFlags: flags,
          };
        } catch (exc) {
          return {
            code,
            name,
            market: 'US',
            isTw: false,
            error: (exc && exc.message) || `無法取得 ${code} 美股日行情`,
            price: null,
            change: null,
            changePct: null,
            filterFlags: [],
          };
        }
      }

      try {
        detail = await this.twMarket.getDetail(code, true);
      } catch (exc) {
        errMsg = (exc && exc.message) || String(exc || '');
      }

      if (!detail || !Array.isArray(detail.bars) || !detail.bars.length) {
        return {
          code,
          name,
          market,
          error: errMsg || '暫無行情資料',
          price: null,
          change: null,
          changePct: null,
          filterFlags: [],
        };
      }

      const bars = detail.bars;
      const closes = bars.map(b => Number(b[4]));
      const vols = bars.map(b => Math.trunc(Number(b[5])));
      const last = bars[bars.length - 1];
      const prev = bars.length >= 2 ? bars[bars.length - 2] : last;
      const close = Number(last[4]);
      const prevCloseRaw = Number(prev[4]);
      const chg = roundPy(close - prevCloseRaw, 2);
      const chgPct = roundPy(prevCloseRaw ? (chg / prevCloseRaw) * 100.0 : 0.0, 2);

      const ma5 = computeMaLast(closes, 5);
      const ma10 = computeMaLast(closes, 10);
      const ma20 = computeMaLast(closes, 20);
      const ma60 = computeMaLast(closes, 60);
      const mv5 = computeMaLast(vols, 5);

      const bias5 = pctBias(close, ma5);
      const bias10 = pctBias(close, ma10);
      const bias20 = pctBias(close, ma20);
      const bias60 = pctBias(close, ma60);

      const belowMa5 = ma5 !== null && close < ma5;
      const belowMa10 = ma10 !== null && close < ma10;

      let shortStatus;
      let shortTone;
      if (ma5 === null || ma10 === null) {
        shortStatus = '日K天數不足';
        shortTone = 'neutral';
      } else if (!belowMa5 && !belowMa10) {
        shortStatus = '站上 5日 / 10日線';
        shortTone = 'up';
      } else if (belowMa5 && belowMa10) {
        shortStatus = '低於 5日與 10日線';
        shortTone = 'down';
      } else if (belowMa5) {
        shortStatus = '低於 5日線、守 10日線';
        shortTone = 'neutral';
      } else {
        shortStatus = '站上 5日線、壓 10日線';
        shortTone = 'neutral';
      }

      let midStatus;
      let midTone;
      if (ma20 === null || ma60 === null) {
        midStatus = '均線天數不足';
        midTone = 'neutral';
      } else if (close >= ma20 && close >= ma60) {
        midStatus = '站穩月線與季線';
        midTone = 'up';
      } else if (close < ma20 && close < ma60) {
        midStatus = '位於月季線之下';
        midTone = 'down';
      } else if (close >= ma60) {
        midStatus = '月線下守季線';
        midTone = 'neutral';
      } else {
        midStatus = '站月線壓季線';
        midTone = 'neutral';
      }

      const vol = Math.trunc(Number(last[5]));
      const volRatio = mv5 && mv5 > 0 ? roundPy(vol / mv5, 2) : 1.0;
      const volRatioStr = volRatio.toFixed(2);
      let volStatus;
      let volTone;
      if (chg > 0 && volRatio >= 1.15) {
        volStatus = `價漲量增 (${volRatioStr}x)`;
        volTone = 'up';
      } else if (chg < 0 && volRatio >= 1.2) {
        volStatus = `帶量回檔 (${volRatioStr}x)`;
        volTone = 'down';
      } else if (volRatio < 0.75) {
        volStatus = `量縮整理 (${volRatioStr}x)`;
        volTone = 'neutral';
      } else {
        volStatus = `量能溫和 (${volRatioStr}x)`;
        volTone = 'neutral';
      }

      // 維度 3：TDCC 大戶
      const tdccDim = isTw
        ? this._computeTdccDim(code, weeks)
        : {
            weekDay: '',
            pct400: null,
            deltaPp400: null,
            deltaShares400: null,
            deltaPp1000: null,
            status: '美股不適用台股集保',
            tone: 'neutral',
          };

      // 維度 4：三大法人
      const instRows = Array.isArray(detail.inst) ? detail.inst : [];
      let instDim;
      if (isTw && instRows.length > 0) {
        const r5 = instRows.slice(-5);
        const f5 = r5.reduce((acc, r) => acc + Math.trunc(Number(r[1])), 0);
        const t5 = r5.reduce((acc, r) => acc + Math.trunc(Number(r[2])), 0);
        const d5 = r5.reduce((acc, r) => acc + Math.trunc(Number(r[3])), 0);
        const inst5 = f5 + t5 + d5;
        const lastRow = instRows[instRows.length - 1];
        const lastInst = Math.trunc(Number(lastRow[1]) + Number(lastRow[2]) + Number(lastRow[3]));
        const instStatus = inst5 > 0 ? '法人買超' : inst5 < 0 ? '法人賣超' : '法人持平';
        const instTone = inst5 > 0 ? 'up' : inst5 < 0 ? 'down' : 'neutral';
        instDim = {
          lastDate: lastRow[0],
          lastTotal: lastInst,
          inst5Total: inst5,
          foreign5: f5,
          trust5: t5,
          dealer5: d5,
          status: instStatus,
          tone: instTone,
        };
      } else {
        instDim = {
          lastDate: '',
          lastTotal: null,
          inst5Total: null,
          foreign5: null,
          trust5: null,
          dealer5: null,
          status: !isTw ? '美股無三大法人' : '無法人資料',
          tone: 'neutral',
        };
      }

      // 維度 6：融資融券
      const marginRows = Array.isArray(detail.margin) ? detail.margin : [];
      let marginDim;
      if (isTw && marginRows.length > 0) {
        const lm = marginRows[marginRows.length - 1];
        const m5 = marginRows.slice(-5).reduce((acc, r) => acc + Math.trunc(Number(r[2])), 0);
        const s5 = marginRows.slice(-5).reduce((acc, r) => acc + Math.trunc(Number(r[4])), 0);
        const mb = Math.trunc(Number(lm[1]));
        const sb = Math.trunc(Number(lm[3]));
        const ratio = mb > 0 ? roundPy((sb / mb) * 100.0, 2) : 0.0;
        let mStatus;
        let mTone;
        if (m5 < 0 && chg >= 0) {
          mStatus = '資減籌碼沉澱';
          mTone = 'up';
        } else if (m5 > 0 && chg < 0) {
          mStatus = '跌勢資增須留意';
          mTone = 'down';
        } else {
          mStatus = `資${m5 >= 0 ? '增' : '減'} ${formatIntWithCommas(m5)} 張`;
          mTone = 'neutral';
        }
        marginDim = {
          lastDate: lm[0],
          marginBal: mb,
          margin5Delta: m5,
          shortBal: sb,
          short5Delta: s5,
          shortMarginRatio: ratio,
          status: mStatus,
          tone: mTone,
        };
      } else {
        marginDim = {
          lastDate: '',
          marginBal: null,
          margin5Delta: null,
          shortBal: null,
          short5Delta: null,
          shortMarginRatio: null,
          status: !isTw ? '美股無信用資料' : '無融資融券資料',
          tone: 'neutral',
        };
      }

      // 綜合訊號與背離標籤
      const shortBull = ma5 !== null && ma10 !== null && !belowMa5 && !belowMa10;
      const shortWeak = belowMa5 || belowMa10;
      const chipBull = tdccDim.tone === 'up' || instDim.tone === 'up';
      const chipBear = tdccDim.tone === 'down' || instDim.tone === 'down';

      let divergenceAlert = '';
      let overallLabel;
      let overallTone;
      let summary;
      if (shortWeak && chipBull) {
        overallLabel = '價弱籌碼有撐（低檔承接）';
        overallTone = 'neutral';
        divergenceAlert = '底背離留意：股價破短均但大戶／法人仍買超';
        summary = '短線股價低於 5 日或 10 日線，惟集保大戶或三大法人維持偏多買超，具低檔承接觀察價值。';
      } else if (shortBull && chipBear && tdccDim.tone !== 'up' && instDim.tone !== 'up') {
        overallLabel = '價強籌碼背離（留意調節）';
        overallTone = 'neutral';
        divergenceAlert = '高檔背離警戒：股價站短均但大戶與法人同步賣超';
        summary = '股價站穩短均線之上，但大戶與法人呈調節賣超，追價宜留意量價與籌碼延續性。';
      } else if (shortBull && chipBull) {
        overallLabel = '價強籌碼穩（偏多結構）';
        overallTone = 'up';
        summary = '股價站上 5 日與 10 日均線且獲大戶或法人買盤支撐，多方格局一致。';
      } else if (!isTw && shortBull) {
        overallLabel = '美股短多均線強勢';
        overallTone = 'up';
        summary = '收盤站上 5 日與 10 日均線，短中期趨勢偏多。';
      } else {
        overallLabel = '均線承壓（偏弱觀察）';
        overallTone = 'down';
        summary = '股價低於短期均線且籌碼動能偏保守，宜待站回 5 日／10 日線或法人轉買。';
      }

      const flags = [];
      if (belowMa5) flags.push('belowMa5');
      if (belowMa10) flags.push('belowMa10');
      if (tdccDim.tone === 'up') flags.push('tdccBuy');
      else if (tdccDim.tone === 'down') flags.push('tdccSell');
      if (instDim.tone === 'up') flags.push('instBuy');
      else if (instDim.tone === 'down') flags.push('instSell');
      if (divergenceAlert) flags.push('divergence');

      return {
        code,
        name,
        market,
        isTw,
        price: roundPy(close, 2),
        prevClose: roundPy(prevCloseRaw, 2),
        change: chg,
        changePct: chgPct,
        tradeDate: last[0],
        shortMa: {
          ma5,
          ma10,
          bias5Pct: bias5,
          bias10Pct: bias10,
          belowMa5,
          belowMa10,
          status: shortStatus,
          tone: shortTone,
        },
        midMa: {
          ma20,
          ma60,
          bias20Pct: bias20,
          bias60Pct: bias60,
          status: midStatus,
          tone: midTone,
        },
        tdcc: tdccDim,
        inst: instDim,
        volume: {
          vol,
          mv5: mv5 ? roundPy(mv5, 0) : null,
          volRatio,
          status: volStatus,
          tone: volTone,
        },
        margin: marginDim,
        overall: {
          label: overallLabel,
          tone: overallTone,
          summary,
          divergenceAlert,
        },
        filterFlags: flags,
      };
    }

    async runAutoAnalysis(trigger = '手動立即更新分析') {
      const store = await this._normalizeStore();
      const now = CM.time.taipeiParts();
      const today = now.date;
      const autoCodes = store.autoStocks;
      const weeks = await this._latestTdccSeries();

      let items = [];
      if (autoCodes.length > 0) {
        items = await CM.util.pool(autoCodes, 4, async code => {
          await CM.lifecycle.waitActive();
          return this._analyzeOne(code, weeks);
        });
      }

      // 順便同步寫入最新收盤價快取（若未有盤中報價則補齊）
      const quotesDoc = await this.getQuotes();
      const quotesMap = { ...(quotesDoc.quotes || {}) };
      for (const it of items) {
        if (it && it.price !== null && it.price !== undefined) {
          quotesMap[it.code] = {
            code: it.code,
            name: it.name,
            market: it.market,
            price: it.price,
            prevClose: it.prevClose,
            change: it.change,
            changePct: it.changePct,
            tradeTime: it.tradeDate,
          };
        }
      }
      if (items.length > 0) {
        await this._writeJson(this.quotesFile, {
          quotes: quotesMap,
          updatedAt: formatTaipeiDateTime(now.ms),
        });
      }

      const countFlag = flag => items.filter(x => x && Array.isArray(x.filterFlags) && x.filterFlags.includes(flag)).length;
      const counts = {
        total: items.length,
        belowMa5: countFlag('belowMa5'),
        belowMa10: countFlag('belowMa10'),
        tdccBuy: countFlag('tdccBuy'),
        tdccSell: countFlag('tdccSell'),
        instBuy: countFlag('instBuy'),
        instSell: countFlag('instSell'),
        divergence: countFlag('divergence'),
      };

      const report = {
        date: today,
        generatedAt: `${formatTaipeiDateTime(now.ms)} +08:00`,
        trigger: trigger || '手動立即更新分析',
        counts,
        items,
      };
      await this._writeJson(this.latestAnalysisFile, report);
      await this._writeJson(CM.fs.joinPath(this.analysisDir, `${today}.json`), report);
      return this.getState();
    }
  }

  CM.watchlist = { WatchlistService };
})(globalThis.ChipMobile = globalThis.ChipMobile || {});
