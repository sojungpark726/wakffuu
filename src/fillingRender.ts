// 부서진 뒤 드러나는 속재료 그리기: 슬라임·점토·반짝이·무지개 글리터·다이아몬드
import type { Goo } from "./goo";
import { hexToRgb, mix, rgba, type RGB } from "./imageUtil";
import type { FillingType } from "./waxBall";

export interface Sparkle {
  a: number;
  r: number;
  phase: number;
  speed: number;
  gold: boolean;
  hue: number;
}

/** 다이아몬드 윗면(브릴리언트 컷)의 면 하나 — 단위 원 좌표 */
export interface Facet {
  pts: [number, number][];
  phase: number;
  speed: number;
  blue: boolean;
}

export function makeSparkles(count = 46): Sparkle[] {
  return Array.from({ length: count }, () => ({
    a: Math.random() * Math.PI * 2,
    r: Math.sqrt(Math.random()) * 0.85,
    phase: Math.random() * Math.PI * 2,
    speed: 2 + Math.random() * 5,
    gold: Math.random() < 0.4,
    hue: Math.random() * 360,
  }));
}

/** 브릴리언트 컷: 가운데 8각 테이블 + 스타 8 + 카이트 8 + 거들 16 = 33면 */
export function makeFacets(): Facet[] {
  const polar = (r: number, deg: number): [number, number] => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)];
  const A = Array.from({ length: 8 }, (_, k) => polar(0.42, k * 45));
  const B = Array.from({ length: 8 }, (_, k) => polar(0.78, k * 45 + 22.5));
  const C = Array.from({ length: 16 }, (_, j) => polar(1.25, j * 22.5));
  const polys: [number, number][][] = [A];
  for (let k = 0; k < 8; k++) {
    const k1 = (k + 1) % 8, km = (k + 7) % 8;
    polys.push([A[k], A[k1], B[k]]); // 스타
    polys.push([A[k], B[km], C[2 * k], B[k]]); // 카이트
    polys.push([B[k], C[2 * k], C[2 * k + 1]]); // 거들
    polys.push([B[k], C[2 * k + 1], C[(2 * k + 2) % 16]]);
  }
  return polys.map((pts) => ({ pts, phase: Math.random() * Math.PI * 2, speed: 1.5 + Math.random() * 3, blue: Math.random() < 0.4 }));
}

/** 네 갈래 반짝이 별 */
export function starPath(g: CanvasRenderingContext2D, x: number, y: number, size: number) {
  g.beginPath();
  g.moveTo(x, y - size * 2);
  g.lineTo(x + size * 0.5, y);
  g.lineTo(x, y + size * 2);
  g.lineTo(x - size * 0.5, y);
  g.closePath();
  g.moveTo(x - size * 2, y);
  g.lineTo(x, y + size * 0.5);
  g.lineTo(x + size * 2, y);
  g.lineTo(x, y - size * 0.5);
  g.closePath();
}

export interface FillingLook {
  type: FillingType;
  color: string;
  t: number;
  sparkles: Sparkle[];
  facets: Facet[];
}

