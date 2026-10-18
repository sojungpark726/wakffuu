export type Pt = [number, number];

/** 경계 사각형 안에서 각 seed 의 보로노이 셀 다각형을 구한다 (반평면 클리핑, n≈40 이면 충분히 빠름) */
export function voronoiCells(seeds: Pt[], x0: number, y0: number, x1: number, y1: number): Pt[][] {
  return seeds.map((si, i) => {
    let poly: Pt[] = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    for (let j = 0; j < seeds.length && poly.length; j++) {
      if (i === j) continue;
      const sj = seeds[j];
      const a = sj[0] - si[0], b = sj[1] - si[1];
      if (a === 0 && b === 0) continue;
      const mx = (si[0] + sj[0]) / 2, my = (si[1] + sj[1]) / 2;
      poly = clip(poly, a, b, a * mx + b * my);
    }
    return poly;
  });
}

/** a*x + b*y <= c 인 쪽만 남김 (Sutherland–Hodgman) */
function clip(poly: Pt[], a: number, b: number, c: number): Pt[] {
  const out: Pt[] = [];
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k], q = poly[(k + 1) % poly.length];
    const fp = a * p[0] + b * p[1] - c, fq = a * q[0] + b * q[1] - c;
    if (fp <= 0) out.push(p);
    if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) {
      const t = fp / (fp - fq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

export function centroid(poly: Pt[]): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
    const cr = x0 * y1 - x1 * y0;
    a += cr;
    cx += (x0 + x1) * cr;
    cy += (y0 + y1) * cr;
  }
  if (Math.abs(a) < 1e-6) {
    const n = poly.length || 1;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}
