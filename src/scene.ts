import * as T from 'three';
import { GPUComputationRenderer, type Variable } from 'three/addons/misc/GPUComputationRenderer.js';
import { palettes, type Hand, type Memory, type Stage, type Theme } from './types';
import { silent, type AudioFeatures } from './audio';
import { backdropFragment, backdropVertex, pointFragment, pointVertex, positionShader, velocityShader } from './shaders';

const PI2 = Math.PI * 2;
const adjust = (a: number, b: number, dt: number, speed: number) => a + (b - a) * (1 - Math.exp(-dt * speed));
const randFrom = (seed: number) => () => {
  seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const svgWorld = new T.Vector3();
const size = 256;
const total = size * size;
type ParticleLayer = T.Points<T.BufferGeometry, T.ShaderMaterial>;

function starMap(rays: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 192;
  const ctx = canvas.getContext('2d')!;
  const halo = ctx.createRadialGradient(96, 96, 0, 96, 96, 96);
  for (const [x, y] of [[0, 1], [.043, .97], [.10, .4], [.22, .17], [.52, .038], [1, 0]]) halo.addColorStop(x, `rgba(255,255,255,${y})`);
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, 192, 192);
  if (rays) {
    ctx.translate(96, 96);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      const length = i % 2 ? 3.7 : i % 4 ? 51 : 69;
      ctx.lineTo(Math.sin(a) * length, Math.cos(a) * length);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,.74)';
    ctx.fill();
  }
  return new T.CanvasTexture(canvas);
}

export class DecemberScene {
  readonly renderer: T.WebGLRenderer;
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(43, 1, .1, 70);
  private targets = new Float32Array(total * 4);
  private home = new Float32Array(total * 3);
  private motion = new Float32Array(total * 3);
  private points: ParticleLayer;
  private dust: ParticleLayer;
  private backdrop: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>;
  private palace: T.Texture;
  private gpu?: GPUComputationRenderer;
  private pos?: Variable;
  private vel?: Variable;
  private restTexture?: T.DataTexture;
  private starTexture = starMap(true);
  private glowTexture = starMap(false);
  private crown: T.Sprite;
  private crownGlow: T.Sprite;
  private ornaments: { item: Memory; sprite: T.Sprite; angle: number; y: number; radius: number }[] = [];
  private formation = 1;
  private twist = 0;
  private angularVelocity = 0;
  private still = 0;
  private breath = 1;
  private clock = 0;
  private fps = 60;
  private qualityTime = 0;
  private count = total;
  private targetCount = total;
  private previewCount = total;
  private width = 0;
  private height = 0;
  private compact = false;
  private intro = true;
  stage: Stage = 'beginning';
  theme: Theme = 'Champagne';
  selected: number | null = null;
  hands: Hand[] = [];
  audio: AudioFeatures = silent;
  onFrame?: (dt: number) => void;
  private animation = 0;
  private prev = 0;
  private formationAge = 0;
  private floor: T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>;
  private beat = 0;
  private focus = 0;
  private brightness = .86;
  private warmth = 0;
  private dirty = true;
  private previousStage: Stage | undefined;
  covered = false;
  private externalPaint?: () => void;

