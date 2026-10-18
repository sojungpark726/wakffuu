// "부서졌다!" 같은 짧은 젤리 글씨: 뽁 튀어나와 살짝 떠오르다 사라진다. 캔버스에 그려서 영상에도 담김.

export interface PopStyle {
  /** 기울기 (라디안) */
  rot?: number;
  /** 글씨 그라데이션 위 → 가운데 → 아래 */
  colors?: readonly [string, string, string];
  /** 떠오르는 높이 (글씨 크기 배수 / 초) */
  rise?: number;
}

const PINK: readonly [string, string, string] = ["#ffc9df", "#ff5f9e", "#ff8a5c"];

export function drawPopText(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  elapsed: number,
  duration = 1.2,
  { rot = -0.06, colors = PINK, rise = 0.9 }: PopStyle = {},
) {
  if (elapsed < 0 || elapsed > duration) return;
  const pop = easeOutBack(Math.min(1, elapsed / Math.min(0.28, duration * 0.35)));
  const fadeTime = Math.min(0.35, duration * 0.45);
  const fade = elapsed > duration - fadeTime ? (duration - elapsed) / fadeTime : 1;
  g.save();
  g.globalAlpha = Math.max(0, fade);
  g.translate(x, y - elapsed * size * rise);
  g.scale(pop, pop);
  g.rotate(rot);
  g.font = `900 ${size}px "Pretendard Variable", Pretendard, "Noto Sans KR", sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  const grad = g.createLinearGradient(0, -size / 2, 0, size / 2);
  grad.addColorStop(0, colors[0]);
  grad.addColorStop(0.5, colors[1]);
  grad.addColorStop(1, colors[2]);
  g.lineWidth = size * 0.28;
  g.strokeStyle = "#fff";
  g.strokeText(text, 0, 0);
  g.shadowColor = "rgba(255,80,150,0.45)";
  g.shadowBlur = size * 0.35;
  g.fillStyle = grad;
  g.fillText(text, 0, 0);
  g.restore();
}

function easeOutBack(x: number) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
