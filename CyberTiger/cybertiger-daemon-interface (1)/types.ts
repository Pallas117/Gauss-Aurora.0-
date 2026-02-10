
export enum TokenType {
  NEURAL = 'Neural',
  KINETIC = 'Kinetic',
  EMP = 'EMP',
  PHANTOM = 'Phantom',
  OVERLOAD = 'Overload',
  QUANTUM = 'Quantum',
  AI_GEN = 'AI-Gen'
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface CounterToken {
  id: string;
  name: string;
  type: TokenType;
  power: number;
  status: 'READY' | 'DEPLOYED' | 'SYNTHESIZING';
  signature: string;
  timestamp: string;
  nistHash: string; // Tamper-evident hash for NIST compliance
}

export interface DaemonMetrics {
  cpuUsage: number;
  memoryUsage: number;
  tokenCount: number;
  threatLevel: number;
  uptime: string;
  quantumEntropy: number;
  nistCompliance: number; // New: NIST SP 800-53 score
  driftDetected: boolean; // New: SI-7 check
}

export interface AIAnalysis {
  strategy: string;
  recommendation: string;
  detectedThreats: string[];
  sources?: GroundingSource[];
  nistGuidance?: string; // New: Explicit NIST control references
}
