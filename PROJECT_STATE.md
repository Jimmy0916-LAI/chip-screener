# 台股籌碼雷達專案狀態

## v0.6.5 B02｜篩選與 AI 入口

[草稿 PR #14](https://github.com/Jimmy0916-LAI/chip-screener/pull/14) 從 B01 `01970586ed138e1292238ef749cf30888ab2b171` 接續。全市場篩選使用相同組合結果產出畫面與 CSV，策略套用、命名、載入與可讀的舊策略維持原儲存入口。日 K 依個股快取判定，提供逐檔補抓與可判定覆蓋。

軟體設定支援 Gemini、DeepSeek、Claude、OpenAI 的模型與分開金鑰。Windows 使用 DPAPI，既有 Gemini 可讀。總開關與三個模組開關控制 AI 外送。每日晨報、影片策略卡、AI 模擬操盤各顯示供應商、結果及降級原因。已執行 `python desktop/qa/ai_router_test.py` 5 項模擬測試，4 項集保測試及 8 項篩選測試。付費 API 待驗。

B03 的 [Windows 成品流程](.github/workflows/v065.yml) 執行實際 ZIP 與已驗證的 v0.6.3-rc.1 升降版測試。候選雜湊、期限與下載以 [PR #14 的候選段落](https://github.com/Jimmy0916-LAI/chip-screener/pull/14#v065-rc1-download) 為準。

## v0.6.5 B01｜上游對照與篩選核心

由使用者確認已獨立複驗的 `v0.6.3-rc.1`（`7d0f59a0b7acd540ab23099438eedd4bea0418c6`）開 `feat/v0.6.5-signals-ai`。預設分支的 [封測驗收首頁](https://github.com/Jimmy0916-LAI/chip-screener/blob/ab0070390a11c59d2600fcf6ef41f6bc5478d91e/README.md) 已更新，Windows 11 實機待補驗。

已下載比對朋友兩版 x64／full 成品、runtime 與 manifest，摘要與逐案驗收見 [v0.6.5 功能對照](docs/V065_SCOPE.md)。核心沿用集保週判定，新增 MACD、前高、三值組合與交易日／取得時間限制。`node --test desktop/qa/signal-engine.test.cjs` 8 項通過，`python desktop/qa/feed_test.py` 4 項通過。

恢復主線時先切至 `feat/v0.6.5-signals-ai` 並執行上述測試。B02 接 EXE／CSV、策略儲存與三個 AI 模組，B03 封裝與成品驗收。既有 065-01～04 分點覆蓋、權限及資料缺口留於功能對照。候選 Tag 與下載待成品實測。

## 0.6.3 候選交接

基準 2c4276368f3ee043ea17f1754f47fd444cee9c57。Windows 11 x64 實機與獨立驗收待驗。開發基準與成品入口詳見 README。

### v0.6.3-rc.1 同版修正

從既有候選 `256b78c3c59d336c5bb1d8e34a5da2d596e66b88` 接續 [PR #13](https://github.com/Jimmy0916-LAI/chip-screener/pull/13)。保留[上一候選 ZIP](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45978886068/artifacts/15187643793)、[CI](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45978886068)及 PR 原驗收紀錄。上一候選內層 ZIP SHA-256 為 `02649178d3b791deee16a6c1acb5823ce31292555f3b414d8ec423dbe9632171`。

- 063-02 個股摘要讀取可用集保快照，週訊號獨立顯示連續週不足。
- 063-06 免安裝入口使用固定本機網址。舊背景服務佔用時提示如何在工作管理員停止，軟體設定另提供可供換版和回退使用的停止按鈕。
- 063-07 輕量 HTML 核對日曆日期、順序、集保週欄位與快照範圍。匯入失敗保留原畫面。
- 063-11 封測 ZIP、內層 SHA-256、到期與驗證證據在 [PR 封測下載與校驗頁](https://github.com/Jimmy0916-LAI/chip-screener/pull/13#v063-rc1-download)。程式版號、封裝名稱與 CI 檢查同步。

執行 `python desktop/qa/feed_test.py` 重跑固定集保案例。由 [CI 工作流程](.github/workflows/v063.yml) 對同一內層 ZIP 驗新舊版本切換、真實集保與失敗保留、七頁、漢唐固定股數及 A/B 同窗。Windows 11 x64 實機與獨立複驗待驗。恢復時先以 `git fetch origin --tags` 取得交付 Tag，再用 `git show -s v0.6.3-rc.1` 與 PR 的候選 SHA 和內層 ZIP 雜湊核對。

**B04.2 已獲接受。B05 v0.6.0-b05.1 通過 Windows Server 2022 實際 ZIP 驗收。Windows 11 實機待驗，PR #6 待審。**

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

## B04.2 預設嚴格篩選週與重開驗收

版本 v0.6.0-b04.2，程式與驗收提交 [`b7415d5e1d587c5adab6b63e8295564073cecbc6`](https://github.com/Jimmy0916-LAI/chip-screener/commit/b7415d5e1d587c5adab6b63e8295564073cecbc6)。[Windows Server 2022 成品驗收](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45007997573/job/137164656088) · [下載單檔測試 ZIP](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45007997573/artifacts/14748448174) · [畫面、CSV 與 JSON](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45007997573/artifacts/14748364432)。

ZIP 為 `ChipScreener-v0.6.0-b04.2-Windows-x64.zip`，根目錄只有 `ChipScreener.exe`。ZIP SHA-256 為 `8ca6e76b79d0670037bed8d62508ec49c876463f090ef62d6f1f9e1563fcd3eb`。下載期限為台北時間 2026-12-22 17:35:17。

| 使用情境 | 驗收結果 |
|---|---|
| 舊版保存後換版 | B04.1 匯入 11/20 待證快照並重開後，預設跳至 11/20，1,985 檔資料不足。使用同一帳號資料開啟 B04.2，預設為 11/13，268 檔通過。 |
| 新版保存後重開 | B04.2 從乾淨環境匯入同一份測試快照。關閉並重新啟動成品後，預設仍為 11/13，268 檔通過。畫面指出 11/20 公布時點待證。資料頁顯示匯入來源，個股原始表可查漢唐該測試期的股數。 |
| 手動選週 | 指定 11/20 後切頁往返仍為 11/20，0 檔通過、1,985 檔資料不足。按「回到預設篩選週」才返回 11/13。 |
| 可評估條件 | 自動模式依目前套用策略逐週檢查。至少一檔能作出判定即可採用，零檔通過仍可評估。全部窗口不足時列出原因。使用原有公開時點、交易日曆與缺週檢核。 |
| B04 與 B03 回歸 | 同一 ZIP 重新驗證 10/30 同窗 A/B、兩份各 1,985 檔 CSV、七頁、漢唐兩週增股 796,897 與 579,084 股、離線啟動、中文空格路徑搬移，以及設定與快照備份復原後再次保存、重開。 |

本機從 `packaging/windows` 執行 `python -X utf8 build_dashboard.py`、`node weekly.test.cjs` 與 `node --test storage.test.cjs`。成品程序見 [accept.ps1](packaging/windows/accept.ps1) 與 [gui.cjs](packaging/windows/gui.cjs)。Windows 11 實機雙擊待驗。

## B05 集保週資料自動更新

版本 `v0.6.0-b05.1`。[程式提交 `2d6249a`](https://github.com/Jimmy0916-LAI/chip-screener/commit/2d6249aecd54a88a4ff5329f4751587db2f0417c) · [版本標籤](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.0-b05.1) · [PR #6](https://github.com/Jimmy0916-LAI/chip-screener/pull/6)。基於 B04.2 程式 `b7415d5` 及 PR #5 文件提交 `77d5af7`。

[下載 ChipScreener-v0.6.0-b05.1-Windows-x64.zip](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45024902778/artifacts/14755233290)，ZIP 根目錄僅含 `ChipScreener.exe`。ZIP SHA-256 `d5f1fb5166cff4f9d7097b3cbdb1c321832a390575594947635ab49dbc0ad314`。下載至台北時間 2026-12-22 21:00:16。

| Windows Server 2022 成品情境 | 結果 |
|---|---|
| 啟動先顯示已保存資料 | 保留 11/20 手動待證快照；連線檢查前統計週 2026-11-13，通過 268，不足 25。 |
| 同一顆 EXE 自動從 TDCC 取得新一期 | 無按鈕操作。統計日 2026-11-20，取得 2026-11-22T21:07:44.082+08:00。來源 https://opendata.tdcc.com.tw/getOD.ashx?id=1-5，原始檔 SHA-256 `af8528288555b0e0d3791d13893992f667ee28f4c4e8b12d2202668d41e8214d`。在固定 1,985 檔母體中，通過輸入驗證 1985 檔，隔離 0 檔。首次公布時間待證。 |
| 新窗口重算 | 證交所實際交易日已覆蓋至 2026-11-20；2026-11-06 → 2026-11-13 → 2026-11-20。畫面嚴格週 2026-11-20，通過 301，不足 22；窗口足以評估。 |
| 重開、重抓、離線、手動指定 | 同一期雜湊與首次取得證據維持一致，離線重開保留選股結果；開啟時手動固定 10/30 並收到官方新一期後仍為 2026-10-30。 |
| 故障與相容性 | 從相同 ZIP 的 EXE 擷取實際程式，以控制回應重播舊期、同日不同內容、缺列、缺週、日曆失敗與恢復續抓。另以 EXE 重跑 B04.2 待證週、兩份 CSV、七頁、單檔搬移與 B03 備份復原。 |

啟動後背景檢查，執行期間每 6 小時及按「立即更新」可再查。自動來源採集保 1-5 整批檔，依檔內統計日追加；未取得的官方整週列出缺期，保留原始手動紀錄及獨立的官方來源。單檔完整 1–17 級對帳，沿用固定 1,985 檔母體，整批至少 95% 有效才接受，逐檔待核原因保留。TWSE FMTQIK 按月續查實際交易日，尚無證據的下個開盤待核。既有 store-v1 另行保留，官方每期與日曆使用同帳號 tdcc-v1 的校驗副本。

[Windows 成品與網路驗收](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45024902778/job/137216554765) · [畫面與逐階段資料](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45024902778/artifacts/14755309598) · [交付 EXE 內模組故障重播](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45025327510/job/137216992430)。在 packaging/windows 下重現邏輯測試：`python -X utf8 build_dashboard.py`、`node weekly.test.cjs`、`node --test storage.test.cjs feed.test.cjs`。

## 下次恢復位置

從 [PR #6](https://github.com/Jimmy0916-LAI/chip-screener/pull/6) 與上述版本標籤和驗收紀錄恢復。B05 待審，Windows 11 實機雙擊待驗。B06、正式合併與發布各待另行授權。
