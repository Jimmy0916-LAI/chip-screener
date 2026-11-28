"""Official full-ZIP updates and per-user application activation."""

import base64
from contextlib import contextmanager
import hashlib
from datetime import datetime, timezone
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlsplit
from urllib.request import (
    HTTPRedirectHandler, ProxyHandler, Request, build_opener,
)
from zipfile import ZipFile
from providers.verified_https import VerifiedHTTPS

REPO = 'Jimmy0916-LAI/chip-screener'
API = f'https://api.github.com/repos/{REPO}'
RELEASES = f'https://github.com/{REPO}/releases'
README_REF = 'main'
BEGIN = '<!-- CHIPSCREENER_UPDATE_CHANNELS_BEGIN -->'
END = '<!-- CHIPSCREENER_UPDATE_CHANNELS_END -->'
VERSION = re.compile(r'(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?')
COMMIT = re.compile(r'[a-f0-9]{40}')
SHA256 = re.compile(r'[a-f0-9]{64}')
ARCH = 'windows-x64'
MAX_ZIP = 128 * 1024**2
MAX_UNPACKED = 256 * 1024**2
MAX_DOCUMENT = 2 * 1024**2
DATA_SCHEMA = 1
EXE = '股票雷達.exe'
METADATA = 'resources/update-package.json'
REQUIRED = (
    EXE, METADATA, 'resources/package.json', 'resources/scripts/release_meta.json',
    'resources/build/dashboard.html', 'resources/data/feed-base.json',
    'resources/scripts/launcher.py', 'resources/scripts/serve_local.py',
    'resources/scripts/providers/full_update.py',
    'resources/runtime-python/pythonw.exe',
)
IDENTITY_KEYS = ('schemaVersion', 'version', 'commit', 'architecture', 'dataCompatibility')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def decode_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, '更新 JSON 有重複欄位')
            result[key] = value
        return result

    result = json.loads(raw, object_pairs_hook=pairs)
    require(isinstance(result, dict), '更新 JSON 格式錯誤')
    return result


def valid_text(value, pattern):
    return isinstance(value, str) and len(value) <= 128 and pattern.fullmatch(value) is not None


def version_order(version):
    core, _, pre = version.partition('-')
    parts = tuple((0, int(x)) if x.isdigit() else (1, x) for x in pre.split('.'))
    return tuple(map(int, core.split('.'))), not pre, parts


def asset_url(version, name):
    return f'{RELEASES}/download/v{version}/{name}'


def readme_channels(text):
    require(text.count(BEGIN) == text.count(END) == 1, '官方 README 必須有唯一更新區塊')
    before, _, tail = text.partition(BEGIN)
    body, sep, after = tail.partition(END)
    require(sep and before.endswith('\n') and (not after or after.startswith('\n')),
            '官方 README 更新區塊格式錯誤')
    lines = body.strip().splitlines()
    require(len(lines) == 4 and lines[:2] == ['| 通道 | 下載 |', '| --- | --- |'],
            '官方 README 更新區塊格式錯誤')
    channels = {}
    for label, line in zip(('Stable', 'Beta'), lines[2:]):
        prefix = f'| {label} | '
        require(line.startswith(prefix) and line.endswith(' |'), f'{label} 更新列不符契約')
        value = line[len(prefix):-2]
        if value == '—':
            channels[label.lower()] = None
            continue
        match = re.fullmatch(r'\[Windows x64 ZIP\]\(([^()\s]+)\)', value)
        require(match is not None, f'{label} 必須只指定一個官方 ZIP 連結')
        url = match[1]
        release_prefix = f'{RELEASES}/download/v'
        version = url.removeprefix(release_prefix).partition('/')[0]
        require(valid_text(version, VERSION) and url == asset_url(version, f'ChipScreener-v{version}-Windows-x64.zip'),
                f'{label} ZIP 不是指定版本的官方資產')
        require(label != 'Stable' or '-' not in version, 'Stable 必須指定正式版')
        channels[label.lower()] = {'version': version, 'zipUrl': url}
    return channels


