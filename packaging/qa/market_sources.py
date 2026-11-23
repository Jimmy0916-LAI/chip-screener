"""Inspect the official response schema and date without printing the full dataset."""
import json
from urllib.request import Request,urlopen
urls=[
'https://openapi.twse.com.tw/v1/opendata/t187ap03_L',
'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O',
'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes',
'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
'https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=6488&date=2026%2F11%2F01&id=&response=json',
'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=20261120&type=ALLBUT0999&response=json',
'https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=2026%2F11%2F20&id=&response=json']
def inspect(url):
 try:
  with urlopen(Request(url,headers={'User-Agent':'ChipScreener/0.6'}),timeout=35) as f: raw=f.read()
  data=json.loads(raw.decode('utf-8-sig'))
  if isinstance(data,list): info=[len(data),data[0]]
  else: info=[{k:v for k,v in data.items() if k not in ('tables','data','notes')},[
   [{k:v for k,v in t.items() if k not in ('data','notes','hints')}, t.get('data',[[]])[0]] for t in data.get('tables',[]) if t.get('data') and (len(t['data'])>30 or 'tradingStock' in url)]]
  print(url,repr(info)[:4800],flush=True)
 except Exception as e: print(url,repr(e),flush=True)
if __name__=='__main__':
 from concurrent.futures import ThreadPoolExecutor
 with ThreadPoolExecutor(4) as pool:list(pool.map(inspect,urls))
