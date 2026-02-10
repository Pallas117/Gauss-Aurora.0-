
import React from 'react';
import { DaemonMetrics } from '../types';

interface Props {
  metrics: DaemonMetrics;
}

export const DaemonStatus: React.FC<Props> = ({ metrics }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <StatusCard label="CPU ENTROPY" value={`${metrics.cpuUsage.toFixed(1)}%`} color="neon-yellow" />
      <StatusCard label="STABILITY" value={(1.0 - metrics.quantumEntropy).toFixed(3)} color="neon-blue" />
      <StatusCard label="VAULT" value={metrics.tokenCount.toString()} color="neon-red" />
      <StatusCard label="LATENCY" value="12ms" color="neon-yellow" />
    </div>
  );
};

const StatusCard: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
  <div className="bg-[#0a0a0c]/80 p-4 border border-zinc-800/50 rounded-lg neon-border-blue backdrop-blur-md">
    <div className="text-[10px] text-zinc-500 mono mb-1 tracking-widest uppercase">{label}</div>
    <div className={`text-xl font-bold mono ${color}`}>{value}</div>
  </div>
);
