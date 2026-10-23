// @ts-check
import { makeSample } from './core/sample.js';
import { padBox } from './core/image.js';
import { masksFromBox, eraseWithMasks } from './core/pipeline.js';
import { meanPsnr } from './core/metrics.js';
import { decodeVideo, encodeWebM } from './video.js';

/** @typedef {import('./core/image.js').Frame} Frame @typedef {import('./core/image.js').Box} Box */

const $ = (id) => /** @type {any} */ (document.getElementById(id));
const view = /** @type {HTMLCanvasElement} */ ($('view'));
const ctx = /** @type {CanvasRenderingContext2D} */ (view.getContext('2d'));

const S = {
  /** @type {Frame[]|null} */ frames: null,
  /** @type {Frame[]|null} */ result: null,
  /** @type {Uint8Array[]|null} */ masks: null,
  /** @type {ReturnType<typeof makeSample>|null} */ sample: null,
  /** @type {Box|null} */ box: null,
  fps: 12, t: 0, wipe: 0.5, mode: 'box', playing: false, busy: false,
  /** @type {{x0:number,y0:number}|null} */ drag: null,
  /** @type {any} */ timer: null,
};

// ---------- drawing ----------
let overlay = null;
function maskOverlay(mask, w, h) {
  if (!overlay || overlay.width !== w || overlay.height !== h) { overlay = document.createElement('canvas'); overlay.width = w; overlay.height = h; }
  const o = overlay.getContext('2d'), img = o.createImageData(w, h);
  for (let i = 0; i < mask.length; i++) if (mask[i]) { const k = i * 4; img.data[k] = 224; img.data[k + 1] = 142; img.data[k + 2] = 138; img.data[k + 3] = 140; }
  o.putImageData(img, 0, 0);
  return overlay;
}

function draw() {
  const has = !!S.frames;
  $('empty').hidden = has;
  if (!has) return;
  const f = S.frames[S.t], { w, h } = f;
  if (view.width !== w || view.height !== h) { view.width = w; view.height = h; }
  ctx.putImageData(new ImageData(f.data, w, h), 0, 0);
  const r = S.result?.[S.t];
  if (r) {
    const x = Math.round(S.wipe * w);
    ctx.putImageData(new ImageData(r.data, w, h), 0, 0, x, 0, w - x, h);
    ctx.fillStyle = 'rgba(244,237,230,.9)'; ctx.fillRect(x - 1, 0, 2, h);
  }
  if ($('showmask').checked && S.masks?.[S.t]) ctx.drawImage(maskOverlay(S.masks[S.t], w, h), 0, 0);
  if (S.box && !S.result && S.t === 0) {
    ctx.strokeStyle = '#E6CBA0'; ctx.lineWidth = Math.max(1.5, w / 320); ctx.setLineDash([6, 4]);
    ctx.strokeRect(S.box.x, S.box.y, S.box.w, S.box.h); ctx.setLineDash([]);
  }
  $('lab-before').hidden = $('lab-after').hidden = !S.result;
  $('scrub').value = String(S.t);
  $('fcount').textContent = `${S.t + 1} / ${S.frames.length}`;
}

function hint(text) { const el = $('hint'); el.textContent = text || ''; el.hidden = !text; }
function error(text) { $('err').textContent = text || ''; }

function progress(stage, done, total) {
  $('prog').hidden = false;
  $('stage').textContent = stage;
  $('barfill').style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
}

function setFrames(frames, fps) {
  stop();
  S.frames = frames; S.fps = fps; S.t = 0; S.result = null; S.masks = null;
  $('scrub').max = String(frames.length - 1);
  $('results').hidden = true; $('wiperow').hidden = true;
  error('');
  updateHint();
  draw();
}

function updateHint() {
  if (!S.frames) return hint('');
  if (S.result) return hint('Drag the slider below to compare');
  if (S.mode === 'box') return hint(S.box ? 'Box set · drag again to redraw' : 'Drag to draw a box around the object');
  hint('');
}

// ---------- playback ----------
function play() {
  if (!S.frames) return;
  S.playing = true; $('play').textContent = 'Pause';
  clearInterval(S.timer);
  S.timer = setInterval(() => { S.t = (S.t + 1) % S.frames.length; draw(); }, 1000 / S.fps);
}
function stop() { S.playing = false; $('play').textContent = 'Play'; clearInterval(S.timer); }
$('play').onclick = () => (S.playing ? stop() : play());
$('scrub').oninput = (e) => { stop(); S.t = +e.target.value; draw(); };
$('wipe').oninput = (e) => { S.wipe = +e.target.value / 100; draw(); };
$('showmask').onchange = draw;

// ---------- inputs ----------
$('sample').onclick = () => {
  if (S.busy) return;
  const sample = makeSample({ w: 384, h: 216, frames: 48, pan: 1.5 });
  S.sample = sample;
  S.box = padBox(sample.box0, 0.06);
  setFrames(sample.frames, sample.fps);
  $('vidinfo').textContent = 'Sample: a person walks across a panning dusk landscape. The clean background is known, so quality is measured exactly.';
};

$('file').onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file || S.busy) return;
  S.busy = true; error(''); S.sample = null; S.box = null;
  try {
    const { frames, fps, duration } = await decodeVideo(file, { onProgress: (d, t) => progress('Reading video', d, t) });
    setFrames(frames, fps);
    $('vidinfo').textContent = `${file.name} · ${duration.toFixed(1)} s · ${frames[0].w}×${frames[0].h} · ${frames.length} frames`;
    $('prog').hidden = true;
  } catch (err) {
    error(err.message || String(err));
  } finally {
    S.busy = false; e.target.value = '';
  }
};

