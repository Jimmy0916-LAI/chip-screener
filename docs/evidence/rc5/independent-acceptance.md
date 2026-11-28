# RC5／RC6 獨立驗收手冊

## 取得與遷移

從 RC5 Release 下載 Windows x64 ZIP、SHA256SUMS.txt 及 update-manifest.json。以 Windows 11 x64 的非管理員帳號，在含中文與空格的目錄完整解壓。確認測試機未安裝系統 Python 或 Node.js。從 RC4 軟體設定停止舊服務，沿用原 Windows 帳號及瀏覽器設定檔，開啟解壓資料夾內的股票雷達.exe。由新版的軟體設定選擇「安裝固定入口」並確認桌面捷徑。待後續產品驗收確認以前，使用開發候選僅供驗收。

Windows 的檔案校驗命令如下。一般使用者不需要終端機。

```powershell
Get-FileHash -Algorithm SHA256 .\ChipScreener-v0.6.5-rc.5-Windows-x64.zip
Get-Content .\SHA256SUMS.txt
```

[RC5 發行](https://github.com/Jimmy0916-LAI/chip-screener/releases/tag/v0.6.5-rc.5) · [RC6 發行](https://github.com/Jimmy0916-LAI/chip-screener/releases/tag/v0.6.5-rc.6)

## 雙通道與跨版重驗

現行主分支尚待合入 PR #18 的文件通道表。隔離測試由驗收者使用自有官方分支，表內 Stable 為 —，Beta 初始指向 RC5。啟動已校驗 RC5 包內服務並將驗收程序的 README 讀取限定至該隔離分支，發布資產、來源驗證與更新器本身保持原包。安裝固定入口、選 Beta 並核對 RC5 為指定版，在工具顯示 QA READY 後，將同一分支的 Beta ZIP 連結改指 RC6 並推送。驗收工作從新版畫面、原設定、健康回報與固定 EXE 重新啟動確認結果。

```powershell
python desktop/qa/real_update_windows.py .\ChipScreener-v0.6.5-rc.5-Windows-x64.zip 0.6.5-rc.6 .\evidence --chromium 'C:\Program Files\Google\Chrome\Application\chrome.exe' --ref release/independent-update-qa
```

此命令供有測試工具的獨立驗收環境使用。既有原生測試紀錄見 [CI 46133876934](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/46133876934) 及 [回讀結果](native-update.json)。

## 實機及資料檢查

1. 斷網啟動後，驗導航、設定、舊資料與「需要連線」提示。恢復網路後，更新市場資料並匯出 CSV，比對頁面篩選、實際名單與交易日期。
2. 檢查自選、儲存策略、AI 設定及歷史資料，並重跑 [固定驗收](../../ACCEPTANCE.md) 的台積電、漢唐、B04.2 A/B。
3. 記錄 Windows 11 版號、硬體、網路狀態及程式 PID。測試多窗、正常關窗、異常退出和重新雙擊。最後窗關閉後應釋放 18765 埠及本機服務。
4. 在隔離資料中心可用後重驗按股、跨月／跨年及新增分片。以資料來源與版本紀錄核對涵蓋，建立共用資料庫仍需管理者的建立權限。

## 開發結果摘要

| 項目 | 證據 |
| --- | --- |
| U01–03、U05、U12 | Windows Server 真實 Release、官方隔離 README 連結變更與跨版通過。Stable 使用未指定案例。 |
| U04 | Beta 與未指定 Stable 可切換。已發布 Stable 的相容降版須等合格正式資產。 |
| U06、U08 | Linux 驗證截斷、雜湊、不安全 ZIP、取消、鎖、健康錯誤回退。另有 Windows 故障與手動回退工作流。斷電及磁碟真實耗盡仍待實機。 |
| U07、U10 | Windows Server 逐包驗收、固定 CSV、A/B、AI 設定及重啟。跨版測試保存瀏覽器設定哨兵。完整舊使用者資料組合待獨立驗收。 |
| U09 | Windows Server 原生 EXE、隨包環境、中文空格路徑、斷網測試通過。Windows 11 實機待驗。 |
| U11 | 官源及程式更新分別驗證。兩者同時滿載的長跑與中斷待驗。 |
| NET、DR | 真實官源、RAM 及資料路由驗證、空索引、管理工具完成。公開資料中心及 Skill 原件未取得。 |
| PROC | Windows Server 實測關窗及固定入口重開。Linux 另記錄程序、埠、非本程式程序及資源用量。Windows 11 實機長跑待驗。 |
