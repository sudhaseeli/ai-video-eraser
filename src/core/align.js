// @ts-check
import { toGray } from './image.js';

/** @typedef {import('./image.js').Frame} Frame @typedef {import('./image.js').Gray} Gray */

/**
 * Mean absolute difference between a and b shifted by (dx, dy), ignoring masked pixels.
 * @param {Gray} a @param {Gray} b @param {Uint8Array|null} ma @param {Uint8Array|null} mb
 * @param {number} dx @param {number} dy @param {number} step @param {number} mscale
 */
function diff(a, b, ma, mb, dx, dy, step, mscale, mw) {
  let sum = 0, n = 0;
  const m = 6; // ignore the outer border
  for (let y = m; y < a.h - m; y += step) {
    const yb = y + dy;
    if (yb < 0 || yb >= b.h) continue;
    for (let x = m; x < a.w - m; x += step) {
      const xb = x + dx;
      if (xb < 0 || xb >= b.w) continue;
      if (ma && ma[Math.floor(y * mscale) * mw + Math.floor(x * mscale)]) continue;
      if (mb && mb[Math.floor(yb * mscale) * mw + Math.floor(xb * mscale)]) continue;
      sum += Math.abs(a.g[y * a.w + x] - b.g[yb * b.w + xb]);
      n++;
    }
  }
  return n > 50 ? sum / n : Infinity;
}

/**
 * Estimate global camera translation for every frame (coarse-to-fine search),
 * ignoring the pixels that will be erased so the moving object doesn't skew it.
 *
 * Returns cam[t] such that frame t pixel (x, y) shows the same scene point as
 * frame s pixel (x + cam[t].x - cam[s].x, y + cam[t].y - cam[s].y).
 *
 * @param {Frame[]} frames @param {Uint8Array[]} [masks] @param {{range?: number}} [opts]
 * @returns {{x: number, y: number}[]}
 */
export function estimateCamera(frames, masks, opts = {}) {
  const range = opts.range ?? 32;
  const w = frames[0].w;
  const coarse = frames.map((f) => toGray(f, 4));
  const fine = frames.map((f) => toGray(f, 1));
  const cam = [{ x: 0, y: 0 }];
  for (let t = 1; t < frames.length; t++) {
    const a = coarse[t], b = coarse[t - 1];
    const ma = masks?.[t] ?? null, mb = masks?.[t - 1] ?? null;
    let best = Infinity, bx = 0, by = 0;
    const r = Math.ceil(range / 4);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const s = diff(a, b, ma, mb, dx, dy, 1, 4, w);
      if (s < best) { best = s; bx = dx; by = dy; }
    }
    let fbest = Infinity, fx = bx * 4, fy = by * 4;
    for (let dy = by * 4 - 4; dy <= by * 4 + 4; dy++) for (let dx = bx * 4 - 4; dx <= bx * 4 + 4; dx++) {
      const s = diff(fine[t], fine[t - 1], ma, mb, dx, dy, 2, 1, w);
      if (s < fbest) { fbest = s; fx = dx; fy = dy; }
    }
    // Pixel (x, y) in frame t matches (x + fx, y + fy) in frame t-1.
    cam.push({ x: cam[t - 1].x + fx, y: cam[t - 1].y + fy });
  }
  return cam;
}
