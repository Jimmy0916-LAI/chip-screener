# 共用市場資料初始化

兩個骨架目錄分別部署到 `Jimmy0916-LAI/chip-screener-data` 與 `Jimmy0916-LAI/chip-screener-data-2026` 的 `main`。先建立年度庫，確認年度 manifest 可匿名讀取，再部署 catalog 降低使用者讀到尚未建立的路由。GitHub App 本次建立庫回 HTTP 403。現有空索引代表各月尚未提供資料。

`catalog.json` 將年份路由到年度庫。每年 `manifest.json` 依月指向 `indexes/YYYY-MM/<sha256>.json`。月份索引列出 tdcc、universe、daily、broker、volume-profile、calendar、corporate-actions 七類。分片使用 `shards/YYYY-MM/<dataset>/<sha256>.<csv|json>[.gz]`。客戶端與校驗工具共用 `desktop/scripts/providers/data_repository.py` 的版本 1 格式驗證。

有目的庫管理權限時，以骨架的目錄內容建立兩庫首提交。對每批資料先以 `python tools/publish_market_data.py prepare --help` 確定輸入參數。prepare 驗證來源、授權、內容及涵蓋，寫出內容定址分片和待啟用紀錄。上傳分片，匿名讀回核對大小及 SHA-256，再以 activate 生成新月索引並更新年度 manifest。分片與索引路徑保留舊版；驗證後最後才更新 manifest。非官方集保來源須由管理者明確加入授權清單。

```bash
python tools/publish_market_data.py verify \
  --catalog data-repository-skeleton/chip-screener-data \
  --annual data-repository-skeleton/chip-screener-data-2026
```

[資料契約](../docs/DATA_SCHEMA.md) · [資料來源](../docs/DATA_SOURCES.md)