/** r: 슬라임의 기본 반지름 (늘어나도 그라데이션 크기는 이걸 기준으로) */
export function drawFilling(g: CanvasRenderingContext2D, goo: Goo, r: number, look: FillingLook) {
  const { type, t, sparkles } = look;
  const cx = goo.cx, cy = goo.cy;
  const base: RGB = type === "rainbow" ? [255, 225, 245] : type === "diamond" ? [215, 238, 255] : hexToRgb(look.color);
  const color: RGB = type === "clay" ? mix(base, [200, 190, 180], 0.35) : base;
  const light = mix(color, [255, 255, 255], type === "clay" ? 0.25 : 0.5);
  const dark = mix(color, [0, 0, 0], type === "clay" ? 0.18 : 0.28);

  goo.trace(g);
  if (type === "rainbow" && typeof g.createConicGradient === "function") {
    // 천천히 도는 무지개 + 가운데를 뽀얗게 섞어 슬라임 느낌
    const cg = g.createConicGradient(t * 0.8, cx, cy);
    for (let i = 0; i <= 6; i++) cg.addColorStop(i / 6, `hsl(${i * 60},90%,72%)`);
    g.fillStyle = cg;
    g.fill();
    const milk = g.createRadialGradient(cx - r * 0.2, cy - r * 0.25, 0, cx, cy, r * 1.1);
    milk.addColorStop(0, "rgba(255,255,255,0.55)");
    milk.addColorStop(0.6, "rgba(255,255,255,0.12)");
    milk.addColorStop(1, "rgba(80,40,120,0.18)");
    g.fillStyle = milk;
    g.fill();
  } else if (type === "diamond") {
    // 얼음처럼 맑은 흰빛·하늘빛·라벤더
    const lg = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    lg.addColorStop(0, "#ffffff");
    lg.addColorStop(0.35, "#d3f1ff");
    lg.addColorStop(0.65, "#e8deff");
    lg.addColorStop(1, "#b9e3ff");
    g.fillStyle = lg;
    g.fill();
  } else {
    const grad = g.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r * 1.15);
    grad.addColorStop(0, rgba(light));
    grad.addColorStop(0.55, rgba(color));
    grad.addColorStop(1, rgba(dark));
    g.fillStyle = grad;
    g.fill();
  }

  g.save();
  g.clip();
  if (type === "clay") {
    // 손가락으로 주무른 자국
    g.strokeStyle = "rgba(0,0,0,0.07)";
    g.lineWidth = r * 0.05;
    for (const s of sparkles.slice(0, 6)) {
      g.beginPath();
      g.arc(cx + Math.cos(s.a) * s.r * r * 0.6, cy + Math.sin(s.a) * s.r * r * 0.5, r * 0.22, s.phase, s.phase + 1.6);
      g.stroke();
    }
    g.fillStyle = "rgba(255,255,255,0.16)";
    g.beginPath();
    g.ellipse(cx - r * 0.3, cy - r * 0.35, r * 0.45, r * 0.25, -0.5, 0, Math.PI * 2);
    g.fill();
  } else {
    if (type === "diamond") drawFacets(g, cx, cy, r, look);
    // 젤리처럼 비치는 아랫부분 + 반짝 하이라이트
    const glow = g.createRadialGradient(cx + r * 0.25, cy + r * 0.45, 0, cx + r * 0.25, cy + r * 0.45, r * 0.6);
    glow.addColorStop(0, rgba(light, 0.45));
    glow.addColorStop(1, rgba(light, 0));
    g.fillStyle = glow;
    g.fillRect(cx - r * 3, cy - r * 3, r * 6, r * 6);
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.beginPath();
    g.ellipse(cx - r * 0.32, cy - r * 0.38, r * 0.3, r * 0.16, -0.5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.beginPath();
    g.arc(cx - r * 0.05, cy - r * 0.5, r * 0.05, 0, Math.PI * 2);
    g.fill();
  }
  if (type === "rainbow") {
    // 슬라임 안에서 소용돌이치는 흰 결
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.lineWidth = r * 0.06;
    g.lineCap = "round";
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      g.arc(cx, cy, r * (0.32 + k * 0.2), t * 0.9 + k * 2, t * 0.9 + k * 2 + 1.4);
      g.stroke();
    }
  }
  if (type === "glitter" || type === "rainbow" || type === "diamond") {
    for (const s of sparkles) {
      const tw = Math.max(0, Math.sin(t * s.speed + s.phase));
      if (tw < 0.05) continue;
      const x = cx + Math.cos(s.a) * s.r * r;
      const y = cy + Math.sin(s.a) * s.r * r;
      const size = r * 0.035 * (0.4 + tw) * (type === "glitter" ? 1 : 1.3);
      const a = 0.4 + 0.6 * tw;
      g.fillStyle =
        type === "rainbow"
          ? s.gold
            ? `rgba(255,255,255,${a})`
            : `hsla(${(s.hue + t * 40) % 360},100%,70%,${a})`
          : type === "diamond"
            ? s.gold
              ? `rgba(255,255,255,${a})`
              : `rgba(170,225,255,${a})`
            : s.gold
              ? `rgba(255,214,120,${a})`
              : `rgba(255,255,255,${a})`;
      starPath(g, x, y, size);
      g.fill();
    }
  }
  g.restore();

  if (type === "diamond") {
    // 테두리에 프리즘처럼 갈라지는 무지갯빛
    goo.trace(g);
    if (typeof g.createConicGradient === "function") {
      const cg = g.createConicGradient(-t * 1.2, cx, cy);
      for (let i = 0; i <= 6; i++) cg.addColorStop(i / 6, `hsla(${i * 60},100%,70%,0.65)`);
      g.strokeStyle = cg;
    } else {
      g.strokeStyle = "rgba(170,225,255,0.65)";
    }
    g.lineWidth = r * 0.04;
    g.stroke();
    g.strokeStyle = "rgba(255,255,255,0.8)";
    g.lineWidth = 1;
    g.stroke();
  }
}

function drawFacets(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, look: FillingLook) {
  const { t, facets } = look;
  const rot = t * 0.15;
  const c = Math.cos(rot), s = Math.sin(rot);
  const map = ([ux, uy]: [number, number]): [number, number] => [cx + (ux * c - uy * s) * r * 0.9, cy + (ux * s + uy * c) * r * 0.9];
  g.lineJoin = "round";
  for (const f of facets) {
    g.beginPath();
    f.pts.forEach((p, i) => {
      const [x, y] = map(p);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.closePath();
    const b = 0.5 + 0.5 * Math.sin(t * f.speed + f.phase);
    g.fillStyle = f.blue ? `rgba(160,215,255,${0.08 + 0.3 * b})` : `rgba(255,255,255,${0.05 + 0.45 * b * b})`;
    g.fill();
    g.strokeStyle = "rgba(255,255,255,0.5)";
    g.lineWidth = Math.max(0.6, r * 0.008);
    g.stroke();
  }
  // 큼직한 섬광 4개가 번갈아 번쩍
  for (let k = 0; k < 4; k++) {
    const tw = Math.pow(Math.max(0, Math.sin(t * 1.7 + k * 1.9)), 6);
    if (tw < 0.02) continue;
    const [x, y] = map(facets[1 + k * 8].pts[0]);
    const halo = g.createRadialGradient(x, y, 0, x, y, r * 0.25 * tw);
    halo.addColorStop(0, `rgba(255,255,255,${0.8 * tw})`);
    halo.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = halo;
    g.fillRect(x - r * 0.3, y - r * 0.3, r * 0.6, r * 0.6);
    g.fillStyle = `rgba(255,255,255,${tw})`;
    starPath(g, x, y, r * 0.06 * tw);
    g.fill();
  }
}
