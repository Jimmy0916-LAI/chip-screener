/**
 * 官方集保 (TDCC 1-5)／證交所交易日曆 (TWSE FMTQIK) 即時更新與個股日 K 服務
 * 移植自 scripts/serve_local.py（LocalFeedService、DailyService 與模組輔助函式）。
 */
(function (CM) {
  'use strict';

  const TDCC_URL = 'https://opendata.tdcc.com.tw/getOD.ashx?id=1-5';
  const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
  const REQUEST_TIMEOUT_MS = 40000;
  const REQUIRED_TDCC_FIELDS = ['資料日期', '證券代號', '持股分級', '人數', '股數', '占集保庫存數比例%'];
  const BAND_START_LEVELS = [11, 12, 13, 15];
  const ETF_CODE_RE = /^00\d{2,4}[A-Z]?$/;
  const TW_CODE_RE = /^(?:\d{4}|00\d{2,4}[A-Z]?)$/;

  function calendarUrl(month) {
    return `https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date=${String(month).replace(/-/g, '')}01&response=json`;
  }

  function taipeiNow() {
    return CM.time.taipeiIso(Date.now(), 'milliseconds');
  }

  function check(condition, message) {
    if (!condition) throw new CM.ValueError(message);
  }

  function parseIsoDay(text) {
    const s = String(text);
    check(/^\d{4}-\d{2}-\d{2}$/.test(s), `日期無效 ${s}`);
    const [y, m, d] = s.split('-').map(Number);
    check(y >= 1, `日期無效 ${s}`);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const iso = dt.toISOString().slice(0, 10);
    check(iso === s, `日期無效 ${s}`);
    return s;
  }

  function nextMonth(month) {
    const [y, m] = String(month).split('-').map(Number);
    return m === 12
      ? `${String(y + 1).padStart(4, '0')}-01`
      : `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}`;
  }

  function toBytes(raw) {
    if (raw instanceof Uint8Array) return raw;
    if (typeof raw === 'string') return new TextEncoder().encode(raw);
    return new Uint8Array(raw || []);
  }

  async function downloadUrl(url) {
    try {
      const res = await CM.http.getOk(url, {
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxBytes: MAX_RESPONSE_BYTES
      });
      return res.bytes;
    } catch (exc) {
      if (exc && exc.status) {
        throw new CM.ValueError(`官方 HTTP ${exc.status}`);
      }
      const msg = String((exc && exc.message) || exc || '');
      if (msg === '回應過大') throw new CM.ValueError('回應過大');
      if (/^連線失敗/.test(msg)) throw new CM.ValueError(msg);
      throw new CM.ValueError(`連線失敗 ${msg || '網路無法使用'}`);
    }
  }

  async function parseWeek(rawBytes, universe, fetched) {
    const bytes = toBytes(rawBytes);
    const text = CM.util.utf8Decode(bytes).trim();
    const lines = text ? text.split(/\r\n|\r|\n/) : [];
    check(lines.length > 1, '集保內容為空');

    const fields = lines[0].split(',').map(s => s.trim());
    const colIdx = REQUIRED_TDCC_FIELDS.map(name => fields.indexOf(name));
    check(colIdx.every(i => i >= 0) && new Set(fields).size === fields.length, '集保欄位缺失或重複');

    const pool = new Set(universe);
    const groups = new Map();
    const issues = {};
    const adjustments = {};
    const rows = {};
    const extraRows = {};
    let day = null;
    let dayStamp = '';
    const fetchedDay = String(fetched || '').slice(0, 10);

    for (let li = 1; li < lines.length; li++) {
      const values = lines[li].split(',');
      check(values.length === fields.length, '集保欄數錯誤');
      const stamp = values[colIdx[0]].trim();
      const code = values[colIdx[1]].trim();
      const lv = values[colIdx[2]].trim();
      const holdersS = values[colIdx[3]].trim();
      const sharesS = values[colIdx[4]].trim();

      if (day === null) {
        check(/^\d{8}$/.test(stamp), '統計日期格式錯誤');
        day = parseIsoDay(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`);
        dayStamp = day.replace(/-/g, '');
        const jsDay = new Date(day + 'T00:00:00Z').getUTCDay();
        const weekday = (jsDay + 6) % 7;
        check(day <= fetchedDay && weekday !== 5 && weekday !== 6, '未來或非營業日的統計日期');
      }
      check(stamp === dayStamp, '同份集保檔混有不同日期');
      if (!pool.has(code) && !ETF_CODE_RE.test(code)) continue;

      let levels = groups.get(code);
      if (!levels) {
        levels = new Map();
        groups.set(code, levels);
      }
      if (!/^\d+$/.test(lv) || !/^\d+$/.test(holdersS) || !/^\d+$/.test(sharesS)) {
        issues[code] = '重複級距或股數／戶數無效';
        continue;
      }
      const level = Number(lv);
      if (level < 1 || level > 17 || levels.has(level)) {
        issues[code] = '重複級距或股數／戶數無效';
        continue;
      }
      levels.set(level, [Number(sharesS), Number(holdersS)]);
    }

    for (const code of universe) {
      const g = groups.get(code);
      if (!g || g.size !== 17) {
        if (!Object.hasOwn(issues, code)) issues[code] = '原表缺股或缺少級距';
      }
      if (Object.hasOwn(issues, code)) continue;

      const [den, count] = g.get(17);
      let sumShares = 0;
      let sumHolders = 0;
      for (let i = 1; i <= 15; i++) {
        sumShares += g.get(i)[0];
        sumHolders += g.get(i)[1];
      }
      const bandsShares = BAND_START_LEVELS.map(start => {
        let s = 0;
        for (let i = start; i <= 15; i++) s += g.get(i)[0];
        return s;
      });
      const bandsHolders = BAND_START_LEVELS.map(start => {
        let s = 0;
        for (let i = start; i <= 15; i++) s += g.get(i)[1];
        return s;
      });
      const adj = g.get(16);

      if (
        den <= 0 ||
        sumShares - adj[0] !== den ||
        sumHolders !== count ||
        bandsShares.some(n => n > den)
      ) {
        issues[code] = '股數或戶數與第17級未對帳，待核';
        continue;
      }

      rows[code] = [den, count, ...bandsShares, ...bandsHolders];
      if (adj[0] || adj[1]) adjustments[code] = [adj[0], adj[1]];
    }

    const universeIssues = {};
    for (const [k, v] of Object.entries(issues)) {
      if (pool.has(k)) universeIssues[k] = v;
    }

    for (const [code, g] of groups.entries()) {
      if (pool.has(code) || Object.hasOwn(issues, code) || g.size !== 17) continue;
      const [den, count] = g.get(17);
      let sumShares = 0;
      let sumHolders = 0;
      for (let i = 1; i <= 15; i++) {
        sumShares += g.get(i)[0];
        sumHolders += g.get(i)[1];
      }
      const bandsShares = BAND_START_LEVELS.map(start => {
        let s = 0;
        for (let i = start; i <= 15; i++) s += g.get(i)[0];
        return s;
      });
      const bandsHolders = BAND_START_LEVELS.map(start => {
        let s = 0;
        for (let i = start; i <= 15; i++) s += g.get(i)[1];
        return s;
      });
      const adj = g.get(16);
      if (
        den <= 0 ||
        sumShares - adj[0] !== den ||
        sumHolders !== count ||
        bandsShares.some(n => n > den)
      ) {
        continue;
      }
      extraRows[code] = [den, count, ...bandsShares, ...bandsHolders];
      if (adj[0] || adj[1]) adjustments[code] = [adj[0], adj[1]];
    }

    const valid = Object.keys(rows).length;
    check(Boolean(day) && valid >= Math.ceil(pool.size * 0.95), `集保有效股票覆蓋不足 95%（${valid}/${pool.size}）`);

    return {
      day,
      rows,
      extraRows,
      issues: universeIssues,
      adjustments,
      observed: fetched,
      quality: {
        raw_source: TDCC_URL,
        sha256: await CM.util.sha256Hex(bytes),
        valid,
        invalid: pool.size - valid,
        universe: pool.size,
        fetched,
        publication: null,
        validation: '1–17 級日期、股數、戶數與固定母體覆蓋驗證通過'
      }
    };
  }

  async function parseMonth(rawBytes, month, fetched, known) {
    const bytes = toBytes(rawBytes);
    const payload = JSON.parse(CM.util.utf8Decode(bytes));
    const fields = Array.isArray(payload && payload.fields) ? payload.fields : [];
    const data = Array.isArray(payload && payload.data) ? payload.data : [];
    check(
      Boolean(payload) &&
        payload.stat === 'OK' &&
        fields[0] === '日期' &&
        fields.includes('成交股數') &&
        payload.date === String(month).replace(/-/g, '') + '01' &&
        data.length > 0,
      `TWSE 日曆月份或欄位不符 ${month}`
    );

    const days = [];
    for (const row of data) {
      const m = /^(\d{2,3})\/(\d{2})\/(\d{2})$/.exec(String(row[0]).trim());
      const volStr = String(row[1]).replace(/,/g, '').trim();
      const vol = /^-?\d+$/.test(volStr) ? Number(volStr) : NaN;
      check(Boolean(m) && Number.isFinite(vol) && vol > 0, 'TWSE 交易日列無效');
      const iso = parseIsoDay(`${String(Number(m[1]) + 1911).padStart(4, '0')}-${m[2]}-${m[3]}`);
      days.push(iso);
    }

    const fetchedDay = String(fetched || '').slice(0, 10);
    const daySet = new Set(days);
    const monotonic = days.every(
      (d, i) => d.startsWith(month + '-') && d <= fetchedDay && (i === 0 || d > days[i - 1])
    );
    check(monotonic && (known || []).every(d => daySet.has(d)), 'TWSE 日曆日期倒退、錯月或缺少已知交易日');

    return {
      month,
      days,
      source: calendarUrl(month),
      sha256: await CM.util.sha256Hex(bytes),
      fetched
    };
  }

  class LocalFeedService {
    constructor(cacheDir = 'tdcc-local-v1', base = CM.base) {
      this.cacheDir = cacheDir;
      this.base = base;
      this.weeks = {};
      this.months = {};
      this.notes = [];
      this._initPromise = null;
      this._inFlight = null;
    }

    _getBase() {
      return this.base || CM.base;
    }

    _bucketFile(kind, key) {
      return CM.fs.joinPath(this.cacheDir, kind, `${key}.json`);
    }

    async init() {
      if (this._initPromise) return this._initPromise;
      this._initPromise = this._loadCache();
      return this._initPromise;
    }

    async _loadCache() {
      const buckets = [
        ['official', /^\d{4}-\d{2}-\d{2}\.json$/, this.weeks],
        ['calendar', /^\d{4}-\d{2}\.json$/, this.months]
      ];
      for (const [kind, pattern, target] of buckets) {
        const dir = CM.fs.joinPath(this.cacheDir, kind);
        let files;
        try {
          files = await CM.fs.list(dir);
        } catch {
          continue;
        }
        files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const file of files) {
          if (!pattern.test(file.name)) continue;
          const stem = file.name.slice(0, -5);
          try {
            const meta = await CM.fs.readJsonMeta(CM.fs.joinPath(dir, file.name));
            if (!meta || meta.damaged || !meta.value || typeof meta.value !== 'object') {
              this.notes.push(`${stem} 本機快取損毀略過`);
              continue;
            }
            const data = meta.value;
            if ((data.day || data.month) === stem) {
              target[stem] = data;
            }
          } catch {
            this.notes.push(`${stem} 本機快取損毀略過`);
          }
        }
      }
    }

    async _atomicSave(kind, key, value) {
      await CM.fs.writeJson(this._bucketFile(kind, key), value);
    }

    async latest() {
      const base = this._getBase();
      const keys = [...Object.keys((base && base.hashes) || {}), ...Object.keys(this.weeks)];
      keys.sort();
      return keys.length ? keys[keys.length - 1] : '';
    }

    async initial() {
      return { weeks: this.weeks, months: this.months, notes: this.notes };
    }

    async _checkWeek() {
      const base = this._getBase();
      const rawBytes = await downloadUrl(TDCC_URL);
      const week = await parseWeek(rawBytes, base.universe, taipeiNow());
      const latestDay = await this.latest();
      const day = week.day;

      if (day < latestDay) {
        throw new CM.ValueError(`忽略舊回應 ${day}，已保存 ${latestDay}`);
      }
      if (day === latestDay) {
        const knownHash =
          (this.weeks[day] && this.weeks[day].quality && this.weeks[day].quality.sha256) ||
          (base.hashes && base.hashes[day]);
        if (knownHash !== week.quality.sha256) {
          throw new CM.ValueError(`${day} 同期內容變更，保留已驗證版本待核`);
        }
        // 若舊快取缺少 ETF extraRows，就地補齊並回傳給前端
        if (Object.hasOwn(this.weeks, day) && !Object.hasOwn(this.weeks[day], 'extraRows')) {
          this.weeks[day].extraRows = week.extraRows || {};
          this.weeks[day].adjustments = Object.assign(this.weeks[day].adjustments || {}, week.adjustments || {});
          await this._atomicSave('official', day, this.weeks[day]);
          return [this.weeks[day], `已是最新 ${day}（已補齊 ETF 資料）`];
        }
        return [null, `已是最新 ${day}`];
      }

      await this._atomicSave('official', day, week);
      this.weeks[day] = week;
      return [week, `有新資料 ${day}`];
    }

    async _checkCalendar(changed) {
      const base = this._getBase();
      const monthKeys = Object.keys(this.months).sort();
      let month = monthKeys.length
        ? monthKeys[monthKeys.length - 1]
        : base.sessions[base.sessions.length - 1].slice(0, 7);
      const todayMonth = taipeiNow().slice(0, 7);
      while (month <= todayMonth) {
        const old =
          (this.months[month] && this.months[month].days) ||
          base.sessions.filter(d => d.startsWith(month));
        const rawBytes = await downloadUrl(calendarUrl(month));
        const record = await parseMonth(rawBytes, month, taipeiNow(), old);
        if (record.days.length > old.length) {
          await this._atomicSave('calendar', month, record);
          this.months[month] = record;
          changed[month] = record;
        }
        month = nextMonth(month);
      }
    }

    async update() {
      if (this._inFlight) return this._inFlight;
      this._inFlight = this._doUpdate().finally(() => {
        this._inFlight = null;
      });
      return this._inFlight;
    }

    async _doUpdate() {
      const months = {};
      const errors = [];
      let week = null;
      let message = '';

      try {
        [week, message] = await this._checkWeek();
      } catch (exc) {
        errors.push('集保：' + ((exc && exc.message) || String(exc)));
      }

      try {
        await this._checkCalendar(months);
      } catch (exc) {
        errors.push('交易日曆：' + ((exc && exc.message) || String(exc)));
      }

      let status;
      if (errors.length === 2 && errors.every(e => e.includes('連線失敗'))) {
        status = '離線';
      } else if (errors.length === 2) {
        status = '失敗';
      } else if (errors.length > 0) {
        status = '部分成功';
      } else if (week) {
        status = '有新資料';
      } else {
        status = '已是最新';
      }

      return {
        weeks: week ? { [week.day]: week } : {},
        months,
        status,
        message: [message, ...errors].filter(Boolean).join('｜'),
        checked: taipeiNow()
      };
    }
  }

  class DailyService {
    constructor(cacheDir = 'daily-cache-v1', feedService = null) {
      this.cacheDir = cacheDir;
      this.feedService = feedService;
      this._inFlight = new Map();
    }

    async init() {}

    async _fetchFinmind(dataset, code, startDate = '2024-01-01') {
      const qs = new URLSearchParams({ dataset, data_id: code, start_date: startDate }).toString();
      const raw = await downloadUrl(`${DailyService.FINMIND_API}?${qs}`);
      const payload = JSON.parse(CM.util.utf8Decode(raw));
      if (payload.status !== 200) {
        throw new CM.ValueError(payload.msg || `FinMind 回應異常 (${payload.status})`);
      }
      return payload.data || [];
    }

    _fallbackIssuedShares(code) {
      const weeks = (this.feedService && this.feedService.weeks) || {};
      const days = Object.keys(weeks).sort().reverse();
      for (const day of days) {
        const week = weeks[day];
        const row = (week.rows && week.rows[code]) || (week.extraRows && week.extraRows[code]);
        if (row && row[0] > 0) return Math.trunc(row[0]);
      }
      return 0;
    }

    async getDaily(code) {
      const norm = String(code || '').trim().toUpperCase();
      if (!TW_CODE_RE.test(norm)) {
        throw new CM.ValueError('請輸入有效四碼股票或 ETF 代號');
      }

      const cachePath = CM.fs.joinPath(this.cacheDir, `${norm}.json`);
      const meta = await CM.fs.readJsonMeta(cachePath);
      if (meta && !meta.damaged && meta.value && Date.now() - meta.mtime < DailyService.CACHE_TTL_MS) {
        return meta.value;
      }

      if (this._inFlight.has(norm)) return this._inFlight.get(norm);
      const task = this._loadDaily(norm, cachePath).finally(() => {
        this._inFlight.delete(norm);
      });
      this._inFlight.set(norm, task);
      return task;
    }

    async _loadDaily(code, cachePath) {
      const prices = await this._fetchFinmind('TaiwanStockPrice', code);
      if (!prices.length) {
        throw new CM.ValueError(`查無 ${code} 的日行情資料`);
      }

      const sharesRows = await this._fetchFinmind('TaiwanStockShareholding', code);
      const issuedByDate = [];
      let stockName = '';
      for (const r of sharesRows) {
        const n = Math.trunc(Number(r.NumberOfSharesIssued || 0));
        if (n > 0) {
          issuedByDate.push([r.date, n, r.stock_name || '']);
          if (!stockName && r.stock_name) stockName = r.stock_name;
        }
      }
      issuedByDate.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

      const fallbackDen = this._fallbackIssuedShares(code);
      const bars = [];
      let idx = 0;
      let lastIssued = issuedByDate.length ? issuedByDate[0][1] : fallbackDen;

      for (const p of prices) {
        const d = p.date || '';
        const o = Number(p.open || 0);
        const h = Number(p.max || 0);
        const l = Number(p.min || 0);
        const c = Number(p.close || 0);
        const vol = Math.trunc(Number(p.Trading_Volume || 0));

        while (idx < issuedByDate.length && issuedByDate[idx][0] <= d) {
          lastIssued = issuedByDate[idx][1];
          idx++;
        }

        const issued = lastIssued || fallbackDen;
        if (l <= 0 || h < l || c <= 0 || o <= 0 || vol < 0 || issued <= 0) continue;
        const turnover = vol / issued;
        if (turnover < 0 || turnover > 1) continue;
        bars.push([d, o, h, l, c, vol, issued, turnover, '', false]);
      }

      if (!bars.length) {
        throw new CM.ValueError(`${code} 缺少有效日 K 或發行股數資料`);
      }

      const result = {
        code,
        name: stockName,
        bars,
        source: 'FinMind (TaiwanStockPrice + TaiwanStockShareholding)',
        fetched: taipeiNow()
      };
      await CM.fs.writeJson(cachePath, result);
      return result;
    }
  }

  DailyService.FINMIND_API = 'https://api.finmindtrade.com/api/v4/data';
  DailyService.CACHE_TTL_MS = 12 * 3600 * 1000;

  CM.feed = { LocalFeedService, DailyService, parseWeek, parseMonth, calendarUrl, TDCC_URL };
})(globalThis.ChipMobile = globalThis.ChipMobile || {});
