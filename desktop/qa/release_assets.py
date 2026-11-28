"""Verify a candidate ZIP against its manifest and derive a README channel target."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
from zipfile import ZipFile

REPOSITORY = 'Jimmy0916-LAI/chip-screener'
RELEASES = f'https://github.com/{REPOSITORY}/releases'
IDENTITY_KEYS = {'schemaVersion', 'version', 'commit', 'architecture', 'dataCompatibility'}
BEGIN = '<!-- CHIPSCREENER_UPDATE_CHANNELS_BEGIN -->'
END = '<!-- CHIPSCREENER_UPDATE_CHANNELS_END -->'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def strict_json(raw):
    def unique(items):
        obj = {}
        for key, value in items:
            require(key not in obj, f'Duplicate JSON key: {key}')
            obj[key] = value
        return obj

    return json.loads(raw, object_pairs_hook=unique)


def release_url(version):
    return f'{RELEASES}/tag/v{version}'


def asset_url(version, name):
    return f'{RELEASES}/download/v{version}/{name}'


def readme_channels(path):
    text = path.read_text(encoding='utf-8')
    require(text.count(BEGIN) == text.count(END) == 1, 'README must have exactly one update block')
    block = text.split(BEGIN, 1)[1].split(END, 1)[0].strip().splitlines()
    require(len(block) == 4 and block[:2] == ['| 通道 | 下載 |', '| --- | --- |'], 'Invalid README channel table')
    channels = {}
    for channel, row in zip(('Stable', 'Beta'), block[2:]):
        prefix = f'| {channel} | '
        require(row.startswith(prefix) and row.endswith(' |'), f'Invalid {channel} row')
        target = row[len(prefix):-2]
        if target == '—':
            channels[channel.lower()] = None
            continue
        match = re.fullmatch(
            r'\[Windows x64 ZIP\]\((https://github\.com/Jimmy0916-LAI/chip-screener/releases/download/'
            r'v(?P<version>[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)?)/'
            r'ChipScreener-v(?P=version)-Windows-x64\.zip)\)', target,
        )
        require(match is not None, f'Invalid {channel} ZIP URL')
        version = match.group('version')
        require((channel == 'Stable') == ('-' not in version), f'Invalid {channel} version')
        channels[channel.lower()] = match.group(1)
    return channels


def check_package(zip_path, manifest_path, checksum_path, expected_commit, expected_version):
    manifest_bytes = manifest_path.read_bytes()
    manifest = strict_json(manifest_bytes)
    require(set(manifest) == IDENTITY_KEYS | {'assets'}, 'Invalid manifest fields')
    identity = {key: manifest[key] for key in IDENTITY_KEYS}
    require(type(identity['schemaVersion']) is int and identity['schemaVersion'] == 1, 'Invalid schema version')
    require(re.fullmatch('[a-f0-9]{40}', expected_commit) and identity['commit'] == expected_commit, 'Source SHA mismatch')
    require(identity['version'] == expected_version, 'Version mismatch')
    require(identity['architecture'] == 'windows-x64', 'Architecture mismatch')
    compat = identity['dataCompatibility']
    require(set(compat) == {'readMin', 'readMax', 'write'} and all(type(v) is int for v in compat.values()) and
            1 <= compat['readMin'] <= compat['write'] <= compat['readMax'], 'Invalid data compatibility')
    require(zip_path.name == f'ChipScreener-v{expected_version}-Windows-x64.zip', 'Invalid asset name')
    package_hash = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    require(set(manifest['assets']) == {'zip'}, 'Invalid manifest asset list')
    require(manifest['assets']['zip'] == {
        'url': asset_url(expected_version, zip_path.name), 'sha256': package_hash, 'size': zip_path.stat().st_size
    }, 'ZIP URL, hash or size mismatch')
    require(checksum_path.read_text(encoding='ascii').strip() == f'{package_hash}  {zip_path.name}', 'Checksum mismatch')
    with ZipFile(zip_path) as package:
        names = package.namelist()
        require(len(names) == len(set(names)), 'Duplicate ZIP entries')
        require(not package.testzip(), 'Bad ZIP member')
        require({name.split('/')[0] for name in names} == {'股票雷達.exe', 'resources'}, 'Unexpected ZIP layout')
        for required in ('resources/build/dashboard.html', 'resources/runtime-python/python.exe',
                         'resources/runtime-python/pythonw.exe', 'resources/scripts/launcher.py'):
            require(required in names, f'Missing {required}')
        require(strict_json(package.read('resources/update-package.json')) == identity, 'Package identity mismatch')
        require(strict_json(package.read('resources/scripts/release_meta.json'))['appVersion'] == expected_version,
                'Packaged source version mismatch')
        require(strict_json(package.read('resources/package.json'))['version'] == expected_version, 'Shell version mismatch')
        exe = package.read('股票雷達.exe')
        pe_offset, = struct.unpack_from('<I', exe, 0x3c)
        require(exe[:2] == b'MZ' and exe[pe_offset:pe_offset+6] == b'PE\0\0\x64\x86', 'Expected Windows x64 PE')
    return {
        'version': expected_version,
        'commit': expected_commit,
        'manifestUrl': asset_url(expected_version, 'update-manifest.json'),
        'manifestSha256': hashlib.sha256(manifest_bytes).hexdigest(),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--readme', type=Path)
    parser.add_argument('--zip', type=Path)
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--checksums', type=Path)
    parser.add_argument('--commit')
    parser.add_argument('--version')
    args = parser.parse_args()
    if args.readme:
        print(json.dumps(readme_channels(args.readme)))
    if args.zip:
        print(json.dumps(check_package(args.zip, args.manifest, args.checksums, args.commit, args.version)))


if __name__ == '__main__':
    main()
