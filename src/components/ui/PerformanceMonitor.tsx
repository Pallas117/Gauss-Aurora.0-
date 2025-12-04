import { useEffect, useState, useRef, useCallback } from 'react';

interface PerformanceStats {
  fps: number;
  frameTime: number;
  avgFrameTime: number;
}

interface PerformanceMonitorProps {
  visible?: boolean;
}

export const PerformanceMonitor = ({ visible = true }: PerformanceMonitorProps) => {
  const [stats, setStats] = useState<PerformanceStats>({
    fps: 60,
    frameTime: 16.67,
    avgFrameTime: 16.67,
  });
  
  const frameTimesRef = useRef<number[]>([]);
  const lastTimeRef = useRef(performance.now());
  const frameCountRef = useRef(0);
  const animationFrameRef = useRef<number>();

  const measurePerformance = useCallback(() => {
    const now = performance.now();
    const delta = now - lastTimeRef.current;
    lastTimeRef.current = now;
    
    frameTimesRef.current.push(delta);
    if (frameTimesRef.current.length > 60) {
      frameTimesRef.current.shift();
    }
    
    frameCountRef.current++;
    
    // Update stats every 10 frames for stability
    if (frameCountRef.current % 10 === 0) {
      const avgFrameTime = frameTimesRef.current.reduce((a, b) => a + b, 0) / frameTimesRef.current.length;
      const fps = 1000 / avgFrameTime;
      
      setStats({
        fps: Math.round(fps),
        frameTime: Math.round(delta * 100) / 100,
        avgFrameTime: Math.round(avgFrameTime * 100) / 100,
      });
    }
    
    animationFrameRef.current = requestAnimationFrame(measurePerformance);
  }, []);

  useEffect(() => {
    if (visible) {
      animationFrameRef.current = requestAnimationFrame(measurePerformance);
    }
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [visible, measurePerformance]);

  if (!visible) return null;

  const fpsColor = stats.fps >= 55 ? 'text-green-400' : stats.fps >= 30 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="absolute top-4 right-4 bg-black/70 backdrop-blur-sm border border-white/10 rounded-lg px-3 py-2 font-mono text-xs">
      <div className="flex flex-col gap-1">
        <div className="flex justify-between gap-4">
          <span className="text-white/60">FPS</span>
          <span className={fpsColor}>{stats.fps}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-white/60">Frame</span>
          <span className="text-white/80">{stats.avgFrameTime}ms</span>
        </div>
      </div>
    </div>
  );
};
