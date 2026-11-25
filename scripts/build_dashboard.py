"""純 Python 模組化建置腳本：組裝 src/renderer/ 與凍結證據資料，產出 build/dashboard.html 與 data/feed-base.json。"""

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
    'core/settings.js',
    'core/storage-adapter.js',
    'core/weekly-engine.js',
    'core/peak-model.js',
    'core/data-io.js',
    'components/ui-kit.js',
    'components/charts.js',
    'components/kline-chart.js',
    'components/official-feed-panel.js',
    'components/preset-dialog.js',
    'pages/home.js',
    'pages/briefing.js',
    'pages/watchlist.js',
    'pages/screen.js',
    'pages/stock.js',
    'pages/backtest.js',
    'pages/peak.js',
    'pages/settings.js',
    'pages/data.js',
    'app.js',
]


def build():
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

    feed_base = {
        'universe': enriched['universe'],
        'sessions': enriched['sessions'],
        'hashes': {day: q['raw_source'] for day, q in enriched['quality'].items()},
    }
    (DATA_DIR / 'feed-base.json').write_text(json.dumps(feed_base), encoding='utf-8')

    data_json = json.dumps(enriched, ensure_ascii=False, separators=(',', ':'))

    assert '__STYLES_CSS__' in template
    assert '__DATA_JSON__' in template
    assert '__APP_JS__' in template

    html = (
        template
        .replace('__STYLES_CSS__', styles, 1)
        .replace('__DATA_JSON__', data_json, 1)
        .replace('__APP_JS__', bundled_js, 1)
    )

    out_path = BUILD_DIR / 'dashboard.html'
    out_path.write_bytes(html.encode('utf-8'))
    print(f'Built {out_path} ({out_path.stat().st_size:,} bytes), universe={len(enriched["universe"])}, sessions={len(enriched["sessions"])}')


if __name__ == '__main__':
    build()
