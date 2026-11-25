"""供 Windows 工作排程器每日台灣時間 10:00 靜默執行的獨立晨報產出腳本。"""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = ROOT / 'scripts'
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from providers.news_briefing import BriefingService  # noqa: E402
from providers.tw_market import TwMarketService  # noqa: E402
from providers.watchlist import WatchlistService  # noqa: E402


def main() -> None:
    if sys.stdout is None:
        sys.stdout = open(os.devnull, 'w', encoding='utf-8')
    if sys.stderr is None:
        sys.stderr = open(os.devnull, 'w', encoding='utf-8')

    local_app_data = Path(os.environ.get('LOCALAPPDATA') or Path.home())
    app_data_dir = local_app_data / 'ChipScreener'
    web_data = ROOT / 'data' / 'web_data.json'
    stock_names = {}
    base_series = {}
    if web_data.exists():
        try:
            wd = json.loads(web_data.read_text(encoding='utf-8'))
            stock_names = wd.get('stocks', {})
            base_series = wd.get('series', {})
        except Exception:
            pass

    service = BriefingService(app_data_dir, ROOT, stock_names)
    cfg = service.get_config()
    if cfg.get('enabled', True):
        report = service.generate(trigger='每日 10:00 自動排程')
        print(f"已產出 {report['date']} 晨報（新聞 {len(report['news'])} 則，模式：{report['summaryMode']}）")
    else:
        print('自動晨報已由使用者手動關閉，略過晨報執行。')

    tw_market = TwMarketService(app_data_dir / 'tw-detail-v1')
    wl_service = WatchlistService(app_data_dir, ROOT, tw_market, stock_names=stock_names, base_series=base_series)
    wl_state = wl_service.get_state()
    if wl_state['config'].get('autoEnabled', True) and wl_state['config'].get('autoStocks'):
        analyzed = wl_service.run_auto_analysis(trigger='每日 10:00 自動分析')
        print(f"已更新收藏夾自動分析（共 {len(analyzed['config']['autoStocks'])} 檔）")
    else:
        print('收藏夾自動分析已關閉或尚無追蹤股，略過自動分析。')


if __name__ == '__main__':
    main()
