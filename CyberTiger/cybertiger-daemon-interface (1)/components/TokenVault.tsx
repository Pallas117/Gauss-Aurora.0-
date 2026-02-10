
import React from 'react';
import { CounterToken, TokenType } from '../types';

interface Props {
  tokens: CounterToken[];
  onDeploy: (id: string) => void;
}

export const TokenVault: React.FC<Props> = ({ tokens, onDeploy }) => {
  return (
    <div className="bg-[#0a0a0c]/60 border border-zinc-800/50 rounded-xl overflow-hidden backdrop-blur-xl neon-border-yellow">
      <div className="p-4 border-b border-zinc-800/50 flex justify-between items-center bg-black/40">
        <h2 className="text-sm font-black mono tracking-[0.2em] text-[#faff00] italic">VAULT_STORAGE_CORE</h2>
        <div className="flex space-x-2">
            <span className="w-2 h-2 rounded-full bg-[#00f3ff] animate-pulse"></span>
            <span className="w-2 h-2 rounded-full bg-[#ff0055] animate-pulse"></span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="text-[10px] text-zinc-600 mono bg-black/80">
            <tr>
              <th className="px-6 py-4 uppercase tracking-widest">Identity</th>
              <th className="px-6 py-4 uppercase tracking-widest">Class</th>
              <th className="px-6 py-4 uppercase tracking-widest">Output</th>
              <th className="px-6 py-4 uppercase tracking-widest">Status</th>
              <th className="px-6 py-4 uppercase tracking-widest text-right">Execute</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {tokens.map((token) => (
              <tr key={token.id} className="hover:bg-zinc-800/10 transition-all group">
                <td className="px-6 py-4">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-zinc-100">{token.name}</span>
                    <span className="text-[10px] text-zinc-600 mono">{token.signature}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={`text-[10px] px-2 py-0.5 rounded border border-current font-bold mono ${getTypeColor(token.type)}`}>
                    {token.type}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="w-24 bg-zinc-900 h-1 rounded-full overflow-hidden">
                    <div 
                      className="bg-[#faff00] h-full transition-all duration-1000 shadow-[0_0_8px_rgba(250,255,0,0.6)]" 
                      style={{ width: `${token.power}%` }}
                    />
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={`text-[10px] mono font-bold ${token.status === 'READY' ? 'neon-yellow' : 'text-zinc-700'}`}>
                    {token.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <button 
                    onClick={() => onDeploy(token.id)}
                    disabled={token.status !== 'READY'}
                    className={`text-[10px] px-6 py-2 rounded-sm font-black mono transition-all ${
                      token.status === 'READY' 
                      ? 'bg-transparent text-[#faff00] border border-[#faff00]/50 hover:bg-[#faff00] hover:text-black hover:shadow-[0_0_15px_#faff00]' 
                      : 'bg-zinc-900 text-zinc-800 border border-zinc-900 cursor-not-allowed'
                    }`}
                  >
                    {token.status === 'READY' ? 'STRIKE' : 'OFFLINE'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const getTypeColor = (type: TokenType) => {
  switch (type) {
    case TokenType.NEURAL: return 'text-[#00f3ff]';
    case TokenType.QUANTUM: return 'text-[#ff0055]';
    case TokenType.KINETIC: return 'text-[#faff00]';
    default: return 'text-zinc-400';
  }
};
