"""Use the full Windows UI and cross-check its downloaded CSV row by row."""
import csv
import hashlib
import json
from pathlib import Path

from playwright.sync_api import expect

# Exported from B04.2 run 45007997573 artifact 14748364432.
B042_REFERENCE_SHA256 = '3ed14dca5efcc5c8e43447fe14f5995c62495931950105f0c87bfa18ee3ae35a'
REFERENCE_KEYS = ('code', 'window', 'as_of', 'reason', 'band', 'state',
                  'total_pp', 'weekly_changes', 'weekly_shares', 'known_by', 'data_version')


def digest_reference(rows):
    canonical = [[row[key] for key in REFERENCE_KEYS] for row in sorted(rows, key=lambda row: row['code'])]
    return hashlib.sha256(json.dumps(canonical, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def inspect_screen(page, out, name, expected_week=None, fixed=False, all_pages=False, usable=True):
    page.locator('#nav [data-nav=screen]').click()
    page.locator('#searchCode').fill('')
    page.locator('#filterPass').select_option('all')
    if expected_week:
        page.locator('#windowSelect').select_option(expected_week)
    day = page.locator('#windowSelect').input_value()
    visible_counts = [int(s.replace(',', '')) for s in page.locator('#page .metric .value').all_text_contents()[:3]]
    with page.expect_download() as observed:
        page.locator('#exportScreener').click()
    path = out / f'{name}.csv'
    observed.value.save_as(path)
    with path.open(encoding='utf-8-sig', newline='') as stream:
        rows = list(csv.DictReader(stream))
    by_code = {row['code']: row for row in rows}
    all_codes = page.evaluate('() => [...D.universe].sort()')
    assert sorted(by_code) == all_codes and len(rows) == len(by_code) == 1985
    passed = sum(row['state'] == '通過' for row in rows)
    unknown = sum(row['state'] == '資料不足' for row in rows)
    failed = len(rows) - passed - unknown
    assert visible_counts == [passed, failed, unknown]
    assert {row['window'] for row in rows} == {day}
    if usable:
        assert day and 0 < passed + failed
    else:
        assert passed == failed == 0 and unknown == 1985
    if fixed:
        assert [passed, failed, unknown] == [268, 1692, 25]
        assert digest_reference(rows) == B042_REFERENCE_SHA256
        assert by_code['2330']['weekly_shares'] == '-37973336|-10706718'

    page.screenshot(path=out / f'{name}.png')
    if all_pages:
        visible = {}
        while True:
            entries = page.locator('#page tbody tr[data-stock]').evaluate_all("""rows => rows.map(row => [
                row.dataset.stock, row.cells[7].querySelector('.tag').textContent.trim(),
                row.cells[7].querySelector('small').textContent.trim()
            ])""")
            for code, state, reason in entries:
                assert code not in visible, code
                visible[code] = (state, reason)
            if page.locator('#nextPage').is_disabled():
                break
            page.locator('#nextPage').click()
        assert visible == {row['code']: (row['state'], row['reason']) for row in rows}
    report = {'case':name, 'day':day, 'total':len(rows), 'pass':passed, 'fail':failed, 'unknown':unknown,
              'reference':digest_reference(rows), 'csvSha256':hashlib.sha256(path.read_bytes()).hexdigest(),
              'notice':page.locator('#weekSelection').inner_text()}
    print('Market screen:', json.dumps(report, ensure_ascii=False), flush=True)
    return report


def inventory(page, url, label, out):
    cache = page.request.get(url + '/api/official/read').json()
    prices = page.request.get(url + '/api/signals/prices').json()
    bundled = page.evaluate("""() => ({
        chartOnly:Object.keys(D.tdccChartHistory || {}),
        active:dates(), universe:D.universe.length, calendar:D.sessions.at(-1)
    })""")
    result = {
        'label':label, 'bundled':bundled,
        'onlineWeeks': {day:packet['quality'] for day,packet in cache['weeks'].items()},
        'market': {key:dict(day=p['day'], fetched=p.get('fetched'), source=p.get('source'), coverage=len(p['rows']))
                   for key,p in cache['market'].items()},
        'daily': {code:dict(fromDay=packet['bars'][0][0], through=packet['bars'][-1][0], fetched=packet.get('fetched'))
                  for code,packet in prices.items() if packet['bars']}
    }
    (out / f'{label}-data.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print('Data inventory:', json.dumps(result, ensure_ascii=False), flush=True)
    return result
