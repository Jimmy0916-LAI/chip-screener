"""Offline v0.5 acceptance. All generated files stay in a temporary directory."""
from hashlib import sha256
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
from zipfile import ZipFile

BASE = Path(__file__).resolve().parent
ARCHIVE = BASE.parents[1] / 'chip-screener-phase1.zip'
ZIP_HASH = '9fb3a26dff260f575b6e9d8a016a79aec67472311ba8ad7db8a1b9b026534bab'
HTML_HASH = '4cae8ad967e027414bfd99ae8c0af6294081d9a60e2451ff46600844e05230d7'


def verify():
    if sha256(ARCHIVE.read_bytes()).hexdigest() != ZIP_HASH:
        raise ValueError('Frozen research archive differs from the accepted input')
    print('Research ZIP SHA-256:', ZIP_HASH, flush=True)
    reference = (BASE / 'dashboard.html').read_bytes()
    if sha256(reference).hexdigest() != HTML_HASH:
        raise ValueError('Reference dashboard differs from the original OneClick HTML')

    with TemporaryDirectory() as directory:
        stage = Path(directory)
        with ZipFile(ARCHIVE) as archive:
            archive.extractall(stage)
        shutil.copytree(BASE / 'source', stage, dirs_exist_ok=True)
        # Require regeneration from the frozen evidence, even if a script exits early.
        (stage / 'web_data.json').unlink()
        subprocess.run([sys.executable, '-X', 'utf8', 'make_web_data.py'], cwd=stage, check=True)
        if (stage / 'web_data.json').read_bytes() != (BASE / 'source/web_data.json').read_bytes():
            raise ValueError('Regenerated market data differs from the frozen JSON')
        subprocess.run(['node', 'test_webapp.js'], cwd=stage, check=True)
        subprocess.run([sys.executable, '-X', 'utf8', 'build_webapp.py'], cwd=stage, check=True)
        if (stage / '開啟籌碼雷達.html').read_bytes() != reference:
            raise ValueError('Rebuilt HTML is not byte-identical to the OneClick dashboard')
    print(f'Byte-identical HTML: {len(reference):,} bytes, SHA-256: {HTML_HASH}')


if __name__ == '__main__':
    verify()
