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
  ['screen', '◎', '全市場篩選'],
  ['stock', '⌁', '個股研究'],
  ['backtest', '◷', '回測與比較'],
  ['peak', '▥', '底峰研究'],
  ['settings', '⚙', '策略設定'],
  ['data', '≡', '資料與驗收']
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
