import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import type { LayerVisibility } from "@/components/types";
import type { SuryaForecastResponse } from "@/hooks/useSuryaForecast";

export interface OperatorAction {
    id: string;
    timestamp: string;
    actionType: string;
    details: string;
}

export interface VisualState {
    activeLayers: LayerVisibility;
    cameraFocus: string;
}

export interface AgenticRecommendation {
    id: string;
    type: string;
    probability: number;
    confidence_interval: [number, number];
    recommended_action: string;
    factors: { name: string; contribution: number }[];
}

export interface AiContextState {
    suryaData: SuryaForecastResponse | null;
    visualState: VisualState;
    operatorLog: OperatorAction[];
    recommendations: AgenticRecommendation[];
}

export interface AiContextActions {
    updateSuryaData: (data: SuryaForecastResponse | null) => void;
    updateVisualState: (state: Partial<VisualState>) => void;
    logOperatorAction: (actionType: string, details: string) => void;
    setRecommendations: (recs: AgenticRecommendation[]) => void;
    dismissRecommendation: (id: string, reason?: string) => void;
}

type AiContextType = AiContextState & AiContextActions;

const AiContext = createContext<AiContextType | null>(null);

export function AiContextProvider({ children }: { children: ReactNode }) {
    const [suryaData, setSuryaData] = useState<SuryaForecastResponse | null>(null);
    const [visualState, setVisualState] = useState<VisualState>({
        activeLayers: { earth: true, belts: true, magnetosphere: true, fieldLines: true, mhdWaves: true, mmsReconnection: true, radiationData: true },
        cameraFocus: "Global View",
    });
    const [operatorLog, setOperatorLog] = useState<OperatorAction[]>([]);
    const [recommendations, setRecommendations] = useState<AgenticRecommendation[]>([]);

    const updateVisualState = useCallback((partial: Partial<VisualState>) => {
        setVisualState((prev) => ({ ...prev, ...partial }));
    }, []);

    const logOperatorAction = useCallback((actionType: string, details: string) => {
        const action: OperatorAction = {
            id: Math.random().toString(36).substring(7),
            timestamp: new Date().toISOString(),
            actionType,
            details,
        };
        setOperatorLog((prev) => [action, ...prev].slice(0, 50));
    }, []);

    const updateSuryaData = useCallback((data: SuryaForecastResponse | null) => {
        setSuryaData(data);
    }, []);

    const dismissRecommendation = useCallback((id: string, reason?: string) => {
        setRecommendations((prev) => prev.filter((r) => r.id !== id));
        logOperatorAction("DISMISS_THREAT", `Dismissed AI recommendation ${id}${reason ? `: ${reason}` : ""}`);
    }, [logOperatorAction]);

    const value = {
        suryaData,
        visualState,
        operatorLog,
        recommendations,
        updateSuryaData,
        updateVisualState,
        logOperatorAction,
        setRecommendations,
        dismissRecommendation,
    };

    return <AiContext.Provider value={value}>{children}</AiContext.Provider>;
}

export function useAiContext() {
    const context = useContext(AiContext);
    if (!context) {
        throw new Error("useAiContext must be used within an AiContextProvider");
    }
    return context;
}
