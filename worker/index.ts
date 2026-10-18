// Cloudflare Workers 배포판: /api/* 는 server/core.ts 가 처리하고, 나머지는 정적 파일(dist)이 나간다.
// 하루 한정 수량과 공유한 왁뿌볼은 Durable Object(SQLite) 하나에 담는다 — 한 줄씩 차례로 처리돼서 동시에 눌러도 수량이 넘치지 않는다.
import { DurableObject } from "cloudflare:workers";
import { handleApi, type ApiEnv } from "../server/core.ts";

export class WakppuStore extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, key TEXT NOT NULL, used INTEGER NOT NULL, PRIMARY KEY (day, key))",
    );
    this.sql.exec("CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS shares_expiry ON shares (expires_at)");
  }

  // ---------- 하루 수량 ----------

  take(day: string, keys: [string, number][]): string | null {
    this.sql.exec("DELETE FROM usage WHERE day < ?", day);
    for (const [key, limit] of keys) {
      if (this.count(day, key) >= limit) return key;
    }
    for (const [key] of keys) {
      this.sql.exec(
        "INSERT INTO usage (day, key, used) VALUES (?, ?, 1) ON CONFLICT (day, key) DO UPDATE SET used = used + 1",
        day,
        key,
      );
    }
    return null;
  }

  refund(day: string, keys: string[]): void {
    for (const key of keys) {
      this.sql.exec("UPDATE usage SET used = MAX(0, used - 1) WHERE day = ? AND key = ?", day, key);
    }
  }

  used(day: string, key: string): number {
    return this.count(day, key);
  }

  private count(day: string, key: string): number {
    const row = this.sql.exec<{ used: number }>("SELECT used FROM usage WHERE day = ? AND key = ?", day, key).toArray()[0];
    return row?.used ?? 0;
  }

  // ---------- 공유한 왁뿌볼 ----------

  putShare(id: string, value: string, expiresAt: number): void {
    this.sql.exec("DELETE FROM shares WHERE expires_at < ?", Date.now());
    this.sql.exec("INSERT OR REPLACE INTO shares (id, value, expires_at) VALUES (?, ?, ?)", id, value, expiresAt);
  }

  getShare(id: string): string | null {
    const row = this.sql
      .exec<{ value: string }>("SELECT value FROM shares WHERE id = ? AND expires_at > ?", id, Date.now())
      .toArray()[0];
    return row?.value ?? null;
  }
}

/** 설정(wrangler.jsonc)에 있는 것 + 대시보드에서 넣는 비밀 변수 */
type AppEnv = Env & Pick<ApiEnv, "OPENAI_API_KEY" | "OPENAI_BASE_URL">;

export default {
  async fetch(request, env: AppEnv) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const counters = env.STORE.get(env.STORE.idFromName("counters"));
    const shares = env.STORE.get(env.STORE.idFromName("shares"));
    return handleApi(request, {
      env,
      counters: {
        take: (day, keys) => counters.take(day, keys),
        refund: (day, keys) => counters.refund(day, keys),
        used: (day, key) => counters.used(day, key),
      },
      shares: {
        put: (id, value, ttl) => shares.putShare(id, value, Date.now() + ttl * 1000),
        get: (id) => shares.getShare(id),
      },
      allow: async (kind, key) => {
        const limiter = kind === "post" ? env.RL_POST : env.RL_GET;
        if (!limiter) return true;
        try {
          return (await limiter.limit({ key })).success;
        } catch (err) {
          console.warn("[api] rate limiter", err);
          return true; // 제한기가 잠깐 안 되더라도 서비스는 계속
        }
      },
      clientIp: request.headers.get("cf-connecting-ip") ?? "unknown",
    });
  },
} satisfies ExportedHandler<AppEnv>;
