// 희귀 등장 연출. 시간은 실제 시간(rt) 기준이라 슬로모·히트스톱과 상관없이 같은 속도로 흐른다.
//  무지개(5%): 히트스톱 → 섬광 → 무지개 빛줄기 + 별 폭죽 → "희귀 등장!"
//  다이아몬드(1%): 시간 정지 + 화면이 어두워지며 빛이 모임 → 폭발 섬광·충격파·화면 흔들림
//                  → 보석 폭죽 + 하얀 빛줄기 → "초희귀!!" → 다이아몬드 가루가 계속 흩날림
import { starPath } from "./fillingRender";

export type Rarity = "normal" | "rainbow" | "diamond";
export const RARITY_CHANCE = { diamond: 0.01, rainbow: 0.05 } as const;

export function rollRarity(): Rarity {
  const r = Math.random();
  if (r < RARITY_CHANCE.diamond) return "diamond";
  if (r < RARITY_CHANCE.diamond + RARITY_CHANCE.rainbow) return "rainbow";
  return "normal";
}

export interface FxStage {
  W: number;
  H: number;
  B: number;
  /** 터지는 중심 */
  ox: number;
  oy: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  size: number;
  hue: number;
  life: number;
  max: number;
  gem: boolean;
  dust: boolean;
  twinkle: number;
}

/** 다이아몬드: 시간이 멈추고 빛을 모으는 시간(초) */
export const DIAMOND_CHARGE = 0.8;
const pct = (p: number) => Math.round(p * 100);

export class RareFx {
  kind: Rarity = "normal";
  private at = -1;
  private burst = false;
  private dustClock = 0;
  private parts: Particle[] = [];

  reset() {
    this.kind = "normal";
    this.at = -1;
    this.burst = false;
    this.dustClock = 0;
    this.parts = [];
  }

  start(kind: Rarity, rt: number, stage: FxStage) {
    this.reset();
    this.kind = kind;
    this.at = rt;
    if (kind === "rainbow") this.spawnBurst(stage, 80, false);
  }

  get active() {
    return this.at >= 0 && this.kind !== "normal";
  }

  /** 시뮬레이션 속도 배율 (히트스톱 / 시간 정지) */
  timeScale(rt: number): number {
    if (!this.active) return 1;
    const e = rt - this.at;
    if (this.kind === "rainbow") {
      const k = e / 0.9;
      return k >= 1 ? 1 : 0.15 + 0.85 * k * k;
    }
    if (e < DIAMOND_CHARGE) return 0.03;
    const k = (e - DIAMOND_CHARGE) / 1.0;
    return k >= 1 ? 1 : 0.1 + 0.9 * k * k;
  }

  shake(rt: number, B: number): [number, number] {
    if (!this.active) return [0, 0];
    const e = rt - this.at;
    let amp = 0;
    if (this.kind === "diamond") {
      if (e < DIAMOND_CHARGE) amp = B * 0.005 * (e / DIAMOND_CHARGE); // 모이는 동안 부르르
      else if (e < DIAMOND_CHARGE + 0.5) amp = B * 0.03 * (1 - (e - DIAMOND_CHARGE) / 0.5);
    } else if (e < 0.25) {
      amp = B * 0.012 * (1 - e / 0.25);
    }
    return [(Math.random() - 0.5) * 2 * amp, (Math.random() - 0.5) * 2 * amp];
  }

