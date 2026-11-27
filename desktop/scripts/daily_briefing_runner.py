"""供 Windows 工作排程器每日台灣時間 10:00 靜默執行的獨立晨報產出腳本。"""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = ROOT / 'scripts'
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from providers.ai_trader import AiTraderService  # noqa: E402
from providers.channels import ChannelService  # noqa: E402
from providers.live_quotes import LiveQuoteService  # noqa: E402
from providers.news_briefing import BriefingService  # noqa: E402
from providers.paper_trading import PaperTradingService  # noqa: E402
from providers.tw_market import TwMarketService  # noqa: E402
from providers.us_market import UsMarketService  # noqa: E402
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

    ch_service = ChannelService(app_data_dir, ROOT, stock_names=stock_names)
    ch_state = ch_service.get_state()
    if ch_state['config'].get('autoDailyEnabled', False) and ch_state['channels']:
        ch_res = ch_service.check_updates(force=True)
        print(f"已檢查訂閱財經頻道（檢查 {len(ch_res['checked'])} 個，更新 {ch_res['updatedCount']} 筆策略）")
    else:
        print('訂閱頻道每日自動檢查未啟用或尚無訂閱頻道，略過頻道檢查。')

    live_quote_service = LiveQuoteService(stock_names=stock_names)
    paper_service = PaperTradingService(
        app_data_dir,
        ROOT,
        live_quote_service=live_quote_service,
        stock_names=stock_names,
    )
    if paper_service.has_any_daily_ai_slot():
        try:
            feed_service = None
            feed_base_file = ROOT / 'data' / 'feed-base.json'
            if feed_base_file.exists():
                from serve_local import LocalFeedService
                base = json.loads(feed_base_file.read_text(encoding='utf-8'))
                feed_service = LocalFeedService(app_data_dir / 'tdcc-local-v1', base)
            us_market = UsMarketService(app_data_dir / 'us-cache-v1')
            ai_trader = AiTraderService(
                app_data_dir,
                ROOT,
                paper_service,
                feed_service=feed_service,
                tw_market_service=tw_market,
                us_market_service=us_market,
                briefing_service=service,
                watchlist_service=wl_service,
                channel_service=ch_service,
                live_quote_service=live_quote_service,
                stock_names=stock_names,
                base_series=base_series,
            )
            ai_results = ai_trader.run_scheduled_slots(trigger='每日 10:00 自動排程')
            print(f'已執行模擬操盤每日 AI 排程（共 {len(ai_results)} 個存檔）')
        except Exception as exc:
            print(f'模擬操盤每日 AI 排程執行失敗：{exc}')
    else:
        print('尚無啟用每日排程的 AI 模擬操盤存檔，略過 AI 操盤排程。')


if __name__ == '__main__':
    main()
