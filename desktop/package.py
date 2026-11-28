"""Build the portable Windows ZIP and its update manifest from a source commit."""
import argparse
import hashlib
import io
import json
import os
import re
from pathlib import Path
import struct
import subprocess
import sys
from tempfile import TemporaryDirectory
from urllib.request import urlopen
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parent
BASE = ROOT.parent / 'archives/v0.6.2/ChipScreener-v0.6.2-Windows-x64.zip'
PREFIX = 'ChipScreener-v0.6.2/'
RUNTIME_VERSION = '3.13.14'
RUNTIME_NAME = f'python-{RUNTIME_VERSION}-embed-amd64.zip'
RUNTIME_URL = f'https://www.python.org/ftp/python/{RUNTIME_VERSION}/{RUNTIME_NAME}'
RUNTIME_SHA256 = '90b4e5b9898b72d744650524bff92377c367f44bd5fbd09e3148656c080ad907'
TRUSTSTORE_URL = ('https://files.pythonhosted.org/packages/19/97/'
                  '56608b2249fe206a67cd573bc93cd9896e1efb9e98bce9c163bcdc704b88/'
                  'truststore-0.10.4-py3-none-any.whl')
TRUSTSTORE_SHA256 = 'adaeaecf1cbb5f4de3b1959b42d41f6fab57b2b1666adb59e89cb0b53361d981'

RELEASE_REPO = 'Jimmy0916-LAI/chip-screener'
ARCHITECTURE = 'windows-x64'
DATA_COMPATIBILITY = {'readMin': 1, 'readMax': 1, 'write': 1}
VERSION_PATTERN = r'(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?'
META_PATH = ROOT / 'scripts/release_meta.json'


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def version_from_source():
    version = json.loads(META_PATH.read_text(encoding='utf-8'))['appVersion']
    if not re.fullmatch(VERSION_PATTERN, version):
        raise ValueError(f'封裝版號不合法：{version}')
    return version


def load_runtime(runtime_path):
    if runtime_path is None:
        with urlopen(RUNTIME_URL, timeout=60) as response:
            return response.read()
    return runtime_path.read_bytes()


