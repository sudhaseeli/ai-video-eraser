// @ts-check
/**
 * Prompt matching and detection post-processing for AI mode. Kept separate
 * from ai.js so it can be tested without downloading any models.
 * @typedef {{ label: string, score: number, box: { xmin: number, ymin: number, xmax: number, ymax: number } }} Detection
 */

/** The 80 object types DETR (trained on COCO) can find. */
export const COCO = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat', 'traffic light',
  'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow',
  'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
  'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket', 'bottle',
  'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange',
  'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch', 'potted plant', 'bed',
  'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote', 'keyboard', 'cell phone', 'microwave', 'oven',
  'toaster', 'sink', 'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush',
];

const SYNONYMS = {
  person: ['people', 'man', 'men', 'woman', 'women', 'boy', 'girl', 'child', 'kid', 'kids', 'human', 'pedestrian', 'tourist', 'guy', 'lady', 'someone', 'photobomber'],
  car: ['cars', 'automobile', 'vehicle', 'taxi', 'van', 'suv'],
  motorcycle: ['motorbike', 'scooter', 'moped'],
  bicycle: ['bike', 'cyclist'],
  truck: ['lorry'],
  dog: ['puppy', 'dogs'],
  cat: ['kitten', 'cats'],
  bird: ['birds', 'pigeon', 'seagull'],
  'cell phone': ['phone', 'smartphone', 'mobile'],
  tv: ['television', 'monitor', 'screen'],
  couch: ['sofa'],
  'potted plant': ['plant'],
  'sports ball': ['ball', 'football', 'soccer ball'],
  handbag: ['bag', 'purse'],
  'dining table': ['table'],
  airplane: ['plane', 'aeroplane'],
  boat: ['ship'],
};

/**
 * Which detector labels a free-text prompt refers to, e.g. "a man and his dog" → person, dog.
 * @param {string} prompt @returns {string[]}
 */
export function labelsForPrompt(prompt) {
  const text = ` ${prompt.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ')} `;
  const found = new Set();
  for (const label of COCO) if (text.includes(` ${label} `) || text.includes(` ${label}s `)) found.add(label);
  for (const [label, words] of Object.entries(SYNONYMS)) for (const w of words) if (text.includes(` ${w} `)) found.add(label);
  return [...found];
}

/** @param {Detection['box']} a @param {Detection['box']} b */
export function iou(a, b) {
  const x0 = Math.max(a.xmin, b.xmin), y0 = Math.max(a.ymin, b.ymin);
  const x1 = Math.min(a.xmax, b.xmax), y1 = Math.min(a.ymax, b.ymax);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const area = (r) => Math.max(0, r.xmax - r.xmin) * Math.max(0, r.ymax - r.ymin);
  const u = area(a) + area(b) - inter;
  return u > 0 ? inter / u : 0;
}

/**
 * Keep confident detections of the wanted labels, without duplicates (non-maximum suppression).
 * @param {Detection[]} dets @param {{threshold?: number, maxObjects?: number, iou?: number, labels?: string[]}} [opts]
 * @returns {Detection[]}
 */
export function selectDetections(dets, opts = {}) {
  const thr = opts.threshold ?? 0.5, max = opts.maxObjects ?? 3, overlap = opts.iou ?? 0.5;
  const want = opts.labels ? new Set(opts.labels) : null;
  const sorted = dets.filter((d) => d.score >= thr && (!want || want.has(d.label))).sort((a, b) => b.score - a.score);
  const kept = [];
  for (const d of sorted) {
    if (kept.every((k) => iou(k.box, d.box) < overlap)) kept.push(d);
    if (kept.length >= max) break;
  }
  return kept;
}
