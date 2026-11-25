'use strict';

/**
 * 本機容錯原子儲存引擎 (LocalStore)
 * 維護 current / mirror / previous 三份已提交副本與 SHA-256 校驗，支援寫入中斷與損毀復原。
 */

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { validateOfficial, validateCalendar } = require('./tdcc.cjs');

function requireValue(condition, message) {
  if (!condition) throw Error(message);
}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNatural = n => Number.isSafeInteger(n) && n >= 0;

const SETTING_RANGES = {
  minPp: [0, 20],
  weeklyMin: [0, 10],
  feeBuy: [0, 0.03],
  feeSell: [0, 0.03],
  slip: [0, 0.03],
  retention: [0, 100],
  dropPp: [0, 30],
  peakMin: [0, 60],
  lowPosition: [5, 80],
  rangeDays: [20, 250]
};

const NUMERIC_SETTING_KEYS = [
  'weeks', 'minPp', 'weeklyMin', 'profitDays', 'feeBuy', 'feeSell',
  'slip', 'warmup', 'grid', 'retention', 'dropPp', 'lowPosition', 'peakMin', 'rangeDays'
];

function validateConfig(config) {
  requireValue(
    isRecord(config) &&
    config.format === 'chip-screener-config-v1' &&
    Array.isArray(config.presets) &&
    config.presets.length > 0,
    '方案格式無效'
  );

  for (const preset of config.presets) {
    requireValue(
      isRecord(preset) &&
      typeof preset.name === 'string' &&
      preset.name.trim() &&
      preset.name.length <= 50,
      '方案名稱無效'
    );
  }

  const allSettings = [config.applied, config.draft, ...config.presets.map(p => p.settings)];
  for (const s of allSettings) {
    requireValue(isRecord(s) && ['200', '400', '600', '1000'].includes(s.band), '策略級距無效');
    for (const key of ['needShares', 'needPeak', 'needPrice']) {
      requireValue(typeof s[key] === 'boolean', '條件無效');
    }
    for (const key of NUMERIC_SETTING_KEYS) {
      requireValue(Number.isFinite(s[key]), '設定不是數值');
    }
    for (const [key, [min, max]] of Object.entries(SETTING_RANGES)) {
      requireValue(s[key] >= min && s[key] <= max, '策略參數超出範圍');
    }
    requireValue(
      Number.isInteger(s.weeks) &&
      s.weeks >= 1 &&
      s.weeks <= 4 &&
      [150, 200, 500].includes(s.warmup) &&
      [0.75, 1, 1.25].includes(s.grid),
      '研究區間無效'
    );
  }
}

function validateWeeks(weeks) {
  requireValue(isRecord(weeks), '快照格式無效');
  for (const [day, week] of Object.entries(weeks)) {
    requireValue(
      /^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(day).toISOString().slice(0, 10) === day,
      '快照日期無效'
    );
    requireValue(
      isRecord(week) && isRecord(week.rows) && isRecord(week.quality) && week.observed === null,
      '快照內容無效'
    );

    const rows = Object.entries(week.rows);
    const quality = week.quality;
    requireValue(
      rows.length > 0 &&
      quality.valid === rows.length &&
      isNatural(quality.invalid) &&
      typeof quality.raw_source === 'string' &&
      quality.raw_source.startsWith('手動匯入 '),
      '快照來源或覆蓋數無效'
    );

    for (const [code, row] of rows) {
      requireValue(
        /^[1-9][0-9]{3}$/.test(code) &&
        Array.isArray(row) &&
        row.length === 10 &&
        row.every(isNatural) &&
        row[0] > 0,
        '股票或股數無效'
      );
      for (const [start, limit] of [[2, row[0]], [6, row[1]]]) {
        for (let i = start; i < start + 4; i++) {
          requireValue(row[i] <= (i === start ? limit : row[i - 1]), '累積級距不一致');
        }
      }
    }
  }
}

const VALIDATORS = {
  settings: validateConfig,
  snapshot: validateWeeks,
  official: validateOfficial,
  calendar: validateCalendar
};

function validate(kind, value) {
  requireValue(Object.hasOwn(VALIDATORS, kind), '未知儲存類型');
  VALIDATORS[kind](value);
}

function computeChecksum(body) {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

class LocalStore {
  constructor(directory) {
    this.directory = directory;
  }

  filename(kind, slot) {
    return path.join(this.directory, `${kind}.${slot}.json`);
  }

  read(kind) {
    requireValue(Object.hasOwn(VALIDATORS, kind), '未知儲存類型');
    let damaged = false;
    let best = { value: null, revision: 0, slot: null };

    for (const slot of ['current', 'mirror', 'previous']) {
      try {
        const raw = fs.readFileSync(this.filename(kind, slot), 'utf8');
        const { body, sha256 } = JSON.parse(raw);
        requireValue(
          body.schema === 1 &&
          body.kind === kind &&
          isNatural(body.revision) &&
          body.revision > 0 &&
          computeChecksum(body) === sha256,
          '校驗失敗'
        );
        validate(kind, body.value);
        // 相同 revision 依 current -> mirror -> previous 優先
        if (body.revision > best.revision) {
          best = { value: body.value, revision: body.revision, slot, raw };
        }
      } catch (error) {
        if (error.code !== 'ENOENT') damaged = true;
      }
    }

    return { ...best, damaged };
  }

  atomic(kind, slot, raw) {
    const target = this.filename(kind, slot);
    const stage = `${target}.tmp`;
    const fd = fs.openSync(stage, 'w', 0o600);
    try {
      fs.writeFileSync(fd, raw, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (fs.readFileSync(stage, 'utf8') !== raw) {
      throw Error('暫存檔讀回不一致');
    }
    fs.renameSync(stage, target);
  }

  save(kind, value) {
    validate(kind, value);
    fs.mkdirSync(this.directory, { recursive: true });
    const old = this.read(kind);
    if (old.damaged && !old.slot) {
      throw Error('所有副本均損毀，保留原檔待復原');
    }
    if (old.raw) {
      this.atomic(kind, 'previous', old.raw);
    }

    const body = { schema: 1, kind, revision: old.revision + 1, value };
    const raw = JSON.stringify({ body, sha256: computeChecksum(body) });
    this.atomic(kind, 'current', raw);

    // 主檔 rename 已完成提交；鏡像寫入失敗不應回滾主檔
    try {
      this.atomic(kind, 'mirror', raw);
      return { redundant: true };
    } catch {
      return { redundant: false };
    }
  }
}

module.exports = { LocalStore, validateWeeks, validateConfig };
