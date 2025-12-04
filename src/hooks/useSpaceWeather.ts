import { useState, useEffect, useCallback, useRef } from 'react';

export interface SpaceWeatherData {
  solarWind: {
    speed: number; // km/s
    density: number; // particles/cm³
  };
  imfBz: number; // nT (negative = southward)
  kpIndex: number; // 0-9
  protonFlux: number; // pfu
  electronFlux: number; // electrons/cm²/s
  timestamp: Date;
  isStale: boolean;
}

interface InterpolatedState {
  current: SpaceWeatherData;
  target: SpaceWeatherData;
  progress: number;
}

const generateMockData = (): SpaceWeatherData => ({
  solarWind: {
    speed: 350 + Math.random() * 200 + Math.sin(Date.now() / 30000) * 50,
    density: 3 + Math.random() * 8 + Math.sin(Date.now() / 25000) * 2,
  },
  imfBz: -5 + Math.random() * 15 + Math.sin(Date.now() / 20000) * 3,
  kpIndex: Math.min(9, Math.max(0, Math.round(2 + Math.random() * 4 + Math.sin(Date.now() / 60000) * 2))),
  protonFlux: 0.5 + Math.random() * 5 + Math.sin(Date.now() / 40000) * 1,
  electronFlux: 1000 + Math.random() * 5000 + Math.sin(Date.now() / 35000) * 500,
  timestamp: new Date(),
  isStale: false,
});

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const interpolateData = (
  current: SpaceWeatherData,
  target: SpaceWeatherData,
  t: number
): SpaceWeatherData => ({
  solarWind: {
    speed: lerp(current.solarWind.speed, target.solarWind.speed, t),
    density: lerp(current.solarWind.density, target.solarWind.density, t),
  },
  imfBz: lerp(current.imfBz, target.imfBz, t),
  kpIndex: Math.round(lerp(current.kpIndex, target.kpIndex, t)),
  protonFlux: lerp(current.protonFlux, target.protonFlux, t),
  electronFlux: lerp(current.electronFlux, target.electronFlux, t),
  timestamp: target.timestamp,
  isStale: target.isStale,
});

export const useSpaceWeather = (updateInterval = 10000, interpolationDuration = 8000) => {
  const [data, setData] = useState<SpaceWeatherData>(generateMockData());
  const stateRef = useRef<InterpolatedState>({
    current: generateMockData(),
    target: generateMockData(),
    progress: 1,
  });
  const animationRef = useRef<number>();
  const lastUpdateRef = useRef<number>(Date.now());

  const fetchData = useCallback(async () => {
    // In production, this would fetch from your backend
    // For now, generate smooth mock data
    const newData = generateMockData();
    
    stateRef.current = {
      current: stateRef.current.target,
      target: newData,
      progress: 0,
    };
    lastUpdateRef.current = Date.now();
  }, []);

  useEffect(() => {
    const animate = () => {
      const elapsed = Date.now() - lastUpdateRef.current;
      const progress = Math.min(1, elapsed / interpolationDuration);
      
      // Exponential easing for smooth interpolation
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      
      const interpolated = interpolateData(
        stateRef.current.current,
        stateRef.current.target,
        easedProgress
      );
      
      setData(interpolated);
      animationRef.current = requestAnimationFrame(animate);
    };

    animate();
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [interpolationDuration]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, updateInterval);
    return () => clearInterval(interval);
  }, [fetchData, updateInterval]);

  // Derived visualization parameters
  const magnetopauseCompression = Math.max(0.6, 1 - (data.solarWind.speed - 300) / 600);
  const beltIntensity = Math.min(1, (data.protonFlux + data.electronFlux / 1000) / 10);
  const reconnectionStrength = Math.max(0, -data.imfBz / 10);
  const stormLevel = data.kpIndex / 9;

  return {
    data,
    magnetopauseCompression,
    beltIntensity,
    reconnectionStrength,
    stormLevel,
    isStale: data.isStale,
  };
};
