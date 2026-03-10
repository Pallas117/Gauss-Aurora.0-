/**
 * Shown when the app is offline. Critical ops redundancy: user sees that
 * cached mission data is in use and the system is resilient to internet drops.
 */

import { WifiOff } from "lucide-react";

export interface OfflineResilienceBannerProps {
  staleData?: boolean;
  staleAgeMinutes?: number | null;
  className?: string;
}

export function OfflineResilienceBanner({
  staleData,
  staleAgeMinutes,
  className = "",
}: OfflineResilienceBannerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        "flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm " +
        className
      }
    >
      <WifiOff className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      <div>
        <p className="font-medium text-amber-800 dark:text-amber-200">
          Offline – using cached mission data
        </p>
        <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
          Operations resilient. Reconnect to refresh feeds.
          {staleData && staleAgeMinutes != null && (
            <span> Cached data from ~{Math.round(staleAgeMinutes)} min ago.</span>
          )}
        </p>
      </div>
    </div>
  );
}