def identity(doc):
    info = {key: doc.get(key) for key in IDENTITY_KEYS}
    compat = info['dataCompatibility']
    require(type(info['schemaVersion']) is int and info['schemaVersion'] == 1 and info['architecture'] == ARCH
            and valid_text(info['version'], VERSION) and valid_text(info['commit'], COMMIT), 'Windows x64 更新包身分不符')
    require(isinstance(compat, dict) and set(compat) == {'readMin', 'readMax', 'write'}
            and all(type(value) is int and value > 0 for value in compat.values())
            and compat['readMin'] <= compat['write'] <= compat['readMax'], '資料相容契約無效')
    return info


def manifest_info(raw, entry):
    require(hashlib.sha256(raw).hexdigest() == entry['manifestSha256'], 'manifest SHA-256 不符')
    doc = decode_json(raw)
    info = identity(doc)
    require(info['version'] == entry['version'] and info['commit'] == entry['commit'], 'manifest 與 README 的提交或版本不符')
    assets = doc.get('assets')
    archive = assets.get('zip') if isinstance(assets, dict) else None
    name = f"ChipScreener-v{info['version']}-Windows-x64.zip"
    require(isinstance(archive, dict) and archive.get('url') == entry['zipUrl'] == asset_url(info['version'], name)
            and valid_text(archive.get('sha256'), SHA256) and type(archive.get('size')) is int
            and 0 < archive['size'] <= MAX_ZIP, 'manifest ZIP URL、SHA-256 或檔案大小無效')
    return info, archive


class ReleaseRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urlsplit(newurl)
        require(target.scheme == 'https' and target.netloc in {
            'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com',
        }, '更新下載被轉向非官方網域')
        require(target.netloc != 'github.com' or target.path.startswith(f'/{REPO}/releases/download/'),
                '更新下載被轉向其他儲存庫')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('官方 GitHub API 回傳未預期的轉址')


class Source:
    def __init__(self):
        self.api_opener = build_opener(VerifiedHTTPS(), NoRedirect())
        self.asset_opener = build_opener(VerifiedHTTPS(), ReleaseRedirect())

    def api(self, path):
        with self.api_opener.open(Request(API + path, headers={
            'Accept': 'application/vnd.github+json', 'User-Agent': 'ChipScreener-Updater',
        }), timeout=15) as response:
            data = response.read(MAX_DOCUMENT + 1)
        require(len(data) <= MAX_DOCUMENT, 'GitHub API 回傳過大')
        return decode_json(data)

    def open_asset(self, url):
        require(url.startswith(f'{RELEASES}/download/'), '更新資產非官方來源')
        return self.asset_opener.open(Request(url, headers={
            'User-Agent': 'ChipScreener-Updater', 'Accept-Encoding': 'identity',
        }), timeout=15)

    def readme(self):
        doc = self.api('/contents/README.md?ref=' + README_REF)
        require(doc.get('encoding') == 'base64' and isinstance(doc.get('content'), str), '官方 README 內容格式錯誤')
        return base64.b64decode(''.join(doc['content'].split()), validate=True).decode('utf-8')

    def selected(self, entry, channel):
        version = entry['version']
        release = self.api(f'/releases/tags/v{version}')
        require(release.get('tag_name') == f'v{version}' and release.get('draft') is False
                and release.get('prerelease') is ('-' in version), '官方 Release 與通道指定版本不符')
        require(channel != 'stable' or release.get('prerelease') is False, 'Stable 不接受預發行包')
        ref = self.api(f'/git/ref/tags/v{version}').get('object', {})
        for _ in range(4):
            if ref.get('type') != 'tag':
                break
            require(valid_text(ref.get('sha'), COMMIT), '官方 Tag SHA 無效')
            ref = self.api('/git/tags/' + ref['sha']).get('object', {})
        require(ref.get('type') == 'commit' and valid_text(ref.get('sha'), COMMIT), '官方 Tag 缺少有效的原始碼提交')
        assets = release.get('assets')
        require(isinstance(assets, list), '官方 Release 缺少資產')

        def release_asset(url):
            matches = [item for item in assets if item.get('browser_download_url') == url]
            require(len(matches) == 1 and matches[0].get('state') == 'uploaded', '官方 Release 缺指定資產')
            item = matches[0]
            digest = str(item.get('digest') or '')
            require(digest.startswith('sha256:') and valid_text(digest[7:], SHA256), '官方資產缺少 SHA-256 證據')
            require(type(item.get('size')) is int and item['size'] > 0, '官方資產缺少有效大小')
            return digest[7:], item['size']

        manifest_url = asset_url(version, 'update-manifest.json')
        manifest_hash, manifest_size = release_asset(manifest_url)
        require(manifest_size <= MAX_DOCUMENT, 'manifest 檔案過大')
        with self.open_asset(manifest_url) as response:
            raw = response.read(manifest_size + 1)
        require(len(raw) == manifest_size, 'manifest 與官方資產大小不符')
        info, archive = manifest_info(raw, {**entry, 'commit': ref['sha'], 'manifestSha256': manifest_hash})
        require(release_asset(archive['url']) == (archive['sha256'], archive['size']),
                '官方 ZIP 資產雜湊或大小與 manifest 不符')
        sums_url = asset_url(version, 'SHA256SUMS.txt')
        sums_hash, sums_size = release_asset(sums_url)
        require(sums_size <= 4096, 'SHA256SUMS.txt 過大')
        with self.open_asset(sums_url) as response:
            sums = response.read(sums_size + 1)
        require(len(sums) == sums_size and hashlib.sha256(sums).hexdigest() == sums_hash,
                'SHA256SUMS.txt 與官方資產不符')
        zip_name = archive['url'].rsplit('/', 1)[1]
        expected_sum = f"{archive['sha256']}  {zip_name}".encode('ascii')
        require(sums.strip() == expected_sum, 'SHA256SUMS.txt 與 manifest 不符')
        notes = [line.strip() for line in str(release.get('body') or '').splitlines() if line.strip()][:4]
        return info, archive, notes


