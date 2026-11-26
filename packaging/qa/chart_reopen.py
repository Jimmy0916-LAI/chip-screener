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
        def until(fn,seconds):
            deadline=time.monotonic()+seconds
            while not fn():
                if time.monotonic()>deadline:raise TimeoutError(page.locator('#page').inner_text()[:1500])
                time.sleep(.35)
        until(lambda:page.locator('#feedDay').inner_text()>'2026-11-13' and ('有新資料' in page.locator('#feedStatus').inner_text() or '離線' in page.locator('#feedStatus').inner_text() or '已是最新' in page.locator('#feedStatus').inner_text()),180)
        if phase=='offline':
            until(lambda:'離線' in page.locator('#feedStatus').inner_text(),120)
        page.locator('#nav [data-nav=stock]').click()
        page.locator('[data-chart-range=recent]').click()
        records={}
        for code in ['2404','6488']:
            page.locator('#stockCode').fill(code);page.locator('#goStock').click()
            page.locator('#overlay').check()
            def chart_ready():
                return (code in page.locator('#page h1').inner_text() and
                        '讀取官方行情中' not in page.locator('#combinedPlot').inner_text() and
                        page.locator('#combinedPlot [data-bar]').count()>5)
            until(chart_ready,275)
            points=[]
            for group in page.locator('#combinedPlot [data-bar]').all():
                wick,body=group.locator('line'),group.locator('rect')
                points.append(dict(day=group.get_attribute('data-bar'),p=list(map(float,group.get_attribute('data-ohlc').split(','))),
                                   y=[float(el.get_attribute(attr)) for el,attr in [(wick,'y1'),(wick,'y2'),(body,'y'),(body,'height')]],
                                   known=group.locator('title').text_content().split('已證可用 ')[-1]))
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
