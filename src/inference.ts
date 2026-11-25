import * as ort from 'onnxruntime-web/wasm';
import { FEATURE_COUNT, WINDOW, measure } from './gesture-features';
import { gestures, type Frame } from './types';

const base = import.meta.env.BASE_URL;
export const modelAsset = (file: string) => new URL(`${base}model/${file}`, location.href).href;
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
let ready: ReturnType<typeof load> | undefined;

async function load() {
  const session = await ort.InferenceSession.create(modelAsset('gesture.onnx'), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  return async (data: Float32Array) => {
    const tensor = new ort.Tensor('float32', data, [1, WINDOW, FEATURE_COUNT]);
    const output = await session.run({ landmarks: tensor });
    const logits = Array.from(output.logits.data as Float32Array);
    const max = Math.max(...logits), index = logits.indexOf(max);
    return { gesture: gestures[index], confidence: 1 / logits.reduce((sum, n) => sum + Math.exp(n - max), 0) };
  };
}

export const getInference = () => ready ??= load().catch(error => { ready = undefined; throw error; });

export async function benchmark() {
  const [infer, response] = await Promise.all([getInference(), fetch(modelAsset('benchmark.json'))]);
  if (!response.ok) throw new Error('The browser benchmark fixture could not be loaded.');
  const row = await response.json() as { raw: number[][][]; time: number[]; confidence: number[]; expected: number };
  const frames: Frame[] = row.raw.map((p, i) => ({ points: p.map(([x, y, z]) => ({ x, y, z })), t: row.time[i] * 1000, confidence: row.confidence[i] }));
  const input = measure(frames);
  const prediction = await infer(input);
  if (prediction.gesture !== gestures[row.expected]) throw new Error('Browser prediction diverged from the exported reference.');
  for (let i = 0; i < 9; i++) await infer(input);
  const runs: number[] = [];
  for (let i = 0; i < 80; i++) {
    const start = performance.now();
    await infer(input);
    runs.push(performance.now() - start);
    if (i % 8 === 7) await new Promise(requestAnimationFrame);
  }
  runs.sort((a, b) => a - b);
  return { runs: runs.length, median: runs[39], p95: runs[75], prediction: prediction.gesture };
}
