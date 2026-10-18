// 배경에 떠다니는 젤리 왁뿌볼의 평면 그림. renderBasicBall 로 부풀리면 말랑한 3D 젤리가 된다.
// 인기 왁뿌볼(버터·크런치 딸기·청사과) + 참고 이미지의 젤리 도형 6가지.
import { ctx2d, makeCanvas } from "./imageUtil";

export type JellyKind = "butter" | "strawberry" | "apple" | "pill" | "clover" | "donut" | "cube" | "triangle" | "cloud";
export const POPULAR_KINDS: JellyKind[] = ["butter", "strawberry", "apple"];
export const SHAPE_KINDS: JellyKind[] = ["pill", "clover", "donut", "cube", "triangle", "cloud"];
export const ALL_KINDS: JellyKind[] = [...POPULAR_KINDS, ...SHAPE_KINDS];

/** 왁스 코팅 색 */
export const JELLY_WAX: Record<JellyKind, string> = {
  butter: "#fbe78a",
  strawberry: "#ff8f98",
  apple: "#c8f27a",
  pill: "#ffb3cf",
  clover: "#ffc078",
  donut: "#cfb5ff",
  cube: "#a5efc0",
  triangle: "#8cc6ff",
  cloud: "#ffb1a3",
};

const SIZE = 400;

export function drawJellySubject(kind: JellyKind): HTMLCanvasElement {
  const c = makeCanvas(SIZE, SIZE);
  const g = ctx2d(c);
  g.translate(SIZE / 2, SIZE / 2);
  DRAW[kind](g);
  return c;
}

/** 위가 밝고 아래가 진한 기본 채색 */
function fill(g: CanvasRenderingContext2D, top: string, bottom: string, rule: CanvasFillRule = "nonzero") {
  const lg = g.createLinearGradient(-150, -170, 150, 170);
  lg.addColorStop(0, top);
  lg.addColorStop(1, bottom);
  g.fillStyle = lg;
  g.fill(rule);
}

