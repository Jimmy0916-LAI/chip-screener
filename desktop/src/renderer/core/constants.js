'use strict';

/**
 * 全域常數與系統設定預設值
 */

const D = INITIAL_DATA;

const BAND_NAMES = ['200', '400', '600', '1000'];

const COLORS = {
  '200': '#60a5fa',
  '400': '#34d399',
  '600': '#f59e0b',
  '1000': '#a78bfa'
};

const NAV = [
  ['home', '▦', '研究總覽'],
  ['briefing', '☀', '每日晨報'],
  ['watchlist', '★', '股票收藏夾'],
  ['paper', '◈', '模擬操盤'],
  ['screen', '◎', '全市場篩選'],
  ['stock', '⌁', '個股研究'],
  ['backtest', '◷', '回測與比較'],
  ['peak', '▥', '底峰研究'],
  ['settings', '⚙', '策略設定'],
  ['software', '⌘', '軟體設定'],
  ['data', '≡', '資料與驗收']
];

const US_NAV = [
  ['us_home', '▦', '美股總覽'],
  ['briefing', '☀', '每日晨報'],
  ['watchlist', '★', '股票收藏夾'],
  ['paper', '◈', '模擬操盤'],
  ['us_screen', '◎', '美股全市場篩選'],
  ['us_stock', '⌁', '美股個股詳情'],
  ['software', '⌘', '軟體設定']
];

const US_SUGGEST_LIST = [
  ['AAPL', 'Apple 蘋果', '科技七巨頭'],
  ['MSFT', 'Microsoft 微軟', '科技七巨頭'],
  ['NVDA', 'NVIDIA 輝達', '科技七巨頭'],
  ['GOOGL', 'Alphabet 谷歌', '科技七巨頭'],
  ['AMZN', 'Amazon 亞馬遜', '科技七巨頭'],
  ['META', 'Meta 臉書', '科技七巨頭'],
  ['TSLA', 'Tesla 特斯拉', '科技七巨頭'],
  ['TSM', 'TSMC 台積電 ADR', 'AI / 半導體'],
  ['AVGO', 'Broadcom 博通', 'AI / 半導體'],
  ['AMD', 'AMD 超微', 'AI / 半導體'],
  ['INTC', 'Intel 英特爾', 'AI / 半導體'],
  ['MU', 'Micron 美光', 'AI / 半導體'],
  ['ASML', 'ASML 艾司摩爾', 'AI / 半導體'],
  ['QCOM', 'Qualcomm 高通', 'AI / 半導體'],
  ['ARM', 'Arm 安謀', 'AI / 半導體'],
  ['ORCL', 'Oracle 甲骨文', 'AI / 半導體'],
  ['PLTR', 'Palantir', 'AI / 半導體'],
  ['SMCI', 'Super Micro 美超微', 'AI / 半導體'],
  ['SPY', 'SPDR S&P 500 ETF', '主流 ETF'],
  ['QQQ', 'Invesco Nasdaq 100', '主流 ETF'],
  ['SOXX', 'iShares 半導體 ETF', '主流 ETF'],
  ['VOO', 'Vanguard S&P 500', '主流 ETF'],
  ['DIA', 'SPDR 道瓊 ETF', '主流 ETF'],
  ['IWM', 'iShares 羅素 2000', '主流 ETF'],
  ['TLT', '20年期美債 ETF', '主流 ETF'],
  ['GLD', 'SPDR 黃金 ETF', '主流 ETF'],
  ['BRK-B', '波克夏海瑟威 B', '金融／消費／醫療'],
  ['JPM', 'JPMorgan 摩根大通', '金融／消費／醫療'],
  ['V', 'Visa 威士卡', '金融／消費／醫療'],
  ['COST', 'Costco 好市多', '金融／消費／醫療'],
  ['NFLX', 'Netflix 網飛', '金融／消費／醫療'],
  ['LLY', 'Eli Lilly 禮來', '金融／消費／醫療']
];

const DEFAULT = {
  band: '400',
  weeks: 2,
  minPp: 0.2,
  weeklyMin: 0,
  needShares: true,
  needPeak: false,
  needPrice: false,
  profitDays: 20,
  feeBuy: 0.001425,
  feeSell: 0.004425,
  slip: 0.001,
  warmup: 500,
  grid: 1,
  retention: 75,
  dropPp: 5,
  lowPosition: 40,
  peakMin: 15,
  rangeDays: 60
};

const dates = () => Object.keys(D.series).sort();