def pe_x64(path):
    with path.open('rb') as executable:
        require(executable.read(2) == b'MZ', '更新包含無效 PE 執行檔')
        executable.seek(60)
        raw = executable.read(4)
        require(len(raw) == 4, '更新包含不完整 PE 執行檔')
        executable.seek(struct.unpack('<I', raw)[0])
        require(executable.read(6) == b'PE\0\0\x64\x86', '更新包的執行檔非 Windows x64')


def validate_package(root, expected=None):
    require(all((root / name).is_file() for name in REQUIRED), '完整 ZIP 缺少 Windows 程式資源')
    with (root / METADATA).open('rb') as stream:
        meta = stream.read(MAX_DOCUMENT + 1)
    require(len(meta) <= MAX_DOCUMENT, '更新包識別檔過大')
    info = identity(decode_json(meta))
    require(expected is None or info == expected, '包內識別資料與 manifest 不符')
    require(decode_json((root / 'resources/package.json').read_bytes()).get('version') == info['version']
            and decode_json((root / 'resources/scripts/release_meta.json').read_bytes()).get('appVersion') == info['version'],
            'ZIP 內部版號不符')
    for name in (EXE, 'resources/runtime-python/pythonw.exe'):
        pe_x64(root / name)
    return info


def extract_package(archive_path, dest):
    with ZipFile(archive_path) as archive:
        entries = archive.infolist()
        require(len(entries) <= 2000 and sum(item.file_size for item in entries) <= MAX_UNPACKED, '解壓資料超出上限')
        require(shutil.disk_usage(dest).free > sum(item.file_size for item in entries) + 1024**2, '解壓空間不足')
        seen = set()
        for item in entries:
            name = item.filename.removesuffix('/')
            path = PurePosixPath(name)
            mode = stat.S_IFMT(item.external_attr >> 16)
            require(name == path.as_posix() and len(name) <= 220 and (
                name == EXE or path.parts[:1] == ('resources',)
            ), 'ZIP 包含不允許的檔案路徑')
            require(all(
                part not in ('.', '..') and not part.endswith((' ', '.'))
                and not re.search(r'[\\:*?"<>|\x00-\x1f]', part)
                and not re.fullmatch(r'(?i)(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])', part.split('.')[0])
                for part in path.parts
            ), 'ZIP 包含不安全 Windows 路徑')
            require(mode in (0, stat.S_IFDIR if item.is_dir() else stat.S_IFREG)
                    and not item.external_attr & 0x400 and not item.flag_bits & 1, 'ZIP 包含連結、重新解析點或加密資料')
            folded = name.casefold()
            require(folded not in seen, 'ZIP 包含重複路徑')
            seen.add(folded)
            target = dest.joinpath(*path.parts)
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(item) as source, target.open('xb') as output:
                shutil.copyfileobj(source, output, length=256 * 1024)


