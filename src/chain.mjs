import { Interface, keccak256 } from 'ethers';
import { CONFIG as C, TOKEN_ABI, ESCROW_ABI, eq, q, demand } from './config.mjs';
export const ti = new Interface(TOKEN_ABI), ei = new Interface(ESCROW_ABI);
const depositInterface = new Interface(['function deposit(uint256 amount)']);
const READ_METHODS = new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getCode','eth_call','eth_getBalance','eth_getTransactionReceipt','eth_getTransactionByHash']);
export function httpRpc(fetcher = fetch) {
  let id = 0;
  return async (method, params = []) => {
    demand(READ_METHODS.has(method), '公开 API 仅允许只读链上查询');
    const requestId=++id;
    const res = await fetcher(C.rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }), signal: AbortSignal.timeout(12000) });
    demand(res.ok, 'BOT RPC 暂不可用'); const data = await res.json();
    demand(data.jsonrpc==='2.0' && data.id===requestId && !data.error && Object.hasOwn(data, 'result'), 'BOT RPC 返回错误或请求编号不匹配'); return data.result;
  };
}
export async function call(rpc, kind, name, args, block) {
  const iface = kind === 'token' ? ti : ei;
  return iface.decodeFunctionResult(name, await rpc('eth_call', [{ to: C[kind], data: iface.encodeFunctionData(name, args) }, block]));
}
export async function readState(rpc) {
  demand(BigInt(await rpc('eth_chainId')) === 677n, 'RPC 网络不是 BOT Chain 677');
  const tag = await rpc('eth_blockNumber'), block = await rpc('eth_getBlockByNumber', [tag, false]);
  demand(block?.hash && BigInt(block.number) === BigInt(tag), '区块不可核验');
  const [tc, ec] = await Promise.all([C.token,C.escrow].map(a => rpc('eth_getCode', [a,tag])));
  demand(tc?.length > 2 && ec?.length > 2 && keccak256(tc)===C.tokenCodeHash && keccak256(ec)===C.escrowCodeHash, '合约代码与已核验版本不匹配');
  const one = async (k,n,args=[]) => (await call(rpc,k,n,args,tag))[0];
  const [name,symbol,decimals,supply,token,merchant,payout,price,wallet,allowance,credit,expiry,total,revenue,accounting,bot,active] = await Promise.all([
    one('token','name'),one('token','symbol'),one('token','decimals'),one('token','totalSupply'),
    one('escrow','token'),one('escrow','merchant'),one('escrow','payoutAddress'),one('escrow','sessionPrice'),
    one('token','balanceOf',[C.member]),one('token','allowance',[C.member,C.escrow]),one('escrow','balances',[C.member]),
    one('escrow','validUntil',[C.member]),one('escrow','totalUserCredit'),one('escrow','merchantAvailable'),
    call(rpc,'escrow','getAccounting',[],tag),rpc('eth_getBalance',[C.member,tag]),one('escrow','activeRequest',[C.member]),
  ]);
  demand(name === 'Gym Demo Credit' && symbol === 'GYM' && decimals === 0n && supply === 300n, 'GYM 参数不匹配');
  demand(eq(token,C.token) && eq(merchant,C.merchant) && price === 30n, '托管合约配置不匹配');
  demand(accounting[1] === total && accounting[2] === revenue && accounting[4] === 0n && accounting[0] === total+revenue+accounting[3], '托管账目不变量异常');
  let request = null;
  if (active > 0n) {
    const r = await call(rpc,'escrow','requests',[active],tag);
    demand(eq(r[0],C.member) && r[2] === 30n && r[5] === 1n, '当前核销申请不一致');
    request = { id: active.toString(), user: r[0], sessionKey: r[1], amount: r[2].toString(), createdAt: Number(r[3]), expiresAt: Number(r[4]), status: Number(r[5]) };
  }
  const end = await rpc('eth_getBlockByNumber',[tag,false]); demand(eq(end?.hash,block.hash), '读取期间发生区块冲突，请重新查询');
  return { chainId: 677, origin: 'botchain-mainnet', blockNumber: Number(BigInt(tag)), blockHash: block.hash,
    timestamp: Number(BigInt(block.timestamp)), readAt: new Date().toISOString(),
    name,symbol,decimals:0,totalSupply:supply.toString(), token,merchant,payout,sessionPrice:'30',
    walletGYM:wallet.toString(),allowance:allowance.toString(),credit:credit.toString(),validUntil:expiry.toString(),
    totalUserCredit:total.toString(),revenue:revenue.toString(),accounting:Array.from(accounting,String),botWei:BigInt(bot).toString(),request };
}
// Fill absent RPC fields only from the matching transaction in the canonical full block.
// Any field supplied by both sources must agree. A real conflict is never repaired away.
export async function includedTransaction(rpc, hash) {
  demand(BigInt(await rpc('eth_chainId')) === 677n,'错误 RPC 网络');
  const [receipt,tx] = await Promise.all([rpc('eth_getTransactionReceipt',[hash]),rpc('eth_getTransactionByHash',[hash])]);
  demand(receipt && BigInt(receipt.status) === 1n && eq(receipt.transactionHash,hash), '交易未成功或回执尚不可用');
  const block = await rpc('eth_getBlockByNumber',[receipt.blockNumber,true]);
  demand(block && eq(block.hash,receipt.blockHash) && BigInt(block.number) === BigInt(receipt.blockNumber), '回执不在规范区块中');
  const index = Number(BigInt(receipt.transactionIndex)), full = block.transactions?.[index];
  demand(full && typeof full === 'object' && eq(full.hash,hash), '规范区块缺少完整交易');
  const merged = { ...full };
  for (const k of ['hash','from','to','blockHash','input','data']) {
    if (tx?.[k] != null && full[k] != null) demand(eq(tx[k],full[k]),`交易字段冲突：${k}`);
    if (tx?.[k] != null) merged[k] = tx[k];
  }
  for (const k of ['nonce','blockNumber','transactionIndex','chainId','value']) {
    if (tx?.[k] != null && full[k] != null) demand(BigInt(tx[k]) === BigInt(full[k]),`交易字段冲突：${k}`);
    if (tx?.[k] != null) merged[k] = tx[k];
  }
  demand(merged.nonce != null && BigInt(merged.chainId) === 677n && BigInt(merged.value) === 0n,'交易网络、nonce 或金额不可核验');
  demand(BigInt(merged.blockNumber) === BigInt(receipt.blockNumber) && BigInt(merged.transactionIndex) === BigInt(receipt.transactionIndex) && eq(merged.blockHash,block.hash),'交易与回执区块不一致');
  demand(eq(merged.from,receipt.from) && eq(merged.to,receipt.to), '交易与回执账户不一致');
  if(merged.input!=null && merged.data!=null) demand(eq(merged.input,merged.data),'交易 input/data 不一致');
  demand(BigInt(await rpc('eth_blockNumber')) >= BigInt(receipt.blockNumber)+1n,'等待至少两个区块确认');
  return { tx: merged, receipt, block };
}
export function matchingEvents(receipt, address, iface, name) {
  return receipt.logs.filter(log => eq(log.address,address)).map(log => {
    demand(eq(log.transactionHash,receipt.transactionHash) && eq(log.blockHash,receipt.blockHash) && BigInt(log.blockNumber) === BigInt(receipt.blockNumber) && BigInt(log.transactionIndex)===BigInt(receipt.transactionIndex) && !log.removed,'事件区块归属异常');
    try { return iface.parseLog(log); } catch { return null; }
  }).filter(e => e?.name === name);
}
export async function verifyDeposit(rpc) {
  const { tx,receipt,block } = await includedTransaction(rpc,C.depositHash);
  demand(eq(tx.from,C.member) && eq(tx.to,C.escrow) && BigInt(tx.nonce) === 1n && BigInt(block.number) === BigInt(C.depositBlock),'充值账户或区块不匹配');
  demand(eq(tx.input ?? tx.data,depositInterface.encodeFunctionData('deposit',[30])), '不是指定 deposit(30)');
  const deposits=matchingEvents(receipt,C.escrow,ei,'Deposited'), transfers=matchingEvents(receipt,C.token,ti,'Transfer');
  demand(deposits.length === 1 && eq(deposits[0].args[0],C.member) && deposits[0].args[1] === 30n,'Deposited 事件不匹配');
  demand(transfers.length === 1 && eq(transfers[0].args[0],C.member) && eq(transfers[0].args[1],C.escrow) && transfers[0].args[2] === 30n,'Transfer 事件不匹配');
  const end = await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]); demand(eq(end?.hash,block.hash),'核验期间区块冲突');
  return { verified: true, hash:C.depositHash, blockNumber:Number(BigInt(block.number)),blockHash:block.hash,
    member:C.member,amount:'30',receipt:'success',deposited:true,transfer:true,nonce:'1',
    gasUsed:BigInt(receipt.gasUsed).toString(),gasPriceWei:BigInt(receipt.effectiveGasPrice).toString(),
    feeWei:(BigInt(receipt.gasUsed)*BigInt(receipt.effectiveGasPrice)).toString(),checkedAt:new Date().toISOString() };
}
