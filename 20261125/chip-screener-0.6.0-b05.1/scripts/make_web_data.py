"""從凍結驗收原檔生成離線網頁資料。輸出只含可追溯欄位。"""
import csv, gzip, io, json, pathlib
ROOT=pathlib.Path(__file__).resolve().parent
RUN='20261120T021433143982'
META=json.loads((ROOT/'evidence/runs'/f'{RUN}.json').read_text(encoding='utf-8'))

def raw(key):
 return gzip.decompress((ROOT/'evidence/raw'/f"{META[key]['sha256']}.gz").read_bytes())

market=json.loads(raw('行情備份'))['symbols']
# 2026-11-13 的行情備份是研究時使用的範圍，不是逐日歷史上市母體
names={k:[v.get('name',''),v.get('market','')] for k,v in market.items()
       if len(k)==4 and k[0]!='0' and v.get('market') in ('TWSE','TPEx')}
series={}
quality={}
for key in META:
 if not key.startswith('TDCC_'): continue
 day=key[5:]
 bycode={}
 for r in csv.DictReader(io.StringIO(raw(key).decode('utf-8-sig'))):
  code=r['證券代號'].strip()
  if code not in names: continue
  if r['資料日期']!=day.replace('-',''): continue
  lvl=int(r['持股分級']); bycode.setdefault(code,{})[lvl]=[int(r['股數']),int(r['人數'])]
 valid={}; bad=0; missing=0
 for code,r in bycode.items():
  if set(r)!=set(range(1,18)): missing+=1; continue
  den,holders=r[17]
  if den<=0 or any(n<0 or h<0 for n,h in r.values()) or sum(r[i][0] for i in range(1,17))!=den or sum(r[i][1] for i in range(1,16))!=holders:
   bad+=1; continue
  sums=lambda lo,hi,idx:sum(r[i][idx] for i in range(lo,hi+1))
  # den,h,tier shares x4, tier holders x4
  valid[code]=[den,holders,*[sums(lo,hi,0) for lo,hi in [(11,15),(12,15),(13,15),(15,15)]],*[sums(lo,hi,1) for lo,hi in [(11,15),(12,15),(13,15),(15,15)]]]
 series[day]=valid
 quality[day]={'valid':len(valid),'excludedIncompleteOrInvalid':len(bycode)-len(valid),'incomplete':missing,'invalid':bad,'raw_source':META[key]['sha256']}

P=ROOT/'reports'/RUN
def table(filename):
 with (P/filename).open(encoding='utf-8-sig',newline='') as f: return list(csv.DictReader(f))
daily=[]
for r in table('daily_2404.csv'):
 daily.append([r['date'],float(r['open']),float(r['high']),float(r['low']),float(r['close']),int(r['volume_shares']),int(r['issued_shares']),float(r['turnover']),r['event_cash'],r['strict_eod']=='True'])
report=json.loads((P/'result.json').read_text(encoding='utf-8'))
out={'run':RUN,'dates':sorted(series),'observed':report['week_evidence']['known'],'quality':quality,
     'stocks':names,'series':series,'daily2404':daily,'marketNote':'2026-11-13 行情備份中非 0 開頭四碼上市櫃候選母體，非歷史逐日正式股票池',
     'verified2404':report['weekly'],'sourceSha256':META['行情備份']['sha256']}
p=(ROOT/'web_data.json');p.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print('Web source:',p,'size',p.stat().st_size,'quality',quality,'names',len(names),'daily',len(daily))
