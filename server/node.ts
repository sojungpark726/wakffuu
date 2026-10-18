// 로컬 개발용: Vite 개발 서버에 API(server/core.ts)를 미들웨어로 붙인다.
// 수량은 .data/usage.json, 공유한 왁뿌볼은 .data/shared/ 에 저장한다. 배포판은 worker/index.ts.
import fs from "node:fs";
import fsp from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { handleApi, type ApiEnv, type Counters, type ShareStore } from "./core.ts";

const USAGE_FILE = path.resolve(".data/usage.json");
const SHARE_DIR = path.resolve(".data/shared");
const MAX_BODY_BYTES = 3_000_000;

/** 날짜별 카운터를 파일 하나에. Node 는 한 스레드라 take 가 끝까지 끊기지 않는다 */
class FileCounters implements Counters {
  private data: { day: string; used: Record<string, number> };

  constructor(private file: string) {
    this.data = this.load();
  }

  async take(day: string, keys: [string, number][]) {
    this.roll(day);
    const blocked = keys.find(([k, limit]) => (this.data.used[k] ?? 0) >= limit);
    if (blocked) return blocked[0];
    for (const [k] of keys) this.data.used[k] = (this.data.used[k] ?? 0) + 1;
    this.save();
    return null;
  }

  async refund(day: string, keys: string[]) {
    if (this.data.day !== day) return; // 날짜가 바뀐 뒤 실패한 건 다음 날 수량을 건드리지 않는다
    for (const k of keys) this.data.used[k] = Math.max(0, (this.data.used[k] ?? 0) - 1);
    this.save();
  }

  async used(day: string, key: string) {
    this.roll(day);
    return this.data.used[key] ?? 0;
  }

  private roll(day: string) {
    if (this.data.day !== day) this.data = { day, used: {} };
  }

  private load() {
    try {
      const d = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (typeof d?.day === "string" && d.used && typeof d.used === "object") return d;
      // 예전 형식 { date, used: number }
      if (typeof d?.date === "string") return { day: d.date, used: { waxify: Number(d.used) || 0 } };
    } catch {
      /* 파일이 없으면 새로 */
    }
    return { day: "", used: {} };
  }

  private save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file); // 쓰다가 꺼져도 파일이 깨지지 않게
  }
}

class DiskShares implements ShareStore {
  constructor(private dir: string) {}

  async put(id: string, value: string, ttlSeconds: number) {
    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.writeFile(this.file(id), JSON.stringify({ expiresAt: Date.now() + ttlSeconds * 1000, value }));
  }

  async get(id: string) {
    try {
      const { expiresAt, value } = JSON.parse(await fsp.readFile(this.file(id), "utf8"));
      if (typeof value !== "string" || Date.now() > expiresAt) return null;
      return value;
    } catch {
      return null;
    }
  }

  private file(id: string) {
    return path.join(this.dir, `${id}.json`);
  }
}

/** IP별 분당 요청 수. 1분 지난 기록은 지운다 */
class MinuteLimiter {
  private hits = new Map<string, { count: number; reset: number }>();

  allow(key: string, perMinute: number): boolean {
    const now = Date.now();
    if (this.hits.size > 5000) for (const [k, h] of this.hits) if (h.reset < now) this.hits.delete(k);
    const h = this.hits.get(key);
    if (!h || h.reset < now) {
      this.hits.set(key, { count: 1, reset: now + 60_000 });
      return true;
    }
    h.count += 1;
    return h.count <= perMinute;
  }
}

function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        // 끊지 않고 끝까지 받아 버려야 413 응답이 클라이언트에 닿는다
        chunks.length = 0;
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(size > MAX_BODY_BYTES ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function apiMiddleware(env: ApiEnv) {
  const counters = new FileCounters(USAGE_FILE);
  const shares = new DiskShares(SHARE_DIR);
  const posts = new MinuteLimiter();
  const gets = new MinuteLimiter();

  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (!url.pathname.startsWith("/api/")) return next();
    try {
      const body = req.method === "POST" ? await readBody(req) : null;
      if (req.method === "POST" && !body) {
        res.statusCode = 413;
        res.setHeader("content-type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ error: "too_large" }));
      }
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(", "));
      }
      const request = new Request(url, { method: req.method, headers, body: body ? new Uint8Array(body) : undefined });
      const response = await handleApi(request, {
        env,
        counters,
        shares,
        allow: async (kind, key) => (kind === "post" ? posts.allow(key, 20) : gets.allow(key, 120)),
        clientIp: req.socket.remoteAddress ?? "local",
      });
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      // 핸들러 하나가 터져도 개발 서버 전체가 죽지 않게
      console.error("[api]", url.pathname, err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: "internal" }));
      }
    }
  };
}
