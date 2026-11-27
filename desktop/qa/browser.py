"""Exercise the packaged desktop and local HTML using Chromium."""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, build_opener

from playwright.sync_api import expect, sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('url')
parser.add_argument('light', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--chromium')
parser.add_argument('--version', default='0.6.3-rc.1')
parser.add_argument('--old-version', default='0.6.3')
parser.add_argument('--download', default='https://github.com/Jimmy0916-LAI/chip-screener/pull/13#v063-rc1-download')
parser.add_argument('--history-fix', action='store_true')
parser.add_argument('--v065', action='store_true', help='Exercise additional signal and AI settings on the candidate')
parser.add_argument('--old-exe', type=Path, help='Run Windows upgrade and rollback from the previous ZIP')
parser.add_argument('--inline-html', action='store_true', help='Test document and File API when the runner blocks file://')
args = parser.parse_args()
args.output.mkdir(exist_ok=True, parents=True)

VERSION = args.version
DOWNLOAD = args.download
new_exe = args.light.with_name('股票雷達.exe')
port = urlsplit(args.url).port
http = build_opener(ProxyHandler({}))


def read_api(path):
    with http.open(args.url + path, timeout=2) as response:
        return json.load(response)


def wait_health(version):
    for _ in range(45):
        try:
            health = read_api('/api/health')
        except (OSError, URLError):
            if version is None:
                return
        else:
            if health['appVersion'] == version:
                assert health['shellVersion'] == version
                return
        time.sleep(1)
    raise AssertionError(f'Local service did not reach expected version {version}')


def listener_pid(exe):
    script = (
        f"$owner = (Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort {port}).OwningProcess; "
        "Get-Process -Id $owner | Select-Object Id,Path | ConvertTo-Json -Compress"
    )
    proc = json.loads(subprocess.check_output(['pwsh', '-NoProfile', '-Command', script], encoding='utf-8'))
    assert Path(proc['Path']).resolve() == (exe.parent / 'resources/runtime-python/pythonw.exe').resolve(), proc
    return proc['Id']


def start(exe, version, fail_network=False, shell=False):
    started = time.monotonic()
    if shell:
        os.startfile(exe)
    else:
        env = os.environ.copy()
        if fail_network:
            env.update(HTTPS_PROXY='http://127.0.0.1:1', HTTP_PROXY='http://127.0.0.1:1',
                       NO_PROXY='127.0.0.1,localhost')
        subprocess.Popen([str(exe)], env=env)
    wait_health(version)
    pid = listener_pid(exe)
    print(f'EXE {version}: bundled Python PID {pid}, health ready in {time.monotonic()-started:.2f}s', flush=True)
    return pid


def open_app(context, errors):
    page = context.new_page()
    page.on('pageerror', lambda exc: errors.append(str(exc)))
    assert page.goto(args.url).ok
    return page


def go(page, nav):
    page.locator(f'[data-nav="{nav}"]').first.click()


def stop(page):
    go(page, 'software')
    page.once('dialog', lambda dialog: dialog.accept())
    with page.expect_response(lambda response: response.url.endswith('/api/software/stop')) as result:
        page.locator('#swStopLocalService').click()
    assert result.value.ok
    page.close()
    wait_health(None)


def stock_summary(page, day, shares):
    go(page, 'stock')
    expect(page.locator('#stockCode')).to_have_value('2404')
    expect(page.locator('#stockTdccSummary')).to_contain_text(day)
    expect(page.locator('#daySelect')).to_have_value(day)
    expect(page.get_by_role('row').filter(has_text='400 張以上')).to_contain_text(f'{shares:,}')


def assert_conflict(old_pid):
    """Read the actual launcher dialog before dismissing it."""
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    user32.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
    user32.FindWindowW.restype = wintypes.HWND
    user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumChildWindows.argtypes = [wintypes.HWND, callback_type, wintypes.LPARAM]
    title = '股票雷達｜請先停止本機服務'
    for _ in range(25):
        window = user32.FindWindowW(None, title)
        if window:
            break
        time.sleep(1)
    else:
        raise AssertionError('Expected a native version-conflict dialog')

    labels = []

    @callback_type
    def read_text(hwnd, _):
        value = ctypes.create_unicode_buffer(2048)
        user32.SendMessageW(hwnd, 0x000D, len(value), ctypes.addressof(value))
        labels.append(value.value)
        return True

    try:
        user32.EnumChildWindows(window, read_text, 0)
        message = '\n'.join(labels)
        assert f'PID {old_pid}' in message and f'股票雷達 {args.old_version}' in message and '工作管理員' in message, labels
        print(f'063-06 native collision dialog identifies old version and PID {old_pid}', flush=True)
    finally:
        user32.PostMessageW(window, 0x0010, 0, 0)


def assert_user_data(page, day, week):
    go(page, 'settings')
    expect(page.locator('.notice.good')).to_contain_text('0.37')
    expect(page.locator('[data-setting="minPp"]')).to_have_value('0.43')
    expect(page.get_by_text('換版驗收策略', exact=True)).to_be_visible()
    favorite = read_api('/api/watchlist')['config']['folders'][0]
    assert any(item['code'] == '2404' for item in favorite['items']), favorite
    assert read_api('/api/official/read')['weeks'][day] == week


def verify_upgrade(context, page, day, week, errors):
    stop(page)
    old = args.old_exe
    old_pid = start(old, args.old_version, fail_network=True)
    page = open_app(context, errors)
    go(page, 'settings')
    draft_field = page.locator('[data-setting="minPp"]')
    draft_field.fill('0.37')
    draft_field.press('Tab')
    page.locator('#applySetting').click()
    go(page, 'settings')
    draft_field.fill('0.43')
    draft_field.press('Tab')
    page.locator('#savePreset').click()
    page.locator('.preset-dialog input').fill('換版驗收策略')
    page.locator('.preset-dialog').get_by_role('button', name='儲存').click()
    favorite = read_api('/api/watchlist')['config']['folders'][0]
    response = page.request.post(args.url + '/api/watchlist/stock/add',
                                 data={'folderId': favorite['id'], 'code': '2404'})
    assert response.ok
    assert_user_data(page, day, week)
    page.close()
    assert listener_pid(old) == old_pid
    os.startfile(new_exe)
    assert_conflict(old_pid)
    wait_health(args.old_version)
    assert listener_pid(old) == old_pid
    subprocess.run(['taskkill', '/PID', str(old_pid), '/F'], check=True)
    wait_health(None)

    start(new_exe, VERSION, fail_network=True)
    page = open_app(context, errors)
    assert_user_data(page, day, week)
    go(page, 'watchlist')
    expect(page.locator('#page')).to_contain_text('2404')
    go(page, 'stock')
    expect(page.locator('[data-quick-fav="2404"]')).to_contain_text('已收藏')
    page.screenshot(path=args.output / 'upgrade.png')
    stop(page)

    rollback_pid = start(old, args.old_version, fail_network=True)
    page = open_app(context, errors)
    assert_user_data(page, day, week)
    page.screenshot(path=args.output / 'rollback.png')
    page.close()
    subprocess.run(['taskkill', '/PID', str(rollback_pid), '/F'], check=True)
    wait_health(None)
    print('063-06 closed window, stopped old service, upgraded and rolled back: applied strategy, draft, preset, watchlist and TDCC cache preserved', flush=True)


if args.history_fix and args.old_exe:
    # Use the previous verified ZIP itself, in a dedicated user directory.
    clean = os.environ['LOCALAPPDATA']
    os.environ['LOCALAPPDATA'] = clean + '-rc1-repro'
    start(args.old_exe, args.old_version)
    with sync_playwright() as driver:
        baseline_browser = driver.chromium.launch(executable_path=args.chromium)
        baseline = open_app(baseline_browser.new_context(), [])
        expect(baseline.locator('#feedDay')).to_have_text('—')
        go(baseline, 'stock')
        assert baseline.locator('#daySelect option').count() == 0
        go(baseline, 'home')
        baseline.locator('#refreshTDCC').click()
        expect(baseline.locator('#refreshTDCC')).to_be_enabled(timeout=150000)
        previous = read_api('/api/official/read')['weeks']
        assert len(previous) == 1
        go(baseline, 'stock')
        assert baseline.locator('#daySelect option').count() == 1
        baseline.screenshot(path=args.output / 'rc1-reproduction.png')
        print('RC1 original ZIP: clean = 0 points, one persisted real TDCC file = 1 point', list(previous), flush=True)
        stop(baseline)
    os.environ['LOCALAPPDATA'] = clean

if args.old_exe:
    start(new_exe, VERSION, shell=True)
else:
    wait_health(VERSION)

with sync_playwright() as driver:
    browser = driver.chromium.launch(executable_path=args.chromium)
    context = browser.new_context()
    errors = []
    page = open_app(context, errors)
    page.screenshot(path=args.output / 'startup.png')
    assert page.locator('#feedDay').inner_text() == '—'
    if args.history_fix:
        from history_browser_checks import verify_history
        expect(page.locator('#brandVersion')).to_have_text('籌碼雷達V' + VERSION)
        expect(page.locator('link[rel=icon]')).to_have_attribute('href', page.locator('img.brand-mark').get_attribute('src'))
        verify_history(page, args.output)
    for nav in ('screen', 'stock', 'backtest', 'peak', 'settings', 'data'):
        go(page, nav)
        assert page.locator('#page').inner_text().strip()
    go(page, 'home')
    assert page.locator('#feedDay').inner_text() == '—'
    print('063-10 seven existing pages open before first download', flush=True)

    page.locator('#refreshTDCC').click()
    page.wait_for_function("!document.querySelector('#refreshTDCC').disabled", timeout=150000)
    print('market', page.locator('#feedPanel').inner_text(), flush=True)
    day = page.locator('#feedDay').inner_text()
    downloaded = read_api('/api/official/read')['weeks']
    assert list(downloaded) == [day], downloaded.keys()
    week = downloaded[day]
    shares = week['rows']['2404'][3]
    assert week['quality']['raw_source'] == 'https://opendata.tdcc.com.tw/getOD.ashx?id=1-5'
    assert week['quality']['valid'] >= 1900 and shares > 0
    cache = Path(os.environ['LOCALAPPDATA']) / 'ChipScreener/tdcc-local-v1/official' / f'{day}.json'
    saved_sha = hashlib.sha256(cache.read_bytes()).hexdigest()
    if args.history_fix:
        # Downloading the same live statistics week must keep one persisted record.
        page.locator('#refreshTDCC').click()
        expect(page.locator('#refreshTDCC')).to_be_enabled(timeout=150000)
        repeated = read_api('/api/official/read')['weeks']
        if list(repeated) == [day] and repeated[day]['quality']['sha256'] == week['quality']['sha256']:
            assert hashlib.sha256(cache.read_bytes()).hexdigest() == saved_sha
            print(f'Repeated official week {day}: one unchanged cached record', flush=True)
        else:
            assert day in repeated
            print('Another validated statistics week or official revision arrived during retry', list(repeated), flush=True)

    stock_summary(page, day, shares)
    expect(page.locator('#stockSignalAvailability')).to_contain_text('嚴格週訊號資料不足')
    page.locator('#windowSelect').select_option(day)
    page.locator('#daySelect').select_option(day)
    expect(page.locator('#stockTdccSummary')).to_contain_text(day)
    page.screenshot(path=args.output / 'stock-first-week.png')
    print(f"063-02 real TDCC: {day}, covered {week['quality']['valid']}, 2404 400-share-band {shares}, raw SHA-256 {week['quality']['sha256']}", flush=True)

    if args.old_exe:
        stop(page)
        start(new_exe, VERSION, fail_network=True)
    else:
        page.close()
    page = open_app(context, errors)
    expect(page.locator('#feedDay')).to_have_text(day)
    stock_summary(page, day, shares)
    page.locator('#windowSelect').select_option(day)
    page.locator('#daySelect').select_option(day)
    if args.history_fix:
        page.reload()
        expect(page.locator('#feedDay')).to_have_text(day)
        verify_history(page, args.output, latest=day)
        missing = page.evaluate('''day => {
          const original = weekEnds.slice();
          const index = weekEnds.indexOf(day);
          if (index < 0) return null;
          const prior = new Date(day + "T12:00:00Z");
          prior.setUTCDate(prior.getUTCDate() - 1);
          const partial = prior.toISOString().slice(0,10);
          weekEnds[index] = partial;
          try { return stockMissingWeeks(stockHistory('2404').map(point => point.day)).includes(partial); }
          finally { weekEnds.splice(0, weekEnds.length, ...original); }
        }''', day)
        assert missing is False, missing
        print('An incomplete calendar does not mark an existing statistics week as missing', flush=True)
        page.locator('#daySelect').select_option(day)
        stock_summary(page, day, shares)
    print('063-02 reopened 2404 and selected the official week manually', flush=True)
    go(page, 'home')
    if args.old_exe:
        page.wait_for_function("document.querySelector('#feedStatus').textContent.includes('集保更新失敗，保留上次資料')",
                               timeout=90000)
        expect(page.locator('#feedDay')).to_have_text(day)
        assert read_api('/api/official/read')['weeks'][day] == week
        assert hashlib.sha256(cache.read_bytes()).hexdigest() == saved_sha
        page.screenshot(path=args.output / 'retained-week.png')
        print('063-03 blocked outbound proxy: update failed, first valid week and cache bytes retained', flush=True)

    page.locator('#loadArchivedSample').click()
    go(page, 'stock')
    page.locator('#windowSelect').select_option('2026-11-13')
    signal = page.locator('[data-signal-band="400"]')
    expect(signal).to_contain_text('796,897 / 579,084')
    page.locator('#overlayK').check()
    assert page.get_by_role('img', name='集保持股與日 K').locator('rect').count() >= 3
    page.screenshot(path=args.output / 'overlay.png')
    go(page, 'backtest')
    same = page.evaluate("""() => {
        const {a,b,rows} = comparison();
        const row = rows.find(r => r.code === '2404');
        return { end:[a.end,b.end], asOf:[a.asOf,b.asOf], dates:[a.dates,b.dates],
                 rows:rows.length, a:row.a.deltaShares, b:row.b.deltaShares, gain:row.a.gain };
    }""")
    assert same['end'] == ['2026-11-13'] * 2
    assert same['asOf'][0] == same['asOf'][1] and same['dates'][0] == same['dates'][1]
    assert same['rows'] >= 1900 and same['a'] == same['b'] == [796897, 579084]
    assert abs(same['gain'] - 0.721971163) < 1e-8
    page.screenshot(path=args.output / 'same-window-ab.png')
    print('063-10 fixed 2404 and same-window A/B', same, flush=True)

    go(page, 'home')
    with page.expect_download() as download:
        page.locator('#exportLight').click()
    path = args.output / 'snapshot.json'
    download.value.save_as(path)
    snapshot = json.loads(path.read_bytes())
    assert len(snapshot['stocks']) >= 1900
    reader = context.new_page()
    reader.on('pageerror', lambda exc: errors.append(str(exc)))
    if args.inline_html:
        reader.set_content(args.light.read_text(encoding='utf-8'))
    else:
        reader.goto(args.light.resolve().as_uri())
    reader.locator('#file').set_input_files(path)
    reader.locator('#results').wait_for()
    assert reader.locator('#stocks option').count() == len(snapshot['stocks'])
    reader.locator('#filter').select_option('pass')
    assert reader.locator('#stocks option').count() == sum(r['pass'] for r in snapshot['stocks'])
    reader.locator('#filter').select_option('all')
    for code in ('2330', '2404', '6261'):
        reader.locator('#query').fill(code)
        assert reader.locator('#stocks').input_value() == code
        record = next(r for r in snapshot['stocks'] if r['code'] == code)
        assert record['name'] in reader.locator('#title').inner_text()
    reader.locator('#query').fill('2404')
    selectors = ('#summary', '#title', '#chart', '#detail')
    before = [reader.locator(selector).inner_html() for selector in selectors]
    assert '開 ' in before[2]
    invalid_day = {**snapshot, 'dates': ['2026-02-30', *snapshot['dates'][1:]]}
    wrong_week = {**snapshot, 'sources': [['2026-02-28', '非對應週'], *snapshot['sources'][1:]]}
    for invalid, reason in (({}, '版本不相容'), ({'format': 'chip-radar-light', 'version': 0}, '版本不相容'),
                            (invalid_day, '日期不存在'), (wrong_week, '前後不一致')):
        payload = json.dumps(invalid, ensure_ascii=False).encode('utf-8')
        reader.locator('#file').set_input_files({'name': 'bad.json', 'mimeType': 'application/json', 'buffer': payload})
        expect(reader.locator('#file')).to_have_value('')
        expect(reader.locator('#status')).to_contain_text('匯入失敗')
        expect(reader.locator('#status')).to_contain_text(reason)
        assert [reader.locator(selector).inner_html() for selector in selectors] == before
    reader.screenshot(path=args.output / 'light-invalid-date.png')
    print('063-07 local HTML rejected 2026-02-30 and source-week mismatch, retained imported chart and summary', flush=True)

    go(page, 'software')
    expect(page.locator('#swCandidateDownload')).to_have_attribute('href', DOWNLOAD)
    expect(page.locator('#swCandidateDownload').locator('..')).to_contain_text('SHA-256')
    if not args.history_fix:
        expect(page.locator('#swCandidateDownload').locator('..')).to_contain_text('下載到期時間')
    expect(page.locator('#swCandidateDownload')).to_contain_text(VERSION)
    page.screenshot(path=args.output / 'candidate-download.png')
    print('063-11 beta download and verification landing page', DOWNLOAD, flush=True)

    if args.v065:
        from v065_browser_checks import verify_v065
        verify_v065(browser, args.url, args.output, errors)
    if args.old_exe:
        verify_upgrade(context, page, day, week, errors)
    assert not errors, errors

if args.history_fix and args.old_exe:
    from history_browser_checks import close_native_dashboard
    expected = '籌碼雷達V' + VERSION
    close_native_dashboard(expected)
    time.sleep(2)
    pid = start(new_exe, VERSION, fail_network=True)
    for _ in range(25):
        if close_native_dashboard(expected):
            break
        time.sleep(1)
    else:
        raise AssertionError('Native dashboard window did not open')
    wait_health(None)
    # Closing the last UI must stop the packaged Python service, not only close its socket.
    subprocess.run(['pwsh', '-NoProfile', '-Command',
                    f'if (Get-Process -Id {pid} -ErrorAction SilentlyContinue) {{ exit 1 }}'], check=True)
    print('Closing the last native window stopped its packaged Python service', flush=True)

