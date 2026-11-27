# 版本與分支索引

快照日期：2026-11-28（Asia/Taipei）。按開發順序列出，不代表所有分支已合併。SHA 為整理前已核對的版本／分支檢查點；文件提交不變更產品 tag。

## 最新封測

| 版本 | 程式提交 | 下載與驗收 |
| --- | --- | --- |
| [v0.6.5-rc.3](https://github.com/Jimmy0916-LAI/chip-screener/releases/tag/v0.6.5-rc.3) | `6e3657b27c843fcc4a25095781913309e4bc2fcc` · [PR #15](https://github.com/Jimmy0916-LAI/chip-screener/pull/15) | [Windows x64 ZIP](https://github.com/Jimmy0916-LAI/chip-screener/releases/download/v0.6.5-rc.3/ChipScreener-v0.6.5-rc.3-Windows-x64.zip) · [CI 與截圖](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/46054836274)。Windows Server 2022 通過，Windows 11 x64 實機待驗。 |

ZIP SHA-256 `8c1ea508dead1d7dae411bd9f32fd1fea582f07ff337f8a1ba172385534ae57b`。本次程式分支另接 PR #14。

## 歷史封測

[RC2 下載](https://github.com/Jimmy0916-LAI/chip-screener/releases/tag/v0.6.5-rc.2) 保留作為回溯。

## 上一封測 v0.6.5-rc.1

| 版本 | 提交／範圍 | 下載與驗收 |
| --- | --- | --- |
| [v0.6.5-rc.1](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.5-rc.1) | `f72af65a8c87ab43c9923c4d948c17830a716ad6`。多條件篩選、四家 AI、Windows 雙入口。 | [Windows x64 成品](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/46037810623/artifacts/15219321239) · [CI](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/46037810623) · [PR #14 下載與校驗](https://github.com/Jimmy0916-LAI/chip-screener/pull/14#v065-rc1-download)。Windows Server 2022 通過，Windows 11 實機與獨立複驗待驗。 |

內層 ZIP SHA-256 為 `a146c9ae68e7f5589f9c4bde4dac48b80bc937c614c82c95b7d8105b723841c3`，於 2026-12-28 00:57:36 台北時間到期。

## 上一封測

| 版本 | 提交／範圍 | 下載與驗收 |
| --- | --- | --- |
| [v0.6.3-rc.1](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.3-rc.1) | `7d0f59a0b7acd540ab23099438eedd4bea0418c6`。集保首更與快取保留、日 K 疊圖、Windows 雙入口、手動換版。 | [Windows x64 Artifact](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45992810449/artifacts/15193938549) · [CI](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45992810449) · [PR #13](https://github.com/Jimmy0916-LAI/chip-screener/pull/13#v063-rc1-download)。獨立複驗已確認，Windows 11 x64 實機待補驗。 |

內層 ZIP SHA-256 為 `77f213eb1b4784b343931440be90c0a41a2b0726a92dc58da43f1ad3de9de6d0`，到期時間為 2026-12-27 19:44:40 台北時間。交接見 [PROJECT_STATE](../PROJECT_STATE.md)。

## 01｜主線版本（由舊至新）

| 批次 / 版本 | 分支 | 產品提交 / 版本標籤 | PR | 狀態與用途 |
| --- | --- | --- | --- | --- |
| v0.4 研究封存 | main | 93baab7（原始研究 ZIP） | — | 凍結研究基準；main 現為導航 |
| B00 管理規格 | docs/v06-development-governance | 83e7520 | [#1](https://github.com/Jimmy0916-LAI/chip-screener/pull/1) | 管理制度 |
| B01 v0.5 基線 | b01/v05-baseline | 0411661（分支檢查點） | [#2](https://github.com/Jimmy0916-LAI/chip-screener/pull/2) | 七頁、可重建基線驗證 |
| B02 v0.6 portable | b02/windows-offline-portable | 970952a | [#3](https://github.com/Jimmy0916-LAI/chip-screener/pull/3) | 單檔 EXE，Server 成品通過 |
| B03.1 | b03/local-storage | 91c96f2 | [#4](https://github.com/Jimmy0916-LAI/chip-screener/pull/4) | 本機資料儲存 |
| B03.2 | b03/local-storage | [v0.6.0-b03.2](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.0-b03.2) · 00afe6b | [#4](https://github.com/Jimmy0916-LAI/chip-screener/pull/4) | 多副本復原修正 |
| B04.1 | b04/weekly-screen | [v0.6.0-b04.1](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.0-b04.1) · faf3047 | [#5](https://github.com/Jimmy0916-LAI/chip-screener/pull/5) | 大戶篩選及同窗 A/B |
| B04.2 | b04/weekly-screen | [v0.6.0-b04.2](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.0-b04.2) · b7415d5 | [#5](https://github.com/Jimmy0916-LAI/chip-screener/pull/5) | 嚴格預設週與重開 |
| B05.1 | b05/tdcc-weekly-update | [v0.6.0-b05.1](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.0-b05.1) · 2d6249a | [#6](https://github.com/Jimmy0916-LAI/chip-screener/pull/6) | 集保更新；使用者接受 |
| B06.1 | b06/market-overlay | [v0.6.0-b06.1](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.0-b06.1) · be72aa3 | [#7](https://github.com/Jimmy0916-LAI/chip-screener/pull/7) | 名單、日行情、同日期疊圖、篩選說明、自選股；四項 CI 成功，實機待驗 |

詳細歷史驗收：[PROJECT_STATE.md](https://github.com/Jimmy0916-LAI/chip-screener/blob/v0.6.0-b06.1/PROJECT_STATE.md)（止於 B05）；[B06 CI](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45141840175)。整理時有五個主線 tag、零正式 Release；不能把 Artifact 或 draft PR 當正式 Release。

## 02｜所有現有分支（整理前 14 個）

| 分組 | Branch | 核對 SHA | 用途 |
| --- | --- | --- | --- |
| 00 入口 | [main](https://github.com/Jimmy0916-LAI/chip-screener/tree/main) | 93baab7 | 原始 ZIP、導航 |
| 01 管理 | [docs/v06-development-governance](https://github.com/Jimmy0916-LAI/chip-screener/tree/docs/v06-development-governance) | 83e7520 | 管理規格 |
| 02 主線 B01 | [b01/v05-baseline](https://github.com/Jimmy0916-LAI/chip-screener/tree/b01/v05-baseline) | 0411661 | 基線 |
| 03 主線 B02 | [b02/windows-offline-portable](https://github.com/Jimmy0916-LAI/chip-screener/tree/b02/windows-offline-portable) | 9a00191 | Windows 封裝 |
| 04 主線 B03 | [b03/local-storage](https://github.com/Jimmy0916-LAI/chip-screener/tree/b03/local-storage) | c23299c | 儲存 |
| 05 主線 B04 | [b04/weekly-screen](https://github.com/Jimmy0916-LAI/chip-screener/tree/b04/weekly-screen) | 77d5af7 | 週篩選 |
| 06 主線 B05 | [b05/tdcc-weekly-update](https://github.com/Jimmy0916-LAI/chip-screener/tree/b05/tdcc-weekly-update) | 7517beb | 集保更新 |
| 07 主線 B06 | [b06/market-overlay](https://github.com/Jimmy0916-LAI/chip-screener/tree/b06/market-overlay) | be72aa3 | 最新主線成品基準 |
| 08 協作者 | [b07/JL](https://github.com/Jimmy0916-LAI/chip-screener/tree/b07/JL) | 84fd627b35866659159502f51c099be6eb9bbf6a | **保留原樣，只讀；不是 ROADMAP 的 B07 主線批次** |
| 09 手機 | [feat/android-mobile](https://github.com/Jimmy0916-LAI/chip-screener/tree/feat/android-mobile) | 941b801 | Android 平行開發 |
| 10 研究 | [research/external-data-sources-20261127](https://github.com/Jimmy0916-LAI/chip-screener/tree/research/external-data-sources-20261127) | c58f544 | 外部資料候選登錄，PR #9 |
| 90 歷史 | [chip-radar-v06-preflight](https://github.com/Jimmy0916-LAI/chip-screener/tree/chip-radar-v06-preflight) | 9a47092 | 早期 Windows 預檢 |
| 91 歷史 | [chip-radar-v06-validation](https://github.com/Jimmy0916-LAI/chip-screener/tree/chip-radar-v06-validation) | 7f56c6e | 早期驗證 |
| 92 歷史 | [portable-v06-delivery](https://github.com/Jimmy0916-LAI/chip-screener/tree/portable-v06-delivery) | 93baab7 | 早期交付分支，原 main 同 SHA |

上述分組是導航排序，不是改名；舊 PR 的 base/head、tag 及歷史 refs 保留。未提供可靠原子改名／刪除操作時不建立重複 alias，不刪分支。原 PR #1–#7 為堆疊依賴，PR #9 為研究文件；整理前全部 open、未合併。

## 03｜上傳封存與下一次開發

| 版本（由舊至新） | 封存標籤 | 內容 |
| --- | --- | --- |
| 0.6.1 | [v0.6.1-archive](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.1-archive/archives/v0.6.1) | JL 上傳原件，內部 Electron 套件標為 `0.6.0-b05.1` |
| 0.6.2 | [v0.6.2-windows-x64](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.2-windows-x64/archives/v0.6.2) | [Windows x64 ZIP](https://github.com/Jimmy0916-LAI/chip-screener/raw/refs/tags/v0.6.2-windows-x64/archives/v0.6.2/ChipScreener-v0.6.2-Windows-x64.zip)，內含 Python 執行環境 |

v0.6.3 曾從 [`feat/v0.6.2-runtime-integration`](https://github.com/Jimmy0916-LAI/chip-screener/tree/feat/v0.6.2-runtime-integration) 起步。分支以 B06.1 為基座，附上 v0.6.2 Windows x64 ZIP 供整合。歷史上傳可從 [v0.6.2-full](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.2-full/archives/v0.6.2) 和 [v0.6.2-archive](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.2-archive/archives/v0.6.2) 回溯。該 ZIP 的完整性、SHA-256 與內部版本已通過 [Actions 驗證](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45947545481/job/140335601737)。

## 04｜後續開發規劃

- v0.6.1：主線與 JL 功能比較、模組化整合、B06 回歸、免安裝與資料容錯驗收。
- v0.7.0：集保歷史回補、統一資料庫、分點研究、籌碼峰；具體版本範圍由所有者批准。
- 新分支按用途前綴 + 目標版本 + 英文短名；版本 tag 不移動、正式版不提前宣稱。
- 外部研究索引：[EXTERNAL_DATA_SOURCES_20261127.md](https://github.com/Jimmy0916-LAI/chip-screener/blob/main/docs/research/EXTERNAL_DATA_SOURCES_20261127.md)。
