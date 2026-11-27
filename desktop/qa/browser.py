"""Exercise the packaged local page and file entry. Requires playwright + Chromium."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('url')
parser.add_argument('light', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--chromium')
args = parser.parse_args()
args.output.mkdir(exist_ok=True, parents=True)
with sync_playwright() as driver:
    browser = driver.chromium.launch(executable_path=args.chromium)
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda exc: errors.append(str(exc)))
    page.goto(args.url)
    page.get_by_role('button', name='更新市場資料').click()
    page.wait_for_function("!document.querySelector('#refreshTDCC').disabled", timeout=150000)
    print('market', page.locator('#feedPanel').inner_text(), flush=True)
    page.screenshot(path=args.output / 'market.png')
    with page.expect_download() as download:
        page.get_by_role('button', name='匯出輕量資料').click()
    path = args.output / 'snapshot.json'
    download.value.save_as(path)
    snapshot = json.loads(path.read_bytes())
    assert len(snapshot['stocks']) >= 1900
    for nav in ('screen','stock','backtest','peak','settings','software','data'):
        page.locator('[data-nav="'+nav+'"]').first.click()
        assert page.locator('#page').inner_text().strip()
    page.locator('[data-nav="stock"]').first.click()
    page.locator('#overlayK').check()
    assert page.get_by_role('img', name='集保持股與日 K').locator('rect').count() >= 3
    page.screenshot(path=args.output / 'overlay.png')
    reader = browser.new_page()
    reader.on('pageerror', lambda exc: errors.append(str(exc)))
    reader.goto(args.light.resolve().as_uri())
    reader.locator('#file').set_input_files(path)
    reader.locator('#results').wait_for()
    assert reader.locator('#stocks option').count() == len(snapshot['stocks'])
    reader.locator('#filter').select_option('pass')
    assert reader.locator('#stocks option').count() == sum(r['pass'] for r in snapshot['stocks'])
    reader.locator('#filter').select_option('all')
    for code in ('2330','2404','6261'):
        reader.locator('#query').fill(code)
        assert reader.locator('#stocks').input_value() == code
        record = next(r for r in snapshot['stocks'] if r['code'] == code)
        assert record['name'] in reader.locator('#title').inner_text()
    reader.locator('#query').fill('2404')
    before = reader.locator('#chart').inner_html()
    assert '開 ' in before
    for invalid in (b'{}', b'{"format":"chip-radar-light","version":0}'):
        reader.locator('#file').set_input_files({'name':'bad.json','mimeType':'application/json','buffer':invalid})
        reader.wait_for_function("document.querySelector('#status').textContent.includes('匯入失敗')")
        assert reader.locator('#chart').inner_html() == before
    reader.screenshot(path=args.output / 'light.png')
    print('snapshot', path.stat().st_size, 'rows', len(snapshot['stocks']), 'latest', snapshot['dates'][-1], 'market',snapshot['market'])
    assert not errors, errors
