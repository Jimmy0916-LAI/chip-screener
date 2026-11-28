---
name: stock-radar-data-repository
description: 保存台股籌碼雷達未來 GitHub 資料中心的已提供契約。
metadata:
  source-version: "1.0"
  source: "產品負責人 R01 指令，第 7 節"
  status: "原文附件待補錄"
  acceptance: "DR-01～11"
---

# GitHub 資料中心

以下保存本次訊息提供的完整資料中心條文。獨立 Skill v1.0 附件與各驗收 ID 條文待補錄。

遵循附帶的 stock-radar-data-repository Skill v1.0。

程式 repo 與歷史資料 repo 分離。

預定採全域 catalog、年度資料庫、月份及個股分片。客戶端依日期自動路由，先讀本機有效快取，再查共享資料庫，最後使用合法原始來源或匯入補缺。

集中收集集保全市場資料，合法且驗證通過的分點與分價可由管理者按需共享。普通用戶預設唯讀。

本輪只完成架構契約、文件及必要介面規劃。不擅自建立真實 repo、配置跨庫權限、部署排程或進行大規模歷史回補。

資料中心正式實作另依 D01 至 D04 任務批准，使用 Skill 的 DR-01～11 驗收。
