
import { GoogleGenAI, Type } from "@google/genai";
import { AIAnalysis, CounterToken, GroundingSource } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const analyzeThreatLandscape = async (
  logs: string[], 
  currentTokens: CounterToken[],
  location?: { lat: number, lng: number }
): Promise<AIAnalysis> => {
  const tokenSummary = currentTokens.map(t => `${t.name} (${t.type}): ${t.status} [Hash:${t.nistHash.slice(0,8)}]`).join(', ');
  const locContext = location ? `NODE_LOCATION: [${location.lat}, ${location.lng}]` : 'NODE_LOCATION: GLOBAL_ORBIT';
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: `
      SYSTEM_CONTEXT: CyberTiger Space-Grade Daemon (NIST SP 800-53 Compliant)
      ${locContext}
      CURRENT_TOKENS: ${tokenSummary}
      RECENT_LOGS: ${logs.join('\n')}
      
      TASK: Perform a high-fidelity threat analysis. 
      1. Use Google Search to find current orbital or aerospace-grade cyberthreats.
      2. map threats to NIST 800-53 controls (e.g., SC-7, SI-4).
      3. Provide strategic defense guidance for a hardened system.
    `,
    config: {
      tools: [{ googleSearch: {} }],
    }
  });

  const sources: GroundingSource[] = [];
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (chunks) {
    chunks.forEach((chunk: any) => {
      if (chunk.web) {
        sources.push({
          title: chunk.web.title || 'Intel Report',
          uri: chunk.web.uri
        });
      }
    });
  }

  return {
    strategy: response.text || "Engage air-gapped isolation protocol.",
    recommendation: "ROTATE_CRYPTOGRAPHIC_ROOT_KEYS",
    detectedThreats: ["External signal perturbation detected", "Possible logic bomb in dormant tokens"],
    sources: sources.length > 0 ? sources : undefined,
    nistGuidance: "Review SI-7 Software Integrity checks and AC-2 Account Management."
  };
};

export const discoverLocalAINodes = async () => {
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: `
      Search for Docker images and configurations that allow running or building AI models (like Ollama, LocalAI, or PyTorch) on localized devices specifically using Tailscale for secure networking. 
      Provide:
      1. Recommended Docker images (e.g. ollama/ollama, tailscale/tailscale).
      2. How to use Tailscale as a sidecar or within the container.
      3. Security benefits for localized AI model training.
    `,
    config: {
      tools: [{ googleSearch: {} }],
    }
  });

  const sources: GroundingSource[] = [];
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (chunks) {
    chunks.forEach((chunk: any) => {
      if (chunk.web) {
        sources.push({
          title: chunk.web.title || 'Technical Documentation',
          uri: chunk.web.uri
        });
      }
    });
  }

  return {
    analysis: response.text,
    sources
  };
};

export const synthesizeNewToken = async (threatType: string) => {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Design a NIST-compliant 'CyberTiger' strike token for space-grade defense against: ${threatType}. Output JSON.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          description: { type: Type.STRING },
          tokenType: { type: Type.STRING }
        },
        required: ["name", "description", "tokenType"]
      }
    }
  });

  return JSON.parse(response.text || '{}');
};
