// 브라우저 안에서 누끼 따기 — MediaPipe Interactive Segmenter (Apache 2.0, 모델 약 6MB)
// 사용자가 톡 누른 지점의 물체를 잘라낸다. 사진은 서버로 나가지 않는다.
import { FilesetResolver, InteractiveSegmenterLegacy } from "@mediapipe/tasks-vision";
import { alphaBBox, ctx2d, makeCanvas, type Box } from "./imageUtil";

/** WASM 은 설치된 @mediapipe/tasks-vision 과 같은 버전이어야 한다 (package.json 과 함께 올릴 것) */
const MEDIAPIPE_VERSION = "1.1.1";
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite";
/** 모델·WASM 을 이만큼 기다려도 안 오면 원형으로 잘라 쓴다 */
const LOAD_TIMEOUT = 15_000;

let segmenter: Promise<InteractiveSegmenterLegacy> | null = null;

async function create(): Promise<InteractiveSegmenterLegacy> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  const make = (delegate: "GPU" | "CPU") =>
    InteractiveSegmenterLegacy.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
  try {
    return await make("GPU");
  } catch {
    return await make("CPU");
  }
}

export function preloadSegmenter(): Promise<InteractiveSegmenterLegacy> {
  if (segmenter) return segmenter;
  const p = create();
  segmenter = p;
  p.then(
    (seg) => {
      // 시간 초과로 버린 뒤에 늦게 도착: 비어 있으면 그대로 쓰고, 이미 새로 받는 중이면 닫는다
      if (segmenter === null) segmenter = p;
      else if (segmenter !== p) seg.close();
    },
    () => {
      if (segmenter === p) segmenter = null;
    },
  );
  return p;
}

/** 모델 준비를 기다리되 너무 오래 걸리면 포기 (다음에 누를 때 다시 받아본다) */
function readySegmenter(): Promise<InteractiveSegmenterLegacy> {
  const p = preloadSegmenter();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (segmenter === p) segmenter = null;
      reject(new Error("segmenter load timeout"));
    }, LOAD_TIMEOUT);
    p.then(
      (seg) => {
        clearTimeout(timer);
        resolve(seg);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export interface Cutout {
  /** 대상만 남고 나머지는 투명, 대상 크기에 맞게 잘린 캔버스 */
  canvas: HTMLCanvasElement;
  /** 누끼에 실패해 사진 전체를 쓴 경우 */
  fallback: boolean;
}

/** point: 0~1 정규화 좌표 */
export async function cutout(photo: HTMLCanvasElement, point: { x: number; y: number }): Promise<Cutout> {
  try {
    const seg = await readySegmenter();
    // segment() 는 콜백까지 끝난 뒤 돌아오는 동기 호출이라 따로 시간 제한을 걸 수 없다
    let found = null as { mask: Float32Array; w: number; h: number } | null;
    seg.segment(photo, { keypoint: point }, (result) => {
      // 마스크가 여러 장 오면 누른 지점의 확률이 가장 높은 것을 '대상' 마스크로 본다
      let best = -1;
      for (const m of result.confidenceMasks ?? []) {
        const arr = m.getAsFloat32Array();
        const px = Math.min(m.width - 1, Math.floor(point.x * m.width));
        const py = Math.min(m.height - 1, Math.floor(point.y * m.height));
        const v = arr[py * m.width + px];
        if (v > best) {
          best = v;
          found = { mask: arr.slice(), w: m.width, h: m.height };
        }
      }
    });
    if (found) {
      const out = applyMask(photo, found.mask, found.w, found.h, point);
      if (out) return { canvas: out, fallback: false };
    }
  } catch (e) {
    console.warn("[segment] 누끼 실패, 사진 전체 사용", e);
  }
  return { canvas: circleCrop(photo, point), fallback: true };
}

function applyMask(photo: HTMLCanvasElement, mask: Float32Array, mw: number, mh: number, point: { x: number; y: number }) {
  // 누른 지점이 배경으로 나오면 반전된 마스크
  const pv = mask[Math.min(mh - 1, Math.floor(point.y * mh)) * mw + Math.min(mw - 1, Math.floor(point.x * mw))];
  const invert = pv < 0.5;

  const out = makeCanvas(photo.width, photo.height);
  const g = ctx2d(out);
  g.drawImage(photo, 0, 0);
  const img = g.getImageData(0, 0, out.width, out.height);
  const { data, width: w, height: h } = img;
  let covered = 0;
  for (let y = 0; y < h; y++) {
    const my = Math.min(mh - 1, Math.floor((y / h) * mh));
    for (let x = 0; x < w; x++) {
      const mx = Math.min(mw - 1, Math.floor((x / w) * mw));
      let v = mask[my * mw + mx];
      if (invert) v = 1 - v;
      // 경계를 살짝 부드럽게
      const a = Math.max(0, Math.min(1, (v - 0.35) / 0.3));
      data[(y * w + x) * 4 + 3] = Math.round(a * 255);
      if (a > 0.5) covered++;
    }
  }
  const ratio = covered / (w * h);
  if (ratio < 0.004 || ratio > 0.97) return null; // 너무 작거나 사진 전체 = 실패로 간주
  g.putImageData(img, 0, 0);
  return crop(out, alphaBBox(out), 0.04);
}

function crop(c: HTMLCanvasElement, box: Box | null, padRatio: number) {
  if (!box) return c;
  const pad = Math.round(Math.max(box.w, box.h) * padRatio);
  const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
  const w = Math.min(c.width - x, box.w + pad * 2), h = Math.min(c.height - y, box.h + pad * 2);
  const out = makeCanvas(w, h);
  ctx2d(out).drawImage(c, x, y, w, h, 0, 0, w, h);
  return out;
}

/** 누끼 실패 시: 누른 지점 중심으로 원형으로 잘라 쓴다 */
function circleCrop(photo: HTMLCanvasElement, point: { x: number; y: number }) {
  const r = Math.min(photo.width, photo.height) * 0.42;
  const cx = Math.min(photo.width - r, Math.max(r, point.x * photo.width));
  const cy = Math.min(photo.height - r, Math.max(r, point.y * photo.height));
  const out = makeCanvas(r * 2, r * 2);
  const g = ctx2d(out);
  g.beginPath();
  g.arc(r, r, r, 0, Math.PI * 2);
  g.clip();
  g.drawImage(photo, cx - r, cy - r, r * 2, r * 2, 0, 0, r * 2, r * 2);
  return out;
}
