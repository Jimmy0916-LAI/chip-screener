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
