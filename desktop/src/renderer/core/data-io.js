/**
 * CSV 匯入驗證、CSV / JSON 檔案下載匯出工具
 */

function download(filename, contents, mime) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function csvDownload(filename, rows) {
  if (!rows?.length) {
    toast('沒有可匯出的資料');
    return;
  }
  const columns = Object.keys(rows[0]);
  const quote = value => {
    const s = String(value ?? '');
    return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
  };
  const lines = [
    columns.map(quote).join(','),
    ...rows.map(row => columns.map(k => quote(row[k])).join(','))
  ];
  download(filename, '\ufeff' + lines.join('\r\n'), 'text/csv;charset=utf-8-sig');
}

function exportScreener() {
  const rows = state.showList;
  csvDownload(
    `chip_screener_${state.win}_${applied.band}.csv`,
    rows.map(x => ({
      code: x.code,
      name: x.name,
      market: x.market,
      window: state.win,
      as_of: state.asOf || evidenceTime(state.win),
      reason: x.reason,
      band: applied.band,
      state: x.status,
      total_pp: x.gain ?? '',
      weekly_changes: x.delta?.join('|') ?? '',
      weekly_shares: x.deltaShares?.join('|') ?? '',
      known_by: x.knownDate ?? '',
      ...(x.signals ? {
        signal_date: x.signals.day, signal_as_of: x.signals.asOf,
        signal_mode: applied.signals.mode,
        signal_conditions: JSON.stringify(x.signals.conditions)
      } : {}),
      data_version: D.run
    }))
  );
}

function compareExport(model) {
  return model.rows.map(x => ({
    code: x.code,
    name: x.name,
    window: model.a.end,
    as_of: model.a.asOf,
    A_weeks: model.a.cfg.weeks,
    A_dates: model.a.dates.join('|'),
    A_state: x.a.status,
    A_reason: x.a.reason,
    A_gain_pp: x.a.gain ?? '',
    B_weeks: model.b.cfg.weeks,
    B_dates: model.b.dates.join('|'),
    B_state: x.b.status,
    B_reason: x.b.reason,
    B_gain_pp: x.b.gain ?? '',
    data_version: D.run
  }));
}

function parseCSV(text) {
  const lines = [];
  let row = [];
  let str = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        str += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        str += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(str);
      str = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(str);
      if (row.some(x => x.trim() !== '')) lines.push(row);
      row = [];
      str = '';
    } else {
      str += ch;
    }
  }
  if (row.length || str) {
    row.push(str);
    lines.push(row);
  }
  return lines;
}

async function importTDCC(files) {
  const successes = [];
  const errors = [];

  for (const file of files) {
    try {
      const content = await file.text();
      const lines = parseCSV(content.replace(/^\uFEFF/, ''));
      const head = lines.shift();
      const indexes = {};
      for (const k of ['資料日期', '證券代號', '持股分級', '人數', '股數']) {
        indexes[k] = head.indexOf(k);
        if (indexes[k] < 0) throw Error('缺少欄位 ' + k);
      }

      let day = '';
      const byCode = {};
      for (const cols of lines) {
        const readCol = k => cols[indexes[k]]?.trim();
        const rawday = readCol('資料日期');
        if (!/^\d{8}$/.test(rawday)) continue;
        if (day && day !== rawday) throw Error('同一檔案含有不同統計日');
        day = rawday;

        const code = readCol('證券代號');
        if (!/^\d{4}$/.test(code) || code[0] === '0') continue;

        const lvl = Number(readCol('持股分級'));
        const shares = Number(readCol('股數'));
        const holders = Number(readCol('人數'));
        if (
          !Number.isInteger(lvl) || lvl < 1 || lvl > 17 ||
          !Number.isSafeInteger(shares) || !Number.isSafeInteger(holders) ||
          shares < 0 || holders < 0
        ) {
          continue;
        }

        const codeRow = (byCode[code] ||= {});
        if (codeRow[lvl]) throw Error('出現同個股同級距重複資料：' + code);
        codeRow[lvl] = [shares, holders];
      }

      if (!day) throw Error('沒有符合的資料日期');
      const ds = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
      if (D.series[ds] && (!officialWeeks[ds] || savedWeeks[ds])) {
        throw Error('日期 ' + ds + ' 已存在，不允許覆蓋原始版本');
      }

      const valid = {};
      let excluded = 0;
      const areas = [[11, 15], [12, 15], [13, 15], [15, 15]];

      for (const [code, row] of Object.entries(byCode)) {
        if (Object.keys(row).length !== 17 || !row[17]) {
          excluded++;
          continue;
        }
        const den = row[17][0];
        const holders = row[17][1];
        if (den <= 0 || sumLevels(row, 1, 15, 0) - row[16][0] !== den || sumLevels(row, 1, 15, 1) !== holders) {
          excluded++;
          continue;
        }
        valid[code] = [
          den,
          holders,
          ...areas.map(([lo, hi]) => sumLevels(row, lo, hi, 0)),
          ...areas.map(([lo, hi]) => sumLevels(row, lo, hi, 1))
        ];
      }

      if (!Object.keys(valid).length) throw Error('沒有通過股數／戶數核對的股票');

      saveWeek(ds, valid, excluded, file.name);
      if (officialWeeks[ds]) applyWeek(ds, officialWeeks[ds]);
      successes.push(`${ds}：${Object.keys(valid).length} 檔通過，${excluded} 檔排除`);
    } catch (e) {
      errors.push(`${file.name}：${e.message}`);
    }
  }

  state.importCount += successes.length;
  if (successes.length && !state.manualWeek) useDefaultWeek();
  render();
  const msg = [...successes, ...errors].join('；');
  toast(msg || '沒有匯入資料');
  const statusEl = $('#importStatus');
  if (statusEl) statusEl.textContent = msg;
}
