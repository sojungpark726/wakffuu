import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import { apiMiddleware } from "./server/node.ts";

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

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
    // 앱(index.html) + 소개 페이지(intro.html). 체험판 빌드는 앱 한 장만
    build:
      mode === "trial" ? {} : { rollupOptions: { input: { main: page("./index.html"), intro: page("./intro.html") } } },
    server: { port: 5173 },
  };
});
