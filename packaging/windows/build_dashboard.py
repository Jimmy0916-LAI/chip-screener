"""Build the desktop dashboard from the frozen browser sources and small desktop hooks."""
from pathlib import Path
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
html = html.replace('__APP_JS__',js).replace('__DATA_JSON__',(source / 'web_data.json').read_text(encoding='utf-8'))
(root / 'dashboard.html').write_bytes(html.encode('utf-8'))
