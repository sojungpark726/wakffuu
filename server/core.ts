// 왁뿌 시뮬레이터 API — 웹 표준(Request/Response)만 써서 로컬(Vite)과 Cloudflare Workers 가 같은 코드를 쓴다.
// 저장소·수량·요청 제한은 플랫폼마다 다르게 끼워 넣는다 (server/node.ts, worker/index.ts).

export interface ApiEnv {
  OPENAI_API_KEY?: string;
  /** 하루 한정 수량 (전체, 기본 100) */
  DAILY_LIMIT?: string;
  /** 한 사람(IP)이 하루에 만들 수 있는 수. 비워 두면 한 사람 제한 없음 (전체 한정만) */
  PER_IP_DAILY?: string;
  /** 테스트용 OpenAI 주소 바꾸기 (비워 두면 진짜 OpenAI) */
  OPENAI_BASE_URL?: string;
}

/** 날짜별 카운터. take 는 전부 한도 안일 때만 한꺼번에 1씩 올린다 (원자적이어야 함) */
export interface Counters {
  /** 성공하면 null, 한도에 걸리면 걸린 키 */
  take(day: string, keys: [key: string, limit: number][]): Promise<string | null>;
  refund(day: string, keys: string[]): Promise<void>;
  used(day: string, key: string): Promise<number>;
}

export interface ShareStore {
  put(id: string, value: string, ttlSeconds: number): Promise<void>;
  get(id: string): Promise<string | null>;
}

export interface Platform {
  env: ApiEnv;
  counters: Counters;
  shares: ShareStore;
  /** 분당 요청 제한. 막혔으면 false */
  allow(kind: "post" | "get", key: string): Promise<boolean>;
  clientIp: string;
}

const DEFAULT_DAILY_LIMIT = 100;
const SHARES_PER_IP_DAILY = 30;
const SHARE_TTL_SECONDS = 30 * 24 * 60 * 60;

const WAXIFY_MODEL = "gpt-image-1-mini";
const OPENAI_TIMEOUT_MS = 120_000;

const MAX_BODY_BYTES = 2_500_000;
const MAX_IMAGE_B64 = 2_000_000; // 1024 JPEG 는 보통 0.2~0.5MB
const MAX_SHELL_B64 = 1_500_000; // 512x512 PNG
const MAX_SHELL_SIDE = 1024;
const ID = /^[A-Za-z0-9_-]{6,20}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
// 제어 문자와 글자 방향을 뒤집는 문자 (이름 위장 방지)
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

type Json = Record<string, unknown>;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

// 왁스는 "색 없는 투명 광택"으로만 — "파스텔 왁스로 덮어라"라고 하면 인물 사진이 한 가지 색 양초 인형처럼 나왔다.
// 색 지키기를 사람 기준으로만 적으면 과일·물건에 얼굴·옷을 지어내서, 대상 종류별로 나누고 "없는 것 덧붙이지 않기"를 둔다.
const WAXIFY_PROMPT = (subject: string) =>
  `Turn the subject of this image${subject ? ` (${subject})` : ""} into a "wax crush toy": a palm-sized squishy shaped like the subject itself. Keep the subject's own silhouette and outline — do not turn it into a sphere — puffed up with soft rounded edges.

Stay faithful to what is actually in the photo: do not add anything that is not there. Never give a face, eyes, mouth, hair, clothes or a character body to an object, food, fruit or plant.

Colors are the top priority: keep every original color from the photo in the same places, each part keeping its own distinct color, like a full-color hand-painted vinyl figure. For a person: their real skin tone, hair, eyes, lips, clothing and accessories. For an animal: its fur and markings. For an object, food or plant: its own colors, patterns and details. Do not recolor, tint, desaturate or unify the colors — never make it a single-color or monochrome pastel statue.

The wax is a thin, clear, colorless glossy glaze over those colors: it only adds a smooth shine and a slight soft translucency at the edges, and never changes any hue.

Keep it recognizable: face, features and patterns stay clear. Single object, centered, front view, filling about 85% of the frame, soft studio lighting with one gentle highlight. Transparent background. No text, no hands, no props, no ground shadow.`;

// ---------- 진입점 ----------

