/**
 * 台股／美股個股詳情資料供應器
 * 移植自 scripts/providers/tw_market.py：整合 FinMind 日 K 線、三大法人買賣超與融資融券餘額變化，
 * 以及 Yahoo Finance 美股日線資料，提供本機快取與單位換算（張）。
 */
(function (CM) {
  'use strict';

  const VALID_TW_CODE_RE = /^(?:\d{4}|00\d{2,4}[A-Z]?)$/;
  const VALID_US_CODE_RE = /^[A-Z][A-Z0-9.-]{0,7}$/;

  function taipeiNow() {
    return CM.time.taipeiIso(Date.now(), 'milliseconds');
  }

  class TwMarketService {
    constructor(cacheDir = 'tw-detail-v1') {
      this.cacheDir = cacheDir;
      this._inFlight = new Map();
    }

    async init() {}

    async _fetchFinmind(dataset, code, startDate) {
      const qs = new URLSearchParams({ dataset, data_id: code, start_date: startDate }).toString();
      let payload;
      try {
        const res = await CM.http.getOk(`${TwMarketService.FINMIND_API}?${qs}`, {
          timeoutMs: TwMarketService.REQUEST_TIMEOUT_MS
        });
        payload = res.json();
      } catch (exc) {
        if (exc && exc.status) {
          throw new CM.ValueError(`上游資料 HTTP ${exc.status}`);
        }
        const msg = String((exc && exc.message) || exc || '');
        if (/^連線失敗/.test(msg)) throw new CM.ValueError(msg);
        throw new CM.ValueError(`連線失敗 ${msg || '網路無法使用'}`);
      }

      if (payload.status !== 200) {
        throw new CM.ValueError(payload.msg || `資料服務回應異常 (${payload.status})`);
      }
      return payload.data || [];
    }

    async _fetchUsYahooBars(code) {
      const encoded = encodeURIComponent(code);
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=1y&interval=1d`;
      try {
        const res = await CM.http.getOk(url, {
          timeoutMs: TwMarketService.REQUEST_TIMEOUT_MS
        });
        const payload = res.json();
        const r = payload.chart.result[0];
        const tsList = r.timestamp || [];
        const q = ((r.indicators && r.indicators.quote) || [{}])[0] || {};
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
          if (ts == null || o == null || h == null || l == null || c == null || o <= 0 || h < l || l <= 0 || c <= 0) {
            continue;
          }
          const d = CM.time.taipeiParts(ts * 1000).date;
          bars.push([
            d,
            CM.util.pyRound(Number(o), 2) || 0,
            CM.util.pyRound(Number(h), 2) || 0,
            CM.util.pyRound(Number(l), 2) || 0,
            CM.util.pyRound(Number(c), 2) || 0,
            Math.trunc(Number(v || 0))
          ]);
        }
        return bars;
      } catch (exc) {
        throw new CM.ValueError(`無法取得美股 ${code} 日線資料：${(exc && exc.message) || exc}`);
      }
    }

    async getDetail(code, forceRefresh = false) {
      const norm = String(code || '').trim().toUpperCase();
      const isTw = VALID_TW_CODE_RE.test(norm);
      const isUs = !isTw && VALID_US_CODE_RE.test(norm);
      if (!isTw && !isUs) {
        throw new CM.ValueError('請輸入有效台股或美股代號（如 2330、2404、0050、NVDA）');
      }

      const cachePath = CM.fs.joinPath(this.cacheDir, `${norm}.json`);
      if (!forceRefresh) {
        const meta = await CM.fs.readJsonMeta(cachePath);
        if (meta && !meta.damaged && meta.value && Date.now() - meta.mtime < TwMarketService.CACHE_TTL_MS) {
          return meta.value;
        }
      }

      if (this._inFlight.has(norm)) return this._inFlight.get(norm);
      const task = this._loadDetail(norm, isTw, cachePath).finally(() => {
        this._inFlight.delete(norm);
      });
      this._inFlight.set(norm, task);
      return task;
    }

    async _loadDetail(code, isTw, cachePath) {
      if (!isTw) {
        const bars = await this._fetchUsYahooBars(code);
        if (!bars.length) {
          throw new CM.ValueError(`查無 ${code} 的有效美股日行情資料`);
        }
        const result = {
          code,
          bars,
          inst: [],
          margin: [],
          source: 'Yahoo Finance (US Daily OHLCV)',
          fetched: taipeiNow()
        };
        await CM.fs.writeJson(cachePath, result);
        return result;
      }

      // 1. 日 K 價量（取 2024-01-01 起完整交易日，供日/週/月 K 與 MA60 計算）
      const rawPrices = await this._fetchFinmind('TaiwanStockPrice', code, '2024-01-01');
      const bars = [];
      for (const p of rawPrices) {
        const o = Number(p.open || 0);
        const h = Number(p.max || 0);
        const l = Number(p.min || 0);
        const c = Number(p.close || 0);
        const volLots = CM.util.pyRound(Number(p.Trading_Volume || 0) / 1000) || 0;
        if (o <= 0 || h < l || l <= 0 || c <= 0) continue;
        bars.push([p.date, o, h, l, c, volLots]);
      }

      if (!bars.length) {
        throw new CM.ValueError(`查無 ${code} 的有效日行情資料`);
      }

      // 2. 三大法人買賣超（近期 45 個交易日，換算為張）
      const instStart = bars[Math.max(0, bars.length - 50)][0];
      let instByDate = Object.create(null);
      try {
        const rawInst = await this._fetchFinmind('TaiwanStockInstitutionalInvestorsBuySell', code, instStart);
        for (const r of rawInst) {
          const d = r.date;
          if (!d) continue;
          const bucket = instByDate[d] || (instByDate[d] = [0, 0, 0]);
          const netLots = CM.util.pyRound((Number(r.buy || 0) - Number(r.sell || 0)) / 1000) || 0;
          const name = r.name || '';
          if (name.includes('Foreign')) {
            bucket[0] += netLots;
          } else if (name === 'Investment_Trust') {
            bucket[1] += netLots;
          } else {
            bucket[2] += netLots;
          }
        }
      } catch {
        instByDate = Object.create(null);
      }
      const inst = Object.entries(instByDate)
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([d, vals]) => [d, vals[0], vals[1], vals[2]])
        .slice(-30);

      // 3. 融資融券餘額變化（近期 30 個交易日，單位：張）
      let margin = [];
      try {
        const rawMargin = await this._fetchFinmind('TaiwanStockMarginPurchaseShortSale', code, instStart);
        for (const r of rawMargin) {
          const mb = Math.trunc(Number(r.MarginPurchaseTodayBalance || 0));
          const mp = Math.trunc(Number(r.MarginPurchaseYesterdayBalance || 0));
          const sb = Math.trunc(Number(r.ShortSaleTodayBalance || 0));
          const sp = Math.trunc(Number(r.ShortSaleYesterdayBalance || 0));
          margin.push([r.date, mb, mb - mp, sb, sb - sp]);
        }
      } catch {
        margin = [];
      }
      margin = margin.slice(-30);

      const result = {
        code,
        bars,
        inst,
        margin,
        source: 'FinMind (TaiwanStockPrice / Institutional / Margin)',
        fetched: taipeiNow()
      };
      await CM.fs.writeJson(cachePath, result);
      return result;
    }
  }

  TwMarketService.FINMIND_API = 'https://api.finmindtrade.com/api/v4/data';
  TwMarketService.CACHE_TTL_MS = 4 * 3600 * 1000;
  TwMarketService.REQUEST_TIMEOUT_MS = 25000;

  CM.twMarket = { TwMarketService };
})(globalThis.ChipMobile = globalThis.ChipMobile || {});
