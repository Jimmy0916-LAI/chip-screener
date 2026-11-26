/**
 * 行動版 /api/* 路由器：
 * 攔截前端 fetch('/api/...') 請求，改由本機純 JS 服務層處理（對應 scripts/serve_local.py）。
 * 不啟動任何本機 HTTP 監聽埠，完全在 App 行程記憶體內安全呼叫。
 */
(function (CM) {
  'use strict';

  const DEFAULT_ETF_NAMES = {
    '0050': '元大台灣50',
    '0056': '元大高股息',
    '00878': '國泰永續高股息',
    '00919': '群益台灣精選高息',
    '00929': '復華台灣科技優息',
    '00713': '元大台灣高息低波',
    '006208': '富邦台50',
    '00881': '國泰台灣5G+'
  };

  function buildStockNames(base) {
    const names = { ...(base && base.stocks ? base.stocks : {}) };
    for (const [code, label] of Object.entries(DEFAULT_ETF_NAMES)) {
      if (!Object.hasOwn(names, code)) names[code] = [label, 'TWSE'];
    }
    return names;
  }

  function makeJsonResponse(status, payload) {
    const text = JSON.stringify(payload);
    if (typeof Response === 'function') {
      return new Response(text, {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: k => (String(k).toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null) },
      async json() {
        return JSON.parse(text);
      },
      async text() {
        return text;
      }
    };
  }

  function parseBody(init) {
    if (!init || init.body === undefined || init.body === null) return {};
    if (typeof init.body === 'string') {
      if (init.body.length > 256 * 1024) return {};
      try {
        return JSON.parse(init.body);
      } catch {
        return {};
      }
    }
    if (typeof init.body === 'object') return init.body;
    return {};
  }

  class MobileApiRouter {
    constructor(base = CM.base) {
      this.base = base || { stocks: {}, series: {}, universe: [], sessions: [], hashes: {}, usUniverse: [] };
      const stockNames = buildStockNames(this.base);
      const baseSeries = this.base.series ? { ...this.base.series } : {};

      this.feedService = new CM.feed.LocalFeedService('tdcc-local-v1', this.base);
      this.dailyService = new CM.feed.DailyService('daily-cache-v1', this.feedService);
      this.twMarketService = new CM.twMarket.TwMarketService('tw-detail-v1');
      this.briefingService = new CM.news.BriefingService('', stockNames);
      this.usMarketService = new CM.usMarket.UsMarketService('us-cache-v1');
      this.watchlistService = new CM.watchlist.WatchlistService('', this.twMarketService, {
        stockNames,
        baseSeries,
        feedService: this.feedService
      });
      this._initPromise = null;
    }

    init() {
      if (!this._initPromise) {
        this._initPromise = Promise.all([
          this.feedService.init(),
          this.dailyService.init(),
          this.twMarketService.init(),
          this.briefingService.init(),
          this.usMarketService.init(),
          this.watchlistService.init()
        ]);
      }
      return this._initPromise;
    }

    async handle(rawUrl, init = {}) {
      await this.init();
      const method = String((init && init.method) || 'GET').toUpperCase();
      const url = new URL(String(rawUrl), 'https://localhost');
      const pathname = url.pathname;
      const params = url.searchParams;

      if (method === 'GET') {
        if (pathname === '/api/health') {
          return makeJsonResponse(200, {
            app: 'ChipScreener',
            status: 'ok',
            platform: 'android',
            latest: await this.feedService.latest()
          });
        }
        if (pathname === '/api/official/read') {
          return makeJsonResponse(200, await this.feedService.initial());
        }
        if (pathname === '/api/daily') {
          const code = (params.get('code') || '').trim().toUpperCase();
          try {
            return makeJsonResponse(200, await this.dailyService.getDaily(code));
          } catch (exc) {
            return makeJsonResponse(400, { error: String(exc.message || exc) });
          }
        }
        if (pathname === '/api/tw/detail') {
          const code = (params.get('code') || '').trim().toUpperCase();
          const force = params.get('refresh') === '1';
          try {
            return makeJsonResponse(200, await this.twMarketService.getDetail(code, force));
          } catch (exc) {
            return makeJsonResponse(400, { error: String(exc.message || exc) });
          }
        }
        if (pathname === '/api/briefing') {
          const day = params.get('date') || null;
          return makeJsonResponse(200, {
            config: await this.briefingService.getConfig(),
            dates: await this.briefingService.listDates(),
            report: await this.briefingService.readReport(day),
            shouldAutoRun: await this.briefingService.shouldAutoRun()
          });
        }
        if (pathname === '/api/watchlist') {
          return makeJsonResponse(200, await this.watchlistService.getState());
        }
        if (pathname === '/api/us/overview') {
          const force = params.get('refresh') === '1';
          try {
            return makeJsonResponse(200, await this.usMarketService.getOverview(force));
          } catch (exc) {
            return makeJsonResponse(500, { error: String(exc.message || exc) });
          }
        }
        if (pathname === '/api/us/screener') {
          const force = params.get('refresh') === '1';
          try {
            return makeJsonResponse(200, await this.usMarketService.getScreener(force));
          } catch (exc) {
            return makeJsonResponse(500, { error: String(exc.message || exc) });
          }
        }
        if (pathname === '/api/us/detail') {
          const code = (params.get('code') || '').trim().toUpperCase();
          const force = params.get('refresh') === '1';
          try {
            return makeJsonResponse(200, await this.usMarketService.getDetail(code, force));
          } catch (exc) {
            return makeJsonResponse(400, { error: String(exc.message || exc) });
          }
        }
        return makeJsonResponse(404, { error: 'Not found' });
      }

      if (method === 'POST') {
        if (pathname === '/api/official/update') {
          try {
            return makeJsonResponse(200, await this.feedService.update());
          } catch (exc) {
            return makeJsonResponse(500, {
              status: '失敗',
              message: String(exc.message || exc),
              weeks: {},
              months: {},
              checked: CM.time.taipeiIso()
            });
          }
        }
        if (pathname === '/api/briefing/generate') {
          const body = parseBody(init);
          try {
            const report = await this.briefingService.generate({
              featuredCode: String(body.featuredCode || '2404'),
              trigger: String(body.trigger || '手動馬上製作')
            });
            return makeJsonResponse(200, {
              config: await this.briefingService.getConfig(),
              dates: await this.briefingService.listDates(),
              report,
              shouldAutoRun: false
            });
          } catch (exc) {
            return makeJsonResponse(500, { error: String(exc.message || exc) });
          }
        }
        if (pathname === '/api/briefing/config') {
          const body = parseBody(init);
          try {
            const cfg = await this.briefingService.updateConfig(body);
            return makeJsonResponse(200, {
              config: cfg,
              dates: await this.briefingService.listDates(),
              shouldAutoRun: await this.briefingService.shouldAutoRun()
            });
          } catch (exc) {
            return makeJsonResponse(400, { error: String(exc.message || exc) });
          }
        }
        if (pathname.startsWith('/api/watchlist/')) {
          const body = parseBody(init);
          const action = pathname.slice('/api/watchlist/'.length);
          try {
            let res;
            if (action === 'folder/create') {
              res = await this.watchlistService.createFolder(String(body.name || ''));
            } else if (action === 'folder/rename') {
              res = await this.watchlistService.renameFolder(String(body.folderId || ''), String(body.name || ''));
            } else if (action === 'folder/delete') {
              res = await this.watchlistService.deleteFolder(String(body.folderId || ''));
            } else if (action === 'stock/add') {
              res = await this.watchlistService.addStock(String(body.folderId || ''), String(body.code || ''));
            } else if (action === 'stock/update') {
              res = await this.watchlistService.updateItem(String(body.folderId || ''), String(body.code || ''), body);
            } else if (action === 'stock/remove') {
              res = await this.watchlistService.removeItem(String(body.folderId || ''), String(body.code || ''));
            } else if (action === 'auto/toggle') {
              res = await this.watchlistService.toggleAutoStock(
                String(body.code || ''),
                body.enabled === undefined ? true : Boolean(body.enabled)
              );
            } else if (action === 'auto/config') {
              res = await this.watchlistService.setAutoEnabled(body.enabled === undefined ? true : Boolean(body.enabled));
            } else if (action === 'prices/refresh') {
              res = await this.watchlistService.refreshQuotes(Array.isArray(body.codes) ? body.codes : null);
            } else if (action === 'analyze') {
              res = await this.watchlistService.runAutoAnalysis(String(body.trigger || '手動立即更新分析'));
            } else {
              return makeJsonResponse(404, { error: 'Not found' });
            }
            return makeJsonResponse(200, res);
          } catch (exc) {
            const status = exc instanceof CM.ValueError ? 400 : 500;
            return makeJsonResponse(status, { error: String(exc.message || exc) });
          }
        }
        return makeJsonResponse(404, { error: 'Not found' });
      }

      return makeJsonResponse(405, { error: 'Method not allowed' });
    }

    installFetch(target = globalThis) {
      const origFetch = typeof target.fetch === 'function' ? target.fetch.bind(target) : null;
      const self = this;
      target.fetch = function chipMobileFetch(input, init) {
        const rawUrl = typeof input === 'string' ? input : (input && input.url) || '';
        const isApi =
          rawUrl.startsWith('/api/') ||
          rawUrl.startsWith('https://localhost/api/') ||
          rawUrl.startsWith('http://localhost/api/');
        if (isApi) {
          return self.handle(rawUrl, init);
        }
        if (origFetch) return origFetch(input, init);
        return Promise.reject(new Error('不支援的非 API 請求'));
      };
    }
  }

  CM.router = { MobileApiRouter };
})(globalThis.ChipMobile = globalThis.ChipMobile || {});
