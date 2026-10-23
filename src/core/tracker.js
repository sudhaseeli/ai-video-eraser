// @ts-check
import { toGray, clampBox } from './image.js';

/** @typedef {import('./image.js').Frame} Frame @typedef {import('./image.js').Box} Box @typedef {import('./image.js').Gray} Gray */

/**
 * Centre-weighted normalised cross-correlation tracker.
 *
 * A user-drawn box always contains some background. Plain template matching
 * slowly learns that background and drifts onto it, so this tracker:
 *  - weights pixels near the centre of the box (where the object is) most,
 *  - predicts the next position from the current velocity,
 *  - adapts the template gently and anchors it to the first frame's template.
 */
export class TemplateTracker {
  /** @param {Frame} frame @param {Box} box @param {{scale?: number, search?: number, adapt?: number, anchor?: number}} [opts] */
  constructor(frame, box, opts = {}) {
    this.scale = opts.scale ?? 2;
    this.search = opts.search ?? 16; // full-resolution pixels around the prediction
    this.adapt = opts.adapt ?? 0.08;
    this.anchor = opts.anchor ?? 0.5;
    this.fw = frame.w; this.fh = frame.h;
    this.box = clampBox(box, frame.w, frame.h);
    this.score = 1;
    this.vx = 0; this.vy = 0;
    const g = toGray(frame, this.scale);
    this.tw = Math.max(4, Math.round(this.box.w / this.scale));
    this.th = Math.max(4, Math.round(this.box.h / this.scale));
    this.tx = Math.round(this.box.x / this.scale);
    this.ty = Math.round(this.box.y / this.scale);
    this.tpl = this._patch(g, this.tx, this.ty);
    this.first = this.tpl.slice();
    // Gaussian weights centred on the box
    this.wt = new Float32Array(this.tw * this.th);
    const sx = this.tw * 0.3, sy = this.th * 0.32;
    let ws = 0;
    for (let j = 0; j < this.th; j++) for (let i = 0; i < this.tw; i++) {
      const dx = (i + 0.5 - this.tw / 2) / sx, dy = (j + 0.5 - this.th / 2) / sy;
      const v = Math.exp(-0.5 * (dx * dx + dy * dy));
      this.wt[j * this.tw + i] = v; ws += v;
    }
    this.wsum = ws;
  }

  /** @param {Gray} g @param {number} x @param {number} y */
  _patch(g, x, y) {
    const p = new Float32Array(this.tw * this.th);
    for (let j = 0; j < this.th; j++) for (let i = 0; i < this.tw; i++) {
      const xx = Math.min(g.w - 1, Math.max(0, x + i)), yy = Math.min(g.h - 1, Math.max(0, y + j));
      p[j * this.tw + i] = g.g[yy * g.w + xx];
    }
    return p;
  }

  /** Weighted NCC between the template and the window at (x, y). @param {Gray} g @param {number} x @param {number} y */
  _ncc(g, x, y) {
    const a = this.tpl, wt = this.wt, W = this.wsum;
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    for (let j = 0; j < this.th; j++) {
      const row = (y + j) * g.w + x, tr = j * this.tw;
      for (let i = 0; i < this.tw; i++) {
        const k = tr + i, w = wt[k], va = a[k], vb = g.g[row + i];
        sa += w * va; sb += w * vb; saa += w * va * va; sbb += w * vb * vb; sab += w * va * vb;
      }
    }
    const cov = sab - (sa * sb) / W, va = saa - (sa * sa) / W, vb = sbb - (sb * sb) / W;
    return va > 1e-6 && vb > 1e-6 ? cov / Math.sqrt(va * vb) : 0;
  }

  /** Weighted mean of a motion map inside the window at (x, y). @param {Float32Array} m @param {number} mw @param {number} x @param {number} y */
  _motion(m, mw, x, y) {
    let s = 0;
    for (let j = 0; j < this.th; j++) {
      const row = (y + j) * mw + x, tr = j * this.tw;
      for (let i = 0; i < this.tw; i++) s += this.wt[tr + i] * m[row + i];
    }
    return s / this.wsum;
  }

