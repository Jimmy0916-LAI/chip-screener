"""Measure an extracted release using Linux Chromium in a loopback-only network namespace.

Run with an isolated HOME, after unshare -Urn and ip link set lo up. The OS browser
handoff is captured and driven by a dedicated Playwright browser. This measures
the packaged service and renderer; Windows loader/SmartScreen are separate gates.
"""
import argparse
import json
import os
import platform
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from collections import Counter
from pathlib import Path
from zipfile import ZipFile

import psutil
from playwright.sync_api import sync_playwright


def proc_sample(pids):
    result = {}
    for pid in pids:
        try:
            proc = psutil.Process(pid)
            cpu = proc.cpu_times()
            result[pid] = {'rss': proc.memory_info().rss, 'cpu': cpu.user + cpu.system,
                           'name': proc.name(), 'parent': proc.ppid()}
        except psutil.Error:
            pass
    return result


def rss(snapshot):
    return sum(p['rss'] for p in snapshot.values())


def tree_bytes(root):
    return sum(p.stat().st_size for p in root.rglob('*') if p.is_file())


def listening(port):
    with socket.socket() as sock:
        sock.settimeout(1)
        return sock.connect_ex(('127.0.0.1', port)) == 0


def benchmark(package, browser, root, idle):
    if set(psutil.net_if_addrs()) != {'lo'}:
        raise RuntimeError('Run in a new network namespace with only loopback enabled')
    files = root / '中文 空格'
    with ZipFile(package) as archive:
        archive.extractall(files)
    config = root / 'user'
    config.mkdir()
    capture = root / 'capture-url'
    capture.write_text('#!/bin/sh\nprintf "%s" "$1" > "$BENCH_URL_FILE"\n')
    capture.chmod(0o700)
    url_file = root / 'opened-url'
    env = dict(os.environ, LOCALAPPDATA=str(config), HOME=str(root), BROWSER=str(capture)+' %s',
               BENCH_URL_FILE=str(url_file), PYTHONDONTWRITEBYTECODE='1')
    launcher = files / 'resources' / 'scripts' / 'launcher.py'
    command = [sys.executable, '-B', str(launcher), '--portable', '--no-runtime', '--browser']
    if listening(18765):
        raise RuntimeError('Benchmark port already occupied')
    http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with open(root / 'launcher.log', 'ab') as log, sync_playwright() as pw:
        chrome = pw.chromium.launch(executable_path=browser, args=['--no-sandbox'])
        context = chrome.new_context()
        cdp = chrome.new_browser_cdp_session()
        requests = Counter()
        response_bytes = []
        context.on('request', lambda req: requests.update([req.method + ' ' + req.url.split('?')[0]]))
        context.on('requestfinished', lambda req: response_bytes.append(req.sizes()['responseBodySize']))
        def launch():
            url_file.unlink(missing_ok=True)
            return subprocess.Popen(command, env=env, stdout=log, stderr=log)
        def wait_url(process):
            for _ in range(200):
                if url_file.exists() and url_file.read_text():
                    return url_file.read_text()
                if process.poll() is not None:
                    raise RuntimeError((root / 'launcher.log').read_text()[-1500:])
                time.sleep(.05)
            raise RuntimeError('Launcher did not open a browser URL')
        stamp = time.monotonic()
        proc = launch()
        survivors = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(400)'])
        try:
            url = wait_url(proc)
            info = json.load(http.open(url.rsplit('/', 1)[0]+'/api/health', timeout=2))
            page = context.new_page()
            page.goto(url, wait_until='domcontentloaded')
            screen = page.locator('#nav [data-nav="screen"]')
            screen.wait_for()
            cold = time.monotonic()-stamp
            page.wait_for_timeout(4000)
            def snapshot():
                browser_pids = [p['id'] for p in cdp.send('SystemInfo.getProcessInfo')['processInfo']]
                return proc_sample([proc.pid, *browser_pids])
            before = snapshot()
            start = time.monotonic()
            page.wait_for_timeout(idle * 1000)
            after = snapshot()
            idle_cpu = sum(max(0, p['cpu']-before[i]['cpu']) for i,p in after.items() if i in before)/(time.monotonic()-start)
            tracked = list(after)
            screen_samples = []
            stop = threading.Event()
            def monitor():
                while not stop.wait(.025):
                    screen_samples.append(rss(proc_sample(tracked)))
            worker = threading.Thread(target=monitor)
            worker.start()
            try:
                screen.click()
                page.locator('#exportScreener').wait_for()
                with page.expect_download():
                    page.locator('#exportScreener').click()
            finally:
                stop.set()
                worker.join()
            stock = page.locator('#nav [data-nav="stock"]')
            stock.click()
            timings = []
            for code in ['2330','2404','2330','2404','2330']:
                begin = time.monotonic()
                page.locator('#stockCode').fill(code)
                page.locator('#goStock').click()
                page.locator('#stockTdccSummary').wait_for()
                timings.append(round(1000*(time.monotonic()-begin)))
            range_ms = {}
            for label in ['recent','all']:
                control = page.locator(f'[data-chart-range="{label}"]')
                if control.count():
                    begin = time.monotonic()
                    control.click()
                    range_ms[label] = round(1000*(time.monotonic()-begin))
            stock_rss = rss(snapshot())
            other = context.new_page()
            other.goto(url)
            page.reload()
            page.close(run_before_unload=True)
            other.wait_for_timeout(5000)
            assert proc.poll() is None and listening(18765), 'Service stopped with second window open'
            n = len(response_bytes)
            ended = time.monotonic()
            other.close(run_before_unload=True)
            proc.wait(timeout=165)
            close_secs = time.monotonic()-ended
            assert proc.returncode == 0 and not listening(18765) and survivors.poll() is None
            next_proc = launch()
            try:
                wait_url(next_proc)
                restart = context.new_page()
                restart.goto(url)
                restart.locator('#nav [data-nav="stock"]').wait_for()
                restart.close(run_before_unload=True)
                next_proc.wait(timeout=165)
                assert next_proc.returncode == 0 and not listening(18765)
            finally:
                if next_proc.poll() is None:
                    next_proc.terminate()
                    next_proc.wait()
            return {'platform': platform.platform(), 'python': platform.python_version(),
                    'chromium': chrome.version, 'logicalCpus': psutil.cpu_count(),
                    'systemRam': psutil.virtual_memory().total, 'version': info['appVersion'],
                    'zipBytes': package.stat().st_size, 'unpackedBytes': tree_bytes(files),
                    'network': 'loopback only; cold browser profile and app data',
                    'coldSeconds': cold, 'idleSampleSeconds': idle, 'idleCpuCorePercent': round(idle_cpu*100,2),
                    'idleCombinedRss': rss(after), 'idleProcesses': after,
                    'screenSamplePeakCombinedRss': max(screen_samples,default=None),
                    'postSwitchCombinedRss': stock_rss, 'stockSwitchMillis': timings,
                    'holdingHistoryRangeClickMillis':range_ms,
                    'requestsPerRouteIncludingRestart':dict(requests), 'httpResponseBytesBeforeClose':sum(response_bytes[:n]),
                    'appDataFilesAfterRestart':{str(p.relative_to(config)):p.stat().st_size for p in config.rglob('*') if p.is_file()},
                    'servicePid':proc.pid,'exitCode':proc.returncode,'closeSeconds':close_secs,
                    'port18765AfterClose':'released','unrelatedProcess':'alive','restartPid':next_proc.pid}
        finally:
            if proc.poll() is None:
                proc.terminate()
                proc.wait()
            survivors.terminate()
            survivors.wait()
            chrome.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('zip', type=Path)
    parser.add_argument('report', type=Path)
    parser.add_argument('--browser', default='/usr/bin/chromium')
    parser.add_argument('--idle', type=int, default=10)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as temp:
        report = benchmark(args.zip, args.browser, Path(temp), args.idle)
    args.report.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
