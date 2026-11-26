# 外部資料與技術資源登錄｜2026-11-27

範圍：台股籌碼雷達 v0.6.0-b06.1（基準 be72aa33b57100c14c77ff7e1d481849faf6981e），為後續 v0.6.1 整合與 v0.7 分點／籌碼峰研究準備。僅登錄證據及研究計畫；未匯入外部資料、複製程式碼、執行第三方程式或更動產品。評級 S/A/B 指研究優先級，非正式驗收。

## S｜優先研究

1. https://github.com/wirelessr/tdcc-opendata-archive
   - 實際目錄 snapshots/2021 與 snapshots/2026：13 份（2021-07-02~09-24）及 30 份（2026-04-30~11-20），合計 43 份 CSV；約 1.7~2.4 MB/週。非連續五年歷史。
   - 證據：https://github.com/wirelessr/tdcc-opendata-archive/tree/main/snapshots ; https://github.com/wirelessr/tdcc-opendata-archive/blob/main/LICENSE
   - LICENSE blob ec46aca2c6ebbe425a09fccf7b35fd0f82330e8e；2026-11-13 CSV blob 2e11d4ea2ebd26a6c6aff412e51145fa755c61d0；11-20 blob 84caa2b2656fd3c9691174985b3b9bb03ad032e0。
   - 腳本 MIT；資料聲明為政府資料開放授權第1版，來源 TDCC https://data.gov.tw/dataset/11452 。2021 來自 lisa4930007 備份，應追溯來源；大型 CSV 未能讀回正文，未逐筆驗證。先補集保歷史與驗證，不直接接受入正式回測。
2. https://github.com/tongwade/stock-daily （相關 https://github.com/tongwade/tw-stock-daily，不重複計為獨立資料源）
   - site/data 9 個日期 2026-05-27~06-08；相關 repo 查得 8 個日期至 06-05。06-08 五檔 2344/3037/3105/6257/6261 加 market.js。
   - 已讀取並解析 https://github.com/tongwade/stock-daily/blob/HEAD/site/data/20260608/6261.js （blob 72a60c5dcaca932af170c89d9f7690e55ed7ced3），buy_top/sell_top 各20、price_volume 39、broker_detail 1758 筆。逐價位分點買賣股數、分點買賣均價。未完成總量對帳、其他日期/股票完整度、授權；禁止將公開可見當成可散布授權。只作研究候選，不直接複製資料或爬蟲；不得繞過驗證。
3. https://github.com/tw-lws/StockBrokerPriceCorrelation
   - data/0050_broker_trading.csv 1182678 bytes（blob e94d2ecb4fd6b60458cf58c869accf109c8cbeb4）；9217_from2023-11-15to2023-12-15_trader_trading.csv 2064676 bytes；all_stock_close_price_from2023-11-15to2023-12-15.csv 49101615 bytes；taiwan_stcok_securities_trader_info.csv 73249 bytes。
   - 檔案存在，CSV 正文未能讀回；日期只由檔名推得，來源與授權待證。研究分點代號與統計方法；程式有停用 TLS 驗證，不沿用。不得直接使用未驗證資料進正式模型。
4. https://github.com/yukishirotsubasa/tw-stock-data-release
   - https://github.com/yukishirotsubasa/tw-stock-data-release/releases/tag/daily-close-csv 實際 assets 有 yearly_2004.zip~yearly_2025.zip，2026 W01~W47（W08 未列，須依交易日曆判斷），2025 11020470 bytes。日收盤歷史候選，非分點。ZIP 內容、授權、公司行動與缺漏未驗。
5. https://github.com/nanachi1212/TWstockfor_tick-stock-panel
   - https://github.com/nanachi1212/TWstockfor_tick-stock-panel/releases/tag/data-daily-2026-11-25 實際 asset nanachi-tw-daily-2024-01-02_to_2026-11-25.zip 65327990 bytes；未解壓。
   - docs/taiwan-data-sources.md 已讀，含 TWSE/TPEx 單位差異、公司行動與 available_at 無證據保持 null 等設計。根目錄有 LICENSE（未核對資料授權）；適合資料驗收、時點規格、封裝架構研究。非完整分點歷史資料來源。

## A｜有價值的輔助資料與方法

