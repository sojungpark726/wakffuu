// 체험판 (claude.ai 아티팩트로 올리는 버전)
// 아티팩트에는 서버가 없어서 사진으로 새로 만들기·공유·하루 한정 수량은 빠지고,
// 미리 준비한 왁뿌볼 9종으로 금 가기·던지기·슬라임·희귀볼·보관함을 체험한다.
import { renderBasicBall, SHELL_SIZE } from "./ballRender";
import type { BallDesign } from "./design";
import { drawJellySubject, JELLY_WAX, type JellyKind } from "./jellyShapes";

/** `vite build --mode trial` 로 만든 체험판인지 */
export const TRIAL = import.meta.env.MODE === "trial";

const ball = (
  kind: JellyKind,
  subject: string,
  name: string,
  emoji: string,
  fillingType: BallDesign["fillingType"],
  fillingColor: string,
  crunch: BallDesign["crunch"],
) => ({ kind, design: { subject, name, emoji, waxColor: JELLY_WAX[kind], fillingType, fillingColor, crunch } as BallDesign });

export const TRIAL_BALLS = [
  ball("butter", "버터", "꾸덕 버터 왁뿌볼", "🧈", "clay", "#fff1a8", "soft"),
  ball("strawberry", "딸기", "크런치 딸기 왁뿌볼", "🍓", "slime", "#ff8fb1", "crispy"),
  ball("apple", "청사과", "유리 청사과 왁뿌볼", "🍏", "glitter", "#c8f27a", "hard"),
  ball("pill", "알약", "말랑 알약 왁뿌볼", "💊", "slime", "#ffd1e3", "soft"),
  ball("clover", "클로버", "오렌지 클로버 왁뿌볼", "🍀", "glitter", "#ffd27a", "crispy"),
  ball("donut", "도넛", "보라 도넛 왁뿌볼", "🍩", "slime", "#e2ccff", "soft"),
  ball("cube", "큐브", "멜론 큐브 왁뿌볼", "🧊", "clay", "#c8f5a0", "hard"),
  ball("triangle", "세모", "소다 세모 왁뿌볼", "🔷", "slime", "#9fd8ff", "crispy"),
  ball("cloud", "구름", "복숭아 구름 왁뿌볼", "☁️", "slime", "#ffc3b3", "soft"),
];

const shells = new Map<string, HTMLCanvasElement>();
/** 준비된 왁뿌볼 껍질 (한 번 그리면 재사용) */
export function trialShell(kind: JellyKind, size = SHELL_SIZE): HTMLCanvasElement {
  const key = `${kind}:${size}`;
  let c = shells.get(key);
  if (!c) {
    c = renderBasicBall(drawJellySubject(kind), JELLY_WAX[kind], size);
    shells.set(key, c);
  }
  return c;
}

/** 아티팩트 뷰어가 주는 기능 (아티팩트 밖이거나 못 쓰면 null) */
export async function useCapability<T>(name: string): Promise<T | null> {
  const w = window as unknown as { claude?: { use?: (n: string) => Promise<T | null> } };
  try {
    return (await w.claude?.use?.(name)) ?? null;
  } catch {
    return null;
  }
}
