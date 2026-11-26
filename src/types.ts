export const gestures = ['Open Palm', 'Closed Fist', 'Pinch', 'Swipe', 'Idle'] as const;
export type Gesture = typeof gestures[number];
export type Stage = 'beginning' | 'formation' | 'memories' | 'ending';
export type Mode = 'pointer' | 'camera' | 'demo';
export type Point = { x: number; y: number; z: number };
export type Hand = Point & { gesture: Gesture; vx: number; pinch: boolean };
export type Frame = { points: Point[]; t: number; confidence: number };
export type Memory = { id: number } & ({ text: string } | { example: true });
export type CameraModel = 'opening' | 'cnn' | 'geometry';
export type Lens = 'auto' | 'portrait' | 'landscape';
export const palettes = {
  Champagne: { background: '#0a120f', aura: '#25382d', shadow: '#7e6138', ink: '#bc915d', light: '#eed0a1', white: '#fff1d5' },
  Winter: { background: '#0a111b', aura: '#203345', shadow: '#3b5975', ink: '#7b9fbe', light: '#badcf0', white: '#edf8ff' },
  Forest: { background: '#081511', aura: '#233b2e', shadow: '#4c674e', ink: '#a37b50', light: '#d8b985', white: '#fff0ce' },
};
export type Theme = keyof typeof palettes;
