// 공 껍질(shell) 이미지를 만든다. 두 모드 모두 결과는 SHELL_SIZE 정사각 + 투명 배경 PNG 형태라
// 이후 금 가기·부수기 엔진(WaxBall)은 모드와 상관없이 똑같이 동작한다.
import {
  alphaBBox,
  ctx2d,
  fitSquare,
  hexToRgb,
  makeCanvas,
  mix,
  removeFlatBackground,
  toCanvas,
} from "./imageUtil";

export const SHELL_SIZE = 512;

/**
 * 기본형: 누끼 실루엣을 따라 왁스를 입힌다.
 * 대상 테두리를 왁스 두께만큼 넓혀 둥글린 뒤, 안쪽으로 갈수록 부풀린 높이맵으로 3D 셰이딩.
 * 그래서 딸기는 딸기 모양, 고양이는 고양이 모양 왁뿌볼이 된다.
 */
export function renderBasicBall(subject: HTMLCanvasElement, waxHex: string, size = SHELL_SIZE): HTMLCanvasElement {
  const S = size;
  const N = S * S;
  const wax = hexToRgb(waxHex);
  const waxLight = mix(wax, [255, 255, 255], 0.6);
  const coat = mix(wax, [255, 255, 255], 0.35);
  const glow = wax.map((v) => Math.min(255, v * 1.12 + 18)) as [number, number, number];
  const PAD = Math.round(S * 0.028); // 왁스 코팅 두께

  const placed = fitSquare(subject, S, 0.82, undefined, alphaBBox(subject));
  const P = ctx2d(placed).getImageData(0, 0, S, S).data;

  // 1) 왁스 실루엣: 대상에서 PAD 안쪽까지 덮고, 블러로 모서리를 둥글게
  const outside = new Uint8Array(N);
  for (let i = 0; i < N; i++) outside[i] = P[i * 4 + 3] < 128 ? 1 : 0;
  const toSubject = distanceInside(outside, S, false);
  const coated = new Float32Array(N);
  for (let i = 0; i < N; i++) coated[i] = toSubject[i] <= PAD ? 1 : 0;
  const soft = boxBlur(coated, S, 5, 2);

  // 2) 높이맵: 실루엣 안쪽으로 갈수록 부풀게 (가장자리 단면은 둥글게)
  const inside = new Uint8Array(N);
  for (let i = 0; i < N; i++) inside[i] = soft[i] > 0.5 ? 1 : 0;
  const dist = distanceInside(inside, S);
  let maxD = 0;
  for (let i = 0; i < N; i++) if (dist[i] > maxD) maxD = dist[i];
  const D = Math.max(10, maxD * 0.9);
  const raw = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (!inside[i]) continue;
    const u = 1 - Math.min(dist[i], D) / D;
    raw[i] = Math.sqrt(1 - u * u) * D;
  }
  const h = boxBlur(raw, S, 2, 2);

  // 3) 셰이딩
  const out = makeCanvas(S, S);
  const og = ctx2d(out);
  const O = og.createImageData(S, S);
  const Dd = O.data;
  const L = norm(-0.45, -0.62, 0.64);
  const H = norm(L[0], L[1], L[2] + 1);

  for (let y = 1; y < S - 1; y++) {
    for (let x = 1; x < S - 1; x++) {
      const i = y * S + x;
      const alpha = smoothstep(0.35, 0.65, soft[i]);
      if (alpha <= 0) continue;

      // 높이맵 기울기 → 법선 (+ 손으로 빚은 듯한 미세한 울퉁불퉁함)
      const bump = Math.sin(x * 0.09 + Math.sin(y * 0.05) * 2) * Math.sin(y * 0.08 + Math.sin(x * 0.04) * 2) * 0.035;
      let nx = -(h[i + 1] - h[i - 1]) * 0.4 + bump;
      let ny = -(h[i + S] - h[i - S]) * 0.4 - bump;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;

      // 바탕색: 대상이 있으면 대상 색, 없는 코팅 부분은 왁스 색 → 위에 뽀얀 왁스를 얇게
      const s = P[i * 4 + 3] / 255;
      const base = [0, 1, 2].map((c) => (wax[c] * (1 - s) + P[i * 4 + c] * s) * 0.88 + coat[c] * 0.12);

      // 젤리 광택: 위쪽 길쭉한 조명이 비친 띠 + 아래쪽으로 스며 나오는 색빛
      const rx = 2 * nz * nx, ry = 2 * nz * ny;
      const up = -ry;
      const strip = smoothstep(0.32, 0.5, up) * (1 - smoothstep(0.82, 0.95, up)) * (1 - smoothstep(0.3, 0.6, Math.abs(rx + 0.15)));
      const bounce = smoothstep(0.35, 0.85, ry) * 0.5;

      const ndl = nx * L[0] + ny * L[1] + nz * L[2];
      const diff = Math.max(0, (ndl + 0.3) / 1.3); // 왁스라서 그림자가 부드럽게 감김
      const ndh = Math.max(0, nx * H[0] + ny * H[1] + nz * H[2]);
      const spec = Math.pow(ndh, 90) * 0.55 + Math.pow(ndh, 12) * 0.08;
      const rim = Math.pow(1 - nz, 2);
      const away = Math.max(0, -(nx * L[0] + ny * L[1]));
      const sss = rim * (0.22 + 0.45 * away); // 빛 반대편 테두리가 은은하게 비침
      const grain = (hash(x, y) - 0.5) * 7;
      const shade = 0.55 + 0.58 * diff;

      const o = i * 4;
      for (let c = 0; c < 3; c++) {
        let v = base[c] * shade * (1 - sss) + waxLight[c] * sss;
        v = v * (1 - bounce * 0.6) + glow[c] * bounce * 0.6;
        Dd[o + c] = v + (spec + strip * 0.5) * 255 + grain;
      }
      Dd[o + 3] = alpha * 255;
    }
  }
  og.putImageData(O, 0, 0);
  return out;
}

