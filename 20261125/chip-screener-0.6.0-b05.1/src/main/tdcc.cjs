'use strict';

/**
 * 官方資料解析與驗證模組 (TDCC 集保 1-5 CSV & TWSE FMTQIK 交易日曆)
 * 執行 1–17 級分級對帳（含第 16 級差異調整）、95% 母體覆蓋檢核與民國年交易日驗證。
 */

const { createHash } = require('node:crypto');

const TDCC = 'https://opendata.tdcc.com.tw/getOD.ashx?id=1-5';
const calendarURL = month =>
  `https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date=${month.replace('-', '')}01&response=json`;

const REQUIRED_TDCC_FIELDS = ['資料日期', '證券代號', '持股分級', '人數', '股數', '占集保庫存數比例%'];
const BAND_START_LEVELS = [11, 12, 13, 15]; // 200 / 400 / 600 / 1,000 張以上
const ETF_CODE_RE = /^00\d{2,4}[A-Z]?$/;

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const taipei = date => new Date(date.getTime() + 8 * 3600000).toISOString().replace('Z', '+08:00');
const isNatural = n => Number.isSafeInteger(n) && n >= 0;

function check(ok, message) {
  if (!ok) throw Error(message);
}

function dayISO(str) {
  check(
    /^\d{4}-\d{2}-\d{2}$/.test(str) &&
    Number.isFinite(Date.parse(str)) &&
    new Date(str).toISOString().slice(0, 10) === str,
    '日期無效 ' + str
  );
  return str;
}

