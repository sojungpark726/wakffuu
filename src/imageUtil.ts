export type RGB = [number, number, number];

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("canvas 2d unavailable");
  return g;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_load_failed"));
    img.src = src;
  });
}

export async function fileToCanvas(file: File, maxSide = 1024): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    return toCanvas(await loadImage(url), maxSide);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 긴 변을 maxSide 이하로 줄여 캔버스로 */
export function toCanvas(src: CanvasImageSource & { width: number; height: number }, maxSide: number) {
  const s = Math.min(1, maxSide / Math.max(src.width, src.height));
  const c = makeCanvas(src.width * s, src.height * s);
  ctx2d(c).drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export function alphaBBox(c: HTMLCanvasElement, threshold = 12): Box | null {
  const { data, width, height } = ctx2d(c).getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** 정사각 캔버스 가운데에 contain 으로 배치 (fill 이 있으면 배경을 칠함) */
export function fitSquare(src: HTMLCanvasElement, size: number, coverage: number, fill?: string, box?: Box | null) {
  const b = box ?? { x: 0, y: 0, w: src.width, h: src.height };
  const out = makeCanvas(size, size);
  const g = ctx2d(out);
  if (fill) {
    g.fillStyle = fill;
    g.fillRect(0, 0, size, size);
  }
  const s = (size * coverage) / Math.max(b.w, b.h);
  const w = b.w * s, h = b.h * s;
  g.drawImage(src, b.x, b.y, b.w, b.h, (size - w) / 2, (size - h) / 2, w, h);
  return out;
}

/** 알파 가중 평균색 */
export function averageColor(c: HTMLCanvasElement): RGB {
  const small = toCanvas(c, 64);
  const { data } = ctx2d(small).getImageData(0, 0, small.width, small.height);
  let r = 0, g = 0, b = 0, wsum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    // 채도 높은 픽셀에 가중치 — 회색 배경보다 대상의 '대표색'이 나오게
    const mx = Math.max(data[i], data[i + 1], data[i + 2]);
    const mn = Math.min(data[i], data[i + 1], data[i + 2]);
    const w = a * (0.25 + (mx - mn) / 255);
    r += data[i] * w;
    g += data[i + 1] * w;
    b += data[i + 2] * w;
    wsum += w;
  }
  if (wsum === 0) return [255, 217, 194];
  return [r / wsum, g / wsum, b / wsum];
}

export function pastel([r, g, b]: RGB, amount = 0.35): RGB {
  return [r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount];
}

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** h: 0~360, s·l: 0~1 */
export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb(h: number, s: number, l: number): RGB {
  h = (((h % 360) + 360) % 360) / 360;
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

export function rgba([r, g, b]: RGB, a = 1): string {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
}

/**
 * 배경이 불투명하게 온 이미지(투명 배경이 안 지켜진 AI 결과 등)에서
 * 테두리와 이어진 비슷한 색 영역을 지워 투명하게 만든다.
 */
export function removeFlatBackground(c: HTMLCanvasElement, tolerance = 42): boolean {
  const g = ctx2d(c);
  const img = g.getImageData(0, 0, c.width, c.height);
  const { data, width: w, height: h } = img;
  let opaque = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 250) opaque++;
  if (opaque / (w * h) < 0.97) return false; // 이미 투명 배경

  const corners = [0, w - 1, (h - 1) * w, h * w - 1].map((p) => p * 4);
  const ref = corners.reduce<RGB>((acc, p) => [acc[0] + data[p] / 4, acc[1] + data[p + 1] / 4, acc[2] + data[p + 2] / 4], [0, 0, 0]);
  const tol2 = tolerance * tolerance;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const p = stack.pop()!;
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    const dr = data[i] - ref[0], dg = data[i + 1] - ref[1], db = data[i + 2] - ref[2];
    if (dr * dr + dg * dg + db * db > tol2) continue;
    data[i + 3] = 0;
    const x = p % w, y = (p - x) / w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  g.putImageData(img, 0, 0);
  return true;
}

export function canvasToBlob(c: HTMLCanvasElement, type = "image/png", quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob_failed"))), type, quality),
  );
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
