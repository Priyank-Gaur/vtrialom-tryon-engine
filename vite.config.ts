import { defineConfig } from "vitest/config";

export default defineConfig({
  // Serve from the project root
  root: ".",

  // Static assets served from /public
  publicDir: "public",

  server: {
    port: 5173,
    // Required for webcam access — HTTPS or localhost
    host: "localhost",
    open: false,
  },

  build: {
    outDir: "dist",
    target: "esnext",
    sourcemap: true,
  },

  // Vitest configuration lives here alongside the Vite config
  test: {
    globals: true,
    environment: "jsdom",
    include: ["tests/**/*.{test,spec}.ts", "src/**/*.{test,spec}.ts"],
    coverage: {
      reporter: ["text", "html"],
    },
  },

  // Ensure WASM files from @mediapipe/tasks-vision are served correctly
  optimizeDeps: {
    exclude: ["@mediapipe/tasks-vision"],
  },
});

