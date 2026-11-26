/**
 * 美股全市場（S&P 500 + 關鍵 ADR/ETF）資料與雙模式量化篩選服務
 * 移植自 scripts/providers/us_market.py：
 * 1. 美股總覽（四大指數、10 年期美債殖利率、VIX 恐慌指數與產業強弱快照）
 * 2. S&P 500 全市場雙模式篩選（機構資金吸籌／超跌估值修正），背景漸進掃描併發上限為 6
 * 3. 任意美股個股 2 年日 K、MA5/10/20/60/200、RSI(14)、MACD(12,26,9)、CMF(20)、52 週位階與結構評析
 */
(function (CM) {
  'use strict';

  const VALID_US_SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,7}$/;

  const US_OVERVIEW_INDICES = [
    ['^GSPC', 'S&P 500', '指數'],
    ['^IXIC', 'Nasdaq', '指數'],
    ['^DJI', '道瓊工業', '指數'],
    ['^SOX', '費城半導體', '半導體'],
    ['^TNX', '美債10Y殖利率', '利率%'],
    ['^VIX', 'VIX 恐慌指數', '波動']
  ];

  // 32 檔優先掃描旗艦代表（確保首次載入數秒內即可呈現重點標的，同時背景續掃全部 S&P 500）
  const US_UNIVERSE = [
    ['AAPL', 'Apple 蘋果', '資訊科技'],
    ['MSFT', 'Microsoft 微軟', '資訊科技'],
    ['NVDA', 'NVIDIA 輝達', '資訊科技'],
    ['GOOGL', 'Alphabet 谷歌 A', '通訊服務'],
    ['AMZN', 'Amazon 亞馬遜', '非必需消費'],
    ['META', 'Meta 臉書', '通訊服務'],
    ['TSLA', 'Tesla 特斯拉', '非必需消費'],
    ['TSM', 'TSMC 台積電 ADR', '半導體 ADR / ETF'],
    ['AVGO', 'Broadcom 博通', '資訊科技'],
    ['AMD', 'AMD 超微', '資訊科技'],
    ['INTC', 'Intel 英特爾', '資訊科技'],
    ['MU', 'Micron 美光', '資訊科技'],
    ['ASML', 'ASML 艾司摩爾', '半導體 ADR / ETF'],
    ['QCOM', 'Qualcomm 高通', '資訊科技'],
    ['ARM', 'Arm 安謀', '半導體 ADR / ETF'],
    ['ORCL', 'Oracle 甲骨文', '資訊科技'],
    ['PLTR', 'Palantir', '資訊科技'],
    ['SMCI', 'Super Micro 美超微', '資訊科技'],
    ['SPY', 'SPDR S&P 500 ETF', '半導體 ADR / ETF'],
    ['QQQ', 'Invesco Nasdaq 100', '半導體 ADR / ETF'],
    ['SOXX', 'iShares 半導體 ETF', '半導體 ADR / ETF'],
    ['VOO', 'Vanguard S&P 500', '半導體 ADR / ETF'],
    ['TLT', '20年期美債 ETF', '半導體 ADR / ETF'],
    ['GLD', 'SPDR 黃金 ETF', '半導體 ADR / ETF'],
    ['BRK-B', '波克夏海瑟威 B', '金融'],
    ['JPM', 'JPMorgan 摩根大通', '金融'],
    ['V', 'Visa 威士卡', '金融'],
    ['COST', 'Costco 好市多', '必需消費'],
    ['NFLX', 'Netflix 網飛', '通訊服務'],
    ['LLY', 'Eli Lilly 禮來', '醫療保健'],
    ['UNH', 'UnitedHealth 聯合健康', '醫療保健'],
    ['XOM', 'ExxonMobil 埃克森美孚', '能源']
  ];

  function roundPy(x, digits = 0) {
    const v = CM.util.pyRound(x, digits);
    return Object.is(v, -0) ? 0 : v;
  }

  function fmtFixed(x, digits) {
    return roundPy(x, digits).toFixed(digits);
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function taipeiNowStr() {
    const p = CM.time.taipeiParts();
    return `${p.date} ${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)} +08:00`;
  }

  function tsToDay(ts, gmtOffsetSec) {
    const dt = new Date((ts + gmtOffsetSec) * 1000);
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
  }

  /**
   * 載入完整 S&P 500（+ 關鍵 ADR/ETF）清單，優先排列 32 檔旗艦代表便於漸進式先出結果。
   * 行動版改自 CM.base.usUniverse 讀取，不足 400 檔時回退至 32 檔旗艦清單。
   */
  function loadSp500Universe() {
    const priorityRank = new Map();
    for (let i = 0; i < US_UNIVERSE.length; i++) {
      priorityRank.set(US_UNIVERSE[i][0], i);
    }
    const raw = CM.base && Array.isArray(CM.base.usUniverse) ? CM.base.usUniverse : null;
    if (raw && raw.length > 0) {
      try {
        const tuples = [];
        for (let i = 0; i < raw.length; i++) {
          const item = raw[i];
          let code, name, sector;
          if (Array.isArray(item)) {
            code = item[0];
            name = item[1];
            sector = item[2];
          } else if (item && typeof item === 'object') {
            code = item.code;
            name = item.name;
            sector = item.sector;
          }
          if (code) {
            tuples.push([String(code), String(name ?? ''), String(sector ?? '')]);
          }
        }
        tuples.sort((a, b) => {
          const ra = priorityRank.has(a[0]) ? priorityRank.get(a[0]) : 9999;
          const rb = priorityRank.has(b[0]) ? priorityRank.get(b[0]) : 9999;
          if (ra !== rb) return ra - rb;
          return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
        });
        if (tuples.length >= 400) return tuples;
      } catch {
        // 回退至預設 32 檔旗艦代表
      }
    }
    return US_UNIVERSE.map(entry => [entry[0], entry[1], entry[2]]);
  }

  let _cachedUniverse = null;
  let _cachedUniverseMap = null;

  function getFullUniverse() {
    if (_cachedUniverse === null) {
      _cachedUniverse = loadSp500Universe();
    }
    return _cachedUniverse;
  }

  function getUniverseMap() {
    if (_cachedUniverseMap === null) {
      const map = Object.create(null);
      const list = getFullUniverse();
      for (let i = 0; i < list.length; i++) {
        map[list[i][0]] = [list[i][1], list[i][2]];
      }
      _cachedUniverseMap = map;
    }
    return _cachedUniverseMap;
  }

  function computeSma(values, period) {
    const out = new Array(values.length);
    let running = 0.0;
    for (let i = 0; i < values.length; i++) {
      running += values[i];
      if (i >= period) {
        running -= values[i - period];
      }
      out[i] = i + 1 >= period ? roundPy(running / period, 4) : null;
    }
    return out;
  }

  function computeEma(values, period) {
    if (!values.length) return [];
    const k = 2.0 / (period + 1);
    const out = new Array(values.length);
    let emaVal = null;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (i + 1 < period) {
        out[i] = null;
      } else if (i + 1 === period) {
        let sum = 0.0;
        for (let j = 0; j < period; j++) sum += values[j];
        emaVal = sum / period;
        out[i] = emaVal;
      } else {
        emaVal = (v - emaVal) * k + emaVal;
        out[i] = emaVal;
      }
    }
    return out;
  }

  function computeRsiSeries(closes, period = 14) {
    const n = closes.length;
    const out = new Array(n).fill(null);
    if (n <= period) return out;

    const gains = new Array(n).fill(0.0);
    const losses = new Array(n).fill(0.0);
    for (let i = 1; i < n; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains[i] = diff;
      else losses[i] = -diff;
    }

    let gainSum = 0.0;
    let lossSum = 0.0;
    for (let i = 1; i <= period; i++) {
      gainSum += gains[i];
      lossSum += losses[i];
    }
    let avgGain = gainSum / period;
    let avgLoss = lossSum / period;
    out[period] = avgLoss === 0 ? 100.0 : roundPy(100.0 - 100.0 / (1.0 + avgGain / avgLoss), 2);

    for (let i = period + 1; i < n; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
      out[i] = avgLoss === 0 ? 100.0 : roundPy(100.0 - 100.0 / (1.0 + avgGain / avgLoss), 2);
    }
    return out;
  }

  function computeMacdSeries(closes) {
    const n = closes.length;
    const ema12 = computeEma(closes, 12);
    const ema26 = computeEma(closes, 26);
    const dif = new Array(n);
    const validDif = [];
    for (let i = 0; i < n; i++) {
      const a = ema12[i];
      const b = ema26[i];
      if (a !== null && b !== null) {
        const d = roundPy(a - b, 4);
        dif[i] = d;
        validDif.push([i, d]);
      } else {
        dif[i] = null;
      }
    }
    const dea = new Array(n).fill(null);
    const hist = new Array(n).fill(null);
    if (validDif.length >= 9) {
      const k = 2.0 / 10.0;
      let sum = 0.0;
      for (let j = 0; j < 9; j++) sum += validDif[j][1];
      let emaD = sum / 9.0;
      const firstIdx = validDif[8][0];
      dea[firstIdx] = roundPy(emaD, 4);
      hist[firstIdx] = roundPy(dif[firstIdx] - emaD, 4);
      for (let j = 9; j < validDif.length; j++) {
        const [idx, val] = validDif[j];
        emaD = (val - emaD) * k + emaD;
        dea[idx] = roundPy(emaD, 4);
        hist[idx] = roundPy(val - emaD, 4);
      }
    }
    return { dif, dea, hist };
  }

  /** Chaikin Money Flow (20 日機構資金流向指標)，範圍 [-1, +1] */
  function _computeCmf20(bars) {
    const win = bars.slice(-20);
    if (win.length < 15) return null;
    let mfVolSum = 0.0;
    let volSum = 0.0;
    for (let i = 0; i < win.length; i++) {
      const b = win[i];
      const h = Number(b[2]);
      const l = Number(b[3]);
      const c = Number(b[4]);
      const v = Number(b[5]);
      if (v <= 0) continue;
      const mult = h > l ? ((c - l) - (h - c)) / (h - l) : 0.0;
      mfVolSum += mult * v;
      volSum += v;
    }
    if (volSum <= 0) return null;
    return roundPy(mfVolSum / volSum, 3);
  }

  /** 20 日上漲成交量／下跌成交量比（IBD 機構吃貨量比） */
  function _computeUdVolRatio(bars) {
    if (bars.length < 16) return null;
    const win = bars.slice(-21);
    let upV = 0.0;
    let dnV = 0.0;
    for (let i = 1; i < win.length; i++) {
      const cCur = Number(win[i][4]);
      const cPrev = Number(win[i - 1][4]);
      const v = Number(win[i][5]);
      if (cCur > cPrev) upV += v;
      else if (cCur < cPrev) dnV += v;
    }
    if (upV <= 0 && dnV <= 0) return null;
    if (dnV <= 0) return 5.0;
    return roundPy(Math.min(9.99, upV / dnV), 2);
  }

  /** OBV 能量潮是否站上 20 日均線且近 20 日淨上升 */
  function _computeObvRising(bars) {
    if (bars.length < 25) return false;
    const obv = [0.0];
    for (let i = 1; i < bars.length; i++) {
      const curC = Number(bars[i][4]);
      const prevC = Number(bars[i - 1][4]);
      const v = Number(bars[i][5]);
      const prevObv = obv[obv.length - 1];
      if (curC > prevC) obv.push(prevObv + v);
      else if (curC < prevC) obv.push(prevObv - v);
      else obv.push(prevObv);
    }
    let sum20 = 0.0;
    for (let i = obv.length - 20; i < obv.length; i++) sum20 += obv[i];
    const obvMa20 = sum20 / 20.0;
    const lastObv = obv[obv.length - 1];
    return lastObv > obvMa20 && lastObv > obv[obv.length - 21];
  }

  /** 20 日 2 倍標準差布林通道 %B 位階（0 = 下軌、0.5 = 中軌、1 = 上軌） */
  function _computeBbPos(closes) {
    if (closes.length < 20) return null;
    const w = closes.slice(-20);
    let sum = 0.0;
    for (let i = 0; i < 20; i++) sum += w[i];
    const mean = sum / 20.0;
    let varSum = 0.0;
    for (let i = 0; i < 20; i++) {
      const d = w[i] - mean;
      varSum += d * d;
    }
    const std = Math.sqrt(varSum / 20.0);
    if (std <= 1e-9) return 0.5;
    const lower = mean - 2.0 * std;
    const upper = mean + 2.0 * std;
    return roundPy((closes[closes.length - 1] - lower) / (upper - lower), 3);
  }

  /** 從美股日 K 陣列 [date, o, h, l, c, v] 計算六大技術維度與「大資金進場／跌深撿便宜」雙模式評分 */
  function analyzeUsBars(bars, meta = null) {
    const closes = bars.map(b => Number(b[4]));
    const vols = bars.map(b => Number(b[5]));
    const last = bars[bars.length - 1];
    const prev = bars.length >= 2 ? bars[bars.length - 2] : last;
    const close = Number(last[4]);
    const openP = Number(last[1]);
    const highP = Number(last[2]);
    const lowP = Number(last[3]);
    const prevClose = Number(prev[4]);
    const chg = roundPy(close - prevClose, 2);
    const chgPct = roundPy(prevClose ? (chg / prevClose) * 100.0 : 0.0, 2);
    const ret20Pct =
      closes.length >= 21 && closes[closes.length - 21] > 0
        ? roundPy(((close - closes[closes.length - 21]) / closes[closes.length - 21]) * 100.0, 2)
        : null;

    const ma5 = computeSma(closes, 5).at(-1);
    const ma10 = computeSma(closes, 10).at(-1);
    const ma20 = computeSma(closes, 20).at(-1);
    const ma60 = computeSma(closes, 60).at(-1);
    const ma200 = computeSma(closes, 200).at(-1);
    const mv5 = computeSma(vols, 5).at(-1);
    const mv20 = computeSma(vols, 20).at(-1);
    const rsiArr = computeRsiSeries(closes, 14);
    const rsi14 = rsiArr.at(-1);
    const macdObj = computeMacdSeries(closes);
    const difLast = macdObj.dif.at(-1);
    const deaLast = macdObj.dea.at(-1);
    const histLast = macdObj.hist.at(-1);
    const histPrev = bars.length >= 2 ? macdObj.hist[macdObj.hist.length - 2] : null;

    const cmf20 = _computeCmf20(bars);
    const udVolRatio = _computeUdVolRatio(bars);
    const obvRising = _computeObvRising(bars);
    const bbPos = _computeBbPos(closes);
    const volTrend = mv5 && mv20 && mv20 > 0 ? roundPy(mv5 / mv20, 2) : 1.0;

    const recentYear = bars.slice(-252);
    let maxH = -Infinity;
    let minL = Infinity;
    for (let i = 0; i < recentYear.length; i++) {
      if (recentYear[i][2] > maxH) maxH = recentYear[i][2];
      if (recentYear[i][3] < minL) minL = recentYear[i][3];
    }
    const hi52 = Number((meta && meta.fiftyTwoWeekHigh) || maxH);
    const lo52 = Number((meta && meta.fiftyTwoWeekLow) || minL);
    const pos52 = hi52 > lo52 ? roundPy(((close - lo52) / (hi52 - lo52)) * 100.0, 1) : 50.0;
    const fromHi52Pct = hi52 > 0 ? roundPy(((close - hi52) / hi52) * 100.0, 2) : 0.0;

    const bias5 = ma5 ? roundPy(((close - ma5) / ma5) * 100.0, 2) : null;
    const bias10 = ma10 ? roundPy(((close - ma10) / ma10) * 100.0, 2) : null;
    const bias20 = ma20 ? roundPy(((close - ma20) / ma20) * 100.0, 2) : null;
    const bias60 = ma60 ? roundPy(((close - ma60) / ma60) * 100.0, 2) : null;
    const bias200 = ma200 ? roundPy(((close - ma200) / ma200) * 100.0, 2) : null;

    const belowMa5 = ma5 !== null && close < ma5;
    const belowMa10 = ma10 !== null && close < ma10;
    const aboveMa200 = ma200 !== null && close >= ma200;

    let shortStatus, shortTone;
    if (ma5 === null || ma10 === null) {
      shortStatus = '均線天數不足';
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

    let midStatus, midTone;
    if (ma20 === null || ma60 === null) {
      midStatus = '均線天數不足';
      midTone = 'neutral';
    } else if (close >= ma20 && close >= ma60 && (ma200 === null || close >= ma200)) {
      midStatus = '站穩月線、季線與年線';
      midTone = 'up';
    } else if (close < ma20 && close < ma60) {
      midStatus = '位於月季線之下' + (ma200 && close < ma200 ? '（失守年線）' : '');
      midTone = 'down';
    } else {
      midStatus = '中期均線震盪整理';
      midTone = 'neutral';
    }

    let rsiStatus, rsiTone;
    if (rsi14 === null) {
      rsiStatus = 'RSI 資料不足';
      rsiTone = 'neutral';
    } else if (rsi14 >= 70) {
      rsiStatus = `高檔超買 (${fmtFixed(rsi14, 1)})`;
      rsiTone = 'up';
    } else if (rsi14 >= 55) {
      rsiStatus = `動能偏強 (${fmtFixed(rsi14, 1)})`;
      rsiTone = 'up';
    } else if (rsi14 <= 30) {
      rsiStatus = `低檔超賣 (${fmtFixed(rsi14, 1)})`;
      rsiTone = 'down';
    } else if (rsi14 <= 45) {
      rsiStatus = `動能偏弱 (${fmtFixed(rsi14, 1)})`;
      rsiTone = 'down';
    } else {
      rsiStatus = `動能中性 (${fmtFixed(rsi14, 1)})`;
      rsiTone = 'neutral';
    }

    let macdStatus, macdTone;
    if (histLast === null) {
      macdStatus = 'MACD 資料不足';
      macdTone = 'neutral';
    } else if (histPrev !== null && histPrev <= 0 && histLast > 0) {
      macdStatus = 'MACD 黃金交叉轉強';
      macdTone = 'up';
    } else if (histPrev !== null && histPrev >= 0 && histLast < 0) {
      macdStatus = 'MACD 死亡交叉轉弱';
      macdTone = 'down';
    } else if (histLast > 0) {
      macdStatus = 'MACD 多頭紅柱';
      macdTone = 'up';
    } else {
      macdStatus = 'MACD 空頭綠柱';
      macdTone = 'down';
    }

    const vol = Math.trunc(Number(last[5]));
    const volRatio = mv5 && mv5 > 0 ? roundPy(vol / mv5, 2) : 1.0;
    let volStatus, volTone;
    if (chg > 0 && volRatio >= 1.2) {
      volStatus = `價漲量增 (${fmtFixed(volRatio, 2)}x)`;
      volTone = 'up';
    } else if (chg < 0 && volRatio >= 1.2) {
      volStatus = `帶量回檔 (${fmtFixed(volRatio, 2)}x)`;
      volTone = 'down';
    } else if (volRatio < 0.75) {
      volStatus = `量縮整理 (${fmtFixed(volRatio, 2)}x)`;
      volTone = 'neutral';
    } else {
      volStatus = `量能溫和 (${fmtFixed(volRatio, 2)}x)`;
      volTone = 'neutral';
    }

    let posStatus, posTone;
    if (pos52 >= 80) {
      posStatus = `52週高檔區 (${fmtFixed(pos52, 0)}%)`;
      posTone = 'up';
    } else if (pos52 <= 25) {
      posStatus = `52週低檔區 (${fmtFixed(pos52, 0)}%)`;
      posTone = 'down';
    } else {
      posStatus = `52週中軸區 (${fmtFixed(pos52, 0)}%)`;
      posTone = 'neutral';
    }

    // ----- 模式 A：大資金進場 (Smart Money Accumulation) -----
    let smartScore = 0;
    const smartReasons = [];
    if (cmf20 !== null) {
      if (cmf20 >= 0.12) {
        smartScore += 30;
        smartReasons.push(`CMF強吸籌 +${fmtFixed(cmf20, 2)}`);
      } else if (cmf20 >= 0.05) {
        smartScore += 20;
        smartReasons.push(`CMF資金淨流入 +${fmtFixed(cmf20, 2)}`);
      } else if (cmf20 > 0) {
        smartScore += 8;
      }
    }
    if (udVolRatio !== null) {
      if (udVolRatio >= 1.5) {
        smartScore += 25;
        smartReasons.push(`20日買賣量比 ${fmtFixed(udVolRatio, 2)}x`);
      } else if (udVolRatio >= 1.2) {
        smartScore += 16;
        smartReasons.push(`買盤量佔優 ${fmtFixed(udVolRatio, 2)}x`);
      }
    }
    if (obvRising) {
      smartScore += 15;
      smartReasons.push('OBV能量潮走揚');
    }
    if (ma20 !== null && close >= ma20) {
      if (ma60 !== null && close >= ma60) {
        smartScore += 15;
        smartReasons.push('站穩月季線');
      } else {
        smartScore += 8;
        smartReasons.push('站上月線');
      }
    }
    if (aboveMa200) {
      smartScore += 5;
    }
    if (volTrend >= 1.15 || (close > openP && volRatio >= 1.25)) {
      smartScore += 10;
      smartReasons.push('量能升溫放量');
    }
    const smartPass =
      cmf20 !== null &&
      cmf20 >= 0.05 &&
      udVolRatio !== null &&
      udVolRatio >= 1.2 &&
      ma20 !== null &&
      close >= ma20 &&
      smartScore >= 55;

    // ----- 模式 B：跌深撿便宜 (Deep Oversold / Mean-Reversion Dip) -----
    let dipScore = 0;
    const dipReasons = [];
    if (fromHi52Pct <= -25.0) {
      dipScore += 25;
      dipReasons.push(`距高點回檔 ${fmtFixed(fromHi52Pct, 1)}%`);
    } else if (fromHi52Pct <= -15.0) {
      dipScore += 18;
      dipReasons.push(`自高點修正 ${fmtFixed(fromHi52Pct, 1)}%`);
    } else if (fromHi52Pct <= -10.0) {
      dipScore += 10;
      dipReasons.push(`回檔 ${fmtFixed(fromHi52Pct, 1)}%`);
    }
    if (rsi14 !== null) {
      if (rsi14 <= 30) {
        dipScore += 30;
        dipReasons.push(`RSI深度超賣 ${fmtFixed(rsi14, 1)}`);
      } else if (rsi14 <= 38) {
        dipScore += 20;
        dipReasons.push(`RSI低檔 ${fmtFixed(rsi14, 1)}`);
      } else if (rsi14 <= 45) {
        dipScore += 10;
      }
    }
    if (bbPos !== null) {
      if (bbPos <= 0.12) {
        dipScore += 20;
        dipReasons.push('觸及布林下軌');
      } else if (bbPos <= 0.25) {
        dipScore += 12;
        dipReasons.push('近布林下緣');
      }
    }
    if (bias20 !== null && bias20 <= -6.0) {
      dipScore += 10;
      dipReasons.push(`負乖離 ${fmtFixed(bias20, 1)}%`);
    } else if (bias20 !== null && bias20 <= -3.0) {
      dipScore += 5;
    }
    if (aboveMa200) {
      dipScore += 10;
      dipReasons.push('守200日年線');
    } else if (cmf20 !== null && cmf20 > -0.05) {
      dipScore += 10;
      dipReasons.push('修正期間資金穩定');
    }
    const lowerWick = highP > lowP ? (Math.min(openP, close) - lowP) / (highP - lowP) : 0.0;
    if (lowerWick >= 0.4) {
      dipScore += 5;
      dipReasons.push('下影線承接');
    }
    const dipPass =
      fromHi52Pct <= -12.0 &&
      ((rsi14 !== null && rsi14 <= 38) || (bbPos !== null && bbPos <= 0.15)) &&
      dipScore >= 50;

    // 綜合結構與背離提醒
    const shortBull = ma5 !== null && ma10 !== null && !belowMa5 && !belowMa10;
    let divergence = '';
    let ovLabel, ovTone, ovSummary;
    if ((belowMa5 || belowMa10) && rsi14 !== null && rsi14 <= 32) {
      ovLabel = '短線超賣區（留意止跌反彈）';
      ovTone = 'neutral';
      divergence = `RSI 超賣提醒 (${fmtFixed(rsi14, 1)})`;
      ovSummary = `收盤低於短期均線且 RSI(14) 進入 ${fmtFixed(rsi14, 1)} 超賣區，可留意量縮止跌或站回 5 日線訊號。`;
    } else if (smartPass) {
      ovLabel = '機構資金吸籌偏多結構';
      ovTone = 'up';
      ovSummary = `符合機構資金吸籌條件（${smartReasons.slice(0, 3).join(' · ')}），量價與資金流向一致偏多。`;
    } else if (shortBull && macdTone === 'up') {
      ovLabel = '美股均線與 MACD 多頭共振';
      ovTone = 'up';
      ovSummary = `站上 5 日與 10 日均線且 ${macdStatus}，RSI(14)=${rsi14 !== null ? rsi14 : '—'}，多方動能一致。`;
    } else if (shortBull && rsi14 !== null && rsi14 >= 72) {
      ovLabel = '強勢高檔（RSI 過熱留意乖離）';
      ovTone = 'up';
      divergence = `RSI 過熱警戒 (${fmtFixed(rsi14, 1)})`;
      ovSummary = `股價維持多頭但 RSI(14) 達 ${fmtFixed(rsi14, 1)} 且 52 週位階 ${fmtFixed(pos52, 0)}%，宜留意短線乖離修正。`;
    } else if (!shortBull && macdTone === 'down') {
      ovLabel = '短均承壓且 MACD 偏空';
      ovTone = 'down';
      ovSummary = '收盤位於 5 日／10 日均線之下且 MACD 維持空方柱，建議靜待均線重新站回與動能翻多。';
    } else {
      ovLabel = '均線震盪整理格局';
      ovTone = 'neutral';
      ovSummary = `短中期均線與指標呈分歧震盪（${shortStatus}、${macdStatus}），宜觀察量能變化與支撐守穩情況。`;
    }

    return {
      price: roundPy(close, 2),
      prevClose: roundPy(prevClose, 2),
      change: chg,
      changePct: chgPct,
      ret20Pct: ret20Pct,
      tradeDate: last[0],
      ma5: ma5 !== null ? roundPy(ma5, 2) : null,
      ma10: ma10 !== null ? roundPy(ma10, 2) : null,
      ma20: ma20 !== null ? roundPy(ma20, 2) : null,
      ma60: ma60 !== null ? roundPy(ma60, 2) : null,
      ma200: ma200 !== null ? roundPy(ma200, 2) : null,
      bias5Pct: bias5,
      bias10Pct: bias10,
      bias20Pct: bias20,
      bias60Pct: bias60,
      bias200Pct: bias200,
      belowMa5,
      belowMa10,
      aboveMa200,
      cmf20,
      udVolRatio,
      obvRising,
      bbPos,
      volTrend,
      smartMoney: { pass: smartPass, score: Math.min(100, smartScore), reasons: smartReasons },
      dipBuy: { pass: dipPass, score: Math.min(100, dipScore), reasons: dipReasons },
      shortMa: {
        ma5: ma5 ? roundPy(ma5, 2) : null,
        ma10: ma10 ? roundPy(ma10, 2) : null,
        bias5Pct: bias5,
        bias10Pct: bias10,
        belowMa5,
        belowMa10,
        status: shortStatus,
        tone: shortTone
      },
      midMa: {
        ma20: ma20 ? roundPy(ma20, 2) : null,
        ma60: ma60 ? roundPy(ma60, 2) : null,
        ma200: ma200 ? roundPy(ma200, 2) : null,
        bias20Pct: bias20,
        bias60Pct: bias60,
        bias200Pct: bias200,
        status: midStatus,
        tone: midTone
      },
      rsi: { value: rsi14, status: rsiStatus, tone: rsiTone },
      macd: {
        dif: difLast !== null ? roundPy(difLast, 3) : null,
        dea: deaLast !== null ? roundPy(deaLast, 3) : null,
        hist: histLast !== null ? roundPy(histLast, 3) : null,
        status: macdStatus,
        tone: macdTone
      },
      volume: {
        vol,
        mv5: mv5 ? roundPy(mv5, 0) : null,
        volRatio,
        status: volStatus,
        tone: volTone
      },
      range52w: {
        high: roundPy(hi52, 2),
        low: roundPy(lo52, 2),
        posPct: pos52,
        fromHighPct: fromHi52Pct,
        status: posStatus,
        tone: posTone
      },
      overall: {
        label: ovLabel,
        tone: ovTone,
        summary: ovSummary,
        divergenceAlert: divergence
      },
      rsiSeries: rsiArr.slice(-60),
      macdSeries: {
        dates: bars.slice(-60).map(b => b[0]),
        dif: macdObj.dif.slice(-60),
        dea: macdObj.dea.slice(-60),
        hist: macdObj.hist.slice(-60)
      }
    };
  }

  function _summarizeScreenerRows(rows, totalUniverse, done, scanning, updatedAt) {
    const sectorBuckets = Object.create(null);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!sectorBuckets[r.sector]) sectorBuckets[r.sector] = [];
      sectorBuckets[r.sector].push(r);
    }
    const sortedSectors = Object.entries(sectorBuckets).sort((a, b) => {
      if (b[1].length !== a[1].length) return b[1].length - a[1].length;
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    });
    const sectors = sortedSectors.map(([secName, secRows]) => {
      let chgSum = 0.0;
      let upCnt = 0;
      for (let i = 0; i < secRows.length; i++) {
        chgSum += secRows[i].changePct;
        if (secRows[i].changePct > 0) upCnt++;
      }
      return {
        name: secName,
        count: secRows.length,
        avgChangePct: roundPy(chgSum / secRows.length, 2),
        upCount: upCnt,
        downCount: secRows.length - upCnt
      };
    });

    let smartCnt = 0;
    let dipCnt = 0;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].smartPass) smartCnt++;
      if (rows[i].dipPass) dipCnt++;
    }
    return {
      updatedAt,
      count: rows.length,
      universeTotal: totalUniverse,
      scanning,
      progress: { done, total: totalUniverse },
      counts: { total: rows.length, smartMoney: smartCnt, dipBuy: dipCnt },
      sectors,
      rows
    };
  }

  class UsMarketService {
    constructor(cacheDir = 'us-cache-v1') {
      this.cacheDir = String(cacheDir || 'us-cache-v1').replace(/\/+$/, '');
      this._scanning = false;
      this._scanDone = 0;
      this._scanTotal = 0;
      this._scanRows = [];
      this._scanUpdatedAt = '';
      this._scanPromise = null;
      this._firstBatchPromise = null;
      this._resolveFirstBatch = null;
      this._detailInFlight = new Map();
    }

    async init() {
      this._scanTotal = getFullUniverse().length;
    }

    _cachePath(name) {
      return CM.fs.joinPath(this.cacheDir, name);
    }

    async _readFresh(relPath, ttlSec) {
      const meta = await CM.fs.readJsonMeta(relPath);
      if (!meta || meta.damaged || !meta.value) return null;
      if (Date.now() - meta.mtime < ttlSec * 1000) return meta.value;
      return null;
    }

    async _readAny(relPath) {
      return CM.fs.readJson(relPath, null);
    }

    async _writeJson(relPath, payload) {
      await CM.fs.writeJson(relPath, payload);
    }

    async _fetchChartRaw(code, rangeStr = '1y') {
      const encoded = encodeURIComponent(code);
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=${rangeStr}&interval=1d`;
      let lastErr = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const rawBytes = await CM.news.httpGet(url, 11);
          const payload = JSON.parse(CM.util.utf8Decode(rawBytes));
          const chart = (payload && payload.chart) || {};
          const results = chart.result;
          if (!results || !results.length) {
            const errMsg = (chart.error && chart.error.description) || `查無美股代號 ${code}`;
            throw new CM.ValueError(errMsg);
          }
          const res = results[0];
          const meta = res.meta || {};
          const gmtOffset = parseInt(meta.gmtoffset, 10) || -18000;
          const tsList = res.timestamp || [];
          const q = ((res.indicators && res.indicators.quote) || [{}])[0] || {};
          const opens = q.open || [];
          const highs = q.high || [];
          const lows = q.low || [];
          const closes = q.close || [];
          const vols = q.volume || [];

          const len = Math.min(tsList.length, opens.length, highs.length, lows.length, closes.length, vols.length);
          const byDay = Object.create(null);
          for (let i = 0; i < len; i++) {
            const ts = tsList[i];
            const o = opens[i];
            const h = highs[i];
            const l = lows[i];
            const c = closes[i];
            const v = vols[i];
            if (ts == null || o == null || h == null || l == null || c == null) continue;
            if (o <= 0 || h < l || l <= 0 || c <= 0) continue;
            const d = tsToDay(ts, gmtOffset);
            byDay[d] = [
              d,
              roundPy(Number(o), 2),
              roundPy(Number(h), 2),
              roundPy(Number(l), 2),
              roundPy(Number(c), 2),
              Math.trunc(Number(v || 0))
            ];
          }
          const days = Object.keys(byDay).sort();
          const bars = days.map(k => byDay[k]);
          if (!bars.length) {
            throw new CM.ValueError(`查無 ${code} 的有效美股日行情資料`);
          }
          return [bars, meta];
        } catch (err) {
          lastErr = err;
          if (err && typeof err.status === 'number') {
            if (err.status === 429 && attempt === 0) {
              await CM.util.sleep(700);
              continue;
            }
            throw err;
          }
          if (attempt === 0) {
            await CM.util.sleep(350);
            continue;
          }
          throw err;
        }
      }
      throw lastErr || new CM.ValueError(`無法取得 ${code}`);
    }

    async getDetail(code, forceRefresh = false) {
      const sym = String(code || '').trim().toUpperCase().replace(/\./g, '-');
      if (!VALID_US_SYMBOL_RE.test(sym)) {
        throw new CM.ValueError('請輸入有效美股代號（如 NVDA、AAPL、TSM、SPY、BRK-B）');
      }

      const cacheFile = this._cachePath(`detail-${sym}.json`);
      if (!forceRefresh) {
        const cached = await this._readFresh(cacheFile, UsMarketService.DETAIL_TTL);
        if (cached && cached.tech && 'cmf20' in cached.tech) {
          return cached;
        }
      }

      const flightKey = `${sym}:${forceRefresh ? '1' : '0'}`;
      if (this._detailInFlight.has(flightKey)) {
        return this._detailInFlight.get(flightKey);
      }

      const task = (async () => {
        const [bars, meta] = await this._fetchChartRaw(sym, '2y');
        const tech = analyzeUsBars(bars, meta);
        const uMap = getUniverseMap();
        const preset = uMap[sym] || ['', ''];
        const presetName = preset[0];
        const presetSector = preset[1];
        const displayName = presetName || meta.longName || meta.shortName || sym;
        const result = {
          code: sym,
          name: displayName,
          sector: presetSector || meta.instrumentType || 'EQUITY',
          exchange: meta.fullExchangeName || meta.exchangeName || 'US',
          currency: meta.currency || 'USD',
          bars,
          tech,
          source: 'Yahoo Finance (US 2Y Daily OHLCV)',
          fetched: taipeiNowStr()
        };
        await this._writeJson(cacheFile, result);
        return result;
      })();

      this._detailInFlight.set(flightKey, task);
      try {
        return await task;
      } finally {
        this._detailInFlight.delete(flightKey);
      }
    }

    async _scanOneScreener(entry) {
      const [sym, name, sector] = entry;
      try {
        const [bars, meta] = await this._fetchChartRaw(sym, '1y');
        const tech = analyzeUsBars(bars, meta);
        const flags = [];
        if (!tech.belowMa5 && !tech.belowMa10) flags.push('aboveShortMa');
        if (tech.belowMa5) flags.push('belowMa5');
        if (tech.belowMa10) flags.push('belowMa10');
        if (tech.aboveMa200) flags.push('aboveMa200');
        if (tech.macd.tone === 'up') flags.push('macdBull');
        if (tech.cmf20 !== null && tech.cmf20 >= 0.05) flags.push('cmfPos');
        const rsiVal = tech.rsi.value;
        if (rsiVal !== null && rsiVal >= 60) flags.push('rsiStrong');
        if (rsiVal !== null && rsiVal <= 35) flags.push('rsiLow');
        if (tech.volume.volRatio >= 1.3) flags.push('volSurge');
        if (tech.smartMoney.pass) flags.push('smartMoney');
        if (tech.dipBuy.pass) flags.push('dipBuy');
        return {
          code: sym,
          name,
          sector,
          exchange: meta.fullExchangeName || 'US',
          price: tech.price,
          change: tech.change,
          changePct: tech.changePct,
          ret20Pct: tech.ret20Pct,
          tradeDate: tech.tradeDate,
          ma5: tech.ma5,
          ma10: tech.ma10,
          ma20: tech.ma20,
          ma60: tech.ma60,
          ma200: tech.ma200,
          rsi14: rsiVal,
          cmf20: tech.cmf20,
          udVolRatio: tech.udVolRatio,
          obvRising: tech.obvRising,
          bbPos: tech.bbPos,
          macdStatus: tech.macd.status,
          macdTone: tech.macd.tone,
          vol: tech.volume.vol,
          volRatio: tech.volume.volRatio,
          pos52w: tech.range52w.posPct,
          fromHighPct: tech.range52w.fromHighPct,
          shortStatus: tech.shortMa.status,
          shortTone: tech.shortMa.tone,
          smartPass: tech.smartMoney.pass,
          smartScore: tech.smartMoney.score,
          smartReasons: tech.smartMoney.reasons,
          dipPass: tech.dipBuy.pass,
          dipScore: tech.dipBuy.score,
          dipReasons: tech.dipBuy.reasons,
          overallLabel: tech.overall.label,
          overallTone: tech.overall.tone,
          flags
        };
      } catch {
        return null;
      }
    }

    async _runFullScanWorker() {
      const cacheFile = this._cachePath('sp500-screener.json');
      const universe = getFullUniverse();
      const total = universe.length;
      const collected = [];
      let done = 0;
      const batchSize = 36;

      try {
        for (let start = 0; start < total; start += batchSize) {
          await CM.lifecycle.waitActive();
          const chunk = universe.slice(start, start + batchSize);
          const results = await CM.util.pool(chunk, 6, async entry => {
            await CM.lifecycle.waitActive();
            return this._scanOneScreener(entry);
          });
          for (let i = 0; i < results.length; i++) {
            if (results[i]) collected.push(results[i]);
          }
          done = Math.min(total, start + chunk.length);
          this._scanDone = done;
          this._scanRows = collected.slice();
          this._scanUpdatedAt = taipeiNowStr();
          if (this._resolveFirstBatch) {
            this._resolveFirstBatch();
            this._resolveFirstBatch = null;
          }
        }

        const finalTs = taipeiNowStr();
        const payload = _summarizeScreenerRows(collected, total, total, false, finalTs);
        if (collected.length >= 30) {
          await this._writeJson(cacheFile, payload);
          // 完整掃描完成後清除舊的總覽快取，確保總覽與全市場篩選數字完全同步
          try {
            await CM.fs.remove(this._cachePath('overview.json'));
          } catch {
            // 忽略不存在或刪除錯誤
          }
        }
      } finally {
        this._scanning = false;
        this._scanDone = total;
        this._scanPromise = null;
        if (this._resolveFirstBatch) {
          this._resolveFirstBatch();
          this._resolveFirstBatch = null;
        }
      }
    }

    async startBackgroundScan() {
      if (this._scanning) return false;
      this._scanning = true;
      this._scanDone = 0;
      this._scanTotal = getFullUniverse().length;

      let resolveFirst;
      this._firstBatchPromise = new Promise(resolve => {
        resolveFirst = resolve;
      });
      this._resolveFirstBatch = resolveFirst;

      if (!this._scanRows.length) {
        // 若有舊快取先留著顯示，避免畫面空白
        const old = await this._readAny(this._cachePath('sp500-screener.json'));
        if (old && Array.isArray(old.rows) && old.rows.length) {
          this._scanRows = old.rows.slice();
          this._scanUpdatedAt = old.updatedAt || '';
        }
      }

      this._scanPromise = this._runFullScanWorker().catch(() => {});
      return true;
    }

    async _waitForInitialBatch() {
      if (this._scanRows.length || !this._scanning || !this._firstBatchPromise) return;
      await Promise.race([this._firstBatchPromise, CM.util.sleep(3000)]);
    }

    async getScreener(forceRefresh = false) {
      const cacheFile = this._cachePath('sp500-screener.json');
      const universeLen = getFullUniverse().length;
      if (!forceRefresh) {
        if (this._scanning) {
          return _summarizeScreenerRows(
            this._scanRows.slice(),
            this._scanTotal || universeLen,
            this._scanDone,
            true,
            this._scanUpdatedAt || taipeiNowStr()
          );
        }
        const cached = await this._readFresh(cacheFile, UsMarketService.SCREENER_TTL);
        if (cached && (cached.count || 0) >= 400 && cached.counts) {
          return {
            ...cached,
            scanning: false,
            progress: { done: cached.count, total: universeLen }
          };
        }
      }

      await this.startBackgroundScan();
      await this._waitForInitialBatch();

      return _summarizeScreenerRows(
        this._scanRows.slice(),
        this._scanTotal || universeLen,
        this._scanDone,
        this._scanning,
        this._scanUpdatedAt || taipeiNowStr()
      );
    }

    async getOverview(forceRefresh = false) {
      const cacheFile = this._cachePath('overview.json');
      const universeLen = getFullUniverse().length;
      const spCache = await this._readFresh(this._cachePath('sp500-screener.json'), UsMarketService.SCREENER_TTL);
      const spReady = Boolean(spCache && (spCache.count || 0) >= 400 && spCache.counts);

      if (!forceRefresh) {
        const cached = await this._readFresh(cacheFile, UsMarketService.OVERVIEW_TTL);
        if (cached && cached.indices && cached.indices.length && !this._scanning) {
          if ((cached.universeCount || 0) >= 400) {
            return cached;
          }
          if (spReady) {
            const rows = spCache.rows || [];
            const ranked = rows.slice().sort((a, b) => b.changePct - a.changePct);
            const synced = {
              ...cached,
              sectors: (spCache.sectors || []).slice(0, 8),
              counts: spCache.counts,
              leaders: ranked.slice(0, 5),
              laggards: ranked.length >= 5 ? ranked.slice(-5).reverse() : [],
              universeCount: spCache.count,
              scanning: false,
              progress: { done: spCache.count, total: universeLen }
            };
            await this._writeJson(cacheFile, synced);
            return synced;
          }
        }
      }

      const indices = await CM.util.pool(US_OVERVIEW_INDICES, 6, async ([sym, name, tag]) => {
        let q = null;
        try {
          q = await CM.news.fetchYahooQuote(sym);
        } catch {
          q = null;
        }
        return {
          symbol: sym,
          name,
          tag,
          price: q ? q.price : null,
          change: q ? q.change : null,
          changePct: q ? q.changePct : null,
          tradeTime: q ? q.tradeTime : ''
        };
      });

      let scanningNow = false;
      let doneCnt = universeLen;
      let rows, sectors, counts;
      if (!forceRefresh && spReady) {
        rows = spCache.rows || [];
        sectors = spCache.sectors || [];
        counts = spCache.counts || {};
        doneCnt = rows.length;
      } else {
        await this.startBackgroundScan();
        await this._waitForInitialBatch();
        rows = this._scanRows.slice();
        scanningNow = this._scanning;
        doneCnt = this._scanDone || rows.length;
        const summary = _summarizeScreenerRows(rows, universeLen, doneCnt, scanningNow, '');
        sectors = summary.sectors;
        counts = summary.counts;
      }

      const ranked = rows.slice().sort((a, b) => b.changePct - a.changePct);
      const result = {
        updatedAt: taipeiNowStr(),
        indices,
        sectors: sectors.slice(0, 8),
        counts,
        leaders: ranked.slice(0, 5),
        laggards: ranked.length >= 5 ? ranked.slice(-5).reverse() : [],
        universeCount: rows.length,
        scanning: scanningNow,
        progress: { done: doneCnt, total: universeLen }
      };
      // 僅在掃描完成且覆蓋完整母體時才寫入長效總覽快取，避免過渡數字殘留
      if (!scanningNow && rows.length >= 400) {
        await this._writeJson(cacheFile, result);
      }
      return result;
    }
  }

  UsMarketService.OVERVIEW_TTL = 10 * 60;
  UsMarketService.SCREENER_TTL = 4 * 3600;
  UsMarketService.DETAIL_TTL = 2 * 3600;

  const api = {
    UsMarketService,
    analyzeUsBars,
    computeSma,
    computeEma,
    computeRsiSeries,
    computeMacdSeries,
    loadSp500Universe,
    VALID_US_SYMBOL_RE,
    US_OVERVIEW_INDICES,
    US_UNIVERSE
  };

  Object.defineProperty(api, 'FULL_US_UNIVERSE', {
    enumerable: true,
    configurable: true,
    get: getFullUniverse
  });

  Object.defineProperty(api, 'US_UNIVERSE_MAP', {
    enumerable: true,
    configurable: true,
    get: getUniverseMap
  });

  CM.usMarket = api;
})(globalThis.ChipMobile = globalThis.ChipMobile || {});
