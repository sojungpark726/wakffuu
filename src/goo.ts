// 부서진 뒤 드러나는 슬라임: 점 48개짜리 고리 모양 소프트바디.
// 누르면 움푹 들어가고, 끌면 쭉 늘어나고, 놓으면 출렁이며 제 모양으로 돌아온다.

export interface GooRest {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

const K_REST = 70; // 제 모양으로 돌아가려는 힘 (낮을수록 흐물흐물)
const K_NEIGHBOR = 220; // 이웃 점끼리 매끈하게 이어지려는 힘
const K_GRAB = 700; // 손가락에 들러붙는 힘
const K_CENTER = 45;
const K_COUPLE = 25;
const DAMPING = 4.5;

interface Grab {
  w: Float32Array;
  x0: Float32Array;
  y0: Float32Array;
  ax: number;
  ay: number;
  px: number;
  py: number;
  cx0: number;
  cy0: number;
  wc: number;
}

export class Goo {
  readonly x: Float32Array;
  readonly y: Float32Array;
  cx = 0;
  cy = 0;
  private vx: Float32Array;
  private vy: Float32Array;
  private cos: Float32Array;
  private sin: Float32Array;
  private cvx = 0;
  private cvy = 0;
  private grab: Grab | null = null;

  constructor(readonly n = 48) {
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.cos = new Float32Array(n);
    this.sin = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.cos[i] = Math.cos((i / n) * Math.PI * 2);
      this.sin[i] = Math.sin((i / n) * Math.PI * 2);
    }
  }

  /** scale 배 크기에서 burst 속도로 퍼져 나오며 시작 */
  init(rest: GooRest, scale: number, burst: number) {
    this.cx = rest.x;
    this.cy = rest.y;
    this.cvx = this.cvy = 0;
    this.grab = null;
    for (let i = 0; i < this.n; i++) {
      this.x[i] = rest.x + this.cos[i] * rest.rx * scale;
      this.y[i] = rest.y + this.sin[i] * rest.ry * scale;
      this.vx[i] = this.cos[i] * burst;
      this.vy[i] = this.sin[i] * burst;
    }
  }

  step(dt: number, rest: GooRest, t: number) {
    const { n, x, y, vx, vy } = this;
    const sub = 3;
    const h = dt / sub;
    const damp = Math.exp(-DAMPING * h);
    const gr = this.grab;
    const dx = gr ? gr.px - gr.ax : 0;
    const dy = gr ? gr.py - gr.ay : 0;

    for (let s = 0; s < sub; s++) {
      let mx = 0, my = 0;
      for (let i = 0; i < n; i++) {
        mx += x[i];
        my += y[i];
      }
      mx /= n;
      my /= n;
      let ax = (rest.x - this.cx) * K_CENTER + (mx - this.cx) * K_COUPLE;
      let ay = (rest.y - this.cy) * K_CENTER + (my - this.cy) * K_COUPLE;
      if (gr) {
        ax += (gr.cx0 + dx * gr.wc - this.cx) * K_GRAB * gr.wc * 0.5;
        ay += (gr.cy0 + dy * gr.wc - this.cy) * K_GRAB * gr.wc * 0.5;
      }
      this.cvx = (this.cvx + ax * h) * damp;
      this.cvy = (this.cvy + ay * h) * damp;
      this.cx += this.cvx * h;
      this.cy += this.cvy * h;

      for (let i = 0; i < n; i++) {
        const th = (i / n) * Math.PI * 2;
        const wob = 1 + 0.025 * Math.sin(5 * th - t * 2.1) + 0.02 * Math.sin(2 * th + t * 1.3);
        const tx = this.cx + this.cos[i] * rest.rx * wob;
        const ty = this.cy + this.sin[i] * rest.ry * wob;
        const a = (i + n - 1) % n, b = (i + 1) % n;
        let fx = (tx - x[i]) * K_REST + (x[a] + x[b] - 2 * x[i]) * K_NEIGHBOR;
        let fy = (ty - y[i]) * K_REST + (y[a] + y[b] - 2 * y[i]) * K_NEIGHBOR;
        if (gr) {
          const w = gr.w[i];
          fx += (gr.x0[i] + dx * w - x[i]) * K_GRAB * w;
          fy += (gr.y0[i] + dy * w - y[i]) * K_GRAB * w;
        }
        vx[i] = (vx[i] + fx * h) * damp;
        vy[i] = (vy[i] + fy * h) * damp;
      }
      for (let i = 0; i < n; i++) {
        x[i] += vx[i] * h;
        y[i] += vy[i] * h;
      }
    }
  }

