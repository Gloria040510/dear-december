export type AudioFeatures = { bass: number; mid: number; treble: number; rms: number; centroid: number; flux: number; wave: number; bpm: number; trend: number };
export const silent: AudioFeatures = { bass: 0, mid: 0, treble: 0, rms: 0, centroid: 0, flux: 0, wave: 0, bpm: 0, trend: 0 };

export class PerformanceAudio {
  private ctx: AudioContext;
  private analyser: AnalyserNode;
  private bins: Float32Array<ArrayBuffer>;
  private samples: Float32Array<ArrayBuffer>;
  private previous: Float32Array<ArrayBuffer>;
  private features = { ...silent };
  private lastOnset = 0;
  private intervals: number[] = [];
  private meanFlux = .025;
  private slowRms = 0;
  private source?: AudioBufferSourceNode;
  private gain: GainNode;
  private startAt = 0;
  private offset = 0;
  duration = 82;
  readonly capture: MediaStreamAudioDestinationNode;
  onEnd?: () => void;
  playing = false;
  private buffer?: AudioBuffer;

  constructor() {
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = .42;
    this.gain = this.ctx.createGain();
    this.gain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.capture = this.ctx.createMediaStreamDestination();
    this.analyser.connect(this.capture);
    this.bins = new Float32Array(this.analyser.frequencyBinCount);
    this.previous = new Float32Array(this.bins.length);
    this.samples = new Float32Array(this.analyser.fftSize);
  }

  async load(file?: File) {
    await this.ctx.resume();
    if (file) this.buffer = await this.ctx.decodeAudioData(await file.arrayBuffer());
    if (this.buffer) this.duration = this.buffer.duration;
    this.gain.gain.value = file ? .73 : .66;
  }

  private ambient() {
    const rate = 22050;
    const buffer = this.ctx.createBuffer(2, Math.floor(rate * this.duration), rate);
    const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    const chords = [[48, 55, 59, 62], [45, 52, 55, 59], [41, 48, 52, 55], [43, 50, 57, 62]];
    const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
    const add = (start: number, span: number, midi: number, volume: number, pan: number, bell = false) => {
      const w = hz(midi) * Math.PI * 2 / rate;
      const from = Math.round(start * rate), size = Math.min(Math.round(span * rate), left.length - from);
      const a = Math.sqrt((1 - pan) / 2), b = Math.sqrt((1 + pan) / 2);
      for (let i = 0; i < size; i++) {
        const t = i / rate;
        const shape = bell ? Math.min(1, t * 250) * Math.exp(-t * 1.4) * Math.min(1, (span - t) * 4) : Math.sin(Math.PI * t / span) ** 1.45;
        const wave = Math.sin(i * w) + (bell ? .37 * Math.sin(i * w * 2.003) + .17 * Math.sin(i * w * 3.97) : .17 * Math.sin(i * w * 2 + Math.sin(t * 4)) + .14 * Math.sin(i * w * 1.003));
        const sample = wave * shape * volume * Math.min(1, (left.length - from - i) / (rate * 4));
        left[from + i] += sample * a;
        right[from + i] += sample * b;
      }
    };
    for (let section = 0; section < 11; section++) {
      const time = section * 7.5, chord = chords[section % 4];
      chord.forEach((m, i) => add(time + i * .34, 11.7, m, i === 0 ? .10 : .043, -.46 + i * .30));
      for (let note = 0; note < 6; note++) {
        const index = [2, 0, 3, 1, 2, 3][(note + section) % 6];
        const start = time + .95 + note * .93;
        const pitch = chord[index] + (note % 3 === 2 ? 24 : 12);
        add(start, 3.4, pitch, .043 + .011 * Math.sin(note * 13 + section), note % 2 ? .48 : -.48, true);
        add(start + .38, 2.5, pitch, .012, note % 2 ? -.64 : .64, true);
      }
    }
    return buffer;
  }

  play() {
    if (this.playing || this.offset >= this.duration) return;
    this.buffer ??= this.ambient();
    void this.ctx.resume();
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.gain);
    source.start(0, this.offset);
    this.source = source;
    this.startAt = this.ctx.currentTime;
    this.playing = true;
    source.onended = () => {
      if (this.source !== source) return;
      source.disconnect();
      this.source = undefined;
      this.offset = this.duration;
      this.playing = false;
      this.onEnd?.();
    };
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.time;
    const source = this.source;
    this.source = undefined;
    source?.stop();
    source?.disconnect();
    this.playing = false;
  }

  get time() {
    return Math.min(this.duration, this.offset + (this.playing ? this.ctx.currentTime - this.startAt : 0));
  }

  sample(dt: number) {
    this.analyser.getFloatFrequencyData(this.bins);
    this.analyser.getFloatTimeDomainData(this.samples);
    let bass = 0, mid = 0, treble = 0, magnitude = 0, weighted = 0, flux = 0, energy = 0;
    let nBass = 0, nMid = 0, nTreble = 0;
    for (let i = 1; i < this.bins.length; i++) {
      const f = i * this.ctx.sampleRate / this.analyser.fftSize;
      if (f > 11000) break;
      const amp = 10 ** (this.bins[i] / 20);
      if (f < 260) { bass += amp; nBass++; }
      else if (f < 2300) { mid += amp; nMid++; }
      else { treble += amp; nTreble++; }
      magnitude += amp; weighted += amp * f;
      flux += Math.max(0, amp - this.previous[i]);
      this.previous[i] = amp;
    }
    for (const value of this.samples) energy += value * value;
    const rms = Math.sqrt(energy / this.samples.length);
    const now = this.ctx.currentTime;
    this.meanFlux += (flux - this.meanFlux) * .026;
    this.features.wave *= Math.exp(-dt * 3.1);
    if (this.playing && flux > Math.max(.022, this.meanFlux * 2.65) && now - this.lastOnset > .26) {
      const interval = now - this.lastOnset;
      if (interval < 1.3 && this.lastOnset) {
        this.intervals.push(interval);
        if (this.intervals.length > 12) this.intervals.shift();
        const sorted = [...this.intervals].sort((a, b) => a - b);
        if (sorted.length >= 4) this.features.bpm = Math.round(60 / sorted[Math.floor(sorted.length / 2)]);
      }
      this.lastOnset = now;
      this.features.wave = Math.min(.72, flux * 2.4);
    }
    this.slowRms += (rms - this.slowRms) * (1 - Math.exp(-dt * .55));
    const targets = { bass: Math.min(1, bass * 28 / nBass), mid: Math.min(1, mid * 125 / nMid), treble: Math.min(1, treble * 440 / nTreble), rms: Math.min(1, rms * 8), centroid: magnitude ? weighted / magnitude : 0, flux, trend: Math.max(-1, Math.min(1, (rms - this.slowRms) * 13)) };
    const mix = 1 - Math.exp(-dt * 4);
    for (const key of Object.keys(targets) as (keyof typeof targets)[]) this.features[key] += (targets[key] - this.features[key]) * mix;
    return this.features;
  }

  dispose() {
    this.pause();
    this.capture.stream.getTracks().forEach(track => track.stop());
    void this.ctx.close();
  }
}
