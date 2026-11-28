"""台股籌碼雷達一鍵啟動器
自動執行：
1. 偵測熱更 runtime 目錄（開發環境含 .git 預設略過，支援測試開關）與 pendingVerify 自動回滾保護
2. 若運行安裝目錄版且原始碼有異動，自動編譯 build/dashboard.html
3. 偵測本機服務是否已在背景運行（已運行則直接開啟畫面，不重複佔用連接埠）
4. 啟動本機資料更新與盤中即時報價伺服器
5. 優先以獨立應用視窗（Edge / Chrome --app 模式）開啟，無則回退系統預設瀏覽器
"""

import argparse
import errno
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import json
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = ROOT / 'scripts'
RENDERER_DIR = ROOT / 'src' / 'renderer'
DATA_DIR = ROOT / 'data'
BUILD_DIR = ROOT / 'build'
DASHBOARD_FILE = BUILD_DIR / 'dashboard.html'
FEED_BASE_FILE = DATA_DIR / 'feed-base.json'

DEFAULT_HOST = '127.0.0.1'
DEFAULT_PORT = int(os.environ.get('CHIP_PORT', '18765'))

sys.path.insert(0, str(SCRIPTS_DIR))
import build_dashboard  # noqa: E402
from providers import full_update, updater  # noqa: E402


def needs_rebuild() -> bool:
    if not RENDERER_DIR.exists():
        return False
    if not DASHBOARD_FILE.exists() or not FEED_BASE_FILE.exists():
        return True
    target_mtime = min(DASHBOARD_FILE.stat().st_mtime, FEED_BASE_FILE.stat().st_mtime)
    watch_files = [
        SCRIPTS_DIR / 'build_dashboard.py',
        SCRIPTS_DIR / 'weekly_evidence.py',
        SCRIPTS_DIR / 'release_meta.json',
        DATA_DIR / 'web_data.json',
        *RENDERER_DIR.rglob('*'),
    ]
    return any(p.is_file() and p.stat().st_mtime > target_mtime for p in watch_files)


def existing_server_version(host: str, port: int) -> str | None:
    url = f'http://{host}:{port}/api/health'
    try:
        direct = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with direct.open(url, timeout=1.2) as resp:
            payload = json.load(resp)
            if payload.get('app') == 'ChipScreener':
                return payload.get('appVersion') or ''
    except (OSError, ValueError, AttributeError):
        pass
    return None


def port_is_listening(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.5):
            return True
    except OSError:
        return False


def show_port_conflict(host: str, port: int, existing_version: str | None) -> None:
    owner = ''
    if os.name == 'nt':
        netstat = Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32' / 'netstat.exe'
        try:
            listing = subprocess.check_output(
                [str(netstat), '-ano', '-p', 'tcp'], creationflags=subprocess.CREATE_NO_WINDOW,
                text=True, errors='replace', timeout=4,
            )
            for row in listing.splitlines():
                parts = row.split()
                if (len(parts) >= 5 and parts[0] == 'TCP' and parts[1] in {f'{host}:{port}', f'0.0.0.0:{port}'}
                        and parts[2].endswith(':0') and parts[-1].isdigit()):
                    owner = f'（PID {parts[-1]}）'
                    break
        except (OSError, subprocess.SubprocessError):
            pass

    app = f'股票雷達 {existing_version}' if existing_version else '另一個本機服務'
    message = (
        f'{app}{owner}仍在使用 {host}:{port}。只關閉視窗不會停止背景服務。\n\n'
        '1. 若舊版的「軟體設定」有「停止本機服務」，先在該處停止。\n'
        f'2. 若沒有此按鈕，按 Ctrl+Shift+Esc 開啟工作管理員，進入「詳細資料」。'
        f'找到占用連接埠的程序{owner}，確認為舊版股票雷達（pythonw.exe 的命令列含 scripts\\launcher.py）後，'
        '選「結束工作」。若為其他應用程式，請從該程式結束。\n'
        '3. 再雙擊要使用的版本。使用原本的 Windows 帳號及瀏覽器設定檔即可讀取原策略。'
    )
    if os.name == 'nt':
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, message, '股票雷達｜請先停止本機服務', 0x30)
    else:
        print(message, file=sys.stderr, flush=True)