def atomic_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, encoding='utf-8', delete=False) as stage:
        name = Path(stage.name)
        try:
            json.dump(payload, stage, ensure_ascii=False)
            stage.flush()
            os.fsync(stage.fileno())
        except BaseException:
            stage.close()
            name.unlink(missing_ok=True)
            raise
    try:
        os.replace(name, path)
    finally:
        name.unlink(missing_ok=True)


def read_state(path):
    try:
        return decode_json(path.read_bytes())
    except (OSError, ValueError):
        return {}


def app_root(app_data):
    return app_data / 'application'


def version_root(root, key):
    if key == 'entry':
        return root / key
    require(isinstance(key, str) and re.fullmatch(r'[a-f0-9]{40}-[a-f0-9]{12}', key), '安裝版本指標無效')
    return root / 'versions' / key


def application_state(root):
    default = {'active': 'entry', 'previous': None, 'dataSchema': DATA_SCHEMA}
    return {**default, **read_state(root / 'state.json')}


def compatible(target, current, schema):
    planned = target['dataCompatibility']
    recover = current['dataCompatibility']
    return (type(schema) is int and planned['readMin'] <= schema <= planned['readMax']
            and recover['readMin'] <= planned['write'] <= recover['readMax'])


@contextmanager
def platform_lock(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a+b') as handle:
        handle.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise ValueError('已有版本切換程序在執行') from exc
        try:
            yield
        finally:
            if os.name == 'nt':
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)


def spawn_python(root, script, arguments):
    source = root / 'resources'
    env = os.environ.copy()
    for key in ('CHIP_INSTALL_ROOT', 'CHIP_APP_ROOT', 'CHIP_RUNTIME_VERSION'):
        env.pop(key, None)
    executable = source / 'runtime-python/pythonw.exe' if os.name == 'nt' else sys.executable
    return subprocess.Popen(
        [str(executable), '-B', '-X', 'utf8', str(script), *arguments],
        cwd=source, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
    )


def start_version(root, port, *options):
    return spawn_python(root, root / 'resources/scripts/launcher.py', [
        '--portable', '--no-runtime', '--managed-child', '--port', str(port), *options,
    ])


def get_health(port, session=None):
    opener = build_opener(ProxyHandler({}), NoRedirect())
    headers = {'X-Chip-Update-Session': session} if session else {}
    req = Request(f'http://127.0.0.1:{port}/api/health', headers=headers)
    with opener.open(req, timeout=1) as response:
        return decode_json(response.read(8192))


def await_health(process, port, version, commit, session, seconds=20):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline and process.poll() is None:
        try:
            result = get_health(port, session)
            if (result.get('app') == 'ChipScreener' and result.get('status') == 'ok'
                    and result.get('appVersion') == version and result.get('sourceCommit') == commit
                    and result.get('updateSession') == session):
                return True
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    return False