export async function handleApi(request: Request, p: Platform): Promise<Response> {
  const url = new URL(request.url);
  const route = url.pathname;
  try {
    if (request.method === "GET" && route === "/api/status") return await status(p);
    // 공유한 볼 받기: /api/share?id=… (Vercel 은 함수 하나가 경로 하나) 또는 /api/share/…
    if (request.method === "GET" && route === "/api/share") return await loadShared(url.searchParams.get("id") ?? "", p);
    if (request.method === "GET" && route.startsWith("/api/share/")) {
      return await loadShared(decodePath(route.slice("/api/share/".length)), p);
    }
    if (route !== "/api/waxify" && route !== "/api/share") throw new HttpError(404, "not_found");
    if (request.method !== "POST") throw new HttpError(405, "method");

    // 다른 사이트에서 방문자 브라우저를 빌려 부르는 것 막기
    if (!sameOrigin(request)) throw new HttpError(403, "forbidden");
    if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) {
      throw new HttpError(415, "bad_body");
    }
    if (!(await p.allow("post", ipBucket(p.clientIp)))) throw new HttpError(429, "rate_limited");

    const body = await readJson(request);
    return route === "/api/waxify" ? await waxify(body, p) : await saveShared(body, p);
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.code });
    console.error("[api]", route, err);
    return json(500, { error: "internal" });
  }
}

// ---------- 핸들러 ----------

async function status(p: Platform): Promise<Response> {
  const limit = dailyLimit(p.env);
  const used = await p.counters.used(kstDay(), "waxify");
  return json(200, { openai: !!p.env.OPENAI_API_KEY, limit, remaining: Math.max(0, limit - used) });
}

async function waxify(body: Json, p: Platform): Promise<Response> {
  const key = p.env.OPENAI_API_KEY;
  if (!key) {
    console.warn("[api] OPENAI_API_KEY 가 없어서 왁뿌볼을 만들 수 없음");
    throw new HttpError(503, "unavailable");
  }
  const img = parseDataUrl(body.image, /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/, MAX_IMAGE_B64);
  if (!img) throw new HttpError(400, "bad_image");
  const subject = typeof body.subject === "string" ? clean(body.subject, 40).replace(/["()]/g, "") : "";

  const day = kstDay();
  const who = await ipHash(p.clientIp, day);
  const usage: [string, number][] = [["waxify", dailyLimit(p.env)]];
  const perIp = perIpLimit(p.env);
  if (perIp !== null) usage.push([`waxify:${who}`, perIp]);
  const blocked = await p.counters.take(day, usage);
  if (blocked) throw new HttpError(429, blocked === "waxify" ? "sold_out" : "my_limit");
  const refund = () => p.counters.refund(day, usage.map(([k]) => k));

  const ext = img.mediaType.split("/")[1];
  const form = new FormData();
  form.set("model", WAXIFY_MODEL);
  form.set("image", new File([base64ToBytes(img.base64)], `subject.${ext}`, { type: img.mediaType }));
  form.set("prompt", WAXIFY_PROMPT(subject));
  form.set("background", "transparent");
  form.set("output_format", "png");
  form.set("quality", "medium");
  form.set("size", "1024x1024");
  form.set("user", who);

  let res: Response;
  try {
    res = await fetch(`${p.env.OPENAI_BASE_URL || "https://api.openai.com/v1"}/images/edits`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    });
  } catch (err) {
    // 시간 초과·연결 끊김은 OpenAI 쪽에서 이미 만들었을 수도 있어서 수량을 돌려주지 않는다
    console.error("[api] openai 연결 실패", err);
    throw new HttpError(504, "upstream");
  }

  if (!res.ok) {
    // 4xx·5xx 는 요금이 안 나가므로 수량을 돌려준다
    await refund();
    const detail = (await res.json().catch(() => null)) as { error?: { code?: string; type?: string } } | null;
    const code = detail?.error?.code ?? detail?.error?.type ?? "";
    console.error(`[api] openai ${res.status} ${code}`);
    if (res.status === 400 && code === "moderation_blocked") throw new HttpError(422, "moderation_blocked");
    if (res.status === 400) throw new HttpError(502, "api_error");
    if (res.status === 429 && code !== "insufficient_quota") throw new HttpError(503, "busy");
    if (res.status >= 500) throw new HttpError(502, "upstream");
    // 키 오류·크레딧 소진 등: 사용자에게는 원인을 알리지 않는다
    throw new HttpError(503, "unavailable");
  }

  const data = (await res.json().catch(() => null)) as { data?: { b64_json?: string }[] } | null;
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) {
    console.error("[api] openai 응답에 이미지 없음");
    throw new HttpError(502, "upstream");
  }
  return json(200, { image: `data:image/png;base64,${b64}` });
}

async function saveShared(body: Json, p: Platform): Promise<Response> {
  const shell = parseDataUrl(body.shell, /^data:(image\/png);base64,([A-Za-z0-9+/]+={0,2})$/, MAX_SHELL_B64);
  if (!shell || !isSmallPng(shell.base64)) throw new HttpError(400, "bad_shell");

  const day = kstDay();
  const blocked = await p.counters.take(day, [[`share:${await ipHash(p.clientIp, day)}`, SHARES_PER_IP_DAILY]]);
  if (blocked) throw new HttpError(429, "rate_limited");

  const id = randomId();
  const value = JSON.stringify({
    shell: `data:image/png;base64,${shell.base64}`,
    design: sanitizeDesign(body.design),
    createdAt: Date.now(),
  });
  await p.shares.put(id, value, SHARE_TTL_SECONDS);
  return json(200, { id });
}