  /**
   * Track into the next frame and return the new box.
   * @param {Frame} frame @param {Float32Array|null} [motion] 0..1 map of camera-compensated change at tracker scale
   * @returns {Box}
   */
  update(frame, motion = null) {
    const g = toGray(frame, this.scale);
    const r = Math.max(2, Math.round(this.search / this.scale));
    const px = Math.round(this.tx + this.vx), py = Math.round(this.ty + this.vy);
    let best = -Infinity, bx = this.tx, by = this.ty, bestRaw = 0;
    for (let dy = -r; dy <= r; dy++) {
      const y = py + dy;
      if (y < 0 || y + this.th > g.h) continue;
      for (let dx = -r; dx <= r; dx++) {
        const x = px + dx;
        if (x < 0 || x + this.tw > g.w) continue;
        const raw = this._ncc(g, x, y);
        let s = raw - 0.002 * (dx * dx + dy * dy); // mild preference for the predicted spot
        if (motion) s += 0.8 * this._motion(motion, g.w, x, y);
        if (s > best) { best = s; bestRaw = raw; bx = x; by = y; }
      }
    }
    this.score = bestRaw;
    if (bestRaw > 0.6) {
      this.vx = this.vx * 0.6 + (bx - this.tx) * 0.4;
      this.vy = this.vy * 0.6 + (by - this.ty) * 0.4;
    }
    this.tx = bx; this.ty = by;
    if (bestRaw > 0.6) {
      const p = this._patch(g, bx, by), a = this.adapt, k = this.anchor;
      for (let i = 0; i < p.length; i++) {
        const blended = this.tpl[i] * (1 - a) + p[i] * a;
        this.tpl[i] = blended * (1 - k) + this.first[i] * k;
      }
    }
    this.box = clampBox({ x: bx * this.scale, y: by * this.scale, w: this.box.w, h: this.box.h }, this.fw, this.fh);
    return this.box;
  }
}

/**
 * Camera-compensated change between frame t and frame t-gap, as a 0..1 map at
 * the given scale. Anything that moves differently from the camera lights up.
 * @param {Gray} a frame t @param {Gray} b frame t-gap @param {number} dx @param {number} dy shift (at this scale) from a to b
 */
export function motionMap(a, b, dx, dy) {
  const m = new Float32Array(a.w * a.h);
  for (let y = 0; y < a.h; y++) {
    const yb = y + dy;
    if (yb < 0 || yb >= b.h) continue;
    for (let x = 0; x < a.w; x++) {
      const xb = x + dx;
      if (xb < 0 || xb >= b.w) continue;
      const d = Math.abs(a.g[y * a.w + x] - b.g[yb * b.w + xb]);
      m[y * a.w + x] = Math.min(1, Math.max(0, (d - 12) / 40));
    }
  }
  return m;
}

/**
 * Track one box through every frame. Pass the camera path from estimateCamera
 * to also use motion cues, which keeps the tracker on moving objects.
 * @param {Frame[]} frames @param {Box} box0
 * @param {{cam?: {x: number, y: number}[], onFrame?: (i: number) => void}} [opts]
 * @returns {{ boxes: Box[], scores: number[] }}
 */
export function trackBox(frames, box0, opts = {}) {
  const t = new TemplateTracker(frames[0], box0);
  const boxes = [t.box], scores = [1];
  const cam = opts.cam, gap = 2;
  const grays = cam ? frames.map((f) => toGray(f, t.scale)) : null;
  for (let i = 1; i < frames.length; i++) {
    let motion = null;
    if (cam && grays) {
      const j = Math.max(0, i - gap);
      if (j !== i) {
        const dx = Math.round((cam[i].x - cam[j].x) / t.scale), dy = Math.round((cam[i].y - cam[j].y) / t.scale);
        motion = motionMap(grays[i], grays[j], dx, dy);
      }
    }
    boxes.push(t.update(frames[i], motion));
    scores.push(t.score);
    opts.onFrame?.(i);
  }
  return { boxes, scores };
}