  step(rdt: number, rt: number, stage: FxStage) {
    if (!this.active) return;
    const e = rt - this.at;
    const { B } = stage;
    if (this.kind === "diamond") {
      if (!this.burst && e >= DIAMOND_CHARGE) {
        this.burst = true;
        this.spawnBurst(stage, 120, true);
      }
      if (this.burst) {
        // 다이아몬드 가루가 위에서 계속 흩날림
        this.dustClock += rdt;
        while (this.dustClock > 0.12) {
          this.dustClock -= 0.12;
          if (this.parts.length > 160) continue;
          this.parts.push({
            x: Math.random() * stage.W,
            y: -10,
            vx: (Math.random() - 0.5) * B * 0.06,
            vy: B * (0.08 + Math.random() * 0.1),
            rot: 0,
            vrot: 0,
            size: B * (0.005 + Math.random() * 0.008),
            hue: 195,
            life: 0,
            max: 3 + Math.random() * 2,
            gem: false,
            dust: true,
            twinkle: Math.random() * 6,
          });
        }
      }
    }
    for (const p of this.parts) {
      if (!p.dust) {
        p.vy += B * 1.1 * rdt;
        p.vx *= 1 - 1.2 * rdt;
        p.vy *= 1 - 1.2 * rdt;
      }
      p.x += p.vx * rdt;
      p.y += p.vy * rdt;
      p.rot += p.vrot * rdt;
      p.life += rdt;
    }
    if (this.parts.length) this.parts = this.parts.filter((p) => p.life < p.max);
  }

