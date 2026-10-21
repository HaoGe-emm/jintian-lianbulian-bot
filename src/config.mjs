export const CONFIG = Object.freeze({
  chainId: 677, rpc: 'https://rpc.botchain.ai', explorer: 'https://scan.botchain.ai',
  token: '0x93DFA83eddBf8A87b124fC27c8B1266e9E5F1AcA',
  escrow: '0xC0E8d8Ef388E79A4FB23B6391F66DC34C856Ef43',
  member: '0xb6bF6a936F529650992B71e2DeB79E80Fd3da71B',
  merchant: '0x89F415bb42e356E8b892C10B05522e0a8Ef151F3',
  depositHash: '0x5b6f2465314abeb73e7770d12bb8af992ee530ac74f2859a62d79d533a3fab51',
  depositBlock: 27425715, amount: 30,
  tokenCodeHash: '0xf7c0c0b20628948b9ca7c983f801c1b7084d8127169d9614be74d3a975464a3b',
  escrowCodeHash: '0xa53d27b12d6bdf177cadc1fcd46bc53f9a6a543fc96b3ff6a5fc9533ab1451bc',
});
export const TOKEN_ABI = [
  'function name() view returns (string)', 'function symbol() view returns (string)',
  'function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
];
// No deployment bytecode, approve, deposit, or admin setter is shipped in the wallet interface.
export const ESCROW_ABI = [
  'function token() view returns (address)', 'function merchant() view returns (address)',
  'function payoutAddress() view returns (address)', 'function sessionPrice() view returns (uint256)',
  'function balances(address) view returns (uint256)', 'function validUntil(address) view returns (uint256)',
  'function totalUserCredit() view returns (uint256)', 'function merchantAvailable() view returns (uint256)',
  'function activeRequest(address) view returns (uint256)',
  'function requests(uint256) view returns (address user,bytes32 sessionKey,uint256 amount,uint256 createdAt,uint256 expiresAt,uint8 status)',
  'function usedSessionKeys(address,bytes32) view returns (bool)',
  'function getAccounting() view returns (uint256 assets,uint256 userCredit,uint256 revenue,uint256 surplus,uint256 deficit)',
  'function requestConsumption(address user,bytes32 sessionKey)', 'function confirmConsumption(uint256 id)',
  'function rejectConsumption(uint256 id)', 'function cancelConsumption(uint256 id)',
  'function refund(uint256 amount)', 'function withdraw(uint256 amount)',
  'event Deposited(address indexed user,uint256 amount,uint256 validUntil)',
  'event ConsumptionRequested(uint256 indexed id,address indexed user,bytes32 sessionKey,uint256 amount,uint256 expiresAt)',
  'event ConsumptionConfirmed(uint256 indexed id,address indexed user,uint256 amount,address confirmer)',
  'event ConsumptionRejected(uint256 indexed id,address indexed user)',
  'event ConsumptionCancelled(uint256 indexed id,address indexed user)',
  'event Refunded(address indexed user,uint256 amount)',
  'event Withdrawn(address indexed operator,address indexed to,uint256 amount,uint256 availableBefore)',
];
export const eq = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
export const q = x => `0x${BigInt(x).toString(16)}`;
export function demand(value, message) { if (!value) throw new Error(message); }
