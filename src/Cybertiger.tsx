import { Suspense } from "react";
import { BootGuard } from "@/components/BootGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ui/ThemeProvider";
import { GaussThemeProvider } from "@/components/ThemeContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { appRouter } from "@/app/routes";
import { warnIfSupabaseEnvMissing } from "@/lib/auth-env-check";
import { MissionSnapshotProvider } from "@/hooks/useMissionSnapshot";

const RouterFallback = () => (
  <div className="p-6 text-sm text-muted-foreground">Loading mission modules…</div>
);

warnIfSupabaseEnvMissing();

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
    <ThemeProvider defaultTheme="dark" storageKey="gauss-aurora-theme" forceDark>
      <GaussThemeProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <MissionSnapshotProvider>
              <BootGuard>
                <Suspense fallback={<RouterFallback />}>
                  <RouterProvider router={appRouter} />
                </Suspense>
              </BootGuard>
            </MissionSnapshotProvider>
          </TooltipProvider>
        </QueryClientProvider>
      </GaussThemeProvider>
    </ThemeProvider>
  </ErrorBoundary>
);

export default App;
