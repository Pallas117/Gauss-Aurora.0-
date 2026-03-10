/**
 * Shared type definitions for Space Weather visualization components.
 * Single source of truth for cockpit/scene layer toggles.
 */

export interface LayerVisibility {
  earth: boolean;
  belts: boolean;
  magnetosphere: boolean;
  fieldLines: boolean;
  mhdWaves: boolean;
  mmsReconnection: boolean;
  /** Radiation / debris overlay (risk zones when VITE_FEATURE_DEBRIS_3D) */
  radiationData?: boolean;
}

export type EncodingMode = 'color' | 'size' | 'both';
