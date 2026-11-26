# 上傳封存與開發起點

| 版本（由舊至新） | 原件 | 內容 |
| --- | --- | --- |
| `v0.6.1-archive` | [chip-screener-0.6.1 b07-JL.zip](v0.6.1/chip-screener-0.6.1%20b07-JL.zip) | JL 協作快照，內部 Electron 套件標為 `0.6.0-b05.1` |
| `v0.6.2-archive` | [stocks-screener--0.6.2.zip](v0.6.2/stocks-screener--0.6.2.zip) | 更新包的內部執行環境標為 `0.6.1-t`。原件包含外部更新 manifest |

ZIP SHA-256（同表順序）

- `df101087c7fc5ca5797ba8f4baa7c368747170c485617cafa5462ee237bc4138`
- `378e7589724fcde0d4ff86900f9a2a5f3fe58c6d354e2c0fc5515e67d9695d49`

下一次開發使用 `feat/v0.6.2-runtime-integration`。桌面程式沿用已驗證的 B06.1 及其導航提交 `42c3dcd`，`archives/v0.6.2/runtime/` 提供可比較的新版 Python 原始碼和 HTML。外部更新設定保存在原始 ZIP，桌面程式目前使用原 B06 入口。後續整合須先核對更新來源、資料相容性與 Windows 回歸。

封存標籤供歷史下載及回溯。這兩份包已核對原件雜湊與 ZIP 完整性，Windows 版功能驗收待安排。
