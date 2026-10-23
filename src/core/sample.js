// @ts-check
import { makeFrame } from './image.js';
import { maskBox, dilate } from './mask.js';

/**
 * A synthetic test clip with ground truth: a person walks across a textured
 * dusk landscape while the camera pans. Because we also render the clean
 * background, we can measure exactly how well the eraser restores it.
 * Pure pixel maths, so it runs in Node tests and in the browser.
 */

function hash(ix, iy) {
  const s = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const mix = (a, b, t) => a + (b - a) * t;

/** Background colour at scene column X, row y. */
function scene(X, y, w, h) {
  const horizon = h * (0.52 + 0.06 * Math.sin(X * 0.021) + 0.03 * Math.sin(X * 0.057 + 1.3));
  if (y < horizon) {
    const t = y / horizon;
    let r = mix(42, 206, t), g = mix(29, 140, t), b = mix(51, 138, t);
    const sunD = Math.hypot(X - w * 0.9, y - h * 0.32);
    if (sunD < h * 0.09) { r = 236; g = 205; b = 160; }
    const cloud = noise(X * 0.03, y * 0.08);
    if (cloud > 0.72 && y < horizon * 0.7) { r = mix(r, 230, 0.35); g = mix(g, 200, 0.35); b = mix(b, 210, 0.35); }
    return [r, g, b];
  }
  const depth = (y - horizon) / (h - horizon);
  const n = noise(X * 0.15, y * 0.3) * 0.6 + noise(X * 0.6, y * 1.1) * 0.4;
  let r = mix(74, 52, depth) + n * 34, g = mix(58, 66, depth) + n * 30, b = mix(82, 60, depth) + n * 22;
  // a winding path
  const pathC = w * 0.5 + Math.sin(X * 0.004) * w * 0.2;
  if (Math.abs(X - pathC) < depth * w * 0.18 + 4 && depth > 0.15) { r = 168 + n * 30; g = 140 + n * 24; b = 120 + n * 18; }
  // fence posts give strong vertical features for motion estimation
  if (depth > 0.05 && depth < 0.3 && ((Math.floor(X) % 37) + 37) % 37 < 3) { r = 40; g = 28; b = 34; }
  return [r, g, b];
}

/** Person shape and colour at image pixel (x, y) in frame t, or null. */
function person(x, y, t, w, h, frames) {
  const ph = h * 0.46, base = h * 0.9;
  const px = w * 0.14 + (t * w * 0.6) / Math.max(1, frames - 1);
  const head = ph * 0.085, top = base - ph;
  const swing = Math.sin(t * 0.55) * ph * 0.07;
  if (Math.hypot(x - px, y - (top + head)) < head) return [201, 154, 131];
  const torsoTop = top + head * 2, hip = base - ph * 0.42, tw = ph * 0.17;
  if (y >= torsoTop && y < hip && Math.abs(x - px) < tw) {
    if (y < torsoTop + ph * 0.06) return [217, 140, 140]; // scarf
    return [43, 35, 56];
  }
  if (y >= hip && y < base) {
    const lw = ph * 0.055;
    if (Math.abs(x - (px - ph * 0.07 + swing)) < lw || Math.abs(x - (px + ph * 0.07 - swing)) < lw) return [27, 22, 34];
  }
  return null;
}

/**
 * @param {{w?: number, h?: number, frames?: number, pan?: number}} [opts]
 * @returns {{frames: import('./image.js').Frame[], clean: import('./image.js').Frame[], truth: Uint8Array[], box0: import('./image.js').Box, fps: number}}
 */
export function makeSample(opts = {}) {
  const w = opts.w ?? 320, h = opts.h ?? 180, n = opts.frames ?? 48, pan = opts.pan ?? 1.5;
  const frames = [], clean = [], truth = [];
  for (let t = 0; t < n; t++) {
    const f = makeFrame(w, h), c = makeFrame(w, h), m = new Uint8Array(w * h);
    const camX = t * pan;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const bg = scene(x + camX, y, w, h);
      c.data[i] = bg[0]; c.data[i + 1] = bg[1]; c.data[i + 2] = bg[2]; c.data[i + 3] = 255;
      const p = person(x, y, t, w, h, n);
      const col = p ?? bg;
      if (p) m[y * w + x] = 1;
      f.data[i] = col[0]; f.data[i + 1] = col[1]; f.data[i + 2] = col[2]; f.data[i + 3] = 255;
    }
    frames.push(f); clean.push(c); truth.push(dilate(m, w, h, 1));
  }
  const b = maskBox(truth[0], w, h) ?? { x: 0, y: 0, w: 10, h: 10 };
  return { frames, clean, truth, box0: b, fps: 12 };
}
