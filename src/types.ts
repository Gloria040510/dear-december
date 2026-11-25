export const gestures = ['Open Palm', 'Closed Fist', 'Pinch', 'Swipe', 'Idle'] as const;
export type Gesture = typeof gestures[number];
export type Stage = 'beginning' | 'formation' | 'memories' | 'ending';
export type Mode = 'pointer' | 'camera' | 'demo';
export type Point = { x: number; y: number; z: number };
export type Hand = Point & { gesture: Gesture; vx: number; pinch: boolean };
export type Frame = { points: Point[]; t: number; confidence: number };
export type Memory = { id: number; text: string };
export type Lens = 'auto' | 'portrait' | 'landscape';
export const palettes = {
  Champagne: { background: '#0b100e', shadow: '#79572f', ink: '#bd854c', light: '#f3c684', white: '#fff1ce' },
  Winter: { background: '#080e18', shadow: '#325777', ink: '#739bc9', light: '#bbdff7', white: '#effaff' },
  Forest: { background: '#081512', shadow: '#416149', ink: '#a47546', light: '#d8b578', white: '#fff0cb' },
};
export type Theme = keyof typeof palettes;
