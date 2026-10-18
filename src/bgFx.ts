// 배경 코스틱 빛: 유리·젤리를 통과한 빛이 바닥에 일렁이는 얇은 빛줄기.
// 저해상도로 30fps 만 그려서 가볍게, 탭이 가려지면 쉰다.

interface Vein {
  y: number;
  amp: number;
  freq: number;
  speed: number;
  phase: number;
  width: number;
  color: string;
  tilt: number;
}

const COLORS = ["255,255,255", "255,255,255", "180,240,235", "255,200,225", "215,200,255"];

export function startBackgroundFx(canvas: HTMLCanvasElement) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const g = canvas.getContext("2d");
  if (!g) return;
  const scale = 0.5;
  let W = 0, H = 0;
  const resize = () => {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
  };
  resize();
  window.addEventListener("resize", resize);

  const veins: Vein[] = Array.from({ length: 10 }, (_, i) => ({
    y: 0.08 + Math.random() * 0.9,
    amp: 0.02 + Math.random() * 0.05,
    freq: 0.8 + Math.random() * 1.8,
    speed: 0.05 + Math.random() * 0.12,
    phase: Math.random() * Math.PI * 2,
    width: 1 + Math.random() * 2.2,
    color: COLORS[i % COLORS.length],
    tilt: (Math.random() - 0.5) * 0.5,
  }));

  let last = 0;
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    if (document.hidden || now - last < 33) return;
    last = now;
    const t = now / 1000;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.clearRect(0, 0, W, H);

    // 천천히 떠도는 빛 웅덩이
    for (let k = 0; k < 3; k++) {
      const x = W * (0.5 + 0.38 * Math.sin(t * 0.07 + k * 2.1));
      const y = H * (0.5 + 0.35 * Math.cos(t * 0.05 + k * 1.7));
      const r = Math.max(W, H) * 0.35;
      const pool = g.createRadialGradient(x, y, 0, x, y, r);
      pool.addColorStop(0, "rgba(255,255,255,0.35)");
      pool.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = pool;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // 일렁이는 빛줄기 (가는 선 + 번진 빛)
    g.lineCap = "round";
    g.lineJoin = "round";
    for (const v of veins) {
      g.beginPath();
      for (let x = -30; x <= W + 30; x += 22) {
        const u = x / W;
        const y =
          (v.y + v.tilt * (u - 0.5)) * H +
          Math.sin(u * v.freq * Math.PI * 2 + t * v.speed * Math.PI * 2 + v.phase) * v.amp * H +
          Math.sin(u * v.freq * 2.3 * Math.PI * 2 - t * v.speed * 4 + v.phase * 2) * v.amp * 0.4 * H;
        if (x === -30) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = `rgba(${v.color},0.12)`;
      g.lineWidth = v.width * 7;
      g.stroke();
      g.strokeStyle = `rgba(${v.color},0.6)`;
      g.lineWidth = v.width;
      g.stroke();
    }
  };
  requestAnimationFrame(frame);
}
