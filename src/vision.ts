import { FilesetResolver, HandLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision';
import type { Frame, Gesture, Hand, Point } from './types';
import { baseline, distance, measure, palm, WINDOW } from './gesture-features';

const runtime = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm';
const models = 'https://storage.googleapis.com/mediapipe-models';
let files: ReturnType<typeof FilesetResolver.forVisionTasks> | undefined;
const getFiles = () => files ??= FilesetResolver.forVisionTasks(runtime).catch(error => { files = undefined; throw error; });

export async function createLandmarker() {
  const resolver = await getFiles();
  const modelAssetPath = `${models}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`;
  const options = { runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: .52, minHandPresenceConfidence: .50, minTrackingConfidence: .53 } as const;
  try { return await HandLandmarker.createFromOptions(resolver, { ...options, baseOptions: { modelAssetPath, delegate: 'GPU' } }); }
  catch { return HandLandmarker.createFromOptions(resolver, { ...options, baseOptions: { modelAssetPath, delegate: 'CPU' } }); }
}

export async function openVideo(video: HTMLVideoElement) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access needs HTTPS or localhost.');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
  try {
    video.srcObject = stream;
    await video.play();
    return stream;
  } catch (error) {
    stream.getTracks().forEach(track => track.stop());
    throw error;
  }
}

type Track = {
  frames: Frame[]; center: Point; display: Point; vx: number; candidate: Gesture; gesture: Gesture;
  confirmations: number; latched: boolean; lastPinch: number; lastSeen: number;
  prediction?: { gesture: Gesture; confidence: number; t: number };
  inferenceAt: number; pending: boolean;
};

const zero = { x: 0, y: 0, z: 0 };
export class CameraHands {
  private stream?: MediaStream;
  private detector?: HandLandmarker;
  private segmenter?: ImageSegmenter;
  private tracks = new Map<number, Track>();
  private nextTrack = 0;
  private frameId = 0;
  private lastFrame = -1;
  private lastCapture = 0;
  private lastSegment = 0;
  private disposed = false;
  private classify?: Awaited<ReturnType<typeof import('./inference').getInference>>;
  private masking = false;
  private matte = document.createElement('canvas');
  readonly cutout = document.createElement('canvas');
  readonly video = document.createElement('video');
  cutoutReady = false;

  constructor(private onHands: (hands: Hand[]) => void, private onModel: (state: string) => void, private onFailure: () => void) {
    this.video.muted = true;
    this.video.playsInline = true;
  }

