// 배경에 떠다니는 젤리 왁뿌볼들. 톡 누르면 와장창 부서지고,
// 잠시 뒤 다른 젤리가 '뽁' 하고 나타난다. 화면 전체를 덮는 캔버스 하나에 모두 그린다.
import { renderBasicBall } from "./ballRender";
import { ctx2d, hslToRgb, makeCanvas, rgba, rgbToHsl, type RGB } from "./imageUtil";
import { ALL_KINDS, drawJellySubject, JELLY_WAX, POPULAR_KINDS, SHAPE_KINDS, type JellyKind } from "./jellyShapes";
import { buzz, sfx, type Bus } from "./sound";
import { centroid, voronoiCells, type Pt } from "./voronoi";

const TEX = 360; // 배경 젤리 텍스처 크기 (px)

interface Texture {
  img: HTMLCanvasElement;
  blurred: HTMLCanvasElement | null;
  data: Uint8ClampedArray;
  tint: RGB;
  box: { x0: number; y0: number; x1: number; y1: number };
}

interface Slot {
  fx: number;
  fy: number;
  size: number;
  far: boolean;
  rot: number;
  phase: number;
  speed: number;
  kind: JellyKind | null;
  born: number;
  respawnAt: number;
}

interface Piece {
  img: HTMLCanvasElement;
  ox: number;
  oy: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  scale: number;
  life: number;
}

interface Crumb {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
}

interface Pose {
  x: number;
  y: number;
  D: number;
  rot: number;
  sx: number;
  sy: number;
}

// 화면 가장자리에 걸쳐 떠 있는 자리들 (fx, fy 는 화면 비율, size 는 넓은 화면 기준 px — 예전의 두 배)
const SLOTS: Pick<Slot, "fx" | "fy" | "size" | "far">[] = [
  { fx: 0.06, fy: 0.1, size: 300, far: false },
  { fx: 0.96, fy: 0.2, size: 250, far: false },
  { fx: 0.03, fy: 0.72, size: 230, far: true },
  { fx: 0.93, fy: 0.86, size: 210, far: false },
  { fx: 1.0, fy: 0.5, size: 170, far: true },
  { fx: 0.42, fy: 1.02, size: 270, far: false },
];

export class JellyField {
  private g: CanvasRenderingContext2D;
  private W = 1;
  private H = 1;
  private dpr = 1;
  private tex = new Map<JellyKind, Texture>();
  private slots: Slot[];
  private pieces: Piece[] = [];
  private crumbs: Crumb[] = [];
  private t = 0;
  private last = 0;
  private bus: Bus | null = null;
  /** 누른 자리 — 짧게 톡 하고 뗐을 때만 깨진다 (스크롤하려고 쓸어내릴 때는 그대로) */
  private tap: { id: number; x: number; y: number; at: number } | null = null;
  /** 움직임 줄이기 설정이면 둥실거리지 않는 멈춘 그림 (바뀐 게 있을 때만 다시 그림) */
  private reduced = matchMedia("(prefers-reduced-motion: reduce)");
  private dirty = true;

  constructor(private canvas: HTMLCanvasElement) {
    this.g = canvas.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.reduced.addEventListener?.("change", () => (this.dirty = true));
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", () => (this.tap = null));

    // 눈에 잘 띄는 자리(0·1·3번)에 인기 왁뿌볼, 나머지는 젤리 도형
    const popular = shuffle([...POPULAR_KINDS]);
    const shapes = shuffle([...SHAPE_KINDS]);
    const initial = SLOTS.map((_, i) => ([0, 1, 3].includes(i) ? popular.pop()! : shapes.pop()!));
    this.slots = SLOTS.map((s) => ({
      ...s,
      rot: (Math.random() - 0.5) * 0.6,
      phase: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 0.4,
      kind: null,
      born: 0,
      respawnAt: 0,
    }));
    // 텍스처는 한 번에 하나씩 만들어 첫 화면이 멈추지 않게
    const queue = initial.map((kind, i) => [i, kind] as const);
    const next = () => {
      const item = queue.shift();
      if (!item) return;
      const [i, kind] = item;
      this.texture(kind);
      this.slots[i].kind = kind;
      this.slots[i].born = this.t;
      this.dirty = true;
      setTimeout(next, 60);
    };
    setTimeout(next, 300);
    requestAnimationFrame(this.frame);
  }

