"""Opt-in Windows test with released ZIPs and an isolated official README branch."""
import argparse
import base64
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import time
from tempfile import TemporaryDirectory
from zipfile import ZipFile


def packaged_launcher(ref, scripts):
    # Change only the README ref for this test process. The installed files and
    # downloaded assets stay byte-for-byte identical to the released package.
    sys.path.insert(0, str(scripts))
    from providers import full_update
    full_update.README_REF = ref
    launcher = scripts / 'launcher.py'
    sys.argv = [str(launcher), '--portable', '--no-runtime', '--no-open']
    runpy.run_path(str(launcher), run_name='__main__')


def check_version(page):
    with page.expect_response(lambda response: response.url.endswith('/api/software/update/check')) as response:
        page.locator('#swCheckUpdateBtn').click()
    doc = response.value.json()
    assert response.value.ok and 'check' in doc, doc
    return doc['check']


def advance_test_pointer(ref, version, target):
    if ref != 'release/update-qa-channel':
        raise ValueError('Automated pointer writes are limited to the isolated test branch')
    endpoint = 'repos/Jimmy0916-LAI/chip-screener/contents/README.md'
    endpoint_with_ref = f'{endpoint}?ref={ref}'
    record = json.loads(subprocess.check_output(['gh', 'api', endpoint_with_ref], text=True))
    content = base64.b64decode(record['content']).decode('utf-8')

    def link(candidate):
        return ('https://github.com/Jimmy0916-LAI/chip-screener/releases/download/'
                f'v{candidate}/ChipScreener-v{candidate}-Windows-x64.zip')

    if content.count(link(version)) != 1 or link(target) in content:
        raise ValueError('Expected one baseline link on the isolated test branch')
    payload = {'message': 'Advance isolated update QA pointer', 'branch': ref, 'sha': record['sha'],
               'content': base64.b64encode(content.replace(link(version), link(target)).encode()).decode()}
    subprocess.run(['gh', 'api', '--method', 'PUT', endpoint, '--input', '-', '--silent'],
                   input=json.dumps(payload), text=True, check=True)


def run(args, work):
    from playwright.sync_api import expect, sync_playwright
    from candidate_windows import URL, health, listen_process, poll, process_stopped
    from history_browser_checks import close_native_dashboard

    os.environ['LOCALAPPDATA'] = str(work / 'user')
    root = work / '中文 更新驗收'
    with ZipFile(args.baseline) as archive:
        archive.extractall(root)
    meta = json.loads((root / 'resources/update-package.json').read_bytes())
    version = meta['version']
    assert not health(), 'Test requires a free application port'
    proc = subprocess.Popen([
        str(root / 'resources/runtime-python/python.exe'), '-B', str(Path(__file__).resolve()),
        '--child', args.ref, str(root / 'resources/scripts'),
    ], env={key: value for key, value in os.environ.items() if key not in ('GH_TOKEN', 'GITHUB_TOKEN')})
    try:
        initial = poll(health, 35, 'Baseline service failed to start')
        assert initial['appVersion'] == version and initial['sourceCommit'] == meta['commit']
        with sync_playwright() as driver:
            browser = driver.chromium.launch(executable_path=args.chromium)
            context = browser.new_context()
            page = context.new_page()
            page.on('dialog', lambda dlg: dlg.accept())
            page.goto(URL)
            page.evaluate("localStorage.setItem('qa-update-preserved', 'yes')")
            page.locator('#nav [data-nav=software]').click()
            page.locator('#swInstallEntryBtn').click()
            expect(page.locator('#page')).to_contain_text('固定啟動入口已安裝')
            stable = check_version(page)
            assert stable['status'] == 'unavailable' and stable['channel'] == 'stable', stable
            with page.expect_response(lambda response: response.url.endswith('/api/software/update/check')) as first:
                page.locator('#swChannelSelect').select_option('beta')
            check = first.value.json()['check']
            assert check['status'] == 'current' and check['remoteAppVersion'] == version, check
            print('QA READY: change only the isolated README Beta link now', flush=True)

            if args.advance:
                advance_test_pointer(args.ref, version, args.target)

            def new_target():
                result = check_version(page)
                if result.get('remoteAppVersion') == args.target:
                    return result
                time.sleep(5)
                return None

            # Leave time for the operator to push the independent README-only change.
            target = poll(new_target, 180, 'The isolated README pointer did not reach the next candidate')
            assert target['status'] == 'update', target
            with page.expect_response(lambda response: response.url.endswith('/api/software/update/apply')) as apply:
                page.locator('#swApplyUpdateBtn').click()
            assert apply.value.status == 202, apply.value.text()
            identifier = apply.value.json()['transaction']

            def updated():
                doc = health()
                result = (doc or {}).get('updateResult') or {}
                if result.get('id') == identifier and result.get('success') is False:
                    raise AssertionError(result)
                return doc if result.get('id') == identifier and result.get('success') else None

            new = poll(updated, 100, 'No completed native handoff')
            assert new['appVersion'] == args.target and new['sourceCommit'] == target['sourceCommit']
            assert proc.wait(timeout=10) == 0
            page.goto(URL)
            expect(page.locator('#brandVersion')).to_have_text(f'籌碼雷達 V{args.target}')
            assert page.evaluate("localStorage.getItem('qa-update-preserved')") == 'yes'
            args.output.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=args.output / 'installed-version.png')
            page.close(run_before_unload=True)
            context.close()
            native = listen_process()['Id']
            poll(lambda: close_native_dashboard(f'籌碼雷達 V{args.target}'), 20, 'Updated native window missing')
            poll(lambda: not health() and process_stopped(native), 165, 'Updated Python still running')
            entry = work / 'user/ChipScreener/application/entry/股票雷達.exe'
            os.startfile(entry)
            reopened = poll(health, 35, 'Fixed launcher did not reopen')
            assert reopened['appVersion'] == args.target and reopened['sourceCommit'] == target['sourceCommit']
            pid = listen_process()['Id']
            poll(lambda: close_native_dashboard(f'籌碼雷達 V{args.target}'), 20, 'Fixed launcher window missing')
            poll(lambda: not health() and process_stopped(pid), 165, 'Fixed launcher Python still running')
            receipt = {'baseline': initial, 'stable': stable, 'betaBefore': check, 'betaAfter': target,
                       'handoff': new, 'fixedEntry': reopened, 'portReleased': True}
            (args.output / 'real-update.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
            browser.close()
    finally:
        if proc.poll() is None:
            proc.terminate()
            proc.wait(timeout=10)


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == '--child':
        packaged_launcher(sys.argv[2], Path(sys.argv[3]))
    else:
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument('baseline', type=Path)
        parser.add_argument('target')
        parser.add_argument('output', type=Path)
        parser.add_argument('--chromium', required=True)
        parser.add_argument('--ref', default='release/update-qa-channel')
        parser.add_argument('--advance', action='store_true')
        with TemporaryDirectory() as directory:
            run(parser.parse_args(), Path(directory))