function setMode(mode) {
  S.mode = mode;
  $('mode-box').setAttribute('aria-pressed', String(mode === 'box'));
  $('mode-ai').setAttribute('aria-pressed', String(mode === 'ai'));
  $('boxpanel').hidden = mode !== 'box';
  $('aipanel').hidden = mode !== 'ai';
  error(''); updateHint(); draw();
}
$('mode-box').onclick = () => setMode('box');
$('mode-ai').onclick = () => setMode('ai');

// draw a box on the first frame
function toFrame(e) {
  const r = view.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * view.width, y: ((e.clientY - r.top) / r.height) * view.height };
}
view.addEventListener('pointerdown', (e) => {
  if (!S.frames || S.result || S.mode !== 'box' || S.busy) return;
  stop(); S.t = 0;
  const p = toFrame(e);
  S.drag = { x0: p.x, y0: p.y };
  S.box = { x: p.x, y: p.y, w: 1, h: 1 };
  view.setPointerCapture(e.pointerId);
  draw();
});
view.addEventListener('pointermove', (e) => {
  if (!S.drag) return;
  const p = toFrame(e);
  S.box = { x: Math.min(S.drag.x0, p.x), y: Math.min(S.drag.y0, p.y), w: Math.abs(p.x - S.drag.x0), h: Math.abs(p.y - S.drag.y0) };
  draw();
});
view.addEventListener('pointerup', () => {
  if (!S.drag) return;
  S.drag = null;
  if (S.box && (S.box.w < 6 || S.box.h < 6)) S.box = null;
  updateHint(); draw();
});

// ---------- erase ----------
$('erase').onclick = async () => {
  if (S.busy) return;
  error('');
  if (!S.frames) return error('Choose the sample clip or upload a video first.');
  if (S.mode === 'box' && !S.box) return error('Draw a box around the object on the video first.');
  const prompt = $('prompt').value.trim();
  if (S.mode === 'ai' && !prompt) return error('Type what should disappear, for example “person”.');
  if (S.mode === 'ai' && S.sample) return error('The sample clip is a drawing, and the AI detector only recognises real footage. Upload a real video to try AI mode, or use “Draw a box” on the sample.');
  S.busy = true; stop(); $('erase').textContent = 'Erasing…';
  const t0 = performance.now();
  try {
    let masks;
    if (S.mode === 'box') {
      progress('Tracking', 0, S.frames.length);
      await new Promise((r) => setTimeout(r, 20));
      masks = masksFromBox(S.frames, /** @type {Box} */ (S.box), {}, progress).masks;
    } else {
      const { masksFromPrompt } = await import('./ai.js');
      let res;
      try {
        res = await masksFromPrompt(S.frames, prompt, { onStatus: (s) => progress(s, 0, 1), onProgress: (d, t) => progress('Detecting and segmenting', d, t) });
      } catch (err) {
        if (err && err.name === 'UnknownObjectError') throw err;
        throw new Error(`AI mode couldn't run: ${err.message || err}. Check your internet connection, or use “Draw a box”, which works offline.`);
      }
      if (!res.detections) throw new Error(`No ${prompt} was found in the video. Try another word for it, or draw a box instead.`);
      masks = res.masks;
    }
    const out = await eraseWithMasks(S.frames, masks, {}, progress);
    S.result = out.frames; S.masks = out.masks;
    const secs = (performance.now() - t0) / 1000;
    $('s-frames').textContent = String(S.frames.length);
    $('s-time').textContent = `${secs.toFixed(1)} s`;
    $('s-temporal').textContent = `${Math.round(out.stats.fromOtherFrames * 100)}%`;
    if (S.sample) {
      const before = meanPsnr(S.frames, S.sample.clean, S.sample.truth), after = meanPsnr(out.frames, S.sample.clean, S.sample.truth);
      $('s-psnr').textContent = `${after.toFixed(1)} dB`;
      $('s-psnr-label').textContent = `PSNR in erased area (was ${before.toFixed(1)} dB)`;
    } else {
      $('s-psnr').textContent = '–';
      $('s-psnr-label').textContent = 'PSNR needs a known clean background (sample clip)';
    }
    $('results').hidden = false; $('wiperow').hidden = false;
    progress('Done', 1, 1);
    S.t = 0; updateHint(); draw(); play();
  } catch (err) {
    error(err.message || String(err));
    $('prog').hidden = true;
  } finally {
    S.busy = false; $('erase').textContent = 'Erase object';
  }
};

$('reset').onclick = () => {
  if (!S.frames || S.busy) return;
  stop(); S.result = null; S.masks = null; S.t = 0;
  $('results').hidden = true; $('wiperow').hidden = true; $('prog').hidden = true;
  updateHint(); draw();
};

$('download').onclick = async () => {
  if (!S.result || S.busy) return;
  S.busy = true; stop();
  const btn = $('download'); btn.textContent = 'Encoding…';
  try {
    const blob = await encodeWebM(S.result, S.fps, (d, t) => progress('Encoding video', d, t));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'erased.webm';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    progress('Saved erased.webm', 1, 1);
  } catch (err) {
    error(err.message || String(err));
  } finally {
    S.busy = false; btn.textContent = 'Download video';
  }
};

// start with the sample so the page is never empty
$('sample').click();
