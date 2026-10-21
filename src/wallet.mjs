import { formatEther, id } from 'ethers';
import { CONFIG as C, eq, q, demand } from './config.mjs';
import { ei, ti, includedTransaction, matchingEvents, readState } from './chain.mjs';
const KEY = 'gym-bot677-business-v1';
export const TTL = 60000;
const SPECS = {
  request: { role:'merchant',method:'requestConsumption',event:'ConsumptionRequested' },
  confirm: { role:'member',method:'confirmConsumption',event:'ConsumptionConfirmed' },
  reject: { role:'member',method:'rejectConsumption',event:'ConsumptionRejected' },
  cancel: { role:'merchant',method:'cancelConsumption',event:'ConsumptionCancelled' },
  refund: { role:'member',method:'refund',event:'Refunded' },
  withdraw: { role:'merchant',method:'withdraw',event:'Withdrawn' },
};
export function actionPlan(action,state,session='') {
  const spec = SPECS[action]; demand(spec,'此版本不提供授权、充值或部署操作');
  demand(state?.chainId === 677 && state.origin === 'botchain-mainnet', '需要最新主网状态');
  const now=state.timestamp, r=state.request;
  let args;
  if(action === 'request') {
    demand(BigInt(state.credit)>=30n && BigInt(state.validUntil)>BigInt(now),'会员额度不足或卡已过期');
    demand(!r || r.expiresAt<=now,'已有待处理核销申请');
    demand(/^[\p{L}\p{N} _-]{3,60}$/u.test(session),'请输入 3–60 字的课程标识（字母、数字、空格或 - _）');
    args=[C.member,id(session.normalize('NFC'))];
  } else if(['confirm','reject','cancel'].includes(action)) {
    demand(r?.status === 1 && eq(r.user,C.member),'没有可处理的会员核销申请');
    if(action === 'confirm') demand(r.expiresAt>now && BigInt(state.validUntil)>BigInt(now) && BigInt(state.credit)>=30n,'申请已过期或额度不足');
    args=[r.id];
  } else if(action === 'refund') {
    demand(BigInt(state.credit)>=30n,'可退款额度不足 30 GYM'); args=[30];
  } else {
    demand(BigInt(state.revenue)>=30n && eq(state.payout,C.merchant),'可提现不足 30 GYM 或收款地址已变更'); args=[30];
  }
  return { action,method:spec.method,event:spec.event,from:C[spec.role],to:C.escrow,chainId:'0x2a5',value:'0x0',
    data:ei.encodeFunctionData(spec.method,args),args:args.map(String),session };
}
export class WalletActions {
  constructor({wallet,readRpc,storage,clock=()=>Date.now()}) {
    Object.assign(this,{wallet,readRpc,storage,clock}); this.preview=null; this.busy=false;
  }
  invalidate() { this.preview=null; }
  journal() {
    const raw=this.storage.getItem(KEY); if(!raw) return [];
    const data=JSON.parse(raw); demand(Array.isArray(data) && data.every(x=>x.chainId===677 && eq(x.to,C.escrow) && ['reviewing','pending','unknown','verified','failed','rejected'].includes(x.phase)), '本机交易记录损坏；停止写入，请保留记录排查'); return data;
  }
  save(rows) { this.storage.setItem(KEY,JSON.stringify(rows)); }
  locked() { return this.journal().some(x=>['reviewing','pending','unknown'].includes(x.phase)); }
  async context(from) {
    demand(BigInt(await this.wallet.request({method:'eth_chainId'}))===677n,'请切换 BOT Chain 677');
    demand(eq((await this.wallet.request({method:'eth_accounts'}))[0],from),'当前钱包无此操作权限');
  }
  async quote(action,session='') {
    demand(!this.busy && !this.locked(),'已有提交中或状态未知的交易，先只读恢复'); this.invalidate();
    const state=await readState(this.readRpc), plan=actionPlan(action,state,session);
    await this.context(plan.from);
    const latest=await this.wallet.request({method:'eth_getTransactionCount',params:[plan.from,'latest']});
    const pending=await this.wallet.request({method:'eth_getTransactionCount',params:[plan.from,'pending']});
    demand(BigInt(latest)===BigInt(pending),'钱包有待确认交易，请先处理');
    if(action==='request') {
      const used=await this.readRpc('eth_call',[{to:C.escrow,data:ei.encodeFunctionData('usedSessionKeys',plan.args)},'latest']);
      demand(!ei.decodeFunctionResult('usedSessionKeys',used)[0],'该课程标识已使用');
    }
    const tx={from:plan.from,to:plan.to,data:plan.data,value:plan.value};
    const gas=BigInt(await this.wallet.request({method:'eth_estimateGas',params:[tx]}));
    const price=BigInt(await this.wallet.request({method:'eth_gasPrice'})),limit=(gas*120n+99n)/100n;
    const bot=BigInt(await this.wallet.request({method:'eth_getBalance',params:[plan.from,'latest']}));
    demand(gas>0n && price>0n && bot>=limit*price,'BOT Gas 余额不足或报价无效');
    await this.context(plan.from);
    const preview={plan,nonce:q(latest),gas:gas.toString(),limit:limit.toString(),price:price.toString(),
      fee:formatEther(gas*price),cap:formatEther(limit*price),expires:this.clock()+TTL};
    this.preview=preview; return preview;
  }
  async submit(confirmed) {
    const p=this.preview;
    demand(confirmed && p && this.clock()<p.expires,'请获取有效 Gas 预览并主动勾选确认');
    demand(!this.busy && !this.locked(),'存在未解决的交易'); this.busy=true;
    let row, persisted=false;
    try {
      await this.context(p.plan.from);
      const state=await readState(this.readRpc),fresh=actionPlan(p.plan.action,state,p.plan.session);
      demand(fresh.data===p.plan.data,'业务状态已改变，请重新预览');
      for(const tag of ['latest','pending']) demand(BigInt(await this.wallet.request({method:'eth_getTransactionCount',params:[p.plan.from,tag]}))===BigInt(p.nonce),'钱包 nonce 已变化，请重新预览');
      const gas=BigInt(await this.wallet.request({method:'eth_estimateGas',params:[{from:p.plan.from,to:C.escrow,data:p.plan.data,value:'0x0'}]}));
      demand(gas<=BigInt(p.limit),'Gas 已超出预览上限，请重新预览');
      demand(BigInt(await this.wallet.request({method:'eth_getBalance',params:[p.plan.from,'latest']}))>=BigInt(p.limit)*BigInt(p.price),'BOT 余额不足');
      await this.context(p.plan.from); demand(this.clock()<p.expires,'Gas 预览已过期');
      row={...p.plan,chainId:677,nonce:p.nonce,phase:'reviewing',createdAt:new Date(this.clock()).toISOString()};
      const rows=this.journal(); rows.push(row); this.save(rows); persisted=true; // Failure to persist prevents submission.
      let hash;
      try { hash=await this.wallet.request({method:'eth_sendTransaction',params:[{from:row.from,to:row.to,data:row.data,value:'0x0',chainId:'0x2a5',nonce:row.nonce,gas:q(p.limit),gasPrice:q(p.price)}]}); }
      catch(error) { row.phase=error.code===4001?'rejected':'unknown'; row.error=error.code===4001?'用户拒绝':'钱包响应不明确，仅可只读恢复'; this.update(row); throw error; }
      demand(/^0x[0-9a-fA-F]{64}$/.test(hash),'钱包未返回可核验 Hash，保留锁定');
      row.hash=hash; row.phase='pending'; this.update(row); return row;
    } catch(error) {
      if(persisted && row?.phase==='reviewing') { row.phase='unknown'; this.update(row); }
      throw error;
    } finally { this.busy=false; this.invalidate(); }
  }
  update(row) {
    const rows=this.journal(),i=rows.findIndex(x=>x.from===row.from && x.nonce===row.nonce && x.createdAt===row.createdAt);
    demand(i>=0,'原交易记录缺失'); rows[i]=row; this.save(rows);
  }
  async recover(hash=null) {
    const row=this.journal().find(x=>['pending','unknown','reviewing'].includes(x.phase));
    demand(row,'没有待恢复的交易');
    const candidate=row.hash ?? hash;
    demand(/^0x[0-9a-fA-F]{64}$/.test(candidate??''),'请输入钱包中该笔交易的 Hash；不得重试发送');
    const {tx,receipt}=await includedTransaction(this.readRpc,candidate);
    demand(eq(tx.from,row.from) && eq(tx.to,row.to) && BigInt(tx.nonce)===BigInt(row.nonce) && eq(tx.input??tx.data,row.data),'恢复交易与原操作不一致');
    const events=matchingEvents(receipt,C.escrow,ei,row.event);
    demand(events.length===1,'业务事件缺失或不唯一');
    const a=events[0].args;
    if(row.action==='request') demand(eq(a[1],C.member) && eq(a[2],row.args[1]) && a[3]===30n,'申请事件不匹配');
    else if(['confirm','reject','cancel'].includes(row.action)) {
      demand(a[0]===BigInt(row.args[0]) && eq(a[1],C.member),'核销事件不匹配');
      if(row.action==='confirm') demand(a[2]===30n && eq(a[3],C.member),'消费确认人或额度错误');
    } else if(row.action==='refund') demand(eq(a[0],C.member) && a[1]===30n,'退款事件不匹配');
    else demand(eq(a[0],C.merchant) && eq(a[1],C.merchant) && a[2]===30n,'提现事件不匹配');
    if(['refund','withdraw'].includes(row.action)) {
      const transfers=matchingEvents(receipt,C.token,ti,'Transfer');
      demand(transfers.length===1 && eq(transfers[0].args[0],C.escrow) && eq(transfers[0].args[1],row.from) && transfers[0].args[2]===30n,'退款或提现的 Token Transfer 不匹配');
    }
    const state=await readState(this.readRpc);
    const canonical=await this.readRpc('eth_getBlockByNumber',[receipt.blockNumber,false]);
    demand(eq(canonical?.hash,receipt.blockHash),'恢复核验期间出现区块冲突，保留锁定');
    row.hash=candidate;row.phase='verified';row.blockNumber=Number(BigInt(receipt.blockNumber));row.verifiedAt=new Date().toISOString();
    this.update(row); return {row,state};
  }
}