6. https://github.com/wirelessr/three-gate-screener
   - README 已讀：MIT 程式碼；data gitignored。作者報告 476 檔 × 2023–2026 免費代理策略未發現可靠 alpha；不代表分點策略無效。研究 walk-forward、停損、集保戶數、免費代理與負結果。不要照搬研究結論。
7. https://github.com/lisa4930007/ownership_distribution_access_db
   - 根目錄 access_stock_ratio.accdb 18771968 bytes、csv/；2021 Q3 13 週由 wirelessr 專案引用，避免重複計算；原庫無明示授權（three-gate README 亦指出），優先採用有來源聲明的 TDCC archive。未打開 Access DB。
8. https://github.com/twcs-analysis/tw-stock-collector
   - data/raw 實見 etf-holdings、institutional、lending、margin、price、revenue-daily/monthly、stock_futures、top20_volume；institutional/2026 目錄含 01~08。資料正文及授權未驗。研究三大法人、借券、融資券及營收交叉驗證；不是券商分點。
9. https://github.com/voidful/tw_stocker
   - data/manifest.json 已讀：1213 files、38,707,210 records、3,704,718,436 bytes；2024-02-15~2026-04-01；1162 intraday、51 daily。manifest 非逐檔驗證；2330.csv 正文未讀回。時區混合 offset、除權息/拆股、授權、頻率必驗。適合價量回測，不是分點。
10. https://github.com/0301kenny/wfnt-snapshot-data
   - README 已讀：原始官方 bytes、manifest、分段續跑、公司行動及點時資料設計；main 根目錄未見 data/、releases 空，不能宣稱有可直接下載的歷史資料。研究工程設計。
11. https://github.com/elan7192/pulse-twstock
   - data/twse-daily 實見 199 個日期 JSON（起 2026-02-23）；部分假日 2 bytes 空檔。data/open 實見融資券、注意/處置股票、期貨、可轉債等檔。資料正文及授權待查，須依交易日曆判斷空檔。適合風險及輔助欄位。
12. https://github.com/Asoul/tsec
   - data/2330.csv 已讀正文，起始 83/09/05（1994-09-05）；9 欄日量價，README 2017-02-15 更新，實際末日待核。資料授權待查。舊歷史交叉驗證候選，不是分點。

## B｜供應商／工具（待獨立驗證）
- https://github.com/FinMind/FinMind 與 https://github.com/FinMind/FinMind-MCP ：API/SDK 候選，非免費完整分點資料庫；本輪未重新驗證 repo 內部、價格及授權。
- https://finmind.github.io/tutor/TaiwanMarket/Chip/ ；https://finmind.github.io/Pricing/ 。先確認資料留存、第三方共享及衍生資料授權，不在共同 GitHub 提交受限資料。

## 接續開發驗收
- P0：TDCC archive 下載至隔離研究區，保留 URL、commit/blob、原始 SHA256、取得時間、統計日、歷史可用時間證據、授權及缺期。1~17 級對帳、分母、代號、重複及原官方檔交叉驗證。重現漢唐 796897/579084 股與 +0.721971163 pp；勿把新下載時間當成歷史首次公布時間，缺證據不准正式回測。
- P0：分點樣本做股數/張數、券商代號、價位、日期、買賣合計與官方成交量範圍對帳；確認零股、盤後、鉅額範圍。未上榜與缺檔不得當成零。樣本須有來源及允許的使用方式，無明確授權不匯入正式資料庫或分享。
- P1：行情 ZIP 隔離下載、校驗、抽樣比對官方來源、歷史母體與公司行動、交易日曆、除權息、時區；不可把事後更新的資料視為當時已知。
- P1：建立統一 provider 介面；原始、標準化、衍生三層；獨立 SQLite / Parquet / DuckDB 資料庫，不把大檔塞進 EXE；保留上次成功與原版三副本容錯。
- P2：分點 5/10/20/60/120 日淨流量、方向性、均價、FIFO/加權成本模型（估計，非真實庫存）；與集保、K線同時點對齊。分點不是投資人，不推定實際對手方。
- P2：用無授權風險的合成資料建立測試。再依授權取得真實樣本，做獨立回測審查；禁止未驗證資料產出正式績效。
- 本次無完整免費五年全市場分點歷史庫的已核實證據。未下載大型二進位 ZIP/Access DB，未完成全量資料對帳、法律審查、第三方程式執行或 Windows 11 實機驗收。這是候選登錄，不是資料已整合或正式驗收。
