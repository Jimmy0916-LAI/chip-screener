"""Extra acceptance cases against the extracted v0.6.5 EXE's local UI."""
import csv
import json
import os
from pathlib import Path

from playwright.sync_api import expect


def verify_v065(browser, url, output, errors):
    context = browser.new_context()
    page = context.new_page()
    page.on('pageerror', lambda exc: errors.append(str(exc)))
    assert page.goto(url).ok

    def go(nav):
        page.locator(f'[data-nav="{nav}"]').first.click()

    expect(page.locator('#feedDay')).not_to_have_text('—')
    days = page.evaluate("""() => D.sessions.filter(day =>
        Date.parse(day + 'T13:30:00+08:00') <= Date.now()).slice(-35)""")
    assert len(days) == 35
    cache = Path(os.environ['LOCALAPPDATA']) / 'ChipScreener/daily-cache-v1'
    cache.mkdir(parents=True, exist_ok=True)
    bars = [[day, price, price, price, price] for day, price in zip(days, [100]*34 + [110])]
    (cache / '2404.json').write_text(json.dumps({
        'code': '2404', 'source': 'synthetic QA fixture', 'fetched': days[-1] + 'T13:30:00+08:00', 'bars': bars,
    }), encoding='utf-8')

    go('settings')
    page.locator('#signalMacd').check()
    page.locator('#signalBreakout').check()
    lookback = page.locator('#signalLookback')
    lookback.fill('18')
    lookback.press('Tab')
    page.locator('#signalMode').select_option('any')
    page.locator('#savePreset').click()
    page.locator('.preset-dialog input').fill('固定多條件組合')
    page.locator('.preset-dialog').get_by_role('button', name='儲存').click()
    page.locator('#applySetting').click()
    expect(page.locator('#signalCoverage')).to_contain_text('任一符合')
    expect(page.locator('#signalCoverage')).to_contain_text(days[-1])
    page.locator('#searchCode').fill('2404')
    row = page.locator('tr[data-stock="2404"]')
    expect(row).to_contain_text('突破前 N 日高點｜通過')
    expect(row).to_contain_text('MACD 黃金交叉｜通過')
    expect(row).to_contain_text('大股東連續增持｜資料不足')
    with page.expect_download() as export:
        page.locator('#exportScreener').click()
    with export.value.path().open(encoding='utf-8-sig', newline='') as handle:
        exported = list(csv.DictReader(handle))
    assert len(exported) == 1 and exported[0]['code'] == '2404'
    assert exported[0]['state'] == '通過'
    assert exported[0]['signal_mode'] == 'any' and exported[0]['signal_date'] == days[-1]
    assert [r['state'] for r in json.loads(exported[0]['signal_conditions'])] == ['unknown','pass','pass']
    page.screenshot(path=output / 'v065-signal-csv.png')

    go('settings')
    page.locator('#signalMode').select_option('all')
    page.locator('#applySetting').click()
    page.locator('#filterPass').select_option('all')
    expect(row).to_contain_text('資料不足')
    expect(page.locator('#signalCoverage')).to_contain_text('全部符合')
    go('settings')
    page.get_by_role('row').filter(has_text='固定多條件組合').get_by_role('button').click()
    expect(page.locator('#signalMode')).to_have_value('any')
    expect(page.locator('#signalLookback')).to_have_value('18')
    expect(page.locator('#signalMacd')).to_be_checked()
    page.reload()
    go('settings')
    expect(page.locator('#signalLookback')).to_have_value('18')
    expect(page.locator('#signalMacd')).to_be_checked()
    print('065-S01–04 EXE: synthetic OHLC hits, missing TDCC, all/any, named strategy reload, matching CSV', flush=True)

    go('software')
    page.locator('#swAiProvider').select_option('deepseek')
    page.locator('#swAiEnabled').uncheck()
    for provider in ('gemini', 'deepseek', 'claude', 'openai'):
        page.locator(f'[data-ai-model="{provider}"]').fill('qa-model-' + provider)
        page.locator(f'[data-ai-key="{provider}"]').fill('qa-only-key-' + provider)
    for feature in ('briefing', 'channels', 'trader'):
        page.locator(f'[data-ai-feature="{feature}"]').uncheck()
    with page.expect_response(lambda res: res.request.method == 'POST' and res.url.endswith('/api/software/ai')) as saved:
        page.locator('#swSaveAiSettings').click()
    assert saved.value.ok
    state = saved.value.json()
    assert state['provider'] == 'deepseek' and state['enabled'] is False
    assert not any(state['features'].values()) and all(state['keys'].values())
    assert 'qa-only-key-' not in json.dumps(state)
    page.reload()
    go('software')
    expect(page.locator('#swAiProvider')).to_have_value('deepseek')
    expect(page.locator('#swAiEnabled')).not_to_be_checked()
    expect(page.locator('#swAiSettings')).to_contain_text('AI 模擬操盤')
    expect(page.locator('#swAiVideo')).to_contain_text('字幕或文字')
    page.screenshot(path=output / 'v065-ai-settings.png')

    go('briefing')
    page.locator('#briefingSettingsBtn, #toggleBriefingSettings').first.click()
    expect(page.locator('[data-ai-status="disabled"]').first).to_be_visible()
    page.screenshot(path=output / 'v065-briefing.png')
    page.locator('[data-briefing-tab=channels]').click()
    expect(page.locator('[data-ai-status="disabled"]').first).to_be_visible()
    page.screenshot(path=output / 'v065-channels.png')
    go('paper')
    expect(page.locator('#page')).to_contain_text('操盤')
    page.screenshot(path=output / 'v065-paper.png')
    print('065-A01–05 EXE: provider/model/switch persistence and module entry points', flush=True)
    context.close()
