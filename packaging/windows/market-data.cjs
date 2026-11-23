'use strict';
const {createHash}=require('node:crypto');
const venues=['TWSE','TPEx'];
const sources={
  TWSE:{list:'https://openapi.twse.com.tw/v1/opendata/t187ap03_L',day:'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'},
  TPEx:{list:'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O',day:'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'}
};
function historyURL(v,code,month){
  return v==='TWSE'?'https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date='+month.replace('-','')+'01&stockNo='+code+'&response=json':
    'https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code='+code+'&date='+month.replace('-','%2F')+'%2F01&id=&response=json';
}
function datedURL(v,day){
  return v==='TWSE'?'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date='+day.replaceAll('-','')+'&type=ALLBUT0999&response=json':
    'https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date='+day.replaceAll('-','%2F')+'&id=&response=json';
}
function check(ok,msg){if(!ok)throw Error(msg);}
function isoDate(raw){
  const str=String(raw??'').trim().replace(/[-/]/g,'');
  check(/^\d{7,8}$/.test(str),'行情日期格式錯誤 '+raw);
  const day=(Number(str.slice(0,-4))+(str.length===7?1911:0))+'-'+str.slice(-4,-2)+'-'+str.slice(-2);
  check(Number.isFinite(Date.parse(day))&&new Date(day).toISOString().slice(0,10)===day,'無效日期 '+day);
  return day;
}
const codeOK=x=>/^[1-9]\d{3}$/.test(x);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const numeric=s=>{const str=String(s??'').trim().replaceAll(',','');return /^\d+(\.\d+)?$/.test(str)?Number(str):NaN;};
function bar(o,h,l,c,volume,scale=1){
  if((numeric(volume)===0 && [o,h,l,c].some(n=>!Number.isFinite(numeric(n))||numeric(n)===0)) || [o,h,l,c].every(n=>/^(?:[-—－]*|0(?:\.0+)?)$/.test(String(n??'').trim())))return null;
  const [open,high,low,close,vol]=[o,h,l,c,volume].map(numeric);
  check([open,high,low,close].every(x=>x>0&&Number.isFinite(x))&&high>=Math.max(open,close,low)&&low<=Math.min(open,close)&&Number.isSafeInteger(vol*scale),'價量或 OHLC 關係無效');
  return [open,high,low,close,vol*scale];
}
function finish(rows,min){check(Object.keys(rows).length>=min,'市場覆蓋不足');return rows;}
function parseLatest(data,venue,kind,now,min=400){
  check(Array.isArray(data),'市場資料非清單');const rows={},seen=new Set();let day=null;
  for(const r of data){
    const isList=kind==='list',tw=venue==='TWSE';
    const code=String(isList?(r['公司代號']??r.SecuritiesCompanyCode??r.CompanyCode):tw?r.Code:r.SecuritiesCompanyCode).trim();
    if(!codeOK(code))continue;
    const stamp=isoDate(r['出表日期']??r['資料日期']??r.Date);
    check(stamp<=now.slice(0,10)&&(!day||stamp===day)&&!seen.has(code),'市場日期混雜、重複或在未來');day=stamp;seen.add(code);
    if(isList){
      const name=r['公司簡稱']??r.CompanyAbbreviation??r.CompanyName??r['公司名稱'];
      check(typeof name==='string'&&name.trim(),'公司簡稱缺漏');rows[code]=name.trim();
    }else{
      const price=tw?bar(r.OpeningPrice,r.HighestPrice,r.LowestPrice,r.ClosingPrice,r.TradeVolume):
        bar(r.Open,r.High,r.Low,r.Close,r.TradingShares);
      if(price)rows[code]=price;
    }
  }
  return {day,rows:finish(rows,min)};
}
function fields(table,aliases){
  const names=table.fields.map(f=>String(f).replace(/\s/g,''));
  return aliases.map(group=>{const idx=names.findIndex(f=>group.includes(f));check(idx>=0,'找不到官方欄位 '+group[0]);return idx;});
}
const priceFields=[['開盤價','開盤'],['最高價','最高'],['最低價','最低'],['收盤價','收盤']];
function parseHistory(data,venue,code,month,now){
  check(data.stat==='OK'||data.stat==='ok','官方查無個股月行情 '+month);
  const t=data.tables?.[0]||data;
  const meta=[data.title,t.title,t.subtitle,data.stockNo,data.code,...Object.values(t).filter(x=>typeof x==='string')].join(' ');
  check(meta.includes(code)||String(data.stockNo||data.code)===code,'回應股票代號待核 '+code);
  const i=fields(t,[['日期'],...priceFields,['成交股數','成交張數','成交仟股']]);
  const scale=String(t.fields[i[5]]).includes('股數')?1:1000,rows={};let last='';
  for (const row of t.data){
    const [date,...values]=i.map(j=>row[j]);const day=isoDate(date);
    check(day.startsWith(month+'-')&&day<=now.slice(0,10)&&day>last,'個股行情錯月、重複或倒序');last=day;
    const prices=bar(...values,scale);if(prices)rows[day]=prices;
  }
  check(Object.keys(rows).length,'當月無有效成交');return rows;
}
function parseDated(data,venue,expected,min=400){
  check(String(data.stat).toUpperCase()==='OK'&&isoDate(data.date)===expected,'全市場回補日期不符 '+expected);
  const tables=data.tables||[data];
  const t=tables.find(x=>x.fields?.some(f=>['開盤價','開盤'].includes(f))&&x.fields.some(f=>['證券代號','代號'].includes(f)));
  check(t,'缺少日行情表');
  const indices=fields(t,[['證券代號','代號'],...priceFields,['成交股數','成交量']]);const rows={},seen=new Set();
  for(const row of t.data){const [code,...values]=indices.map(i=>String(row[i]).trim());if(!codeOK(code))continue;
    check(!seen.has(code),'重複代號 '+code);seen.add(code);
    const p=bar(...values);if(p)rows[code]=p;
  }
  return {day:expected,rows:finish(rows,min)};
}
function validateMarket(packet){
  check(venues.includes(packet.venue)&&['list','day','history'].includes(packet.kind)&&/^https:\/\//.test(packet.url)&&/^[a-f0-9]{64}$/.test(packet.hash)&&Number.isFinite(Date.parse(packet.fetched)),'市場來源證據無效');
  check(packet.rows&&Object.keys(packet.rows).length,'市場內容空白');
  for(const [key,val] of Object.entries(packet.rows)){
    if(packet.kind==='history'){isoDate(key);check(Number.isFinite(Date.parse(val.known))&&/^[a-f0-9]{64}$/.test(val.hash),'個股可用時點無效');bar(...val.p);}
    else {check(codeOK(key),'代號無效');if(packet.kind==='list')check(typeof val==='string'&&val.length,'名稱無效');else bar(...val);}
  }
}
module.exports={venues,sources,historyURL,datedURL,parseLatest,parseHistory,parseDated,validateMarket,codeOK,isoDate,sha};
