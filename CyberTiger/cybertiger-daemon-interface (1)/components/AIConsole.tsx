
import React from 'react';
import { AIAnalysis } from '../types';

interface Props {
  analysis: AIAnalysis | null;
  loading: boolean;
  onRefresh: () => void;
}

export const AIConsole: React.FC<Props> = ({ analysis, loading, onRefresh }) => {
  return (
    <div className="bg-black border border-zinc-800 rounded-xl p-8 relative overflow-hidden flex flex-col h-full shadow-[0_0_20px_rgba(0,0,0,0.5)]">
      {/* Accent Corners */}
      <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#faff00]"></div>
      <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[#faff00]"></div>
      <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[#faff00]"></div>
      <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#faff00]"></div>
      
      <div className="absolute top-0 right-0 p-4">
        <div className={`w-3 h-3 rounded-full ${loading ? 'bg-[#ff0055] animate-ping' : 'bg-[#00f3ff] shadow-[0_0_8px_#00f3ff]'}`} />
      </div>
      
      <div className="flex justify-between items-center mb-10">
        <h3 className="text-xs font-black mono text-[#00f3ff] uppercase tracking-[0.3em] italic">Neural_Threat_Map</h3>
        <button 
          onClick={onRefresh}
          disabled={loading}
          className="text-[10px] text-zinc-600 hover:text-[#faff00] transition-colors mono uppercase tracking-[0.2em] font-bold disabled:opacity-20"
        >
          {loading ? '[ Researching ]' : '[ Sync Intel ]'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-8 pr-2 custom-scrollbar">
        {!analysis && !loading && (
          <div className="text-zinc-700 text-xs italic py-16 text-center mono uppercase tracking-widest">
            Awaiting_Inbound_Data...
          </div>
        )}

        {analysis && (
          <div className="space-y-10 animate-in fade-in duration-700">
            <div>
              <div className="text-[10px] text-zinc-500 mono mb-3 uppercase tracking-widest border-l-2 border-[#ff0055] pl-3">Neural Projection</div>
              <div className="text-sm text-zinc-400 leading-relaxed font-medium italic border-zinc-900 pl-4 whitespace-pre-wrap">
                {analysis.strategy}
              </div>
            </div>

            {analysis.sources && (
              <div>
                <div className="text-[10px] text-zinc-500 mono mb-3 uppercase tracking-widest border-l-2 border-[#00f3ff] pl-3">Intel Citations</div>
                <div className="space-y-2">
                  {analysis.sources.slice(0, 4).map((source, i) => (
                    <a 
                      key={i} 
                      href={source.uri} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="block text-[10px] text-zinc-500 hover:text-[#faff00] hover:neon-yellow mono truncate bg-zinc-900/40 p-2 rounded-sm transition-colors border border-transparent hover:border-[#faff00]/30"
                    >
                      🔗 {source.title}
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="text-[10px] text-zinc-500 mono mb-3 uppercase tracking-widest border-l-2 border-orange-500 pl-3">Confirmed Anomalies</div>
              <ul className="space-y-2">
                {analysis.detectedThreats.map((threat, i) => (
                  <li key={i} className="text-[10px] mono text-red-500 flex items-center bg-red-950/10 p-2 border-l-2 border-red-500">
                    <span className="mr-3 opacity-50">▶</span> {threat}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        
        {loading && (
          <div className="flex flex-col items-center justify-center h-full space-y-6 py-20">
            <div className="relative">
                <div className="w-14 h-14 border-2 border-[#faff00]/20 rounded-full animate-spin border-t-[#faff00]" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-[#faff00]/10 rounded-full blur-xl animate-pulse" />
            </div>
            <div className="text-[10px] mono text-[#faff00] font-black tracking-[0.3em] uppercase animate-pulse italic">Researching_Threat_Patterns...</div>
          </div>
        )}
      </div>
    </div>
  );
};
