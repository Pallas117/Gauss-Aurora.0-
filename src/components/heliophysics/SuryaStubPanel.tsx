/**
 * Minimal stub panel for Surya solar model. Shown only when VITE_FEATURE_SURYA_STUB is set.
 * See docs/SURYA_INTEGRATION.md.
 */

import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSuryaForecast } from "@/hooks/useSuryaForecast";

export function SuryaStubPanel() {
  const { data, isStub, error, loading, fetchForecast } = useSuryaForecast();

  useEffect(() => {
    fetchForecast();
  }, [fetchForecast]);

  return (
    <Card data-testid="surya-stub-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Solar model (Surya)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && <p className="text-muted-foreground text-xs">Loading…</p>}
        {error && <p className="text-destructive text-xs">{error}</p>}
        {data && (
          <p className="text-muted-foreground text-xs">
            {isStub ? "Surya (stub) — real inference not wired yet." : `Model: ${data.model}, horizon: ${data.horizonHours}h`}
          </p>
        )}
        <Button variant="outline" size="sm" onClick={fetchForecast} disabled={loading}>
          Refresh
        </Button>
      </CardContent>
    </Card>
  );
}
