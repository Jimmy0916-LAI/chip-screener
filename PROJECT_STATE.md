# 台股籌碼雷達專案狀態

**2026-11-21（台北）｜產品所有者已批准 PR #1 路線圖。B01 四項驗收通過，B02 待獨立開工指令。**

[已確認產品規格](PRODUCT_SPEC.md) · [批次與完成條件](ROADMAP.md)

## 管理批次結束時的 GitHub 紀錄（B01 之前）

| 項目 | 核對結果 |
| --- | --- |
| 正式基準 | [`main`：`93baab77fd2efd6adc9a592c727cd6030e4da676`](https://github.com/Jimmy0916-LAI/chip-screener/commit/93baab77fd2efd6adc9a592c727cd6030e4da676)。只有凍結 `chip-screener-phase1.zip`。 |
| 既有交付分支 | [`portable-v06-delivery`](https://github.com/Jimmy0916-LAI/chip-screener/tree/portable-v06-delivery) 與 `main` 同 SHA，無已推送差異。 |
| 既有預檢分支 | [`chip-radar-v06-preflight`：`9a470926eb5ef46f86d88c552f8afd6438491633`](https://github.com/Jimmy0916-LAI/chip-screener/tree/9a470926eb5ef46f86d88c552f8afd6438491633)，只在基準上增加 Windows 預檢 workflow。 |
| 既有驗證分支 | [`chip-radar-v06-validation`：`7f56c6e486fc2a7a9b13a7175e82eb3c71ac2f2a`](https://github.com/Jimmy0916-LAI/chip-screener/tree/7f56c6e486fc2a7a9b13a7175e82eb3c71ac2f2a)，保留同一 workflow 及 `validation/交付前驗證.md`。 |
| 本輪管理分支 | [`docs/v06-development-governance` 最新提交](https://github.com/Jimmy0916-LAI/chip-screener/commits/docs/v06-development-governance/)。基於上述 `main`，只包含三份管理文件。[管理 PR #1](https://github.com/Jimmy0916-LAI/chip-screener/pull/1) 待批准。第一個文件檢查點為 [`109cf94`](https://github.com/Jimmy0916-LAI/chip-screener/commit/109cf944ab78c60c1f5aabfced11c45cbc7e14be)。 |
| Windows CI | [唯一既有執行 `44618446774`](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/44618446774) 已失敗。Windows Runner 開始執行且重播通過，`test_failed_refresh_preserves_last_good` 印出中文時因 Windows 輸出編碼出現 `UnicodeEncodeError`，共五項測試、一項錯誤。Inno Setup 檢查及產物上傳尚未執行。這條流程原本只做預檢。 |
| 發布及其他 PR | 本輪開始時 PR 清單為空，Releases 無版本或資產。上述 CI 無 Artifact。這個工作區未掛載 Git checkout，無從核對先前獨立工作階段是否留有未推送檔案。 |

## B01 之前的驗證結果與未完成工作

| 工作項 | 已保存或重驗 | 未完成及阻塞 |
| --- | --- | --- |
| Architecture | 凍結 Python 核心在研究 ZIP。v0.5 附件的七頁模擬 DOM 逐頁通過。以附帶 JSON 重建之 HTML 與成品逐位元相同。 | v0.5 前端仍未入 Git，既有網頁只載入固定快照，無集保自動更新或匯入持久化。v0.6 UI 容器與資料層無可查實作提交。 |
| Quant | 隔離 Linux 重跑 Python 5/5 通過，固定 run `20261120T021433143982` 的六份 CSV 與一份 JSON 雜湊前後相同。漢唐 400 張兩週分別增 796,897 股及 579,084 股，累積 +0.721971163 個百分點。 | v0.5 嚴格時點、缺樣本、假期日曆、A/B 日期與底峰有已報告反例。歷史股票池、公司行動、交易成本與可成交性未驗收。正式績效期間仍未成立。原型候選數只是固定樣本資訊。 |
| Release | 研究 ZIP 與歷史預檢、驗證提交可從 GitHub 找回。 | 無單檔 EXE、正式 ZIP、發布資產或 Windows 11 實機驗收。Windows CI 的中文編碼是已定位的首個失敗點。預期在 B02 用 UTF-8 重跑並驗真正的應用程式產物。 |

已知回歸輸入來自 [CTO 接管總結](https://chatgpt.com/library?file_id=libfile_223cfb8f6e1481919c88e1f40712c2bd&account_id=personal)。包括 2026-11-13 收盤前視、共 1,985 檔中完全未列的 29 檔（含 2330）、A/B 在缺週時從 10/30 跳到 11/13、追加行情改寫基準底峰，以及誤收 `20261344` 及空白股數。此輪重跑涵蓋凍結測試與頁面快測，這些反例的修復尚未執行。

### 重現紀錄與來源

| 輸入 | SHA-256 |
| --- | --- |
| GitHub `chip-screener-phase1.zip`，Git blob `f10686fd56e025f350ec48be7466cbb127d156c3` | `9fb3a26dff260f575b6e9d8a016a79aec67472311ba8ad7db8a1b9b026534bab` |
| [v0.5 OneClick ZIP](https://chatgpt.com/library?file_id=libfile_31f47b93b1c081919183928444c1594c&account_id=personal) | `35abe65c40e98882cb9db36189f74a09422da7774e3362e9f257d2bd71d4c912` |
| [v0.6 詳細需求 DOCX](https://chatgpt.com/library?file_id=libfile_e5551c2f51808191ac12309002b6a3d4&account_id=personal) | `6bb687305d032f97d111d2a8b0623f0128977b1d128ae75513a306a9e8d22ccb` |

- 研究 ZIP 解壓至隔離目錄，在包根目錄執行 `python -X utf8 audit.py --run 20261120T021433143982`，逐一比對 `reports/20261120T021433143982/` 同名七份檔案。再執行 `python -X utf8 -m unittest discover -s tests -v`，得到 `Ran 5 tests`、`OK`。輸入附件的 `git hash-object` 與 GitHub 的 blob SHA 一致。
- OneClick ZIP 另解至隔離目錄，從包根目錄執行 `node source/test_webapp.js`，輸出 `all 7 routes passed.`。執行 `python source/build_webapp.py` 後，以位元組比對 `source/開啟籌碼雷達.html` 與隨附 `dashboard.html`，兩者相同，共 1,038,837 bytes。這次使用已隨 v0.5 附帶的 `web_data.json`。Node 測試為模擬 DOM。

## B01｜v0.5 基線入庫與重建：通過

- 單一代理執行。來源為已核對 SHA-256 的 OneClick ZIP 及儲存庫根目錄的凍結研究 ZIP。從附件直接取用 v0.5 原件與 source，保留舊 Windows 草稿在原工作區。
- [B01 PR #2](https://github.com/Jimmy0916-LAI/chip-screener/pull/2) 以 PR #1 的管理分支為基底，起點 [83e7520](https://github.com/Jimmy0916-LAI/chip-screener/commit/83e75206abacace748b87fb122e325d0d215c667)。[驗收提交 `fe1ab0a41d03c3982f7932b9c2acb6dda48bad28`](https://github.com/Jimmy0916-LAI/chip-screener/commit/fe1ab0a41d03c3982f7932b9c2acb6dda48bad28) 的 Git tree 為 `76aa0c8be7255b733a3e3e9405669f67f6fd5b8f`。程式與固定資料位置為 `baseline/v0.5/`。
- 乾淨 Git checkout 本地實跑（Linux、Python 3.12.14、Node 24.22.3），GitHub Actions 也從同一個 PR head SHA 重新 checkout 執行；驗收步驟前後均檢查工作樹乾淨。[CI #44897117131 與逐步日誌](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/44897117131/job/136825045265)

從儲存庫根目錄執行：

```sh
python -X utf8 baseline/v0.5/verify.py
```

| 驗收項目 | 實際結果 |
|---|---|
| 七頁 | 原版 Node 模擬 DOM 測試輸出 `all 7 routes passed.`，涵蓋首頁與其餘六頁。 |
| HTML | 重建與原 OneClick 的 `dashboard.html` 逐位元相同，1,038,837 bytes；SHA-256 `4cae8ad967e027414bfd99ae8c0af6294081d9a60e2451ff46600844e05230d7`。 |
| 漢唐 2404 | 400 張線兩個連續週增量為 796,897 股、579,084 股，Node 斷言通過。 |
| 凍結研究 ZIP | SHA-256 `9fb3a26dff260f575b6e9d8a016a79aec67472311ba8ad7db8a1b9b026534bab`，與已驗收版本一致。 |

同一命令亦從凍結研究 ZIP 重新生成 `web_data.json`，967,816 bytes 與前端固定資料逐位元相同。原建置腳本僅將最後一行檔案寫入改用 UTF-8 位元組，確保跨平台換行一致；既有 v0.5 研究限制仍見上方紀錄。

## 下次恢復位置

待產品所有者明確授權 B02，先核對 [PR #2 最新提交](https://github.com/Jimmy0916-LAI/chip-screener/pull/2/commits)、上述 B01 驗收提交、當時的 PR 合併狀態，以及 [ROADMAP 的 B02 驗收列](ROADMAP.md)。若先前工作區仍在，可讀 `workv06/` 的 Windows 封裝與 QA 草稿；它們尚未驗收，B01 的重建不依賴它們。B02、合併及正式發布各自等候後續指令。
