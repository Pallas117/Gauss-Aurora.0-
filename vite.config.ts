import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import cesium from "vite-plugin-cesium";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const publicEnv = loadEnv("public", process.cwd(), "");
  for (const [key, value] of Object.entries(publicEnv)) {
    if (!key.startsWith("VITE_") || value.trim().length === 0) {
      continue;
    }
    if (!env[key]?.trim()) {
      env[key] = value;
    }
    if (!process.env[key]?.trim()) {
      process.env[key] = value;
    }
  }
  const publicClientEnv = Object.fromEntries(
    Object.entries(env).filter(
      ([key, value]) => key.startsWith("VITE_") && typeof value === "string" && value.trim().length > 0,
    ),
  );
  const frontendHost =
    env.FRONTEND_HOST?.trim() ||
    env.VITE_DEV_HOST?.trim() ||
    process.env.FRONTEND_HOST?.trim() ||
    process.env.VITE_DEV_HOST?.trim() ||
    "0.0.0.0";
  const backendProxyTarget =
    env.DEV_API_PROXY_URL?.trim() ||
    env.VITE_DEV_API_URL?.trim() ||
    process.env.DEV_API_PROXY_URL?.trim() ||
    process.env.VITE_DEV_API_URL?.trim() ||
    "http://127.0.0.1:3001";

  return {
    plugins: [
      react(),
      cesium(),
    ],
    server: {
      host: frontendHost,
      port: 8080,
      strictPort: true,
      cors: false,
      proxy: {
        "/api": {
          target: backendProxyTarget,
          changeOrigin: true,
        },
        "/health": {
          target: backendProxyTarget,
          changeOrigin: true,
        },
        "/ws": {
          target: backendProxyTarget.replace("http", "ws"),
          ws: true,
          changeOrigin: true,
        },
      },
    },
    resolve: {
      alias: [
        {
          find: "@",
          replacement: path.resolve(__dirname, "./src"),
        },
      ],
    },
    define: {
      "globalThis.__GAUSS_PUBLIC_ENV__": JSON.stringify(publicClientEnv),
    },
    build: {
      rollupOptions: {
        output: {
          // Simplified output for debugging hang
        },
      },
    },
  };
});
