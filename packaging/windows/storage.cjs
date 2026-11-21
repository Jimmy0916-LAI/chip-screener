'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function requireValue(condition, message) { if (!condition) throw Error(message); }
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const natural = n => Number.isSafeInteger(n) && n >= 0;
function validateConfig(config) {
  requireValue(record(config) && config.format === 'chip-screener-config-v1' && Array.isArray(config.presets) && config.presets.length, '方案格式無效');
  for (const preset of config.presets) requireValue(record(preset) && typeof preset.name === 'string' && preset.name.trim() && preset.name.length <= 50, '方案名稱無效');
  for (const s of [config.applied, config.draft, ...config.presets.map(p => p.settings)]) {
    requireValue(record(s) && ['200','400','600','1000'].includes(s.band), '策略級距無效');
    for (const key of ['needShares','needPeak','needPrice']) requireValue(typeof s[key] === 'boolean', '條件無效');
    for (const key of ['weeks','minPp','weeklyMin','profitDays','feeBuy','feeSell','slip','warmup','grid','retention','dropPp','lowPosition','peakMin','rangeDays']) requireValue(Number.isFinite(s[key]), '設定不是數值');
    const ranges = {minPp:[0,20],weeklyMin:[0,10],feeBuy:[0,.03],feeSell:[0,.03],slip:[0,.03],
      retention:[0,100],dropPp:[0,30],peakMin:[0,60],lowPosition:[5,80],rangeDays:[20,250]};
    for (const [key,[min,max]] of Object.entries(ranges)) requireValue(s[key]>=min && s[key]<=max, '策略參數超出範圍');
    requireValue(Number.isInteger(s.weeks) && s.weeks >= 1 && s.weeks <= 4 && [150,200,500].includes(s.warmup) && [.75,1,1.25].includes(s.grid), '研究區間無效');
  }
}

function validateWeeks(weeks) {
  requireValue(record(weeks), '快照格式無效');
  for (const [day, week] of Object.entries(weeks)) {
    requireValue(/^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(day).toISOString().slice(0,10) === day, '快照日期無效');
    requireValue(record(week) && record(week.rows) && record(week.quality) && week.observed === null, '快照內容無效');
    const rows = Object.entries(week.rows), q = week.quality;
    requireValue(rows.length > 0 && q.valid === rows.length && natural(q.invalid) && typeof q.raw_source === 'string' && q.raw_source.startsWith('手動匯入 '), '快照來源或覆蓋數無效');
    for (const [code,r] of rows) {
      requireValue(/^[1-9][0-9]{3}$/.test(code) && Array.isArray(r) && r.length === 10 && r.every(natural) && r[0] > 0, '股票或股數無效');
      for (const [start, limit] of [[2,r[0]],[6,r[1]]]) {
        for(let i=start; i<start+4; i++) requireValue(r[i] <= (i===start ? limit : r[i-1]), '累積級距不一致');
      }
    }
  }
}

const validators = {settings: validateConfig, snapshot: validateWeeks};
function validate(kind, value) {
  requireValue(Object.hasOwn(validators, kind), '未知儲存類型');
  validators[kind](value);
}
const checksum = body => createHash('sha256').update(JSON.stringify(body)).digest('hex');

class LocalStore {
  constructor(directory) { this.directory = directory; }
  filename(kind, slot) { return path.join(this.directory, kind + '.' + slot + '.json'); }
  read(kind) {
    requireValue(Object.hasOwn(validators, kind), '未知儲存類型');
    let damaged = false;
    let best = {value:null, revision:0, slot:null};
    for (const slot of ['current','mirror','previous']) {
      try {
        const raw = fs.readFileSync(this.filename(kind,slot), 'utf8');
        const {body, sha256} = JSON.parse(raw);
        requireValue(body.schema === 1 && body.kind === kind && natural(body.revision) && body.revision > 0 && checksum(body) === sha256, '校驗失敗');
        validate(kind, body.value);
        // Equal revisions use current, then mirror, then previous.
        if (body.revision > best.revision) best = {value:body.value, revision:body.revision, slot, raw};
      } catch (error) {
        if (error.code !== 'ENOENT') damaged = true;
      }
    }
    return {...best, damaged};
  }
  atomic(kind, slot, raw) {
    const target = this.filename(kind, slot), stage = target + '.tmp';
    const fd = fs.openSync(stage, 'w', 0o600);
    try { fs.writeFileSync(fd,raw,'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if(fs.readFileSync(stage,'utf8') !== raw) throw Error('暫存檔讀回不一致');
    fs.renameSync(stage,target);
  }
  save(kind,value) {
    validate(kind,value);
    fs.mkdirSync(this.directory,{recursive:true});
    const old = this.read(kind);
    if (old.damaged && !old.slot) throw Error('所有副本均損毀，保留原檔待復原');
    if (old.raw) this.atomic(kind,'previous',old.raw);
    const body = {schema:1,kind,revision:old.revision+1,value};
    const raw = JSON.stringify({body,sha256:checksum(body)});
    this.atomic(kind,'current',raw);
    // The rename committed the value. A failed redundant copy cannot undo it.
    try { this.atomic(kind,'mirror',raw); return {redundant:true}; }
    catch { return {redundant:false}; }
  }
}
module.exports = { LocalStore, validateWeeks, validateConfig };
