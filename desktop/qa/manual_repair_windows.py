"""Start the extracted repair EXE with the original RC5 fixed entry in place."""
import argparse
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
from zipfile import ZipFile

from candidate_windows import health, listen_process, poll, process_stopped
from history_browser_checks import close_native_dashboard


def confirm_repair():
    user = ctypes.windll.user32
    user.FindWindowW.argtypes = (wintypes.LPCWSTR, wintypes.LPCWSTR)
    user.FindWindowW.restype = wintypes.HWND
    window = user.FindWindowW('#32770', '籌碼雷達｜離線修復')
    if not window:
        return False
    user.GetDlgItem.argtypes = (wintypes.HWND, ctypes.c_int)
    user.GetDlgItem.restype = wintypes.HWND
    user.PostMessageW.argtypes = (wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
    return user.PostMessageW(user.GetDlgItem(window, 6), 0x00F5, 0, 0)


def run(old_zip, new_exe, version, out):
    local = Path(os.environ['LOCALAPPDATA'])
    assert 'RUNNER_TEMP' in os.environ and local.is_relative_to(Path(os.environ['RUNNER_TEMP']))
    root = local / 'ChipScreener/application'
    entry = root / 'entry'
    assert not root.exists() and not health(), 'Repair test requires fresh isolated state'
    with ZipFile(old_zip) as archive:
        archive.extractall(entry)
    shortcut_exe = entry / '股票雷達.exe'
    before = hashlib.sha256(shortcut_exe.read_bytes()).hexdigest()
    legacy = root.parent / 'tdcc-local-v1/test-preserved'
    legacy.parent.mkdir()
    legacy.write_text('old data remains', encoding='utf-8')
    # The candidate is launched exactly as it would be after the user extracts it.
    os.startfile(new_exe)
    poll(confirm_repair, 30, 'Local repair confirmation did not appear')

    def repair_complete():
        doc = health()
        return doc if doc and doc['appVersion'] == version and (doc.get('updateResult') or {}).get('success') else None

    result = poll(repair_complete, 40, 'Repair did not activate the new package')
    state = json.loads((root / 'state.json').read_bytes())
    assert state['previous'] == 'entry' and state['active'] != 'entry'
    assert hashlib.sha256(shortcut_exe.read_bytes()).hexdigest() == before
    assert legacy.read_text(encoding='utf-8') == 'old data remains'

    def close():
        pid = listen_process()['Id']
        poll(lambda: close_native_dashboard(f'籌碼雷達 V{version}'), 20, 'Repaired native window missing')
        poll(lambda: health() is None and process_stopped(pid), 165, 'Repair service or Python still running')

    close()
    os.startfile(shortcut_exe)
    reopened = poll(repair_complete, 40, 'Original fixed entry did not start the repair version')
    assert reopened['sourceCommit'] == result['sourceCommit']
    close()
    (out / 'manual-repair.json').write_text(json.dumps({
        'oldAppVersion': '0.6.5-rc.5', 'repair': result['appVersion'], 'reopened': reopened['appVersion'],
        'sourceCommit': reopened['sourceCommit'], 'keptEntry': before, 'previous': state['previous'],
        'marketDataPreserved': True, 'portReleased': True,
    }, indent=2), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('old_zip', type=Path)
    parser.add_argument('new_exe', type=Path)
    parser.add_argument('version')
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    run(args.old_zip.resolve(), args.new_exe.resolve(), args.version, args.output)
