import type { BallDesign } from "./design";

export interface ApiStatus {
  openai: boolean;
  /** AI 변환 하루 한정 수량 */
  limit: number;
  remaining: number;
}

export interface WaxifyResult {
  image: string;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    public provider?: string,
  ) {
    super(code);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `http_${res.status}`, data.provider);
  return data as T;
}

export async function getStatus(): Promise<ApiStatus> {
  try {
    const res = await fetch("/api/status");
    if (!res.ok) throw new Error();
    return await res.json();
  } catch {
    return { openai: false, limit: 0, remaining: 0 };
  }
}

export function waxify(imageDataUrl: string, subject: string): Promise<WaxifyResult> {
  return post<WaxifyResult>("/api/waxify", { image: imageDataUrl, subject });
}

/** 왁뿌볼을 공유 보관소에 올리고 id 를 받는다 */
export async function shareBall(shellPng: string, design: BallDesign): Promise<string> {
  const res = await post<{ id: string }>("/api/share", { shell: shellPng, design });
  return res.id;
}

/** 공유 링크로 받은 왁뿌볼 */
export async function fetchSharedBall(id: string): Promise<{ shell: string; design: BallDesign }> {
  const res = await fetch(`/api/share/${encodeURIComponent(id)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `http_${res.status}`);
  return data;
}

export const SOLD_OUT_MESSAGE = "오늘 한정 왁뿌볼이 모두 나갔어요.\n내일 다시 만나요!";

/** 사용자에게 보여줄 안내 (자세한 원인은 콘솔에만) */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "sold_out":
        return SOLD_OUT_MESSAGE;
      case "my_limit":
        return "오늘 만들 수 있는 왁뿌볼을 다 만들었어요.\n내일 또 만나요!";
      case "rate_limited":
      case "busy":
        return "조금 천천히! 잠시 뒤 다시 해주세요.";
      case "moderation_blocked":
        return "이 사진으로는 왁뿌볼을 만들 수 없어요.\n다른 사진으로 해보세요.";
      case "too_large":
        return "사진이 너무 커요.\n다른 사진으로 해보세요.";
      case "api_error":
        return "이 사진으로는 왁뿌볼을 만들기 어려워요.\n다른 사진으로 해보세요.";
    }
    return "지금은 왁뿌볼을 만들 수 없어요.\n잠시 후 다시 해주세요.";
  }
  return "연결이 끊겼어요.\n잠시 후 다시 해주세요.";
}
