// Discovery sends browser events only; account access always requires a click.
export function discoverMetaMask(target) {
  const providers=new Set();
  target.addEventListener?.('eip6963:announceProvider',event=>{
    const {info,provider}=event.detail??{};
    if(info?.rdns==='io.metamask' && typeof provider?.request==='function') providers.add(provider);
  });
  target.dispatchEvent?.(new Event('eip6963:requestProvider'));
  return ()=>{
    target.dispatchEvent?.(new Event('eip6963:requestProvider'));
    return [...providers][0]??target.ethereum?.providers?.find(p=>p.isMetaMask)??
      (target.ethereum?.isMetaMask?target.ethereum:null);
  };
}

export class WalletConnection {
  constructor(onChange) {
    this.onChange=onChange;this.provider=null;this.revision=0;this.pending=false;this.handlers={};this.attempt=0;
    this.state={account:null,chainId:null,checking:false,error:null};
  }
  publish(patch) { this.state={...this.state,...patch};this.onChange(this.state); }
  clear(error=null) {
    ++this.revision;this.publish({account:null,chainId:null,checking:false,error});
  }
  bind(provider) {
    if(this.provider===provider)return;
    for(const [event,handler] of Object.entries(this.handlers))this.provider?.removeListener?.(event,handler);
    this.clear();this.provider=provider;
    const sync=payload=>{this.sync(payload).catch(()=>{});};
    this.handlers={
      accountsChanged:accounts=>sync({accounts}),
      chainChanged:chainId=>sync({chainId}),
      connect:()=>sync(),
      disconnect:()=>{++this.attempt;this.clear(new Error('MetaMask 已断开，请重新连接。'));},
    };
    for(const [event,handler] of Object.entries(this.handlers))provider.on?.(event,handler);
  }
  async sync({accounts,chainId}={}) {
    const revision=++this.revision,provider=this.provider;
    this.publish({account:null,checking:true,error:null});
    try {
      const [list,chain]=await Promise.all([
        accounts??provider.request({method:'eth_accounts'}),
        chainId??provider.request({method:'eth_chainId'}),
      ]);
      if(revision!==this.revision)return;
      if(!Array.isArray(list) || list.some(a=>!/^0x[0-9a-fA-F]{40}$/.test(a)))throw Error('钱包返回的账户格式无效');
      const chainNumber=Number(BigInt(chain));
      if(!Number.isSafeInteger(chainNumber) || chainNumber<=0)throw Error('钱包返回的网络无效');
      this.publish({account:list[0]??null,chainId:chainNumber,checking:false,error:null});
    } catch(error) {
      if(revision!==this.revision)return;
      this.clear(error);throw error;
    }
  }
  async connect(provider) {
    if(this.pending)return;
    if(!provider){const error=new Error('未找到 MetaMask。请在已启用 MetaMask 的浏览器中打开此页面。');this.clear(error);throw error;}
    this.pending=true;
    const attempt=++this.attempt;
    try {
      this.bind(provider);
      const revision=this.revision;
      this.publish({account:null,checking:true,error:null});
      const accounts=await provider.request({method:'eth_requestAccounts'});
      if(attempt!==this.attempt)return;
      // An event during the permission prompt takes precedence over its older result.
      await this.sync(revision===this.revision?{accounts}:{});
    } catch(error) { if(attempt===this.attempt)this.clear(error);throw error; }
    finally {this.pending=false;}
  }
}
