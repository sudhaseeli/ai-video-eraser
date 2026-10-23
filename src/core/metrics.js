// @ts-check
/** @typedef {import('./image.js').Frame} Frame */

/**
 * Peak signal-to-noise ratio over RGB, optionally only inside a mask.
 * @param {Frame} a @param {Frame} b @param {Uint8Array} [mask] @returns {number} dB
 */
export function psnr(a, b, mask) {
  let se = 0, n = 0;
  for (let i = 0, p = 0; i < a.data.length; i += 4, p++) {
    if (mask && !mask[p]) continue;
    for (let c = 0; c < 3; c++) { const d = a.data[i + c] - b.data[i + c]; se += d * d; }
    n += 3;
  }
  if (!n) return Infinity;
  const mse = se / n;
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

/** Average PSNR across a sequence (infinite values capped at 99 dB). */
export function meanPsnr(as, bs, masks) {
  let s = 0;
  for (let t = 0; t < as.length; t++) s += Math.min(99, psnr(as[t], bs[t], masks?.[t]));
  return s / as.length;
}
