import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type PluginOption } from "vite";
import mkcert from "vite-plugin-mkcert";

// HTTPS in dev is opt-in (`VITE_HTTPS=1`). Mode A's QR scanner uses
// `getUserMedia`, and iOS requires `DeviceOrientationEvent.requestPermission`
// — both demand a secure context, so we need real HTTPS to test on a
// physical iPhone over LAN. See `docs/dev/https-local.md`.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const useHttps = env.VITE_HTTPS === "1" || process.env.VITE_HTTPS === "1";

  const plugins: PluginOption[] = [react(), tailwindcss()];
  if (useHttps) {
    // mkcert generates a locally-trusted cert via the mkcert root CA.
    // Install the CA on your phone once and the dev server is fully
    // trusted on iOS Safari — no `Not Secure` warning to click through.
    plugins.push(mkcert());
  }

  return {
    plugins,
    resolve: {
      alias: { "@": path.resolve(__dirname, "src") },
    },
    server: {
      host: true, // bind 0.0.0.0 so phones on the same LAN can reach us
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
