import { Camera } from 'lucide-react';
import { toast } from 'sonner';

interface ScreenshotButtonProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
}

export const ScreenshotButton = ({ canvasRef }: ScreenshotButtonProps) => {
  const handleScreenshot = async () => {
    if (!canvasRef.current) {
      toast.error('Canvas not ready');
      return;
    }

    try {
      const dataUrl = canvasRef.current.toDataURL('image/png', 1.0);
      
      const link = document.createElement('a');
      link.download = `space-weather-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
      
      toast.success('Screenshot saved');
    } catch (error) {
      toast.error('Failed to capture screenshot');
      console.error('Screenshot error:', error);
    }
  };

  return (
    <button
      onClick={handleScreenshot}
      className="hud-panel p-3 flex items-center gap-2 hover:bg-primary/10 transition-colors group animate-fade-in-up"
      style={{ animationDelay: '0.2s' }}
      title="Export Screenshot"
    >
      <Camera size={18} className="text-muted-foreground group-hover:text-primary transition-colors" />
      <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
        Export
      </span>
    </button>
  );
};
