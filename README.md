# 台股籌碼雷達

Windows 11 x64 台股研究工具，提供集保週篩、個股研究及策略比較。

| 通道 | 版本 | 下載 | 說明 |
| --- | --- | --- | --- |
| Stable | 尚未發布 | — | — |
| Beta | v0.6.5-rc.4 | [Release 下載](https://github.com/Jimmy0916-LAI/chip-screener/releases/tag/v0.6.5-rc.4) | 手動下載 |

完整解壓 ZIP，保留 `resources`，雙擊 `股票雷達.exe`。換版前在舊版軟體設定停止本機服務，將新版解壓至新資料夾。沿用原 Windows 帳號及瀏覽器設定檔讀取既有資料。

RC4 已通過 Windows Server CI。Windows 11 x64 實機驗收待完成。RC4 仍可手動下載。支援自動更新的候選版本需經過完整驗收後才會配置通道。

<!-- CHIPSCREENER_UPDATE_CHANNELS_BEGIN -->
```json
{
  "schemaVersion": 1,
  "stable": null,
  "beta": {
    "version": "0.6.5-rc.4",
    "legacyManual": true,
    "releaseUrl": "https://github.com/Jimmy0916-LAI/chip-screener/releases/tag/v0.6.5-rc.4"
  }
}
```
<!-- CHIPSCREENER_UPDATE_CHANNELS_END -->

[目前狀態](PROJECT_STATE.md) · [產品規格](PRODUCT_SPEC.md) · [架構](ARCHITECTURE.md) · [驗收](ACCEPTANCE.md) · [版本變更](docs/CHANGELOG.md)
