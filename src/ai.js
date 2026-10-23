// @ts-check
/**
 * AI mode: type what to erase.
 *  1. The prompt is mapped to detector labels ("a man and his dog" → person, dog).
 *  2. DETR finds those objects on keyframes.
 *  3. SlimSAM turns each detection into a pixel-accurate mask.
 *  4. Between keyframes, masks follow the object with the template tracker.
 * Models run in the browser through Transformers.js (8-bit, WebAssembly) and
 * are downloaded once, then cached by the browser.
 */
import { boxMask, dilate, union, translateMask } from './core/mask.js';
import { TemplateTracker } from './core/tracker.js';
import { tick } from './core/image.js';
import { selectDetections, labelsForPrompt } from './ai-select.js';

/** @typedef {import('./core/image.js').Frame} Frame */

const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';
const DETECTOR = 'Xenova/detr-resnet-50';
const SEGMENTER = 'Xenova/slimsam-77-uniform';

let lib = null, detector = null, sam = null, samProcessor = null;

/** The prompt doesn't name anything the detector knows. */
export class UnknownObjectError extends Error {
  /** @param {string} prompt */
  constructor(prompt) {
    super(`“${prompt}” isn't one of the 80 object types AI mode recognises. Try words like person, car, dog, bicycle or bag, or draw a box instead.`);
    this.name = 'UnknownObjectError';
  }
}

/** @param {(msg: string) => void} [status] */
export async function loadModels(status) {
  if (detector && sam) return;
  status?.('Loading Transformers.js…');
  lib = await import(/* @vite-ignore */ TRANSFORMERS);
  // 8-bit quantised models on WebAssembly: a smaller download and the most reliable choice across browsers.
  const opts = { device: 'wasm', dtype: 'q8', progress_callback: (p) => {
    if (p.status === 'progress' && p.file?.endsWith('.onnx')) status?.(`Downloading ${p.file.split('/').pop()} · ${Math.round(p.progress)}%`);
  } };
  status?.('Loading detector…');
  detector = await lib.pipeline('object-detection', DETECTOR, opts);
  status?.('Loading segmenter…');
  sam = await lib.SamModel.from_pretrained(SEGMENTER, opts);
  samProcessor = await lib.AutoProcessor.from_pretrained(SEGMENTER);
  status?.('Models ready');
}

/** @param {Frame} f */
function toRaw(f) {
  return new lib.RawImage(new Uint8ClampedArray(f.data), f.w, f.h, 4).rgb();
}

/**
 * All objects DETR finds in a frame.
 * @param {Frame} frame @param {number} threshold
 * @returns {Promise<import('./ai-select.js').Detection[]>}
 */
export async function detect(frame, threshold) {
  return detector(toRaw(frame), { threshold, percentage: false });
}

/**
 * Pixel mask for one detected box. SAM gets three points down the middle of
 * the box (a single centre point often selects only part of the object, such
 * as a person's clothes). Among its near-best masks we keep the most complete.
 * @param {Frame} frame @param {{xmin: number, ymin: number, xmax: number, ymax: number}} box
 */
export async function segment(frame, box) {
  const image = toRaw(frame);
  const cx = (box.xmin + box.xmax) / 2, bh = box.ymax - box.ymin;
  const points = [0.2, 0.5, 0.8].map((f) => [cx, box.ymin + bh * f]);
  const inputs = await samProcessor(image, { input_points: [points], input_labels: [points.map(() => 1)] });
  const outputs = await sam(inputs);
  const masks = await samProcessor.post_process_masks(outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
  const t = masks[0], [, n, H, W] = t.dims, plane = H * W, data = t.data;
  const scores = Array.from(outputs.iou_scores.data);
  const top = Math.max(...scores);
  const area = (k) => { let s = 0; for (let i = 0; i < plane; i++) s += data[k * plane + i] ? 1 : 0; return s; };
  let best = -1, bestArea = -1;
  for (let k = 0; k < n; k++) if (scores[k] >= top - 0.02) { const a = area(k); if (a > bestArea) { best = k; bestArea = a; } }
  const boxArea = Math.max(1, (box.xmax - box.xmin) * bh);
  const limit = boxMask(frame.w, frame.h, { x: box.xmin - 6, y: box.ymin - 6, w: box.xmax - box.xmin + 12, h: bh + 12 });
  // If SAM returns something implausibly small, fall back to the detection itself.
  if (bestArea / boxArea < 0.15) return boxMask(frame.w, frame.h, { x: box.xmin, y: box.ymin, w: box.xmax - box.xmin, h: bh }, 'ellipse');
  const m = new Uint8Array(frame.w * frame.h);
  // keep SAM inside a slightly grown detection box so it can't leak into the background
  for (let i = 0; i < plane; i++) m[i] = data[best * plane + i] && limit[i] ? 1 : 0;
  return m;
}

/**
 * Build per-frame masks for everything matching the prompt.
 * @param {Frame[]} frames @param {string} prompt
 * @param {{every?: number, threshold?: number, maxObjects?: number, onStatus?: (s: string) => void, onProgress?: (done: number, total: number) => void}} [opts]
 * @returns {Promise<{masks: Uint8Array[], detections: number}>}
 */
export async function masksFromPrompt(frames, prompt, opts = {}) {
  const every = opts.every ?? 6, threshold = opts.threshold ?? 0.6, maxObjects = opts.maxObjects ?? 3;
  const labels = labelsForPrompt(prompt);
  if (!labels.length) throw new UnknownObjectError(prompt);
  await loadModels(opts.onStatus);
  const { w, h } = frames[0];
  const masks = frames.map(() => new Uint8Array(w * h));
  let detections = 0;
  for (let k = 0; k < frames.length; k += every) {
    opts.onStatus?.(`Finding ${labels.join(', ')} in frame ${k + 1} of ${frames.length}`);
    const dets = selectDetections(await detect(frames[k], threshold), { threshold, maxObjects, labels });
    detections += dets.length;
    for (const d of dets) {
      const m = await segment(frames[k], d.box);
      masks[k] = union(masks[k], m);
      // carry the mask forward to the next keyframe with the tracker
      const box = { x: d.box.xmin, y: d.box.ymin, w: d.box.xmax - d.box.xmin, h: d.box.ymax - d.box.ymin };
      const tr = new TemplateTracker(frames[k], box);
      for (let t = k + 1; t < Math.min(frames.length, k + every); t++) {
        const b = tr.update(frames[t]);
        const shifted = translateMask(m, w, h, b.x - box.x, b.y - box.y);
        masks[t] = union(masks[t], dilate(shifted, w, h, 2));
      }
    }
    opts.onProgress?.(Math.min(frames.length, k + every), frames.length);
    await tick();
  }
  return { masks, detections };
}