/** AI 변환: 생성된 이미지를 껍질 규격(투명 배경, 가운데 정렬)으로 맞춘다 */
export function normalizeAiBall(img: HTMLImageElement): HTMLCanvasElement {
  const c = toCanvas(img, 1024);
  removeFlatBackground(c);
  return fitSquare(c, SHELL_SIZE, 0.92, undefined, alphaBBox(c, 24));
}

/**
 * mask=1 인 픽셀마다 가장 가까운 mask=0 픽셀까지의 거리 (2-pass chamfer).
 * edgeIsZero: 이미지 밖도 mask=0 으로 칠지 (높이맵은 true, 대상까지 거리를 잴 때는 false)
 */
function distanceInside(mask: Uint8Array, S: number, edgeIsZero = true): Float32Array {
  const d = new Float32Array(S * S);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 1e6 : 0;
  const R2 = Math.SQRT2;
  const edge = edgeIsZero ? 0 : 1e6;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= S || y >= S ? edge : d[y * S + x]);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      if (d[i] === 0) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + R2, at(x + 1, y - 1) + R2);
    }
  for (let y = S - 1; y >= 0; y--)
    for (let x = S - 1; x >= 0; x--) {
      const i = y * S + x;
      if (d[i] === 0) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + R2, at(x - 1, y + 1) + R2);
    }
  return d;
}

/** 분리형 박스 블러 (passes 번 반복하면 가우시안에 가까워짐) */
function boxBlur(src: Float32Array, S: number, r: number, passes: number): Float32Array {
  const a = Float32Array.from(src);
  const b = new Float32Array(src.length);
  const win = 2 * r + 1;
  const cl = (v: number) => (v < 0 ? 0 : v >= S ? S - 1 : v);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < S; y++) {
      const row = y * S;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += a[row + cl(k)];
      for (let x = 0; x < S; x++) {
        b[row + x] = sum / win;
        sum += a[row + cl(x + r + 1)] - a[row + cl(x - r)];
      }
    }
    for (let x = 0; x < S; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += b[cl(k) * S + x];
      for (let y = 0; y < S; y++) {
        a[y * S + x] = sum / win;
        sum += b[cl(y + r + 1) * S + x] - b[cl(y - r) * S + x];
      }
    }
  }
  return a;
}

function smoothstep(e0: number, e1: number, v: number) {
  const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function norm(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

function hash(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
