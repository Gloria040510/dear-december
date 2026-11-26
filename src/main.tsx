import { Suspense, lazy, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/cormorant-garamond';
import '@fontsource-variable/cormorant-garamond/wght-italic.css';
import '@fontsource-variable/inter';
import './style.css';
import { PerformanceAudio } from './audio';
import { DecemberScene } from './scene';
import { dimensions, download, makeRecording, paintComposition, supportedFormats } from './export';
import { Icon } from './icons';
import { brand, initialLanguage, languages, memoryText, otherLanguage, rememberLanguage, words, type Language, type Notice } from './words';
import { palettes, type CameraModel, type Hand, type Lens, type Memory, type Mode, type Stage, type Theme } from './types';
import type { CameraHands } from './vision';

const Lab = lazy(() => import('./Lab'));
const themeNames = Object.keys(palettes) as Theme[];
const modes: { id: Mode; icon: string }[] = [
  { id: 'pointer', icon: 'pointer' },
  { id: 'camera', icon: 'camera' },
  { id: 'demo', icon: 'play' },
];
const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
const lengthLabel = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const dateStamp = () => new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
type Recorder = ReturnType<typeof makeRecording>;
type Dialog = 'guide' | 'lab' | 'creator' | null;

function App() {
  const [language, setLanguage] = useState(initialLanguage);
  const t = words[language];
  const secondaryLanguage = otherLanguage[language];
  const [theme, setTheme] = useState<Theme>('Champagne');
  const [stage, setStage] = useState<Stage>('beginning');
  const [mode, setMode] = useState<Mode>('pointer');
  const [entries, setEntries] = useState<string[]>(['']);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [file, setFile] = useState<File>();
  const [selection, setSelection] = useState<Memory>();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [themeOpen, setThemeOpen] = useState(false);
  const [cinematic, setCinematic] = useState(false);
  const [lens, setLens] = useState<Lens>('auto');
  const [status, setStatus] = useState<Notice | null>(null);
  const [rendererError, setRendererError] = useState(false);
  const [working, setWorking] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(82);
  const [playing, setPlaying] = useState(false);
  const [modelStatus, setModelStatus] = useState<CameraModel | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [corner, setCorner] = useState<typeof corners[number]>('bottom-right');
  const [cutout, setCutout] = useState(false);
  const [cutoutLoading, setCutoutLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [videoFormats] = useState(supportedFormats);
  const [format, setFormat] = useState(() => videoFormats[0]?.mime ?? '');
  const view = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const viewCamera = useRef<HTMLCanvasElement>(null);
  const scene = useRef<DecemberScene | undefined>(undefined);
  const soundtrack = useRef<PerformanceAudio | undefined>(undefined);
  const camera = useRef<CameraHands | undefined>(undefined);
  const recorder = useRef<Recorder | undefined>(undefined);
  const markerEls = useRef(new Map<number, HTMLButtonElement>());
  const cursorEls = useRef<HTMLSpanElement[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const sceneStage = useRef<Stage>('beginning');
  const elapsed = useRef(0);
  const active = useRef(false);
  const selectedUntil = useRef(0);
  const lastDemo = useRef(0);
  const lastClockDisplay = useRef(-1);
  const statusTimer = useRef(0);
  const cameraVersion = useRef(0);
  const pointer = useRef<{ last: number; pressed: boolean; hand?: Hand }>({ last: 0, pressed: false });
  const current = useRef({ language, theme, mode, lens, stage, selection, showCamera, cutout, corner, memories });
  current.current = { language, theme, mode, lens, stage, selection, showCamera, cutout, corner, memories };
  const isIntro = stage === 'beginning';
  const isEnd = stage === 'ending';

  function chooseLanguage(next: Language) {
    setLanguage(next);
    rememberLanguage(next);
  }

  function inform(message: Notice | null = null, clear = false) {
    window.clearTimeout(statusTimer.current);
    setStatus(message);
    if (clear) statusTimer.current = window.setTimeout(() => setStatus(null), 5400);
  }

  function transition(next: Stage) {
    sceneStage.current = next;
    if (scene.current) scene.current.stage = next;
    setStage(next);
  }

  function recall(item: Memory) {
    if (sceneStage.current !== 'memories' || !scene.current) return;
    scene.current.selected = item.id;
    setSelection(item);
    selectedUntil.current = elapsed.current + Math.min(10, 3.5 + memoryText(item, current.current.language).length * .041);
  }

  function clearMemory() {
    if (scene.current) scene.current.selected = null;
    setSelection(undefined);
    selectedUntil.current = 0;
  }

  function finish() {
    if (sceneStage.current === 'beginning' || sceneStage.current === 'ending') return;
    clearMemory();
    soundtrack.current?.pause();
    setPlaying(false);
    transition('ending');
    setDialog(null);
  }

  function closeCamera() {
    cameraVersion.current++;
    camera.current?.dispose();
    camera.current = undefined;
    setCameraReady(false);
    setCutout(false);
    setCutoutLoading(false);
    setModelStatus(null);
    if (scene.current) scene.current.hands = [];
  }

  function fallbackCamera() {
    closeCamera();
    setMode('pointer');
    inform('cameraFallback', true);
  }

  async function enableCamera() {
    const id = ++cameraVersion.current;
    setModelStatus('opening');
    try {
      const { CameraHands } = await import('./vision');
      if (id !== cameraVersion.current) return;
      const engine = new CameraHands(hands => {
        if (!scene.current || id !== cameraVersion.current) return;
        scene.current.hands = hands;
        for (const hand of hands) {
          if (!hand.pinch) continue;
          const item = scene.current.nearest(hand.x, hand.y, 84);
          if (item) recall(item);
        }
      }, setModelStatus, fallbackCamera);
      camera.current = engine;
      await engine.start();
      if (id === cameraVersion.current) { setCameraReady(true); setModelStatus(v => v === 'opening' ? 'geometry' : v); }
    } catch { if (id === cameraVersion.current) fallbackCamera(); }
  }

  function selectInput(next: Mode) {
    if (next === mode) return;
    closeCamera();
    setMode(next);
    if (next === 'camera' && !isIntro) void enableCamera();
  }

  const fullscreen = async (toggle: boolean) => {
    try {
      if (document.fullscreenElement && toggle) await document.exitFullscreen();
      else if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    } catch { /* The fixed stage remains usable without the browser fullscreen API. */ }
  };

  async function begin(demo = false) {
    if (active.current || !scene.current) return;
    active.current = true;
    const input = demo ? 'demo' : mode;
    const list = entries.map((text, id) => ({ id, text: text.trim() })).filter(item => item.text);
    const set: Memory[] = list.length || input !== 'demo' ? list : t.examples.map((_, id) => ({ id, example: true }));
    setWorking(true);
    setThemeOpen(false);
    inform();
    let audio: PerformanceAudio | undefined;
    let enterFullscreen: Promise<void> | undefined;
    try {
      audio = new PerformanceAudio();
      const loaded = audio.load(file);
      if (!document.fullscreenElement) enterFullscreen = fullscreen(false);
      await loaded;
      soundtrack.current = audio;
      audio.onEnd = finish;
      setDuration(audio.duration);
      audio.play();
      setPlaying(true);
    } catch {
      audio?.dispose();
      if (enterFullscreen) void enterFullscreen.then(() => {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      });
      soundtrack.current = undefined;
      active.current = false;
      setWorking(false);
      inform(file ? 'audioFile' : 'audioStart');
      return;
    }
    setMode(input);
    if (input === 'camera') void enableCamera();
    setTime(0);
    setMemories(set);
    clearMemory();
    elapsed.current = lastDemo.current = 0;
    lastClockDisplay.current = -1;
    scene.current.setMemories(set);
    scene.current.begin();
    transition('formation');
    setWorking(false);
  }

  function returnHome() {
    stopRecording();
    closeCamera();
    soundtrack.current?.dispose();
    soundtrack.current = undefined;
    active.current = false;
    pointer.current = { last: 0, pressed: false };
    clearMemory();
    setDialog(null);
    setCinematic(false);
    if (mode === 'demo') setMode('pointer');
    setLens('auto');
    setPlaying(false);
    setTime(0);
    scene.current?.setMemories([]);
    transition('beginning');
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }

  function composition() {
    const v = current.current;
    const source = v.showCamera && camera.current?.video.readyState && camera.current.video.readyState >= 2 ? camera.current : undefined;
    const useCutout = Boolean(v.cutout && source?.cutoutReady);
    return { language: v.language, theme: v.theme, stage: sceneStage.current, memory: v.selection && memoryText(v.selection, v.language), camera: useCutout ? source?.cutout : source?.video, cutout: useCutout, corner: v.corner };
  }

  function poster() {
    const engine = scene.current, bounds = art.current?.getBoundingClientRect();
    if (!engine || !bounds) return;
    const [w, h] = dimensions(lens, true, bounds.width / bounds.height);
    const output = document.createElement('canvas');
    output.width = w;
    output.height = h;
    const ctx = output.getContext('2d', { alpha: false })!;
    try {
      engine.snapshot(w, h, gl => paintComposition(ctx, gl, composition()));
      output.toBlob(blob => {
        if (blob) { download(blob, `dear-december-${dateStamp()}.png`); inform('posterSaved', true); }
        else inform('posterFailed', true);
      }, 'image/png');
    } catch { inform('posterUnavailable', true); }
  }

  function startRecording() {
    const engine = scene.current, bounds = art.current?.getBoundingClientRect();
    if (!engine || !bounds || recorder.current) return;
    const choice = videoFormats.find(f => f.mime === format);
    if (!choice) { inform('videoUnavailable', true); return; }
    const [w, h] = dimensions(lens, false, bounds.width / bounds.height);
    try {
      const process = makeRecording(w, h, choice, soundtrack.current?.capture.stream.getAudioTracks()[0], blob => {
        if (blob) { download(blob, `dear-december-${dateStamp()}.${choice.ext}`); inform('recordingSaved', true); }
        else inform('recordingFailed', true);
      });
      recorder.current = process;
      paintComposition(process.ctx, engine.renderer.domElement, composition());
      engine.setComposite(() => paintComposition(process.ctx, engine.renderer.domElement, composition()));
      setRecording(true);
      setDialog(null);
    } catch { inform('recordingStart', true); }
  }

  function stopRecording() {
    scene.current?.setComposite();
    recorder.current?.stop();
    recorder.current = undefined;
    setRecording(false);
  }

  async function changeMatte(enabled: boolean) {
    const engine = camera.current;
    if (!engine) return;
    setCutout(enabled);
    setCutoutLoading(enabled);
    try { await engine.setCutout(enabled); }
    catch {
      if (engine === camera.current) {
        setCutout(false);
        inform('backgroundFailed', true);
      }
    } finally {
      if (engine === camera.current) setCutoutLoading(false);
    }
  }

  function trackPointer(event: ReactPointerEvent, down: boolean | undefined = undefined) {
    const engine = scene.current, bounds = art.current?.getBoundingClientRect();
    if (!engine || !bounds || mode !== 'pointer' || isIntro || isEnd) return;
    const x = (event.clientX - bounds.left) / bounds.width, y = (event.clientY - bounds.top) / bounds.height;
    const now = performance.now();
    const prior = pointer.current;
    const pressed = down ?? prior.pressed;
    const delta = prior.hand && now - prior.last < 150 ? (x - prior.hand.x) / Math.max(.016, (now - prior.last) / 1000) : 0;
    const gesture = pressed ? 'Closed Fist' : Math.abs(delta) > 2.2 ? 'Swipe' : event.shiftKey ? 'Open Palm' : 'Idle';
    pointer.current = { last: now, pressed, hand: { x, y, z: 0, gesture, vx: delta, pinch: false } };
    if (down === true) {
      const memory = engine.nearest(x, y, 48);
      if (memory) recall(memory);
    }
  }

  useEffect(() => {
    const host = art.current;
    if (!host) return;
    let engine: DecemberScene;
    try { engine = new DecemberScene(host); }
    catch { setRendererError(true); return; }
    scene.current = engine;
    const resize = () => {
      const box = host.getBoundingClientRect();
      engine.layout(box.width, box.height, sceneStage.current === 'beginning');
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    engine.onFrame = dt => {
      const state = current.current;
      const audio = soundtrack.current;
      const now = performance.now();
      if (audio) {
        engine.audio = audio.sample(dt);
        const rounded = Math.floor(audio.time);
        if (rounded !== lastClockDisplay.current) { lastClockDisplay.current = rounded; setTime(rounded); }
      }
      if (sceneStage.current === 'formation' || sceneStage.current === 'memories') {
        elapsed.current += dt;
        if (sceneStage.current === 'formation' && elapsed.current > 6.1) transition('memories');
        if (selectedUntil.current && elapsed.current >= selectedUntil.current) clearMemory();
        if (state.mode === 'pointer') {
          const p = pointer.current;
          engine.hands = p.hand && (p.pressed || now - p.last < 760) ? [p.hand] : [];
          if (p.hand && now - p.last > 140 && p.hand.gesture === 'Swipe') p.hand.gesture = 'Idle';
        } else if (state.mode === 'demo') {
          const t = elapsed.current;
          const arc = Math.sin(t * .68), swell = Math.sin(t * .36) * .095;
          engine.hands = [
            { x: .37 + arc * .13 - swell, y: .54 + Math.sin(t * .69) * .16, z: 0, gesture: Math.sin(t * .92) > .55 ? 'Open Palm' : 'Idle', pinch: false, vx: arc },
            { x: .63 - arc * .13 + swell, y: .57 - Math.sin(t * .69) * .14, z: 0, gesture: Math.cos(t * .6) < -.68 ? 'Closed Fist' : Math.sin(t * .62) < -.7 ? 'Swipe' : 'Idle', pinch: false, vx: -arc * 2 },
          ];
          if (sceneStage.current === 'memories' && state.memories.length && t > 9 + lastDemo.current * 12) {
            recall(state.memories[lastDemo.current % state.memories.length]);
            lastDemo.current++;
          }
        }
      }
      const visible = sceneStage.current === 'memories' ? engine.markers() : [];
      for (const [id, element] of markerEls.current) {
        const point = visible.find(m => m.item.id === id);
        element.style.visibility = point ? 'visible' : 'hidden';
        if (point) { element.style.left = point.x * 100 + '%'; element.style.top = point.y * 100 + '%'; }
      }
      cursorEls.current.forEach((element, i) => {
        if (!element) return;
        const hand = state.mode === 'camera' && sceneStage.current !== 'ending' ? engine.hands[i] : undefined;
        element.style.opacity = hand ? '1' : '0';
        if (hand) { element.style.left = hand.x * 100 + '%'; element.style.top = hand.y * 100 + '%'; element.dataset.gesture = hand.gesture; }
      });
      const preview = viewCamera.current;
      if (preview && camera.current && state.showCamera) {
        const engine = camera.current;
        const source = state.cutout && engine.cutoutReady ? engine.cutout : engine.video;
        const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
        const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
        if (sw && sh) {
          const ctx = preview.getContext('2d')!, scale = Math.max(preview.width / sw, preview.height / sh);
          ctx.clearRect(0, 0, preview.width, preview.height);
          ctx.drawImage(source, (preview.width - sw * scale) / 2, (preview.height - sh * scale) / 2, sw * scale, sh * scale);
        }
      }
    };
    return () => {
      observer.disconnect();
      engine.dispose();
      camera.current?.dispose();
      recorder.current?.stop();
      soundtrack.current?.dispose();
      window.clearTimeout(statusTimer.current);
    };
  }, []);

  useEffect(() => {
    const box = art.current?.getBoundingClientRect();
    if (box) scene.current?.layout(box.width, box.height, isIntro);
  }, [lens, isIntro]);
  useEffect(() => { scene.current?.setTheme(theme); }, [theme]);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = language === 'en' ? `${brand} — ${t.tagline}` : `${t.titleStart}${t.titleEnd} — ${brand}`;
    document.querySelector('meta[name="description"]')?.setAttribute('content', t.description);
  }, [language, t]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDialog(null);
        setThemeOpen(false);
        setCinematic(false);
      }
      const element = event.target as HTMLElement | null;
      if (element?.matches('input, textarea, select, button') || isIntro || dialog) return;
      if (event.key.toLowerCase() === 'c') setCinematic(value => !value);
      if (event.key === ' ' && !isEnd) { event.preventDefault(); if (soundtrack.current?.playing) soundtrack.current.pause(); else soundtrack.current?.play(); setPlaying(Boolean(soundtrack.current?.playing)); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dialog, isIntro, isEnd]);

  function editEntry(index: number, text: string) {
    setEntries(items => items.map((item, i) => i === index ? text : item));
  }

  function addEntry() {
    setEntries(items => items.length >= 5 ? items : [...items, '']);
    setTimeout(() => document.querySelector<HTMLTextAreaElement>('.memory-row:last-child textarea')?.focus(), 0);
  }

  return <main ref={view} lang={language} data-theme={theme} className={`app ${isIntro ? 'intro' : 'performance'} ${cinematic ? 'cinematic' : ''} ${isEnd ? 'ending' : ''}`}>
    <div className={`stage-region lens-${lens}`}>
      <div className="art" ref={art} />
      <div className="stage-overlay" onPointerMove={e => trackPointer(e)} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); trackPointer(e, true); }} onPointerUp={e => trackPointer(e, false)} onPointerCancel={() => { pointer.current.pressed = false; }} onPointerLeave={() => { if (!pointer.current.pressed) pointer.current.hand = undefined; }}>
        {!isIntro && memories.map(item => <button key={item.id} title={t.revealMemory} aria-label={t.revealMemoryAt(item.id + 1)} className="memory-marker" ref={el => { if (el) markerEls.current.set(item.id, el); else markerEls.current.delete(item.id); }} onPointerDown={e => e.stopPropagation()} onClick={() => recall(item)} />)}
        {!isIntro && [0, 1].map(i => <span key={i} ref={el => { if (el) cursorEls.current[i] = el; }} className="hand-cursor" aria-hidden="true"/>)}
      </div>
      {!isIntro && showCamera && cameraReady && <canvas className={`camera-overlay ${corner} ${cutout ? 'cutout' : ''}`} ref={viewCamera} width={360} height={270} aria-label={t.cameraPreview}/>}
      {selection && !isEnd && <div key={selection.id} aria-live="polite" className="memory-reveal"><span>✧</span><p>{memoryText(selection, language)}</p><button className="icon-button" onClick={clearMemory} aria-label={t.dismissMemory}><Icon name="close" size={17}/></button></div>}
      {isEnd && <div className="ending-copy"><p>{t.closing}</p><small>{t.question}</small><small className="ending-translation" lang={secondaryLanguage}>{words[secondaryLanguage].question}</small></div>}
    </div>
    <header className="topbar ui">
      <button className="wordmark" onClick={isIntro ? undefined : returnHome} aria-label={isIntro ? brand : t.home}><span className="brand-mark"><Icon name="star" size={19}/></span><span className="wordmark-name" lang="en">{brand}<span className="wordmark-period">.</span></span></button>
      <div className="top-actions">
        <div className="language-switch" role="group" aria-label={t.language}>
          {(['en', 'zh-CN'] as const).map(option => <button key={option} lang={option} aria-pressed={language === option} onClick={() => chooseLanguage(option)}>{languages[option]}</button>)}
        </div>
        <div className="theme-control">
          <button className="top-button theme-trigger" onClick={() => setThemeOpen(!themeOpen)} aria-expanded={themeOpen} aria-label={t.themes[theme]}><span className="swatch" style={{ '--swatch': palettes[theme].light } as React.CSSProperties}/><span>{t.themes[theme]}</span><Icon name="chevron" size={13}/></button>
          {themeOpen && <div className="theme-menu">{themeNames.map(name => <button key={name} onClick={() => { setTheme(name); setThemeOpen(false); }}><span className="swatch" style={{ '--swatch': palettes[name].light } as React.CSSProperties}/>{t.themes[name]}{theme === name && <Icon name="check" size={14}/>}</button>)}</div>}
        </div>
        <button className="top-button guide-button" aria-label={t.guide} onClick={() => setDialog('guide')}><span className="question-icon" aria-hidden="true">?</span><span>{t.guide}</span></button>
      </div>
    </header>
    {isIntro ? <>
      <section className="entry ui">
        <p className="kicker"><span className="kicker-star">✦</span> {t.installation}</p>
        <h1>{t.titleStart}{language === 'en' ? ' ' : ''}<em>{t.titleEnd}<span>{t.titlePeriod}</span></em></h1>
        <p className="tagline">{t.tagline}</p>
        <div className="entry-card">
          <div className="input-heading"><label htmlFor="memory-0">{t.openingQuestion}</label><span>{entries.filter(item => item.trim()).length}<span className="slash">/</span>5</span></div>
          <div className="memory-list">
            {entries.map((entry, index) => <div className="memory-row" key={index}><span aria-hidden="true">✧</span><textarea id={`memory-${index}`} aria-label={t.memory(index + 1)} value={entry} maxLength={180} rows={index === 0 ? 2 : 1} placeholder={index === 0 ? t.firstPlaceholder : t.nextPlaceholder} onChange={e => editEntry(index, e.target.value)}/>{entries.length > 1 && <button className="icon-button remove-memory" onClick={() => setEntries(items => items.filter((_, i) => i !== index))} aria-label={t.removeMemory(index + 1)}><Icon name="close" size={15}/></button>}</div>)}
          </div>
          <button className="add-memory" disabled={entries.length >= 5} onClick={addEntry}><Icon name="plus" size={15}/> {t.addMemory}</button>
          <div className="music-pick">
            <span className="small-label">{t.soundtrack}</span>
            <div className="music-options">
              <button className={`music-option ${!file ? 'chosen' : ''}`} onClick={() => { setFile(undefined); if (fileInput.current) fileInput.current.value = ''; }} aria-pressed={!file}><Icon name="wave" size={18}/><span><strong>{t.nocturne}</strong><small>{t.originalScore}</small></span></button>
              <button className={`music-option ${file ? 'chosen' : ''}`} title={file?.name} onClick={() => fileInput.current?.click()}><Icon name="upload" size={17}/><span><strong>{file ? file.name : t.uploadMusic}</strong><small>{t.fromDevice}</small></span></button>
              <input hidden ref={fileInput} type="file" accept="audio/*,.m4a,.flac" onChange={e => { if (e.target.files?.[0]) { setFile(e.target.files[0]); inform(); } e.target.value = ''; }}/>
            </div>
          </div>
          <div className="entry-bottom">
            <button className="primary-button" onClick={() => void begin()} disabled={working || rendererError}><Icon name="star" size={17}/>{working ? t.preparing : t.begin}</button>
            <button className="demo-button" onClick={() => void begin(true)} disabled={working || rendererError}><Icon name="play" size={16}/> {t.watchDemo}</button>
          </div>
          <div className="input-mode" aria-label={t.inputMode}><button aria-pressed={mode !== 'camera'} onClick={() => setMode('pointer')}><Icon name="pointer" size={14}/> {t.inputs.pointer}</button><button aria-pressed={mode === 'camera'} onClick={() => setMode('camera')}><Icon name="camera" size={15}/> {t.inputs.camera}</button></div>
        </div>
      </section>
      <aside className="art-caption ui" aria-label={t.livePreview}><span className="live-dot"/><div><b>{t.tree}</b><span>{t.particleStudy}</span></div></aside>
      <footer className="intro-footer ui"><span>{t.footer}</span><button onClick={() => setDialog('lab')}>{t.lab.title} <Icon name="chevron" size={13}/></button><span className="privacy"><Icon name="circle" size={12}/> {t.privacy}</span></footer>
    </> : <>
      <div className="stage-tag ui"><span className="live-dot"/>{isEnd ? t.ending : stage === 'formation' ? t.formation : t.memories}</div>
      {!cinematic && !isEnd && <div className="performance-hint ui">{stage === 'formation' ? t.formationHints[mode] : memories.length ? t.memoryHints[mode] : t.noMemoriesHint}</div>}
      {cinematic && <button className="cinematic-exit icon-button" onClick={() => setCinematic(false)} aria-label={t.exitCinematic}><Icon name="expand"/></button>}
      <footer className="performance-footer ui">
        {!isEnd && <div className="transport">
          <button className="icon-button" aria-label={playing ? t.pauseMusic : t.playMusic} onClick={() => { const audio = soundtrack.current; if (audio?.playing) audio.pause(); else audio?.play(); setPlaying(Boolean(audio?.playing)); }}><Icon name={playing ? 'pause' : 'play'}/></button>
          <div className="track-label"><b>{file?.name || t.nocturne}</b><div className="track-progress" role="progressbar" aria-label={t.musicProgress} aria-valuenow={time} aria-valuemin={0} aria-valuemax={Math.ceil(duration)}><span style={{ width: `${time / duration * 100}%` }}/></div></div>
          <span className="time">{lengthLabel(time)} / {lengthLabel(duration)}</span>
        </div>}
        <div className="performance-actions">
          {recording && <button className="outline-button stop-recording" onClick={stopRecording}><span className="record-dot"/> {t.stopRecording}</button>}
          {isEnd ? <><button className="outline-button" onClick={returnHome}>{t.beginAgain}</button><button className="primary-button small-button" onClick={poster}><Icon name="download" size={17}/> {t.savePoster}</button></> : <button className="outline-button end-button" onClick={finish}>{t.endPerformance}</button>}
          <button className="outline-button" onClick={() => setDialog('creator')}><Icon name="settings" size={17}/><span>{t.creator}</span></button>
          <button className="icon-button fs-button" onClick={() => void fullscreen(true)} aria-label={t.toggleFullscreen}><Icon name="expand"/></button>
        </div>
      </footer>
    </>}
    {(status || rendererError) && <div className={`status-toast ${isIntro ? 'intro-toast' : ''}`} role="status">{rendererError ? t.notices.webGL : status && t.notices[status]}</div>}
    {dialog && <div className="scrim" onPointerDown={e => { if (e.target === e.currentTarget) setDialog(null); }}>
      {dialog === 'lab' ? <Suspense fallback={<div className="dialog" role="status">{t.lab.loading}</div>}><Lab language={language} close={() => setDialog(null)}/></Suspense> : <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <button className="icon-button dialog-close" aria-label={t.closeDialog} onClick={() => setDialog(null)}><Icon name="close"/></button>
        {dialog === 'guide' ? <>
          <p className="kicker" lang="en">{brand}</p><h2 id="dialog-title">{t.guideTitle}</h2>
          <dl className="guide-list">{t.guideSteps.map(([action, effect]) => <div key={action}><dt>{action}</dt><dd>{effect}</dd></div>)}</dl>
          <button className="outline-button" onClick={() => setDialog('lab')}>{t.openLab}</button>
        </> : <>
          <p className="kicker" lang="en">{brand}</p><h2 id="dialog-title">{t.creatorMode}</h2>
          <div className="creator-group"><span className="small-label">{t.composition}</span><div className="row">{([['auto', t.fitScreen], ['portrait', '9:16'], ['landscape', '16:9']] as const).map(([value, label]) => <button key={value} className={`outline-button ${lens === value ? 'chosen' : ''}`} aria-pressed={lens === value} disabled={recording} onClick={() => setLens(value)}>{label}</button>)}</div></div>
          {!isEnd && <div className="creator-group"><span className="small-label">{t.interaction}</span><div className="row">{modes.map(item => <button key={item.id} className={`outline-button ${item.id === mode ? 'chosen' : ''}`} onClick={() => selectInput(item.id)}><Icon name={item.icon} size={15}/>{t.inputs[item.id]}</button>)}</div>{mode === 'camera' && <small aria-live="polite">{modelStatus && t.cameraModels[modelStatus]}</small>}</div>}
          {mode === 'camera' && <div className="creator-group"><label className="check-row"><input type="checkbox" checked={showCamera} disabled={!cameraReady} onChange={e => setShowCamera(e.target.checked)}/> {t.includeCamera}</label>{showCamera && <div className="row camera-options"><select aria-label={t.cameraPosition} value={corner} onChange={e => setCorner(e.target.value as typeof corners[number])}>{corners.map(position => <option key={position} value={position}>{t.corners[position]}</option>)}</select><label className="check-row"><input type="checkbox" checked={cutout} disabled={!cameraReady || cutoutLoading} onChange={e => void changeMatte(e.target.checked)}/> {t.removeBackground}</label></div>}{cutoutLoading && <small role="status">{t.preparingBackground}</small>}</div>}
          <div className="creator-group export-controls"><span className="small-label">{t.export}</span><div className="row">
            <button className="outline-button" onClick={poster}><Icon name="download" size={17}/> {t.pngPoster}</button>
            {recording ? <button className="outline-button" onClick={stopRecording}><span className="record-dot"/> {t.stopRecording}</button> : <><select value={format} onChange={e => setFormat(e.target.value)} aria-label={t.videoFormat} disabled={!videoFormats.length}>{videoFormats.length ? videoFormats.map(f => <option value={f.mime} key={f.mime}>{f.label}</option>) : <option value="">{t.unavailable}</option>}</select><button className="outline-button" onClick={startRecording} disabled={!videoFormats.length}><Icon name="circle" size={17}/> {t.startRecording}</button></>}
          </div></div>
          <button className="primary-button small-button" onClick={() => { setDialog(null); setCinematic(true); }}><Icon name="expand" size={17}/> {t.enterCinematic}</button><small className="key-help">{t.cinematicKeys}</small>
        </>}
      </div>}
    </div>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
