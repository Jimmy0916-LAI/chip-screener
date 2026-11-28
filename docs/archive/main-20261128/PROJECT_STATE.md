# 台股籌碼雷達專案狀態

## v0.6.5-rc.4｜恢復台股全市場篩選

[PR #15](https://github.com/Jimmy0916-LAI/chip-screener/pull/15) · [程式 Tag](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.5-rc.4) · [Release](https://github.com/Jimmy0916-LAI/chip-screener/releases/tag/v0.6.5-rc.4) · [Windows x64 ZIP](https://github.com/Jimmy0916-LAI/chip-screener/releases/download/v0.6.5-rc.4/ChipScreener-v0.6.5-rc.4-Windows-x64.zip)。完整程式提交 `fe0a5fd4530ca83906f5ba2f28aef0f590cfe109`，ZIP SHA-256 `384a30beeb4b2fe5b99cd9f453fe3bcfb11f3d41c78623713d967e60fd8e81c3`。

RC3 使用者驗收失敗。從 [RC3 Release](https://github.com/Jimmy0916-LAI/chip-screener/releases/tag/v0.6.5-rc.3) 下載同一份 ZIP 重現。v0.6.3 開始在前端啟動時把嚴格篩選的凍結資料清空，RC3 的圖表專用三期沒進嚴格判定。首次離線零期，連線後一個統計週仍無法形成連續窗口，1,985 檔全部不足。美股模式的側欄也少了台股篩選入口。

RC4 掛載既有具證據的凍結週與原母體、同時使用已取得之官方快取。11/20 依 B05 原始檔雜湊、交易日驗證與 2026-11-22T21:07:44.082+08:00 的取得紀錄回補。圖表資料仍需具備嚴格時點證據才能參與篩選。11/27 官方資料接入後重算。缺週時退到最近可評估窗口並顯示缺口。

| 1,985 檔全母體 | 統計截止週 | 符合 | 不符合 | 資料不足 |
| --- | --- | ---: | ---: | ---: |
| RC3 乾淨離線 | — | 0 | 0 | 1,985 |
| RC3 真實更新 | — | 0 | 0 | 1,985 |
| RC4 首次離線 | 2026-11-20 | 301 | 1,662 | 22 |
| B04.2 固定案 | 2026-11-13 | 268 | 1,692 | 25 |
| RC4 官方更新 | 2026-11-27 | 365 | 1,597 | 23 |
| RC4 斷網重開 | 2026-11-27 | 365 | 1,597 | 23 |
| 從 RC3 升級（沿用較高門檻） | 2026-11-27 | 265 | 1,697 | 23 |

完整 CSV 代號無重複、逐股判定與畫面一致。11/13 的母體、時點、設定、分類、理由、股數及增幅與 B04.2 實際 CSV 一致。[成品 CSV、畫面與資料盤點](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/46067740266/artifacts/15231513204)。台積電 2330 的 11/13 固定案例，400 張以上兩週 −37,973,336、−10,706,718 股，累計 −0.187719263 pp。以台積電驗 A/B 同窗、本機保存和日 K 覆蓋。

資料盤點（台北時間）

- 集保 2026-11-27，1,985 檔通過輸入驗證，取得 2026-11-28 05:06:46。用於全市場、個股和同窗 A/B。
- 上市名單 1092 檔，2026-11-26，取得 2026-11-28 05:06:38。上櫃名單 899 檔，2026-11-27，取得 2026-11-28 05:06:38。更新名稱與市場顯示，篩選維持 B04.2 可追溯的固定母體。
- 上市一日價量 1091 檔，2026-11-26，取得 2026-11-28 05:06:38。上櫃一日價量 862 檔，2026-11-27，取得 2026-11-28 05:06:38。全市場歷史日 K 未建齊，乾淨輪的個股日 K 快取 0 檔，價格條件獨立顯示覆蓋與不足。

Windows Server 2022 的換版、重開、同週重抓、暫無最新資料、更新失敗及 Release 重新下載／解壓／啟動回歸通過。[Windows 逐案](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/46067740266/job/140737610453) · [Release 回讀](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/46067740266/job/140738900266)。Windows 11 x64 實機待驗。正式版及 v0.7 維持暫停。恢復以 `git fetch origin --tags`、`git switch --detach v0.6.5-rc.4` 核對成品，再從側欄「台股全市場篩選」清搜尋、選「全部結果」後匯出。

## v0.6.5-rc.3｜集保歷史與 Windows 交付

候選 `6e3657b27c843fcc4a25095781913309e4bc2fcc` · [PR #15](https://github.com/Jimmy0916-LAI/chip-screener/pull/15) · [Release](https://github.com/Jimmy0916-LAI/chip-screener/releases/tag/v0.6.5-rc.3) · [下載 Windows x64](https://github.com/Jimmy0916-LAI/chip-screener/releases/download/v0.6.5-rc.3/ChipScreener-v0.6.5-rc.3-Windows-x64.zip)。ZIP SHA-256 `8c1ea508dead1d7dae411bd9f32fd1fea582f07ff337f8a1ba172385534ae57b`。

RC1 產品 Tag `f72af65a8c87ab43c9923c4d948c17830a716ad6`。新分支從 PR #14 上 `3636020df6e76dec80bc568eb59a689f3cbcae4d` 接續，產品檔案相同。查核時該分支與 main 比較為 43 個產品側提交、7 個 main 側提交，產品整合留於堆疊 PR。首頁由 [PR #16](https://github.com/Jimmy0916-LAI/chip-screener/pull/16) 獨立整合。

個股圖表補入三個連續統計週（2026-10-30、11-06、11-13），另沿用官方新週與持久快取。三期原始 CSV 與封存 SHA-256 對帳，公布時點待證仍不進嚴格訊號。[成品驗收、截圖與 Release 回讀](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/46054836274)。本機命令為 `python -X utf8 desktop/qa/feed_test.py`、`node --test desktop/qa/signal-engine.test.cjs`、`python desktop/qa/ai_router_test.py`，Windows CI 使用 `desktop/qa/browser.py --history-fix`。

Windows 11 x64 實機待驗。下次恢復執行 `git fetch origin --tags`、`git switch --detach v0.6.5-rc.3`，從 Release 下載 ZIP 並比對 SHA-256，再測實機啟動及換版。

## 歷史封測 v0.6.5-rc.1

候選 SHA `f72af65a8c87ab43c9923c4d948c17830a716ad6` · [v0.6.5-rc.1](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.5-rc.1) · [PR #14 下載與校驗](https://github.com/Jimmy0916-LAI/chip-screener/pull/14#v065-rc1-download)。含多條件篩選、策略與 CSV，並接上 Gemini、DeepSeek、Claude、OpenAI 及三個可切換的 AI 模組。

[Windows x64 Artifact](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/46037810623/artifacts/15219321239) 於 2026-12-28 00:57:36 台北時間到期。內層 `ChipScreener-v0.6.5-rc.1-Windows-x64.zip` 的 SHA-256 為 `a146c9ae68e7f5589f9c4bde4dac48b80bc937c614c82c95b7d8105b723841c3`。

[Windows Server 2022 CI](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/46037810623) 通過，使用同一份 ZIP 驗收雙入口、策略及自選換版、真實集保與失敗保留、漢唐固定算術、A/B 同窗、篩選與 AI 設定。四家 AI 模擬與 Windows DPAPI 檢查通過。Windows 11 實機、四家付費 API 實際呼叫、獨立複驗待驗。復核時執行 `git fetch origin --tags` 與 `git show -s v0.6.5-rc.1`。

## 上一封測 v0.6.3-rc.1

- 候選提交 `7d0f59a0b7acd540ab23099438eedd4bea0418c6`，遠端 [Tag v0.6.3-rc.1](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.3-rc.1)。集保首更顯示、失敗保留、日 K 疊圖、雙入口與手動換版。
- [Windows x64 Artifact](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45992810449/artifacts/15193938549) 於 2026-12-27 19:44:40 台北時間到期。內層 `ChipScreener-v0.6.3-rc.1-Windows-x64.zip` 的 SHA-256 為 `77f213eb1b4784b343931440be90c0a41a2b0726a92dc58da43f1ad3de9de6d0`。
- [Windows Server 2022 CI 45992810449](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45992810449) 通過。使用者已確認獨立複驗。Windows 11 x64 實機待補驗。正式合併、正式 Tag 與 Release 待批准。

[PR #13 原始與候選驗收紀錄](https://github.com/Jimmy0916-LAI/chip-screener/pull/13) · [產品分支歷史 PROJECT_STATE](https://github.com/Jimmy0916-LAI/chip-screener/blob/95758ddaffb028147c5173cd4f380d48b81fd6cb/PROJECT_STATE.md) · [版本索引](docs/VERSION_INDEX.md)

恢復時執行 `git fetch origin --tags` 與 `git show -s v0.6.3-rc.1`，核對候選提交與同一 ZIP。
