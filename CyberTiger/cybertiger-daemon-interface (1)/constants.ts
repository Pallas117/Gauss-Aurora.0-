
import { TokenType, CounterToken } from './types';

export const INITIAL_TOKENS: CounterToken[] = [
  {
    id: 'ct-001',
    name: 'Neon Fang',
    type: TokenType.KINETIC,
    power: 92,
    status: 'READY',
    signature: '0xFAFF00_ALPHA',
    timestamp: new Date().toISOString(),
    // Added nistHash to satisfy CounterToken interface
    nistHash: 'BOOT_HASH_KINETIC_001'
  },
  {
    id: 'ct-002',
    name: 'Azure Stripe',
    type: TokenType.NEURAL,
    power: 88,
    status: 'READY',
    signature: '0x00F3FF_BETA',
    timestamp: new Date().toISOString(),
    // Added nistHash to satisfy CounterToken interface
    nistHash: 'BOOT_HASH_NEURAL_002'
  },
  {
    id: 'ct-003',
    name: 'Junk Roar',
    type: TokenType.EMP,
    power: 76,
    status: 'DEPLOYED',
    signature: '0xFF0055_GAMMA',
    timestamp: new Date().toISOString(),
    // Added nistHash to satisfy CounterToken interface
    nistHash: 'BOOT_HASH_EMP_003'
  }
];

export const THEME_COLORS = {
  primary: '#faff00', // Neon Yellow/Tiger
  secondary: '#00f3ff', // Cyber Blue
  accent: '#ff0055', // Neon Red
  background: '#020205',
  surface: '#0a0a0c'
};
