"""行動版前端與純 JS 引擎建置腳本：產出 mobile/www/ 供 Capacitor Android 封裝。
將大型 JSON、行動版執行期、前端 SPA 拆分為獨立靜態檔，搭配嚴格 CSP（script-src 'self'，零 inline script）。
"""

import json
import sys
from pathlib import Path

MOBILE_DIR = Path(__file__).resolve().parent.parent
ROOT = MOBILE_DIR.parent
RENDERER_DIR = ROOT / 'src' / 'renderer'
DATA_DIR = ROOT / 'data'
SCRIPTS_DIR = ROOT / 'scripts'
WWW_DIR = MOBILE_DIR / 'www'

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from build_dashboard import MODULE_ORDER  # noqa: E402
from weekly_evidence import enrich  # noqa: E402

MOBILE_RUNTIME_ORDER = [
    'platform/core.js',
    'platform/http.js',
    'platform/storage.js',
    'platform/local-store.js',
    'platform/capacitor-bridge.js',
    'services/feed.js',
    'services/tw-market.js',
    'services/news-briefing.js',
    'services/us-market.js',
    'services/watchlist.js',
    'platform/api-router.js',
    'platform/mobile-ui.js',
    'platform/boot.js',
]

MOBILE_CSP = '; '.join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
])


def build_mobile_web() -> None:
    WWW_DIR.mkdir(parents=True, exist_ok=True)

    # 1. 靜態樣式（桌面原樣式 + 行動版安全區與觸控優化）
    (WWW_DIR / 'styles.css').write_text(
        (RENDERER_DIR / 'styles.css').read_text(encoding='utf-8'),
        encoding='utf-8',
    )
    (WWW_DIR / 'mobile-ui.css').write_text(
        (MOBILE_DIR / 'src' / 'platform' / 'mobile-ui.css').read_text(encoding='utf-8'),
        encoding='utf-8',
    )

    # 2. 凍結基準資料（拆分獨立檔案，避免阻塞 HTML 解析）
    base_data = json.loads((DATA_DIR / 'web_data.json').read_bytes())
    enriched = enrich(base_data, DATA_DIR / 'chip-screener-phase1.zip')

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
        'hashes': {day: q['raw_source'] for day, q in enriched['quality'].items()},
    }
    enriched['feedBase'] = feed_base

    data_json = json.dumps(enriched, ensure_ascii=False, separators=(',', ':'))
    (WWW_DIR / 'initial-data.js').write_text(
        f'const INITIAL_DATA = {data_json};\n',
        encoding='utf-8',
    )

    # 3. 行動版平台層 + 移植後端服務
    runtime_chunks = []
    for rel in MOBILE_RUNTIME_ORDER:
        p = MOBILE_DIR / 'src' / rel
        if not p.exists():
            raise FileNotFoundError(f'缺少行動版模組：{p}')
        runtime_chunks.append(f'// === mobile/{rel} ===\n' + p.read_text(encoding='utf-8').strip())
    (WWW_DIR / 'mobile-runtime.js').write_text('\n\n'.join(runtime_chunks) + '\n', encoding='utf-8')

    # 4. 原前端 SPA（由 boot.js 於行動版初始化完成後動態載入）
    renderer_chunks = []
    for rel in MODULE_ORDER:
        src = (RENDERER_DIR / rel).read_text(encoding='utf-8').strip()
        renderer_chunks.append(f'// === {rel} ===\n{src}')
    (WWW_DIR / 'renderer.js').write_text('\n\n'.join(renderer_chunks) + '\n', encoding='utf-8')

    # 5. 行動版 index.html（嚴格 CSP、viewport-fit=cover、零 inline script）
    index_html = f"""<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#0b0e14">
  <meta http-equiv="Content-Security-Policy" content="{MOBILE_CSP}">
  <title>籌碼雷達｜行動版</title>
  <link rel="stylesheet" href="styles.css">
  <link rel="stylesheet" href="mobile-ui.css">
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand brand-switch" id="brandMarketToggle" data-toggle-market="1" data-market="TW" role="button" tabindex="0" title="點擊切換 台股 TW ⇄ 美股 US" aria-label="籌碼雷達，點擊切換台股或美股">
        <span class="brand-mark" aria-hidden="true">⌁</span>
        <div class="brand-body">
          <div class="brand-title-row">
            <b>籌碼雷達</b>
            <span class="brand-market-badge" id="brandMarketBadge">TW</span>
          </div>
          <small id="brandMarketHint">點擊切換 美股 US ⇄</small>
        </div>
      </div>

      <nav class="nav" id="nav" aria-label="主要導覽"></nav>

      <div class="side-bottom">
        <div class="status-dot-row">
          <span class="light"></span>
          <span>離線基線已載入</span>
        </div>
        <div class="muted">Android 安全離線版</div>
        <div class="muted">研究分析工具 · 非投資建議</div>
      </div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div class="crumb">
          <button type="button" class="mobile-market-btn" data-toggle-market="1" id="mobileMarketToggle" title="點擊切換 台股 TW ⇄ 美股 US">TW</button>
          <span class="muted">籌碼雷達</span>
          <span class="crumb-sep">/</span>
          <b id="crumb">載入中</b>
        </div>
        <div class="tools" id="topbarTools">
          <span class="tag" id="topDateTag">集保基準</span>
          <span class="tag good" id="topStatusTag">本機離線可用</span>
        </div>
      </header>

      <div class="content" id="page">
        <div class="card"><div class="empty"><b>正在初始化籌碼雷達...</b>載入本機快取與研究資料</div></div>
      </div>
    </main>
  </div>

  <div class="stock-suggest-menu" id="stockSuggestMenu" role="listbox" hidden></div>
  <div class="mobilebar" id="mobilebar"></div>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>

  <script src="initial-data.js"></script>
  <script src="mobile-runtime.js"></script>
</body>
</html>
"""
    (WWW_DIR / 'index.html').write_text(index_html, encoding='utf-8')

    total = sum(p.stat().st_size for p in WWW_DIR.iterdir() if p.is_file())
    print(f'Built mobile/www ({total:,} bytes across {len(list(WWW_DIR.iterdir()))} files)')


if __name__ == '__main__':
    build_mobile_web()