  /** 꾹 누르기: 누른 곳 주변이 안쪽으로 움푹 */
  poke(px: number, py: number, R: number, strength: number) {
    const { n, x, y, vx, vy } = this;
    for (let i = 0; i < n; i++) {
      const w = Math.exp(-((Math.hypot(x[i] - px, y[i] - py) / (R * 0.55)) ** 2));
      const ux = this.cx - x[i], uy = this.cy - y[i];
      const l = Math.hypot(ux, uy) || 1;
      vx[i] += (ux / l) * strength * w;
      vy[i] += (uy / l) * strength * w;
    }
    this.cvy += strength * 0.08;
  }

  /** 잡기: 가까운 점일수록 손가락을 강하게 따라온다 (가운데를 잡으면 통째로 끌려옴) */
  grabAt(px: number, py: number, R: number) {
    const { n, x, y } = this;
    const w = new Float32Array(n);
    let max = 0;
    for (let i = 0; i < n; i++) {
      w[i] = Math.exp(-((Math.hypot(x[i] - px, y[i] - py) / (R * 0.7)) ** 2));
      max = Math.max(max, w[i]);
    }
    let sum = 0;
    for (let i = 0; i < n; i++) {
      w[i] /= max || 1;
      sum += w[i];
    }
    this.grab = { w, x0: x.slice(), y0: y.slice(), ax: px, ay: py, px, py, cx0: this.cx, cy0: this.cy, wc: sum / n };
  }

  /** 끌기: 멀리 끌수록 덜 따라오는 고무줄 느낌 (최대 maxPull) */
  drag(px: number, py: number, maxPull: number) {
    const gr = this.grab;
    if (!gr) return;
    const dx = px - gr.ax, dy = py - gr.ay;
    const len = Math.hypot(dx, dy);
    const s = len > 0 ? (maxPull * Math.tanh(len / maxPull)) / len : 1;
    gr.px = gr.ax + dx * s;
    gr.py = gr.ay + dy * s;
  }

  /** 놓기: 얼마나 늘였었는지 돌려준다 (소리 크기용) */
  release(): number {
    const gr = this.grab;
    this.grab = null;
    return gr ? Math.hypot(gr.px - gr.ax, gr.py - gr.ay) : 0;
  }

  get held() {
    return !!this.grab;
  }

  /** 출렁 (속재료를 바꿀 때 등) */
  kick(strength: number) {
    for (let i = 0; i < this.n; i++) {
      const s = (0.7 + Math.random() * 0.6) * strength;
      this.vx[i] += this.cos[i] * s;
      this.vy[i] += this.sin[i] * s;
    }
  }

  contains(px: number, py: number, margin: number): boolean {
    const { n, x, y } = this;
    let inside = false;
    let near = Infinity;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      if (y[i] > py !== y[j] > py && px < ((x[j] - x[i]) * (py - y[i])) / (y[j] - y[i]) + x[i]) inside = !inside;
      near = Math.min(near, Math.hypot(x[i] - px, y[i] - py));
    }
    return inside || near < margin;
  }

  /** 점들을 매끈한 곡선으로 이은 경로 */
  trace(g: CanvasRenderingContext2D) {
    const { n, x, y } = this;
    g.beginPath();
    g.moveTo((x[n - 1] + x[0]) / 2, (y[n - 1] + y[0]) / 2);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      g.quadraticCurveTo(x[i], y[i], (x[i] + x[j]) / 2, (y[i] + y[j]) / 2);
    }
    g.closePath();
  }
}
