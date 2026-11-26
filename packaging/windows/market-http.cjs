'use strict';
const https=require('node:https');
const zlib=require('node:zlib');

// A slow, progressing bulk response is different from an idle connection.
function exchangeBytes(url){
  return new Promise((resolve,reject)=>{
    const request=https.get(url,{agent:false,headers:{Accept:'application/json','Accept-Encoding':'gzip, deflate',Connection:'close','User-Agent':'ChipScreener/0.6'}},response=>{
      if(response.statusCode!==200){response.resume();reject(Error('官方 HTTP '+response.statusCode));return;}
      const encoding=response.headers['content-encoding'];
      let stream=response;
      if(encoding==='gzip')stream=response.pipe(zlib.createGunzip());
      else if(encoding==='deflate')stream=response.pipe(zlib.createInflate());
      else if(encoding&&encoding!=='identity'){request.destroy(Error('未知行情壓縮格式'));return;}
      const parts=[];let size=0;
      response.once('error',reject);stream.once('error',reject);
      stream.on('data',part=>{
        size+=part.length;
        if(size>24*1024*1024){stream.destroy();request.destroy(Error('行情回應過大'));reject(Error('行情回應過大'));}
        else parts.push(part);
      });
      stream.once('end',()=>{if(!response.complete)reject(Error('行情回應中斷'));else resolve(Buffer.concat(parts));});
    });
    request.setTimeout(90000,()=>request.destroy(Error('行情來源超過 90 秒無回應')));
    const timer=setTimeout(()=>request.destroy(Error('行情下載超過 6 分鐘')),360000);
    request.once('error',reject);request.once('close',()=>clearTimeout(timer));
  });
}
module.exports={exchangeBytes};
