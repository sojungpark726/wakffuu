// 왁뿌볼 무대: 톡 = 금 가기, 꾹 = 연속으로 으깨기. 금이 쌓일수록 조각이 떨어져 나가고,
// 한계를 넘으면 보로노이 조각으로 와장창 → 안의 슬라임을 누르고 늘이며 놀 수 있다.
// 껍질 이미지(모양은 자유)만 받으면 되므로 기본형/AI 변환 두 모드가 같은 엔진을 쓴다.
import { SHELL_SIZE } from "./ballRender";
import { drawFilling, makeFacets, makeSparkles, type Facet, type Sparkle } from "./fillingRender";
import { drawPopText } from "./popText";
import { SfxWords } from "./sfxWords";
import { Goo, type GooRest } from "./goo";
import { canvasToBlob, ctx2d, hexToRgb, hslToRgb, makeCanvas, rgba, rgbToHsl, type Box, type RGB } from "./imageUtil";
import { RareFx, rollRarity, type FxStage, type Rarity } from "./rareFx";
import { buzz, sfx, type Bus, type CrunchProfile } from "./sound";
import { centroid, voronoiCells, type Pt } from "./voronoi";

export { RARITY_CHANCE, type Rarity } from "./rareFx";

export type FillingType = "slime" | "clay" | "glitter" | "rainbow" | "diamond";
export const FILLING_LABEL: Record<FillingType, string> = {
  slime: "슬라임",
  clay: "점토",
  glitter: "반짝이",
  rainbow: "무지개 글리터",
  diamond: "다이아몬드",
};
/** 평소에 고를 수 있는 속재료 (무지개·다이아몬드는 희귀볼에서만) */
export const FILLING_ORDER: FillingType[] = ["slime", "clay", "glitter"];

export interface BallStyle {
  fillingType: FillingType;
  fillingColor: string;
  crunch: CrunchProfile;
}

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  resting: boolean;
}
/** 껍질 조각 (와장창 파편, 금 가다가 떨어져 나간 조각) */
interface Piece extends Body {
  img: HTMLCanvasElement;
  /** 무게중심 기준 이미지 좌상단 (껍질 px) */
  ox: number;
  oy: number;
  flip: number;
  vflip: number;
  /** 화면 px 기준 대략 반지름 */
  r: number;
}
interface Crumb extends Body {
  size: number;
  color: string;
}
interface Snapshot {
  shards: Piece[];
  chips: Piece[];
  preCrumbs: Crumb[];
  burstCrumbs: Crumb[];
  impact: Pt;
  /** 깨질 때 공의 위치·기울기 */
  anchor: [number, number, number];
}

type State = "empty" | "intact" | "shattered";

const S = SHELL_SIZE;
/** 와장창까지 필요한 금 개수 (처음 버전 4~6번의 세 배) */
const CRACKS_MIN = 12;
const CRACKS_SPREAD = 7;

export class WaxBall {
  state: State = "empty";
  style: BallStyle = { fillingType: "slime", fillingColor: "#8fd3ff", crunch: "crispy" };
  video: { blob: Blob; ext: string } | null = null;
  onChange: () => void = () => {};
  /** 이번 볼 속에 숨은 희귀 슬라임 (굳힐 때마다 다시 뽑음) */
  rarity: Rarity = "normal";
  /** 개발용: 희귀도를 고정 */
  forceRarity: Rarity | null = null;

  private g: CanvasRenderingContext2D;
  private W = 1;
  private H = 1;
  private dpr = 1;
  private shell: HTMLCanvasElement | null = null;
  private cracked = makeCanvas(S, S);
  private alpha: Uint8ClampedArray | null = null;
  private box: Box = { x: 0, y: 0, w: S, h: S };
  private crackCount = 0;
  private crackLimit = CRACKS_MIN;
  private squish = 0;
  private squishV = 0;
  private shake = 0;
  private appear = 1;
  private shards: Piece[] = [];
  private chips: Piece[] = [];
  private crumbs: Crumb[] = [];
  private snapshot: Snapshot | null = null;
  private goo: Goo | null = null;
  private reveal = 0;
  private sparkles: Sparkle[] = makeSparkles();
  private facets: Facet[] = makeFacets();
  private baseFilling: FillingType = "slime";
  /** 껍질의 대표색 — 바닥에 비치는 색 그림자 */
  private tint: RGB = [255, 150, 190];
  private fx = new RareFx();
  /** 실제 경과 시간(초) — 슬로모와 상관없이 흐르는 연출용 시계 */
  private rt = 0;
  /** 시뮬레이션 시간 — 슬로모·히트스톱이 적용됨 */
  private t = 0;
  private last = 0;
  private timeScale = 1;
  private replaying = false;
  private lastTick = 0;
  private holdTimer = 0;
  private crushing = false;
  private pointer: Pt | null = null;
  private gooPointer: Pt | null = null;
  /** 공의 위치(모양 아래쪽 가운데, 화면 px)·속도·기울기 — 끌어서 던질 수 있다 */
  private ax = 0;
  private ay = 0;
  private avx = 0;
  private avy = 0;
  private arot = 0;
  private avrot = 0;
  /** 누른 직후: 톡(금)·꾹(으깨기)·끌기(던지기) 중 무엇인지 아직 모름 */
  private press: { x: number; y: number; timer: number } | null = null;
  private drag: { offX: number; offY: number; tx: number; ty: number; vx: number; vy: number; lx: number; ly: number; lt: number } | null = null;
  /** 말랑하게 출렁이는 정도 (스프링) */
  private jig = 0;
  private jigV = 0;
  private lastImpact = 0;
  /** "부서졌다!" 를 띄운 시각 */
  private brokeAt = -1;
  private lastGooSound = 0;
  /** 효과음 글씨 (빠작!·뽀득·쭈욱) 와 끌어온 거리 */
  private words = new SfxWords();
  private dragDist = 0;
  private gooDist = 0;
  private bus: Bus | null = null;
  private recorder: { rec: MediaRecorder; discard: () => void } | null = null;
  private recordStopTimer = 0;
  /** 녹화 세대: 볼이 바뀌면 올려서, 늦게 끝난 예전 녹화가 새 볼의 영상으로 들어오지 않게 */
  private recGen = 0;
  /** 슬로모 다시보기가 끝나는 타이머 */
  private replayTimer = 0;
  /** 지금 누르고 있는 손가락(포인터) — 다른 손가락은 무시 */
  private activePointer: number | null = null;
  /** 놀이판이 화면에 보이는지 (안 보이면 그리기를 쉰다) */
  private visible = true;

  constructor(private canvas: HTMLCanvasElement) {
    this.g = canvas.getContext("2d")!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointerleave", this.onUp);
    canvas.addEventListener("pointercancel", this.onCancel);
    // 꾹 누를 때 길게 누르기 메뉴가 뜨지 않게
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    if (typeof IntersectionObserver !== "undefined") {
      new IntersectionObserver((entries) => {
        for (const en of entries) this.visible = en.isIntersecting;
      }).observe(canvas);
    }
    requestAnimationFrame(this.frame);
  }

