# 台股籌碼雷達 | ChipScreener

Windows 11 離線優先的台股籌碼研究工具。此 README 為唯一專案導航入口；版本狀態不以 main 的原始 ZIP 或分支名稱推斷。

## v0.6.3-rc.1 封測候選

登入有私庫權限的 GitHub 帳號，從 [封測下載與校驗頁](https://github.com/Jimmy0916-LAI/chip-screener/pull/13#v063-rc1-download) 下載 Artifact，取出內層 `ChipScreener-v0.6.3-rc.1-Windows-x64.zip` 並核對 SHA-256。解壓到新目錄後雙擊「股票雷達.exe」。首次開啟時從首頁按「更新市場資料」，核對集保統計日與行情交易日。個股第一期快照可直接看摘要，週訊號區會提示何時欠缺連續資料。按「匯出輕量資料」後雙擊「股票雷達輕量版.html」，選取所匯出的 JSON 即可離線查詢。

換版或手動回退時，先在目前版本的「軟體設定」按「停止本機服務」，再關閉視窗。若舊版沒有此按鈕，啟動新版時依提示用工作管理員結束舊版的 `pythonw.exe`，再雙擊要使用的版本。保留兩個版本資料夾，使用原有 Windows 帳號及瀏覽器設定檔，讓策略沿用同一本機網址。集保快取及自選儲存在 `%LOCALAPPDATA%/ChipScreener`。更新失敗可重試，程式保留上次成功資料。個股持股研究可勾選「疊加日 K」。下載範圍、占用和清除入口在「資料與驗收」頁。

[本版企劃與 12 項驗收](docs/VERSION_PLAN_20261127.md) · [開發交接](PROJECT_STATE.md) · [Windows 建置與測試](.github/workflows/v063.yml)

## 01｜目前從哪裡開始

| 項目 | 正確入口 |
| --- | --- |
| 最新主線測試成品 | [v0.6.0-b06.1](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.0-b06.1) |
| Windows 下載 | [B06.1 ZIP](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45141840175/artifacts/14801579091)（有效期限 2026-12-23 16:54 台北時間） |
| 主線開發 | [b06/market-overlay](https://github.com/Jimmy0916-LAI/chip-screener/tree/b06/market-overlay) · [PR #7](https://github.com/Jimmy0916-LAI/chip-screener/pull/7) |
| 朋友 JL（獨立、禁止修改） | [b07/JL](https://github.com/Jimmy0916-LAI/chip-screener/tree/b07/JL) |
| Android 平行線 | [feat/android-mobile](https://github.com/Jimmy0916-LAI/chip-screener/tree/feat/android-mobile) |
| 版本與分支完整索引 | [VERSION_INDEX.md](https://github.com/Jimmy0916-LAI/chip-screener/blob/main/docs/VERSION_INDEX.md) |
| AI 開發交接規則 | [AGENTS.md](https://github.com/Jimmy0916-LAI/chip-screener/blob/main/AGENTS.md) |
| 外部 GitHub 資源知識庫 | [EXTERNAL_DATA_SOURCES_20261127.md](https://github.com/Jimmy0916-LAI/chip-screener/blob/main/docs/research/EXTERNAL_DATA_SOURCES_20261127.md) |

## 02｜閱讀順序

人類：README → 版本索引 → 需要的版本／下載連結。
AI：AGENTS.md → 版本索引 → 目標分支的 PROJECT_STATE.md、PRODUCT_SPEC.md、ROADMAP.md → 本次相關程式／CI；涉及行情、集保、分點、籌碼峰時再讀外部資源知識庫。

## 03｜目前的版本狀態（2026-11-27）

B06.1 是目前最新已標記的主線測試版本，GitHub Actions 四項工作流程成功；Windows 11 完整實機驗收仍待證，沒有正式 Release。B05.1 是使用者先前明確接受的版本。JL 與 Android 是平行開發，不因分支名較大而視作主線升級。
v0.6.1 整合與 v0.7.0 籌碼峰／分點研究屬後續候選，尚未正式發布。

## 04｜資料來源與研究要求

外部知識庫按 S/A/B 研究優先級登錄資料位置、實際檔案證據、用途、授權、缺陷與驗收步驟。不是已匯入或已驗收資料。禁止把受限制資料/API 金鑰推進共同 GitHub，禁止將缺值當零或以事後資料作歷史訊號。

## 05｜儲存庫說明

main 暫為導航與原始研究基線，不是最新可建置產品。原 B01–B06 堆疊 PR 尚未正式合併；保留歷史 Git refs、既有標籤與 ZIP，待獨立驗收及批准後再統一主線。不要直接從 main 的舊 ZIP 重寫整個產品。
