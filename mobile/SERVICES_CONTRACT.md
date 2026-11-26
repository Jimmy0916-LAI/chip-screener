# 行動版服務層移植契約（Python providers → JavaScript）

本文件規範 `mobile/src/services/*.js` 的撰寫方式。這些檔案把 `scripts/serve_local.py` 與 `scripts/providers/*.py`
的後端邏輯移植成可在 Android WebView 內執行的 JavaScript，前端 `src/renderer/**` 不需修改：
`mobile/src/platform/api-router.js` 會攔截前端的 `fetch('/api/...')` 並呼叫這些服務。

## 1. 檔案格式

- 純瀏覽器腳本（**不可**使用 `import`/`require`/ES module），以 IIFE 掛到 `globalThis.ChipMobile`：

```js
(function (CM) {
  'use strict';
  // ...
  CM.usMarket = { UsMarketService, analyzeUsBars, US_UNIVERSE_MAP, ... };
})(globalThis.ChipMobile = globalThis.ChipMobile || {});
```

- 跨模組相依一律在**呼叫時**才取用（例如 `CM.news.fetchYahooQuote(...)`），不可在載入時取用，因為載入順序可能不同。
- 所有 I/O 方法皆為 `async`。Python 的 `threading.Lock` 改為「單一進行中 Promise」(single-flight)。
- Python 的背景執行緒（例如美股全市場掃描）改為不 await 的 async 任務，狀態存在記憶體並定期寫檔；
  長時間迴圈內呼叫 `await CM.lifecycle.waitActive()`，讓 App 退到背景時暫停以省電。
- Python `ThreadPoolExecutor(max_workers=N)` → `CM.util.pool(items, N, worker)`（行動網路建議 N ≤ 6）。

## 2. 平台 API（已實作於 `mobile/src/platform/`）

| API | 說明 |
| --- | --- |
| `CM.ValueError` | 對應 Python `ValueError`，路由會映射成 HTTP 400；其他錯誤映射 500（依 serve_local.py 原規則） |
| `CM.http.request({url, method, headers, json, timeoutMs, maxBytes})` | 回傳 `{status, ok, headers, bytes, text(), json()}`；不因 4xx/5xx 拋錯；網路錯誤拋 `'連線失敗 ...'`、逾時拋 `'連線失敗 逾時'` |
| `CM.http.getOk(url, {timeoutMs, headers, maxBytes})` | 非 200 拋 `Error('HTTP <code>')`（`err.status` 帶狀態碼） |
| `CM.http.postJson(url, payload, opts)` | POST JSON |
| `CM.fs.readJson(path, fallback)` / `readJsonMeta(path)` → `{value, mtime, damaged}` / `writeJson(path, v)`（原子） / `readText` / `writeText` / `list(dir)` → `[{name, mtime, size}]` / `remove(path)` | 路徑為 App 私有目錄下的相對路徑，例如 `'us-cache-v1/overview.json'`；只允許 `[A-Za-z0-9_.-]` 與 `/` |
| `CM.vault.get/set/remove(key)` | Android Keystore 加密保存（敏感金鑰專用，如 Gemini API Key） |
| `CM.notify.permission(request)` / `scheduleDaily({id, hour, minute, title, body})` / `cancel(id)` / `pending()` | 每日本機通知，取代 Windows `schtasks` |
| `CM.time.taipeiParts(ms?)` → `{year, month, day, hour, minute, second, weekday(0=週一), date:'YYYY-MM-DD', time:'HH:MM', ms}` | Python `datetime.now(TAIPEI_TZ)` |
| `CM.time.taipeiIso(ms?, timespec='milliseconds'|'seconds'|'minutes'|'microseconds')` | Python `isoformat(timespec=...)`，固定 `+08:00` |
| `CM.time.addDays('YYYY-MM-DD', n)` / `CM.time.parseIso(text)` | 日期工具 |
| `CM.util.sha256Hex(bytes|string)` / `pool` / `sleep` / `pyRound(x, n)` / `utf8Decode(bytes)`（去 BOM） | 工具；Python `round()` 請用 `pyRound` |
| `CM.base` | `{ stocks, series, universe, sessions, hashes, usUniverse }`：<br>`stocks`/`series` = `data/web_data.json`（經 build 擴充）的同名欄位；`universe`/`sessions`/`hashes` = `data/feed-base.json` 內容；`usUniverse` = `[[code, name, sector], ...]`（即 `data/sp500_universe.json` 的 items） |
| `CM.lifecycle.waitActive()` | App 在背景時等待 |

**網路白名單**（`http.js`）：`opendata.tdcc.com.tw, www.twse.com.tw, api.finmindtrade.com, query1/query2.finance.yahoo.com,
tw.stock.yahoo.com, feeds.feedburner.com, search.cnbc.com, generativelanguage.googleapis.com`。
若 Python 使用了其他網域，**回報給協調者**，不要自行繞過。

**Python 檔案路徑對應**：`%LOCALAPPDATA%/ChipScreener/<x>` → `CM.fs` 相對路徑 `<x>`（例如 `us-cache-v1/...`）。
`project_root` 下的資料（web_data.json、sp500_universe.json）改用 `CM.base`。

## 3. 行為一致性要求

1. **回傳 JSON 結構必須與 Python 完全一致**（鍵名、型別、null/空字串、數值四捨五入位數），前端依此渲染。
2. 錯誤訊息文字沿用 Python 原文（繁體中文）。
3. 以 `CM.util.pyRound` 取代 `round()`；Python 整數除法 `//` → `Math.floor`；`sorted()` 穩定排序 → `Array.prototype.sort`（亦為穩定）。
   注意 Python 字串比較與 JS 一致（皆依 code point），但 `sort()` 無比較函式時 JS 會轉字串——數值排序務必提供比較函式。
4. Python `datetime.fromtimestamp(ts, tz)` → 以 `(ts + gmtoffset) * 1000` 搭配 `getUTC*` 取得日期，勿用裝置時區。
5. 平台限制差異（例如 Windows 排程）改為行動版等價功能，並在檔頭註解說明。

## 4. 測試

- Node 可執行檔：`C:\Users\jerry\.gemini\antigravity\brain\615f4424-5beb-435f-bc08-69ab85daf3c4\scratch\node-v24.22.3-win-x64\node.exe`
  （PowerShell 下請用 `node.exe` / `npm.cmd`，沙箱無外部網路）。
- 測試替身：`mobile/tests/harness.cjs` 的 `createEnv({ files, routes, base, now })`，提供記憶體版 HTTP 路由、檔案、金庫與通知，以及可控時鐘。
- 每個服務檔撰寫 `mobile/tests/<name>.test.cjs`（使用 `node:test` + `node:assert/strict`），以偽造的 Yahoo/FinMind/TDCC/RSS 回應驗證：
  主要回傳結構、計算結果（若可行，與 Python 對同一份輸入的結果比對；Python 3.10 位於
  `C:\Users\jerry\AppData\Local\Programs\Python\Python310\python.exe`，可寫暫存腳本以 monkeypatch `_http_get` 取得對照值）、錯誤路徑。
- 執行：`node.exe --test mobile/tests/`
