# P0-UPD-TLS 驗收與手動遷移

## 重現與範圍

Windows 11 使用者在 RC5 軟體設定檢查更新時收到 `CERTIFICATE_VERIFY_FAILED — unable to get local issuer certificate (_ssl.c:1032)`。RC5 使用隨包 Python 3.13.14，原 GitHub API、ZIP、官源及資料中心路徑使用 urllib 預設 TLS。這項錯誤表示當次憑證鏈未能驗證，設備的實際代理策略、伺服端中繼憑證或信任存放區狀態仍待同一 Windows 11 實機確認。

Windows 修復版使用固定版本 truststore 0.10.4，以 Windows 原生憑證鏈驗證與主機名稱檢查。套件來源由建置時 SHA-256 釘住，授權檔隨包。代理仍依 urllib 支援的環境與 Windows 固定設定。需要 PAC 或代理登入的環境，請由網路管理員確認該應用可使用的 HTTPS 代理。憑證診斷只回報主機、是否偵測到固定代理和可用驗證代碼。工程報告可區分通過 TLS 的 HTTP 403／404，避免把限流、權限或資料庫尚未建立當成憑證錯誤。

## 一次性離線修復

1. 由官方 RC7 Release 手動取得完整 Windows x64 ZIP 與 SHA256SUMS。完整解壓到新資料夾，保留 resources。
2. 在 RC5 或 RC6 的軟體設定按「停止本機服務」。維持原 Windows 帳號與原瀏覽器設定檔。
3. 雙擊新資料夾的股票雷達.exe。若已有固定入口，確認「離線修復」。程式將 RC7 複製至版本目錄，驗證健康後才切換指標，保留原捷徑及上一可用版。若尚未安裝固定入口，直接開啟 RC7，並可在軟體設定安裝固定入口。
4. 確認左上顯示 RC7。關閉最後一個窗，再從原捷徑開啟並確認仍為 RC7。查看原自選、策略和資料。

## 更新通道

原官方 main 尚缺單一通道表。修復版連線成功後會明示通道未配置。PR #18 有嚴格的單一 URL 版型。公開 Beta 目前仍提供原 RC4，Stable 待發布。最終公開通道需在獨立驗收後由產品負責人指定。

## 驗收方式

- 用同一 Windows 11 帳號、同一網路和代理重跑原 RC5 步驟，再以 RC7 對 GitHub 檢查更新。記錄畫面、日期與網路類型。若仍出現憑證錯誤，記錄主機、代理存在狀態與驗證代碼。
- 在實際 ZIP 執行 Windows 比對、受控未知發行者與主機名拒絕、當前使用者可信 CA 正向、官源 TLS、手動修復、固定入口和關窗。跨版 RC7 → RC8 使用兩個獨立 Release 資產與隔離 README。測試證據由各次 CI 留存。
- U01–03、U05、U07、U08、U09、U10、U11、U12 依新成品記錄。U04 的已發布 Stable 降版另需正式資產。U06 的真實磁碟耗盡、斷電與使用者代理網路仍需 Windows 11 實機。

## Windows Server 2022 已取得的結果

- 原 RC5 完整發行包通過 SHA-256 比對，隨包 Python 3.13.14／OpenSSL 3.0.21。受控缺少信任根時，RC5 實際回報 OpenSSL 驗證代碼 20 和相同的 `unable to get local issuer certificate`。
- RC7 對未信任 CA 回繁體中文錯誤。加入受控測試信任根後 TLS 成功，錯誤主機名稱仍被拒絕。該試驗僅修改測試 Runner 存放區，完成後移除測試 CA。
- RC7 真實網路驗證 GitHub API／Release CDN、集保、TWSE、TPEx、FinMind 均成功。資料中心主機 TLS 成功，指定 catalog 回 HTTP 404。Runner 沒有固定 HTTPS 代理，使用者的代理路徑需在實機重驗。
- 真實 Windows RC5 固定入口原封保留。用 RC7 解壓後的 EXE 確認離線修復，檢查版號、上一可用版、舊市場資料與原入口重開相符。最後關窗後埠和服務程序退出。

[Windows 端點與離線修復證據](windows-tls.json) · [診斷 CI 46137047372](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/46137047372)

## 交付候選與 U01–U12

| 版號 | Tag 來源提交 | ZIP SHA-256 |
| --- | --- | --- |
| [RC7 修復](https://github.com/Jimmy0916-LAI/chip-screener/releases/tag/v0.6.5-rc.7) | `d4a29a952fb3143a6e590e8ff30a58fd15cae4c0` | `a40e77a954bc9a19238b9d5f22a69da95c8f02c3866195fc1310794b6bd9b6ae` |
| [RC8 隔離跨版目標](https://github.com/Jimmy0916-LAI/chip-screener/releases/tag/v0.6.5-rc.8) | `ab14118482b34f725bb54778728a128438b572be` | `7bfb6a01d9197e17ec2a2a6d8e16928f99756fb689226a5c52d546058cbbf49b` |

| 驗收 | 開發端結果及限制 |
| --- | --- |
| U01–U03、U05、U12 | Windows Server。隔離 README 指定 RC7 時忽略已發布的 RC8，切換唯一 ZIP 連結後從 UI 真實下載 RC8，健康驗證、同入口重開與版號一致。發行 ZIP 匿名回下載雜湊一致。 |
| U04 | Stable 未指定及切到 Beta 已驗。公開 Stable 降版需合格正式資產。 |
| U06、U08 | 未信任 CA、主機名稱不符均拒絕。原生故障注入時自動恢復 RC8，再手動回退至健康的 RC7。真實磁碟耗盡與斷電待驗。 |
| U07 | RC5 固定入口和市場資料哨兵在離線遷移後保留。跨版與回退中瀏覽器設定哨兵保留。完整舊使用者資料待獨立驗收。 |
| U09、U10 | Windows Server 原生 EXE、隨包 Python、中文空格路徑、離線開啟、畫面篩選和固定 CSV 實測。RC7 另驗 GitHub、集保及價格來源 HTTPS。Windows 11 實機需在原網路重跑。 |
| U11 | 官源和完整包更新各由實際產品路徑驗證。並行滿載待實機長跑。 |

[跨版與回退 CI 46137337984](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/46137337984) · [下載、重開與關窗](native-update.json) · [故障恢復與手動回退](native-rollback.json)
