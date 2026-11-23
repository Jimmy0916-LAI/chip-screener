"""Build the desktop dashboard from the frozen browser sources and small desktop hooks."""
from pathlib import Path
import json
from weekly_evidence import enrich
import subprocess
import tempfile

root = Path(__file__).resolve().parent
source = root.parents[1] / 'baseline/v0.5/source'
with tempfile.TemporaryDirectory() as temp:
    app = Path(temp) / 'app.js'
    app.write_bytes((source / 'app.js').read_bytes())
    patch = Path(temp) / 'desktop.patch'
    patch.write_bytes((root / 'desktop.patch').read_text(encoding='utf-8').encode('utf-8'))
    subprocess.run(['git', '-c', 'core.autocrlf=false', 'apply', '--no-index', '--whitespace=nowarn',
                    str(patch)], cwd=temp, check=True)
    js = app.read_text(encoding='utf-8')
adapter = (root / 'desktop-state.js').read_text(encoding='utf-8')
assert js.count('/* DESKTOP_STORAGE */') == 1
js = js.replace('/* DESKTOP_STORAGE */', adapter)
html = (source / 'app.template.html').read_text(encoding='utf-8')
for marker, filename in [('/* WEEKLY_ENGINE */','weekly.js'),('/* WEEKLY_VIEWS */','weekly-views.js'),('/* OFFICIAL_FEED */','official-view.js'),('/* WATCHLIST */','watchlist.js')]:
    assert js.count(marker) == 1
    js = js.replace(marker,(root / filename).read_text(encoding='utf-8'))
data = enrich(json.loads((source / 'web_data.json').read_bytes()), root.parents[1] / 'chip-screener-phase1.zip')
(root / 'feed-base.json').write_text(json.dumps({'universe':data['universe'],'sessions':data['sessions'],
    'hashes':{day:q['raw_source'] for day,q in data['quality'].items()}}),encoding='utf8')
html = html.replace('</style>',(root/'desktop.css').read_text(encoding='utf8')+'</style>',1)
html = html.replace('__APP_JS__',js).replace('__DATA_JSON__',json.dumps(data,ensure_ascii=False,separators=(',',':')))
(root / 'dashboard.html').write_bytes(html.encode('utf-8'))
