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
async function page({unavailable=false,setup=()=>{},discoveryOnly=false,storage=new MemoryStorage(),fetchOverride}={}){
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element(m[1])]));
  const buttons=[...html.matchAll(/data-action="([^"]+)"/g)].map(m=>{const b=new Element(m[1]);b.dataset.action=m[1];return b;});
  const rpc=recordedRpc(),wallet=mockWallet(rpc);wallet.isMetaMask=true;
  const listeners=new Map();
  wallet.on=(name,handler)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(handler);};
  wallet.removeListener=(name,handler)=>listeners.get(name)?.delete(handler);
  wallet.emit=(name,payload)=>{for(const handler of listeners.get(name)??[])handler(payload);};
  setup(wallet);
  const window=new EventTarget();window.ethereum=discoveryOnly?{isMetaMask:false}:wallet;
  if(discoveryOnly)window.addEventListener('eip6963:requestProvider',()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{rdns:'io.metamask'},provider:wallet}})));
  const data={state:await readState(rpc),evidence:await verifyDeposit(rpc)};
  const context=vm.createContext({console,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,URL,AbortSignal,Event,setTimeout,clearTimeout,setInterval:()=>0,
    window,navigator:{locks:{request:async(n,o,fn)=>fn({})}},localStorage:storage,
    fetch:fetchOverride??(async()=>({ok:!unavailable,json:async()=>unavailable?{error:'RPC unavailable'}:data})),
    document:{getElementById:id=>elements.get(id),querySelectorAll:()=>buttons,createElement:()=>new Element('new')},
  });
  vm.runInContext(bundle.outputFiles[0].text,context);await settle();return {elements,buttons,wallet,window,listeners};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,25));
const assertNoSend=wallet=>assert.equal(wallet.calls.filter(c=>c.method==='eth_sendTransaction').length,0);
test('public UI displays live-labelled ledger and verified proof; visitor receives no wallet call and all writes locked',async()=>{
  const {elements:e,buttons,wallet}=await page();assert.equal(e.get('credit').textContent,'30 GYM');assert.match(e.get('proof-status').textContent,/重新核验/);assert.equal(e.get('deposit-link').href,`${C.explorer}/tx/${C.depositHash}`);
  assert.equal(wallet.calls.length,0);assert.ok(buttons.every(b=>b.disabled));
});
test('mock MetaMask member can preview refund; checkbox separate; no real wallet and no automatic send',async()=>{
  const {elements:e,buttons,wallet}=await page();await e.get('connect').onclick();await settle();const refund=buttons.find(b=>b.dataset.action==='refund');assert.equal(refund.disabled,false);
  assert.equal(buttons.find(b=>b.dataset.action==='request').disabled,true);await refund.onclick();assert.equal(e.get('review').open,true);assert.equal(e.get('send').disabled,true);assert.match(e.get('preview-data').textContent,/refund\(30\)/);
  e.get('confirmation').checked=true;e.get('confirmation').onchange();assert.equal(e.get('send').disabled,false);assert.equal(wallet.calls.filter(c=>c.method==='eth_sendTransaction').length,0);
});
test('API failure never populates invented balances or enables operations',async()=>{
  const {elements:e,buttons}=await page({unavailable:true});assert.equal(e.get('credit').textContent,'—');assert.match(e.get('read-status').textContent,/不提供模拟余额/);assert.ok(buttons.every(b=>b.disabled));assert.match(e.get('proof-status').textContent,/历史充值/);
});
test('viewing merchant tab does not grant merchant authority to connected member',async()=>{
  const {elements:e,buttons}=await page();await e.get('connect').onclick();e.get('merchant-tab').onclick();e.get('session').value='健身课001';e.get('session').oninput();assert.equal(e.get('merchant-panel').hidden,false);assert.equal(buttons.find(b=>b.dataset.action==='request').disabled,true);
});

test('EIP-6963 MetaMask connects despite another window.ethereum wallet; permission response updates header and role',async()=>{
  const {elements:e,wallet}=await page({discoveryOnly:true});
  assert.equal(wallet.calls.length,0);
  await e.get('connect').onclick();
  assert.match(e.get('connect').textContent,/演示会员/);
  assert.match(e.get('connection-summary').textContent,new RegExp(C.member));
  assert.equal(e.get('switch').hidden,true);assertNoSend(wallet);
});

test('accountsChanged selects merchant/member panels, matches addresses case-insensitively, and removes visitor permissions',async()=>{
  const {elements:e,buttons,wallet}=await page();await e.get('connect').onclick();
  e.get('session').value='训练课001';e.get('session').oninput();
  wallet.account=C.merchant.toLowerCase();wallet.emit('accountsChanged',[wallet.account]);
  assert.ok(buttons.every(b=>b.disabled));await settle();
  assert.match(e.get('connection-summary').textContent,/演示商家/);
  assert.equal(e.get('merchant-panel').hidden,false);assert.equal(e.get('member-panel').hidden,true);
  assert.equal(buttons.find(b=>b.dataset.action==='request').disabled,false);
  assert.equal(buttons.find(b=>b.dataset.action==='refund').disabled,true);
  wallet.account=C.member;wallet.emit('accountsChanged',[wallet.account]);await settle();
  assert.equal(e.get('member-panel').hidden,false);assert.equal(e.get('merchant-panel').hidden,true);
  wallet.account='0x'+'11'.repeat(20);wallet.emit('accountsChanged',[wallet.account]);await settle();
  assert.match(e.get('connection-summary').textContent,/访客钱包/);assert.ok(buttons.every(b=>b.disabled));assertNoSend(wallet);
});

