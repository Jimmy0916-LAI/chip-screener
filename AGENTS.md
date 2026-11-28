# AI 開發規則

每次任務與中斷恢復先讀本檔及 [PROJECT_STATE.md](PROJECT_STATE.md)。依任務讀 [產品規格](PRODUCT_SPEC.md)、[架構](ARCHITECTURE.md)、[路線圖](ROADMAP.md)、[驗收](ACCEPTANCE.md)、[資料來源](docs/DATA_SOURCES.md)、[資料契約](docs/DATA_SCHEMA.md) 或 [決策](docs/DECISIONS.md)。

開工先核對工作區、遠端 HEAD、分支、Tag、PR、Release 資產與 CI，記錄基準與當批停止條件。沿用既有實作，重構前建立可重現問題、依賴分析、回歸及回退方案。小批次驗證後提交，於 PROJECT_STATE 記錄來源及候選 SHA、分支、PR、修改目的、測試命令與結果、ZIP 與雜湊、阻塞及續跑方式。

產品負責人批准需求變更、正式合併及發布。Beta 發布須當批授權。正式驗收由獨立驗收助理判定。保留 JL、Android、歷史分支與 Tag，禁止強推、改寫歷史或修改友方儲存庫。外部來源確認授權，憑證不得寫入版本庫或日誌。工作止於當批邊界。
