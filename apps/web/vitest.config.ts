import path from "node:path";
import { defineConfig } from "vitest/config";

// The lib/ar pose math is pure (three.js vectors + injected OpenCV WASM),
// so the tests run in the default Node environment — no DOM needed. OpenCV.js
// loads its WASM under Node in ~150ms, so solve-pnp.test.ts injects the real
// `cv` rather than mocking it.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
