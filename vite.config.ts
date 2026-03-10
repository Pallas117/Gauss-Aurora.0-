import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

/** Strip sourceMappingURL from node_modules so missing .map files don't cause console noise. */
function stripDependencySourceMaps(): import("vite").Plugin {
  return {
    name: "strip-dependency-source-maps",
    apply: "serve" as const,
    transform(code: string, id: string) {
      if (!id.includes("node_modules")) return null;
      if (!code.includes("sourceMappingURL")) return null;
      return {
        code: code.replace(/\n?\/\/# sourceMappingURL=.*$/gm, ""),
        map: null,
      };
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const frontendHost =
    env.FRONTEND_HOST?.trim() ||
    env.VITE_DEV_HOST?.trim() ||
    process.env.FRONTEND_HOST?.trim() ||
    process.env.VITE_DEV_HOST?.trim() ||
    "0.0.0.0";

  return {
    plugins: [
      react(),
      stripDependencySourceMaps(),
      mode === "development" && componentTagger(),
    ].filter(Boolean),
    server: {
      host: frontendHost,
      port: 8080,
      strictPort: true,
      cors: false,
    },
    resolve: {
      alias: [
        {
          find: "@",
          replacement: path.resolve(__dirname, "./src"),
        },
      ],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalizedId = id.split(path.sep).join("/");

            // System-of-systems split for app source modules.
            if (
              normalizedId.includes("/src/pages/SDAPage.tsx") ||
              normalizedId.includes("/src/components/scene/SpaceScene.tsx")
            ) {
              return "subsystem-space-shell";
            }
            if (normalizedId.includes("/src/pages/HeliophysicsDashboard.tsx")) {
              return "subsystem-space-heliophysics";
            }
            if (normalizedId.includes("/src/components/orbit/") || normalizedId.includes("/src/pages/OrbitLab.tsx")) {
              return "subsystem-space-orbit";
            }
            if (normalizedId.includes("/src/pages/CommandPage.tsx") || normalizedId.includes("/src/hooks/useOpsCommandSnapshot.ts")) {
              return "subsystem-command";
            }
            if (normalizedId.includes("/src/pages/SystemsPage.tsx") || normalizedId.includes("/src/pages/IntelPage.tsx")) {
              return "subsystem-ops";
            }
            if (normalizedId.includes("/src/pages/Index.tsx") || normalizedId.includes("/src/pages/LandingPage.tsx")) {
              return "subsystem-landing";
            }

            if (!normalizedId.includes("node_modules")) return undefined;
            if (
              normalizedId.includes("/react/") ||
              normalizedId.includes("/react-dom/") ||
              normalizedId.includes("react-router") ||
              normalizedId.includes("@remix-run")
            ) {
              return "core-react";
            }
            if (normalizedId.includes("recharts")) {
              return "charts-vendor";
            }
            if (normalizedId.includes("@supabase")) {
              return "supabase-vendor";
            }
            if (
              normalizedId.includes("@radix-ui") ||
              normalizedId.includes("vaul") ||
              normalizedId.includes("cmdk") ||
              normalizedId.includes("embla-carousel")
            ) {
              return "radix-vendor";
            }
            if (normalizedId.includes("@tanstack/react-query")) {
              return "query-vendor";
            }
            if (normalizedId.includes("react-hook-form") || normalizedId.includes("@hookform/resolvers") || normalizedId.includes("zod")) {
              return "forms-vendor";
            }
            if (normalizedId.includes("lucide-react")) {
              return "icons-vendor";
            }
            if (normalizedId.includes("date-fns")) {
              return "date-vendor";
            }
            if (normalizedId.includes("next-themes")) {
              return "theme-vendor";
            }
            if (normalizedId.includes("@mui/") || normalizedId.includes("@emotion/")) {
              return "mui-vendor";
            }
            if (normalizedId.includes("react-dnd") || normalizedId.includes("react-globe.gl") || normalizedId.includes("satellite.js")) {
              return "sda-intel-vendor";
            }
            if (normalizedId.includes("/motion/")) {
              return "motion-vendor";
            }
            // Important: no monolithic fallback vendor chunk.
            // Let Rollup split residual deps per entry graph for smaller startup cost.
            return undefined;
          },
        },
      },
    },
  };
});