  async start() {
    const stream = await openVideo(this.video);
    if (this.disposed) { stream.getTracks().forEach(track => track.stop()); return; }
    this.stream = stream;
    stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (!this.disposed) this.onFailure(); });
    const detector = await createLandmarker();
    if (this.disposed) { detector.close(); return; }
    this.detector = detector;
    this.frameId = requestAnimationFrame(this.tick);
    void import('./inference').then(({ getInference }) => getInference()).then(classify => {
      if (this.disposed) return;
      this.classify = classify;
      this.onModel('Temporal CNN');
    }).catch(() => { if (!this.disposed) this.onModel('Geometry baseline'); });
  }

  async setCutout(enabled: boolean) {
    if (!enabled) { this.masking = false; this.cutoutReady = false; return; }
    if (!this.segmenter) {
      const resolver = await getFiles();
      if (this.disposed) return;
      const segmenter = await ImageSegmenter.createFromOptions(resolver, {
        baseOptions: { modelAssetPath: `${models}/image_segmenter/selfie_segmenter_landscape/float16/1/selfie_segmenter_landscape.tflite` },
        runningMode: 'VIDEO', outputCategoryMask: true, outputConfidenceMasks: false,
      });
      if (this.disposed) { segmenter.close(); return; }
      this.segmenter = segmenter;
    }
    this.masking = !this.disposed;
  }

  private segment(now: number) {
    if (!this.segmenter || !this.masking || now - this.lastSegment < 95) return;
    this.lastSegment = now;
    this.segmenter.segmentForVideo(this.video, now, result => {
      const mask = result.categoryMask;
      if (!mask) return;
      const { width, height } = mask;
      if (this.matte.width !== width || this.matte.height !== height) { this.matte.width = width; this.matte.height = height; }
      const ctx = this.matte.getContext('2d')!;
      const rgba = ctx.createImageData(width, height);
      const pixels = mask.getAsUint8Array();
      for (let i = 0; i < pixels.length; i++) rgba.data[i * 4 + 3] = pixels[i] === 1 ? 255 : 0;
      ctx.putImageData(rgba, 0, 0);
      const w = 360, h = Math.round(w * this.video.videoHeight / this.video.videoWidth);
      if (this.cutout.width !== w || this.cutout.height !== h) { this.cutout.width = w; this.cutout.height = h; }
      const out = this.cutout.getContext('2d')!;
      out.clearRect(0, 0, w, h);
      out.drawImage(this.video, 0, 0, w, h);
      out.globalCompositeOperation = 'destination-in';
      out.drawImage(this.matte, 0, 0, w, h);
      out.globalCompositeOperation = 'source-over';
      this.cutoutReady = true;
    });
  }

  private tick = (now: number) => {
    this.frameId = requestAnimationFrame(this.tick);
    if (!this.detector || this.video.readyState < 2 || this.lastFrame === this.video.currentTime || now - this.lastCapture < 28) return;
    this.lastFrame = this.video.currentTime;
    this.lastCapture = now;
    try {
      const result = this.detector.detectForVideo(this.video, now);
      for (const [id, track] of this.tracks) if (now - track.lastSeen > 230) this.tracks.delete(id);
      const seen = new Set<number>();
      const hands = result.landmarks.map((points, i) => {
        const center = palm(points);
        const match = [...this.tracks.entries()].filter(([id, t]) => !seen.has(id) && distance(center, t.center) < .28)
          .sort((a, b) => distance(center, a[1].center) - distance(center, b[1].center))[0];
        const id = match?.[0] ?? this.nextTrack++;
        const track: Track = match?.[1] ?? { frames: [], center, display: { x: 1 - center.x, y: center.y, z: center.z }, vx: 0, candidate: 'Idle', gesture: 'Idle', confirmations: 0, latched: false, lastPinch: -1000, lastSeen: now, inferenceAt: 0, pending: false };
        const dt = Math.min(.12, Math.max(.015, (now - track.lastSeen) / 1000));
        seen.add(id);
        this.tracks.set(id, track);
        track.vx += ((track.center.x - center.x) / dt - track.vx) * .38;
        track.center = center;
        track.lastSeen = now;
        const confidence = result.handedness[i]?.[0]?.score ?? .8;
        track.frames.push({ points, t: now, confidence });
        if (track.frames.length > WINDOW) track.frames.shift();
        const data = measure(track.frames);
        const rule = baseline(data);
        if (this.classify && track.frames.length === WINDOW && now - track.inferenceAt > 94 && !track.pending) {
          track.inferenceAt = now;
          track.pending = true;
          this.classify(data).then(value => { track.prediction = { ...value, t: now }; })
            .catch(() => { this.classify = undefined; if (!this.disposed) this.onModel('Geometry baseline'); })
            .finally(() => { track.pending = false; });
        }
        const p = track.prediction;
        const usable = p && now - p.t < 260 && p.confidence >= .78 && confidence >= .60;
        const pinchRatio = distance(points[4], points[8]) / Math.max(.022, distance(points[0], points[9]));
        let label = usable ? p.gesture : rule;
        if (pinchRatio < .30 && rule === 'Pinch') label = 'Pinch';
        if (label === 'Pinch' && pinchRatio > .44) label = rule === 'Pinch' ? 'Idle' : rule;
        if (label === 'Swipe' && Math.abs(track.vx) < .18) label = rule === 'Swipe' ? 'Idle' : rule;
        if (label === track.candidate) track.confirmations++;
        else { track.candidate = label; track.confirmations = 1; }
        if (track.confirmations >= (label === 'Pinch' ? 3 : 4)) track.gesture = label;
        if (pinchRatio > .48) track.latched = false;
        const pinch = track.gesture === 'Pinch' && !track.latched && now - track.lastPinch > 650;
        if (pinch) { track.lastPinch = now; track.latched = true; }
        const location = track.gesture === 'Pinch' ? { x: (points[4].x + points[8].x) / 2, y: (points[4].y + points[8].y) / 2, z: (points[4].z + points[8].z) / 2 } : center;
        const smooth = 1 - Math.exp(-dt * 13);
        const target = confidence < .50 ? zero : { x: 1 - location.x, y: location.y, z: location.z };
        if (target !== zero) for (const key of ['x', 'y', 'z'] as const) track.display[key] += (target[key] - track.display[key]) * smooth;
        return { ...track.display, gesture: track.gesture, vx: track.vx, pinch };
      });
      this.onHands(hands);
      try { this.segment(now); } catch { this.masking = false; this.cutoutReady = false; }
    } catch {
      this.dispose();
      this.onFailure();
    }
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    this.detector?.close();
    this.detector = undefined;
    this.segmenter?.close();
    this.segmenter = undefined;
    this.stream?.getTracks().forEach(track => track.stop());
    this.video.srcObject = null;
    this.onHands([]);
  }
}
