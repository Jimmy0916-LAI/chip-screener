"""Use local copies of the released Windows packages to test recovery."""
import argparse
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile

from playwright.sync_api import expect, sync_playwright

from candidate_windows import URL, health, listen_process, poll, process_stopped
from history_browser_checks import close_native_dashboard


def unpack(zip_path, target):
    with ZipFile(zip_path) as archive:
        archive.extractall(target)
    return json.loads((target / 'resources/update-package.json').read_bytes())


def run(args, work):
    os.environ['LOCALAPPDATA'] = str(work / 'user')
    root = work / 'user/ChipScreener/application'
    entry = root / 'entry'
    old = unpack(args.old, entry)
    with ZipFile(args.current) as archive:
        current = json.loads(archive.read('resources/update-package.json'))
    key = current['commit'] + '-00cafe00cafe'
    unpack(args.current, root / 'versions' / key)
    (root / 'state.json').write_text(json.dumps({'active': key, 'previous': 'entry', 'dataSchema': 1}))
    exe = entry / '股票雷達.exe'
    dashboard = entry / 'resources/build/dashboard.html'
    original = dashboard.read_bytes()
    dashboard.write_bytes(b'corrupt dashboard for recovery test')
    os.startfile(exe)
    current_version = current['version']
    poll(lambda: (health() or {}).get('appVersion') == current_version, 40, 'Current package did not open')
    result_log = {}
    args.output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as driver:
        browser = driver.chromium.launch(executable_path=args.chromium)
        ctx = browser.new_context()
        page = ctx.new_page()
        page.on('dialog', lambda dialog: dialog.accept())
        page.goto(URL)
        page.evaluate("localStorage.setItem('qa-rollback-preserved', 'yes')")

        def rollback(expect_success):
            page.goto(URL)
            page.locator('#nav [data-nav=software]').click()
            with page.expect_response(lambda response: response.url.endswith('/api/software/rollback')) as res:
                page.locator('#swRollbackUpdateBtn').click()
            assert res.value.status == 202, res.value.text()
            tx = res.value.json()['transaction']

            def finished():
                doc = health()
                result = (doc or {}).get('updateResult') or {}
                return doc if result.get('id') == tx else None

            doc = poll(finished, 100, 'Rollback transaction did not finish')
            assert doc['updateResult']['success'] is expect_success, doc
            return doc

        recovered = rollback(False)
        assert recovered['appVersion'] == current_version
        assert recovered['updateResult']['rolledBack'] is True
        page.goto(URL)
        expect(page.locator('#brandVersion')).to_have_text(f'籌碼雷達 V{current_version}')
        result_log['corruptTargetRecovery'] = recovered
        dashboard.write_bytes(original)
        rolled_back = rollback(True)
        assert rolled_back['appVersion'] == old['version'] and rolled_back['sourceCommit'] == old['commit']
        page.goto(URL)
        expect(page.locator('#brandVersion')).to_have_text(f"籌碼雷達 V{old['version']}")
        assert page.evaluate("localStorage.getItem('qa-rollback-preserved')") == 'yes'
        result_log['userRollback'] = rolled_back
        page.screenshot(path=args.output / 'restored-version.png')
        page.close(run_before_unload=True)
        ctx.close()
        pid = listen_process()['Id']
        # Previous native browser windows may still show an offline/error view.
        for version in (current_version, old['version']):
            close_native_dashboard(f'籌碼雷達 V{version}')
        poll(lambda: not health() and process_stopped(pid), 165, 'Port or Python process still active')
        result_log['portReleased'] = True
        (args.output / 'rollback.json').write_text(json.dumps(result_log, indent=2), encoding='utf-8')
        browser.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('old', type=Path)
    parser.add_argument('current', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--chromium', required=True)
    with TemporaryDirectory() as directory:
        run(parser.parse_args(), Path(directory))
