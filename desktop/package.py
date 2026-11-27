"""Build the Windows candidate using the pinned, verified 0.6.2 runtime."""
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parent
BASE = ROOT.parent / 'archives/v0.6.2/ChipScreener-v0.6.2-Windows-x64.zip'
PREFIX = 'ChipScreener-v0.6.2/'


def build():
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    if version != json.loads((ROOT / 'scripts/release_meta.json').read_text(encoding='utf-8'))['appVersion']:
        raise ValueError('封裝與程式版本不符')
    if hashlib.sha256(BASE.read_bytes()).hexdigest() != '9e47199ff58d417f0e88b3a344212b998ef7facf95495b289598a519a3abc492':
        raise ValueError('0.6.2 封存 SHA-256 不符')
    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    with ZipFile(BASE) as src, TemporaryDirectory() as temp:
        files = {}
        for name in src.namelist():
            rel = name.removeprefix(PREFIX)
            if rel.startswith('data/') and not name.endswith('/'):
                target = ROOT / rel
                target.parent.mkdir(exist_ok=True)
                target.write_bytes(src.read(name))
            if rel.startswith('runtime-python/') and not name.endswith('/'):
                files['resources/' + rel] = src.read(name)
        subprocess.run([sys.executable, str(ROOT / 'scripts/build_dashboard.py')], check=True)
        launcher = Path(temp) / 'launcher.exe'
        subprocess.run([os.environ.get('ZIG', 'zig'), 'cc', '-target', 'x86_64-windows-gnu',
                        '-Os', '-s', '-municode', '-Wl,--subsystem,windows',
                        '-lkernel32', '-luser32',
                        'launcher.c', '-o', str(launcher)], cwd=ROOT, check=True)
        launcher_bytes = bytearray(launcher.read_bytes())
        pe_header, = struct.unpack_from('<I', launcher_bytes, 0x3c)
        if launcher_bytes[pe_header:pe_header+4] != b'PE\0\0':
            raise ValueError('啟動器未產出 Windows PE')
        # Zig's PE COFF TimeDateStamp otherwise varies across builds.
        struct.pack_into('<I', launcher_bytes, pe_header + 8, 0)
        files['股票雷達.exe'] = launcher_bytes
        files['股票雷達輕量版.html'] = (ROOT / 'light.html').read_text(encoding='utf-8').replace('__HOLDING_CHART__', (ROOT / 'src/renderer/components/holding-chart.js').read_text(encoding='utf-8')).encode('utf-8')
        for path in [ROOT / 'package.json', *sorted((ROOT / 'scripts').rglob('*.py')),
                     ROOT / 'scripts/release_meta.json', ROOT / 'build/dashboard.html',
                     ROOT / 'data/feed-base.json', ROOT / 'data/web_data.json', ROOT / 'data/sp500_universe.json',
                     ROOT / 'data/tdcc-chart-history.json']:
            files['resources/' + path.relative_to(ROOT).as_posix()] = path.read_bytes()
        output = dist / f'ChipScreener-v{version}-Windows-x64.zip'
        with ZipFile(output, 'w') as archive:
            for name, data in sorted(files.items()):
                info = ZipInfo(name, (2026, 11, 27, 0, 0, 0))
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                archive.writestr(info, data, compress_type=ZIP_DEFLATED, compresslevel=9)
        print(output, output.stat().st_size, hashlib.sha256(output.read_bytes()).hexdigest())


if __name__ == '__main__':
    build()
