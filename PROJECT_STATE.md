# 台股籌碼雷達專案狀態

## v0.6.5 首頁交付

下載、解壓、啟動置於首頁頂部。保留歷史及驗收資料於原索引。程式修正見 [PR #15](https://github.com/Jimmy0916-LAI/chip-screener/pull/15)，以 PR #14 的現行產品分支為基線。比較時 main 與該基線各有獨立文件及產品提交，首頁先透過獨立文件 PR 整理。

## 最新封測 v0.6.5-rc.1

候選 SHA `f72af65a8c87ab43c9923c4d948c17830a716ad6` · [v0.6.5-rc.1](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.5-rc.1) · [PR #14 下載與校驗](https://github.com/Jimmy0916-LAI/chip-screener/pull/14#v065-rc1-download)。含多條件篩選、策略與 CSV，並接上 Gemini、DeepSeek、Claude、OpenAI 及三個可切換的 AI 模組。

[Windows x64 Artifact](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/46037810623/artifacts/15219321239) 於 2026-12-28 00:57:36 台北時間到期。內層 `ChipScreener-v0.6.5-rc.1-Windows-x64.zip` 的 SHA-256 為 `a146c9ae68e7f5589f9c4bde4dac48b80bc937c614c82c95b7d8105b723841c3`。

[Windows Server 2022 CI](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/46037810623) 通過，使用同一份 ZIP 驗收雙入口、策略及自選換版、真實集保與失敗保留、漢唐固定算術、A/B 同窗、篩選與 AI 設定。四家 AI 模擬與 Windows DPAPI 檢查通過。Windows 11 實機、四家付費 API 實際呼叫、獨立複驗待驗。復核時執行 `git fetch origin --tags` 與 `git show -s v0.6.5-rc.1`。

## 上一封測 v0.6.3-rc.1

- 候選提交 `7d0f59a0b7acd540ab23099438eedd4bea0418c6`，遠端 [Tag v0.6.3-rc.1](https://github.com/Jimmy0916-LAI/chip-screener/tree/v0.6.3-rc.1)。集保首更顯示、失敗保留、日 K 疊圖、雙入口與手動換版。
- [Windows x64 Artifact](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45992810449/artifacts/15193938549) 於 2026-12-27 19:44:40 台北時間到期。內層 `ChipScreener-v0.6.3-rc.1-Windows-x64.zip` 的 SHA-256 為 `77f213eb1b4784b343931440be90c0a41a2b0726a92dc58da43f1ad3de9de6d0`。
- [Windows Server 2022 CI 45992810449](https://github.com/Jimmy0916-LAI/chip-screener/actions/runs/45992810449) 通過。使用者已確認獨立複驗。Windows 11 x64 實機待補驗。正式合併、正式 Tag 與 Release 待批准。

[PR #13 原始與候選驗收紀錄](https://github.com/Jimmy0916-LAI/chip-screener/pull/13) · [產品分支歷史 PROJECT_STATE](https://github.com/Jimmy0916-LAI/chip-screener/blob/95758ddaffb028147c5173cd4f380d48b81fd6cb/PROJECT_STATE.md) · [版本索引](docs/VERSION_INDEX.md)

恢復時執行 `git fetch origin --tags` 與 `git show -s v0.6.3-rc.1`，核對候選提交與同一 ZIP。
