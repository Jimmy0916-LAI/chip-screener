# 台股籌碼雷達 — 軟體工程架構與模組關係圖

本文檔說明重構後的模組分類、職責邊界、建置管線、執行期資料流與核心資料模型。

---

## 1. 系統分層架構圖（System Layered Architecture）

```mermaid
flowchart TB
  subgraph EXT["外部官方來源 (HTTPS)"]
    TDCC_API["TDCC 集保 OpenData 1-5 CSV"]
    TWSE_API["TWSE 證交所 FMTQIK 月交易日曆"]
  end

  subgraph MAIN["Electron 主行程 (src/main/)"]
    MAIN_JS["main.cjs (視窗 / radar:// 協定 / CSP / IPC)"]
    FEED["official-feed.cjs (更新排程 / 防舊期 / 容錯)"]
    TDCC["tdcc.cjs (1-17 級對帳 / 95% 覆蓋 / 日曆解析)"]
    STORE["storage.cjs (LocalStore 三副本原子儲存)"]
  end

  subgraph DISK["Windows 本機儲存 (%LOCALAPPDATA%/ChipScreener)"]
    STORE_V1["store-v1/ (settings & snapshot)"]
    TDCC_V1["tdcc-v1/ (official & calendar)"]
  end

  subgraph BRIDGE["安全隔離層"]
    PRELOAD["preload.cjs (contextBridge)"]
  end

  subgraph RENDERER["前端單頁應用 (src/renderer/ -> build/dashboard.html)"]
    subgraph CORE["核心引擎層 (core/)"]
      CONST["constants.js / format.js / settings.js"]
      ADAPT["storage-adapter.js (桌面儲存 / 瀏覽器降級)"]
      WEEKLY["weekly-engine.js (週訊號 / 時點閘門 / A/B 比較)"]
      PEAK["peak-model.js (底峰換手衰減模型)"]
      IO["data-io.js (CSV 匯入核對 / 匯出)"]
    end

    subgraph COMP["共用元件層 (components/)"]
      UIKIT["ui-kit.js (指標卡 / 表格 / 狀態列)"]
      CHARTS["charts.js (SVG 折線 / 日K / 成本分布)"]
      FEED_UI["official-feed-panel.js (更新面板與排程)"]
      DIALOG["preset-dialog.js (原生 dialog 命名)"]
    end

    subgraph PAGES["七大頁面與路由 (pages/ + app.js)"]
      ROUTER["app.js (路由與事件委派總線)"]
      P7["home / screen / stock / backtest / peak / settings / data"]
    end
  end

  TDCC_API --> FEED
  TWSE_API --> FEED
  MAIN_JS --> FEED
  MAIN_JS --> STORE
  FEED --> TDCC
  FEED --> STORE
  STORE <--> STORE_V1
  STORE <--> TDCC_V1

  MAIN_JS <--> PRELOAD
  PRELOAD <--> ADAPT
  PRELOAD <--> FEED_UI

  CONST --> ADAPT
  ADAPT --> WEEKLY
  FEED_UI --> WEEKLY
  WEEKLY --> P7
  PEAK --> P7
  IO --> ADAPT
  UIKIT --> P7
  CHARTS --> P7
  DIALOG --> ROUTER
  P7 --> ROUTER
```

---

## 2. 建置與封裝依賴圖（Build & Packaging Pipeline）

重構後完全移除 `git apply` 與 `desktop.patch`，改由 `scripts/build_dashboard.py` 純 Python 組裝所有前端模組：

```mermaid
flowchart LR
  subgraph DATA["凍結研究與基準資料 (data/)"]
    ZIP["chip-screener-phase1.zip"]
    WDATA["web_data.json"]
  end

  subgraph SRC_R["前端原始碼 (src/renderer/)"]
    TPL["index.template.html"]
    CSS["styles.css"]
    MODS["core/* + components/* + pages/* + app.js"]
  end

  subgraph BUILD["純 Python 建置 (scripts/)"]
    EVID["weekly_evidence.py (1-17 級驗收 / 697 交易日)"]
    BUILDER["build_dashboard.py (依序組裝)"]
  end

  subgraph OUT["建置產物"]
    DASH["build/dashboard.html (離線單檔 SPA)"]
    FBASE["data/feed-base.json (母體與雜湊基準)"]
  end

  subgraph SHIP["測試與封裝"]
    TESTS["tests/weekly.test.cjs + storage/feed 單元測試"]
    MAIN["src/main/* + package.json"]
    EXE["ChipScreener.exe (Portable x64)"]
  end

  ZIP --> EVID
  WDATA --> EVID
  EVID --> BUILDER
  TPL --> BUILDER
  CSS --> BUILDER
  MODS --> BUILDER

  BUILDER --> DASH
  BUILDER --> FBASE

  DASH --> TESTS
  DASH --> EXE
  FBASE --> EXE
  MAIN --> EXE
```