  constructor(host: HTMLDivElement, palaceUrl: string) {
    this.renderer = new T.WebGLRenderer({ alpha: false, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    host.appendChild(this.renderer.domElement);
    this.camera.position.set(.13, .02, 8.0);
    this.camera.lookAt(0, .04, 0);
    this.camera.updateMatrixWorld();

    this.backdrop = new T.Mesh(new T.PlaneGeometry(2, 2), new T.ShaderMaterial({
      vertexShader: backdropVertex, fragmentShader: backdropFragment, depthWrite: false, depthTest: false,
      uniforms: {
        base: { value: new T.Color() }, aura: { value: new T.Color() }, focalPoint: { value: new T.Vector2(.5, .46) },
        palace: { value: null }, artAspect: { value: 0 }, viewportAspect: { value: 1 }, artStrength: { value: 0 },
      },
    }));
    this.backdrop.frustumCulled = false;
    this.palace = new T.TextureLoader().load(palaceUrl, texture => {
      const image = texture.image as HTMLImageElement;
      this.backdrop.material.uniforms.artAspect.value = image.naturalWidth / image.naturalHeight;
      this.dirty = true;
    });
    this.palace.colorSpace = T.SRGBColorSpace;
    this.backdrop.material.uniforms.palace.value = this.palace;
    this.points = this.makePoints(false);
    this.dust = this.makePoints(true);
    this.floor = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({
      map: this.glowTexture, transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: T.AdditiveBlending,
    }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -2.56;
    this.floor.renderOrder = -1;
    this.scene.add(this.backdrop, this.floor, this.dust, this.points);

    this.crownGlow = this.makeSprite(this.glowTexture, .8);
    this.crown = this.makeSprite(this.starTexture, .61);
    this.crown.position.set(0, 2.49, .08);
    this.crownGlow.position.copy(this.crown.position);

    this.initSimulation();
    this.setTheme(this.theme);
    this.previewCount = this.gpu ? (innerWidth < 700 ? 27000 : 46000) : (innerWidth < 700 ? 10500 : 18000);
    this.count = this.targetCount = Math.round(this.previewCount * .81);
    this.setDensity();
    this.animation = requestAnimationFrame(this.frame);
  }

  private makePoints(background: boolean) {
    const n = background ? 1650 : total;
    const position = new Float32Array(n * 3), glint = new Float32Array(n), kind = new Float32Array(n), uv = new Float32Array(n * 2);
    const random = randFrom(background ? 51377 : 106315);
    for (let i = 0; i < n; i++) {
      let x, y, z;
      const r = random, choice = r(), life = r();
      let type = 0;
      if (background) {
        x = (r() - .5) * 22;
        y = (r() - .5) * 12;
        z = -1.8 - r() * 9;
        if (choice < .48) {
          const a = r() * PI2, radius = .75 + r() ** 1.45 * 6;
          x = Math.cos(a) * radius;
          y = -2.58 - r() * r() * .13;
          z = Math.sin(a) * radius * .7 - 1.25;
        }
        type = 1;
      } else {
        const h = r() ** .92, cone = (1 - h) ** .94 * 1.93;
        let theta = r() * PI2, radius: number;
        y = h * 4.77 - 2.43;
        if (choice < .33) {
          const strand = Math.floor(r() * 4);
          theta = h * PI2 * (5.05 + strand * .026) + strand * .30 + (r() - .5) * (.025 + .25 * h);
          radius = cone * (1.08 + (r() - .5) * .072);
          y += (r() - .5) * (.078 + h * .034);
          type = .7;
        } else if (choice < .88) {
          const scallop = .92 + .09 * Math.sin(theta * 4. + h * 55) + .045 * Math.sin(theta * 7. - h * 27);
          radius = cone * (.14 + r() ** .40 * .90) * scallop;
          y += (r() - .5) * .155 * (1 - h);
        } else {
          radius = cone * (1.08 + r() ** 3 * .65);
          y += (r() - .5) * .38 * (1 - h);
        }
        x = Math.cos(theta) * radius;
        z = Math.sin(theta) * radius;
        if (choice > .976) { x *= .49; z *= .49; y = 2.31 + (r() - .5) * .35; }
        this.targets.set([x, y, z, life], i * 4);
        this.home.set([x, y, z], i * 3);
      }
      position.set([x, y, z], i * 3);
      kind[i] = type;
      glint[i] = background ? r() ** 1.24 : r() ** (type > .4 ? .85 : 1.5);
      uv.set([(i % size + .5) / size, (Math.floor(i / size) + .5) / size], i * 2);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(position, 3).setUsage(T.DynamicDrawUsage));
    geometry.setAttribute('particleUV', new T.BufferAttribute(uv, 2));
    geometry.setAttribute('kind', new T.BufferAttribute(kind, 1));
    geometry.setAttribute('glitter', new T.BufferAttribute(glint, 1));
    const mat = new T.ShaderMaterial({
      vertexShader: pointVertex, fragmentShader: pointFragment,
      transparent: true, depthWrite: false, depthTest: false, blending: T.AdditiveBlending,
      uniforms: {
        simulation: { value: null }, motionField: { value: null }, simulated: { value: 0 }, warmth: { value: 0 },
        viewport: { value: new T.Vector2(1, 1) }, pixelRatio: { value: 1 }, glow: { value: 1 }, density: { value: n },
        shadow: { value: new T.Color() }, ink: { value: new T.Color() }, light: { value: new T.Color() }, white: { value: new T.Color() },
      },
    });
    const points = new T.Points(geometry, mat);
    points.frustumCulled = false;
    return points;
  }

  private makeSprite(map: T.Texture, scale: number) {
    const s = new T.Sprite(new T.SpriteMaterial({ map, color: '#ffe6ba', transparent: true, depthTest: false, depthWrite: false, blending: T.AdditiveBlending }));
    s.scale.setScalar(scale);
    this.scene.add(s);
    return s;
  }

  private initSimulation() {
    if (!this.renderer.extensions.has('EXT_color_buffer_float')) return;
    const gpu = new GPUComputationRenderer(size, size, this.renderer);
    const pos = gpu.createTexture(), vel = gpu.createTexture();
    (pos.image.data as Float32Array).set(this.targets);
    const rest = gpu.createTexture();
    (rest.image.data as Float32Array).set(this.targets);
    const pv = gpu.addVariable('texturePosition', positionShader, pos);
    const vv = gpu.addVariable('textureVelocity', velocityShader, vel);
    gpu.setVariableDependencies(pv, [pv, vv]);
    gpu.setVariableDependencies(vv, [pv, vv]);
    pv.material.uniforms.dt = { value: .016 };
    Object.assign(vv.material.uniforms, {
      shape: { value: rest }, dt: { value: .016 }, clock: { value: 0 }, formation: { value: 1 }, breath: { value: 1 },
      twist: { value: 0 }, still: { value: 0 }, spread: { value: 0 }, handA: { value: new T.Vector4() }, handB: { value: new T.Vector4() },
    });
    if (gpu.init()) { gpu.dispose(); rest.dispose(); return; }
    this.gpu = gpu; this.pos = pv; this.vel = vv; this.restTexture = rest;
  }

  setTheme(theme: Theme) {
    this.theme = theme;
    const palette = palettes[theme];
    for (const layer of [this.points, this.dust]) {
      for (const token of ['ink', 'shadow', 'light', 'white'] as const) layer.material.uniforms[token].value.set(palette[token]);
    }
    this.crown.material.color.set(palette.white);
    this.crownGlow.material.color.set(palette.light);
    this.floor.material.color.set(palette.light);
    this.backdrop.material.uniforms.base.value.set(palette.background);
    this.backdrop.material.uniforms.aura.value.set(palette.aura);
    this.ornaments.forEach(o => o.sprite.material.color.set(palette.white));
    this.dirty = true;
  }

  setMemories(memories: Memory[]) {
    for (const o of this.ornaments) { this.scene.remove(o.sprite); o.sprite.material.dispose(); }
    this.ornaments = memories.map((item, i) => {
      const h = .20 + i * .124, y = h * 4.77 - 2.43;
      const sprite = this.makeSprite(this.starTexture, .38);
      sprite.material.color.set(palettes[this.theme].white);
      sprite.material.opacity = 0;
      sprite.visible = false;
      const angle = i % 2 ? .84 + i * .10 : 2.16 - i * .11;
      return { item, sprite, angle, y, radius: (1 - h) ** .94 * 1.96 };
    });
  }

  begin() {
    this.stage = 'formation';
    this.formation = 1;
    this.formationAge = 0;
    this.still = 0;
    this.selected = null;
    this.twist = 0;
    this.angularVelocity = 0;
    this.clock = 0;
    this.beat = this.focus = this.warmth = 0;
    this.brightness = .86;
    this.prev = 0;
    if (this.gpu && this.restTexture && this.pos && this.vel) {
      for (const target of [this.gpu.getCurrentRenderTarget(this.pos), this.gpu.getAlternateRenderTarget(this.pos)]) this.gpu.renderTexture(this.restTexture, target);
      for (const target of [this.gpu.getCurrentRenderTarget(this.vel), this.gpu.getAlternateRenderTarget(this.vel)]) this.gpu.renderTexture(this.vel.initialValueTexture, target);
      this.points.material.uniforms.simulated.value = 1;
    } else this.resetCpu();
  }

  layout(width: number, height: number, intro = this.intro) {
    width = Math.max(1, Math.round(width));
    height = Math.max(1, Math.round(height));
    this.width = width;
    this.height = height;
    this.intro = intro;
    this.compact = intro && this.width < 460;
    const yShift = intro ? this.height * .049 : this.width < this.height ? -this.height * .055 : 0;
    this.camera.aspect = this.width / this.height;
    const fit = Math.atan(Math.tan(43 * Math.PI / 360) * Math.max(1, .75 / this.camera.aspect)) * 360 / Math.PI;
    this.camera.fov = intro ? Math.max(62.5, fit) : fit;
    this.camera.setViewOffset(this.width, this.height, 0, -yShift, this.width, this.height);
    this.camera.updateProjectionMatrix();
    this.backdrop.material.uniforms.focalPoint.value.set(.5, .52 - yShift / this.height);
    this.backdrop.material.uniforms.viewportAspect.value = this.camera.aspect;
    this.backdrop.material.uniforms.artStrength.value = intro ? .94 : .44;
    this.dirty = true;
  }

  setComposite(paint?: () => void) { this.externalPaint = paint; }

  toWorld(x: number, y: number) {
    const ndc = new T.Vector3(x * 2 - 1, 1 - y * 2, .4).unproject(this.camera);
    ndc.sub(this.camera.position).normalize();
    return ndc.multiplyScalar(-this.camera.position.z / ndc.z).add(this.camera.position);
  }

  markers() {
    return this.ornaments.filter(o => o.sprite.visible).map(({ item, sprite }) => {
      const p = svgWorld.copy(sprite.position).project(this.camera);
      return { item, x: (p.x + 1) * .5, y: (1 - p.y) * .5 };
    });
  }

  nearest(x: number, y: number, radius = 72) {
    const within = this.markers().map(o => ({ ...o, distance: Math.hypot((o.x - x) * this.width, (o.y - y) * this.height) })).sort((a, b) => a.distance - b.distance);
    return within[0]?.distance < radius ? within[0].item : undefined;
  }

  private stepCpu(dt: number, phase: number, spread: number, forces: T.Vector4[]) {
    const attr = this.points.geometry.getAttribute('position') as T.BufferAttribute;
    const a = attr.array as Float32Array;
    const turn = this.twist + phase * .09;
    const rX = Math.cos(turn), rZ = Math.sin(turn);
    for (let i = 0; i < this.count; i++) {
      const p = i * 3, seed = this.targets[i * 4 + 3];
      const x = a[p], y = a[p + 1], z = a[p + 2], f = this.formation;
      const tx = (this.home[p] * rX + this.home[p + 2] * rZ) * this.breath;
      const tz = (this.home[p + 2] * rX - this.home[p] * rZ) * this.breath;
      const scatter = .3 + .75 * ((seed * 162) % 1);
      const scale = 2.35 + f * 3.45;
      const c = (1 - this.still) * (.36 + spread * .9);
      let fx = ((tx - x) * f + (Math.sin(seed * 231 + phase * .25) * 3.8 * scatter - x) * (1 - f)) * scale + c * (Math.cos(y * 1.8) + Math.sin(z * 1.8)) - z * .3 * (1 - this.still);
      let fy = ((this.home[p + 1] - y) * f + (Math.cos(seed * 125) * 2.55 * scatter - y) * (1 - f)) * scale + c * (Math.cos(z * 1.8) + Math.sin(x * 1.8));
      let fz = ((tz - z) * f + (Math.sin(seed * 381) * 2.35 * scatter - z) * (1 - f)) * scale + c * (Math.cos(x * 1.8) + Math.sin(y * 1.8)) + x * .3 * (1 - this.still);
      for (const hand of forces) {
        const dx = hand.x - x, dy = hand.y - y, dz = hand.z - z, pull = hand.w * 9 * Math.exp(-.60 * (dx * dx + dy * dy + dz * dz));
        fx += dx * pull * (1 - this.still); fy += dy * pull * (1 - this.still); fz += dz * pull * (1 - this.still);
      }
      const inertia = dt / (.6 + seed * .9), damping = Math.exp(-dt * (2.7 + this.still * 2.5));
      this.motion[p] = (this.motion[p] + fx * inertia) * damping;
      this.motion[p + 1] = (this.motion[p + 1] + fy * inertia) * damping;
      this.motion[p + 2] = (this.motion[p + 2] + fz * inertia) * damping;
      a[p] += this.motion[p] * dt;
      a[p + 1] += this.motion[p + 1] * dt;
      a[p + 2] += this.motion[p + 2] * dt;
    }
    attr.needsUpdate = true;
  }

  private resetCpu() {
    const attr = this.points.geometry.getAttribute('position') as T.BufferAttribute;
    (attr.array as Float32Array).set(this.home);
    attr.needsUpdate = true;
    this.motion.fill(0);
  }

  private setDensity(count = this.count) {
    this.points.geometry.setDrawRange(0, Math.ceil(count));
    this.points.material.uniforms.density.value = count;
  }

  private draw(scale = this.renderer.getPixelRatio()) {
    const deviceScale = this.renderer.getPixelRatio();
    const canvas = this.renderer.domElement;
    // Resize and repaint together so a cleared buffer can't reach the page.
    if (canvas.width !== Math.floor(this.width * deviceScale) || canvas.height !== Math.floor(this.height * deviceScale)) {
      this.renderer.setSize(this.width, this.height, false);
    }
    const { width, height } = this.renderer.domElement;
    for (const mesh of [this.points, this.dust]) {
      mesh.material.uniforms.viewport.value.set(width, height);
      mesh.material.uniforms.pixelRatio.value = scale;
    }
    this.renderer.render(this.scene, this.camera);
    this.dirty = false;
  }

  private drawPreview() {
    if (!this.gpu) this.resetCpu();
    this.setDensity(this.compact ? Math.min(this.previewCount, 19500) : this.previewCount);
    this.camera.position.set(.13, .02, 8);
    this.camera.lookAt(0, .04, 0);
    this.points.material.uniforms.simulated.value = 0;
    this.points.material.uniforms.glow.value = this.compact ? .71 : .89;
    this.points.material.uniforms.warmth.value = 0;
    this.dust.material.uniforms.glow.value = .95;
    this.floor.material.opacity = .16;
    this.floor.scale.set(6.2, 3.4, 1);
    this.crown.material.opacity = .86;
    this.crownGlow.material.opacity = .29;
    this.crownGlow.scale.setScalar(1.46);
    this.draw();
  }

  private frame = (now: number) => {
    this.animation = requestAnimationFrame(this.frame);
    const raw = this.prev ? (now - this.prev) / 1000 : .016;
    const dt = Math.min(.042, raw);
    const realStep = Math.min(.18, raw);
    this.prev = now;
    this.onFrame?.(realStep);
    if (this.previousStage !== this.stage) {
      this.dirty = true;
      this.previousStage = this.stage;
    }
    if (this.stage === 'beginning') {
      if (this.dirty) this.drawPreview();
      return;
    }
    // Keep the soundtrack clock running under the dialog. The artwork holds
    // its frame unless recording needs an uninterrupted capture.
    if (this.covered && !this.externalPaint && !this.dirty) return;
    if (this.stage === 'ending' && this.still >= .997 && !this.externalPaint && !this.dirty) return;
    this.fps = adjust(this.fps, 1 / Math.max(.005, raw), realStep, 1.7);
    this.qualityTime += realStep;
    if (this.qualityTime > 2.8) {
      if (this.fps < 34) this.targetCount = Math.max(6500, Math.floor(this.targetCount * .8));
      else if (this.fps > 54 && this.gpu) this.targetCount = Math.min(this.previewCount, this.targetCount + 3200);
      this.qualityTime = 0;
    }
    this.count = adjust(this.count, this.targetCount, realStep, .8);
    this.setDensity();
    if (this.stage === 'formation') this.formationAge += realStep;
    const active = this.stage === 'formation' || this.stage === 'memories';
    const end = this.stage === 'ending';
    this.still = adjust(this.still, end ? 1 : 0, dt, end ? .87 : 2);
    this.clock += dt * (1 - this.still);
    this.camera.position.x = .13 + Math.sin(this.clock * .13) * .29;
    this.camera.position.y = .02 + Math.sin(this.clock * .11) * .095;
    this.camera.lookAt(0, .04, 0);
    this.camera.updateMatrixWorld();
    const formationTarget = this.stage === 'formation' ? Math.min(1, .26 + Math.max(0, this.formationAge - 1.0) * .15) : 1;
    this.formation = adjust(this.formation, formationTarget, dt, 1.65);
    const hands = active ? this.hands : [];
    const pair = hands.length === 2 ? Math.hypot((hands[0].x - hands[1].x) * 1.25, hands[0].y - hands[1].y) : .52;
    const open = hands.some(hand => hand.gesture === 'Open Palm');
    const spread = (open ? .41 : 0) + (active ? Math.max(0, this.audio.trend) * .8 + this.audio.rms * .3 : 0);
    const bass = active ? this.audio.bass : 0;
    const breath = 1 + (pair - .52) * .49 + bass * .11 + (open ? .075 : 0);
    this.breath = adjust(this.breath, breath, dt, 2.05);
    this.angularVelocity *= Math.exp(-dt * 1.7);
    for (const hand of hands) if (hand.gesture === 'Swipe') this.angularVelocity += Math.max(-2, Math.min(2, hand.vx * .8)) * dt * 3.3;
    this.twist += this.angularVelocity * dt * (1 - this.still);
    const forces = hands.map(hand => {
      const p = this.toWorld(hand.x, hand.y);
      const force = hand.gesture === 'Closed Fist' ? 1.06 : hand.gesture === 'Open Palm' ? -.49 : .19;
      return new T.Vector4(p.x, p.y, Math.max(-.5, Math.min(.5, -hand.z * 2)), force);
    });
    if (this.still < .997) {
      if (this.gpu && this.vel && this.pos) {
        const u = this.vel.material.uniforms;
        u.dt.value = this.pos.material.uniforms.dt.value = dt;
        u.clock.value = this.clock;
        u.formation.value = this.formation;
        u.breath.value = this.breath;
        u.twist.value = this.twist;
        u.still.value = this.still;
        u.spread.value = spread;
        u.handA.value.copy(forces[0] ?? new T.Vector4());
        u.handB.value.copy(forces[1] ?? new T.Vector4());
        this.gpu.compute();
        this.points.material.uniforms.simulation.value = this.gpu.getCurrentRenderTarget(this.pos).texture;
        this.points.material.uniforms.motionField.value = this.gpu.getCurrentRenderTarget(this.vel).texture;
      } else this.stepCpu(dt, this.clock, spread, forces);
    }
    const orbit = this.twist * .6 + Math.sin(this.clock * .21) * .075;
    this.beat = adjust(this.beat, active ? this.audio.wave : 0, dt, 2.25);
    this.focus = adjust(this.focus, this.selected === null ? 0 : 1, dt, 3);
    this.brightness = adjust(this.brightness, .86 + (active ? this.audio.rms * .13 + this.audio.mid * .055 : 0) + Math.max(0, .52 - pair) * .2, dt, 2.4);
    this.warmth = adjust(this.warmth, active ? Math.min(1, this.audio.treble * .8 + this.audio.centroid / 16000) : 0, dt, 1.85);
    const dim = 1 - .38 * this.focus;
    this.floor.material.opacity = (.16 + .11 * this.beat) * dim;
    this.floor.scale.set(6.2 + this.beat * 1.2, 3.4 + this.beat * .52, 1);
    this.points.material.uniforms.glow.value = (.77 + .23 * this.formation) * this.brightness * dim;
    this.points.material.uniforms.warmth.value = this.warmth;
    this.dust.material.uniforms.glow.value = .95 * dim;
    this.crown.material.opacity = (.50 + this.formation * .36 + this.still * .11) * (1 - .27 * this.focus);
    this.crownGlow.scale.setScalar(1.42 + this.still * .29 + bass * .09);
    this.crownGlow.material.opacity = this.crown.material.opacity * .34;
    for (const ornament of this.ornaments) {
      const a = ornament.angle + orbit;
      ornament.sprite.position.set(Math.cos(a) * ornament.radius * this.breath, ornament.y, Math.sin(a) * ornament.radius + .14);
      const isSelected = this.selected === ornament.item.id;
      const targetOpacity = this.stage === 'memories' ? (isSelected ? .97 : .74 - this.focus * .39) : 0;
      ornament.sprite.material.opacity = adjust(ornament.sprite.material.opacity, targetOpacity, dt, 4.2);
      ornament.sprite.visible = this.stage === 'memories' || ornament.sprite.material.opacity > .01;
      ornament.sprite.scale.setScalar(adjust(ornament.sprite.scale.x, isSelected ? .63 : .40, dt, 3.5));
    }
    this.draw();
    this.externalPaint?.();
  };

  snapshot(width: number, height: number, paint: (canvas: HTMLCanvasElement) => void) {
    const restore = [this.width, this.height, this.intro] as const;
    const pixel = this.renderer.getPixelRatio();
    try {
      this.renderer.setPixelRatio(1);
      this.layout(width, height, false);
      this.draw(Math.max(1, height / 900));
      paint(this.renderer.domElement);
    } finally {
      this.renderer.setPixelRatio(pixel);
      this.layout(...restore);
      this.draw();
    }
  }

  dispose() {
    cancelAnimationFrame(this.animation);
    this.scene.traverse(obj => {
      if (obj instanceof T.Mesh || obj instanceof T.Points) { obj.geometry.dispose(); obj.material.dispose(); }
      if (obj instanceof T.Sprite) obj.material.dispose();
    });
    this.starTexture.dispose();
    this.glowTexture.dispose();
    this.palace.dispose();
    this.restTexture?.dispose();
    this.gpu?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
