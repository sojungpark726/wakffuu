// 만화 효과음 글씨: 톡·꾹 하면 "빠작!", 끌면 "뽀득", 슬라임을 늘이면 "쭈욱" 이 작게 톡 튀어나왔다 사라진다.
// 놀이판 캔버스에 그려서 영상에도 담긴다.
import { drawPopText } from "./popText";

export type SfxKind = "crack" | "drag" | "bounce" | "slime";

const WORDS: Record<SfxKind, readonly string[]> = {
  crack: ["빠작!", "콰작!", "으직", "와작!", "바삭!", "빠직!", "우지직", "까득", "뽀각!", "쩌억"],
  drag: ["뽀득", "으직", "뿌득", "끼긱", "쓰윽"],
  bounce: ["통!", "퉁!", "콩!"],
  slime: ["쭈욱", "찌익", "쫀득", "뿌직", "쮸왑"],
};

// Y2K 젤리 색 (위 → 가운데 → 아래)
const PALETTES: readonly [string, string, string][] = [
  ["#ffd1e6", "#ff5f9e", "#ff8a5c"],
  ["#d9fff1", "#2fcf9a", "#18a6c9"],
  ["#efe1ff", "#a46bff", "#ff6fd8"],
  ["#fff6c9", "#ffb020", "#ff6b4a"],
  ["#d8f1ff", "#3fa8ff", "#7a6bff"],
];

const MAX_WORDS = 14;
const LIFE = 0.75;

interface Word {
  text: string;
  x: number;
  y: number;
  size: number;
  born: number;
  rot: number;
  colors: [string, string, string];
}

export class SfxWords {
  private list: Word[] = [];
  private last = "";

  spawn(kind: SfxKind, x: number, y: number, size: number, now: number) {
    const pool = WORDS[kind];
    let text = pool[Math.floor(Math.random() * pool.length)];
    if (text === this.last) text = pool[(pool.indexOf(text) + 1) % pool.length];
    this.last = text;
    // 누른 자리에서 조금씩 비껴 나와야 글씨끼리 덜 겹친다
    const a = Math.random() * Math.PI * 2;
    const d = size * (0.6 + Math.random() * 0.8);
    this.list.push({
      text,
      x: x + Math.cos(a) * d,
      y: y + Math.sin(a) * d * 0.6 - size * 0.4,
      size,
      born: now,
      rot: (Math.random() - 0.5) * 0.5,
      colors: PALETTES[Math.floor(Math.random() * PALETTES.length)],
    });
    if (this.list.length > MAX_WORDS) this.list.shift();
  }

  draw(g: CanvasRenderingContext2D, now: number) {
    this.list = this.list.filter((w) => now - w.born <= LIFE);
    for (const w of this.list) {
      drawPopText(g, w.text, w.x, w.y, w.size, now - w.born, LIFE, { rot: w.rot, colors: w.colors, rise: 0.5 });
    }
  }

  reset() {
    this.list = [];
  }
}
