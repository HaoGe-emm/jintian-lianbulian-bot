import { formatEther, formatUnits } from 'ethers';
import { CONFIG as C, eq } from './config.mjs';
import { WalletActions, actionPlan } from './wallet.mjs';
const $=id=>document.getElementById(id);
const text=(id,value)=>{$(id).textContent=value;};
let state=null,account=null,wallet=null,actions=null,refreshing=false;
function link(id,url,label){$(id).href=url;$(id).textContent=label;}
link('deposit-link',`${C.explorer}/tx/${C.depositHash}`,`${C.depositHash} ↗`);
link('token-link',`${C.explorer}/address/${C.token}`,`GymToken · ${C.token} ↗`);
link('escrow-link',`${C.explorer}/address/${C.escrow}`,`GymEscrow · ${C.escrow} ↗`);
text('member-address',C.member);text('merchant-address',C.merchant);
function errorText(error){return error.code===4001?'你已拒绝钱包请求；没有继续执行后续交易。':String(error.shortMessage??error.message??error).slice(0,220);}
function displayHistory(){
  $('history').replaceChildren();
  try {
    const rows=actions?.journal()??[];
    if(!rows.length) text('history','尚无本机业务交易。原充值证据在下方单独展示。');
    for(const row of rows){
      const p=document.createElement('p');p.textContent=`${row.method} · nonce ${row.nonce} · ${row.phase} `;
      if(row.hash){const a=document.createElement('a');a.textContent=`${row.hash} ↗`;a.href=`${C.explorer}/tx/${row.hash}`;a.target='_blank';a.rel='noopener noreferrer';p.append(a);}
      $('history').append(p);
    }
  } catch(error){text('history',errorText(error));}
}
function enableActions(){
  for(const b of document.querySelectorAll('[data-action]')){
    try {
      if(!state || !actions || !navigator.locks) throw Error('只读模式');
      if(Date.now()-Date.parse(state.readAt)>60000 || actions.busy || actions.locked()) throw Error('需要刷新或恢复');
      const plan=actionPlan(b.dataset.action,state,$('session').value);
      if(!eq(account,plan.from)) throw Error('角色不匹配');
      b.disabled=false;
    } catch {b.disabled=true;}
  }
}
async function refresh(){
  if(refreshing)return;refreshing=true;$('refresh').disabled=true;state=null;enableActions();
  text('read-status','正在只读查询 BOT Chain 677…');
  try{
    const res=await fetch('/api/state',{cache:'no-store',signal:AbortSignal.timeout(120000)}),data=await res.json();
    if(!res.ok || data.state?.chainId!==677 || data.state.origin!=='botchain-mainnet' || !data.evidence?.verified) throw Error(data.error??'主网数据不可核验');
    state=data.state;
    for(const [id,key] of [['wallet-gym','walletGYM'],['credit','credit'],['revenue','revenue'],['allowance','allowance'],['total-credit','totalUserCredit']])text(id,state[key]+' GYM');
    text('assets',state.accounting[0]+' GYM');text('payout',state.payout);text('bot-balance',formatEther(state.botWei)+' BOT');
    text('valid-until',Number(state.validUntil)?new Date(Number(state.validUntil)*1000).toLocaleString('zh-CN'):'尚未开卡');
    text('invariant',`资产 ${state.accounting[0]} = 托管 ${state.accounting[1]} + 收入 ${state.accounting[2]} + 额外资产 ${state.accounting[3]}；缺口 ${state.accounting[4]} GYM`);
    text('fund-explanation',`已核验的充值把 30 GYM 从会员转入此托管合约。当前合约资产为 ${state.accounting[0]} GYM，其中全部会员托管额度 ${state.totalUserCredit} GYM，商家已确认收入 ${state.revenue} GYM，额外资产 ${state.accounting[3]} GYM。演示会员尚可使用 ${state.credit} GYM。商家申请核销本身不产生收入；只有会员确认才转为可提现额度。资产覆盖当前账面负债，不代表线下履约有保证；后续退款或消费会改变当前数值。`);
    text('read-status',`BOT Chain 677 · 区块 ${state.blockNumber} · 读取于 ${new Date(state.readAt).toLocaleString('zh-CN')} · 数据有效期 60 秒`);$('read-status').className='status';
    text('proof-status',`已从主网重新核验：成功回执、规范区块、deposit(30)、Deposited 与 Transfer 均匹配。${new Date(data.evidence.checkedAt).toLocaleString('zh-CN')}`);
    text('request-status',state.request?`核销申请 #${state.request.id} · 30 GYM · ${new Date(state.request.expiresAt*1000).toLocaleString('zh-CN')} 到期${state.request.expiresAt<=state.timestamp?'（已过期，可拒绝或由商家撤销）':''}`:'当前没有待处理的核销申请。商家可为演示会员申请单次训练。');
  } catch(error){
    for(const id of ['wallet-gym','credit','revenue','assets','allowance','total-credit','payout','bot-balance','invariant','valid-until'])text(id,'—');
    text('read-status',errorText(error)+' 当前账目未获取，不提供模拟余额。');$('read-status').className='status error';
    text('request-status','当前核销申请读取失败；业务操作暂不可用。');
    text('fund-explanation','当前主网账目未读取，不能判断最新资金去向。历史充值凭据仍可通过下方 BOTScan 链接独立查看。');
    text('proof-status','历史充值已于 2026-10-21 独立核验；本次实时复核不可用。可打开 BOTScan 与公开核验摘要自行检查。');
  } finally{refreshing=false;$('refresh').disabled=false;enableActions();}
}
function reset(){actions?.invalidate();$('confirmation').checked=false;$('send').disabled=true;$('review').close();enableActions();}
async function walletContext(){
  account=(await wallet.request({method:'eth_accounts'}))[0]??null;
  const correct=BigInt(await wallet.request({method:'eth_chainId'}))===677n;
  text('wallet-status',account?`${eq(account,C.member)?'演示会员':eq(account,C.merchant)?'演示商家':'访客钱包（无本项目业务权限）'} · ${account} · ${correct?'BOT 677':'网络不匹配'}`:'钱包已断开 · 只读模式');
  $('switch').hidden=correct;
  if(!correct)account=null;
  displayHistory();enableActions();
}
$('connect').onclick=async()=>{
  try{
    // Prefer MetaMask if multiple injected wallets are present. No request occurs on page load.
    wallet=window.ethereum?.providers?.find(p=>p.isMetaMask)??window.ethereum;
    if(!wallet?.isMetaMask)throw Error('未找到 MetaMask。请在装有 MetaMask 的浏览器中打开；也可继续只读参观。');
    await wallet.request({method:'eth_requestAccounts'});
    if(!actions){
      actions=new WalletActions({wallet,readRpc:(method,params=[])=>wallet.request({method,params}),storage:localStorage});
      wallet.on?.('accountsChanged',()=>{reset();walletContext().catch(e=>text('wallet-status',errorText(e)));});
      wallet.on?.('chainChanged',()=>{reset();walletContext().catch(e=>text('wallet-status',errorText(e)));});
    }
    await walletContext();text('action-status',navigator.locks?'请先选业务操作并查看 Gas；每笔交易均需独立确认。':'此浏览器不支持跨标签页交易锁；为防止重复提交，仅提供只读查看。请使用当前版本 Chrome 或 Edge。');
  }catch(error){text('wallet-status',errorText(error));}
};
$('switch').onclick=async()=>{
  try{
    reset();
    try{await wallet.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x2a5'}]});}
    catch(e){if(e.code!==4902)throw e;await wallet.request({method:'wallet_addEthereumChain',params:[{chainId:'0x2a5',chainName:'BOT Chain Mainnet',nativeCurrency:{name:'BOT',symbol:'BOT',decimals:18},rpcUrls:[C.rpc],blockExplorerUrls:[C.explorer]}]});}
    await walletContext();
  }catch(error){text('wallet-status',errorText(error));}
};
for(const role of ['member','merchant'])$(role+'-tab').onclick=()=>{
  for(const r of ['member','merchant']){$(r+'-tab').setAttribute('aria-selected',String(r===role));$(r+'-panel').hidden=r!==role;}
};
$('session').oninput=()=>{reset();enableActions();};
for(const button of document.querySelectorAll('[data-action]'))button.onclick=async()=>{
  button.disabled=true;text('action-status','正在只读检查权限、账目、nonce 和 Gas…');
  try{
    const p=await actions.quote(button.dataset.action,$('session').value);
    text('preview-data',`网络：BOT Chain Mainnet (677)\n函数：${p.plan.method}(${p.plan.args.join(', ')})\nFrom：${p.plan.from}\nTo：${p.plan.to}\nValue：0 BOT\nNonce：${BigInt(p.nonce)}\nCalldata：${p.plan.data}\n预计 Gas：${p.gas}\nGas limit（含 20% 余量）：${p.limit}\nGas Price：${formatUnits(p.price,'gwei')} Gwei\n预计手续费：${p.fee} BOT\n本次费用上限：${p.cap} BOT`);
    $('confirmation').checked=false;$('send').disabled=true;$('review').showModal();text('action-status','已准备 Gas 预览。尚未请求钱包交易审核。');
  }catch(error){text('action-status',errorText(error));}finally{enableActions();}
};
$('confirmation').onchange=()=>{$('send').disabled=!$('confirmation').checked || !actions?.preview || Date.now()>=actions.preview.expires;};
$('send').onclick=async()=>{
  $('send').disabled=true;
  try{
    await navigator.locks.request('gym-bot677-submit',{ifAvailable:true},async lock=>{
      if(!lock)throw Error('另一个标签页正在处理交易，请勿重复操作');
      const row=await actions.submit($('confirmation').checked);
      text('action-status',`已提交 ${row.hash}。请等待确认，再点击“只读核验待处理交易”；不会自动发送后续交易。`);
    });
  }catch(error){text('action-status',errorText(error));}
  finally{$('review').close();displayHistory();enableActions();}
};
$('recover').onclick=async()=>{
  $('recover').disabled=true;
  try{await actions.recover($('recovery-hash').value.trim()||null);text('action-status','业务交易回执与事件已独立核验通过。');await refresh();}
  catch(error){text('action-status',errorText(error)+' 未解锁，不会自动重试。');}
  finally{$('recover').disabled=false;displayHistory();enableActions();}
};
$('refresh').onclick=()=>{reset();refresh();};
setInterval(()=>{
  const p=actions?.preview;
  if(p){const seconds=Math.max(0,Math.ceil((p.expires-Date.now())/1000));text('preview-expiry',seconds?`报价剩余 ${seconds} 秒。MetaMask 的最终审核为准。`:'报价已过期，请关闭并重新预览。');if(!seconds){$('send').disabled=true;$('confirmation').checked=false;}}
  if(state && Date.now()-Date.parse(state.readAt)>60000){text('read-status',`上次读取区块 ${state.blockNumber}。数据已过期，请刷新；业务操作已暂停。`);$('read-status').className='status stale';}
  enableActions();
},1000);
refresh();
