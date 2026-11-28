# AGENTS.md — 台股籌碼雷達 AI 開發交接

## 先讀（每次新任務／中斷恢復）
1. 本檔；若在舊分支找不到，以 [main 的 AGENTS.md](https://github.com/Jimmy0916-LAI/chip-screener/blob/main/AGENTS.md) 為入口。
2. [版本與分支索引](https://github.com/Jimmy0916-LAI/chip-screener/blob/main/docs/VERSION_INDEX.md)，核對即時 GitHub HEAD、tag、PR、CI，不將快照當最新狀態。
3. 目標分支的 PROJECT_STATE.md、PRODUCT_SPEC.md、ROADMAP.md。B06 的 PROJECT_STATE.md 止於 B05，另查 PR #7、v0.6.0-b06.1 與 CI。不要重讀無關歷史或自行重寫原研究。
4. 涉及資料、回測、籌碼峰、券商分點等工作，必讀 [外部資源知識庫](https://github.com/Jimmy0916-LAI/chip-screener/blob/main/docs/research/EXTERNAL_DATA_SOURCES_20261127.md)。其中列出來源、文件／實際資料證據、授權與未驗項目；候選不能當成已驗收。
5. 先列出基準 SHA、範圍、驗收及停止條件。單一批次、增量修改、測試後提交，更新當批 PROJECT_STATE 或連結證據，保留恢復點。

## 分支與保護
- **b07/JL 禁止修改、刪除、改名、移動、rebase、force-push 或合併。** 審查只讀；需整合時另開分支，經所有者批准後再採納。
- feat/android-mobile 為平行線，沒有明確任務不得修改。
- 目前 Windows 封測基準為 v0.6.5-rc.4（fe0a5fd4530ca83906f5ba2f28aef0f590cfe109）。從可追溯的程式提交開分支，完整 CSV 必須通過 1,985 檔與畫面逐股對帳。
- 不改動既有版本標籤或歷史 PR；正式合併、發布及策略變更須另獲批准。
- 新分支命名：feat/v0.6.1-短英文功能、fix/v0.6.1-短英文問題、research/v0.7.0-短英文主題、docs/短英文主題；版本以 vMAJOR.MINOR.PATCH，預發測試 v0.6.0-b06.1 等。分支不是發行版本，禁止為未驗證功能冒用正式 tag。

## 交付與研究底線
- Windows 11 x64 免安裝單檔 ChipScreener.exe；斷網首次開啟、搬移、七頁、設定與資料持久化、舊資料復原及背景更新。Windows Server CI 不等於 Windows 11 實機驗收。
- 集保驗收用台積電 2330 的 2026-11-13 固定窗口，400 張以上兩週 −37,973,336 與 −10,706,718 股，累計 −0.187719263 pp。集保 1–17 級算術對帳、缺值與同窗 A/B、公開時間證據、交易日曆、公司行動。禁止前視洩漏及未驗資料正式績效。
- 分點不是單一投資人；未上榜不等於零；FIFO／加權成本只可稱估算。資料與 EXE 分離；原始、標準化、衍生資料分層，保留來源、hash、授權、可用時點。
- 外部程式碼與資料需確認各自授權；不提交受限資料或 API key，不繞過驗證、不停用 TLS。候選研究以合成測試和隔離資料開始。
- 完成須記錄實際 commit、版本、測試命令與結果、ZIP hash、CI/Artifact 連結、有效期限、已知缺陷與下一步。沒有證據標待驗，不能編造。
