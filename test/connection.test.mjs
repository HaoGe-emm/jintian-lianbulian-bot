import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WalletConnection } from '../src/connection.mjs';
import { CONFIG as C } from '../src/config.mjs';
function provider(account=C.member){
  return Object.assign(new EventEmitter(),{account,chain:'0x2a5',calls:[],async request({method}){
    this.calls.push(method);
    if(method==='eth_accounts' || method==='eth_requestAccounts')return [this.account];
    if(method==='eth_chainId')return this.chain;
    throw Error('Unexpected wallet call: '+method);
  }});
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('permission response is authoritative even if immediate eth_accounts is stale',async()=>{
  const wallet=provider(),request=wallet.request.bind(wallet);wallet.request=args=>args.method==='eth_accounts'?Promise.resolve([]):request(args);
  const connection=new WalletConnection(()=>{});await connection.connect(wallet);
  assert.equal(connection.state.account,C.member);assert.ok(!wallet.calls.includes('eth_accounts'));
});

test('late account/network responses cannot overwrite a newer account event',async()=>{
  const wallet=provider(),connection=new WalletConnection(()=>{});await connection.connect(wallet);
  let resolveOld;const request=wallet.request.bind(wallet);
  wallet.request=args=>args.method==='eth_chainId'?new Promise(resolve=>{resolveOld=resolve;}):request(args);
  wallet.emit('accountsChanged',[C.member]);
  assert.equal(connection.state.account,null);
  wallet.request=request;wallet.account=C.merchant;wallet.emit('accountsChanged',[C.merchant]);await tick();
  assert.equal(connection.state.account,C.merchant);
  resolveOld('0x1');await tick();assert.equal(connection.state.account,C.merchant);assert.equal(connection.state.chainId,677);
});

test('repeated connect attaches one listener; replacing provider detaches old events and uses new provider',async()=>{
  const first=provider(),second=provider(C.merchant),connection=new WalletConnection(()=>{});
  await connection.connect(first);await connection.connect(first);assert.equal(first.listenerCount('accountsChanged'),1);
  await connection.connect(second);assert.equal(first.listenerCount('accountsChanged'),0);
  first.emit('accountsChanged',[]);await tick();assert.equal(connection.state.account,C.merchant);
  assert.equal(second.listenerCount('chainChanged'),1);
});

test('disconnect during permission prompt prevents its late response from restoring connection',async()=>{
  const wallet=provider(),connection=new WalletConnection(()=>{});let finish;
  wallet.request=()=>new Promise(resolve=>{finish=resolve;});
  const pending=connection.connect(wallet);wallet.emit('disconnect');finish([C.member]);await pending;
  assert.equal(connection.state.account,null);assert.match(connection.state.error.message,/已断开/);
});

test('account event during permission prompt supersedes its stale response',async()=>{
  const wallet=provider(),request=wallet.request.bind(wallet),connection=new WalletConnection(()=>{});let finish;
  wallet.request=args=>args.method==='eth_requestAccounts'?new Promise(resolve=>{finish=resolve;}):request(args);
  const pending=connection.connect(wallet);wallet.account=C.merchant;wallet.emit('accountsChanged',[C.merchant]);await tick();
  finish([C.member]);await pending;assert.equal(connection.state.account,C.merchant);
});
