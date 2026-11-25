# 台股籌碼雷達（ChipScreener v0.6.0-b05.1）

台股集保股權分散（TDCC 1-5）與大戶週籌碼研究分析軟體，採離線優先、嚴格時點防前視與本機三副本容錯架構。

## 專案目錄與模組分類

```text
chip-screener-0.6.0-b05.1/
├── package.json                       # Electron 與 Portable x64 封裝設定
├── README.md                          # 專案入口說明
├── docs/                              # 架構圖與產品規格文件
│   ├── ARCHITECTURE.md                # 完整模組分類與軟體工程關係圖 (Mermaid)
│   ├── PRODUCT_SPEC.md                # 產品規格與金融研究限制
│   ├── ROADMAP.md                     # 版本批次與開發路線圖
│   └── PROJECT_STATE.md               # 歷史驗收與交付狀態
├── data/                              # 凍結研究資料與建置基準
│   ├── chip-screener-phase1.zip       # 凍結研究原始證據包 (v0.4)
│   ├── web_data.json                  # 基礎離線市場資料與 2404 日 K
│   └── feed-base.json                 # 建置產出：官方更新母體／日曆／雜湊基線
├── src/
│   ├── main/                          # Electron 主行程與系統層 (Node.js)
│   │   ├── main.cjs                   # 視窗、radar:// 協定、CSP 與 IPC 路由
│   │   ├── preload.cjs                # contextBridge 安全橋接
│   │   ├── storage.cjs                # LocalStore 三副本原子儲存與 schema 校驗
│   │   ├── tdcc.cjs                   # TDCC 1-5 CSV 與 TWSE FMTQIK 日曆解析
│   │   └── official-feed.cjs          # 官方資料下載、驗證與容錯排程
│   └── renderer/                      # 前端模組化原始碼 (Vanilla JS + SVG)
│       ├── index.template.html        # 頁面骨架
│       ├── styles.css                 # 簡約大氣專業深色設計系統
│       ├── app.js                     # SPA 路由、主渲染器與事件委派總線
│       ├── core/                      # 運算引擎與狀態配接
│       │   ├── constants.js           # 常數、級距色彩、預設策略參數
│       │   ├── format.js              # 數值／百分比／日期工具與安全轉義
│       │   ├── settings.js            # 策略參數範圍驗證
│       │   ├── storage-adapter.js     # 桌面儲存配接器 (支援獨立瀏覽器降級)
│       │   ├── weekly-engine.js       # 統一週訊號、嚴格時點閘門、掃描與 A/B 比較
│       │   ├── peak-model.js          # 底峰換手率衰減成本分布模型
│       │   └── data-io.js             # CSV 匯入驗證與 CSV/JSON 匯出
│       ├── components/                # 共用元件與圖表
│       │   ├── ui-kit.js              # 頁首、指標卡、表格、週期選擇器與狀態列
│       │   ├── charts.js              # SVG 圖表 (集保折線 / 2404 日 K / 成本分布)
│       │   ├── official-feed-panel.js # 官方更新面板與排程
│       │   └── preset-dialog.js       # 原生 <dialog> 方案命名彈窗
│       └── pages/                     # 七大功能頁面
│           ├── home.js                # 01 研究總覽
│           ├── screen.js              # 02 全市場篩選
│           ├── stock.js               # 03 個股研究
│           ├── backtest.js            # 04 回測與 A/B 比較
│           ├── peak.js                # 05 底峰研究
│           ├── settings.js            # 06 策略設定與方案管理
│           └── data.js                # 07 資料來源、匯入與驗收
├── scripts/                           # Python 建置與證據檢核工具
│   ├── build_dashboard.py             # 純 Python 模組化建置器 (無需 git apply)
│   ├── weekly_evidence.py             # 凍結證據驗證與 1,985 檔／697 日曆擴充
│   └── make_web_data.py               # 由凍結 ZIP 重建 web_data.json
├── build/
│   └── dashboard.html                 # 編譯產出之離線單檔應用 (可直接瀏覽器開啟或由 Electron 載入)
└── tests/                             # 單元測試、整合測試與 Windows 成品驗收
    ├── storage.test.cjs
    ├── feed.test.cjs
    ├── weekly.test.cjs
    ├── gui.cjs
    └── accept.ps1
```

## 快速啟動與建置

### 一鍵啟動（推薦，免記指令）
直接雙擊根目錄的 **`ChipScreener.exe`**（無黑框原生 64 位元啟動器；若需檢視終端機日誌也可使用 `啟動籌碼雷達.bat`），將自動完成：
1. 偵測程式碼是否有修改，必要時自動執行 `scripts/build_dashboard.py` 重新編譯。
2. 檢查本機服務是否已在運行（若已運行直接開啟畫面，不重複佔用連接埠）。
3. 啟動本機官方更新後端（`scripts/serve_local.py`，支援 TDCC 集保與 TWSE 交易日曆即時更新）。
4. 自動以獨立應用視窗開啟操作介面。

### 手動指令

```powershell
# 1. 編譯離線單檔介面與官方比對基線 (僅需 Python 3.10+)
py -X utf8 scripts/build_dashboard.py

# 2. 啟動一鍵啟動器（可附加 --rebuild 強制重編、--browser 改以一般瀏覽器分頁開啟）
py -X utf8 scripts/launcher.py

# 3. 執行自動化測試（需 Node.js 24+）
node tests/weekly.test.cjs
node --test tests/storage.test.cjs tests/feed.test.cjs

# 4. 打包 Windows x64 免安裝單檔 EXE
npm ci
npm run dist
```

詳細系統分層架構圖、依賴管線、執行期時序與資料模型 ER 圖請參閱 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
