import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import solc from 'solc';
const root=fileURLToPath(new URL('../',import.meta.url)), require=createRequire(import.meta.url);
export function compileContracts(){
  if(!solc.version().startsWith('0.8.30+'))throw Error('Expected Solidity0.8.30');
  const sources=Object.fromEntries(['GymToken','GymEscrow'].map(n=>[`contracts/${n}.sol`,{content:fs.readFileSync(path.join(root,`contracts/${n}.sol`),'utf8')}]));
  const settings={optimizer:{enabled:true,runs:200},evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}};
  const result=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings}),{import:p=>{try{return {contents:fs.readFileSync(require.resolve(p),'utf8')};}catch{return {error:'Unresolved dependency: '+p};}}}));
  const errors=(result.errors??[]).filter(x=>x.severity==='error');if(errors.length)throw Error(errors.map(x=>x.formattedMessage).join('\n'));
  return {compiler:solc.version(),settings,contracts:result.contracts};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const r=compileContracts();
  console.log(JSON.stringify({compiler:r.compiler,settings:r.settings,contracts:Object.fromEntries(['GymToken','GymEscrow'].map(n=>[n,{creationBytes:r.contracts[`contracts/${n}.sol`][n].evm.bytecode.object.length/2}]))},null,2));
}
