import { defineConfig } from "vitest/config";

export default defineConfig({
  // Serve from the project root
  root: ".",

  // Static assets served from /public
  publicDir: "public",

  server: {
    port: 5173,
    // Required for webcam access — HTTPS or localhost
    host: true,
    allowedHosts: true,
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

  plugins: [
    {
      name: "fal-token-proxy",
      configureServer(server) {
        server.middlewares.use("/api/fal/token", async (req, res) => {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Method Not Allowed" }));
            return;
          }

          let body = "";
          req.on("data", (chunk) => {
            body += chunk;
          });

          req.on("end", async () => {
            try {
              const parsed = JSON.parse(body || "{}");
              let apiKey = (parsed.apiKey || "").trim();
              if (apiKey.startsWith("Key ")) {
                apiKey = apiKey.slice(4).trim();
              }

              if (!apiKey) {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: "Missing fal.ai API key" }));
                return;
              }

              const modelApp = (parsed.model || "decart/lucy2-vton/realtime").trim();

              const falRes = await fetch("https://rest.fal.ai/tokens/realtime", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Key ${apiKey}`,
                },
                body: JSON.stringify({
                  app: modelApp,
                }),
              });

              const data = await falRes.json().catch(() => ({}));
              res.statusCode = falRes.status;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify(data));
            } catch (err) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: (err as Error).message }));
            }
          });
        });
      },
    },
  ],
});