---

## 3. 執行期互動時序圖（Startup, Recovery & Background Update）

```mermaid
sequenceDiagram
  actor User as 使用者
  participant Main as src/main/main.cjs
  participant Store as src/main/storage.cjs
  participant Feed as src/main/official-feed.cjs
  participant UI as build/dashboard.html
  participant Ext as TDCC / TWSE 官網

  User->>Main: 啟動 ChipScreener.exe
  Main->>Store: 讀取 store-v1 與 tdcc-v1 最高有效 revision
  Main->>UI: 透過 radar:// 載入頁面 (啟用嚴格 CSP)
  UI->>Main: IPC sync storage:read (settings / snapshot)
  Main-->>UI: 回傳策略設定、手動快照與復原提示
  UI->>Main: IPC sync official:read
  Main-->>UI: 回傳既有官方週資料與交易日曆
  UI->>UI: useDefaultWeek() 選擇最新可嚴格評估週並渲染首頁

  Note over UI,Feed: 啟動 1.5 秒後背景檢查更新（之後每 6 小時）
  UI->>Main: IPC invoke official:update
  Main->>Feed: feed.update() (併發單例鎖)
  Feed->>Ext: 下載 TDCC 1-5 CSV 與 TWSE FMTQIK JSON
  alt 驗證通過 (1-17 級對帳 + 95% 覆蓋 + 無倒退)
    Ext-->>Feed: 官方原始位元組
    Feed->>Store: 三副本原子寫入 (previous -> current -> mirror)
    Feed-->>UI: 回傳新資料與狀態
    UI->>UI: receiveOfficial() 合併資料、重算週訊號並更新畫面
  else 離線 / 逾時 / 舊期 / 驗證失敗
    Ext--xFeed: 攔截錯誤且不覆蓋既有成功資料
    Feed-->>UI: 回報狀態 (離線 / 部分成功 / 失敗)
  end
```

---

## 4. 核心領域資料模型（Domain ER Diagram）

```mermaid
erDiagram
  UNIVERSE_STOCK {
    string code PK "四碼上市櫃代號 (1985 檔)"
    string name "股票名稱"
    string market "TWSE / TPEx"
  }

  TRADING_SESSION {
    date session_date PK "證交所實際成交日 (697+ 日)"
    string month "YYYY-MM"
    string source_sha256 "TWSE 原檔雜湊"
  }

  TDCC_SNAPSHOT {
    date stat_date PK "集保統計日"
    datetime observed_at "公開/取得時間 (+08:00)"
    string provenance "embedded / official / manual"
    string raw_sha256 "原檔雜湊"
    int valid_count "有效檔數"
    int invalid_count "剔除檔數"
  }

  STOCK_WEEKLY_ROW {
    date stat_date FK
    string code FK
    int total_shares "第 17 級總股數"
    int total_holders "第 17 級總戶數"
    int band_shares_4 "200/400/600/1000 張累計股數"
    int band_holders_4 "200/400/600/1000 張累計戶數"
    int level16_adj "第 16 級差異調整"
  }

  STRATEGY_CONFIG {
    string format "chip-screener-config-v1"
    string band "200 / 400 / 600 / 1000"
    int weeks "連升週數 (1-4)"
    float minPp "累計最低增幅 (pp)"
    float weeklyMin "單週最低增幅 (pp)"
    bool needShares "要求股數連增"
  }

  DAILY_2404 {
    date trade_date PK "漢唐 2404 交易日"
    float ohlc "開高低收"
    int volume_shares "成交股數"
    float turnover "換手率 r"
  }

  TDCC_SNAPSHOT ||--o{ STOCK_WEEKLY_ROW : "包含逐股分級"
  UNIVERSE_STOCK ||--o{ STOCK_WEEKLY_ROW : "逐週追蹤"
  TRADING_SESSION ||--o{ TDCC_SNAPSHOT : "對齊交易週與次一開盤"
  STRATEGY_CONFIG ||--o{ STOCK_WEEKLY_ROW : "執行 A/B 篩選評估"
  UNIVERSE_STOCK ||--o{ DAILY_2404 : "日行情與底峰樣本"
```