  private spawnBurst(stage: FxStage, count: number, gem: boolean) {
    const { B } = stage;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = B * (0.6 + Math.random() * (gem ? 2.4 : 1.8));
      this.parts.push({
        x: stage.ox,
        y: stage.oy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - B * 0.6,
        rot: Math.random() * 6,
        vrot: (Math.random() - 0.5) * 10,
        size: B * (gem ? 0.014 + Math.random() * 0.024 : 0.012 + Math.random() * 0.02),
        hue: gem ? 185 + Math.random() * 40 : Math.random() * 360,
        life: 0,
        max: 1.4 + Math.random() * (gem ? 1.8 : 1.2),
        gem,
        dust: false,
        twinkle: Math.random() * 6,
      });
    }
  }

  /** 슬라임 뒤쪽 레이어: 회전하는 빛줄기 */
  drawBack(g: CanvasRenderingContext2D, rt: number, stage: FxStage, cx: number, cy: number) {
    if (!this.active) return;
    const e = rt - this.at;
    const R = Math.hypot(stage.W, stage.H) * 0.6;
    if (this.kind === "rainbow") {
      const strong = 1 - Math.min(1, Math.max(0, e - 1.6) / 1.2);
      const alpha = Math.min(1, e / 0.25) * (0.16 + 0.42 * strong);
      rays(g, cx, cy, R, 14, 0.55, rt * 0.35, (i) => `hsla(${Math.floor(i * (360 / 14) + rt * 40) % 360},95%,72%,${alpha})`, alpha);
    } else if (e >= DIAMOND_CHARGE) {
      const b = e - DIAMOND_CHARGE;
      const strong = 1 - Math.min(1, Math.max(0, b - 2.2) / 1.4);
      const alpha = Math.min(1, b / 0.15) * (0.14 + 0.5 * strong);
      rays(g, cx, cy, R, 20, 0.32, rt * 0.6, (i) => (i % 2 ? `rgba(255,255,255,${alpha})` : `rgba(150,215,255,${alpha})`), alpha);
      rays(g, cx, cy, R * 0.8, 10, 0.18, -rt * 0.9, () => `rgba(255,255,255,${alpha * 0.8})`, alpha);
    }
  }

  /** 맨 앞 레이어: 어둠·빛 모으기·입자·충격파·배너·섬광 */
  drawFront(g: CanvasRenderingContext2D, rt: number, stage: FxStage, cx: number, cy: number) {
    if (!this.active) return;
    const e = rt - this.at;
    const { W, H, B } = stage;

    if (this.kind === "diamond") this.drawCharge(g, e, stage, cx, cy);

    for (const p of this.parts) {
      const a = p.dust
        ? Math.min(1, p.life / 0.4, (p.max - p.life) / 0.6) * (0.4 + 0.6 * Math.abs(Math.sin(rt * 6 + p.twinkle)))
        : 1 - p.life / p.max;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      if (p.gem) {
        // 마름모 보석 조각
        const s = p.size;
        g.beginPath();
        g.moveTo(0, -s * 1.6);
        g.lineTo(s, 0);
        g.lineTo(0, s * 1.6);
        g.lineTo(-s, 0);
        g.closePath();
        const lg = g.createLinearGradient(-s, -s, s, s);
        lg.addColorStop(0, `rgba(255,255,255,${a})`);
        lg.addColorStop(1, `hsla(${p.hue},90%,72%,${a})`);
        g.fillStyle = lg;
        g.fill();
        g.strokeStyle = `rgba(255,255,255,${a * 0.9})`;
        g.lineWidth = 1;
        g.stroke();
      } else {
        g.fillStyle = p.dust ? `rgba(225,245,255,${a})` : `hsla(${p.hue},95%,62%,${a})`;
        starPath(g, 0, 0, p.size);
        g.fill();
      }
      g.restore();
    }

    if (this.kind === "diamond" && e >= DIAMOND_CHARGE) {
      // 충격파 고리 3겹
      for (const d of [0, 0.12, 0.26]) {
        const q = (e - DIAMOND_CHARGE - d) / 0.8;
        if (q < 0 || q > 1) continue;
        g.beginPath();
        g.arc(cx, cy, B * (0.15 + q * 1.6), 0, Math.PI * 2);
        g.strokeStyle = `rgba(190,235,255,${(1 - q) * 0.8})`;
        g.lineWidth = B * 0.035 * (1 - q) + 1;
        g.stroke();
        g.strokeStyle = `rgba(255,255,255,${(1 - q) * 0.9})`;
        g.lineWidth = Math.max(1, B * 0.008 * (1 - q));
        g.stroke();
      }
    }

    this.drawBanner(g, rt, e, stage);

    // 섬광
    const flashAt = this.kind === "diamond" ? DIAMOND_CHARGE : 0;
    const fe = e - flashAt;
    const flashLen = this.kind === "diamond" ? 0.6 : 0.4;
    if (fe >= 0 && fe < flashLen) {
      g.fillStyle = this.kind === "diamond" ? `rgba(240,250,255,${1 - fe / flashLen})` : `rgba(255,255,255,${0.85 * (1 - fe / flashLen)})`;
      g.fillRect(-60, -60, W + 120, H + 120);
    }
  }

  /** 다이아몬드: 화면이 어두워지고 가운데로 빛이 빨려 들어감 */
  private drawCharge(g: CanvasRenderingContext2D, e: number, stage: FxStage, cx: number, cy: number) {
    const { W, H, B } = stage;
    const dark = e < DIAMOND_CHARGE ? 0.62 * Math.min(1, e / 0.25) : 0.62 * Math.max(0, 1 - (e - DIAMOND_CHARGE) / 0.6);
    if (dark > 0) {
      g.fillStyle = `rgba(10,14,40,${dark})`;
      g.fillRect(-60, -60, W + 120, H + 120);
    }
    if (e >= DIAMOND_CHARGE) return;
    const k = e / DIAMOND_CHARGE;
    const R = B * (0.08 + 0.28 * k);
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, R);
    glow.addColorStop(0, `rgba(255,255,255,${0.9 * k})`);
    glow.addColorStop(0.4, `rgba(170,225,255,${0.55 * k})`);
    glow.addColorStop(1, "rgba(170,225,255,0)");
    g.fillStyle = glow;
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + e * 4;
      const rad = B * 0.9 * (1 - k) * (0.6 + 0.4 * (((i * 37) % 10) / 10));
      g.fillStyle = `rgba(255,255,255,${0.4 + 0.6 * k})`;
      starPath(g, cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, B * 0.012 * (0.5 + k));
      g.fill();
    }
  }

  /** 캔버스에 직접 그려서 영상에도 담긴다 */
  private drawBanner(g: CanvasRenderingContext2D, rt: number, e: number, stage: FxStage) {
    const diamond = this.kind === "diamond";
    const b = e - (diamond ? DIAMOND_CHARGE + 0.15 : 0.2);
    const dur = diamond ? 4.2 : 3;
    if (b < 0 || b > dur) return;
    const pop = easeOutBack(Math.min(1, b / (diamond ? 0.45 : 0.35)));
    const fade = b > dur - 0.5 ? (dur - b) / 0.5 : 1;
    const size = Math.max(20, stage.B * (diamond ? 0.16 : 0.13));
    const font = `"Pretendard Variable", Pretendard, "Noto Sans KR", sans-serif`;
    g.save();
    g.globalAlpha = Math.max(0, fade);
    g.translate(stage.W / 2, stage.H * 0.15);
    g.scale(pop, pop);
    g.rotate(diamond ? 0 : -0.04);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";

    const title = diamond ? "초희귀!!" : "희귀 등장!";
    g.font = `900 ${size}px ${font}`;
    const w = g.measureText(title).width;
    const grad = g.createLinearGradient(-w / 2, 0, w / 2, 0);
    if (diamond) {
      // 은빛·하늘빛 띠가 흘러가는 금속 광택
      const palette = ["#7fb4ff", "#ffffff", "#bfe8ff", "#ffffff", "#9fc6ff"];
      for (let i = 0; i <= 8; i++) grad.addColorStop(i / 8, palette[Math.floor(i + rt * 6) % palette.length]);
    } else {
      for (let i = 0; i <= 6; i++) grad.addColorStop(i / 6, `hsl(${(i * 60 + rt * 120) % 360},90%,58%)`);
    }
    if (diamond) {
      g.lineWidth = size * 0.3;
      g.strokeStyle = "#fff";
      g.strokeText(title, 0, 0);
      g.lineWidth = size * 0.12;
      g.strokeStyle = "#1b2f6b";
      g.strokeText(title, 0, 0);
    } else {
      g.lineWidth = size * 0.22;
      g.strokeStyle = "#fff";
      g.strokeText(title, 0, 0);
    }
    g.shadowColor = diamond ? "rgba(120,200,255,0.8)" : "rgba(120,60,160,0.35)";
    g.shadowBlur = size * (diamond ? 0.5 : 0.3);
    g.fillStyle = grad;
    g.fillText(title, 0, 0);
    g.shadowBlur = 0;

    const sub = diamond
      ? `💎 다이아몬드 슬라임 · ${pct(RARITY_CHANCE.diamond)}%`
      : `🌈 무지개 글리터 슬라임 · ${pct(RARITY_CHANCE.rainbow)}%`;
    g.font = `800 ${size * 0.4}px ${font}`;
    g.lineWidth = size * 0.12;
    g.strokeStyle = "#fff";
    g.strokeText(sub, 0, size * 0.85);
    g.fillStyle = diamond ? "#1b2f6b" : "#7a4bb3";
    g.fillText(sub, 0, size * 0.85);

    if (diamond) {
      // 배너 모서리에서 반짝
      for (let k = 0; k < 4; k++) {
        const tw = Math.pow(Math.max(0, Math.sin(rt * 5 + k * 1.6)), 4);
        g.fillStyle = `rgba(255,255,255,${tw})`;
        starPath(g, (k % 2 ? 1 : -1) * w * 0.58, (k < 2 ? -1 : 0.6) * size * 0.55, size * 0.09 * (0.4 + tw));
        g.fill();
      }
    }
    g.restore();
  }
}

/** 가운데서 뻗는 부채꼴 빛줄기 n 개 */
function rays(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  n: number,
  width: number,
  rot: number,
  color: (i: number) => string,
  alpha: number,
) {
  if (alpha <= 0) return;
  g.save();
  g.translate(cx, cy);
  g.rotate(rot);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const w = (Math.PI / n) * width;
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, R);
    grad.addColorStop(0, color(i));
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, R, a - w, a + w);
    g.closePath();
    g.fill();
  }
  g.restore();
}

function easeOutBack(x: number) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
