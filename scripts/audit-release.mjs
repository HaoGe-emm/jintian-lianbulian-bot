import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const skip=new Set(['node_modules','dist','.git','.vercel']);
const allowedRoots=new Set(['src','api','scripts','contracts','data','test','package.json','package-lock.json','index.html','icon.svg','README.md','NOTICE.md','THIRD_PARTY_NOTICES.md','ACCEPTANCE.md','vercel.json','.gitattributes','.gitignore','.vercelignore']);
const files=[];
async function walk(dir,rel=''){
  for(const item of await fs.readdir(dir,{withFileTypes:true})){
    if(!rel && skip.has(item.name))continue;
    if(!rel && !allowedRoots.has(item.name))throw Error(`Unexpected release entry: ${item.name}`);
    const r=path.posix.join(rel,item.name),full=path.join(dir,item.name);
    if(item.isSymbolicLink())throw Error(`Symlink forbidden: ${r}`);
    if(item.isDirectory()){await walk(full,r);continue;}
    if(/(^|\/)(\.env|work|reports|tool|.*approval.*local|.*journal.*json)(\/|$)/i.test(r))throw Error(`Private file forbidden: ${r}`);
    const content=await fs.readFile(full),s=content.toString();
    if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:private[_-]?key|mnemonic|seed[_-]?phrase)\s*[:=]\s*['"][^'"]{12,}/i.test(s))throw Error(`Possible secret material: ${r}`);
    if(/(?:\b[A-Za-z]:[\\/]|file:\x2f{3})/.test(s))throw Error(`Machine-specific absolute path forbidden: ${r}`);
    const forbidden=['eth_send'+'RawTransaction','eth_sign'+'Transaction','eth_sign'+'TypedData','personal'+'_sign'];
    if(forbidden.some(x=>s.includes(x)))throw Error(`Unexpected signing/broadcast API: ${r}`);
    files.push({path:r,bytes:content.length,sha256:createHash('sha256').update(content).digest('hex')});
  }
}
await walk(root);
const output=await fs.readdir(path.join(root,'dist'));
const allowedOutput=['NOTICE.txt','THIRD_PARTY_NOTICES.txt','assets','evidence.json','icon.svg','index.html'];
if(output.some(x=>!allowedOutput.includes(x)))throw Error('Unexpected public build output');
const js=await fs.readFile(path.join(root,'dist/assets/app.js'),'utf8');
if(/deployment-approval|member-approval|member-journal|\/api\/journal|\/api\/approval|enable:deposit/.test(js))throw Error('Private admin code leaked into bundle');
console.log(JSON.stringify({ok:true,scope:'public-demo only; parent workspace excluded',files},null,2));