test('wrong network keeps member identity visible; chainChanged invalidates review and restores permissions on 677',async()=>{
  const {elements:e,buttons,wallet}=await page({setup:w=>{w.chain='0x1';}});await e.get('connect').onclick();
  assert.match(e.get('wallet-status').textContent,/演示会员.*网络 1/);assert.equal(e.get('switch').hidden,false);assert.ok(buttons.every(b=>b.disabled));
  wallet.chain='0x2a5';wallet.emit('chainChanged',wallet.chain);await settle();
  const refund=buttons.find(b=>b.dataset.action==='refund');assert.equal(refund.disabled,false);await refund.onclick();
  assert.equal(e.get('review').open,true);
  wallet.chain='0x1';wallet.emit('chainChanged',wallet.chain);
  assert.equal(e.get('review').open,false);assert.equal(e.get('send').disabled,true);assert.ok(buttons.every(b=>b.disabled));
  await settle();assert.match(e.get('wallet-status').textContent,/演示会员/);assert.equal(e.get('switch').hidden,false);assertNoSend(wallet);
});

test('disconnect and empty account events clear role feedback and operation authority',async()=>{
  const {elements:e,buttons,wallet}=await page();await e.get('connect').onclick();
  wallet.emit('accountsChanged',[]);await settle();
  assert.match(e.get('connection-summary').textContent,/钱包未连接/);assert.equal(e.get('connect').textContent,'连接 MetaMask');assert.ok(buttons.every(b=>b.disabled));
  await e.get('connect').onclick();wallet.emit('disconnect',{code:4900});
  assert.match(e.get('connection-summary').textContent,/已断开/);assert.ok(buttons.every(b=>b.disabled));assertNoSend(wallet);
});

test('permission refusal and pending requests are visible and can be retried',async()=>{
  let failure=4001;
  const {elements:e,buttons,wallet}=await page({setup:w=>{
    const request=w.request.bind(w);w.request=async args=>{if(args.method==='eth_requestAccounts' && failure)throw Object.assign(Error('denied'),{code:failure});return request(args);};
  }});
  await e.get('connect').onclick();assert.match(e.get('connection-summary').textContent,/拒绝/);assert.ok(buttons.every(b=>b.disabled));
  failure=-32002;await e.get('connect').onclick();assert.match(e.get('connection-summary').textContent,/待处理请求/);
  failure=0;await e.get('connect').onclick();assert.match(e.get('connect').textContent,/演示会员/);assertNoSend(wallet);
});

test('blocked local storage does not prevent role display and still blocks business actions',async()=>{
  const {elements:e,buttons,wallet}=await page({storage:{getItem(){throw Error('storage blocked');}}});await e.get('connect').onclick();
  assert.match(e.get('connection-summary').textContent,/演示会员/);assert.match(e.get('history').textContent,/storage blocked/);
  assert.ok(buttons.every(b=>b.disabled));assertNoSend(wallet);
});

test('add-chain fallback explicitly switches after adding and updates UI without a chainChanged event',async()=>{
  let switches=0;
  const {elements:e,wallet}=await page({setup:w=>{
    w.chain='0x1';const request=w.request.bind(w);
    w.request=async args=>{
      if(args.method==='wallet_switchEthereumChain'){w.calls.push(args);if(++switches===1)throw Object.assign(Error('unknown chain'),{code:4902});w.chain='0x2a5';return null;}
      if(args.method==='wallet_addEthereumChain'){w.calls.push(args);return null;}
      return request(args);
    };
  }});await e.get('connect').onclick();await e.get('switch').onclick();
  assert.equal(switches,2);assert.equal(e.get('switch').hidden,true);assert.match(e.get('connection-summary').textContent,/BOT 677/);assertNoSend(wallet);
});

test('role feedback finishes while ledger API is still pending',async()=>{
  let finish;
  const {elements:e,wallet}=await page({fetchOverride:()=>new Promise(resolve=>{finish=resolve;})});
  await e.get('connect').onclick();assert.match(e.get('connect').textContent,/演示会员/);assert.equal(e.get('connect').disabled,false);
  assert.match(e.get('read-status').textContent,/正在只读查询/);assertNoSend(wallet);
  finish({ok:false,json:async()=>({error:'unavailable'})});await settle();
});

test('account switch while Gas quote is pending prevents stale review from reopening',async()=>{
  let finish;
  const {elements:e,buttons,wallet}=await page({setup:w=>{
    const request=w.request.bind(w);w.request=args=>args.method==='eth_estimateGas'?new Promise(resolve=>{finish=resolve;}):request(args);
  }});await e.get('connect').onclick();await settle();
  const pending=buttons.find(b=>b.dataset.action==='refund').onclick();
  while(!finish)await settle();
  wallet.account=C.merchant;wallet.emit('accountsChanged',[C.merchant]);await settle();
  wallet.account=C.member;wallet.emit('accountsChanged',[C.member]);await settle();finish('0x20000');await pending;
  assert.equal(e.get('review').open,false);assert.equal(e.get('send').disabled,true);assert.match(e.get('action-status').textContent,/状态已变化/);assertNoSend(wallet);
});
