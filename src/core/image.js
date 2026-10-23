// @ts-check
/**
 * Frames are plain RGBA buffers so every core module runs in the browser and in Node.
 * @typedef {{ w: number, h: number, data: Uint8ClampedArray }} Frame
 * @typedef {{ w: number, h: number, g: Float32Array }} Gray
 * @typedef {{ x: number, y: number, w: number, h: number }} Box
 */

/** @param {number} w @param {number} h @param {Uint8ClampedArray} [data] @returns {Frame} */
export function makeFrame(w, h, data) {
  return { w, h, data: data ?? new Uint8ClampedArray(w * h * 4) };
}

/** @param {Frame} f @returns {Frame} */
export function cloneFrame(f) {
  return { w: f.w, h: f.h, data: new Uint8ClampedArray(f.data) };
}

/**
 * Luma image, optionally downscaled by an integer factor (box-averaged).
 * @param {Frame} f @param {number} [scale] @returns {Gray}
 */
export function toGray(f, scale = 1) {
  const w = Math.floor(f.w / scale), h = Math.floor(f.h / scale);
  const g = new Float32Array(w * h);
  const d = f.data, inv = 1 / (scale * scale);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let yy = 0; yy < scale; yy++) {
        let i = ((y * scale + yy) * f.w + x * scale) * 4;
        for (let xx = 0; xx < scale; xx++, i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      }
      g[y * w + x] = sum * inv;
    }
  }
  return { w, h, g };
}

/** @param {Box} b @param {number} w @param {number} h @returns {Box} */
export function clampBox(b, w, h) {
  const x = Math.max(0, Math.min(w - 1, Math.round(b.x)));
  const y = Math.max(0, Math.min(h - 1, Math.round(b.y)));
  return { x, y, w: Math.max(1, Math.min(w - x, Math.round(b.w))), h: Math.max(1, Math.min(h - y, Math.round(b.h))) };
}

/** @param {Box} b @param {number} frac @returns {Box} */
export function padBox(b, frac) {
  const px = b.w * frac, py = b.h * frac;
  return { x: b.x - px, y: b.y - py, w: b.w + 2 * px, h: b.h + 2 * py };
}

/** Yield to the event loop so long jobs keep the page responsive. */
export const tick = () => new Promise((r) => setTimeout(r, 0));
