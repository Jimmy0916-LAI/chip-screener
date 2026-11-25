"""台股籌碼雷達一鍵啟動器
自動執行：
1. 偵測前端原始碼與建置產物時間戳，有異動或缺檔時自動編譯 build/dashboard.html
2. 偵測本機服務是否已在背景運行（已運行則直接開啟畫面，不重複佔用連接埠）
3. 啟動本機資料更新伺服器（支援 TDCC 集保與 TWSE 交易日曆即時更新）
4. 優先以獨立應用視窗（Edge / Chrome --app 模式）開啟，無則回退系統預設瀏覽器
"""

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
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
import serve_local  # noqa: E402


def needs_rebuild() -> bool:
    if not DASHBOARD_FILE.exists() or not FEED_BASE_FILE.exists():
        return True
    target_mtime = min(DASHBOARD_FILE.stat().st_mtime, FEED_BASE_FILE.stat().st_mtime)
    watch_files = [
        SCRIPTS_DIR / 'build_dashboard.py',
        SCRIPTS_DIR / 'weekly_evidence.py',
        DATA_DIR / 'web_data.json',
        *RENDERER_DIR.rglob('*'),
    ]
    return any(p.is_file() and p.stat().st_mtime > target_mtime for p in watch_files)


def check_existing_server(host: str, port: int) -> bool:
    url = f'http://{host}:{port}/api/health'
    try:
        with urllib.request.urlopen(url, timeout=1.2) as resp:
            if resp.status == 200:
                payload = json.loads(resp.read().decode('utf-8'))
                return payload.get('app') == 'ChipScreener'
    except Exception:
        return False
    return False


def pick_available_port(host: str, preferred: int) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        if sock.connect_ex((host, preferred)) != 0:
            return preferred
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
    args = parser.parse_args()

    print('========================================', flush=True)
    print('  台股籌碼雷達 (ChipScreener)', flush=True)
    print('========================================', flush=True)

    # 1. 檢查並自動建置最新介面
    if args.rebuild or needs_rebuild():
        print('[1/3] 偵測到程式異動或尚未編譯，正在自動建置介面...', flush=True)
        build_dashboard.build()
    else:
        print('[1/3] 介面檔案已是最新，略過重新編譯。', flush=True)

    # 2. 若服務已運行，直接開啟畫面
    if check_existing_server(DEFAULT_HOST, args.port):
        url = f'http://{DEFAULT_HOST}:{args.port}/dashboard.html'
        print(f'[2/3] 偵測到籌碼雷達服務已在運行：{url}', flush=True)
        if not args.no_open:
            print('[3/3] 正在開啟畫面...', flush=True)
            open_interface(url, force_browser=args.browser)
        return

    # 3. 啟動本機資料更新服務
    port = pick_available_port(DEFAULT_HOST, args.port)
    url = f'http://{DEFAULT_HOST}:{port}/dashboard.html'
    print(f'[2/3] 正在啟動本機服務與官方集保更新引擎（Port {port}）...', flush=True)
    server = serve_local.create_server(DEFAULT_HOST, port)

    if not args.no_open:
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
