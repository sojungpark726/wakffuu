// 왁뿌볼 디자인을 앱이 직접 정한다 (API 호출 없음, ₩0).
// 사진의 대표색 → 맛 이름(딸기·말차·초코…) + 식감 단어로 이름을 짓고, 껍질·속재료 색도 여기서 고른다.
import { averageColor, hslToRgb, pastel, rgbToHex, rgbToHsl, type RGB } from "./imageUtil";
import type { CrunchProfile } from "./sound";
import type { FillingType } from "./waxBall";

export interface BallDesign {
  subject: string;
  name: string;
  emoji: string;
  waxColor: string;
  fillingType: FillingType;
  fillingColor: string;
  crunch: CrunchProfile;
}

// [색상환 시작 각도, 맛 이름, 이모지]
const HUES: [number, string, string][] = [
  [0, "딸기", "🍓"],
  [15, "귤", "🍊"],
  [40, "레몬", "🍋"],
  [65, "멜론", "🍈"],
  [100, "말차", "🍵"],
  [150, "민트", "🌿"],
  [185, "소다", "🫧"],
  [215, "블루베리", "🫐"],
  [250, "포도", "🍇"],
  [290, "복숭아", "🍑"],
  [335, "딸기", "🍓"],
];

// 식감 단어와 그에 맞는 껍질 소리
const TEXTURES: [string, CrunchProfile][] = [
  ["바삭", "crispy"],
  ["와삭", "hard"],
  ["단단", "hard"],
  ["말랑", "soft"],
  ["몽글", "soft"],
  ["보들", "soft"],
  ["쫀득", "crispy"],
  ["탱글", "crispy"],
  ["꾸덕", "soft"],
];

/** 대표색을 맛 이름으로 */
export function flavorOf(rgb: RGB): { word: string; emoji: string } {
  const [h, s, l] = rgbToHsl(rgb);
  if (s < 0.12) {
    if (l > 0.78) return { word: "우유", emoji: "🥛" };
    if (l < 0.25) return { word: "흑임자", emoji: "🖤" };
    return { word: "구름", emoji: "☁️" };
  }
  // 어둡고 붉은 주황 계열은 갈색 → 초코/밀크티
  if (h >= 10 && h < 50 && l < 0.45) return s < 0.5 ? { word: "밀크티", emoji: "🧋" } : { word: "초코", emoji: "🍫" };
  let pick = HUES[0];
  for (const entry of HUES) if (h >= entry[0]) pick = entry;
  return { word: pick[1], emoji: pick[2] };
}

function pickOne<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function pickFilling(): FillingType {
  const r = Math.random();
  return r < 0.6 ? "slime" : r < 0.8 ? "clay" : "glitter";
}

/** sample: 샘플 사진이면 대상 이름과 이모지를 알고 있음 */
export function designBall(cut: HTMLCanvasElement, sample?: { subject: string; emoji: string } | null): BallDesign {
  const avg = averageColor(cut);
  const flavor = flavorOf(avg);
  const [texture, crunch] = pickOne(TEXTURES);
  const [h, s] = rgbToHsl(avg);
  // 속재료는 껍질과 대비되는 보색 쪽 파스텔
  const filling = pastel(hslToRgb(h + 150 + Math.random() * 60, Math.max(0.55, s), 0.6), 0.2);
  const subject = sample?.subject ?? flavor.word;
  return {
    subject: sample?.subject ?? "",
    name: `${texture} ${subject} 왁뿌볼`,
    emoji: sample?.emoji ?? flavor.emoji,
    waxColor: rgbToHex(pastel(avg, 0.5)),
    fillingType: pickFilling(),
    fillingColor: rgbToHex(filling),
    crunch,
  };
}
