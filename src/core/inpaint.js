// @ts-check
import { cloneFrame, tick } from './image.js';

/** @typedef {import('./image.js').Frame} Frame */

/**
 * Fill holes from their surroundings, ring by ring ("onion peel"): each unknown
 * pixel touching known pixels becomes the weighted average of those neighbours.
 * Used for whatever the temporal pass could not recover.
 * @param {Frame} f frame, modified in place @param {Uint8Array} hole 1 = unknown
 * @returns {number} pixels filled
 */
export function spatialFill(f, hole) {
  const { w, h, data } = f;
  const known = new Uint8Array(w * h);
  let left = 0;
  for (let i = 0; i < hole.length; i++) { known[i] = hole[i] ? 0 : 1; left += hole[i]; }
  const total = left;
  const nb = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, 0.7], [1, -1, 0.7], [-1, 1, 0.7], [1, 1, 0.7]];
  while (left > 0) {
    const ring = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (known[i]) continue;
      let r = 0, g = 0, b = 0, ws = 0;
      for (const [dx, dy, wt] of nb) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (!known[j]) continue;
        const k = j * 4;
        r += data[k] * wt; g += data[k + 1] * wt; b += data[k + 2] * wt; ws += wt;
      }
      if (ws > 0) ring.push(i, r / ws, g / ws, b / ws);
    }
    if (!ring.length) break; // hole covers the whole frame
    for (let n = 0; n < ring.length; n += 4) {
      const i = ring[n], k = i * 4;
      data[k] = ring[n + 1]; data[k + 1] = ring[n + 2]; data[k + 2] = ring[n + 3]; data[k + 3] = 255;
      known[i] = 1; left--;
    }
  }
  return total - left;
}

/**
 * Erase masked pixels by copying the background from nearby frames where that
 * spot is visible, after compensating for camera motion. Pixels never visible
 * in the window fall back to spatialFill.
 *
 * @param {Frame[]} frames @param {Uint8Array[]} masks @param {{x:number,y:number}[]} cam
 * @param {{window?: number, onFrame?: (i: number) => void}} [opts]
 * @returns {Promise<{frames: Frame[], temporal: number, spatial: number, masked: number}>}
 */
export async function temporalFill(frames, masks, cam, opts = {}) {
  const win = opts.window ?? 24;
  const out = [];
  let temporal = 0, spatial = 0, masked = 0;
  const order = [];
  for (let d = 1; d <= win; d++) order.push(d, -d);
  for (let t = 0; t < frames.length; t++) {
    const f = cloneFrame(frames[t]);
    const { w, h, data } = f;
    const m = masks[t];
    let todo = [];
    for (let i = 0; i < m.length; i++) if (m[i]) todo.push(i);
    masked += todo.length;
    for (const d of order) {
      if (!todo.length) break;
      const s = t + d;
      if (s < 0 || s >= frames.length) continue;
      const dx = Math.round(cam[t].x - cam[s].x), dy = Math.round(cam[t].y - cam[s].y);
      const src = frames[s].data, ms = masks[s];
      const rest = [];
      for (const i of todo) {
        const x = i % w, y = (i - x) / w;
        const xs = x + dx, ys = y + dy;
        if (xs < 0 || ys < 0 || xs >= w || ys >= h) { rest.push(i); continue; }
        const j = ys * w + xs;
        if (ms[j]) { rest.push(i); continue; }
        const a = i * 4, b = j * 4;
        data[a] = src[b]; data[a + 1] = src[b + 1]; data[a + 2] = src[b + 2]; data[a + 3] = 255;
      }
      temporal += todo.length - rest.length;
      todo = rest;
    }
    if (todo.length) {
      const hole = new Uint8Array(w * h);
      for (const i of todo) hole[i] = 1;
      spatial += spatialFill(f, hole);
    }
    out.push(f);
    opts.onFrame?.(t);
    if (t % 4 === 3) await tick();
  }
  return { frames: out, temporal, spatial, masked };
}
