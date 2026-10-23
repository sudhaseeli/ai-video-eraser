import { test, assert, near } from './harness.js';
import { makeFrame, padBox } from '../src/core/image.js';
import { boxMask, dilate, translateMask, count, maskBox, coverage } from '../src/core/mask.js';
import { trackBox } from '../src/core/tracker.js';
import { estimateCamera } from '../src/core/align.js';
import { spatialFill } from '../src/core/inpaint.js';
import { psnr, meanPsnr } from '../src/core/metrics.js';
import { makeSample } from '../src/core/sample.js';
import { masksFromBox, eraseWithMasks } from '../src/core/pipeline.js';
import { selectDetections, labelsForPrompt } from '../src/ai-select.js';

const SAMPLE = makeSample({ w: 240, h: 136, frames: 36, pan: 1.5 });

test('box masks, dilation and translation', () => {
  const m = boxMask(20, 10, { x: 2, y: 2, w: 4, h: 3 });
  assert(count(m) === 12, `rect mask should have 12 pixels, got ${count(m)}`);
  const d = dilate(m, 20, 10, 1);
  assert(count(d) === 30, `dilated mask should have 30 pixels, got ${count(d)}`);
  const t = translateMask(m, 20, 10, 5, 1);
  const b = maskBox(t, 20, 10);
  assert(b && b.x === 7 && b.y === 3 && b.w === 4 && b.h === 3, `unexpected box ${JSON.stringify(b)}`);
  const e = boxMask(20, 20, { x: 0, y: 0, w: 20, h: 20 }, 'ellipse');
  assert(count(e) < 400 && count(e) > 280, 'ellipse mask should be smaller than its box');
});

test('spatial fill closes a hole with nearby colour', () => {
  const f = makeFrame(16, 16);
  for (let i = 0; i < f.data.length; i += 4) { f.data[i] = 200; f.data[i + 1] = 100; f.data[i + 2] = 50; f.data[i + 3] = 255; }
  const hole = boxMask(16, 16, { x: 5, y: 5, w: 6, h: 6 });
  for (let p = 0; p < hole.length; p++) if (hole[p]) f.data[p * 4] = 0;
  const filled = spatialFill(f, hole);
  assert(filled === 36, `should fill 36 pixels, filled ${filled}`);
  near(f.data[(8 * 16 + 8) * 4], 200, 0.5, 'centre red channel');
});

test('psnr is infinite for identical frames and finite otherwise', () => {
  const a = SAMPLE.frames[0];
  assert(psnr(a, a) === Infinity, 'identical frames');
  const v = psnr(a, SAMPLE.clean[0]);
  assert(Number.isFinite(v) && v > 5, `frame vs clean background should be finite, got ${v}`);
});

test('camera motion estimate recovers the pan', () => {
  const cam = estimateCamera(SAMPLE.frames, SAMPLE.truth);
  const last = SAMPLE.frames.length - 1;
  near(cam[last].x, last * 1.5, 3, 'horizontal pan after all frames');
  near(cam[last].y, 0, 2, 'vertical drift');
});

test('tracker follows the walking person', () => {
  const cam = estimateCamera(SAMPLE.frames);
  const { boxes } = trackBox(SAMPLE.frames, padBox(SAMPLE.box0, 0.05), { cam });
  const { w, h } = SAMPLE.frames[0];
  let worst = 1;
  for (let t = 0; t < boxes.length; t++) {
    const c = coverage(SAMPLE.truth[t], dilate(boxMask(w, h, padBox(boxes[t], 0.08)), w, h, 3));
    worst = Math.min(worst, c);
  }
  assert(worst > 0.85, `box should cover at least 85% of the person in every frame, worst was ${(worst * 100).toFixed(1)}%`);
});

test('lightweight mode erases the person and restores the background', async () => {
  const { masks } = masksFromBox(SAMPLE.frames, padBox(SAMPLE.box0, 0.05));
  const res = await eraseWithMasks(SAMPLE.frames, masks);
  const quality = meanPsnr(res.frames, SAMPLE.clean, SAMPLE.truth);
  const before = meanPsnr(SAMPLE.frames, SAMPLE.clean, SAMPLE.truth);
  assert(quality > 28, `PSNR inside the person should be > 28 dB, got ${quality.toFixed(1)} dB`);
  assert(quality > before + 15, `erasing should improve PSNR a lot (before ${before.toFixed(1)} dB)`);
  assert(res.stats.fromOtherFrames > 0.9, `most pixels should come from other frames, got ${res.stats.fromOtherFrames}`);
});

test('erasing with perfect masks is near-lossless', async () => {
  const res = await eraseWithMasks(SAMPLE.frames, SAMPLE.truth, { dilate: 1 });
  const quality = meanPsnr(res.frames, SAMPLE.clean, SAMPLE.truth);
  assert(quality > 32, `PSNR with ground-truth masks should be > 32 dB, got ${quality.toFixed(1)} dB`);
});

test('AI mode keeps only confident detections of the wanted objects', () => {
  const dets = [
    { label: 'person', score: 0.97, box: { xmin: 10, ymin: 10, xmax: 40, ymax: 90 } },
    { label: 'person', score: 0.3, box: { xmin: 100, ymin: 10, xmax: 130, ymax: 90 } },
    { label: 'person', score: 0.95, box: { xmin: 12, ymin: 12, xmax: 41, ymax: 88 } },
    { label: 'dog', score: 0.99, box: { xmin: 200, ymin: 50, xmax: 240, ymax: 90 } },
  ];
  const kept = selectDetections(dets, { threshold: 0.6, maxObjects: 3, iou: 0.5, labels: ['person'] });
  assert(kept.length === 1, `expected 1 person after threshold + overlap removal, got ${kept.length}`);
  near(kept[0].score, 0.97, 1e-9, 'highest-scoring box kept');
  assert(selectDetections(dets, { threshold: 0.6, labels: ['person', 'dog'] }).length === 2, 'person and dog');
});

test('prompts map to detector labels', () => {
  const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  assert(same(labelsForPrompt('person'), ['person']), 'person');
  assert(same(labelsForPrompt('the man in the red jacket'), ['person']), 'man → person');
  assert(same(labelsForPrompt('A woman and her dog'), ['person', 'dog']), 'woman and dog');
  assert(same(labelsForPrompt('parked cars'), ['car']), 'plural');
  assert(same(labelsForPrompt('my phone, a bike'), ['cell phone', 'bicycle']), 'synonyms');
  assert(labelsForPrompt('a castle').length === 0, 'unknown objects return nothing');
});
