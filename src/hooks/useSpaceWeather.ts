import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  EMAInterpolator,
  InterpolatedData,
  VisualizationParams,
  calculateVisualizationParams,
  transformApiResponse,
  validateSpaceWeatherResponse,
  applyDecay,
} from '@/lib/dataProcessing';

// ============================================================================
// CONFIGURATION
// ============================================================================

const UPDATE_INTERVAL = 60000; // 1 minute
const INTERPOLATION_DURATION = 10000; // 10 seconds for smooth transitions
const FALLBACK_TO_MOCK_AFTER = 3; // Consecutive failures before mock mode

// ============================================================================
// MOCK DATA GENERATOR (fallback)
// ============================================================================

const generateMockData = (): InterpolatedData => ({
  solarWind: {
    speed: 380 + Math.random() * 100 + Math.sin(Date.now() / 30000) * 30,
    density: 4 + Math.random() * 4 + Math.sin(Date.now() / 25000) * 1.5,
    pressure: 2 + Math.random() * 2,
  },
  imfBz: -3 + Math.random() * 10 + Math.sin(Date.now() / 20000) * 2,
  kpIndex: Math.min(9, Math.max(0, Math.round(2.5 + Math.random() * 3 + Math.sin(Date.now() / 60000) * 1.5))),
  protonFlux: 0.8 + Math.random() * 3 + Math.sin(Date.now() / 40000) * 0.5,
  electronFlux: 1500 + Math.random() * 3000 + Math.sin(Date.now() / 35000) * 400,
  timestamp: new Date(),
  isStale: false,
  source: 'mock',
});

// ============================================================================
// CUSTOM HOOK
// ============================================================================

export interface UseSpaceWeatherReturn {
  data: InterpolatedData;
  visualParams: VisualizationParams;
  isStale: boolean;
  source: string;
  lastUpdate: Date | null;
  error: string | null;
}

export const useSpaceWeather = (): UseSpaceWeatherReturn => {
  const [data, setData] = useState<InterpolatedData>(generateMockData());
  const [visualParams, setVisualParams] = useState<VisualizationParams>(() => 
    calculateVisualizationParams(generateMockData())
  );
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const interpolatorRef = useRef<EMAInterpolator>(
    new EMAInterpolator(generateMockData(), INTERPOLATION_DURATION)
  );
  const animationRef = useRef<number>();
  const failureCountRef = useRef(0);
  const lastFetchTimeRef = useRef<number>(0);

  // ============================================================================
  // DATA FETCHING
  // ============================================================================

  const fetchData = useCallback(async () => {
    try {
      console.log('[SpaceWeather] Fetching data from edge function...');
      
      const { data: responseData, error: fetchError } = await supabase.functions.invoke(
        'spaceweather',
        { method: 'GET' }
      );

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      const validated = validateSpaceWeatherResponse(responseData);
      
      if (!validated) {
        throw new Error('Invalid response format');
      }

      const transformed = transformApiResponse(validated);
      interpolatorRef.current.setTarget(transformed);
      
      failureCountRef.current = 0;
      lastFetchTimeRef.current = Date.now();
      setLastUpdate(new Date());
      setError(null);
      
      console.log('[SpaceWeather] Data updated:', {
        source: validated.flags.source,
        stale: validated.flags.stale,
        solarWind: transformed.solarWind.speed.toFixed(0) + ' km/s',
        bz: transformed.imfBz.toFixed(1) + ' nT',
        kp: transformed.kpIndex,
      });

    } catch (err) {
      failureCountRef.current++;
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[SpaceWeather] Fetch error:', errorMsg);
      
      if (failureCountRef.current >= FALLBACK_TO_MOCK_AFTER) {
        console.log('[SpaceWeather] Switching to mock data mode');
        interpolatorRef.current.setTarget(generateMockData());
        setError('Using simulated data (API unavailable)');
      } else {
        setError(`Fetch failed: ${errorMsg}`);
      }
    }
  }, []);

  // ============================================================================
  // ANIMATION LOOP
  // ============================================================================

  useEffect(() => {
    const animate = () => {
      let interpolated = interpolatorRef.current.getInterpolated();
      
      // Apply decay if data is stale
      if (interpolated.isStale && lastFetchTimeRef.current > 0) {
        const timeSinceUpdate = Date.now() - lastFetchTimeRef.current;
        interpolated = applyDecay(interpolated, timeSinceUpdate);
      }
      
      setData(interpolated);
      setVisualParams(calculateVisualizationParams(interpolated));
      
      animationRef.current = requestAnimationFrame(animate);
    };

    animate();
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  // ============================================================================
  // DATA REFRESH INTERVAL
  // ============================================================================

  useEffect(() => {
    // Initial fetch
    fetchData();
    
    // Set up periodic refresh
    const interval = setInterval(fetchData, UPDATE_INTERVAL);
    
    return () => clearInterval(interval);
  }, [fetchData]);

  // ============================================================================
  // RETURN
  // ============================================================================

  return {
    data,
    visualParams,
    isStale: data.isStale || failureCountRef.current > 0,
    source: data.source,
    lastUpdate,
    error,
  };
};

// Re-export types for convenience
export type { InterpolatedData, VisualizationParams };
