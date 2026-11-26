# 籌碼雷達 Android 行動版（ChipScreener Mobile）

本目錄包含將台股籌碼雷達（v0.6.0-b05.1）完整移植至 **Android 11+（API 30+）** 的 Capacitor 專案、純 JavaScript 後端引擎、原生安全外掛與 GitHub Actions 自動打包管線。

## 一、如何取得可直接安裝的 Release APK（推薦：GitHub Actions 雲端建置）

本機不需安裝 Android Studio 或 JDK，只要將專案推送到 GitHub：

1. 將此目錄變更 `git add`、`git commit` 並 `git push` 至您的 GitHub 儲存庫。
2. 開啟 GitHub 儲存庫 → **Actions** → 選擇 **Android APK Build & Verify** → 點擊 **Run workflow**（或推送至 `main` 分支自動觸發）。
3. 建置完成後（約 4–6 分鐘），在該次執行頁面底部的 **Artifacts** 下載 `ChipScreener-v0.6.0-b05.1-Android-APK`，解壓即可取得：
   - `ChipScreener-v0.6.0-b05.1-android-release.apk`（可直接傳至 Android 11+ 手機安裝）
   - `*.sha256`（APK 完整性雜湊校驗檔）

### 進階：固定自簽金鑰（讓日後更新可直接覆蓋安裝，不需先移除舊版）

若未設定 GitHub Secrets，工作流程會自動產生一次性自簽金鑰供直接安裝。若希望日後每次產出的 APK 都能直接覆蓋升級並保留手機資料：

1. 在任一台有 JDK 的電腦執行：
   ```bash
   keytool -genkeypair -v -keystore chipscreener-release.jks -alias chipscreener -keyalg RSA -keysize 2048 -validity 3650
   ```
2. 將 `.jks` 轉成 Base64（`base64 -w 0 chipscreener-release.jks`），於 GitHub 儲存庫 **Settings → Secrets and variables → Actions** 新增四個 Secrets：
   - `ANDROID_KEYSTORE_BASE64`
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_ALIAS`（例如 `chipscreener`）
   - `ANDROID_KEY_PASSWORD`
   > 切勿將 `.jks` / `.keystore` 提交至 Git（已加入 `.gitignore`）。

---

## 二、安全協議與資料安全設計

| 防護層面 | 實作機制 |
| --- | --- |
| **傳輸安全 (TLS)** | `network_security_config.xml` 全面禁止明文 HTTP（`cleartextTrafficPermitted="false"`），強制系統 CA 驗證；`ChipNativePlugin.java` 與 `http.js` 雙層白名單僅允許 9 個官方／行情 HTTPS 網域，且逐跳檢查 301/302 重新導向目標，回應上限 16MB。 |
| **敏感金鑰隔離** | 選填的 Gemini API Key **僅儲存於 Android Keystore 硬體加密金庫（AES-256-GCM）**，絕不寫入明文 JSON；呼叫 Gemini API 時改走 `x-goog-api-key` HTTP 標頭（不放在 URL 查詢參數）；`allowBackup="false"` 與 `data_extraction_rules.xml` 禁止雲端備份敏感資料。 |
| **WebView 與 CSP 強化** | `mobile/www/index.html` 採嚴格 CSP（`script-src 'self'`，**零 inline script**、`object-src 'none'`、`form-action 'none'`）；Release 關閉 `webContentsDebuggingEnabled`；外部新聞連結強制以系統瀏覽器開啟且僅限 `https://`。 |
| **資料完整性與容錯** | `MobileLocalStore` 延續桌面版 `current / mirror / previous` 三副本原子寫入（`tmp → fsync → rename`）與 SHA-256 校驗，異常斷電或損毀時自動從備份復原；檔案存取限定於 App 私有目錄並防禦路徑遍歷（`../`）。 |

---

## 三、行動版排版與效能優化

- **全頁面側邊抽屜（`☰`）**：保留底部快速導覽列，同時在左上角新增滑出式抽屜，手機上可一鍵存取全部 9 個台股頁面與 5 個美股頁面並切換台／美股模式。
- **Safe Area 與觸控體驗**：支援 Android 狀態列與手勢列安全區域（`viewport-fit=cover` + `env(safe-area-inset-*)`）、按鈕與輸入框觸控最小尺寸、輸入框 `16px` 防自動縮放、表格平滑橫滑。
- **K 線觸控十字準線**：支援手指點擊與拖曳 `#klineCanvas` 即時查價與均線數值。
- **Android 系統整合**：支援硬體返回鍵頁面回退（根頁連按兩次離開）、每日 10:00 晨報本機通知（點擊通知直達晨報頁）、App 退居背景時自動暫停 S&P 500 掃描並限制併發數 ≤ 6 以省電。
- **靜態資源拆分 + R8 壓縮**：將 1MB 凍結基準資料、執行期與前端 SPA 拆分載入避免阻塞首屏，Release APK 啟用 R8 混淆與資源縮減。

---

## 四、本機開發與測試指令

```powershell
# 執行行動版全部 29 項單元與整合測試（Node 20+）
node --test mobile/tests/*.test.cjs

# 編譯行動版靜態資源至 mobile/www/（Python 3.10+）
python -X utf8 mobile/scripts/build_web.py
```