  // ---------- 텍스처 ----------

  private texture(kind: JellyKind): Texture {
    const cached = this.tex.get(kind);
    if (cached) return cached;
    const img = renderBasicBall(drawJellySubject(kind), JELLY_WAX[kind], TEX);
    const data = ctx2d(img).getImageData(0, 0, TEX, TEX).data;
    let x0 = TEX, y0 = TEX, x1 = 0, y1 = 0, r = 0, g = 0, b = 0, n = 0;
    for (let y = 0; y < TEX; y++)
      for (let x = 0; x < TEX; x++) {
        const i = (y * TEX + x) * 4;
        if (data[i + 3] < 60) continue;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
        if ((x + y) % 4 === 0) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n++;
        }
      }
    const [h, s, l] = rgbToHsl(n ? [r / n, g / n, b / n] : [255, 150, 190]);
    let blurred: HTMLCanvasElement | null = null;
    const bc = makeCanvas(TEX, TEX);
    const bg = ctx2d(bc);
    if ("filter" in bg) {
      bg.filter = "blur(4px)";
      bg.drawImage(img, 0, 0);
      blurred = bc;
    }
    const t: Texture = {
      img,
      blurred,
      data,
      tint: hslToRgb(h, Math.min(1, s * 1.4 + 0.15), Math.max(0.5, Math.min(0.68, l))),
      box: { x0, y0, x1, y1 },
    };
    this.tex.set(kind, t);
    return t;
  }

  // ---------- 배치 ----------

  private resize() {
    this.dpr = Math.min(1.5, window.devicePixelRatio || 1);
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.dirty = true;
  }

  /** 좁은 화면에서는 조금 작게 */
  private get scaleK() {
    return Math.max(0.55, Math.min(1, this.W / 1100 + 0.3));
  }

  private pose(s: Slot): Pose {
    const still = this.reduced.matches;
    const t = still ? 0 : this.t;
    const D = s.size * this.scaleK;
    const appear = still ? 1 : easeOutBack(Math.min(1, (t - s.born) / 0.55));
    const squash = Math.sin(t * s.speed * 1.7 + s.phase) * 0.025;
    return {
      x: s.fx * this.W + Math.cos(t * s.speed * 0.6 + s.phase) * 8,
      y: s.fy * this.H + Math.sin(t * s.speed + s.phase) * 14,
      D,
      rot: s.rot + Math.sin(t * s.speed * 0.8 + s.phase) * 0.08,
      sx: (1 + squash) * appear,
      sy: (1 - squash) * appear,
    };
  }

  /** 화면 좌표 → 텍스처 좌표 */
  private toTex(p: Pose, px: number, py: number): Pt {
    const dx = px - p.x, dy = py - p.y;
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    const lx = (dx * c + dy * s) / p.sx;
    const ly = (-dx * s + dy * c) / p.sy;
    return [(lx / p.D + 0.5) * TEX, (ly / p.D + 0.5) * TEX];
  }

  /** 텍스처 좌표 → 화면 좌표 */
  private toScreen(p: Pose, u: number, v: number): Pt {
    const lx = (u / TEX - 0.5) * p.D * p.sx;
    const ly = (v / TEX - 0.5) * p.D * p.sy;
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    return [p.x + lx * c - ly * s, p.y + lx * s + ly * c];
  }

  private hit(px: number, py: number): { slot: Slot; u: number; v: number } | null {
    // 앞쪽(흐리지 않은) 젤리부터
    const order = [...this.slots].sort((a, b) => Number(a.far) - Number(b.far));
    for (const slot of order) {
      if (!slot.kind) continue;
      const tex = this.tex.get(slot.kind);
      if (!tex) continue;
      const [u, v] = this.toTex(this.pose(slot), px, py);
      const iu = Math.round(u), iv = Math.round(v);
      if (iu < 0 || iv < 0 || iu >= TEX || iv >= TEX) continue;
      if (tex.data[(iv * TEX + iu) * 4 + 3] > 60) return { slot, u, v };
    }
    return null;
  }

  // ---------- 입력 ----------

  private onMove = (e: PointerEvent) => {
    this.canvas.style.cursor = this.hit(e.clientX, e.clientY) ? "pointer" : "";
  };

  private onDown = (e: PointerEvent) => {
    this.tap = null;
    if (!this.hit(e.clientX, e.clientY)) return;
    e.preventDefault();
    this.tap = { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now() };
  };

  private onUp = (e: PointerEvent) => {
    const tap = this.tap;
    this.tap = null;
    if (!tap || tap.id !== e.pointerId) return;
    if (performance.now() - tap.at > 300 || Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 10) return;
    const h = this.hit(e.clientX, e.clientY);
    if (h) this.shatter(h.slot, h.u, h.v);
  };

  // ---------- 와장창 ----------

  private shatter(slot: Slot, u: number, v: number) {
    const kind = slot.kind!;
    const tex = this.texture(kind);
    const p = this.pose(slot);
    const { box, data } = tex;
    const inside = (x: number, y: number) => {
      const ix = Math.round(x), iy = Math.round(y);
      return ix >= 0 && iy >= 0 && ix < TEX && iy < TEX && data[(iy * TEX + ix) * 4 + 3] > 60;
    };

    const seeds: Pt[] = [[u, v]];
    for (let i = 0; i < 10; i++) seeds.push([u + gauss() * 30, v + gauss() * 30]);
    for (let i = 0, tries = 0; i < 14 && tries < 300; tries++) {
      const q: Pt = [box.x0 + Math.random() * (box.x1 - box.x0), box.y0 + Math.random() * (box.y1 - box.y0)];
      if (inside(q[0], q[1])) {
        seeds.push(q);
        i++;
      }
    }
    const [hx, hy] = this.toScreen(p, u, v);
    const scale = (p.D / TEX) * p.sx;
    for (const cell of voronoiCells(seeds, box.x0 - 2, box.y0 - 2, box.x1 + 2, box.y1 + 2)) {
      if (cell.length < 3) continue;
      const piece = cutPiece(tex.img, cell);
      if (!piece) continue;
      const [gx, gy] = centroid(cell);
      const [x, y] = this.toScreen(p, gx, gy);
      let dx = x - hx, dy = y - hy;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const sp = p.D * (1.5 + Math.random() * 2.5);
      this.pieces.push({
        img: piece.img,
        ox: piece.minX - gx,
        oy: piece.minY - gy,
        x,
        y,
        vx: dx * sp,
        vy: dy * sp * 0.7 - p.D * (1 + Math.random()),
        rot: p.rot,
        vrot: (Math.random() - 0.5) * 9,
        scale,
        life: 0,
      });
    }
    for (let i = 0, tries = 0; i < 40 && tries < 400; tries++) {
      const q: Pt = [u + gauss() * 50, v + gauss() * 50];
      if (!inside(q[0], q[1])) continue;
      const j = (Math.round(q[1]) * TEX + Math.round(q[0])) * 4;
      const [x, y] = this.toScreen(p, q[0], q[1]);
      const a = Math.random() * Math.PI * 2, sp = p.D * (0.6 + Math.random() * 2.4);
      this.crumbs.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - p.D,
        size: 2 + Math.random() * 4,
        color: `rgb(${data[j]},${data[j + 1]},${data[j + 2]})`,
        life: 0,
      });
      i++;
    }

    const s = sfx();
    if (!this.bus) {
      this.bus = s.createBus();
      this.bus.input.gain.value = 0.75;
    }
    s.shatter(this.bus, "crispy");
    buzz([20, 30, 50]);

    slot.kind = null;
    slot.respawnAt = this.t + 0.9 + Math.random() * 0.5;
    slot.rot = (Math.random() - 0.5) * 0.6;
  }

  /** 지금 떠 있지 않은 젤리 중에서 하나 (방금 깨진 건 제외) — 인기 왁뿌볼은 두 배로 자주 */
  private pickKind(exclude: JellyKind | null): JellyKind {
    const showing = new Set(this.slots.map((s) => s.kind).filter(Boolean));
    let pool = ALL_KINDS.filter((k) => k !== exclude && !showing.has(k));
    if (!pool.length) pool = ALL_KINDS.filter((k) => k !== exclude);
    const weighted = pool.flatMap((k) => (POPULAR_KINDS.includes(k) ? [k, k] : [k]));
    return weighted[Math.floor(Math.random() * weighted.length)];
  }

  // ---------- 루프 ----------

  private lastKind = new Map<Slot, JellyKind>();

  private frame = (now: number) => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.033, (now - (this.last || now)) / 1000);
    this.last = now;
    if (document.hidden) return;
    this.t += dt;

    for (const s of this.slots) {
      if (s.kind) {
        this.lastKind.set(s, s.kind);
        continue;
      }
      if (s.respawnAt && this.t >= s.respawnAt) {
        const kind = this.pickKind(this.lastKind.get(s) ?? null);
        this.texture(kind);
        s.kind = kind;
        s.born = this.t;
        s.respawnAt = 0;
        this.dirty = true;
        if (this.bus) sfx().pop(this.bus);
      }
    }
    // 조각이 날아다니는 중이면 (마지막 조각이 사라지는 프레임까지) 그려야 한다
    const moving = this.pieces.length > 0 || this.crumbs.length > 0;

    const G = 2400;
    for (const p of this.pieces) {
      p.vy += G * dt;
      p.vx *= 1 - 0.4 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
      p.life += dt;
    }
    this.pieces = this.pieces.filter((p) => p.life < 1.6 && p.y < this.H + 300);
    for (const c of this.crumbs) {
      c.vy += G * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.life += dt;
    }
    this.crumbs = this.crumbs.filter((c) => c.life < 1.4 && c.y < this.H + 50);

    if (this.reduced.matches && !this.dirty && !moving) return;
    this.dirty = false;
    this.draw();
  };

  private draw() {
    const { g } = this;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);

    // 멀리(흐릿한) 것부터
    const order = [...this.slots].sort((a, b) => Number(b.far) - Number(a.far));
    for (const s of order) {
      if (!s.kind) continue;
      const tex = this.tex.get(s.kind);
      if (!tex) continue;
      const p = this.pose(s);
      // 젤리를 통과한 빛이 만든 색 그림자
      g.save();
      g.translate(p.x + p.D * 0.06, p.y + p.D * 0.42);
      g.scale(1, 0.22);
      const rx = p.D * 0.36 * p.sx;
      const sh = g.createRadialGradient(0, 0, 0, 0, 0, rx);
      sh.addColorStop(0, rgba(tex.tint, s.far ? 0.18 : 0.32));
      sh.addColorStop(1, rgba(tex.tint, 0));
      g.fillStyle = sh;
      g.beginPath();
      g.arc(0, 0, rx, 0, Math.PI * 2);
      g.fill();
      g.restore();

      g.save();
      g.globalAlpha = s.far ? 0.6 : 0.95;
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.scale(p.sx, p.sy);
      g.drawImage(s.far && tex.blurred ? tex.blurred : tex.img, -p.D / 2, -p.D / 2, p.D, p.D);
      g.restore();
    }

    for (const p of this.pieces) {
      g.save();
      g.globalAlpha = p.life < 0.9 ? 1 : Math.max(0, 1 - (p.life - 0.9) / 0.7);
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.scale(p.scale, p.scale);
      g.drawImage(p.img, p.ox, p.oy);
      g.restore();
    }
    for (const c of this.crumbs) {
      g.globalAlpha = Math.max(0, 1 - c.life / 1.4);
      g.fillStyle = c.color;
      g.fillRect(c.x - c.size / 2, c.y - c.size / 2, c.size, c.size * 0.7);
    }
    g.globalAlpha = 1;
  }
}

/** 텍스처에서 다각형 하나를 잘라낸 조각 (투명한 부분뿐이면 null) */
function cutPiece(src: HTMLCanvasElement, poly: Pt[]) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const minX = Math.floor(Math.min(...xs)) - 1, minY = Math.floor(Math.min(...ys)) - 1;
  const w = Math.ceil(Math.max(...xs)) - minX + 2, h = Math.ceil(Math.max(...ys)) - minY + 2;
  const img = makeCanvas(w, h);
  const g = ctx2d(img);
  g.translate(-minX, -minY);
  g.beginPath();
  poly.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.save();
  g.clip();
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = "source-atop";
  g.strokeStyle = "rgba(255,255,255,0.65)";
  g.lineWidth = 3;
  g.stroke();
  g.restore();
  const d = g.getImageData(0, 0, w, h).data;
  let cov = 0;
  for (let i = 3; i < d.length; i += 16) if (d[i] > 40) cov++;
  return cov < 6 ? null : { img, minX, minY };
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function gauss() {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

function easeOutBack(x: number) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
