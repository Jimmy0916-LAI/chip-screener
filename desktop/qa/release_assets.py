"""Verify a candidate ZIP against its manifest and derive a README channel target."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import sys
from zipfile import ZipFile

REPOSITORY = 'Jimmy0916-LAI/chip-screener'
RELEASES = f'https://github.com/{REPOSITORY}/releases'
IDENTITY_KEYS = {'schemaVersion', 'version', 'commit', 'architecture', 'dataCompatibility'}


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


def verify_channels(path):
    # Use the production parser and release trust checks for the README gate.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
    from providers.full_update import Source, readme_channels

    channels = readme_channels(path.read_text(encoding='utf-8'))
    source = Source()
    token = os.environ.get('CHIP_CI_GITHUB_TOKEN')
    if token:
        # The read-only Actions credential applies only to fixed-host API calls.
        source.api_opener.addheaders = [('Authorization', f'Bearer {token}')]
    for channel, entry in channels.items():
        if entry is None:
            continue
        if channel == 'beta' and entry['version'] == '0.6.5-rc.4':
            release = source.api('/releases/tags/v0.6.5-rc.4')
            require(release.get('draft') is False and release.get('prerelease') is True
                    and release.get('tag_name') == 'v0.6.5-rc.4',
                    'Legacy RC4 download must point to the published prerelease')
            ref = source.api('/git/ref/tags/v0.6.5-rc.4').get('object', {})
            require(ref.get('type') == 'commit'
                    and ref.get('sha') == 'fe0a5fd4530ca83906f5ba2f28aef0f590cfe109',
                    'Legacy RC4 source tag differs from the verified candidate')
            assets = [asset for asset in release['assets'] if asset.get('browser_download_url') == entry['zipUrl']]
            require(len(assets) == 1 and assets[0].get('size') == 10532048
                    and assets[0].get('digest') == 'sha256:384a30beeb4b2fe5b99cd9f453fe3bcfb11f3d41c78623713d967e60fd8e81c3',
                    'Legacy RC4 ZIP differs from the verified download')
        else:
            source.selected(entry, channel)
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
        print(json.dumps(verify_channels(args.readme)))
    if args.zip:
        print(json.dumps(check_package(args.zip, args.manifest, args.checksums, args.commit, args.version)))


if __name__ == '__main__':
    main()
