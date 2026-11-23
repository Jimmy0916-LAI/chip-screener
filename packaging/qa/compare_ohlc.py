"""Independent, date-keyed comparison of rendered candles with official monthly reports."""
import hashlib,json,time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from urllib.request import Request,urlopen
out=Path('evidence')
charts=json.loads((out/'market-overlay-gui.json').read_text(encoding='utf8'))['snapshots']['charts']
def compare(code):
    earliest,latest=(charts[code+'-all']['days'][i] for i in (0,-1))
    month=earliest[:7]
    official={}
    receipts=[]
    while month<=latest[:7]:
        url=(f"https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date={month.replace('-','')}01&stockNo={code}&response=json" if code=='2404'
             else f"https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code={code}&date={month.replace('-','%2F')}%2F01&id=&response=json")
        for attempt in range(3):
            try:
                with urlopen(Request(url,headers={'User-Agent':'ChipScreener-Evidence/0.6'}),timeout=95) as response: body=response.read()
                data=json.loads(body.decode('utf-8-sig')); table=data if code=='2404' else data['tables'][0]
                if not table.get('data'):raise ValueError('No official history')
                break
            except Exception:
                if attempt==2:raise
                time.sleep(3+attempt)
        assert code in (table['title']+' '+table.get('subtitle',''))
        for row in table['data']:
            year,m,d=map(int,row[0].split('/'));day=date(year+1911,m,d).isoformat()
            if str(row[3]).strip() in ('','--','---','----','0.00'):continue
            nums=[float(str(x).replace(',','')) for x in row[3:7]]
            assert day.startswith(month) and day not in official
            official[day]=nums
        receipts.append(dict(url=url,sha256=hashlib.sha256(body).hexdigest()))
        y,m=map(int,month.split('-'));month=f'{y+(m==12):04}-{m%12+1:02}'
    counts={}
    for rg in ('all','recent'):
        chart=charts[code+'-'+rg];start,end=chart['days'][0],chart['days'][-1]
        expected={d:p for d,p in official.items() if start<=d<=end}
        assert expected==chart['bars'],(code,rg,sorted(expected.keys()^chart['bars'].keys()),[(d,p,chart['bars'].get(d)) for d,p in expected.items() if chart['bars'].get(d)!=p][:4])
        counts[rg]={'first':start,'last':end,'matched':len(expected),'final':sorted(expected.items())[-1]}
    return code,dict(comparisons=counts,sources=receipts)
with ThreadPoolExecutor(2) as executor:
    result=dict(executor.map(compare,['2404','6488']))
(out/'official-ohlc-comparison.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
print('Official OHLC exact match',json.dumps({k:v['comparisons'] for k,v in result.items()}))
