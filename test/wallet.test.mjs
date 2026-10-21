import test from 'node:test';
import assert from 'node:assert/strict';
import { WalletActions,actionPlan,TTL } from '../src/wallet.mjs';
import { CONFIG as C } from '../src/config.mjs';
import { readState,ei,ti } from '../src/chain.mjs';
import { recordedRpc,mockWallet,MemoryStorage } from './helpers.mjs';
function setup(){const rpc=recordedRpc(),wallet=mockWallet(rpc),storage=new MemoryStorage();let now=1000;return {rpc,wallet,storage,advance:()=>now+=TTL+1,tool:new WalletActions({wallet,readRpc:rpc,storage,clock:()=>now})};}
test('no wallet calls on construction; quote never sends; exact refund30 reviewed only on explicit submit',async()=>{
  const {wallet,tool}=setup();assert.equal(wallet.calls.length,0);const p=await tool.quote('refund');assert.equal(p.plan.data,ei.encodeFunctionData('refund',[30]));assert.equal(wallet.calls.some(c=>c.method==='eth_sendTransaction'),false);
  await assert.rejects(tool.submit(false));assert.equal(wallet.calls.some(c=>c.method==='eth_sendTransaction'),false);
  const row=await tool.submit(true);assert.equal(row.phase,'pending');assert.equal(row.nonce,'0x2');assert.equal(tool.locked(),true);
  assert.equal(wallet.calls.filter(c=>c.method==='eth_sendTransaction').length,1);await assert.rejects(tool.quote('refund'),/未知/);
});
for(const variant of ['wrong account','wrong chain','pending nonce','expired gas','unknown transaction','storage failure'])test(variant+' blocks submission',async()=>{
  const {wallet,tool,advance,storage}=setup();
  if(variant==='wrong account'){wallet.account=C.merchant;await assert.rejects(tool.quote('refund'),/权限/);}
  if(variant==='wrong chain'){wallet.chain='0x1';await assert.rejects(tool.quote('refund'),/677/);}
  if(variant==='pending nonce'){wallet.pending='0x3';await assert.rejects(tool.quote('refund'),/待确认/);}
  if(variant==='expired gas'){await tool.quote('refund');advance();await assert.rejects(tool.submit(true),/有效/);}
  if(variant==='unknown transaction'){await tool.quote('refund');wallet.sendError=Error('timeout');await assert.rejects(tool.submit(true));assert.equal(tool.journal()[0].phase,'unknown');await assert.rejects(tool.quote('refund'));}
  if(variant==='storage failure'){await tool.quote('refund');storage.setItem=()=>{throw Error('quota');};await assert.rejects(tool.submit(true),/quota/);}
  assert.equal(wallet.calls.filter(c=>c.method==='eth_sendTransaction').length,variant==='unknown transaction'?1:0);
});
test('wallet refusal is recorded, not silently retried; nonce or account change after preview blocks send',async()=>{
  const {tool,wallet}=setup();await tool.quote('refund');wallet.sendError=Object.assign(Error('rejected'),{code:4001});await assert.rejects(tool.submit(true));assert.equal(tool.journal()[0].phase,'rejected');assert.equal(tool.locked(),false);
  wallet.sendError=null;await tool.quote('refund');wallet.nonce='0x3';await assert.rejects(tool.submit(true),/nonce/);assert.equal(wallet.calls.filter(x=>x.method==='eth_sendTransaction').length,1);
});
test('all role plans are bound to fixed escrow, member and amount; completed approve/deposit/deploy absent',async()=>{
  const s=await readState(recordedRpc());
  for(const op of ['approve','deposit','deploy','transfer'])assert.throws(()=>actionPlan(op,s),/不提供/);
  assert.equal(actionPlan('request',s,'体能课 001').from,C.merchant);
  assert.throws(()=>actionPlan('confirm',s),/没有/);assert.throws(()=>actionPlan('withdraw',s),/不足/);
  assert.throws(()=>actionPlan('refund',{...s,credit:'0'}),/不足/);
  const active={...s,request:{id:'1',status:1,user:C.member,expiresAt:s.timestamp+100}};
  assert.equal(actionPlan('confirm',active).data,ei.encodeFunctionData('confirmConsumption',[1]));
  assert.throws(()=>actionPlan('request',active,'体能课 002'),/待处理/);
  assert.throws(()=>actionPlan('confirm',{...active,request:{...active.request,expiresAt:0}}),/过期/);
});
test('unknown transaction recovery rejects unrelated existing deposit and keeps original lock',async()=>{
  const {tool,wallet}=setup();await tool.quote('refund');wallet.sendError=Error('timeout');await assert.rejects(tool.submit(true));
  await assert.rejects(tool.recover(C.depositHash),/原操作/);assert.equal(tool.locked(),true);
});
test('offline fake wallet business recovery verifies exact nonce/input/events and retains transaction history',async()=>{
  const rpc=recordedRpc(),wallet=mockWallet(rpc),storage=new MemoryStorage();
  const hash=wallet.sendHash,baseReceipt=await rpc('eth_getTransactionReceipt',[C.depositHash]);
  const data=ei.encodeFunctionData('refund',[30]);
  const receipt={...baseReceipt,transactionHash:hash,logs:[]};
  for(const [address,iface,name,args] of [[C.token,ti,'Transfer',[C.escrow,C.member,30]],[C.escrow,ei,'Refunded',[C.member,30]]]){
    const encoded=iface.encodeEventLog(iface.getEvent(name),args);
    receipt.logs.push({...baseReceipt.logs[0],address,transactionHash:hash,logIndex:'0x'+receipt.logs.length,topics:encoded.topics,data:encoded.data});
  }
  const block=await rpc('eth_getBlockByNumber',[receipt.blockNumber,true]);
  const transaction={...block.transactions[0],hash,from:C.member,to:C.escrow,input:data,nonce:'0x2'};
  let mode='good';
  const businessRpc=async(m,p=[])=>{
    if(m==='eth_getTransactionReceipt')return {...receipt,status:mode==='failed'?'0x0':'0x1',logs:mode==='missing'?[]:receipt.logs};
    if(m==='eth_getTransactionByHash')return transaction;
    if(m==='eth_getBlockByNumber'&&p[0]===receipt.blockNumber)return {...block,transactions:[transaction]};
    return rpc(m,p);
  };
  const tool=new WalletActions({wallet,readRpc:businessRpc,storage});
  await tool.quote('refund');await tool.submit(true);mode='failed';await assert.rejects(tool.recover());assert.equal(tool.locked(),true);
  mode='missing';await assert.rejects(tool.recover());assert.equal(tool.locked(),true);
  mode='good';const recovered=await tool.recover();assert.equal(recovered.row.phase,'verified');assert.equal(recovered.row.hash,hash);assert.equal(tool.journal().length,1);assert.equal(tool.locked(),false);
});