def pick_available_port(host: str, preferred: int, wait_release: bool = False) -> int:
    attempts = 40 if wait_release else 1
    for _ in range(attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind((host, preferred))
                return preferred
            except OSError:
                if wait_release:
                    time.sleep(0.2)
                    continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return int(sock.getsockname()[1])


def find_app_browser() -> str | None:
    candidates = [
        shutil.which('msedge'),
        shutil.which('chrome'),
        r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
        r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
        r'C:\Program Files\Google\Chrome\Application\chrome.exe',
        r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    ]
    for path in candidates:
        if path and Path(path).is_file():
            return str(path)
    return None


def open_interface(url: str, force_browser: bool = False) -> None:
    if not force_browser:
        browser_exe = find_app_browser()
        if browser_exe:
            try:
                subprocess.Popen(
                    [browser_exe, f'--app={url}', '--window-size=1360,880'],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return
            except OSError:
                pass
    webbrowser.open(url)


def _purge_server_modules() -> None:
    for mod_name in list(sys.modules.keys()):
        if mod_name == 'serve_local' or mod_name == 'providers' or mod_name.startswith('providers.'):
            sys.modules.pop(mod_name, None)


def _boot_server_from_root(app_root: Path, host: str, port: int):
    os.environ['CHIP_INSTALL_ROOT'] = str(ROOT)
    os.environ['CHIP_APP_ROOT'] = str(app_root)
    scripts_path = str(app_root / 'scripts')
    sys.path = [p for p in sys.path if p != scripts_path]
    sys.path.insert(0, scripts_path)
    if app_root != ROOT:
        _purge_server_modules()
    import serve_local  # noqa: E402
    return serve_local.create_server(host, port)


def main() -> None:
    if sys.stdout is None:
        sys.stdout = open(os.devnull, 'w', encoding='utf-8')
    if sys.stderr is None:
        sys.stderr = open(os.devnull, 'w', encoding='utf-8')

    parser = argparse.ArgumentParser(description='台股籌碼雷達一鍵啟動器')
    parser.add_argument('--rebuild', action='store_true', help='強制重新編譯 build/dashboard.html')
    parser.add_argument('--browser', action='store_true', help='以一般瀏覽器分頁開啟（不使用獨立應用視窗）')
    parser.add_argument('--no-open', action='store_true', help='僅啟動本機服務，不自動開啟視窗')
    parser.add_argument('--port', type=int, default=DEFAULT_PORT, help='指定本機服務連接埠')
    parser.add_argument('--use-runtime', action='store_true', help='強制在開發環境中允許載入熱更 runtime 目錄（測試用）')
    parser.add_argument('--no-runtime', action='store_true', help='強制略過熱更 runtime 目錄並以安裝目錄啟動')
    parser.add_argument('--portable', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--managed-child', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--update-probe', type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()

    cli_override = True if args.use_runtime else (False if args.no_runtime else None)
    app_data_dir = Path(os.environ.get('LOCALAPPDATA') or Path.home()) / 'ChipScreener'
    managed = full_update.app_root(app_data_dir)
    source = ROOT.parent
    if (sys.platform == 'win32' and args.portable and not args.managed_child and not args.no_open
            and full_update.installed_root(managed) and not source.is_relative_to(managed)):
        import ctypes
        try:
            extracted = full_update.validate_package(source)
            current = full_update.validate_package(full_update.selected_root(managed))
            if full_update.version_order(extracted['version']) > full_update.version_order(current['version']):
                message = (f"使用此解壓版將 {current['version']} 修復至 {extracted['version']}？\n"
                           '會保留原捷徑、設定、資料及可回退版本。請先關閉舊版服務。')
                if ctypes.windll.user32.MessageBoxW(None, message, '籌碼雷達｜離線修復', 0x24) == 6:
                    full_update.repair_from_extracted_package(managed, source, args.port)
                    return
        except (OSError, ValueError) as exc:
            ctypes.windll.user32.MessageBoxW(None, str(exc), '籌碼雷達｜修復未完成', 0x10)
            return

    if args.portable and not args.managed_child and full_update.installed_root(managed):
        with full_update.platform_lock(managed / 'transition.lock'):
            target = full_update.selected_root(managed)
            if target.resolve() != ROOT.parent.resolve():
                options = (['--no-open'] if args.no_open else []) + (['--browser'] if args.browser else [])
                full_update.start_version(target, args.port, *options)
                return

    runtime_root, runtime_ver, boot_note = updater.resolve_boot_runtime(ROOT, app_data_dir, cli_runtime_override=cli_override)

    print('========================================', flush=True)
    print('  台股籌碼雷達 (ChipScreener)', flush=True)
    print('========================================', flush=True)
    if boot_note:
        print(f'[boot] {boot_note}', flush=True)

    # 1. 若無 runtime 覆寫，檢查並自動建置安裝目錄介面
    if runtime_root is None:
        if args.rebuild or needs_rebuild():
            print('[1/3] 偵測到程式異動或尚未編譯，正在自動建置介面...', flush=True)
            build_dashboard.build()
        else:
            print('[1/3] 介面檔案已是最新，略過重新編譯。', flush=True)
    else:
        print(f'[1/3] 使用熱更執行環境：{runtime_ver} ({runtime_root})', flush=True)

    wait_release = os.environ.get('CHIP_WAIT_PORT_RELEASE') == '1'

    # 2. 若服務已運行，直接開啟畫面（重啟交接期間略過，避免誤連即將退出的舊行程）
    active_root = runtime_root or ROOT
    expected_version = updater.read_code_meta(active_root)['appVersion']
    existing_version = None if wait_release else existing_server_version(DEFAULT_HOST, args.port)
    if existing_version == expected_version and not args.update_probe:
        url = f'http://{DEFAULT_HOST}:{args.port}/dashboard.html'
        print(f'[2/3] 偵測到籌碼雷達服務已在運行：{url}', flush=True)
        if not args.no_open:
            print('[3/3] 正在開啟畫面...', flush=True)
            open_interface(url, force_browser=args.browser)
        return

    # 3. 啟動本機資料更新服務（含熱更失敗自動回滾）
    if args.portable and (existing_version is not None or port_is_listening(DEFAULT_HOST, args.port)):
        show_port_conflict(DEFAULT_HOST, args.port, existing_version)
        raise SystemExit(1)

    port = args.port if args.portable else pick_available_port(DEFAULT_HOST, args.port, wait_release=wait_release)
    url = f'http://{DEFAULT_HOST}:{port}/dashboard.html'
    print(f'[2/3] 正在啟動本機服務與即時更新引擎（Port {port}）...', flush=True)

    os.environ['CHIP_RUNTIME_VERSION'] = runtime_ver
    server = None
    try:
        server = _boot_server_from_root(active_root, DEFAULT_HOST, port)
    except Exception as exc:
        if args.portable and isinstance(exc, OSError) and (
            exc.errno == errno.EADDRINUSE or getattr(exc, 'winerror', None) in (10013, 10048)
        ):
            show_port_conflict(DEFAULT_HOST, port, existing_server_version(DEFAULT_HOST, port))
            raise SystemExit(1) from exc
        if runtime_root is not None and runtime_ver:
            print(f'[WARN] 熱更版本 {runtime_ver} 啟動失敗（{exc}），執行自動回滾...', flush=True)
            fb_root, fb_ver = updater.record_boot_failure_and_rollback(app_data_dir, runtime_ver, str(exc))
            os.environ['CHIP_RUNTIME_VERSION'] = fb_ver
            fallback_target = fb_root or ROOT
            if fallback_target == ROOT and needs_rebuild():
                build_dashboard.build()
            server = _boot_server_from_root(fallback_target, DEFAULT_HOST, port)
        else:
            raise

    

    if args.portable and not args.no_open:
        server.stop_with_windows = True

    if args.update_probe:
        server.update_session = args.update_probe.stem

        def wait_for_activation():
            deadline = time.monotonic() + 32
            while time.monotonic() < deadline:
                try:
                    args.update_probe.unlink()
                except FileNotFoundError:
                    time.sleep(0.15)
                    continue
                if not args.no_open:
                    open_interface(url, force_browser=args.browser)
                return
            server.shutdown()

        threading.Thread(target=wait_for_activation, daemon=True).start()
    elif not args.no_open:
        def delayed_open():
            time.sleep(0.4)
            print(f'[3/3] 正在開啟籌碼雷達：{url}', flush=True)
            open_interface(url, force_browser=args.browser)

        threading.Thread(target=delayed_open, daemon=True).start()

    print(f'服務已就緒：{url}', flush=True)
    print('關閉此視窗或按 Ctrl+C 即可停止本機服務。', flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n已停止台股籌碼雷達本機服務。', flush=True)
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
