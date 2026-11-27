# stock-screenner｜台股籌碼雷達版本驗收

這是台股籌碼雷達（ChipScreener）的 GitHub 驗收入口，用來核對另一個 AI 交付的版本、比對既有基準，並記錄 Windows 11 實機結果。

**本次待驗版本：待指定。** 收到交付後，將版本、固定提交、下載連結及 SHA-256 填入下方驗收紀錄。

## 下載與比對基準

| 版本 | 下載與證據 | 已知狀態 |
| --- | --- | --- |
| v0.6.2 Windows x64 封存 | [下載 ZIP](https://github.com/Jimmy0916-LAI/chip-screener/raw/refs/tags/v0.6.2-windows-x64/archives/v0.6.2/ChipScreener-v0.6.2-Windows-x64.zip) · [封存標籤](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.2-windows-x64/archives/v0.6.2) · [封存驗證](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45947545481/job/140335601737) | ZIP 含 Python 執行環境，完整性、SHA-256 與內部版本已核對。Windows 執行待驗。 |
| B06.1 主線測試基準 | [版本標籤](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.0-b06.1) · [下載 ZIP](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45141840175/artifacts/14801579091) · [CI](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45141840175) | CI 已通過，Windows 11 完整實機待驗。ZIP 下載期限為 2026-12-23 16:54（台北時間）。 |
| B05.1 已接受基準 | [版本標籤](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.0-b05.1) · [PR #6](https://github.com/Jimmy0916-LAI/chip-screener/pull/6) | 先前已由使用者接受，可比對集保更新與相關回歸。 |

## Windows 11 x64 驗收清單

1. **核對交付。** 記錄候選版號、固定 commit SHA 或 tag、ZIP 下載連結與 ZIP SHA-256。若要測試安裝或資料升級，先備份現有測試資料。
2. **離線啟動與介面。** 在 Windows 11 x64 解壓，以交付說明啟動。測試首次斷網開啟、七個既有頁面及移至含中文與空格的路徑後重開。核對是否符合免安裝單檔 EXE 規格。
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

- [版本與分支索引](docs/VERSION_INDEX.md) · [AI 交接規則](AGENTS.md) · [外部資料來源](docs/research/EXTERNAL_DATA_SOURCES_20261127.md)
- [產品規格](https://github.com/Jimmy0916-LAI/chip-screener/blob/v0.6.2-windows-x64/PRODUCT_SPEC.md) · [開發路線圖](https://github.com/Jimmy0916-LAI/chip-screener/blob/v0.6.2-windows-x64/ROADMAP.md) · [主線開發 PR #7](https://github.com/Jimmy0916-LAI/chip-screener/pull/7) · [v0.6.2 整合分支](https://github.com/Jimmy0916-LAI/chip-screener/tree/feat/v0.6.2-runtime-integration)
- [JL 協作者分支（唯讀）](https://github.com/Jimmy0916-LAI/chip-screener/tree/b07/JL) · [Android 平行開發分支](https://github.com/Jimmy0916-LAI/chip-screener/tree/feat/android-mobile) · [原始研究 ZIP](chip-screener-phase1.zip)

`main` 保存驗收導航與研究基線。產品下載以本頁列出的版本封存和測試產物為準。
