import { httpRpc, readState, verifyDeposit } from '../src/chain.mjs';
export function createHandler(rpc=httpRpc()) {
  let inflight=null, cache=null;
  return async request => {
    if(request.method!=='GET') return Response.json({error:'仅允许 GET 只读查询'},{status:405,headers:{Allow:'GET'}});
    const url=new URL(request.url);
    if(url.search) return Response.json({error:'不接受自定义地址、RPC 或参数'},{status:400});
    try {
      if(!cache || Date.now()-cache.at>15000) {
        inflight??=Promise.all([readState(rpc),verifyDeposit(rpc)]).then(([state,evidence])=>({state,evidence})).finally(()=>{inflight=null;});
        cache={data:await inflight,at:Date.now()};
      }
      return Response.json(cache.data,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    } catch { return Response.json({error:'BOT 677 只读查询暂不可用。未使用模拟数据；请稍后重试或在 BOTScan 核查。'},{status:503,headers:{'Cache-Control':'no-store'}}); }
  };
}
export default { fetch:createHandler() };
