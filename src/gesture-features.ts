import type { Frame, Point } from './types';
import { gestures } from './types';

export const WINDOW = 32;
export const FEATURE_COUNT = 17;
export const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const palm = (p: Point[]): Point => [0, 5, 9, 13, 17].reduce((acc, i) => ({ x: acc.x + p[i].x / 5, y: acc.y + p[i].y / 5, z: acc.z + p[i].z / 5 }), { x: 0, y: 0, z: 0 });
const norm = (p: Point) => Math.hypot(p.x, p.y, p.z);
const joints = [[1, 2, 3], [5, 6, 7], [9, 10, 11], [13, 14, 15], [17, 18, 19]];
const origin = { x: 0, y: 0, z: 0 };
function angle(a: Point, b: Point, c: Point) {
  const u = subtract(a, b), v = subtract(c, b);
  return Math.acos(clamp((u.x * v.x + u.y * v.y + u.z * v.z) / Math.max(.000001, norm(u) * norm(v)), -1, 1)) / Math.PI;
}

export function measure(frames: Frame[]) {
  let prevV = origin;
  let prevPalm = palm(frames[0].points);
  let prevTime = frames[0].t;
  const data = new Float32Array(frames.length * FEATURE_COUNT);
  frames.forEach(({ points: p, t, confidence }, i) => {
    const scale = Math.max(.022, distance(p[0], p[9]));
    const d = (a: number, b: number) => clamp(distance(p[a], p[b]) / scale, 0, 3);
    const u = subtract(p[5], p[0]), v = subtract(p[17], p[0]);
    const normal = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x };
    const facing = Math.abs(normal.z) / Math.max(.000001, norm(normal));
    const center = palm(p);
    const delta = 30 * clamp((t - prevTime) / 1000, .012, .10) * scale;
    const velocity = { x: clamp((center.x - prevPalm.x) / delta, -2, 2), y: clamp((center.y - prevPalm.y) / delta, -2, 2), z: clamp((center.z - prevPalm.z) / delta, -2, 2) };
    const acceleration = clamp(distance(velocity, prevV), 0, 2);
    data.set([d(4, 8), ...[8, 12, 16, 20].map(i => d(0, i)), ...joints.map(([a, b, c]) => angle(p[a], p[b], p[c])), facing, velocity.x, velocity.y, velocity.z, acceleration, confidence, d(8, 20)], i * FEATURE_COUNT);
    prevV = velocity;
    prevPalm = center;
    prevTime = t;
  });
  return data;
}

export function baseline(data: Float32Array) {
  const count = data.length / FEATURE_COUNT;
  const feature = (i: number, j: number) => data[i * FEATURE_COUNT + j];
  let dx = 0, dy = 0, peak = 0;
  for (let i = Math.max(0, count - 20); i < count; i++) {
    dx += feature(i, 11);
    dy += feature(i, 12);
    peak = Math.max(peak, Math.abs(feature(i, 11)));
  }
  if (Math.abs(dx) > 2.65 && Math.abs(dx) > Math.abs(dy) * 1.5 && peak > .28) return gestures[3];
  const median = (column: number) => {
    const values = Array.from({ length: Math.min(5, count) }, (_, i) => feature(count - 1 - i, column)).sort((a, b) => a - b);
    return (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2;
  };
  const extension = [1, 2, 3, 4].map(median), joints = [6, 7, 8, 9].map(median);
  if (median(0) < .36) return gestures[2];
  if (extension.filter(v => v < 1.42).length >= 3 && joints.filter(v => v < .72).length >= 2) return gestures[1];
  if (extension.filter(v => v > 1.48).length >= 3 && joints.filter(v => v > .78).length >= 3) return gestures[0];
  return gestures[4];
}
