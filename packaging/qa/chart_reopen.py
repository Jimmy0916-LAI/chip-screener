"""Read SVG geometry from the shipped desktop app, then repeat after offline restart."""
import json,math,socket,subprocess,sys,time
from pathlib import Path
from playwright.sync_api import sync_playwright

exe=Path(sys.argv[1]).resolve()
phase=sys.argv[2]
out=Path('evidence');out.mkdir(exist_ok=True)
with socket.socket() as sock:
    sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
app=subprocess.Popen([str(exe),'--remote-debugging-address=127.0.0.1',f'--remote-debugging-port={port}'])
try:
    with sync_playwright() as pw:
        deadline=time.monotonic()+90
        while True:
            try:
                browser=pw.chromium.connect_over_cdp(f'http://127.0.0.1:{port}',timeout=3000)
                break
            except Exception:
                if time.monotonic()>=deadline:raise
                time.sleep(.5)
        page=browser.contexts[0].pages[0]
        page.wait_for_selector('#feedDay',timeout=60000)
        page.wait_for_function("document.querySelector('#feedDay').textContent>'2026-11-13' && checkedAt && !feedBusy",timeout=180000)
        page.locator('#nav [data-nav=stock]').click()
        page.locator('[data-chart-range=recent]').click()
        records={}
        for code in ['2404','6488']:
            page.locator('#stockCode').fill(code);page.locator('#goStock').click()
            page.locator('#overlay').check()
            page.wait_for_function("code=>state.stock===code && chartCache.has(chartRequest().key) && !chartCache.get(chartRequest().key).busy && document.querySelectorAll('#combinedPlot [data-bar]').length>5",arg=code,timeout=275000)
            points=page.locator('#combinedPlot [data-bar]').evaluate_all("""groups=>groups.map(g=>{
              const l=g.querySelector('line'),r=g.querySelector('rect');
              return {day:g.dataset.bar,p:g.dataset.ohlc.split(',').map(Number),y:[+l.getAttribute('y1'),+l.getAttribute('y2'),+r.getAttribute('y'),+r.getAttribute('height')],known:g.textContent.split('已證可用 ').pop()};
            })""")
            prices=[v for b in points for v in b['p'][1:3]]
            lo,hi=min(prices),max(prices);pad=max(.1,(hi-lo)*.1)
            def y(n):return 220-(n-lo+pad)/(hi-lo+2*pad)*195
            for point in points:
                o,h,l,c=point['p'];expected=[y(h),y(l),min(y(o),y(c)),max(.8,abs(y(c)-y(o)))]
                assert all(math.isclose(a,b,abs_tol=1e-7) for a,b in zip(expected,point['y'])),(code,point)
            records[code]=points
            page.locator('#combinedPlot').screenshot(path=str(out/f'{phase}-{code}.png'))
        if phase=='offline':
            assert records==json.loads((out/'online.json').read_text(encoding='utf8'))
        (out/f'{phase}.json').write_text(json.dumps(records,ensure_ascii=False),encoding='utf8')
        print(phase,'real wick/body geometry and provenance',[(c,len(p)) for c,p in records.items()])
        browser.close()
finally:
    if app.poll() is None:subprocess.run(['taskkill','/PID',str(app.pid),'/T','/F'],capture_output=True)
