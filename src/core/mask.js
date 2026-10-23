// @ts-check
/** Binary masks are Uint8Array(w*h) with 1 = "erase this pixel". */

/** @typedef {import('./image.js').Box} Box */

/** @param {number} w @param {number} h @param {Box} box @param {'rect'|'ellipse'} [shape] */
export function boxMask(w, h, box, shape = 'rect') {
  const m = new Uint8Array(w * h);
  const x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(w, Math.ceil(box.x + box.w)), y1 = Math.min(h, Math.ceil(box.y + box.h));
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2, rx = box.w / 2, ry = box.h / 2;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (shape === 'ellipse') {
        const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny > 1) continue;
      }
      m[y * w + x] = 1;
    }
  }
  return m;
}

/** Square dilation by radius r (separable max filter). */
export function dilate(mask, w, h, r) {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = Math.max(0, x - r), e = Math.min(w - 1, x + r); k <= e; k++) if (mask[row + k]) { v = 1; break; }
      tmp[row + x] = v;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let v = 0;
      for (let k = Math.max(0, y - r), e = Math.min(h - 1, y + r); k <= e; k++) if (tmp[k * w + x]) { v = 1; break; }
      out[y * w + x] = v;
    }
  }
  return out;
}

/** @param {Uint8Array} a @param {Uint8Array} b */
export function union(a, b) {
  const m = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) m[i] = a[i] | b[i];
  return m;
}

/** Shift a mask by (dx, dy) pixels, dropping what falls outside. */
export function translateMask(mask, w, h, dx, dy) {
  const out = new Uint8Array(w * h);
  dx = Math.round(dx); dy = Math.round(dy);
  for (let y = 0; y < h; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= h) continue;
    for (let x = 0; x < w; x++) {
      const sx = x - dx;
      if (sx >= 0 && sx < w && mask[sy * w + sx]) out[y * w + x] = 1;
    }
  }
  return out;
}

/** @param {Uint8Array} mask */
export function count(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return n;
}

/** Bounding box of a mask, or null if empty. @returns {Box|null} */
export function maskBox(mask, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Fraction of `inner` pixels also set in `outer` (recall of a mask). */
export function coverage(inner, outer) {
  let a = 0, b = 0;
  for (let i = 0; i < inner.length; i++) if (inner[i]) { a++; if (outer[i]) b++; }
  return a ? b / a : 1;
}
