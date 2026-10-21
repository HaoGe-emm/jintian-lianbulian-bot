import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { build } from 'esbuild';
import { readState,verifyDeposit } from '../src/chain.mjs';
import { CONFIG as C } from '../src/config.mjs';
import { mockWallet,recordedRpc,MemoryStorage } from './helpers.mjs';
const bundle=await build({entryPoints:[new URL('../src/main.mjs',import.meta.url).pathname.slice(process.platform==='win32'?1:0)],bundle:true,format:'iife',write:false,platform:'browser'});
class Element {
  constructor(id){this.id=id;this.textContent='';this.value='';this.dataset={};this.checked=false;this.disabled=true;this.hidden=false;this.children=[];this.attrs={};}
  setAttribute(k,v){this.attrs[k]=v;}replaceChildren(){this.children=[];this.textContent='';}append(x){this.children.push(x);}close(){this.open=false;}showModal(){this.open=true;}
}
async function page({unavailable=false}={}){
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element(m[1])]));
  const buttons=[...html.matchAll(/data-action="([^"]+)"/g)].map(m=>{const b=new Element(m[1]);b.dataset.action=m[1];return b;});
  const rpc=recordedRpc(),wallet=mockWallet(rpc);wallet.isMetaMask=true;wallet.on=()=>{};
  const data={state:await readState(rpc),evidence:await verifyDeposit(rpc)};
  const context=vm.createContext({console,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,URL,AbortSignal,setTimeout,clearTimeout,setInterval:()=>0,
    window:{ethereum:wallet},navigator:{locks:{request:async(n,o,fn)=>fn({})}},localStorage:new MemoryStorage(),
    fetch:async()=>({ok:!unavailable,json:async()=>unavailable?{error:'RPC unavailable'}:data}),
    document:{getElementById:id=>elements.get(id),querySelectorAll:()=>buttons,createElement:()=>new Element('new')},
  });
  vm.runInContext(bundle.outputFiles[0].text,context);await new Promise(r=>setTimeout(r,25));return {elements,buttons,wallet};
}
test('public UI displays live-labelled ledger and verified proof; visitor receives no wallet call and all writes locked',async()=>{
  const {elements:e,buttons,wallet}=await page();assert.equal(e.get('credit').textContent,'30 GYM');assert.match(e.get('proof-status').textContent,/重新核验/);assert.equal(e.get('deposit-link').href,`${C.explorer}/tx/${C.depositHash}`);
  assert.equal(wallet.calls.length,0);assert.ok(buttons.every(b=>b.disabled));
});
test('mock MetaMask member can preview refund; checkbox separate; no real wallet and no automatic send',async()=>{
  const {elements:e,buttons,wallet}=await page();await e.get('connect').onclick();const refund=buttons.find(b=>b.dataset.action==='refund');assert.equal(refund.disabled,false);
  assert.equal(buttons.find(b=>b.dataset.action==='request').disabled,true);await refund.onclick();assert.equal(e.get('review').open,true);assert.equal(e.get('send').disabled,true);assert.match(e.get('preview-data').textContent,/refund\(30\)/);
  e.get('confirmation').checked=true;e.get('confirmation').onchange();assert.equal(e.get('send').disabled,false);assert.equal(wallet.calls.filter(c=>c.method==='eth_sendTransaction').length,0);
});
test('API failure never populates invented balances or enables operations',async()=>{
  const {elements:e,buttons}=await page({unavailable:true});assert.equal(e.get('credit').textContent,'—');assert.match(e.get('read-status').textContent,/不提供模拟余额/);assert.ok(buttons.every(b=>b.disabled));assert.match(e.get('proof-status').textContent,/历史充值/);
});
test('viewing merchant tab does not grant merchant authority to connected member',async()=>{
  const {elements:e,buttons}=await page();await e.get('connect').onclick();e.get('merchant-tab').onclick();e.get('session').value='健身课001';e.get('session').oninput();assert.equal(e.get('merchant-panel').hidden,false);assert.equal(buttons.find(b=>b.dataset.action==='request').disabled,true);
});