async function loadShared(id: string, p: Platform): Promise<Response> {
  if (!(await p.allow("get", ipBucket(p.clientIp)))) throw new HttpError(429, "rate_limited");
  if (!ID.test(id)) throw new HttpError(400, "bad_id");
  const value = await p.shares.get(id);
  if (!value) throw new HttpError(404, "not_found");
  // 저장한 JSON 을 그대로 내려보낸다 (다시 파싱하지 않음)
  return new Response(value, { status: 200, headers: { ...JSON_HEADERS, "cache-control": "private, max-age=86400" } });
}

// ---------- 도우미 ----------

function decodePath(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(400, "bad_id");
  }
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};

function json(status: number, body: Json): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, "cache-control": "no-store" } });
}

function sameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function readJson(request: Request): Promise<Json> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, "too_large");
  if (!request.body) throw new HttpError(400, "bad_body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new HttpError(413, "too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  try {
    const v: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Json;
  } catch {
    /* 아래에서 400 */
  }
  throw new HttpError(400, "bad_body");
}

function parseDataUrl(v: unknown, re: RegExp, maxB64: number): { mediaType: string; base64: string } | null {
  if (typeof v !== "string" || v.length > maxB64 + 40) return null;
  const m = re.exec(v);
  return m && m[2].length <= maxB64 ? { mediaType: m[1], base64: m[2] } : null;
}

/** PNG 서명과 IHDR 크기만 앞부분으로 확인 (아무 파일이나 올리지 못하게) */
function isSmallPng(base64: string): boolean {
  let head: Uint8Array;
  try {
    head = base64ToBytes(base64.slice(0, 44));
  } catch {
    return false;
  }
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (head.length < 24 || sig.some((b, i) => head[i] !== b)) return false;
  if (String.fromCharCode(...head.slice(12, 16)) !== "IHDR") return false;
  const view = new DataView(head.buffer, head.byteOffset);
  const w = view.getUint32(16), h = view.getUint32(20);
  return w > 0 && h > 0 && w <= MAX_SHELL_SIDE && h <= MAX_SHELL_SIDE;
}

function sanitizeDesign(v: unknown): Json {
  const raw = (typeof v === "object" && v ? v : {}) as Json;
  const str = (x: unknown, fallback: string, max: number) => (typeof x === "string" && clean(x, max)) || fallback;
  const pick = <T extends string>(x: unknown, options: readonly T[], fallback: T): T =>
    options.includes(x as T) ? (x as T) : fallback;
  return {
    subject: str(raw.subject, "", 20),
    name: str(raw.name, "말랑 왁뿌볼", 20),
    emoji: str(raw.emoji, "🫧", 4),
    waxColor: typeof raw.waxColor === "string" && HEX.test(raw.waxColor) ? raw.waxColor : "#ffd9c2",
    fillingType: pick(raw.fillingType, ["slime", "clay", "glitter"] as const, "slime"),
    fillingColor: typeof raw.fillingColor === "string" && HEX.test(raw.fillingColor) ? raw.fillingColor : "#8fd3ff",
    crunch: pick(raw.crunch, ["soft", "crispy", "hard"] as const, "crispy"),
  };
}

/** 위험한 문자 빼고, 글자(코드 포인트) 단위로 자르기 */
function clean(s: string, max: number): string {
  return Array.from(s.replace(UNSAFE_CHARS, "").trim()).slice(0, max).join("");
}

function dailyLimit(env: ApiEnv): number {
  return intVar(env.DAILY_LIMIT, DEFAULT_DAILY_LIMIT);
}
/** 한 사람 제한: 숫자를 넣었을 때만 건다 */
function perIpLimit(env: ApiEnv): number | null {
  const n = intVar(env.PER_IP_DAILY, -1);
  return n < 0 ? null : n;
}
function intVar(v: string | undefined, fallback: number): number {
  const n = v?.trim() ? Math.floor(Number(v)) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** 한국 시간 날짜 (YYYY-MM-DD) */
export function kstDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
}

/** IPv6 는 /64 단위로 묶는다 (주소를 바꿔 가며 우회하지 못하게) */
function ipBucket(ip: string): string {
  if (!ip.includes(":") || ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1) || "unknown";
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return full.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, "")).join(":");
}

/** 하루마다 바뀌는 IP 지문 (IP 원본은 저장하지 않는다) */
async function ipHash(ip: string, day: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`wakppu:${day}:${ipBucket(ip)}`));
  return base64url(new Uint8Array(digest).slice(0, 12));
}

function randomId(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(9)));
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
