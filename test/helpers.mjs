import fs from 'node:fs';
import { ti,ei } from '../src/chain.mjs';
import { CONFIG as C, eq } from '../src/config.mjs';
export const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/mainnet-reads.json',import.meta.url)));
export function recordedRpc(mutate=(m,p,r)=>r) {
  return async(method,params=[])=>{
    let result;
    if(method==='eth_call') {
      const iface=eq(params[0].to,C.token)?ti:ei, parsed=iface.parseTransaction({data:params[0].data});
      if(parsed.name==='name')result=ti.encodeFunctionResult('name',['Gym Demo Credit']);
      else if(parsed.name==='symbol')result=ti.encodeFunctionResult('symbol',['GYM']);
      else if(parsed.name==='activeRequest')result=ei.encodeFunctionResult('activeRequest',[0]);
      else if(parsed.name==='usedSessionKeys')result=ei.encodeFunctionResult('usedSessionKeys',[false]);
    }
    if(result===undefined){
      const candidates=fixture.calls.filter(c=>c.request.method===method);
      let match=candidates.findLast(c=>JSON.stringify(c.request.params).toLowerCase()===JSON.stringify(params).toLowerCase());
      if(!match && method==='eth_call')match=candidates.findLast(c=>eq(c.request.params[0].to,params[0].to)&&eq(c.request.params[0].data,params[0].data));
      if(!match)throw Error('Unrecorded offline test call: '+method+' '+JSON.stringify(params));
      result=match.result;
    }
    return mutate(method,params,structuredClone(result));
  };
}
export class MemoryStorage {
  data=new Map();getItem(k){return this.data.get(k)??null;}setItem(k,v){this.data.set(k,v);}
}
export function mockWallet(rpc=recordedRpc(),account=C.member){
  const calls=[];
  return {calls,account,chain:'0x2a5',nonce:'0x2',pending:'0x2',sendHash:'0x'+'ab'.repeat(32),
    async request({method,params=[]}){
      calls.push({method,params});
      if(method==='eth_accounts' || method==='eth_requestAccounts')return [this.account];
      if(method==='eth_chainId')return this.chain;
      if(method==='eth_getTransactionCount')return params[1]==='pending'?this.pending:this.nonce;
      if(method==='eth_estimateGas')return '0x20000';
      if(method==='eth_gasPrice')return '0x4a817c800';
      if(method==='eth_getBalance')return '0xde0b6b3a7640000';
      if(method==='eth_sendTransaction'){if(this.sendError)throw this.sendError;return this.sendHash;}
      return rpc(method,params);
    }
  };
}