/** 매번 같은 무늬가 나오도록 고정 시드 난수 */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const DRAW: Record<JellyKind, (g: CanvasRenderingContext2D) => void> = {
  // 버터 스틱: 노란 블록에 파란 글씨
  butter(g) {
    g.beginPath();
    g.roundRect(-185, -78, 370, 156, 26);
    fill(g, "#fbe98a", "#f2cf3a");
    g.fillStyle = "rgba(255,250,215,0.55)"; // 윗면
    g.beginPath();
    g.roundRect(-178, -72, 356, 40, 18);
    g.fill();
    g.fillStyle = "#2c6fb5";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = '900 15px "Arial Black", Arial, sans-serif';
    g.fillText("SALTED", 52, -26);
    g.font = '900 64px "Arial Black", Arial, sans-serif';
    g.fillText("BUTTER", 52, 18);
    g.font = '800 34px Arial, sans-serif';
    g.fillText("4oz.", -122, 4);
  },

  // 크런치 딸기: 오톨도톨 씨앗 자국 + 초록 꼭지
  strawberry(g) {
    const body = new Path2D();
    body.moveTo(0, 175);
    body.bezierCurveTo(-120, 140, -178, 20, -160, -62);
    body.bezierCurveTo(-148, -132, -78, -150, 0, -128);
    body.bezierCurveTo(78, -150, 148, -132, 160, -62);
    body.bezierCurveTo(178, 20, 120, 140, 0, 175);
    const lg = g.createLinearGradient(-120, -140, 120, 170);
    lg.addColorStop(0, "#ff6b72");
    lg.addColorStop(1, "#d61f2c");
    g.fillStyle = lg;
    g.fill(body);
    for (let row = 0, y = -88; y < 150; row++, y += 36) {
      for (let x = -150 + (row % 2) * 22; x < 160; x += 44) {
        if (!g.isPointInPath(body, x + 200, y + 200)) continue;
        g.fillStyle = "#a3141f";
        g.beginPath();
        g.ellipse(x, y, 9, 12, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "rgba(255,170,175,0.8)";
        g.beginPath();
        g.ellipse(x - 2, y - 4, 3.5, 4.5, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.fillStyle = "#47b545";
    for (let i = 0; i < 6; i++) {
      g.save();
      g.translate(0, -128);
      g.rotate((i / 6) * Math.PI * 2 - Math.PI / 2 + 0.3);
      g.beginPath();
      g.ellipse(0, -34, 20, 42, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    g.fillStyle = "#3a9a38";
    g.beginPath();
    g.roundRect(-9, -190, 18, 50, 8);
    g.fill();
  },

  // 유리 같은 청사과: 기포가 비치는 연두 + 투명한 꼭지
  apple(g) {
    const body = new Path2D();
    body.moveTo(0, -118);
    body.bezierCurveTo(60, -175, 185, -150, 180, -10);
    body.bezierCurveTo(175, 112, 90, 175, 0, 160);
    body.bezierCurveTo(-90, 175, -175, 112, -180, -10);
    body.bezierCurveTo(-185, -150, -60, -175, 0, -118);
    const rg = g.createRadialGradient(-50, -40, 10, 0, 0, 200);
    rg.addColorStop(0, "#e0ff96");
    rg.addColorStop(0.55, "#9ae22a");
    rg.addColorStop(1, "#5fb80f");
    g.fillStyle = rg;
    g.fill(body);
    const rand = seeded(7);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = "rgba(225,255,170,0.45)";
      g.beginPath();
      g.ellipse(-120 + rand() * 240, -90 + rand() * 200, 20 + rand() * 40, 10 + rand() * 18, rand() * 3, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 28; i++) {
      const x = -140 + rand() * 280, y = -100 + rand() * 230;
      if (!g.isPointInPath(body, x + 200, y + 200)) continue;
      g.strokeStyle = "rgba(255,255,255,0.55)";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, 2 + rand() * 5, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = "#eefcd9";
    g.strokeStyle = "#c5e3a2";
    g.lineWidth = 4;
    g.save();
    g.translate(10, -150);
    g.rotate(-0.5);
    g.beginPath();
    g.ellipse(0, 0, 34, 20, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
  },

  pill(g) {
    g.beginPath();
    g.roundRect(-185, -88, 370, 176, 88);
    fill(g, "#ffc6dd", "#ff6fa6");
  },

  clover(g) {
    g.beginPath();
    for (const [x, y] of [
      [0, -82],
      [82, 0],
      [0, 82],
      [-82, 0],
    ]) {
      g.moveTo(x + 84, y);
      g.arc(x, y, 84, 0, Math.PI * 2);
    }
    g.moveTo(84, 0);
    g.arc(0, 0, 84, 0, Math.PI * 2);
    fill(g, "#ffcc72", "#ff8a1f");
  },

  donut(g) {
    g.beginPath();
    g.arc(0, 0, 172, 0, Math.PI * 2);
    g.moveTo(62, 0);
    g.arc(0, 0, 62, 0, Math.PI * 2, true);
    fill(g, "#dcc6ff", "#9264ff", "evenodd");
  },

  cube(g) {
    g.beginPath();
    g.roundRect(-152, -152, 304, 304, 92);
    fill(g, "#9ff07a", "#3ccf9c");
  },

  triangle(g) {
    g.beginPath();
    g.moveTo(0, -140);
    g.lineTo(140, 110);
    g.lineTo(-140, 110);
    g.closePath();
    g.lineJoin = "round";
    g.lineWidth = 70;
    const lg = g.createLinearGradient(-150, -150, 150, 150);
    lg.addColorStop(0, "#7cc4ff");
    lg.addColorStop(1, "#2a7df5");
    g.strokeStyle = lg;
    g.fillStyle = lg;
    g.stroke();
    g.fill();
  },

  cloud(g) {
    g.beginPath();
    for (const [x, y, r] of [
      [-92, 22, 86],
      [0, -42, 102],
      [96, 16, 86],
      [24, 62, 80],
      [-44, 62, 76],
    ]) {
      g.moveTo(x + r, y);
      g.arc(x, y, r, 0, Math.PI * 2);
    }
    fill(g, "#ffb6a6", "#ff5f55");
  },
};
