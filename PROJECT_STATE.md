# 台股籌碼雷達專案狀態

**B03.2 已獲接受。B04 測試版 v0.6.0-b04.1 通過 Windows Server 2022 成品驗收，Windows 11 實機雙擊待驗。PR #5 待審。**

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

## B02｜Windows 單檔離線封裝

[Windows x64 測試 ZIP](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/44897911360/artifacts/14704399756) · [七頁截圖與 JSON 驗收證據](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/44897911360/artifacts/14704428254) · [Windows CI](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/44897911360)

本批以 [B01 `0411661`](https://github.com/Jimmy0916-LAI/chip-screener/commit/0411661507139e488b676830dba2c6de30d7addd) 為基準，沿用固定 v0.5 HTML。產品提交 [`970952a53c2ce295f954f7a947a87cc56e210891`](https://github.com/Jimmy0916-LAI/chip-screener/commit/970952a53c2ce295f954f7a947a87cc56e210891)。GitHub 登入具此私人 repo 權限的帳號後可下載測試 ZIP，解壓後只含 `ChipScreener.exe`，雙擊即開啟。ZIP SHA-256 為 `86f0ca9fb0abad5a910f888ffdfdf778c00c02eab6023fd9148b242f43a17974`。

Windows Server 2022 Datacenter x64 實測通過。在獨立 Runner 下載同一份 Actions 原始 ZIP，核對 ZIP 和 EXE 雜湊，採全新使用者資料目錄，先以 Windows 防火牆阻斷應用程式對外連線，再以 ShellExecute 的預設開啟動作零參數啟動。原位置及搬至中文空格空資料夾後均開出獨立視窗並正常關閉。真實 Chromium 渲染器在兩個位置各驗七頁、漢唐持股圖、日 K 線、796,897 及 579,084 股，並保存 14 張 PNG。Windows 11 實機待驗。本批停在測試產物。

| 項目 | 驗收結果 |
|---|---|
| 分支與 PR | [B02 PR #3](https://github.com/Jimmy0916-LAI/chip-screener/pull/3) 以仍開放的 PR #2 分支為基底。未合併或正式發布。 |
| 建置基線 | Windows 以 `python -X utf8 baseline/v0.5/verify.py` 通過 B01，並從凍結研究 ZIP 解壓後執行 `python -X utf8 -m unittest discover -s tests -v`，5/5 通過。 |
| 封裝 | `packaging/windows/` 採用鎖定版本的 Electron／electron-builder。拷入同一 B01 dashboard.html，`npm ci`、`npm run dist` 生成 portable EXE。沿用舊草稿的 portable 目標、PE 檢查及 GUI 驗收方法。原 v0.5 七頁、資料和策略邏輯隨包提供；桌面端補上 Electron 缺少的方案命名輸入框。 |
| 交付檔案 | GitHub Actions ZIP 大小 110,573,072 bytes，只含根目錄的一個 EXE。EXE SHA-256 `eb40486a3a10fff1f959afac4090a3b47b092a63d7f470d3934803677717d59e`。下載有效期限以 GitHub 為準，本次標示台北時間 2026-12-21 19:15。 |
| 首次啟動與搬移 | Windows 防火牆封鎖兩個外層 EXE 路徑與實際 GUI 執行檔對外連線，僅保留本機驗收通道。確認 GUI PE 為 x64。搬到 `台股 移動 測試\ChipScreener.exe` 前資料夾為空，搬後 EXE 雜湊相同，資料夾內仍只有該檔。 |
| 操作證據 | 上述 Windows CI 的 `accept` 作業先下載 artifact 原始位元組；`accept.ps1` 驗證 ZIP 並執行預設開啟動作；`gui.cjs` 點選七頁、核對漢唐圖表與數字。證據 ZIP 內有 `package.json`、`first-gui.json`、`moved-gui.json` 和各頁 PNG。 |

## B03｜本機資料與設定儲存

[測試 ZIP](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/44922075589/artifacts/14714082864) · [成品驗收日誌](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/44922075589/job/136901695195) · [截圖與逐次啟動 JSON](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/44922075589/artifacts/14714736237) · [B03 PR #4](https://github.com/Jimmy0916-LAI/chip-screener/pull/4)

以 B02 程式 `970952a` 與狀態文件提交 `9a00191` 為基線。[交付程式 `91c96f25053f12e86e75992c053b44954151a3fb`](https://github.com/Jimmy0916-LAI/chip-screener/commit/91c96f25053f12e86e75992c053b44954151a3fb) 位於 `b03/local-storage`。Actions ZIP SHA-256 為 `c95d82f4fa150032394bc8fe0df1be62d440c9014e7a42762e1907de2376b22d`，唯一成員 `ChipScreener.exe` 的 SHA-256 為 `f958e895c694ab855651ed53d2c4bd528121696f4be12db7e4cc7113eeb21281`。

同一 Windows 帳號讀寫 `%LOCALAPPDATA%\ChipScreener\store-v1`。設定保留原 `chip-screener-config-v1` 的 applied、draft、presets 欄位，首次可沿用 B02 的本機設定。資料從內建基線加載已驗證、帶來源的額外週快照。設定與快照分開寫入，暫存檔沖刷、讀回後才取代主檔；另留當次鏡像及上一版，開啟時檢查格式與 SHA-256。

| Windows Server 2022 成品驗收 | 結果 |
|---|---|
| 首次離線、搬移 | 獨立 Runner 下載原始 Actions ZIP，核對雜湊及單一成員。防火牆阻斷應用程式對外連線後，原位置與中文空格路徑「台股 移動 測試」均可用 Windows 預設開啟動作零參數啟動。兩次各通過七頁及漢唐固定增股 796,897、579,084 股。 |
| 經畫面保存與重開 | 「B03 保存驗收」方案、已套用策略與草稿皆為 400 張／0.77 pp。由資料頁匯入合成的 2026-09-18 測試週，個股頁顯示 2404 的 400 張線 54,000 股，分母 136,000。重啟及只搬動 EXE 後顯示相同。 |
| 更換不同 EXE | 另以 QA 用的 `0.6.0-b03.0` 建立同一案例，關閉後只替換為交付 ZIP 的 `0.6.0-b03.1`。兩顆 EXE 雜湊不同，畫面版本變更，方案、快照與股數相同。 |
| 寫入中斷及損毀 | 暫存檔沖刷後、重新命名前終止寫入程序，重開讀到上一成功版本。另在實際視窗強制設定和快照寫入失敗，失敗的 09-25 期未出現在個股頁，重開保有 09-18 快照。截斷設定、快照兩個主檔後，畫面分別顯示從備份復原，方案和股數相符。 |
| 測試平台 | Windows Server 2022 Datacenter x64。Windows 11 實機雙擊待驗。09-18 快照由驗收腳本匯入至測試帳號，交付 EXE 首開仍載入內建資料。 |

重現命令為 `python -X utf8 baseline/v0.5/verify.py` 與 `node --test packaging/windows/storage.test.cjs`。Windows 建置與成品驗收見 [B03 工作流程](https://github.com/Jimmy0916-LAI/chip-screener/blob/91c96f25053f12e86e75992c053b44954151a3fb/.github/workflows/b03-windows.yml)。工作流程另跑凍結研究測試 5/5，建置 ZIP 後於獨立 Runner 執行 `packaging/windows/accept.ps1`，透過實際渲染器保存逐次驗收結果。

## B03 修補版 v0.6.0-b03.2

[下載 ChipScreener-v0.6.0-b03.2-Windows-x64.zip](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/44927331758/artifacts/14716790907) · [Windows 成品日誌](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/44927331758/job/136917297099) · [各次啟動畫面與 JSON](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/44927331758/artifacts/14715673882) · [版本標籤](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.0-b03.2)

[修正提交 `00afe6b4468581be39ca81002b615ce4494ede9c`](https://github.com/Jimmy0916-LAI/chip-screener/commit/00afe6b4468581be39ca81002b615ce4494ede9c) 已推至 [PR #4](https://github.com/Jimmy0916-LAI/chip-screener/pull/4)。[標籤驗證作業](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/44927331758/job/136918582416) 已讀回同一 SHA。GitHub Artifact 建置後由另一台 Runner 下載原始 ZIP，核對 ZIP、單一根目錄成員與 EXE 雜湊。台北時間 **2026-12-22 01:00:52** 到期。ZIP SHA-256 為 `fbe0501a3346ed49d71f83c76408187af7fb24499a9579f8ee7f0cad6b000449`，EXE SHA-256 為 `ee75d4370eea9d02b3a099dc87006c1e0f9ca6426e775e3005fa0c57d0635c1e`。

設定與快照沿用 schema 1。啟動時逐一驗證三個已提交檔案的格式、內容和 SHA-256，依最高有效 revision 選擇。相同 revision 依 current、mirror、previous 排序。暫存檔不參與選擇。[版本與交付規則](ROADMAP.md) 包含程式版本資料夾、共用資料位置、格式遷移與回退。

| Windows Server 2022 Datacenter x64 測試 | 結果 |
|---|---|
| 原反例 | 修正前同一組 Node 測試在設定、快照都讀到 1，預期為 2。修正後 Windows `node --test packaging/windows/storage.test.cjs` 通過 5/5。 |
| 兩次鏡像失敗 | 用先前交付的 B03.1 EXE 製造 current=3、mirror=1、previous=2。在獨立版本資料夾啟動 B03.2 前，保留有效的第 3 版暫存檔並截斷主檔。 |
| 畫面復原與再次保存 | 新版顯示第 2 版策略草稿 0.62 pp，合成測試期 2026-09-11 的漢唐 400 張線為 108,000 股。再存新內容並重開後，草稿為 0.94 pp，2026-09-25 為 216,000 股，損毀的 09-18 期未出現。 |
| 原驗收 | 全新資料離線啟動、單獨移至中文空格資料夾、七頁、兩週增股 796,897／579,084 股、方案、寫入失敗、主檔損毀、舊版換新版皆通過。舊版 EXE 的 SHA-256 與上次交付相同，另已驗證兩個版本資料夾中的 EXE 保持原雜湊。 |

## B04｜大戶週篩選與同窗 A/B 校正

[版本測試 ZIP](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/44931057553/artifacts/14717776811) · [Windows 成品驗收](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/44931057553/job/136928452318) · [截圖、原始匯出 CSV 與 JSON](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/44931057553/artifacts/14718166245) · [B04 PR #5](https://github.com/Jimmy0916-LAI/chip-screener/pull/5)

以 PR #4 的最新文件提交 `c23299c` 和已驗收的 B03.2 程式 `00afe6b` 為基準。[程式提交 `faf3047fbe1ba0debca15318c1ede63e789482f5`](https://github.com/Jimmy0916-LAI/chip-screener/commit/faf3047fbe1ba0debca15318c1ede63e789482f5) 已由 CI 建置、驗收及[標記 v0.6.0-b04.1](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.0-b04.1)。ZIP 根目錄僅含 `ChipScreener.exe`，SHA-256 為 `c4f080823b295d77e99d11cbc50244d257c91b4e14ba1132ab4542bbf44f0e78`（ZIP）與 `5e5ebf9f1f68594acdb1ccad6f0ae245d205b0c8bbdf79025c2a3f76ccf97214`（EXE）。測試 ZIP 下載期限為台北時間 2026-12-22 01:40:35。解壓至獨立的 `v0.6.0-b04.1` 資料夾，同帳號沿用原 store-v1。

| 項目 | 已核對結果 |
|---|---|
| 範圍與資料驗證 | 1985 檔為 11/13 備份的固定比較名單，歷史逐日上市櫃母體待證。建置使用凍結包 6 期 CSV，逐檔核對日期、級距、股數與戶數，以及原檔 SHA-256；最新一期與官方原檔逐位元相同。算術對帳採 1–15 級股數合計減第 16 級差異股數，等於第 17 級；戶數由 1–15 級直接合計。實際大戶級距的分子只包含相應的 1–15 級持股。異常或缺列仍有原因。 |
| 最新預設 400 張／兩週 | 11/13 統計，按 11/14 16:15:45 台北公開備份證據評估。1985 檔中 268 通過、1692 算術條件未達、25 資料不足（22 檔分母異動、3 檔基礎數值待核）。原漏列 29 檔均有結果。2330 第 16 級 5899 股、3 戶，400 張線兩週為 −37,973,336、−10,706,718 股；2404 為 +796,897、+579,084 股。 |
| 交易日與公開時點 | 封存 TWSE FMTQIK 月檔和日曆備援逐日相符，共 697 個交易日。窗口依實際交易週，首個可觀察開盤依台北時間求得。10/22 期的 10/23 公開備份後，下一個核實開盤為 10/27 09:00。資料未可證、未知、缺週或日曆覆蓋不足均有對應提示。公開備份時間是已能證明取得的時點，官方首發秒數仍待證。 |
| 10/30 反例 | A 兩週使用 10/16、10/22、10/30；B 四週缺 10/02 等資料，1985 檔皆標不足，匯出增幅空白。兩側評估時點同為 10/31 15:41:17。切至 10/30 13:30，A 也顯示尚無公開證據。兩份 CSV 各含 1985 個不重複代號，對照畫面與 2330 逐股欄位。 |
| 成品回歸 | 獨立 Windows Server 2022 Datacenter x64 Runner 下載原始 ZIP，比對雜湊，驗證離線單檔開啟、七頁、中文空格路徑搬移、B03 設定與快照跨版保存、寫入失敗、備份損毀與再次保存。第 2 版復原畫面 0.62 pp／108,000 股，重開後新值 0.94 pp／216,000 股。Windows 11 實機待驗。 |

來源與程式：[政府持股分級表](https://schema.nat.gov.tw/gsp/frontstage/resource.download/9f7d9184-20a0-49eb-b7dd-96e23686c4ef) · [凍結資料核對與日曆](packaging/windows/weekly_evidence.py) · [共用週訊號](packaging/windows/weekly.js) · [回歸測試](packaging/windows/weekly.test.cjs)。

本地重現：在 `packaging/windows` 執行 `python -X utf8 build_dashboard.py`、`node weekly.test.cjs` 及 `node --test storage.test.cjs`；凍結基線沿用 `python -X utf8 baseline/v0.5/verify.py`（儲存庫根目錄）。[Windows 工作流程](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/44931057553) 另從成品實際點擊並讀回 CSV。

## 下次恢復位置

從 [PR #5](https://github.com/Jimmy0916-LAI/chip-screener/pull/5)、上述標籤、測試結果及本頁恢復。B04 維持待審。Windows 11 實機另驗；正式合併、發布與 B05 官方集保自動更新各待後續授權。
