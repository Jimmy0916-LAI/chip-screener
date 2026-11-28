# 包裝與更新發布

`desktop/scripts/release_meta.json` 提供產品版號。以同一份受測 Git commit 執行 `python desktop/package.py` 產出 Windows x64 ZIP、`SHA256SUMS.txt` 與 `update-manifest.json`。ZIP 需要完整解壓。第一層為 `股票雷達.exe` 與 `resources`。

README 的更新區塊由 Stable 與 Beta 各自指向唯一版本。已支援自動更新的指標包含版號、來源提交、GitHub Release manifest URL 和 manifest SHA-256。沒有候選可配置時用 `null`。RC4 的既有 Beta Release 仍提供手動下載，舊包缺少自動更新的 manifest 與包內身分，客戶端只顯示手動入口。

Manifest 的 `assets.zip` 記錄唯一 ZIP URL、SHA-256 和實際位元組數。Schema、版號、提交、架構和資料相容範圍也嵌入 `resources/update-package.json`。目前資料讀取與寫入版本均為 1。建置使用官方內嵌 Windows Python 3.13.14 和固定 SHA-256。凍結資料仍由既有已校驗的 0.6.2 封存取得。

Github Actions 的 Portable Windows candidate 會重建兩次、核對 ZIP 與 manifest、在 Windows Server 2022 實際以解壓的 EXE 啟動，並上傳候選 ZIP 與驗收證據。上傳 Actions artifact 不改變 Release 或公開通道。Windows 11 x64 實機是獨立驗收環境，需依 `ACCEPTANCE.md` 記錄，包含未安裝系統 Python、中文與空格路徑、首次斷網、搬移、跨版資料、效能與最後視窗關閉行為。
