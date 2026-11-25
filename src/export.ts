import { palettes, type Lens, type Stage, type Theme } from './types';
import { closing, question } from './words';

export const formats = [
  { label: 'WebM · VP9', mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
  { label: 'WebM · VP8', mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
  { label: 'MP4', mime: 'video/mp4', ext: 'mp4' },
  { label: 'WebM', mime: 'video/webm', ext: 'webm' },
];
export const supportedFormats = () => typeof MediaRecorder === 'undefined' ? [] : formats.filter(f => MediaRecorder.isTypeSupported(f.mime));
export const dimensions = (lens: Lens, poster: boolean, aspect: number) => {
  const ratio = lens === 'portrait' ? 9 / 16 : lens === 'landscape' ? 16 / 9 : aspect;
  const long = poster ? 2560 : 1280;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return ratio >= 1 ? [long, even(long / ratio)] as const : [even(long * ratio), long] as const;
};
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

type Composition = { theme: Theme; stage: Stage; memory?: string; camera?: HTMLCanvasElement | HTMLVideoElement; corner: string; cutout: boolean };
function lines(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const rows: string[] = [];
  for (const line of text.split('\n')) {
    let current = '';
    for (const token of (line.match(/[^\s\p{Script=Han}]+|\p{Script=Han}|\s+/gu) ?? [])) {
      if (current && ctx.measureText(current + token).width > width && token.trim()) {
        rows.push(current.trim());
        current = '';
      }
      current += token;
    }
    rows.push(current.trim());
  }
  return rows;
}

export function paintComposition(ctx: CanvasRenderingContext2D, gl: HTMLCanvasElement, options: Composition) {
  const { width: w, height: h } = ctx.canvas;
  const palette = palettes[options.theme];
  const ratio = Math.min(w / gl.width, h / gl.height);
  const dw = gl.width * ratio, dh = gl.height * ratio;
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, w, h);
  const aura = ctx.createRadialGradient(w * .5, h * .52, 0, w * .50, h * .54, h * .68);
  aura.addColorStop(0, options.theme === 'Winter' ? '#132232' : '#20251a');
  aura.addColorStop(1, palette.background);
  ctx.fillStyle = aura;
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(gl, (w - dw) / 2, (h - dh) / 2, dw, dh);

  if (options.camera) {
    const source = options.camera;
    const video = source instanceof HTMLVideoElement;
    const sw = video ? source.videoWidth : source.width, sh = video ? source.videoHeight : source.height;
    if (sw && sh) {
      const cw = Math.min(w * .26, h * .23), ch = cw * .75, padding = Math.min(w, h) * .039;
      const x = options.corner.includes('right') ? w - cw - padding : padding;
      const y = options.corner.includes('bottom') ? h - ch - padding : padding;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, cw, ch, cw * .085);
      ctx.clip();
      if (!options.cutout) { ctx.fillStyle = '#121a16'; ctx.fillRect(x, y, cw, ch); }
      const scale = Math.max(cw / sw, ch / sh);
      ctx.translate(x + cw / 2, y + ch / 2);
      ctx.scale(-1, 1);
      ctx.drawImage(source, -sw * scale / 2, -sh * scale / 2, sw * scale, sh * scale);
      ctx.restore();
    }
  }

  if (options.memory || options.stage === 'ending') {
    const unit = Math.min(w, h);
    const main = options.memory || closing;
    const additional = options.memory ? '' : question;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = palette.white;
    ctx.shadowColor = palette.background;
    ctx.shadowBlur = unit * .033;
    const fontSize = unit * (options.memory ? .063 : .047);
    ctx.font = `500 ${fontSize}px "Cormorant Garamond Variable", Georgia, serif`;
    const mainRows = lines(ctx, main, w * .83);
    const y = options.memory ? h * .54 - (mainRows.length - 1) * fontSize * .54 : h * .79;
    mainRows.forEach((row, i) => ctx.fillText(row, w * .5, y + i * fontSize * 1.08, w * .86));
    if (additional) {
      const sub = unit * .028;
      ctx.font = `italic ${sub}px "Cormorant Garamond Variable", Georgia, serif`;
      lines(ctx, additional, w * .79).forEach((row, i) => ctx.fillText(row, w * .5, y + mainRows.length * fontSize * 1.08 + i * sub * 1.5, w * .86));
    }
    ctx.shadowBlur = 0;
  }
}

export function makeRecording(width: number, height: number, format: typeof formats[number], audio: MediaStreamTrack | undefined, done: (blob?: Blob) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const stream = canvas.captureStream(30);
  if (audio) stream.addTrack(audio.clone());
  let recorder: MediaRecorder;
  try { recorder = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond: 6_000_000 }); }
  catch (error) { stream.getTracks().forEach(track => track.stop()); throw error; }
  const chunks: Blob[] = [];
  recorder.ondataavailable = ({ data }) => { if (data.size) chunks.push(data); };
  let failed = false;
  recorder.onerror = () => { failed = true; };
  recorder.onstop = () => {
    stream.getTracks().forEach(track => track.stop());
    done(!failed && chunks.length ? new Blob(chunks, { type: recorder.mimeType }) : undefined);
  };
  try { recorder.start(600); }
  catch (error) { stream.getTracks().forEach(track => track.stop()); throw error; }
  return { ctx, stop: () => { if (recorder.state !== 'inactive') recorder.stop(); } };
}
