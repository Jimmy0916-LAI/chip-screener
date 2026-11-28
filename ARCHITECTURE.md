# 架構與功能盤點

## 六個邏輯模組

下列路徑以 [RC4 程式樹](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.5-rc.4/desktop) 為準。R01 維持實體目錄。Windows C 啟動器載入隨包 Python，啟動 localhost 服務及瀏覽器視窗。建置腳本將 JavaScript、CSS 及資料嵌入應用頁面。

| 模組 | RC4 實作與責任 | 目標邊界 |
| --- | --- | --- |
| UI／UX | `src/renderer/app.js`、`pages`、`components` 負責導覽、畫面與操作 | 依賴明確查詢／命令，集中錯誤和進度呈現 |
| 量化研究 | `core/weekly-engine.js`、`signal-engine.js`、`peak-model.js` | 明確接收母體、可用時點與資料版本，輸出判定及原因 |
| AI | `scripts/providers/ai_router.py`、`news_briefing.py`、`channels.py`、`ai_trader.py` | 路由、憑證及模擬與行情資料隔離，測試採替身 |
| 資料服務與儲存 | `serve_local.py`、`core/storage-adapter.js`；服務快取在使用者資料目錄，策略與手動資料依賴瀏覽器設定檔 | 資料版本、相容與遷移由儲存服務控制 |
| 資料來源 Provider | `scripts/market.py`、`weekly_evidence.py`、`providers/tw_market.py` 等 | 將來源資料轉為標準輸入，保留來源證據 |
| 更新與發布 | `launcher.c`、`scripts/launcher.py`、`providers/updater.py`、`package.py`、`.github/workflows/v065-history.yml` | 更新器管理完整包與切換狀態；市場資料另有更新生命週期 |

資料流為 Provider → 驗證、版本化快取 → 研究引擎或本機 API → UI 與匯出。未來共享資料查詢介面依 [資料契約](docs/DATA_SCHEMA.md) 設計。優先抽離 `app.js` 的狀態／HTTP 配接與 `serve_local.py` 的路由責任，先用固定案例鎖定行為，分批提交，可退回前一提交或候選包。

## 功能盤點

| 狀態 | 功能與證據 |
| --- | --- |
| 已實現並驗證 | 七頁、固定母體集保週篩、畫面／CSV、同窗週策略 A/B、2330 集保歷史、日 K 疊圖、策略保存正常路徑、自選與升降版回歸。範圍見 [Windows CI](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/46067740266) 與 [驗收紀錄](ACCEPTANCE.md)。 |
| 已存在但未驗證 | 既有四家 AI 路由與三入口有模擬測試，付費真實呼叫待驗。MACD／前高有固定案例，全市場日 K 覆蓋未驗。Windows 11 實機待驗。 |
| 故障 | 版本套用、回退和重啟 API 回 409，發行缺 manifest。策略拒寫仍報成功，手動 CSV 可收不存在日期及空值轉零。底峰基準受後續行情影響。見 `serve_local.py:1032`、`storage-adapter.js:68`、`data-io.js:135`、`peak-model.js:65`。 |
| 尚未實作 | 正式收益回測、可重播歷史股票池、完整包更新協議、共享資料中心。現行線上名單僅更新名稱與市場，乾淨案日 K 快取為 0。 |
| 已取消 | 獨立 HTML 產品及後續驗收。RC4 既有資產保留。 |
| 待決策 | 動態母體範圍、多條件 A/B、歷史證據認定、券商分點授權及正式發布條件。見 [決策](docs/DECISIONS.md)。 |
