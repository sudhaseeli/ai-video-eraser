// @ts-check
import { padBox, tick } from './image.js';
import { boxMask, dilate } from './mask.js';
import { trackBox } from './tracker.js';
import { estimateCamera } from './align.js';
import { temporalFill } from './inpaint.js';

/** @typedef {import('./image.js').Frame} Frame @typedef {import('./image.js').Box} Box */
/** @typedef {(stage: string, done: number, total: number) => void} Progress */

/**
 * Lightweight mode: track a user-drawn box and turn it into per-frame masks.
 * @param {Frame[]} frames @param {Box} box0 @param {{pad?: number, shape?: 'rect'|'ellipse'}} [opts] @param {Progress} [progress]
 */
export function masksFromBox(frames, box0, opts = {}, progress) {
  const { w, h } = frames[0];
  const cam = estimateCamera(frames);
  const { boxes, scores } = trackBox(frames, box0, { cam, onFrame: (i) => progress?.('Tracking', i, frames.length) });
  const masks = boxes.map((b) => boxMask(w, h, padBox(b, opts.pad ?? 0.08), opts.shape ?? 'rect'));
  return { masks, boxes, scores };
}

/**
 * Remove whatever the masks cover from every frame.
 * @param {Frame[]} frames @param {Uint8Array[]} masks
 * @param {{dilate?: number, window?: number}} [opts] @param {Progress} [progress]
 */
export async function eraseWithMasks(frames, masks, opts = {}, progress) {
  const { w, h } = frames[0];
  const grown = masks.map((m) => dilate(m, w, h, opts.dilate ?? 3));
  progress?.('Estimating camera motion', 0, 1);
  await tick();
  const cam = estimateCamera(frames, grown);
  const res = await temporalFill(frames, grown, cam, {
    window: opts.window ?? 24,
    onFrame: (i) => progress?.('Filling background', i + 1, frames.length),
  });
  const filled = res.temporal + res.spatial;
  return {
    frames: res.frames,
    masks: grown,
    cam,
    stats: {
      maskedPixels: res.masked,
      fromOtherFrames: filled ? res.temporal / filled : 0,
      reconstructed: filled ? res.spatial / filled : 0,
    },
  };
}