function parseWeek(bytes, universe, fetched) {
  const lines = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim().split(/\r?\n/);
  const fields = lines.shift().split(',').map(s => s.trim());
  const colIdx = REQUIRED_TDCC_FIELDS.map(name => fields.indexOf(name));
  check(colIdx.every(i => i >= 0) && new Set(fields).size === fields.length, '集保欄位缺失或重複');

  const pool = new Set(universe);
  const groups = new Map();
  const issues = {};
  const adjustments = {};
  const rows = {};
  const extraRows = {};
  let day;

  for (const line of lines) {
    const values = line.split(',');
    check(values.length === fields.length, '集保欄數錯誤');
    const [stamp, code, lv, holders, shares] = colIdx.map(i => values[i].trim());

    if (!day) {
      check(/^\d{8}$/.test(stamp), '統計日期格式錯誤');
      day = dayISO(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6)}`);
      const weekday = new Date(day).getUTCDay();
      check(day <= fetched.slice(0, 10) && weekday !== 0 && weekday !== 6, '未來或非營業日的統計日期');
    }
    check(stamp === day.replaceAll('-', ''), '同份集保檔混有不同日期');
    if (!pool.has(code) && !ETF_CODE_RE.test(code)) continue;

    if (!groups.has(code)) groups.set(code, new Map());
    const levels = groups.get(code);
    const level = Number(lv);
    const validNumbers = [holders, shares].every(s => /^\d+$/.test(s) && isNatural(Number(s)));

    if (!/^\d+$/.test(lv) || level < 1 || level > 17 || levels.has(level) || !validNumbers) {
      issues[code] = '重複級距或股數／戶數無效';
    } else {
      levels.set(level, [Number(shares), Number(holders)]);
    }
  }

  for (const code of universe) {
    const g = groups.get(code);
    if (!g || g.size !== 17) {
      issues[code] ||= '原表缺股或缺少級距';
    }
    if (issues[code]) continue;

    const [den, count] = g.get(17);
    const sumFrom = (first, col) => {
      let total = 0;
      for (let i = first; i <= 15; i++) total += g.get(i)[col];
      return total;
    };

    const bands = [0, 1].flatMap(col => BAND_START_LEVELS.map(level => sumFrom(level, col)));
    const sharesBalanced = sumFrom(1, 0) - g.get(16)[0] === den;
    const holdersBalanced = sumFrom(1, 1) === count;
    const withinTotal = !bands.slice(0, 4).some(n => n > den);

    if (!den || !sharesBalanced || !holdersBalanced || !withinTotal) {
      issues[code] = '股數或戶數與第17級未對帳，待核';
      continue;
    }

    rows[code] = [den, count, ...bands];
    if (g.get(16).some(Boolean)) {
      adjustments[code] = g.get(16);
    }
  }

  const universeIssues = Object.fromEntries(Object.entries(issues).filter(([code]) => pool.has(code)));

  for (const [code, g] of groups.entries()) {
    if (pool.has(code) || issues[code] || g.size !== 17) continue;
    const [den, count] = g.get(17);
    const sumFrom = (first, col) => {
      let total = 0;
      for (let i = first; i <= 15; i++) total += g.get(i)[col];
      return total;
    };
    const bands = [0, 1].flatMap(col => BAND_START_LEVELS.map(level => sumFrom(level, col)));
    if (!den || sumFrom(1, 0) - g.get(16)[0] !== den || sumFrom(1, 1) !== count || bands.slice(0, 4).some(n => n > den)) {
      continue;
    }
    extraRows[code] = [den, count, ...bands];
    if (g.get(16).some(Boolean)) {
      adjustments[code] = g.get(16);
    }
  }

  const valid = Object.keys(rows).length;
  check(day && valid >= Math.ceil(pool.size * 0.95), `集保有效股票覆蓋不足 95%（${valid}/${pool.size}）`);

  return {
    day,
    rows,
    extraRows,
    issues: universeIssues,
    adjustments,
    observed: fetched,
    quality: {
      raw_source: TDCC,
      sha256: digest(bytes),
      valid,
      invalid: pool.size - valid,
      universe: pool.size,
      fetched,
      publication: null,
      validation: '1–17 級日期、股數、戶數與固定母體覆蓋驗證通過'
    }
  };
}

function validateOfficial(week) {
  dayISO(week.day);
  const q = week.quality;
  check(
    q.raw_source === TDCC &&
    /^[a-f0-9]{64}$/.test(q.sha256) &&
    week.observed === q.fetched &&
    Number.isFinite(Date.parse(q.fetched)) &&
    q.publication === null,
    '官方來源或取得紀錄無效'
  );
  check(
    Object.keys(week.rows).length === q.valid &&
    Object.keys(week.issues).length === q.invalid &&
    q.valid + q.invalid === q.universe &&
    q.valid > 0,
    '官方快照覆蓋無效'
  );
  for (const row of Object.values(week.rows)) {
    check(Array.isArray(row) && row.length === 10 && row.every(isNatural) && row[0] > 0, '官方快照數值無效');
    for (const [i, limit] of [[2, row[0]], [6, row[1]]]) {
      check(
        row[i] <= limit && row[i] >= row[i + 1] && row[i + 1] >= row[i + 2] && row[i + 2] >= row[i + 3],
        '官方累計級距無效'
      );
    }
  }
}

function parseMonth(bytes, month, fetched, known) {
  const m = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  check(
    m.stat === 'OK' &&
    m.fields[0] === '日期' &&
    m.fields.includes('成交股數') &&
    m.date === month.replace('-', '') + '01' &&
    m.data.length > 0,
    'TWSE 日曆月份或欄位不符 ' + month
  );

  const days = m.data.map(row => {
    const match = /^(\d{2,3})\/(\d{2})\/(\d{2})$/.exec(row[0]);
    check(match && Number(String(row[1]).replaceAll(',', '')) > 0, 'TWSE 交易日列無效');
    return dayISO(`${Number(match[1]) + 1911}-${match[2]}-${match[3]}`);
  });

  const monotonic = days.every((d, i) => d.startsWith(month + '-') && d <= fetched.slice(0, 10) && (!i || d > days[i - 1]));
  check(monotonic && known.every(d => days.includes(d)), 'TWSE 日曆日期倒退、錯月或缺少已知交易日');

  return {
    month,
    days,
    source: calendarURL(month),
    sha256: digest(bytes),
    fetched
  };
}

function validateCalendar(record) {
  check(
    /^\d{4}-\d\d$/.test(record.month) &&
    record.source === calendarURL(record.month) &&
    /^[a-f0-9]{64}$/.test(record.sha256) &&
    Number.isFinite(Date.parse(record.fetched)),
    '日曆來源無效'
  );
  check(
    record.days.length > 0 &&
    record.days.every((d, i) => dayISO(d).startsWith(record.month + '-') && (!i || d > record.days[i - 1])),
    '日曆交易日無效'
  );
}

module.exports = { TDCC, calendarURL, parseWeek, parseMonth, validateOfficial, validateCalendar, taipei };
