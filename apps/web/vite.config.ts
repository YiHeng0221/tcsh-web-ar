import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type PluginOption } from "vite";
import mkcert from "vite-plugin-mkcert";

// Opt-in HTTPS for Mode A iPhone testing — see docs/dev/https-local.md
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // loadEnv reads .env files; process.env catches shell-level VITE_HTTPS=1
  const useHttps = env.VITE_HTTPS === "1" || process.env.VITE_HTTPS === "1";

  const plugins: PluginOption[] = [react(), tailwindcss()];
  if (useHttps) {
    plugins.push(mkcert()); // see docs/dev/https-local.md for CA trust setup
  }

  return {
    plugins,
    resolve: {
      alias: { "@": path.resolve(__dirname, "src") },
    },
    worker: {
      // The solvePnP worker dynamic-imports the OpenCV chunk; rollup can
      // only code-split workers in ES format (default iife errors out).
      format: "es" as const,
    },
    server: {
      // HTTPS-only: bind 0.0.0.0 so phones on LAN can reach the dev server
      host: useHttps ? true : undefined,
      port: 5173,
      proxy: {
        "/api": {
          target: "http://localhost:8000",
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ""),
        },
      },
    },
  };
});
