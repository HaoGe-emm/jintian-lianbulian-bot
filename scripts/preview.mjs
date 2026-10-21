import http from 'node:http';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHandler } from '../api/state.mjs';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const routes=new Map([['/','index.html'],['/index.html','index.html'],['/assets/app.js','assets/app.js'],['/assets/app.css','assets/app.css'],['/icon.svg','icon.svg'],['/evidence.json','evidence.json'],['/NOTICE.txt','NOTICE.txt'],['/THIRD_PARTY_NOTICES.txt','THIRD_PARTY_NOTICES.txt']]);
// The same standalone read-only HTTP transport is used locally and in Vercel.
const handler=createHandler();
export const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1');
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://rpc.botchain.ai; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'none'; object-src 'none'");
    if(url.pathname==='/api/state'){
      const response=await handler(new Request(url,{method:req.method}));res.statusCode=response.status;
      response.headers.forEach((v,k)=>res.setHeader(k,v));res.end(await response.text());return;
    }
    if(req.method!=='GET' || !routes.has(url.pathname) || url.search){res.writeHead(404);res.end('Not found');return;}
    const file=routes.get(url.pathname),type=file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.json')?'application/json':'text/plain';
    res.setHeader('Content-Type',`${type}; charset=utf-8`);res.setHeader('Cache-Control','no-store');res.end(await fs.readFile(root+file));
  }catch{res.writeHead(503);res.end('Preview temporarily unavailable');}
});
server.listen(8788,'127.0.0.1',()=>console.log('Public Demo preview: http://127.0.0.1:8788'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close(()=>process.exit(0));});
