// Vercel 배포판 저장소: Upstash Redis (REST). 하루 수량·공유한 볼·분당 요청 제한을 담는다.
// 라이브러리 없이 fetch 로 부른다. Vercel 에서 Upstash 를 연결하면 *_REST_API_URL / *_REST_API_TOKEN 환경 변수가 생긴다.
import type { Counters, ShareStore } from "./core.ts";

type Command = (string | number)[];

const PREFIX = "wakppu";
const USAGE_TTL = 2 * 24 * 60 * 60; // 날짜별 카운터는 이틀 뒤 저절로 지워진다

export interface RedisConfig {
  url: string;
  token: string;
}

/** 환경 변수에서 Upstash 주소·토큰 찾기 (연결할 때 붙인 접두어가 무엇이든) */
export function findRedisConfig(env: Record<string, string | undefined>): RedisConfig | null {
  const pairs: [string, string][] = [
    ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
    ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
  ];
  for (const [name, value] of Object.entries(env)) {
    // 연결할 때 접두어를 바꿔도: 값이 Upstash REST 주소인 *_URL 이면 같은 이름의 *_TOKEN 과 짝짓는다
    const looksUpstash = /^https:\/\/[^/]+\.upstash\.io\/?$/.test(value?.trim() ?? "");
    if (name.endsWith("_REST_API_URL") || (looksUpstash && name.endsWith("URL"))) {
      pairs.push([name, name.replace(/URL$/, "TOKEN")]);
    }
  }
  for (const [u, t] of pairs) {
    const url = env[u]?.trim();
    const token = env[t]?.trim();
    if (url && token) return { url: url.replace(/\/+$/, ""), token };
  }
  return null;
}

export class Redis {
  constructor(private cfg: RedisConfig) {}

  async run<T = unknown>(command: Command): Promise<T> {
    const data = await this.post<{ result?: T; error?: string }>("", command);
    if (data.error) throw new Error(`redis: ${data.error}`);
    return data.result as T;
  }

  /** 여러 명령을 한 번에 (각 명령은 따로따로 원자적) */
  async pipeline(commands: Command[]): Promise<unknown[]> {
    const data = await this.post<{ result?: unknown; error?: string }[]>("/pipeline", commands);
    return data.map((d) => {
      if (d.error) throw new Error(`redis: ${d.error}`);
      return d.result;
    });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(this.cfg.url + path, {
      method: "POST",
      headers: { authorization: `Bearer ${this.cfg.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok && res.status !== 400) throw new Error(`redis: http ${res.status}`);
    return (await res.json()) as T;
  }
}

/**
 * 하루 수량: 먼저 전부 1씩 올리고(INCR 은 원자적), 하나라도 한도를 넘었으면 올린 만큼 되돌린다.
 * 동시에 눌러도 한도를 넘겨서 받아들이는 일은 없다 (넘친 쪽이 스스로 물러남).
 */
export class RedisCounters implements Counters {
  constructor(private redis: Redis) {}

  async take(day: string, keys: [string, number][]) {
    const names = keys.map(([k]) => this.key(day, k));
    const counts = (await this.redis.pipeline(names.flatMap((n) => [["INCR", n], ["EXPIRE", n, USAGE_TTL]]))).filter(
      (_, i) => i % 2 === 0,
    ) as number[];
    const blocked = keys.findIndex(([, limit], i) => counts[i] > limit);
    if (blocked < 0) return null;
    await this.redis.pipeline(names.map((n) => ["DECR", n]));
    return keys[blocked][0];
  }

  async refund(day: string, keys: string[]) {
    await this.redis.pipeline(keys.map((k) => ["DECR", this.key(day, k)]));
  }

  async used(day: string, key: string) {
    return Math.max(0, Number(await this.redis.run(["GET", this.key(day, key)])) || 0);
  }

  private key(day: string, key: string) {
    return `${PREFIX}:usage:${day}:${key}`;
  }
}

export class RedisShares implements ShareStore {
  constructor(private redis: Redis) {}

  async put(id: string, value: string, ttlSeconds: number) {
    await this.redis.run(["SET", `${PREFIX}:share:${id}`, value, "EX", ttlSeconds]);
  }

  async get(id: string) {
    const v = await this.redis.run<string | null>(["GET", `${PREFIX}:share:${id}`]);
    return typeof v === "string" ? v : null;
  }
}

/** 분당 요청 제한 (1분 창). 저장소가 잠깐 안 되면 막지 않는다 */
export async function redisAllow(redis: Redis, kind: string, key: string, perMinute: number): Promise<boolean> {
  const name = `${PREFIX}:rl:${kind}:${key}:${Math.floor(Date.now() / 60_000)}`;
  try {
    const [count] = (await redis.pipeline([
      ["INCR", name],
      ["EXPIRE", name, 120],
    ])) as number[];
    return count <= perMinute;
  } catch (err) {
    console.warn("[api] rate limiter", err);
    return true;
  }
}
