"""Cross-check the Windows UI's history with original TDCC CSV levels."""
import csv
import hashlib
import io
import json
from pathlib import Path
from urllib.request import urlopen

from playwright.sync_api import expect

from rebuild_tdcc_history import ARCHIVE, BLOBS


def original_shares(code, day, raw):
    levels = {
        int(row['持股分級']): int(row['股數'])
        for row in csv.DictReader(io.StringIO(raw.decode('utf-8-sig')))
        if row['證券代號'].strip() == code and row['資料日期'] == day.replace('-', '')
    }
    assert len(levels) == 17 and sum(levels[i] for i in range(1, 16)) - levels[16] == levels[17]
    return sum(levels[i] for i in range(12, 16))


def verify_history(page, out, latest=None):
    raw = {}
    for day, blob in BLOBS.items():
        with urlopen(ARCHIVE.replace('github.com', 'raw.githubusercontent.com') +
                     f'/main/snapshots/2026/{day}.csv', timeout=25) as response:
            data = response.read()
        assert hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest() == blob
        raw[day] = data
    page.locator('[data-nav=stock]').first.click()
    actual = {}
    for code in ('2330', '2404'):
        page.locator('#stockCode').fill(code)
        page.locator('#goStock').click()
        expected = {day: original_shares(code, day, data) for day, data in raw.items()}
        days = page.locator('#daySelect option').evaluate_all('(options) => options.map(o => o.value)')
        assert len(days) == len(set(days)) and set(expected).issubset(days), days
        if latest:
            assert latest in days
        for day, shares in expected.items():
            page.locator('#daySelect').select_option(day)
            expect(page.get_by_role('row').filter(has_text='400 張以上')).to_contain_text(f'{shares:,}')
            expect(page.locator('svg circle title').filter(has_text=day).first).to_be_attached()
        expect(page.locator('#stockHistorySource')).to_contain_text('公布時點待證')
        actual[code] = {'days': days, 'shares400': expected,
                        'gaps': page.locator('#stockHistoryGaps').all_text_contents()}
        page.screenshot(path=out / f'history-{code}.png')
    print('Windows TDCC original CSV reconciliation:', json.dumps(actual, ensure_ascii=False), flush=True)
    return actual


def close_native_dashboard(title):
    """Close the candidate browser's Windows app windows without killing it."""
    import ctypes
    from ctypes import wintypes
    user = ctypes.windll.user32
    user.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    callback = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    matches = []
    @callback
    def collect(hwnd, _):
        text = ctypes.create_unicode_buffer(1024)
        user.GetWindowTextW(hwnd, text, len(text))
        if title in text.value:
            matches.append(hwnd)
        return True
    user.EnumWindows(collect, 0)
    for hwnd in matches:
        user.PostMessageW(hwnd, 0x0010, 0, 0)
    return len(matches)
