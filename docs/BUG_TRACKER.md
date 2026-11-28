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

## RC5／RC6 開發驗證

| 編號 | 候選狀態 |
| --- | --- |
| UPD | 原生 RC5 → RC6 完整下載、健康檢查、固定入口及關窗均通過隔離試驗。官方首頁與通道等待產品決策。 |
| SAVE | 修正後通過網頁儲存拒寫、完整設定回讀與沿用舊資料格式測試。 |
| CSV | 無效日及缺必要值會拒絕。手動匯入先預覽和確認，拒絕時保留舊值。已加入測試。 |
| PEAK | 固定窗不再使用比較日價格界線或倒填後續股本。正式績效研究仍待歷史時點驗證。 |
| COVER | 兩上市櫃官源名單可取時更新當期股票池。固定歷史測試保留 1,985 案。歷史母體與日 K 覆蓋仍不足。 |
| LIFE | 關窗、釋放埠及固定入口重開已在 Windows Server 通過。異常長跑仍待目標實機。 |
| DOC | 已完成文件修改與歷史留存，完整 Skill 原件待補。 |

[RC5／RC6 工程驗證](evidence/rc5/engineering.md) · [獨立驗收重跑](evidence/rc5/independent-acceptance.md)

## P0-UPD-TLS

Windows 11 x64 實機回報 RC5 在「檢查程式更新」收到 `CERTIFICATE_VERIFY_FAILED — unable to get local issuer certificate (_ssl.c:1032)`，驗收 FAIL。發布指標仍維持原指定。修復驗收要比對實際 RC5 與候選 ZIP，核對 Windows 憑證鏈、HTTPS 代理、GitHub 及市場來源，以及固定入口離線遷移與跨版。原使用者所在網路的憑證與代理原因待在同一實機確認。
