"""純 Python 模組化建置腳本：組裝 src/renderer/ 與凍結證據資料，產出 build/dashboard.html 與 data/feed-base.json。"""

import base64
import json
from pathlib import Path
from weekly_evidence import enrich

ROOT = Path(__file__).resolve().parent.parent
RENDERER_DIR = ROOT / 'src' / 'renderer'
DATA_DIR = ROOT / 'data'
BUILD_DIR = ROOT / 'build'

# 依相依順序組裝前端模組
MODULE_ORDER = [
    'core/constants.js',
    'core/format.js',
    'core/signal-engine.js',
    'core/settings.js',
    'core/storage-adapter.js',
    'core/weekly-engine.js',
    'core/peak-model.js',
    'core/data-io.js',
    'components/ui-kit.js',
    'components/charts.js',
    'components/holding-chart.js',
    'core/light-export.js',
    'components/kline-chart.js',
    'components/official-feed-panel.js',
    'components/preset-dialog.js',
    'pages/home.js',
    'pages/briefing.js',
    'pages/channels.js',
    'pages/watchlist.js',
    'pages/paper.js',
    'pages/us-market.js',
    'pages/screen.js',
    'pages/stock.js',
    'pages/backtest.js',
    'pages/peak.js',
    'pages/settings.js',
    'pages/software.js',
    'pages/data.js',
    'app.js',
]


def build(
    shell_version: str | None = None,
    app_version: str | None = None,
    channel: str | None = None,
):
    BUILD_DIR.mkdir(parents=True, exist_ok=True)

    template = (RENDERER_DIR / 'index.template.html').read_text(encoding='utf-8')
    styles = (RENDERER_DIR / 'styles.css').read_text(encoding='utf-8')

    chunks = []
    for rel_path in MODULE_ORDER:
        src = (RENDERER_DIR / rel_path).read_text(encoding='utf-8').strip()
        chunks.append(f'// === {rel_path} ===\n{src}')
    bundled_js = '\n\n'.join(chunks)

    base_data = json.loads((DATA_DIR / 'web_data.json').read_bytes())
    enriched = enrich(base_data, DATA_DIR / 'chip-screener-phase1.zip')
    recovered = json.loads((DATA_DIR / 'verified-tdcc-2026-11-20.json').read_bytes())
    week, trade_day = recovered['week'], recovered['tradeDay']
    day = week['day']
    assert day == trade_day and day not in enriched['series']
    enriched['series'][day] = {**week['extraRows'], **week['rows']}
    enriched['dates'] = sorted([*enriched['dates'], day])
    enriched['sessions'] = sorted(set(enriched['sessions']) | {trade_day})
    enriched['observed'][day] = week['observed']
    enriched['quality'][day] = week['quality']
    enriched['issues'][day] = week['issues']
    enriched['adjustments'][day] = week['adjustments']

    chart_history = DATA_DIR / 'tdcc-chart-history.json'
    if chart_history.exists():
        enriched['tdccChartHistory'] = json.loads(chart_history.read_bytes())


    pkg_file = ROOT / 'package.json'
    shell_ver = shell_version or '0.6.0-b05.1'
    if not shell_version and pkg_file.exists():
        try:
            shell_ver = str(json.loads(pkg_file.read_text(encoding='utf-8')).get('version') or shell_ver)
        except Exception:
            pass
    meta_file = ROOT / 'scripts' / 'release_meta.json'
    app_ver = app_version or shell_ver
    code_channel = channel or 'stable'
    candidate_download = ''
    if meta_file.exists():
        try:
            rmeta = json.loads(meta_file.read_text(encoding='utf-8'))
            if not app_version:
                app_ver = str(rmeta.get('appVersion') or app_ver)
            if not channel:
                code_channel = str(rmeta.get('channel') or code_channel)
            if app_ver == rmeta.get('appVersion'):
                candidate_download = rmeta.get('candidateDownload') or ''
        except Exception:
            pass
    enriched['versionInfo'] = {
        'shellVersion': shell_ver,
        'appVersion': app_ver,
        'channel': code_channel,
        'candidateDownload': candidate_download,
    }

    sp500_file = DATA_DIR / 'sp500_universe.json'
    if sp500_file.exists():
        sp_doc = json.loads(sp500_file.read_text(encoding='utf-8'))
        enriched['usUniverse'] = [
            [x['code'], x['name'], x['sector']]
            for x in (sp_doc.get('items') or [])
            if x.get('code')
        ]

    feed_base = {
        'universe': enriched['universe'],
        'sessions': enriched['sessions'],
        'hashes': {day: q.get('sha256', q['raw_source']) for day, q in enriched['quality'].items()},
    }
    (DATA_DIR / 'feed-base.json').write_text(json.dumps(feed_base), encoding='utf-8')

    data_json = json.dumps(enriched, ensure_ascii=False, separators=(',', ':'))

    assert '__STYLES_CSS__' in template
    assert '__DATA_JSON__' in template
    assert '__APP_JS__' in template

    icon = base64.b64encode((ROOT / 'assets' / 'radar.svg').read_bytes()).decode('ascii')
    html = (
        template
        .replace('__RADAR_ICON__', 'data:image/svg+xml;base64,' + icon)
        .replace('__APP_VERSION__', app_ver)
        .replace('__STYLES_CSS__', styles, 1)
        .replace('__DATA_JSON__', data_json, 1)
        .replace('__APP_JS__', bundled_js, 1)
    )

    out_path = BUILD_DIR / 'dashboard.html'
    out_path.write_bytes(html.encode('utf-8'))
    print(f'Built {out_path} ({out_path.stat().st_size:,} bytes), universe={len(enriched["universe"])}, sessions={len(enriched["sessions"])}')


if __name__ == '__main__':
    build()
