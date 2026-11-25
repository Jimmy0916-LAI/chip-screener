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


def main() -> None:
    if sys.stdout is None:
        sys.stdout = open(os.devnull, 'w', encoding='utf-8')
    if sys.stderr is None:
        sys.stderr = open(os.devnull, 'w', encoding='utf-8')

    local_app_data = Path(os.environ.get('LOCALAPPDATA') or Path.home())
    web_data = ROOT / 'data' / 'web_data.json'
    stock_names = {}
    if web_data.exists():
        try:
            stock_names = json.loads(web_data.read_text(encoding='utf-8')).get('stocks', {})
        except Exception:
            pass

    service = BriefingService(local_app_data / 'ChipScreener', ROOT, stock_names)
    cfg = service.get_config()
    if not cfg.get('enabled', True):
        print('自動晨報已由使用者手動關閉，略過排程執行。')
        return

    report = service.generate(trigger='每日 10:00 自動排程')
    print(f"已產出 {report['date']} 晨報（新聞 {len(report['news'])} 則，模式：{report['summaryMode']}）")


if __name__ == '__main__':
    main()
