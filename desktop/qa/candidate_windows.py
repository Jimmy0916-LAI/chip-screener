"""Offline acceptance against the real extracted Windows x64 launcher."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.request import ProxyHandler, build_opener

from playwright.sync_api import expect, sync_playwright

from history_browser_checks import close_native_dashboard, seed_2330_overlay
from market_screen_checks import inspect_screen, inventory
from v065_browser_checks import verify_v065

URL = 'http://127.0.0.1:18765'
DIRECT = build_opener(ProxyHandler({}))


def poll(action, timeout, message):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        value = action()
        if value:
            return value
        time.sleep(0.2)
    raise AssertionError(message)


def health():
    try:
        with DIRECT.open(URL + '/api/health', timeout=1) as response:
            return json.load(response)
    except OSError:
        return None


def listen_process():
    result = subprocess.check_output(
        ['pwsh', '-NoProfile', '-Command',
         '$owner = (Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort 18765).OwningProcess; '
         'Get-Process -Id $owner | Select-Object Id,Path | ConvertTo-Json -Compress'],
        text=True, encoding='utf-8',
    )
    return json.loads(result)


def process_stopped(pid):
    result = subprocess.run(['pwsh', '-NoProfile', '-Command',
                             f'if (Get-Process -Id {pid} -ErrorAction SilentlyContinue) {{ exit 1 }}'],
                            capture_output=True)
    return result.returncode == 0


def check_product(exe, version, out, chromium):
    metrics = {}
    errors = []
    expected_title = f'籌碼雷達 V{version}'

    def start(path, name):
        assert health() is None, 'Unexpected existing service at the fixed app origin'
        clock = time.monotonic()
        os.startfile(path)
        doc = poll(health, 45, 'Native EXE did not start the local service')
        assert doc['appVersion'] == doc['shellVersion'] == version, doc
        metrics[f'{name}HealthSeconds'] = round(time.monotonic() - clock, 3)
        process = listen_process()
        assert Path(process['Path']).resolve() == (
            path.parent / 'resources' / 'runtime-python' / 'pythonw.exe'
        ).resolve(), process
        return process['Id'], clock

    def close(pid, name):
        clock = time.monotonic()
        poll(lambda: close_native_dashboard(expected_title), 20, 'Native browser window did not open')
        poll(lambda: health() is None, 35, 'Service kept listening after the final window closed')
        poll(lambda: process_stopped(pid), 20, 'Bundled Python process survived native window close')
        metrics[f'{name}ShutdownSeconds'] = round(time.monotonic() - clock, 3)

    pid, launched = start(exe, 'first')
    try:
        with sync_playwright() as driver:
            browser = driver.chromium.launch(executable_path=chromium)
            context = browser.new_context()
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            assert page.goto(URL).ok
            expect(page.locator('#brandVersion')).to_have_text(expected_title)
            expect(page.locator('#feedDay')).to_have_text('2026-11-20')
            metrics['firstUsablePageSeconds'] = round(time.monotonic() - launched, 3)
            page.screenshot(path=out / 'startup.png')
            for nav in ('screen', 'stock', 'backtest', 'peak', 'settings', 'data', 'home'):
                page.locator(f'[data-nav="{nav}"]').first.click()
                assert page.locator('#page').inner_text().strip(), nav
            page.evaluate("localStorage.setItem('chipscr_market_mode', 'US')")
            page.reload()
            expect(page.locator('#nav [data-nav=screen]')).to_be_visible()
            launched = time.monotonic()
            clean = inspect_screen(page, out, 'candidate-clean-offline')
            metrics['screenAndFullCsvSeconds'] = round(time.monotonic() - launched, 3)
            assert [clean[k] for k in ('day', 'pass', 'fail', 'unknown')] == ['2026-11-20', 301, 1662, 22], clean
            inspect_screen(page, out, 'fixed-2026-11-13', expected_week='2026-11-13', fixed=True, all_pages=True)
            inventory(page, URL, 'candidate-clean-offline', out)
            page.locator('[data-nav="stock"]').first.click()
            page.locator('#windowSelect').select_option('2026-11-13')
            expect(page.locator('[data-signal-band="400"]')).to_contain_text('-37,973,336 / -10,706,718')
            assert page.locator('#daySelect option').count() >= 3
            seed_2330_overlay(page)
            page.locator('#overlayK').check()
            assert page.get_by_role('img', name='集保持股與日 K').locator('rect').count() >= 3
            page.screenshot(path=out / 'overlay.png')
            page.locator('[data-nav="backtest"]').first.click()
            same = page.evaluate("""() => {
                const {a, b, rows} = comparison();
                const row = rows.find(item => item.code === '2330');
                return [a.end, b.end, a.asOf === b.asOf, row.a.deltaShares, row.b.deltaShares, row.a.gain];
            }""")
            assert same[:5] == ['2026-11-13', '2026-11-13', True, [-37973336, -10706718], [-37973336, -10706718]]
            assert abs(same[5] + 0.18771926312261655) < 1e-8
            page.screenshot(path=out / 'same-window-ab.png')
            context.close()
            verify_v065(browser, URL, out, errors)
            assert not errors, errors
            browser.close()
    finally:
        close(pid, 'first')

    moved = exe.parent.with_name('已搬移 籌碼雷達')
    exe.parent.rename(moved)
    moved_exe = moved / exe.name
    pid, _ = start(moved_exe, 'moved')
    try:
        with DIRECT.open(URL + '/api/software/ai', timeout=3) as response:
            ai_settings = json.load(response)
        assert ai_settings['provider'] == 'deepseek' and not ai_settings['enabled'], ai_settings
    finally:
        close(pid, 'moved')
    (out / 'windows-perf.json').write_text(json.dumps(metrics, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(metrics), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('exe', type=Path)
    parser.add_argument('version')
    parser.add_argument('output', type=Path)
    parser.add_argument('--chromium', required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    os.environ.update(HTTP_PROXY='http://127.0.0.1:1', HTTPS_PROXY='http://127.0.0.1:1',
                      NO_PROXY='127.0.0.1,localhost')
    check_product(args.exe.resolve(), args.version, args.output, args.chromium)


if __name__ == '__main__':
    main()
