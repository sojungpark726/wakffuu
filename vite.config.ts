import { defineConfig, loadEnv } from "vite";
import { apiMiddleware } from "./server/node.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const keys = {
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    DAILY_LIMIT: env.DAILY_LIMIT,
    PER_IP_DAILY: env.PER_IP_DAILY,
  };
  return {
    plugins: [
      {
        name: "wakppu-api",
        configureServer(server) {
          server.middlewares.use(apiMiddleware(keys));
        },
        configurePreviewServer(server) {
          server.middlewares.use(apiMiddleware(keys));
        },
      },
    ],
    server: { port: 5173 },
  };
});
