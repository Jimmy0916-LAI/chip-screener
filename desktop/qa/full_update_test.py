"""Offline policy, package integrity, and handoff regression checks."""
import hashlib
from io import BytesIO
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from providers import full_update as update


OLD_VERSION = '0.6.5-rc.5'
NEW_VERSION = '0.6.5-rc.6'
OLD_SHA = 'a' * 40
NEW_SHA = 'b' * 40


def identity(version=NEW_VERSION, sha=NEW_SHA, schema=1):
    return {'schemaVersion': 1, 'version': version, 'commit': sha, 'architecture': 'windows-x64',
            'dataCompatibility': {'readMin': schema, 'readMax': schema, 'write': schema}}


def zip_url(version):
    return update.asset_url(version, f'ChipScreener-v{version}-Windows-x64.zip')


def readme(beta=NEW_VERSION, stable=None):
    def cell(version):
        return f'[Windows x64 ZIP]({zip_url(version)})' if version else '—'
    return (
        f'# 籌碼雷達\n\n{update.BEGIN}\n\n| 通道 | 下載 |\n| --- | --- |\n'
        f'| Stable | {cell(stable)} |\n| Beta | {cell(beta)} |\n\n{update.END}\n\n'
        f'其他歷史下載 {zip_url("9.9.9")}\n'
    )


def package_files(meta):
    executable = b'MZ' + bytes(58) + bytes([64, 0, 0, 0]) + b'PE\0\0\x64\x86'
    files = {name: b'resource' for name in update.REQUIRED}
    files[update.EXE] = executable
    files['resources/runtime-python/pythonw.exe'] = executable
    files[update.METADATA] = json.dumps(meta).encode()
    files['resources/package.json'] = json.dumps({'version': meta['version']}).encode()
    files['resources/scripts/release_meta.json'] = json.dumps({'appVersion': meta['version']}).encode()
    return files


def package_bytes(meta):
    data = BytesIO()
    with ZipFile(data, 'w') as archive:
        for name, raw in package_files(meta).items():
            archive.writestr(name, raw)
    return data.getvalue()


def write_package(root, meta):
    for name, raw in package_files(meta).items():
        file = root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(raw)


class GitHubFixture(update.Source):
    def __init__(self):
        self.archive = package_bytes(identity())
        self.archive_hash = hashlib.sha256(self.archive).hexdigest()
        self.zip_url = zip_url(NEW_VERSION)
        self.manifest_url = update.asset_url(NEW_VERSION, 'update-manifest.json')
        archive = {'url': self.zip_url, 'size': len(self.archive), 'sha256': self.archive_hash}
        self.manifest = json.dumps({**identity(), 'assets': {'zip': archive}}).encode()
        self.sums_url = update.asset_url(NEW_VERSION, 'SHA256SUMS.txt')
        self.sums = f"{self.archive_hash}  {self.zip_url.rsplit('/', 1)[1]}\n".encode()
        self.assets = [
            self.asset(self.sums_url, self.sums),
            self.asset(self.manifest_url, self.manifest),
            self.asset(self.zip_url, self.archive),
        ]
        self.ref_sha = NEW_SHA
        self.requests = []

    def readme(self):
        return readme()

    def asset(self, url, data):
        return {'browser_download_url': url, 'state': 'uploaded', 'size': len(data),
                'digest': f'sha256:{hashlib.sha256(data).hexdigest()}'}

    def api(self, path):
        self.requests.append(path)
        if path == f'/releases/tags/v{NEW_VERSION}':
            return {'tag_name': f'v{NEW_VERSION}', 'draft': False, 'prerelease': True, 'assets': self.assets}
        if path == f'/git/ref/tags/v{NEW_VERSION}':
            return {'object': {'type': 'tag', 'sha': 'c' * 40}}
        if path == '/git/tags/' + 'c' * 40:
            return {'object': {'type': 'commit', 'sha': self.ref_sha}}
        raise AssertionError(path)

    def open_asset(self, url):
        return BytesIO({self.zip_url: self.archive, self.manifest_url: self.manifest, self.sums_url: self.sums}[url])


class FullUpdateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = GitHubFixture()

    def test_only_the_readme_rows_define_targets(self):
        self.assertEqual(update.readme_channels(readme()), {
            'stable': None, 'beta': {'version': NEW_VERSION, 'zipUrl': self.source.zip_url},
        })
        for text in (
            readme() * 2, readme(stable=NEW_VERSION), readme().replace('https://github.com/', 'http://github.com/'),
            readme().replace('| Stable | — |', '| Stable | — | [extra](https://www.example.com/) |'),
            readme().replace(self.source.zip_url, self.source.zip_url + '?checksum=any'),
        ):
            with self.subTest(text=text[:60]), self.assertRaises(ValueError):
                update.readme_channels(text)

    def test_release_tag_manifest_and_asset_cross_checks(self):
        entry = update.readme_channels(readme())['beta']
        info, asset, _ = self.source.selected(entry, 'beta')
        self.assertEqual(info, identity())
        self.assertEqual(asset['sha256'], self.source.archive_hash)
        self.assertEqual(self.source.requests, [
            f'/releases/tags/v{NEW_VERSION}', f'/git/ref/tags/v{NEW_VERSION}', '/git/tags/' + 'c' * 40,
        ])
        self.source.ref_sha = OLD_SHA
        with self.assertRaisesRegex(ValueError, '提交'):
            self.source.selected(entry, 'beta')
        self.source.ref_sha = NEW_SHA
        self.source.assets[1].pop('digest')
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            self.source.selected(entry, 'beta')
        self.source.assets[1] = self.source.asset(self.source.manifest_url, self.source.manifest)
        self.source.assets[2]['size'] += 1
        with self.assertRaisesRegex(ValueError, '大小'):
            self.source.selected(entry, 'beta')

    def test_download_failure_and_path_rejection_leave_no_staging(self):
        info, asset, _ = self.source.selected(update.readme_channels(readme())['beta'], 'beta')
        for changed in ({'sha256': '0' * 64}, {'size': asset['size'] + 1}):
            with self.assertRaisesRegex(ValueError, '大小或 SHA-256'):
                update.stage_download(self.root, self.source, info, {**asset, **changed}, Mock(), lambda: False)
            self.assertEqual(list((self.root / 'versions').iterdir()), [])
        with self.assertRaisesRegex(ValueError, '已停止'):
            update.stage_download(self.root, self.source, info, asset, Mock(), lambda: True)
        self.assertEqual(list((self.root / 'versions').iterdir()), [])
        for name in ['../outside.txt', 'resources/../../out.txt', 'resources/COM1.txt',
                     'resources/windows\\bad.txt', 'resources/name:alternative']:
            with self.subTest(name=name):
                archive_path = self.root / 'unsafe.zip'
                with ZipFile(archive_path, 'w') as archive:
                    archive.writestr(name, b'fixture')
                with self.assertRaises(ValueError):
                    update.extract_package(archive_path, self.root)
        key = update.stage_download(self.root, self.source, info, asset, Mock(), lambda: False)
        self.assertEqual(update.validate_package(update.version_root(self.root, key)), info)

    def test_empty_stable_legacy_beta_and_compatible_downgrade(self):
        write_package(self.root / 'package', identity())
        service = update.FullUpdate(self.root, self.root / 'package', self.source)
        self.assertEqual(service.check('stable', NEW_VERSION)['status'], 'unavailable')
        with patch.object(self.source, 'readme', return_value=readme('0.6.5-rc.4')):
            self.assertEqual(service.check('beta', NEW_VERSION)['status'], 'manual')
        self.assertEqual(service.check('beta', '0.6.5-rc.7')['status'], 'downgrade')
        self.assertFalse(update.compatible(identity(schema=2), identity(), 1))
        forward = identity(schema=2)
        forward['dataCompatibility']['readMin'] = 1
        self.assertFalse(update.compatible(forward, identity(), 1))

    def test_transition_lock_rejects_reentry(self):
        path = self.root / 'lock'
        with update.platform_lock(path):
            with self.assertRaisesRegex(ValueError, '正在|執行'):
                with update.platform_lock(path):
                    self.fail('concurrent activation lock was acquired')
        with update.platform_lock(path):
            pass

    def test_health_failure_keeps_previous_version_and_restarts_it(self):
        key = NEW_SHA + '-ffffffffffff'
        write_package(self.root / 'entry', identity(OLD_VERSION, OLD_SHA))
        write_package(update.version_root(self.root, key), identity())
        data = self.root / 'user-settings.json'
        data.write_text('existing settings')
        handoff = self.root / 'handoff' / 'failed.json'
        update.atomic_json(handoff, {'target': key, 'previous': 'entry', 'port': 18765, 'pid': 1234})
        child = Mock()
        with patch.object(update, 'wait_previous') as wait, patch.object(update, 'start_version', return_value=child) as start, \
                patch.object(update, 'await_health', return_value=False), patch.object(update, 'stop_process') as stop:
            update.run_handoff(self.root, handoff)
        wait.assert_called_once()
        stop.assert_called_once_with(child)
        self.assertEqual(start.call_args.args, (self.root / 'entry', 18765))
        state = update.application_state(self.root)
        self.assertEqual(state['active'], 'entry')
        self.assertTrue(state['lastResult']['rolledBack'])
        self.assertEqual(data.read_text(), 'existing settings')
        self.assertFalse(handoff.exists())

    def test_success_switches_only_after_verified_health(self):
        key = NEW_SHA + '-ffffffffffff'
        write_package(self.root / 'entry', identity(OLD_VERSION, OLD_SHA))
        write_package(update.version_root(self.root, key), identity())
        handoff = self.root / 'handoff' / 'passed.json'
        update.atomic_json(handoff, {'target': key, 'previous': 'entry', 'port': 18765, 'pid': 1234})
        child = Mock()

        def healthy(*args):
            self.assertEqual(update.application_state(self.root)['active'], 'entry')
            self.assertEqual(args, (child, 18765, NEW_VERSION, NEW_SHA, 'passed'))
            return True

        with patch.object(update, 'wait_previous'), patch.object(update, 'start_version', return_value=child), \
                patch.object(update, 'await_health', side_effect=healthy):
            update.run_handoff(self.root, handoff)
        state = update.application_state(self.root)
        self.assertEqual(state['active'], key)
        self.assertEqual(state['previous'], 'entry')
        self.assertTrue(state['lastResult']['success'])
        self.assertTrue(handoff.with_suffix('.open').is_file())
        self.assertEqual(update.selected_root(self.root), update.version_root(self.root, key))


if __name__ == '__main__':
    unittest.main()
