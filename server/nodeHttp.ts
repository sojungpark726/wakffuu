// Node 의 req/res 와 웹 표준 Request/Response 를 오가는 도우미 — 로컬(Vite)과 Vercel 함수가 같이 쓴다.
import type { IncomingMessage, ServerResponse } from "node:http";

/** 본문을 끝까지 받는다. 너무 크면 null (끊지 않고 받아 버려야 413 응답이 클라이언트에 닿는다) */
export function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        chunks.length = 0;
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(size > maxBytes ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function toRequest(req: IncomingMessage, url: URL, body: Buffer | null): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(", "));
  }
  return new Request(url, { method: req.method, headers, body: body ? new Uint8Array(body) : undefined });
}

export async function sendResponse(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await response.arrayBuffer()));
}

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}
