import test from 'node:test';
import assert from 'node:assert/strict';
import { compileContracts } from '../scripts/compile-contracts.mjs';
import { Interface } from 'ethers';
import { TOKEN_ABI,ESCROW_ABI } from '../src/config.mjs';
test('unchanged public Solidity sources compile with pinned settings; public ABI selectors/events match compiler',()=>{
  const r=compileContracts();assert.match(r.compiler,/^0\.8\.30/);
  for(const [n,abi] of [['GymToken',TOKEN_ABI],['GymEscrow',ESCROW_ABI]]){
    const compiled=new Interface(r.contracts[`contracts/${n}.sol`][n].abi),ui=new Interface(abi);
    for(const f of ui.fragments){if(f.type==='function')assert.equal(ui.getFunction(f.format()).selector,compiled.getFunction(f.format()).selector);if(f.type==='event')assert.equal(ui.getEvent(f.format()).topicHash,compiled.getEvent(f.format()).topicHash);}
  }
});
