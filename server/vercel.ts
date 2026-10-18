// Vercel 배포판: /api/status · /api/waxify · /api/share 함수. scripts/build-vercel.mjs 가 한 파일로 묶어 함수로 올린다.
// 저장소는 Upstash Redis (server/redis.ts), API 본체는 로컬·Cloudflare 와 같은 server/core.ts.
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleApi, type ApiEnv } from "./core.ts";
import { readBody, sendJson, sendResponse, toRequest } from "./nodeHttp.ts";
import { findRedisConfig, Redis, RedisCounters, redisAllow, RedisShares } from "./redis.ts";

const MAX_BODY_BYTES = 3_000_000; // Vercel 함수 본문 한도(4.5MB)보다 작게

const redisConfig = findRedisConfig(process.env);
const redis = redisConfig ? new Redis(redisConfig) : null;
const counters = redis ? new RedisCounters(redis) : null;
const shares = redis ? new RedisShares(redis) : null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const host = header(req, "x-forwarded-host") ?? header(req, "host") ?? "localhost";
  const url = new URL(req.url ?? "/", `https://${host}`);
  try {
    if (!redis || !counters || !shares) {
      console.error("[api] Upstash Redis 가 연결되지 않음 (Storage 탭에서 연결)");
      // 화면에는 "지금은 만들 수 없어요" 로만 보인다
      if (url.pathname === "/api/status") return sendJson(res, 200, { openai: false, limit: 0, remaining: 0 });
      return sendJson(res, 503, { error: "unavailable" });
    }
    const body = req.method === "POST" ? await readBody(req, MAX_BODY_BYTES) : null;
    if (req.method === "POST" && !body) return sendJson(res, 413, { error: "too_large" });
    const env: ApiEnv = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      DAILY_LIMIT: process.env.DAILY_LIMIT,
      PER_IP_DAILY: process.env.PER_IP_DAILY,
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    };
    const response = await handleApi(toRequest(req, url, body), {
      env,
      counters,
      shares,
      allow: (kind, key) => redisAllow(redis, kind, key, kind === "post" ? 20 : 120),
      // Vercel 이 덮어쓰는 헤더라 방문자가 꾸며 보낼 수 없다
      clientIp: header(req, "x-real-ip") ?? header(req, "x-forwarded-for")?.split(",")[0].trim() ?? "unknown",
    });
    await sendResponse(res, response);
  } catch (err) {
    console.error("[api]", url.pathname, err);
    if (!res.headersSent) sendJson(res, 500, { error: "internal" });
  }
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v) || undefined;
}
