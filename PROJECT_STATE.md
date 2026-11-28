# 專案狀態

## R01 檢查點（2026-11-28 UTC）

| 對象 | 核對結果 |
| --- | --- |
| main | `e3b2c72fc562387b190e4b679860e0e8c7dd1ba5`，合併 #17，僅導航與研究快照。 |
| RC4 程式 | `fe0a5fd4530ca83906f5ba2f28aef0f590cfe109`，與 [草稿 PR #15](https://github.com/Jimmy0916-LAI/chip-screener/pull/15) 及 CI 頭一致。Release 清單最新為 RC4 預發版。 |
| 相關整合 | `feat/v0.6.2-runtime-integration` 為 `2c427636`，有舊封裝與 baseline，沒有現行 desktop 樹。RC4 相對該點新增 desktop 71 個檔案。#13 雙入口與集保、#14 訊號與 AI、#15 集保及全市場復原。 |
| JL／Android | `b07/JL` 為 `84fd627b`，含 20261125 封存、舊 b05.1 EXE、Electron 與 Python 程式及 mobile。Android 平行分支為 `941b8015`。兩者留原樣。 |
| 發行資產 | [RC4 Release](https://github.com/Jimmy0916-LAI/chip-screener/releases/tag/v0.6.5-rc.4)，ZIP 10,532,048 bytes 與 SHA256SUMS.txt。無 manifest。ZIP 重新下載通過完整性測試，SHA-256 為 `384a30beeb4b2fe5b99cd9f453fe3bcfb11f3d41c78623713d967e60fd8e81c3`。 |

R01 分支 `docs/r01-architecture-governance`。文件候選 SHA 以 PR head 為準。此批交付權威入口、架構盤點、驗收、決策和歷史存檔，產品程式及發行資產維持原狀。

## 驗證及阻塞

- 本批查核 `git ls-remote`、`gh release list/view`、`gh pr list`、`gh run view 46067740266`、`sha256sum` 與 `python -m zipfile -t`。
- RC4 乾淨程式基準重跑 `node --test desktop/qa/signal-engine.test.cjs` 8/8、`python3 -B -X utf8 desktop/qa/feed_test.py` 5/5、`python3 -B -X utf8 desktop/qa/ai_router_test.py` 5/5。[既有 Windows CI](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/46067740266) 成功，本批未跑 Windows 11 或獨立正式驗收。
- Skill v1.0 獨立原文未見於工作區或專案。已保存本次訊息提供的契約，DR-01～11 原文待補。
- Stable 尚未發布。當前公開可見性與歷史私庫發布條件衝突，Windows 11、更新器與其他未決事項見 [決策](docs/DECISIONS.md)。
- [歷史進度與測試證據](docs/archive/main-20261128/PROJECT_STATE.md) 留存於封存。

## 續跑

本輪 A–G 已獲整體開發授權。在儲存庫執行 `git fetch origin --tags && git log -1 origin/main && git branch -r`，依 [路線圖](ROADMAP.md) 核對 R01 PR 狀態及產品來源。

## 批次 A 更新

- 來源與上一成功文件提交為 `7f0cd8507a9decf8844acf5dc4875e50cff9ea41`。接續 [PR #18](https://github.com/Jimmy0916-LAI/chip-screener/pull/18)，本文件候選 SHA 以該 PR 的 head 為準。RC5 為產品候選目標。
- 已更新一般使用者網路優先與預設不永久保存市場資料、關窗停止、開發與公開通道權限，新增[缺陷台帳](docs/BUG_TRACKER.md)及專項[驗收](ACCEPTANCE.md)。文件測試執行 `git diff --check`、檢查有效相對連結與驗收 ID。
- DOC-05 阻塞。工作區附件未見 Skill v1.0 原件，全部 Git refs 中指定路徑只有前次摘要。管理 Page 的連結文件檢索也未找到該 Skill 或 DR 原條文。收到原件後依原文保存並核對雜湊與所有驗收 ID。
- 本批紀錄的程式狀態為 RC4。新候選須附完整成品及個別結果。下一步先執行 `git fetch origin --tags && git branch -r && gh pr view 18 --json headRefOid`，在產品整合分支對照本檢查點。
