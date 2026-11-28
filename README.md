# 台股籌碼雷達

Windows 11 x64 台股研究工具，提供集保週篩、個股研究及策略比較。

<!-- CHIPSCREENER_UPDATE_CHANNELS_BEGIN -->
| 通道 | 下載 |
| --- | --- |
| Stable | — |
| Beta | [Windows x64 ZIP](https://github.com/Jimmy0916-LAI/chip-screener/releases/download/v0.6.5-rc.4/ChipScreener-v0.6.5-rc.4-Windows-x64.zip) |
<!-- CHIPSCREENER_UPDATE_CHANNELS_END -->

完整解壓 ZIP，保留 `resources`，雙擊 `股票雷達.exe`。換版前在舊版軟體設定停止本機服務，將新版解壓至新資料夾。沿用原 Windows 帳號及瀏覽器設定檔讀取既有資料。

Beta 目前提供 RC4 手動下載。RC4 已通過 Windows Server CI，Windows 11 x64 實機驗收待完成。

[目前狀態](PROJECT_STATE.md) · [產品規格](PRODUCT_SPEC.md) · [架構](ARCHITECTURE.md) · [驗收](ACCEPTANCE.md) · [版本變更](docs/CHANGELOG.md)

主要功能包括集保歷史、同窗策略比較、個股日 K、自選股與 CSV。首次離線可開啟介面及設定。最新市場資料需連線取得。

正式更新的指定版本由上述表格的 ZIP 連結決定。後續切換通道時，只需在審查 PR 內更換該列官方 ZIP 連結。
