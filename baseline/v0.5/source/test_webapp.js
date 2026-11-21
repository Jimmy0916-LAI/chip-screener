const fs=require('fs'),vm=require('vm'),assert=require('assert');
let contents={};let events={};const element=id=>contents[id]||(contents[id]={innerHTML:'',textContent:'',value:'',classList:{add(){},remove(){}},style:{},setSelectionRange(){},focus(){}});
const doc={querySelector:s=>element(s),body:{addEventListener(k,f){events[k]=f}},createElement:()=>({click(){},remove(){}})};
const ctx=vm.createContext({INITIAL_DATA:JSON.parse(fs.readFileSync(__dirname+'/web_data.json','utf8')),document:doc,window:{addEventListener(){}},localStorage:{getItem(){return null},setItem(){}},scrollTo(){},setTimeout(){},URL:{createObjectURL(){},revokeObjectURL(){}},Blob:function(){},prompt(){},console,Date,Math,Number,String,Object,Array,Set,Map,JSON,Error});
vm.runInContext(fs.readFileSync(__dirname+'/app.js','utf8'),ctx,{timeout:12000});
function val(expr){return vm.runInContext(expr,ctx,{timeout:12000})}
assert(val(`state.page`)==='home');
assert(contents['#page'].innerHTML.includes('全市場'));
assert(val(`dates().length`)===6);
assert(val(`D.daily2404.length`)===697);
let original=val(`calculate('2404','400',windows(2).at(-1),DEFAULT)`);
assert(original.status==='通過');assert(Math.abs(original.gain-0.721971163)<1e-8);
assert(original.deltaShares[0]===796897&&original.deltaShares[1]===579084);
assert(val(`calculate('2404','200',windows(2).at(-1),DEFAULT).status`)==='比例未連升');
assert(val(`calculate('2404','1000',windows(2).at(-1),{...DEFAULT,weeklyMin:.05}).status`)==='每週增幅不足');
for(const p of ['screen','stock','backtest','peak','settings','data']){
 const html=val(`(state.page='${p}',render(),document.querySelector('#page').innerHTML)`);
 assert(html.length>1000,p+' render unexpectedly tiny');
 console.log(p,'rendered',html.length,'chars');
}
console.log('all-market latest pass',val(`tally(scan()).pass`),'candidate',val('scan().length'));
console.log('2404 signal OK',original.gain,original.deltaShares);
console.log('all 7 routes passed.');
