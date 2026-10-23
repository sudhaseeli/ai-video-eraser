// @ts-check
/** Browser-only helpers: decode a video file into frames and encode frames back to WebM. */

/** @typedef {import('./core/image.js').Frame} Frame */

const seek = (video, t) => new Promise((resolve, reject) => {
  const done = () => { video.removeEventListener('seeked', done); video.removeEventListener('error', fail); resolve(undefined); };
  const fail = () => { video.removeEventListener('seeked', done); video.removeEventListener('error', fail); reject(new Error('This video could not be decoded by your browser.')); };
  video.addEventListener('seeked', done);
  video.addEventListener('error', fail);
  video.currentTime = t;
});

/**
 * Decode a video into RGBA frames, downscaled and limited in length so it fits in memory.
 * @param {Blob} file
 * @param {{maxWidth?: number, fps?: number, maxSeconds?: number, onProgress?: (done: number, total: number) => void}} [opts]
 * @returns {Promise<{frames: Frame[], fps: number, duration: number}>}
 */
export async function decodeVideo(file, opts = {}) {
  const maxWidth = opts.maxWidth ?? 480, fps = opts.fps ?? 12, maxSeconds = opts.maxSeconds ?? 8;
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto';
  const url = URL.createObjectURL(file);
  video.src = url;
  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('This file is not a video your browser can play. Try an MP4 (H.264) or WebM file.'));
    });
    const duration = Math.min(video.duration || 0, maxSeconds);
    if (!duration) throw new Error('The video has no length.');
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const w = Math.round((video.videoWidth * scale) / 2) * 2, h = Math.round((video.videoHeight * scale) / 2) * 2;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d', { willReadFrequently: true }));
    const total = Math.max(2, Math.floor(duration * fps));
    const frames = [];
    for (let i = 0; i < total; i++) {
      await seek(video, Math.min(duration - 0.001, i / fps));
      ctx.drawImage(video, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      frames.push({ w, h, data: img.data });
      opts.onProgress?.(i + 1, total);
    }
    return { frames, fps, duration };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Encode frames to a WebM file in real time with MediaRecorder.
 * @param {Frame[]} frames @param {number} fps @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<Blob>}
 */
export async function encodeWebM(frames, fps, onProgress) {
  const { w, h } = frames[0];
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const stream = canvas.captureStream(fps);
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  if (!type) throw new Error('Your browser cannot record WebM video.');
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  ctx.putImageData(new ImageData(new Uint8ClampedArray(frames[0].data), w, h), 0, 0);
  rec.start();
  for (let i = 0; i < frames.length; i++) {
    ctx.putImageData(new ImageData(new Uint8ClampedArray(frames[i].data), w, h), 0, 0);
    onProgress?.(i + 1, frames.length);
    await new Promise((r) => setTimeout(r, 1000 / fps));
  }
  rec.stop();
  await stopped;
  return new Blob(chunks, { type: 'video/webm' });
}