def stop_process(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def wait_previous(pid, ready):
    if os.name == 'nt':
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
        handle = kernel.OpenProcess(0x100000, 0, pid)
        require(handle, '無法確認目前服務程序')
        try:
            ready.touch()
            require(kernel.WaitForSingleObject(handle, 20000) == 0, '目前服務尚未正常停止')
        finally:
            kernel.CloseHandle(handle)
        return
    ready.touch()
    for _ in range(100):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.2)
    raise ValueError('目前服務尚未正常停止')


def progress(stage, percent, title, detail='', **extra):
    return {'active': stage not in ('done', 'idle', 'error'), 'stage': stage,
            'percent': percent, 'title': title, 'detail': detail, **extra}


def installed_root(root):
    if (root / 'entry' / METADATA).is_file():
        return root / 'entry'
    return None


def selected_root(root):
    state = application_state(root)
    for key in (state['active'], state['previous'], 'entry'):
        if not key:
            continue
        try:
            path = version_root(root, key)
            validate_package(path)
            return path
        except (OSError, ValueError):
            continue
    raise ValueError('找不到已安裝的可用版本')


def create_shortcuts(entry):
    powershell = Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
    script = '''
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
foreach ($folder in @('Desktop','Programs')) {
    $location = $shell.SpecialFolders.Item($folder)
    if (-not [string]::IsNullOrWhiteSpace($location)) {
        $shortcut = $shell.CreateShortcut((Join-Path $location '股票雷達.lnk'))
        $shortcut.TargetPath = $env:CHIP_SHORTCUT_TARGET
        $shortcut.WorkingDirectory = [IO.Path]::GetDirectoryName($shortcut.TargetPath)
        $shortcut.Save()
    }
}
'''
    subprocess.run(
        [str(powershell), '-NoProfile', '-NonInteractive', '-Command', script],
        env={**os.environ, 'CHIP_SHORTCUT_TARGET': str(entry / EXE)}, check=True,
        capture_output=True, timeout=15, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
    )


