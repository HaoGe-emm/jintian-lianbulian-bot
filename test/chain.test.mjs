import test from 'node:test';
import assert from 'node:assert/strict';
import { readState,verifyDeposit,httpRpc,ei } from '../src/chain.mjs';
import { CONFIG as C } from '../src/config.mjs';
import { recordedRpc } from './helpers.mjs';
import { createHandler } from '../api/state.mjs';
test('real recorded deposit: missing transaction fields supplemented from full canonical block; exact receipts/events',async()=>{
  const v=await verifyDeposit(recordedRpc());assert.equal(v.verified,true);assert.equal(v.gasUsed,'126515');assert.equal(v.feeWei,'2530300000000000');
});
test('fixed block ledger reads expose 270/30/30/0 and invariant without synthetic fallback',async()=>{
  const s=await readState(recordedRpc());assert.equal(s.walletGYM,'270');assert.equal(s.credit,'30');assert.equal(s.allowance,'0');assert.deepEqual(s.accounting,['30','30','0','0','0']);assert.equal(s.origin,'botchain-mainnet');
});
for(const [label,mutate] of [
  ['failed receipt',(m,p,r)=>m==='eth_getTransactionReceipt'?{...r,status:'0x0'}:r],
  ['missing receipt',(m,p,r)=>m==='eth_getTransactionReceipt'?null:r],
  ['conflicting transaction nonce',(m,p,r)=>m==='eth_getTransactionByHash'?{...r,nonce:'0x8'}:r],
  ['wrong network',(m,p,r)=>m==='eth_chainId'?'0x7a69':r],
  ['canonical block conflict',(m,p,r)=>m==='eth_getBlockByNumber'&&p[1]===true?{...r,hash:'0x'+'ff'.repeat(32)}:r],
  ['missing events',(m,p,r)=>m==='eth_getTransactionReceipt'?{...r,logs:[]}:r],
  ['wrong emitter',(m,p,r)=>m==='eth_getTransactionReceipt'?{...r,logs:r.logs.map(x=>({...x,address:C.member}))}:r],
  ['wrong Deposited amount',(m,p,r)=>{if(m==='eth_getTransactionReceipt'){const e=ei.encodeEventLog(ei.getEvent('Deposited'),[C.member,60,1824089712]);r.logs[1].data=e.data;}return r;}],
  ['wrong Transfer amount',(m,p,r)=>{if(m==='eth_getTransactionReceipt')r.logs[0].data='0x'+'0'.repeat(62)+'1e'.replace('1e','1d');return r;}],
  ['wrong transaction target',(m,p,r)=>m==='eth_getTransactionByHash'?{...r,to:C.token}:r],
  ['wrong deposit calldata',(m,p,r)=>m==='eth_getTransactionByHash'?{...r,input:'0x1234'}:r],
])test('verification rejects '+label,async()=>{await assert.rejects(verifyDeposit(recordedRpc(mutate)));});
test('runtime code substitution and accounting deficit are rejected',async()=>{
  await assert.rejects(readState(recordedRpc((m,p,r)=>m==='eth_getCode'?'0x1234':r)),/代码/);
  await assert.rejects(readState(recordedRpc((m,p,r)=>m==='eth_call'&&p[0].data===ei.encodeFunctionData('getAccounting')?ei.encodeFunctionResult('getAccounting',[29,30,0,0,1]):r)),/账目/);
});
test('API accepts fixed GET only; no arbitrary RPC, address or write route',async()=>{
  const h=createHandler(recordedRpc());const res=await h(new Request('https://demo.test/api/state'));assert.equal(res.status,200);assert.equal((await res.json()).evidence.verified,true);
  assert.equal((await h(new Request('https://demo.test/api/state',{method:'POST'}))).status,405);
  assert.equal((await h(new Request('https://demo.test/api/state?rpc=other'))).status,400);
  const unavailable=createHandler(async()=>{throw Error('timeout');});const r=await unavailable(new Request('https://demo.test/api/state'));assert.equal(r.status,503);assert.equal((await r.json()).state,undefined);
});
test('HTTP transport rejects broadcast methods before network and fails closed on RPC errors',async()=>{
  let n=0;const rpc=httpRpc(async()=>{n++;return {ok:true,json:async()=>({error:{message:'bad'}})};});
  await assert.rejects(rpc('eth_send'+'Transaction',[]));assert.equal(n,0);await assert.rejects(rpc('eth_chainId',[]));assert.equal(n,1);
});
