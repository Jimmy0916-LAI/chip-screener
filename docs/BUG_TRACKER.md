# 缺陷與開發端重驗台帳

基準為 [RC4](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.5-rc.4)。修復需另記候選 SHA 與實際成品結果。

| 編號 | RC4 現況／證據 | 關閉所需證據 |
| --- | --- | --- |
| UPD | 套用、回退、重啟路由回 409。該 Release 只有 ZIP 與 SHA256SUMS。見 desktop/scripts/serve_local.py 及 Release 資產。 | 兩個合法完整包自動下載、固定入口切換、確認與回退。 |
| SAVE | 瀏覽器拒寫時，storage-adapter.js 的 saveConfig 回成功。600 張設定重開仍為 400 張。 | 配額、部分寫入及重開保持一致。 |
| CSV | data-io.js 可保存 2026-11-31，空白股數轉零。 | 日期、必填值、預覽與確認案例；保留舊的有效資料。 |
| PEAK | peak-model.js 的基準搜尋邊界含比較日，後續 K 線可能改寫原峰。serve_local.py 日 K 可能使用未來股本。 | 追加未來 K 線與股本後基準不變。缺證據維持研究狀態。 |
| COVER | 歷史股票池及全市場日 K 覆蓋不足。RC4 固定池為 11/13 舊樣本。 | 逐日期與個股覆蓋、來源、修訂及缺口。 |
| LIFE | 新版啟動器、最後關窗與更新助手組合待驗。 | 程序樹、連線、埠、CPU、RAM、異常退出及再開。 |
| DOC | Skill v1.0 獨立原文待補。 | 原件保存、原文比對及 DR-01～11 完整性檢查。 |

[開發端與獨立驗收規格](../ACCEPTANCE.md) · [工程檢查點](../PROJECT_STATE.md)