  // ---------- public ----------

  setShell(shell: HTMLCanvasElement, style: BallStyle) {
    this.shell = shell;
    this.style = style;
    const data = ctx2d(shell).getImageData(0, 0, S, S).data;
    this.alpha = data;
    let x0 = S, y0 = S, x1 = 0, y1 = 0;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++)
        if (data[(y * S + x) * 4 + 3] > 40) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
    this.box = x1 > x0 ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : { x: 0, y: 0, w: S, h: S };
    this.baseFilling = style.fillingType;
    this.tint = vividAverage(data);
    this.sparkles = makeSparkles();
    this.discardRecording();
    this.video = null;
    this.reset(false);
  }

  /** 다시 굳히기 — 희귀 슬라임도 매번 새로 뽑는다 */
  reset(animate = true) {
    if (!this.shell) return;
    const g = ctx2d(this.cracked);
    g.clearRect(0, 0, S, S);
    g.drawImage(this.shell, 0, 0);
    this.crackCount = 0;
    this.crackLimit = CRACKS_MIN + Math.floor(Math.random() * CRACKS_SPREAD);
    this.shards = [];
    this.chips = [];
    this.crumbs = [];
    this.snapshot = null;
    this.goo = null;
    this.gooPointer = null;
    this.reveal = 0;
    this.timeScale = 1;
    // 슬로모 다시보기 도중이면 그 녹화는 끝나지 못하니 버린다
    if (this.replaying) this.discardRecording();
    this.replaying = false;
    clearTimeout(this.replayTimer);
    this.rarity = this.forceRarity ?? rollRarity();
    this.style = { ...this.style, fillingType: this.rarity === "normal" ? this.baseFilling : this.rarity };
    this.fx.reset();
    this.stopPress();
    this.drag = null;
    this.activePointer = null;
    this.ax = this.W / 2;
    this.ay = this.homeY;
    this.avx = this.avy = this.arot = this.avrot = 0;
    this.jig = this.jigV = 0;
    this.brokeAt = -1;
    this.words.reset();
    this.state = "intact";
    this.appear = animate ? 0 : 1;
    if (animate) sfx().pop(this.ensureBus());
    this.onChange();
  }

  clear() {
    this.stopHold();
    this.stopPress();
    this.drag = null;
    this.gooPointer = null;
    this.activePointer = null;
    this.discardRecording();
    clearTimeout(this.replayTimer);
    this.replaying = false;
    this.timeScale = 1;
    this.shell = null;
    this.state = "empty";
    this.video = null;
    this.shards = [];
    this.chips = [];
    this.crumbs = [];
    this.snapshot = null;
    this.goo = null;
    this.rarity = "normal";
    this.fx.reset();
    this.onChange();
  }

  /** 화면에 보여줄 속재료 — 희귀볼은 깨지기 전까지 비밀 */
  get shownFilling(): FillingType {
    return this.rarity !== "normal" && this.state !== "shattered" ? this.baseFilling : this.style.fillingType;
  }

  /** 희귀 슬라임을 깨서 찾았는지 */
  get found(): Rarity {
    return this.state === "shattered" ? this.rarity : "normal";
  }

  setFilling(type: FillingType) {
    if (type !== "rainbow" && type !== "diamond") this.baseFilling = type;
    if (this.rarity !== "normal" && this.state !== "shattered") {
      // 깨기 전에 바꿔도 희귀 슬라임은 그대로 숨겨 둔다
      this.onChange();
      return;
    }
    this.style = { ...this.style, fillingType: type };
    this.sparkles = makeSparkles();
    if (this.state === "shattered") {
      this.goo?.kick(this.B * 0.9);
      sfx().squelch(this.ensureBus());
    }
    this.onChange();
  }

  get canReplay() {
    return !!this.snapshot && !this.replaying;
  }

  /** 마지막으로 깨진 장면을 슬로모로 다시 (영상도 새로 녹화) */
  replaySlowmo() {
    const snap = this.snapshot;
    if (!snap || this.replaying) return;
    this.stopGoo();
    this.replaying = true;
    this.state = "intact";
    this.shards = [];
    this.chips = snap.chips.map((c) => ({ ...c }));
    this.crumbs = snap.preCrumbs.map((c) => ({ ...c }));
    this.goo = null;
    this.fx.reset();
    this.reveal = 0;
    this.appear = 1;
    [this.ax, this.ay, this.arot] = snap.anchor;
    this.avx = this.avy = this.avrot = 0;
    this.brokeAt = -1;
    this.words.reset();
    this.timeScale = 0.3;
    this.startRecording();
    this.onChange();
    const settle = this.rarity === "diamond" ? 6000 : this.rarity === "rainbow" ? 4200 : 3200;
    clearTimeout(this.replayTimer);
    this.replayTimer = window.setTimeout(() => {
      if (this.snapshot !== snap) return;
      this.shatter(snap.impact, true);
      this.replayTimer = window.setTimeout(() => {
        this.timeScale = 1;
        this.replaying = false;
        this.onChange();
      }, settle);
    }, 550);
  }

  snapshotBlob(): Promise<Blob> {
    return canvasToBlob(this.canvas);
  }

  // ---------- geometry ----------

  /** 껍질 이미지가 화면에서 차지하는 크기 */
  private get B() {
    return Math.min(this.W, this.H) * 0.72;
  }
  private get k() {
    return this.B / S;
  }
  private get floorY() {
    return this.H * 0.46 + this.B * 0.5;
  }
  /** 공이 바닥에 놓였을 때 모양 아래쪽 가운데의 높이 */
  private get homeY() {
    return this.floorY - this.B * 0.03;
  }
  /** 지금 공이 눌리고 출렁이는 정도 (그릴 때와 좌표 변환에 같이 씀) */
  private get ballScale(): [number, number] {
    const sc = Math.max(0.05, easeOutBack(this.appear));
    const q = 0.12 * this.squish + 0.08 * this.jig;
    return [(1 + q) * sc, (1 - q) * sc];
  }
  /** 껍질 좌표 → 화면 좌표 (공의 위치·기울기·눌림 포함) */
  private toStage([x, y]: Pt): Pt {
    const [sx, sy] = this.ballScale;
    const dx = (x - (this.box.x + this.box.w / 2)) * this.k * sx;
    const dy = (y - (this.box.y + this.box.h)) * this.k * sy;
    const c = Math.cos(this.arot), s = Math.sin(this.arot);
    return [this.ax + dx * c - dy * s, this.ay + dx * s + dy * c];
  }
  /** 화면 좌표 → 껍질 좌표 */
  private toShell([X, Y]: Pt): Pt {
    const [sx, sy] = this.ballScale;
    const dx = X - this.ax, dy = Y - this.ay;
    const c = Math.cos(this.arot), s = Math.sin(this.arot);
    const lx = dx * c + dy * s, ly = -dx * s + dy * c;
    return [this.box.x + this.box.w / 2 + lx / (this.k * sx), this.box.y + this.box.h + ly / (this.k * sy)];
  }
  /** 모양 한가운데의 화면 위치 */
  private get centerStage(): Pt {
    return this.toStage([this.box.x + this.box.w / 2, this.box.y + this.box.h / 2]);
  }
  private hit([x, y]: Pt): boolean {
    const a = this.alpha;
    if (!a) return false;
    const ix = Math.round(x), iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= S || iy >= S) return false;
    return a[(iy * S + ix) * 4 + 3] > 40;
  }
  /** 껍질 밖을 눌렀으면 중심 쪽으로 당겨서 껍질 위의 점으로 */
  private pullInside(p: Pt): Pt | null {
    const c: Pt = [this.box.x + this.box.w / 2, this.box.y + this.box.h / 2];
    for (let t = 0; t <= 1; t += 0.04) {
      const q: Pt = [p[0] + (c[0] - p[0]) * t, p[1] + (c[1] - p[1]) * t];
      if (this.hit(q)) return q;
    }
    return null;
  }

  /** 슬라임이 쉬려는 자리와 크기 (드러나는 동안 아래로 내려앉으며 납작해짐) */
  private restGeom(): GooRest & { r: number } {
    const B = this.B;
    const r = Math.min(B * 0.38, Math.sqrt(this.box.w * this.box.h) * this.k * 0.39);
    const e = easeOut(this.reveal);
    const startY = this.centerStage[1];
    const restY = this.floorY - r * 0.8;
    const grow = 0.75 + 0.25 * easeOutBack(this.reveal);
    // 공이 깨진 자리에서 슬라임이 나온다
    const x = Math.max(r, Math.min(this.W - r, this.ax));
    return { x, y: startY + (restY - startY) * e, r, rx: r * (1 + 0.12 * e) * grow, ry: r * (1 - 0.14 * e) * grow };
  }

  private fxStage(): FxStage {
    const [ox, oy] = this.centerStage;
    return { W: this.W, H: this.H, B: this.B, ox, oy };
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    const oldB = this.B, oldW = this.W, oldFloor = this.floorY;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = Math.max(1, r.width);
    this.H = Math.max(1, r.height);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    const s = this.B / oldB;
    if (this.state === "empty" || !isFinite(s)) return;
    if (s !== 1) {
      // 바닥 가운데를 기준으로 모두 같은 비율로 옮긴다
      const mx = (x: number) => this.W / 2 + (x - oldW / 2) * s;
      const my = (y: number) => this.floorY + (y - oldFloor) * s;
      for (const b of [...this.shards, ...this.chips, ...this.crumbs]) {
        b.x = mx(b.x);
        b.y = my(b.y);
        b.vx *= s;
        b.vy *= s;
      }
      for (const p of [...this.shards, ...this.chips]) p.r *= s;
      this.ax = mx(this.ax);
      this.ay = my(this.ay);
      this.avx *= s;
      this.avy *= s;
      if (this.goo) this.goo.init(this.restGeom(), 1, 0);
    }
  }

  // ---------- input ----------

  private ensureBus(): Bus {
    this.bus ??= sfx().createBus();
    return this.bus;
  }

  private local(e: PointerEvent): Pt {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private onDown = (e: PointerEvent) => {
    if (this.state === "empty" || this.replaying) return;
    if (this.activePointer !== null && e.pointerId !== this.activePointer) {
      // 두 번째 손가락은 무시. 새로 시작한 첫 손가락이면 예전 포인터가 남아 있던 것이니 정리하고 받는다
      if (!e.isPrimary) return;
      this.cancelInput();
    }
    this.activePointer = e.pointerId;
    e.preventDefault();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* 포인터 캡처를 못 해도 동작에는 지장 없음 */
    }
    this.ensureBus();
    const p = this.local(e);

    if (this.state === "intact") {
      if (!this.pullInside(this.toShell(p))) return;
      // 누르는 순간 말랑하게 출렁 (+ 안드로이드 진동)
      this.jigV += 5;
      buzz(8);
      this.pointer = p;
      // 바로 떼면 톡(금), 그대로 누르고 있으면 꾹(으깨기), 움직이면 끌기
      this.stopPress();
      this.press = { x: p[0], y: p[1], timer: window.setTimeout(() => this.beginCrush(), 180) };
      return;
    }

    // 부서진 뒤: 슬라임 누르고 늘이기
    const goo = this.goo;
    if (goo && goo.contains(p[0], p[1], 18)) {
      const { r } = this.restGeom();
      goo.poke(p[0], p[1], r, this.B * 2.4);
      goo.grabAt(p[0], p[1], r);
      this.gooPointer = p;
      sfx().squelch(this.ensureBus(), 1, 0.6);
      buzz(12);
      return;
    }
    // 조각 튕기기
    let best: Piece | null = null;
    let bestD = Infinity;
    for (const s of [...this.shards, ...this.chips]) {
      const d = Math.hypot(p[0] - s.x, p[1] - s.y);
      if (d < s.r * 1.4 && d < bestD) {
        best = s;
        bestD = d;
      }
    }
    if (best) {
      best.resting = false;
      best.vy = -this.B * (1.3 + Math.random() * 0.7);
      best.vx += (Math.random() - 0.5) * this.B * 0.8;
      best.vrot += (Math.random() - 0.5) * 14;
      best.vflip = (Math.random() - 0.5) * 14;
      sfx().tick(this.ensureBus(), 0.8, this.style.crunch);
    }
  };

  private onMove = (e: PointerEvent) => {
    if (this.activePointer !== null && e.pointerId !== this.activePointer) return;
    const p = this.local(e);
    if (this.gooPointer && this.goo) {
      this.goo.drag(p[0], p[1], this.B * 0.9);
      const speed = Math.hypot(p[0] - this.gooPointer[0], p[1] - this.gooPointer[1]);
      this.gooPointer = p;
      // 늘인 만큼 "쭈욱" 글씨
      this.gooDist += speed;
      if (this.gooDist > this.B * 0.55) {
        this.gooDist = 0;
        this.words.spawn("slime", p[0], p[1], Math.max(13, this.B * 0.045), this.rt);
      }
      // 쭉쭉 늘일 때 찍찍 소리 (너무 자주 나지 않게)
      if (speed > 6 && this.rt - this.lastGooSound > 0.09) {
        this.lastGooSound = this.rt;
        sfx().squelch(this.ensureBus(), 0.7 + Math.random() * 0.5, Math.min(0.5, 0.12 + speed * 0.01));
      }
      return;
    }
    if (this.press && Math.hypot(p[0] - this.press.x, p[1] - this.press.y) > 10) {
      // 끌기 시작: 잡은 자리를 기준으로 공이 손가락을 따라온다
      this.stopPress();
      this.pointer = null;
      this.drag = { offX: p[0] - this.ax, offY: p[1] - this.ay, tx: this.ax, ty: this.ay, vx: 0, vy: 0, lx: p[0], ly: p[1], lt: performance.now() };
      sfx().squelch(this.ensureBus(), 1.6, 0.2);
      this.dragDist = 0;
    }
    const d = this.drag;
    if (d) {
      const now = performance.now();
      const sec = Math.max(1, now - d.lt) / 1000;
      // 끈 만큼 "뽀득" 글씨 + 작은 소리
      this.dragDist += Math.hypot(p[0] - d.lx, p[1] - d.ly);
      if (this.dragDist > this.B * 0.5) {
        this.dragDist = 0;
        this.words.spawn("drag", p[0], p[1], Math.max(13, this.B * 0.045), this.rt);
        sfx().tick(this.ensureBus(), 0.35, this.style.crunch);
      }
      d.vx = d.vx * 0.6 + ((p[0] - d.lx) / sec) * 0.4;
      d.vy = d.vy * 0.6 + ((p[1] - d.ly) / sec) * 0.4;
      d.lx = p[0];
      d.ly = p[1];
      d.lt = now;
      d.tx = p[0] - d.offX;
      d.ty = p[1] - d.offY;
      return;
    }
    if (this.pointer) this.pointer = p;
  };

  private onUp = (e: PointerEvent) => {
    if (this.activePointer !== null && e.pointerId !== this.activePointer) return;
    this.activePointer = null;
    this.stopGoo();
    if (this.press && this.state === "intact") {
      // 톡: 누른 자리에 금
      const sp = this.pullInside(this.toShell([this.press.x, this.press.y]));
      this.stopPress();
      if (sp) this.crack(sp, 1);
    }
    const d = this.drag;
    if (d) {
      // 던지기: 손을 놓을 때의 속도로 날아감 (잠깐 멈췄다 놓으면 그냥 내려놓기)
      const still = performance.now() - d.lt > 80;
      const max = this.B * 7;
      this.avx = still ? 0 : Math.max(-max, Math.min(max, d.vx));
      this.avy = still ? 0 : Math.max(-max, Math.min(max, d.vy));
      this.avrot = this.avx / (this.B * 3);
      this.drag = null;
    }
    this.stopHold();
  };

  /** 브라우저가 터치를 가져가면(스크롤·알림 등): 금 내지 않고 누르던 것만 정리 */
  private onCancel = (e: PointerEvent) => {
    if (this.activePointer !== null && e.pointerId !== this.activePointer) return;
    this.cancelInput();
  };

  private cancelInput() {
    this.activePointer = null;
    this.stopGoo();
    this.stopPress();
    if (this.drag) {
      this.avx = this.avy = this.avrot = 0;
      this.drag = null;
    }
    this.stopHold();
  }

  /** 꾹 누르고 있으면 연속으로 으깨기 */
  private beginCrush() {
    if (!this.press || this.state !== "intact") return;
    const { x, y } = this.press;
    this.press = null;
    const sp = this.pullInside(this.toShell([x, y]));
    if (sp) this.crack(sp, 1);
    this.crushing = true;
    clearInterval(this.holdTimer);
    this.holdTimer = window.setInterval(() => {
      if (!this.pointer || this.state !== "intact") return this.stopHold();
      const q = this.toShell(this.pointer);
      const jittered = this.pullInside([q[0] + (Math.random() - 0.5) * 36, q[1] + (Math.random() - 0.5) * 36]);
      if (jittered) this.crack(jittered, 0.8);
    }, 170);
  }

  private stopPress() {
    if (this.press) clearTimeout(this.press.timer);
    this.press = null;
  }

  private stopGoo() {
    if (!this.gooPointer || !this.goo) return;
    this.gooPointer = null;
    const pull = this.goo.release();
    if (pull > this.B * 0.08) {
      // 놓으면 '쀽' 하고 돌아감
      sfx().squelch(this.ensureBus(), 1.3, Math.min(0.7, 0.2 + pull / this.B));
      buzz(15);
    }
  }

  private stopHold() {
    this.pointer = null;
    this.crushing = false;
    clearInterval(this.holdTimer);
  }

  // ---------- crack & shatter ----------

  private crack(sp: Pt, strength: number) {
    if (this.crackCount === 0) this.startRecording();
    this.crackCount++;
    const progress = this.crackCount / this.crackLimit;
    this.drawCrack(sp);
    const [wx, wy] = this.toStage(sp);
    this.words.spawn("crack", wx, wy, Math.max(15, this.B * (0.045 + 0.025 * strength)), this.rt);
    this.squishV += 6 * strength;
    this.jigV += 4 * strength;
    this.shake = 1;
    sfx().crunch(this.ensureBus(), Math.min(1, (0.3 + 0.6 * progress) * strength), this.style.crunch);
    buzz(12);
    // 금이 쌓일수록 부스러기가 떨어지고, 중반부터는 조각이 떨어져 나간다
    if (progress > 0.25) this.spawnCrumbs(sp, 3 + Math.floor(Math.random() * 4), 0.35);
    if (progress > 0.4 && Math.random() < 0.55) this.chipOff(sp);
    if (this.crackCount >= this.crackLimit) this.shatter(sp, false);
    this.onChange();
  }

  private drawCrack(sp: Pt) {
    const g = ctx2d(this.cracked);
    g.save();
    g.globalCompositeOperation = "source-atop"; // 껍질 위에만 그려짐
    const rg = g.createRadialGradient(sp[0], sp[1], 0, sp[0], sp[1], 34);
    rg.addColorStop(0, "rgba(255,255,255,0.5)");
    rg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rg;
    g.fillRect(sp[0] - 40, sp[1] - 40, 80, 80);

    const branches = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < branches; i++) {
      this.walkCrack(g, sp, (i / branches) * Math.PI * 2 + Math.random() * 0.9, 40 + Math.random() * 110, 2.2, 0);
    }
    // 떨어져 나간 왁스 부스러기 자국
    for (let i = 0; i < 4 + Math.random() * 4; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * 18;
      const x = sp[0] + Math.cos(a) * d, y = sp[1] + Math.sin(a) * d, r = 1.5 + Math.random() * 3;
      g.beginPath();
      for (let j = 0; j < 5; j++) {
        const aa = (j / 5) * Math.PI * 2 + Math.random() * 0.6;
        const rr = r * (0.6 + Math.random() * 0.6);
        g.lineTo(x + Math.cos(aa) * rr, y + Math.sin(aa) * rr);
      }
      g.closePath();
      g.fillStyle = "rgba(255,255,255,0.6)";
      g.fill();
      g.strokeStyle = "rgba(80,55,40,0.3)";
      g.lineWidth = 0.6;
      g.stroke();
    }
    g.restore();
  }

  private walkCrack(g: CanvasRenderingContext2D, start: Pt, angle: number, length: number, width: number, depth: number) {
    let [x, y] = start;
    let a = angle;
    let walked = 0;
    const pts: Pt[] = [[x, y]];
    while (walked < length) {
      const step = 7 + Math.random() * 12;
      a += (Math.random() - 0.5) * 0.9;
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
      walked += step;
      pts.push([x, y]);
      if (!this.hit([x, y])) break;
      if (depth < 2 && Math.random() < 0.18) {
        this.walkCrack(g, [x, y], a + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.6), length * 0.35, width * 0.6, depth + 1);
      }
    }
    const path = () => {
      g.beginPath();
      pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
    };
    g.lineJoin = g.lineCap = "round";
    // 금 주변이 하얗게 질리는 왁스 특유의 스트레스 자국 — 희귀볼은 속의 빛이 살짝 새어 나옴
    path();
    g.strokeStyle =
      this.rarity === "rainbow"
        ? `hsla(${Math.floor(Math.random() * 360)},95%,70%,0.32)`
        : this.rarity === "diamond"
          ? "rgba(205,240,255,0.55)"
          : "rgba(255,255,255,0.2)";
    g.lineWidth = width * 4;
    g.stroke();
    path();
    g.strokeStyle = "rgba(70,45,35,0.55)";
    g.lineWidth = width;
    g.stroke();
    g.save();
    g.translate(-0.9, -0.9);
    path();
    g.strokeStyle = "rgba(255,255,255,0.8)";
    g.lineWidth = Math.max(0.6, width * 0.45);
    g.stroke();
    g.restore();
  }

  /** 금이 많이 간 곳에서 작은 조각이 떨어져 나가고, 그 자리는 움푹하게 */
  private chipOff(sp: Pt) {
    const r = 9 + Math.random() * 14;
    const poly: Pt[] = [];
    for (let j = 0; j < 6; j++) {
      const a = (j / 6) * Math.PI * 2 + Math.random() * 0.5;
      const rr = r * (0.6 + Math.random() * 0.6);
      poly.push([sp[0] + Math.cos(a) * rr, sp[1] + Math.sin(a) * rr]);
    }
    const piece = this.cutPiece(poly, this.centerStage, 0.45);
    if (!piece) return;
    this.chips.push(piece);
    const g = ctx2d(this.cracked);
    g.save();
    g.globalCompositeOperation = "source-atop";
    g.beginPath();
    poly.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fillStyle = "rgba(70,40,30,0.28)";
    g.fill();
    g.strokeStyle = "rgba(255,255,255,0.7)";
    g.lineWidth = 1.5;
    g.stroke();
    g.restore();
    sfx().tick(this.ensureBus(), 0.6, this.style.crunch);
  }

  /** 껍질에서 다각형 하나를 잘라 날아가는 조각으로 (투명한 부분뿐이면 null) */
  private cutPiece(poly: Pt[], from: Pt, power: number): Piece | null {
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    const minX = Math.floor(Math.min(...xs)) - 1, minY = Math.floor(Math.min(...ys)) - 1;
    const w = Math.ceil(Math.max(...xs)) - minX + 2, h = Math.ceil(Math.max(...ys)) - minY + 2;
    const img = makeCanvas(w, h);
    const sg = ctx2d(img);
    sg.translate(-minX, -minY);
    const path = () => {
      sg.beginPath();
      poly.forEach(([x, y], i) => (i ? sg.lineTo(x, y) : sg.moveTo(x, y)));
      sg.closePath();
    };
    sg.save();
    path();
    sg.clip();
    sg.drawImage(this.cracked, 0, 0);
    sg.globalCompositeOperation = "source-atop"; // 잘린 단면이 밝게 보이도록
    path();
    sg.strokeStyle = "rgba(255,255,255,0.6)";
    sg.lineWidth = 3;
    sg.stroke();
    path();
    sg.strokeStyle = "rgba(70,45,35,0.3)";
    sg.lineWidth = 1;
    sg.stroke();
    sg.restore();

    const data = sg.getImageData(0, 0, w, h).data;
    let cov = 0;
    for (let i = 3; i < data.length; i += 16) if (data[i] > 40) cov++;
    if (cov < 6) return null;

    const [gx, gy] = centroid(poly);
    const [x, y] = this.toStage([gx, gy]);
    let dx = x - from[0], dy = y - from[1];
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-3) {
      const a = Math.random() * Math.PI * 2;
      dx = Math.cos(a);
      dy = Math.sin(a);
    } else {
      dx /= dist;
      dy /= dist;
    }
    const B = this.B;
    const speed = B * (0.6 + Math.random() * 1.1) * (1.2 - 0.5 * Math.min(1, dist / (B * 0.5))) * power;
    return {
      img,
      ox: minX - gx,
      oy: minY - gy,
      x,
      y,
      vx: dx * speed + (Math.random() - 0.5) * B * 0.25 * power,
      vy: dy * speed * 0.6 - B * (0.7 + Math.random() * 0.9) * power,
      rot: this.arot,
      vrot: (Math.random() - 0.5) * 9,
      flip: 0,
      vflip: (Math.random() - 0.5) * 10,
      r: Math.hypot(w, h) * 0.35 * this.k,
      resting: false,
    };
  }

  /** 껍질 색을 그대로 집어온 부스러기 */
  private makeCrumbs(sp: Pt, count: number, spread: number, power: number): Crumb[] {
    const out: Crumb[] = [];
    const a = this.alpha!;
    const [ix, iy] = this.toStage(sp);
    const B = this.B;
    for (let tries = 0; out.length < count && tries < count * 12; tries++) {
      const p: Pt = [sp[0] + gauss() * spread, sp[1] + gauss() * spread];
      if (!this.hit(p)) continue;
      const j = (Math.round(p[1]) * S + Math.round(p[0])) * 4;
      const [x, y] = this.toStage(p);
      const ang = Math.atan2(y - iy, x - ix) + gauss() * 0.4;
      const sp2 = B * (0.4 + Math.random() * 1.6) * power;
      out.push({
        x,
        y,
        vx: Math.cos(ang) * sp2,
        vy: Math.sin(ang) * sp2 * 0.6 - B * (0.5 + Math.random()) * power,
        rot: Math.random() * 6,
        vrot: (Math.random() - 0.5) * 20,
        size: (1.2 + Math.random() * 3) * (B / 300),
        color: `rgb(${a[j]},${a[j + 1]},${a[j + 2]})`,
        resting: false,
      });
    }
    return out;
  }

  private spawnCrumbs(sp: Pt, count: number, power: number) {
    this.crumbs.push(...this.makeCrumbs(sp, count, 14, power));
  }

  private shatter(sp: Pt, fromSnapshot: boolean) {
    this.stopHold();
    if (fromSnapshot && this.snapshot) {
      const snap = this.snapshot;
      this.shards = snap.shards.map((s) => ({ ...s }));
      this.chips = snap.chips.map((c) => ({ ...c }));
      this.crumbs = [...snap.preCrumbs, ...snap.burstCrumbs].map((c) => ({ ...c }));
    } else {
      const preCrumbs = this.crumbs.map((c) => ({ ...c }));
      const burstCrumbs = this.buildPieces(sp);
      this.crumbs.push(...burstCrumbs);
      this.snapshot = {
        shards: this.shards.map((s) => ({ ...s })),
        chips: this.chips.map((c) => ({ ...c })),
        preCrumbs,
        burstCrumbs: burstCrumbs.map((c) => ({ ...c })),
        impact: sp,
        anchor: [this.ax, this.ay, this.arot],
      };
    }
    this.stopPress();
    this.drag = null;
    this.state = "shattered";
    this.reveal = 0;
    this.brokeAt = this.rarity === "normal" ? this.rt : -1; // 희귀볼은 전용 배너가 대신
    this.goo = new Goo(48);
    this.goo.init(this.restGeom(), 0.55, this.B * 1.6);

    const bus = this.ensureBus();
    sfx().shatter(bus, this.style.crunch, this.timeScale);
    if (this.rarity === "rainbow") {
      this.fx.start("rainbow", this.rt, this.fxStage());
      sfx().rareChime(bus, this.timeScale);
      buzz([30, 40, 30, 40, 140]);
    } else if (this.rarity === "diamond") {
      this.fx.start("diamond", this.rt, this.fxStage());
      sfx().diamondChime(bus, this.timeScale);
      buzz([20, 60, 20, 60, 20, 300, 60, 400]);
    } else {
      buzz([25, 30, 60]);
    }
    clearTimeout(this.recordStopTimer);
    // 희귀 연출은 끝까지 영상에 담기도록 더 길게
    const hold = this.rarity === "diamond" ? 6000 : this.rarity === "rainbow" ? 4200 : 2600;
    this.recordStopTimer = window.setTimeout(() => this.stopRecording(), this.timeScale < 1 ? hold + 1600 : hold);
    this.onChange();
  }

  /** 보로노이 파편을 만들고, 튀는 부스러기를 돌려준다 */
  private buildPieces(sp: Pt): Crumb[] {
    const { box } = this;
    const seeds: Pt[] = [sp];
    for (let i = 0; i < 14; i++) {
      const r = 6 + Math.abs(gauss()) * 38, a = Math.random() * Math.PI * 2;
      seeds.push([sp[0] + Math.cos(a) * r, sp[1] + Math.sin(a) * r]);
    }
    for (let i = 0, tries = 0; i < 22 && tries < 400; tries++) {
      const p: Pt = [box.x + Math.random() * box.w, box.y + Math.random() * box.h];
      if (this.hit(p)) {
        seeds.push(p);
        i++;
      }
    }
    const cells = voronoiCells(seeds, box.x - 2, box.y - 2, box.x + box.w + 2, box.y + box.h + 2);
    const from = this.toStage(sp);
    this.shards = [];
    for (const cell of cells) {
      if (cell.length < 3) continue;
      const piece = this.cutPiece(cell, from, 1);
      if (piece) this.shards.push(piece);
    }
    return this.makeCrumbs(sp, 70, 60, 1);
  }

  // ---------- recording ----------

  /** 녹화는 덤: 브라우저가 못 하면(예외 포함) 조용히 건너뛰고 깨기는 그대로 */
  private startRecording() {
    if (typeof MediaRecorder === "undefined" || !this.canvas.captureStream) return;
    this.stopRecording(true);
    const gen = ++this.recGen;
    let stopTracks = () => {};
    try {
      // avc3 가 먼저: 녹화 중에 화면 크기가 바뀌어도 mp4 가 깨지지 않음
      const mime = [
        "video/mp4;codecs=avc3,mp4a.40.2",
        "video/mp4;codecs=avc1,mp4a.40.2",
        "video/mp4",
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ].find((m) => MediaRecorder.isTypeSupported(m));
      if (!mime) return;
      const video = this.canvas.captureStream(60);
      stopTracks = () => video.getVideoTracks().forEach((t) => t.stop());
      const audio = this.ensureBus().stream?.stream.getAudioTracks() ?? [];
      const stream = new MediaStream([...video.getVideoTracks(), ...audio]);
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
      const chunks: Blob[] = [];
      let discard = false;
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stopTracks();
        // 그 사이 볼이 바뀌었거나 새 녹화가 시작됐으면 버린다
        if (discard || gen !== this.recGen || !chunks.length) return;
        this.video = { blob: new Blob(chunks, { type: mime }), ext: mime.includes("mp4") ? "mp4" : "webm" };
        this.onChange();
      };
      rec.start(200);
      this.recorder = { rec, discard: () => (discard = true) };
      clearTimeout(this.recordStopTimer);
      this.recordStopTimer = window.setTimeout(() => this.stopRecording(), 30_000); // 안 깨고 방치할 때 상한
    } catch (e) {
      console.warn("[wakppu] 녹화를 시작하지 못함", e);
      stopTracks();
      this.recorder = null;
    }
  }

  private stopRecording(discard = false) {
    const r = this.recorder;
    this.recorder = null;
    if (!r || r.rec.state === "inactive") return;
    if (discard) r.discard();
    try {
      r.rec.stop();
    } catch {
      /* 이미 멈춤 */
    }
  }

  /** 볼이 바뀔 때: 녹화 중이던 것도, 멈추고 저장을 기다리던 것도 모두 버린다 */
  private discardRecording() {
    clearTimeout(this.recordStopTimer);
    this.recGen++;
    this.stopRecording(true);
  }

  // ---------- simulation ----------

  private frame = (now: number) => {
    // 다음 프레임을 먼저 예약: 한 프레임에서 오류가 나도 루프는 멈추지 않는다
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.033, (now - (this.last || now)) / 1000);
    this.last = now;
    // 화면 밖이면 쉰다 (녹화 중이면 영상이 멈추지 않게 계속)
    if (!this.visible && !this.recorder) return;
    this.rt += dt;
    const sdt = dt * this.timeScale * this.fx.timeScale(this.rt);
    this.t += sdt;
    this.step(sdt, dt);
    this.draw();
  };

  /** dt: 슬로모가 적용된 시뮬레이션 시간, rdt: 실제 시간 */
  private step(dt: number, rdt: number) {
    // 껍질 눌림 스프링 (꾹 누르는 동안은 눌린 상태 유지)
    const target = this.pointer ? 0.35 : 0;
    this.squishV += (-(this.squish - target) * 260 - this.squishV * 14) * dt;
    this.squish += this.squishV * dt;
    this.shake *= Math.exp(-dt * 18);
    if (this.crushing) this.shake = Math.max(this.shake, 0.6); // 꾹 누르는 동안 계속 부르르
    this.appear = Math.min(1, this.appear + dt * 3);
    // 말랑하게 출렁이는 스프링
    this.jigV += (-this.jig * 420 - this.jigV * 9) * dt;
    this.jig += this.jigV * dt;
    if (this.state === "intact") this.stepBall(dt);

    this.fx.step(rdt, this.rt, this.fxStage());
    for (const p of this.shards) this.stepPiece(p, dt);
    for (const p of this.chips) this.stepPiece(p, dt);
    this.stepCrumbs(dt);

    if (this.state === "shattered" && this.goo) {
      this.reveal = Math.min(1, this.reveal + dt * 2.5);
      this.goo.step(dt, this.restGeom(), this.t);
    }
  }

  /** 끌고 던진 공: 손가락을 따라오거나, 날아가서 벽·바닥·천장에 부딪히며 튕긴다 */
  private stepBall(dt: number) {
    const B = this.B;
    const hw = this.box.w * this.k * 0.5;
    const hh = this.box.h * this.k;
    const home = this.homeY;
    const d = this.drag;
    if (d) {
      const tx = Math.max(hw, Math.min(this.W - hw, d.tx));
      const ty = Math.max(hh, Math.min(home, d.ty));
      // 벽에 대고 세게 밀면 부딪힘
      if (tx !== d.tx && Math.abs(this.avx) > B * 1.2) this.impact(Math.abs(this.avx), tx < this.W / 2 ? "left" : "right");
      if (ty !== d.ty && Math.abs(this.avy) > B * 1.2) this.impact(Math.abs(this.avy), ty >= home ? "floor" : "top");
      this.avx = (tx - this.ax) * 18;
      this.avy = (ty - this.ay) * 18;
      this.ax += this.avx * dt;
      this.ay += this.avy * dt;
      // 끄는 방향으로 살짝 기울어짐
      this.arot += (Math.max(-0.35, Math.min(0.35, this.avx / (B * 10))) - this.arot) * Math.min(1, dt * 10);
      this.avrot = 0;
      return;
    }
    this.avy += B * 3.2 * dt;
    this.ax += this.avx * dt;
    this.ay += this.avy * dt;
    this.arot += this.avrot * dt;
    if (this.ay > home) {
      const v = this.avy;
      this.ay = home;
      this.impact(v, "floor");
      this.avy = v < B * 0.25 ? 0 : -v * 0.38;
      this.avx *= 0.82;
      this.avrot *= 0.6;
    }
    if (this.ay - hh < 0) {
      const v = -this.avy;
      this.ay = hh;
      this.impact(v, "top");
      this.avy = Math.abs(this.avy) * 0.4;
    }
    if (this.ax - hw < 0) {
      const v = -this.avx;
      this.ax = hw;
      this.impact(v, "left");
      this.avx = Math.abs(this.avx) * 0.45;
      this.avrot *= -0.5;
    } else if (this.ax + hw > this.W) {
      const v = this.avx;
      this.ax = this.W - hw;
      this.impact(v, "right");
      this.avx = -Math.abs(this.avx) * 0.45;
      this.avrot *= -0.5;
    }
    if (this.ay >= home - 0.5 && this.avy === 0) {
      // 바닥에서는 미끄러지다 멈추고, 오뚝이처럼 똑바로 선다
      this.avx *= 1 - Math.min(1, 4 * dt);
      this.avrot += (-this.arot * 40 - this.avrot * 7) * dt;
    } else {
      this.avrot *= 1 - 0.5 * dt;
    }
  }

  /** 부딪힘: 출렁·부르르·소리·진동, 세게 부딪히면 그쪽에 금이 간다 */
  private impact(speed: number, side: "floor" | "top" | "left" | "right") {
    const B = this.B;
    if (speed < B * 0.6 || this.rt - this.lastImpact < 0.08) return;
    this.lastImpact = this.rt;
    const power = Math.min(1, speed / (B * 4));
    this.jigV += 4 + power * 10;
    this.shake = Math.min(1, this.shake + power);
    sfx().crunch(this.ensureBus(), 0.2 + 0.5 * power, this.style.crunch);
    buzz(Math.round(10 + power * 30));
    if (speed < B * 2.2) {
      const at: Pt = side === "floor" ? [this.ax, this.ay] : side === "top" ? [this.ax, this.ay - this.box.h * this.k] : [side === "left" ? this.ax - this.box.w * this.k * 0.5 : this.ax + this.box.w * this.k * 0.5, this.ay - this.box.h * this.k * 0.5];
      this.words.spawn("bounce", at[0], at[1], Math.max(13, B * (0.04 + 0.025 * power)), this.rt);
      return;
    }
    const { box } = this;
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const jitter = () => (Math.random() - 0.5) * 0.3;
    const edge: Pt =
      side === "floor"
        ? [cx + jitter() * box.w, box.y + box.h - 4]
        : side === "top"
          ? [cx + jitter() * box.w, box.y + 4]
          : side === "left"
            ? [box.x + 4, cy + jitter() * box.h]
            : [box.x + box.w - 4, cy + jitter() * box.h];
    const sp = this.pullInside(edge);
    if (sp) this.crack(sp, Math.min(1, 0.6 + power));
  }

  private stepPiece(s: Piece, dt: number) {
    if (s.resting) return;
    const B = this.B;
    const floor = this.floorY;
    s.vy += B * 3.2 * dt;
    s.vx *= 1 - 0.6 * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.rot += s.vrot * dt;
    s.flip += s.vflip * dt;
    const half = s.r * 0.45;
    if (s.y + half > floor) {
      s.y = floor - half;
      if (s.vy > B * 0.35 && this.t - this.lastTick > 0.03) {
        this.lastTick = this.t;
        sfx().tick(this.ensureBus(), Math.min(1, s.vy / (B * 2)), this.style.crunch, this.timeScale);
      }
      s.vy *= -0.28;
      s.vx *= 0.7;
      s.vrot *= 0.55;
      s.vflip *= 0.5;
      if (Math.abs(s.vy) < B * 0.12) s.vy = 0;
    }
    if (s.vy === 0 && s.y + half >= floor - 0.5) {
      s.vx *= 1 - Math.min(1, 5 * dt);
      s.vrot *= 1 - Math.min(1, 5 * dt);
      const flat = Math.round(s.flip / Math.PI) * Math.PI; // 바닥에 납작하게 눕기
      s.flip += (flat - s.flip) * Math.min(1, 8 * dt);
      if (Math.abs(s.vx) < B * 0.03) s.resting = true;
    }
    this.walls(s, half);
  }

  private stepCrumbs(dt: number) {
    const B = this.B;
    const floor = this.floorY;
    for (const c of this.crumbs) {
      if (c.resting) continue;
      c.vy += B * 3.2 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot += c.vrot * dt;
      if (c.y > floor) {
        c.y = floor;
        c.vy *= -0.2;
        c.vx *= 0.5;
        if (Math.abs(c.vy) < B * 0.1) c.resting = true;
      }
      this.walls(c, 0);
    }
  }

  private walls(b: Body, r: number) {
    if (b.x < r) {
      b.x = r;
      b.vx = Math.abs(b.vx) * 0.5;
    } else if (b.x > this.W - r) {
      b.x = this.W - r;
      b.vx = -Math.abs(b.vx) * 0.5;
    }
  }

  // ---------- drawing ----------

  private draw() {
    const { g, W, dpr, B, k } = this;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 배경도 캔버스에 직접 그린다 (영상 녹화에 같이 담기도록)
    this.drawBackdrop();

    if (this.state === "empty" || !this.shell) return;
    const [sx0, sy0] = this.fx.shake(this.rt, B);
    g.translate(sx0, sy0);

    if (this.state === "intact") {
      // 공이 높이 뜰수록 그림자는 작고 옅게
      const lift = 1 - Math.min(0.7, Math.max(0, this.homeY - this.ay) / (this.H * 0.6));
      this.shadow(this.ax, this.box.w * k * 0.42 * (0.6 + 0.4 * lift), 0.2 * lift, this.tint);
      const [sx, sy] = this.ballScale;
      // 금이 갈 때·부딪힐 때 부르르 떨림
      const jx = (Math.random() - 0.5) * this.shake * B * 0.02;
      const jy = (Math.random() - 0.5) * this.shake * B * 0.012;
      g.save();
      g.translate(this.ax + jx, this.ay + jy); // 모양 아래쪽 가운데를 기준으로 눌리고 기울어짐
      g.rotate(this.arot);
      g.scale(sx, sy);
      g.drawImage(this.cracked, -(this.box.x + this.box.w / 2) * k, -(this.box.y + this.box.h) * k, B, B);
      g.restore();
      this.drawPieces(this.chips);
      this.drawCrumbs();
      this.words.draw(g, this.rt);
      return;
    }

    const goo = this.goo;
    const stage = this.fxStage();
    if (goo) {
      const rest = this.restGeom();
      this.fx.drawBack(g, this.rt, stage, goo.cx, goo.cy);
      this.shadow(goo.cx, rest.rx * 1.05, 0.22, this.fillingTint());
      drawFilling(g, goo, rest.r, {
        type: this.style.fillingType,
        color: this.style.fillingColor,
        t: this.t,
        sparkles: this.sparkles,
        facets: this.facets,
      });
    }
    this.drawPieces(this.shards);
    this.drawPieces(this.chips);
    this.drawCrumbs();
    if (goo) this.fx.drawFront(g, this.rt, stage, goo.cx, goo.cy);
    this.words.draw(g, this.rt);
    if (this.brokeAt >= 0) drawPopText(g, "부서졌다!", W / 2, this.H * 0.2, Math.max(22, B * 0.13), this.rt - this.brokeAt, 1.3);
  }

  private drawPieces(list: Piece[]) {
    const { g } = this;
    for (const s of list) {
      const c = Math.cos(s.flip);
      const fx = Math.sign(c || 1) * Math.max(0.12, Math.abs(c));
      g.save();
      g.translate(s.x, s.y);
      g.rotate(s.rot);
      g.scale(this.k * fx, this.k);
      g.drawImage(s.img, s.ox, s.oy);
      g.restore();
    }
  }

  private drawCrumbs() {
    const { g } = this;
    for (const c of this.crumbs) {
      g.save();
      g.translate(c.x, c.y);
      g.rotate(c.rot);
      g.fillStyle = c.color;
      g.fillRect(-c.size / 2, -c.size / 2, c.size, c.size * 0.7);
      g.restore();
    }
  }

  /** 젤리 유리 스튜디오: 분홍빛 배경 + 반짝이는 유리 바닥 + 바닥에 일렁이는 코스틱 빛 */
  private drawBackdrop() {
    const { g, W, H, B, rt } = this;
    const floor = this.floorY;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#fff6fa");
    bg.addColorStop(0.55, "#fdeef5");
    bg.addColorStop(1, "#f6e6f6");
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    for (const [px, py, color] of [
      [0.18, 0.22, "255,190,220"],
      [0.88, 0.12, "200,210,255"],
    ] as const) {
      const x = W * (px + 0.03 * Math.sin(rt * 0.3 + px * 9));
      const y = H * py;
      const r = B * 0.7;
      const pool = g.createRadialGradient(x, y, 0, x, y, r);
      pool.addColorStop(0, `rgba(${color},0.45)`);
      pool.addColorStop(1, `rgba(${color},0)`);
      g.fillStyle = pool;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }

    const top = floor - B * 0.02;
    const fl = g.createLinearGradient(0, top, 0, H);
    fl.addColorStop(0, "rgba(255,255,255,0.9)");
    fl.addColorStop(0.1, "rgba(255,228,240,0.55)");
    fl.addColorStop(1, "rgba(238,214,240,0.65)");
    g.fillStyle = fl;
    g.fillRect(0, top, W, H - top);

    g.save();
    g.beginPath();
    g.rect(0, top, W, H - top);
    g.clip();
    g.lineCap = "round";
    const depth = H - floor;
    for (let i = 0; i < 6; i++) {
      const y0 = floor + depth * (0.12 + i * 0.15);
      g.beginPath();
      for (let x = -10; x <= W + 10; x += 12) {
        const u = x / W;
        const y =
          y0 +
          Math.sin(u * (5 + i) + rt * (0.6 + i * 0.15) + i) * depth * 0.05 +
          Math.sin(u * 13 - rt * 0.9 + i * 2) * depth * 0.015;
        if (x === -10) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = `rgba(255,255,255,${0.6 - i * 0.06})`;
      g.lineWidth = 1.2 + (i % 2);
      g.stroke();
    }
    g.restore();
  }

  /** 속재료 색 (그림자에 비치는 빛 색) */
  private fillingTint(): RGB {
    switch (this.style.fillingType) {
      case "rainbow":
        return hslToRgb((this.rt * 60) % 360, 0.9, 0.65);
      case "diamond":
        return [140, 205, 255];
      default:
        return hexToRgb(this.style.fillingColor);
    }
  }

  /** 젤리가 빛을 통과시켜 생기는 색 그림자 + 가운데 모인 밝은 빛 + 바닥 접촉 그림자 */
  private shadow(x: number, rx: number, alpha: number, tint: RGB) {
    const { g } = this;
    const y = this.floorY;
    g.save();
    g.translate(x + rx * 0.18, y); // 빛이 왼쪽 위에서 오니 그림자는 오른쪽으로 살짝
    g.scale(1, 0.22);
    const rg = g.createRadialGradient(0, 0, 0, 0, 0, rx * 1.15);
    rg.addColorStop(0, rgba(tint, alpha * 2.2));
    rg.addColorStop(0.55, rgba(tint, alpha * 1.2));
    rg.addColorStop(1, rgba(tint, 0));
    g.fillStyle = rg;
    g.beginPath();
    g.arc(0, 0, rx * 1.15, 0, Math.PI * 2);
    g.fill();
    const core = g.createRadialGradient(-rx * 0.15, 0, 0, -rx * 0.15, 0, rx * 0.45);
    core.addColorStop(0, "rgba(255,255,255,0.75)");
    core.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = core;
    g.beginPath();
    g.arc(-rx * 0.15, 0, rx * 0.45, 0, Math.PI * 2);
    g.fill();
    g.restore();

    g.save();
    g.translate(x, y);
    g.scale(1, 0.12);
    const ao = g.createRadialGradient(0, 0, 0, 0, 0, rx * 0.75);
    ao.addColorStop(0, `rgba(90,40,70,${alpha * 0.9})`);
    ao.addColorStop(1, "rgba(90,40,70,0)");
    g.fillStyle = ao;
    g.beginPath();
    g.arc(0, 0, rx * 0.75, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}

/** 불투명한 픽셀의 평균색을 젤리처럼 선명하게 */
function vividAverage(data: Uint8ClampedArray): RGB {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 16) {
    if (data[i + 3] < 128) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  if (!n) return [255, 150, 190];
  const [h, s, l] = rgbToHsl([r / n, g / n, b / n]);
  return hslToRgb(h, Math.min(1, s * 1.4 + 0.15), Math.max(0.5, Math.min(0.68, l)));
}

function gauss() {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}
function easeOut(x: number) {
  return 1 - Math.pow(1 - x, 3);
}
function easeOutBack(x: number) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
