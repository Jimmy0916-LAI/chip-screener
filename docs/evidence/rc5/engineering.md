# RC5 開發紀錄

## 整合基準

2026-11-28 UTC。develop 由 RC4 產品 fe0a5fd 與 PR #18 文件 7f0cd85 建立。整合點 f756ee5 相對 RC4 的 desktop、packaging、.github 差異為空。main e3b2c72 與 RC4 的獨有提交各為 12、50，PR #15 的基底是 feat/v0.6.5-signals-ai。產品預發行與公開通道切換分別授權。

## 舊版換版阻塞的實測

以 SHA-256 為 384a30beeb4b2fe5b99cd9f453fe3bcfb11f3d41c78623713d967e60fd8e81c3 的 RC4 發行 ZIP 解壓至暫存資料夾，使用個別 LOCALAPPDATA。ZIP 為 10,532,048 bytes，檔案解壓大小合計 21,496,931 bytes。Linux 使用系統 Python 執行成品的 resources/scripts/launcher.py --no-open --portable --no-runtime --port 19174。GET /api/health 顯示 appVersion 與 shellVersion 皆 0.6.5-rc.4，usingRuntime 為 false。以同來源 POST {} 呼叫下列路徑：

| 路徑 | 實際 HTTP 狀態 |
| --- | --- |
| /api/software/update/apply | 409 |
| /api/software/rollback | 409 |
| /api/software/restart | 409 |

RC4 Release 只有 Windows x64 ZIP 與 SHA256SUMS.txt。首次移至支援完整包更新協議的版本，需要手動下載一次。

## 開發與證據範圍

- 修復分支分別負責封裝、完整更新器、資料服務、視窗生命週期及資料完整性。整合時以各分支已測提交為來源。
- 本次 GitHub App 在建立資料 repo 時回 HTTP 403，採可部署骨架途徑。DOC-05 的 Skill 獨立原文待取得。
- Windows 11 與獨立驗收另行記錄。測試包不得指定給公開 Beta。

## 發行候選與回歸

| 資產 | 原始碼 | ZIP SHA-256 | Windows Server 2022 成品測試 |
| --- | --- | --- | --- |
| [RC5 開發驗收包](https://github.com/Jimmy0916-LAI/chip-screener/releases/tag/v0.6.5-rc.5) | 89eef1ffb8ffea5c71bd367c6a1573267c2bf32e | 0244b9495e448fe5ee0b2eb01422982a78b66489621af5be9ffe6404c3b64cc2 | [46133591816](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/46133591816) 通過 |
| [RC6 跨版驗收目標](https://github.com/Jimmy0916-LAI/chip-screener/releases/tag/v0.6.5-rc.6) | d155578950b9e21ed437c39861f9544468782bff | d66b64a594536f7bc9812e4056474ab4151f969df9d9db938b5ea3e600a2c04e | [46133624913](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/46133624913) 通過 |

兩個 Release 均為預發版。以匿名下載讀回的 ZIP 和對應 CI Artifact 逐位元相同。公開通道仍為 RC4。RC5／RC6 使用固定官方儲存庫 HTTPS、Release 資產 digest、Tag commit 及雙重雜湊清單。Authenticode 及獨立簽章金鑰未配置，信任取決於官方儲存庫發布權限與 GitHub HTTPS。

RC5 → RC6 原生跨版通過 [Windows 測試工作流](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/46133876934) 。調整隔離 README 的 Beta ZIP 指標前，RC5 保持目前版，儘管 RC6 已發布。改連結後，程式按鈕下載 RC6，完成健康檢查並由固定 EXE 重開。瀏覽器設定哨兵保留。新版關窗後 Python 與埠均釋放。測試僅將同一官方儲存庫的 README 讀取轉向隔離分支，其餘下載、雜湊、套用、服務停止、資源驗證、重啟及固定入口走實際包內程式。跨版與 Windows 11 驗收分開記錄。

## 真實市場與程序證據

RC5 原始發行包經隔離 Linux Chromium 使用官方集保和兩交易所名單。11/27 週成功匯出 1,991 檔，使用階段未落盤市場快取。原固定 1,985 檔語義保留於歷史驗收。詳 [官源瀏覽器證據](official-data-browser.json)。

| Linux 隔離瀏覽器量測項目 | RC4 | RC5 |
| --- | ---: | ---: |
| ZIP bytes | 10,532,048 | 12,881,933 |
| 解壓檔案 bytes | 21,496,931 | 26,130,822 |
| 冷啟動秒數 | 1.35 | 1.42 |
| 閒置單核 CPU 比例 | 0.2% | 0.0% |
| 瀏覽器與服務閒置合計 RSS | 568.4 MB | 568.1 MB |
| 篩選量測 RSS 峰值 | 591.1 MB | 590.4 MB |
| 最後關窗至服務退出 | 4.08 秒 | 4.09 秒 |

新 ZIP 因更換受支援的內嵌 Python 而增加容量。此為同一 Linux 主機、loopback-only 冷設定檔單次量測。RSS 包含 Chromium 程序，切股後 RC5 約 632.7 MB。PORT 18765 釋放，非本程式的 Python 存活，重新開啟成功。數值不能替代 Windows 11 資源驗收。原始量測見 [RC4](rc4-linux-benchmark.json) 與 [RC5](rc5-linux-benchmark.json)。

資料中心日曆跨年月、按股票選擇、記憶體重用、時點修訂、雜湊拒絕與取消驗證，可重跑 `python -B desktop/qa/data_repository_test.py`。建立資料庫權限與 DOC-05 原件阻塞另見 PROJECT_STATE。