def build(runtime_path=None):
    version = version_from_source()
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('需要有效的 Git 來源提交')
    metadata = {
        'schemaVersion': 1,
        'version': version,
        'commit': commit,
        'architecture': ARCHITECTURE,
        'dataCompatibility': DATA_COMPATIBILITY,
    }
    runtime = load_runtime(runtime_path)
    if hashlib.sha256(runtime).hexdigest() != RUNTIME_SHA256:
        raise ValueError('內嵌 Python SHA-256 不符')
    if hashlib.sha256(BASE.read_bytes()).hexdigest() != '9e47199ff58d417f0e88b3a344212b998ef7facf95495b289598a519a3abc492':
        raise ValueError('0.6.2 封存 SHA-256 不符')
    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    version_tuple = ','.join(version.split('-', 1)[0].split('.')) + ',0'
    zig = os.environ.get('ZIG', 'zig')
    with ZipFile(BASE) as src, TemporaryDirectory() as temp:
        files = {}
        for name in src.namelist():
            rel = name.removeprefix(PREFIX)
            if rel.startswith('data/') and not name.endswith('/'):
                target = ROOT / rel
                target.parent.mkdir(exist_ok=True)
                target.write_bytes(src.read(name))
        with ZipFile(io.BytesIO(runtime)) as embedded:
            for name in embedded.namelist():
                files['resources/runtime-python/' + name] = embedded.read(name)
        with urlopen(TRUSTSTORE_URL, timeout=30) as response:
            truststore = response.read(256 * 1024)
        if hashlib.sha256(truststore).hexdigest() != TRUSTSTORE_SHA256:
            raise ValueError('Windows TLS 信任模組 SHA-256 不符')
        with ZipFile(io.BytesIO(truststore)) as wheel:
            for name in wheel.namelist():
                if name.startswith(('truststore/', 'truststore-0.10.4.dist-info/')) and not name.endswith('/'):
                    files['resources/scripts/' + name] = wheel.read(name)
        # Python's isolated Windows runtime must find the packaged app, independent
        # of the current working directory and its modules.
        files['resources/runtime-python/python313._pth'] = b'python313.zip\r\n.\r\n..\r\n..\\scripts\r\n'
        subprocess.run([sys.executable, str(ROOT / 'scripts/build_dashboard.py')], check=True)
        launcher = Path(temp) / 'launcher.exe'
        resource = Path(temp) / 'launcher.rc'
        (Path(temp) / 'radar.ico').write_bytes((ROOT / 'assets/radar.ico').read_bytes())
        resource.write_text(f'''
1 ICON "radar.ico"
1 VERSIONINFO
FILEVERSION {version_tuple}
PRODUCTVERSION {version_tuple}
BEGIN
  BLOCK "StringFileInfo"
  BEGIN
    BLOCK "040904B0"
    BEGIN
      VALUE "FileVersion", "{version}"
      VALUE "ProductVersion", "{version}"
      VALUE "ProductName", "ChipScreener"
    END
  END
  BLOCK "VarFileInfo"
  BEGIN
    VALUE "Translation", 0x0409, 1200
  END
END
''', encoding='ascii')
        compiled = Path(temp) / 'launcher.res'
        subprocess.run([zig, 'rc', '/fo', compiled.name, resource.name], cwd=temp, check=True)
        subprocess.run([zig, 'cc', '-target', 'x86_64-windows-gnu',
                        '-Os', '-s', '-municode', '-Wl,--subsystem,windows',
                        '-lkernel32', '-luser32',
                        'launcher.c', str(compiled), '-o', str(launcher)], cwd=ROOT, check=True)
        launcher_bytes = bytearray(launcher.read_bytes())
        pe_header, = struct.unpack_from('<I', launcher_bytes, 0x3c)
        if launcher_bytes[pe_header:pe_header+4] != b'PE\0\0':
            raise ValueError('啟動器未產出 Windows PE')
        # Zig's PE COFF TimeDateStamp otherwise varies across builds.
        struct.pack_into('<I', launcher_bytes, pe_header + 8, 0)
        files['股票雷達.exe'] = launcher_bytes
        files['resources/update-package.json'] = json_bytes(metadata)
        files['resources/package.json'] = json_bytes({'name': 'chip-screener', 'version': version, 'private': True})
        for path in [*sorted((ROOT / 'scripts').rglob('*.py')),
                     ROOT / 'scripts/release_meta.json', ROOT / 'build/dashboard.html',
                     ROOT / 'data/feed-base.json', ROOT / 'data/web_data.json', ROOT / 'data/sp500_universe.json',
                     ROOT / 'data/tdcc-chart-history.json', ROOT / 'data/verified-tdcc-2026-11-20.json', ROOT / 'assets/radar.svg']:
            files['resources/' + path.relative_to(ROOT).as_posix()] = path.read_bytes()
        output = dist / f'ChipScreener-v{version}-Windows-x64.zip'
        with ZipFile(output, 'w') as archive:
            for name, data in sorted(files.items()):
                info = ZipInfo(name, (2026, 11, 27, 0, 0, 0))
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                archive.writestr(info, data, compress_type=ZIP_DEFLATED, compresslevel=9)
        size = output.stat().st_size
        sha256 = hashlib.sha256(output.read_bytes()).hexdigest()
        asset = {
            'url': f'https://github.com/{RELEASE_REPO}/releases/download/v{version}/{output.name}',
            'sha256': sha256,
            'size': size,
        }
        manifest = {**metadata, 'assets': {'zip': asset}}
        (dist / 'update-manifest.json').write_bytes(json_bytes(manifest))
        (dist / 'SHA256SUMS.txt').write_text(f'{sha256}  {output.name}\n', encoding='ascii', newline='\n')
        print(output, size, sha256)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--python-runtime', type=Path, help='Use an already downloaded official Windows Python ZIP')
    parser.add_argument('--version', action='store_true', help='Print the authoritative source version')
    args = parser.parse_args()
    if args.version:
        print(version_from_source())
    else:
        build(args.python_runtime)
