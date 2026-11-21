# 台股籌碼雷達 v0.5 固定基線

`dashboard.html` 是原始 OneClick ZIP 內的比對原件，可直接離線開啟。六個 `source/` 檔沿用同一 ZIP。唯一的建置腳本調整是用 UTF-8 位元組寫出 HTML，讓 Windows 與 Linux 的換行都與原件一致。前端邏輯、固定資料與七頁測試保留原始位元組。

從儲存庫根目錄，使用 Python 3.12 與 Node.js 24 執行：

```sh
python -X utf8 baseline/v0.5/verify.py
```

驗收在暫存目錄用根目錄的凍結 ZIP 再生成固定資料，逐位元比對 `source/web_data.json`。接著執行原版 Node 模擬 DOM 測試（七頁及漢唐 400 張線兩週增股 796,897、579,084 股），並逐位元比對重建與原始 HTML。驗收無須重新下載任何行情。

如只需以隨附 JSON 重建畫面，可執行 `python -X utf8 baseline/v0.5/source/build_webapp.py`，產物為同目錄的 `開啟籌碼雷達.html`。固定資料版本為 `20261120T021433143982`。既有研究限制可查根目錄的 `PROJECT_STATE.md`。