def install_entry(root, source_root):
    require(os.name == 'nt', '請從 Windows x64 的完整解壓版安裝固定入口')
    validate_package(source_root)
    with platform_lock(root / 'transition.lock'):
        entry = installed_root(root)
        if entry is None:
            with tempfile.TemporaryDirectory(prefix='.entry-', dir=root) as staged:
                package = Path(staged) / 'package'
                package.mkdir()
                shutil.copy2(source_root / EXE, package / EXE)
                shutil.copytree(source_root / 'resources', package / 'resources',
                                ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
                validate_package(package)
                entry = root / 'entry'
                os.replace(package, entry)
        create_shortcuts(entry)
    return entry / EXE


def port_in_use(port):
    with socket.socket() as probe:
        probe.settimeout(0.5)
        return probe.connect_ex(('127.0.0.1', port)) == 0


def repair_from_extracted_package(root, source_root, port):
    """Install a user-confirmed local candidate beside the current version."""
    expected = validate_package(source_root)
    with platform_lock(root / 'transition.lock'):
        require(not port_in_use(port), '請先從舊版的軟體設定停止本機服務，再開啟修復版。')
        state = application_state(root)
        previous = state['active']
        old = validate_package(version_root(root, previous))
        require(version_order(expected['version']) > version_order(old['version']), '修復版必須比目前版新。')
        require(compatible(expected, old, state['dataSchema']), '修復版與目前資料格式不相容。')
        versions = root / 'versions'
        versions.mkdir(parents=True, exist_ok=True)
        key = f"{expected['commit']}-{secrets.token_hex(6)}"
        names = [source_root / EXE, source_root / 'resources']
        required = names[0].stat().st_size + sum(
            file.stat().st_size for file in names[1].rglob('*') if file.is_file()
        )
        require(shutil.disk_usage(versions).free > required + 1024**2, '修復所需磁碟空間不足。')
        with tempfile.TemporaryDirectory(prefix='.stage-', dir=versions) as temporary:
            stage = Path(temporary) / 'package'
            stage.mkdir()
            shutil.copy2(names[0], stage / EXE)
            shutil.copytree(names[1], stage / 'resources', ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
            validate_package(stage, expected)
            os.replace(stage, version_root(root, key))
        journal = root / 'handoff' / f'{secrets.token_hex(16)}.json'
        atomic_json(journal, {'target': key, 'previous': previous, 'port': port, 'pid': None})
    run_handoff(root, journal)


def stage_download(root, source, info, archive, publish, cancelled):
    versions = root / 'versions'
    versions.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.stage-', dir=versions) as staged:
        tmp = Path(staged)
        zip_path = tmp / 'candidate.zip'
        size = archive['size']
        require(shutil.disk_usage(tmp).free > size + 1024**2, '更新下載空間不足')
        received = 0
        digest = hashlib.sha256()
        with source.open_asset(archive['url']) as stream, zip_path.open('xb') as package:
            while True:
                require(not cancelled(), '視窗已關閉，更新已停止')
                chunk = stream.read(128 * 1024)
                if not chunk:
                    break
                received += len(chunk)
                require(received <= size, '下載大小超過 manifest')
                digest.update(chunk)
                package.write(chunk)
                publish(progress('downloading', 15 + received * 53 // size, '下載完整 Windows ZIP',
                                 downloadedBytes=received, totalBytes=size))
            package.flush()
            os.fsync(package.fileno())
        publish(progress('verifying', 72, '核對更新包大小與 SHA-256'))
        require(received == size and digest.hexdigest() == archive['sha256'], '更新 ZIP 大小或 SHA-256 不符')
        publish(progress('extracting', 80, '解壓並核對完整 Windows 應用程式'))
        unpacked = tmp / 'package'
        unpacked.mkdir()
        extract_package(zip_path, unpacked)
        validate_package(unpacked, info)
        require(not cancelled(), '視窗已關閉，更新已停止')
        key = f"{info['commit']}-{secrets.token_hex(6)}"
        os.replace(unpacked, version_root(root, key))
    return key


def cleanup_versions(root, preserve):
    versions = root / 'versions'
    if versions.is_dir():
        for path in versions.iterdir():
            recognized = re.fullmatch(r'[a-f0-9]{40}-[a-f0-9]{12}|\.stage-[A-Za-z0-9_-]+', path.name)
            if recognized and path.name not in preserve and not path.is_symlink() and path.is_dir():
                shutil.rmtree(path, ignore_errors=True)


def run_handoff(root, transaction_file):
    transaction = decode_json(transaction_file.read_bytes())
    session = transaction_file.stem
    ready = transaction_file.with_suffix('.ready')
    gate = transaction_file.with_suffix('.open')
    previous = transaction['previous']
    target = transaction['target']
    port = transaction['port']
    process = None
    old_exited = False
    committed = False
    state = None
    try:
        with platform_lock(root / 'transition.lock'):
            current_state = application_state(root)
            require(current_state['active'] == previous, '使用中的版本已變更，請重新確認。')
            state = current_state
            if transaction['pid'] is None:
                require(not port_in_use(port), '請先停止舊版服務，再使用修復版。')
            else:
                wait_previous(transaction['pid'], ready)
            old_exited = True
            target_root = version_root(root, target)
            expected = validate_package(target_root)
            current = validate_package(version_root(root, previous))
            require(compatible(expected, current, state['dataSchema']), '資料不相容，保留目前版本')
            process = start_version(target_root, port, '--update-probe', str(gate))
            require(await_health(process, port, expected['version'], expected['commit'], session),
                    '指定版本未通過本機健康檢查')
            atomic_json(root / 'state.json', {
                'active': target, 'previous': previous if previous != target else state['previous'],
                'dataSchema': expected['dataCompatibility']['write'],
                'lastResult': {'id': session, 'success': True, 'version': expected['version'],
                               'previousVersion': current['version'], 'message': '版本已通過健康檢查'},
            })
            committed = True
            gate.touch()
            cleanup_versions(root, {previous, target})
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        if process and not committed:
            stop_process(process)
        if not committed and state is not None:
            atomic_json(root / 'state.json', {**state, 'lastResult': {
                'id': session, 'success': False, 'message': str(exc), 'rolledBack': old_exited,
            }})
            if old_exited:
                start_version(version_root(root, previous), port)
    finally:
        ready.unlink(missing_ok=True)
        transaction_file.unlink(missing_ok=True)
        if not committed:
            gate.unlink(missing_ok=True)


class FullUpdate:
    def __init__(self, app_data, source_root, source=None):
        self.root = app_root(app_data)
        self.source_root = source_root
        self.source = source or Source()
        self.current = None
        if (source_root / METADATA).is_file():
            try:
                self.current = validate_package(source_root)
            except (OSError, ValueError):
                pass
        self.last_check = None
        self._lock = threading.Lock()
        self._progress = progress('idle', 0, '')
        self._worker = None
        self.close_event = threading.Event()

    def display(self):
        state = application_state(self.root)
        previous = None
        if state['previous']:
            try:
                previous = validate_package(version_root(self.root, state['previous']))['version']
            except (OSError, ValueError):
                pass
        entry = installed_root(self.root)
        return {
            'appUpdate': {
                'canInstall': os.name == 'nt' and self.current is not None,
                'installed': entry is not None,
                'entry': str(entry / EXE) if entry else '',
                'previousVersion': previous,
                'lastResult': state.get('lastResult'),
            },
            'lastCheck': self.last_check,
        }

    def install(self):
        require(self.current is not None, '此版本缺少安裝識別，請使用官方完整 ZIP')
        install_entry(self.root, self.source_root)

    def check(self, channel, current_version):
        require(channel in ('stable', 'beta'), '未知更新通道')
        self.last_check = None
        readme = self.source.readme()
        if BEGIN not in readme and END not in readme:
            result = {'channel': channel, 'currentAppVersion': current_version, 'hasUpdate': False,
                      'status': 'unconfigured', 'releaseUrl': RELEASES,
                      'checkedAt': datetime.now(timezone.utc).isoformat()}
            self.last_check = result
            return result
        entry = readme_channels(readme)[channel]
        result = {
            'channel': channel, 'currentAppVersion': current_version, 'remoteAppVersion': None,
            'hasUpdate': False, 'requiresShellUpgrade': False, 'releaseUrl': RELEASES,
            'checkedAt': datetime.now(timezone.utc).isoformat(),
        }
        if entry is None:
            result['status'] = 'unavailable'
        elif channel == 'beta' and entry['version'] == '0.6.5-rc.4':
            result.update(status='manual', remoteAppVersion=entry['version'], releaseUrl=entry['zipUrl'])
        else:
            selected, archive, notes = self.source.selected(entry, channel)
            version = selected['version']
            result.update(remoteAppVersion=version, sourceCommit=selected['commit'], zipSha256=archive['sha256'], changelog=notes,
                          releaseUrl=f'{RELEASES}/tag/v{version}', size=archive['size'])
            comparison = version_order(version) > version_order(current_version)
            lower = version_order(version) < version_order(current_version)
            if not comparison and not lower and self.current:
                require(selected['commit'] == self.current['commit'], '指定版本號與本機相同，但來源提交不符')
            supported = self.current is not None and compatible(
                selected, self.current, application_state(self.root)['dataSchema'],
            )
            status = ('current' if not comparison and not lower else 'incompatible' if not supported
                      else 'downgrade' if lower else 'update')
            result.update(status=status, hasUpdate=status in ('update', 'downgrade'),
                          requiresShellUpgrade=self.current is None, isDowngrade=lower)
        self.last_check = result
        return result

    def get_progress(self):
        state = application_state(self.root)
        with self._lock:
            current = dict(self._progress)
        last = state.get('lastResult') or {}
        if last.get('id') and current.get('transaction') in (None, last.get('id')):
            return progress('done' if last.get('success') else 'error', 100 if last.get('success') else 0,
                            last.get('message', ''), transaction=last['id'], error='' if last.get('success') else last.get('message', ''))
        return current

    def set_progress(self, value):
        with self._lock:
            self._progress = value

    def is_busy(self):
        with self._lock:
            return self._worker is not None and self._worker.is_alive()

    def request(self, action, body, channel, port, shutdown):
        require(type(body) is dict and body.get('confirm') is True, '請先確認安裝或回退')
        require(self.current is not None and installed_root(self.root) is not None, '請先安裝固定入口')
        current = application_state(self.root)
        previous = current['active']
        active_info = validate_package(version_root(self.root, previous))
        require(active_info == self.current, '目前服務與安裝版本不符，請用固定入口重開')
        if action == 'apply':
            chosen = self.last_check or {}
            require(chosen.get('hasUpdate') and chosen.get('channel') == channel
                    and body.get('version') == chosen.get('remoteAppVersion')
                    and body.get('commit') == chosen.get('sourceCommit'), '指定版本已變更，請重新檢查並確認')
            body = {**body, 'zipSha256': chosen['zipSha256']}
            require(not chosen.get('isDowngrade') or body.get('confirmDowngrade') is True, '降版需要額外確認')
        else:
            require(action == 'rollback' and body.get('confirmDowngrade') is True and current['previous'],
                    '沒有可回退版本或缺少確認')
        session = secrets.token_hex(16)
        with self._lock:
            require(self._worker is None or not self._worker.is_alive(), '已有更新工作在執行')
            self._progress = progress('checking', 5, '準備更新', transaction=session)
            self._worker = threading.Thread(
                target=self._run, args=(action, channel, dict(body), current, port, shutdown, session),
                name='full-zip-update', daemon=False,
            )
            self._worker.start()
        return {'started': True, 'transaction': session}

    def _run(self, action, channel, body, state, port, shutdown, session):
        def publish(value):
            self.set_progress({**value, 'transaction': session})

        target = None
        helper = None
        path = None
        passed = False
        previous = state['active']
        try:
            if action == 'apply':
                entry = readme_channels(self.source.readme())[channel]
                require(entry and entry.get('version') == body['version'],
                        '更新指標已變更，請重新確認')
                candidate, archive, _ = self.source.selected(entry, channel)
                require(candidate['commit'] == body['commit'] and archive['sha256'] == body['zipSha256'],
                        '官方包的提交或雜湊已變更，請重新確認')
                require(compatible(candidate, self.current, state['dataSchema']), '候選版資料格式不相容')
                target = stage_download(self.root, self.source, candidate, archive, publish, self.close_event.is_set)
            else:
                target = state['previous']
                candidate = validate_package(version_root(self.root, target))
                require(compatible(candidate, self.current, state['dataSchema']), '回退目標資料格式不相容')
            require(not self.close_event.is_set(), '視窗已關閉，更新已停止')
            path = self.root / 'handoff' / f'{session}.json'
            atomic_json(path, {'target': target, 'previous': previous, 'port': port, 'pid': os.getpid()})
            fixed = installed_root(self.root)
            helper = spawn_python(fixed, self.source_root / 'resources/scripts/providers/full_update.py',
                                  ['--handoff', str(self.root), str(path)])
            ready = path.with_suffix('.ready')
            deadline = time.monotonic() + 6
            while not ready.is_file():
                require(not self.close_event.is_set(), '視窗已關閉，更新已停止')
                require(helper.poll() is None and time.monotonic() < deadline, '無法交接給更新助手')
                time.sleep(0.05)
            require(not self.close_event.is_set(), '視窗已關閉，更新已停止')
            publish(progress('restarting', 92, '停止舊版並驗證新版'))
            passed = True
            shutdown()
        except Exception as exc:
            publish(progress('error', 0, '更新未完成', str(exc), error=str(exc)))
        finally:
            if not passed:
                if helper:
                    stop_process(helper)
                if path:
                    path.unlink(missing_ok=True)
                    path.with_suffix('.ready').unlink(missing_ok=True)
                if action == 'apply' and target:
                    shutil.rmtree(version_root(self.root, target), ignore_errors=True)


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == '--handoff':
        run_handoff(Path(sys.argv[2]), Path(sys.argv[3]))
    else:
        raise SystemExit(2)
