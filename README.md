# 籌碼雷達

## [下載 Windows x64｜v0.6.5-rc.3](https://github.com/Jimmy0916-LAI/chip-screener/releases/download/v0.6.5-rc.3/ChipScreener-v0.6.5-rc.3-Windows-x64.zip)

1. 登入有此私庫權限的 GitHub 帳號，下載 Windows x64 ZIP。
2. 把成品 ZIP **全部解壓**到新版本資料夾，保留 `resources`。
3. 雙擊資料夾內的 **`股票雷達.exe`**。可用原 Windows 帳號和原瀏覽器設定檔讀取既有資料。若出現舊服務占用通知，先在舊版「軟體設定」按「停止本機服務」，再重開新版。

同一資料夾附 `股票雷達輕量版.html`。版本、雜湊、測試與舊版見 [版本索引](docs/VERSION_INDEX.md) 和 [專案狀態](PROJECT_STATE.md)。

## 最新封測｜v0.6.5-rc.3

集保個股歷史、左上角版本與雷達圖示、關閉最後一個桌面視窗後停止背景工作。[發布說明](https://github.com/Jimmy0916-LAI/chip-screener/releases/tag/v0.6.5-rc.3) · [成品 CI](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/46054836274) · [左上角與集保圖表](docs/evidence/v0.6.5-rc.3-2330.png)。Windows 11 x64 實機待驗。

## 歷史封測｜v0.6.5-rc.1

可組合集保連續增持、日線 MACD 黃金交叉及前高突破，另存方案並匯出與畫面一致的 CSV。四家 AI 供應商可獨立保存模型與金鑰，支援每日晨報、影片策略卡和 AI 模擬操盤。雙入口與集保更新沿用既有架構。

| 項目 | 紀錄 |
| --- | --- |
| 封測 Tag／完整提交 | [v0.6.5-rc.1](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.5-rc.1) · `f72af65a8c87ab43c9923c4d948c17830a716ad6` |
| Windows x64 | [下載 Artifact](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/46037810623/artifacts/15219321239)，取出內層 `ChipScreener-v0.6.5-rc.1-Windows-x64.zip`。到期為 **2026-12-28 00:57:36 台北時間**。 |
| 內層 ZIP SHA-256 | `a146c9ae68e7f5589f9c4bde4dac48b80bc937c614c82c95b7d8105b723841c3` |
| Windows Server 2022 | [成品 CI](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/46037810623) 通過 · [操作截圖](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/46037810623/artifacts/15219496482) · [PR #14 下載與校驗](https://github.com/Jimmy0916-LAI/chip-screener/pull/14#v065-rc1-download) |
| Windows 11 x64／獨立複驗 | 待實機與獨立複驗。四家付費 API 真實呼叫待驗，已用模擬回應測試。 |

## 上一封測｜v0.6.3-rc.1

集保首更後即可查看個股週摘要，更新失敗保留上次成功資料。個股持股圖可疊加日 K，另附可離線匯入快照的輕量 HTML。軟體設定提供手動換版校驗入口，啟動器在舊服務占用時提示如何停止。

| 項目 | 紀錄 |
| --- | --- |
| 封測 Tag／完整提交 | [v0.6.3-rc.1](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.3-rc.1) · `7d0f59a0b7acd540ab23099438eedd4bea0418c6` |
| Windows x64 下載 | 登入有私庫權限的 GitHub 帳號，[下載 Artifact](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45992810449/artifacts/15193938549) 後取出內層 `ChipScreener-v0.6.3-rc.1-Windows-x64.zip`。期限為 **2026-12-27 19:44:40 台北時間**。 |
| 內層 ZIP SHA-256 | `77f213eb1b4784b343931440be90c0a41a2b0726a92dc58da43f1ad3de9de6d0` |
| CI／獨立複驗 | Windows Server 2022 成品 CI 通過，使用者已確認獨立複驗。[CI 45992810449](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45992810449) · [PR #13 交付與校驗](https://github.com/Jimmy0916-LAI/chip-screener/pull/13#v063-rc1-download) |
| Windows 11 x64 實機 | 待補驗。 |

將內層 ZIP 解壓至新版本資料夾，舊版服務仍在背景時先停止，再雙擊 `股票雷達.exe`。資料夾也含 `股票雷達輕量版.html` 與 `resources/`。可從桌面匯出快照供輕量版離線匯入。

## 下載與比對基準

| 版本 | 下載與證據 | 已知狀態 |
| --- | --- | --- |
| v0.6.2 Windows x64 封存 | [下載 ZIP](https://github.com/Jimmy0916-LAI/chip-screener/raw/refs/tags/v0.6.2-windows-x64/archives/v0.6.2/ChipScreener-v0.6.2-Windows-x64.zip) · [封存標籤](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.2-windows-x64/archives/v0.6.2) · [封存驗證](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45947545481/job/140335601737) | ZIP 含 Python 執行環境，完整性、SHA-256 與內部版本已核對。Windows 執行待驗。 |
| B06.1 主線測試基準 | [版本標籤](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.0-b06.1) · [下載 ZIP](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45141840175/artifacts/14801579091) · [CI](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45141840175) | CI 已通過，Windows 11 完整實機待驗。ZIP 下載期限為 2026-12-23 16:54（台北時間）。 |
| B05.1 已接受基準 | [版本標籤](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.0-b05.1) · [PR #6](https://github.com/Jimmy0916-LAI/chip-screener/pull/6) | 先前已由使用者接受，可比對集保更新與相關回歸。 |

## Windows 11 x64 驗收清單

1. **核對交付。** 記錄候選版號、固定 commit SHA 或 tag、ZIP 下載連結與 ZIP SHA-256。若要測試安裝或資料升級，先備份現有測試資料。
2. **離線啟動與介面。** 在 Windows 11 x64 解壓，以該版的交付說明啟動。測試首次斷網開啟、七個既有頁面及移至含中文與空格的路徑後重開。核對該版本的免安裝入口與 ZIP 結構。
3. **資料保留與更新。** 驗證重開、移動或換版後的設定與本機資料，核對集保統計日與行情交易日。測試官方資料更新、部分來源失敗時沿用最近成功資料，以及相應的重試與復原。
4. **選股與行情回歸。** 依本次變更範圍比對週篩選、同窗 A/B、日行情與自選股。有涉及集保運算時，用漢唐（2404）400 張級距基準核對兩週分別增加 796,897、579,084 股，合計 +0.721971163 個百分點。
5. **記錄結果。** 針對同一份 ZIP 分別記錄 CI 和 Windows 11 實機結果。每項標為通過、未通過或待驗，附指令或操作步驟、預期與實際結果，以及可追溯的截圖或日誌。

## 驗收紀錄

可將下列格式貼到候選版本的 PR 或 Issue，並把紀錄連結放回首頁。

```text
候選版本／commit SHA（或 tag）：
下載連結／ZIP SHA-256：
驗收日期／Windows 11 版本：
CI 結果與連結：
實機結果（通過／未通過／待驗）：
未通過或待驗項目、重現步驟與證據：
```

## 規格與歷史

- [版本與分支索引](docs/VERSION_INDEX.md) · [專案狀態](PROJECT_STATE.md) · [AI 交接規則](AGENTS.md) · [外部資料來源](docs/research/EXTERNAL_DATA_SOURCES_20261127.md)
- [產品規格](https://github.com/Jimmy0916-LAI/chip-screener/blob/v0.6.2-windows-x64/PRODUCT_SPEC.md) · [開發路線圖](https://github.com/Jimmy0916-LAI/chip-screener/blob/v0.6.2-windows-x64/ROADMAP.md) · [主線開發 PR #7](https://github.com/Jimmy0916-LAI/chip-screener/pull/7) · [v0.6.2 整合分支](https://github.com/Jimmy0916-LAI/chip-screener/tree/feat/v0.6.2-runtime-integration)
- [JL 協作者分支（唯讀）](https://github.com/Jimmy0916-LAI/chip-screener/tree/b07/JL) · [Android 平行開發分支](https://github.com/Jimmy0916-LAI/chip-screener/tree/feat/android-mobile) · [原始研究 ZIP](chip-screener-phase1.zip)

`main` 保存驗收導航與研究基線。Windows 封測成品請從本頁頂部下載。
