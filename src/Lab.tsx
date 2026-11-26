import { useEffect, useRef, useState } from 'react';
import { gestures, type Frame, type Gesture } from './types';
import { Icon } from './icons';
import { download } from './export';
import { words, type Language, type Copy } from './words';

type Measure = { accuracy: number; macroF1: number; confusion: number[][] };
type Comparison = { samples: number; temporalCNN: Measure; rules: Measure };
type Report = { syntheticClips: number; trainingClips: number; validationClips: number; syntheticTest: Comparison; realTest: Comparison | null };
type Clip = { label: Gesture; frames: Frame[] };
type CaptureState = keyof Copy['lab']['captureStatus'];
type BenchmarkResult = Awaited<ReturnType<typeof import('./inference').benchmark>>;

function Matrix({ title, metrics, language }: { title: string; metrics: Measure; language: Language }) {
  const t = words[language].lab;
  return <section className="matrix">
    <h3>{title}</h3>
    <p>{t.accuracy} {(metrics.accuracy * 100).toFixed(1)}% · {t.macroF1} {metrics.macroF1.toFixed(3)}</p>
    <table><caption>{t.confusion}</caption>
      <thead><tr><th scope="col">{t.actual}</th>{gestures.map(g => <th scope="col" key={g} title={t.gestures[g]}>{t.gestureShort[g]}</th>)}</tr></thead>
      <tbody>{metrics.confusion.map((row, i) => <tr key={gestures[i]}><th scope="row">{t.gestures[gestures[i]]}</th>{row.map((value, j) => <td className={j === i ? 'correct' : ''} key={j}>{value}</td>)}</tr>)}</tbody>
    </table>
  </section>;
}

export default function Lab({ close, language }: { close: () => void; language: Language }) {
  const t = words[language].lab;
  const [report, setReport] = useState<Report>();
  const [measurement, setMeasurement] = useState<BenchmarkResult | 'warming' | 'failed' | null>(null);
  const [reportError, setReportError] = useState(false);
  const [label, setLabel] = useState<Gesture>('Open Palm');
  const [clips, setClips] = useState<Clip[]>([]);
  const [captureState, setCaptureState] = useState<CaptureState>('off');
  const [ready, setReady] = useState(false);
  const [record, setRecord] = useState<number | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const landmarks = useRef<HTMLCanvasElement>(null);
  const recordRef = useRef<{ label: Gesture; frames: Frame[]; first?: number } | null>(null);
  const cleanup = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    const url = new URL(`${import.meta.env.BASE_URL}model/metrics.json`, location.href);
    void fetch(url, { signal: controller.signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setReport).catch(() => { if (!controller.signal.aborted) setReportError(true); });
    return () => { controller.abort(); cleanup.current?.(); };
  }, []);

  async function enable() {
    const el = video.current;
    if (!el) return;
    setCaptureState('opening');
    let cancelled = false, stop: (() => void) | undefined;
    cleanup.current = () => { cancelled = true; stop?.(); };
    try {
      const { openVideo, createLandmarker } = await import('./vision');
      if (cancelled) return;
      const stream = await openVideo(el);
      stop = () => stream.getTracks().forEach(track => track.stop());
      if (cancelled) { stop(); return; }
      const detector = await createLandmarker();
      if (cancelled) { detector.close(); stop(); return; }
      setReady(true);
      setCaptureState('ready');
      let raf = 0, previous = -1, last = 0, countdownEnd = 0;
      stop = () => { cancelAnimationFrame(raf); detector.close(); stream.getTracks().forEach(track => track.stop()); };
      const draw = (now: number) => {
        raf = requestAnimationFrame(draw);
        if (previous === el.currentTime || now - last < 29 || el.readyState < 2) return;
        previous = el.currentTime;
        last = now;
        let out;
        try { out = detector.detectForVideo(el, now); }
        catch {
          stop?.();
          recordRef.current = null;
          setRecord(null);
          setReady(false);
          setCaptureState('stopped');
          return;
        }
        const canvas = landmarks.current;
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#ffdda4';
          for (const hand of out.landmarks) for (const p of hand) {
            ctx.beginPath(); ctx.arc((1 - p.x) * canvas.width, p.y * canvas.height, 2.2, 0, Math.PI * 2); ctx.fill();
          }
        }
        const active = recordRef.current;
        if (!active) { countdownEnd = 0; return; }
        countdownEnd ||= now + 1750;
        if (now < countdownEnd) return;
        if (out.landmarks.length !== 1) {
          if (active.frames.length) { recordRef.current = null; setRecord(null); setCaptureState('handLeft'); }
          else if (now > countdownEnd + 2500) { recordRef.current = null; setRecord(null); setCaptureState('oneHand'); }
          return;
        }
        active.first ??= now;
        active.frames.push({ points: out.landmarks[0], t: now - active.first, confidence: out.handedness[0]?.[0]?.score ?? .8 });
        setRecord(active.frames.length);
        if (active.frames.length === 32) {
          setClips(list => [...list, { label: active.label, frames: active.frames }]);
          setCaptureState('clipSaved');
          recordRef.current = null;
          setRecord(null);
        }
      };
      raf = requestAnimationFrame(draw);
    } catch {
      stop?.();
      if (!cancelled) setCaptureState('unavailable');
    }
  }

  async function runBenchmark() {
    setMeasurement('warming');
    try { setMeasurement(await (await import('./inference')).benchmark()); }
    catch { setMeasurement('failed'); }
  }

  const measureText = measurement === 'warming' ? t.warming : measurement === 'failed' ? t.benchmarkUnavailable : measurement && t.benchmark(
    measurement.runs.toLocaleString(language), measurement.median.toFixed(2), measurement.p95.toFixed(2), t.gestures[measurement.prediction],
  );

  return <div className="dialog lab-dialog" role="dialog" aria-modal="true" aria-labelledby="lab-title">
    <button className="icon-button dialog-close" onClick={close} aria-label={t.close}><Icon name="close"/></button>
    <p className="kicker">{t.behind}</p>
    <h2 id="lab-title">{t.title}</h2>
    {report ? <>
      <p>{t.synthetic(report.syntheticClips.toLocaleString(language), report.syntheticTest.samples.toLocaleString(language))}</p>
      <div className="matrices"><Matrix language={language} title={t.cnn} metrics={report.syntheticTest.temporalCNN}/><Matrix language={language} title={t.geometry} metrics={report.syntheticTest.rules}/></div>
      <h3>{t.independentTest}</h3>
      {report.realTest ? <><p>{t.labeledClips(report.realTest.samples.toLocaleString(language))}</p><div className="matrices"><Matrix language={language} title={t.cnn} metrics={report.realTest.temporalCNN}/><Matrix language={language} title={t.geometry} metrics={report.realTest.rules}/></div></> : <p>{t.noCameraClips}</p>}
    </> : <p>{reportError ? t.metricsUnavailable : t.metricsLoading}</p>}
    <div className="row bench"><button className="outline-button" onClick={() => void runBenchmark()} disabled={measurement === 'warming'}>{t.measure}</button><span aria-live="polite">{measureText}</span></div>
    <h3>{t.capture}</h3>
    <p>{t.instructions}</p>
    <div className="lab-frame"><video ref={video} playsInline muted/><canvas ref={landmarks} width={640} height={480}/>{!ready && <Icon name="camera" size={28}/>}</div>
    <div className="row lab-controls">
      {!ready && <button className="outline-button" onClick={() => void enable()} disabled={captureState === 'opening'}>{t.enableCamera}</button>}
      <label className="sr-only" htmlFor="gesture-label">{t.gestureLabel}</label>
      <select id="gesture-label" value={label} onChange={event => setLabel(event.target.value as Gesture)} disabled={record !== null}>{gestures.map(g => <option key={g} value={g}>{t.gestures[g]}</option>)}</select>
      <button className="outline-button" disabled={!ready || record !== null} onClick={() => { recordRef.current = { label, frames: [] }; setRecord(0); }}>{t.record}</button>
      <button className="outline-button" disabled={!clips.length || record !== null} onClick={() => download(new Blob([JSON.stringify({ version: 1, clips })], { type: 'application/json' }), 'dear-december-landmarks.json')}>{t.saveJson(clips.length.toLocaleString(language))}</button>
    </div>
    <p className="capture-detail" aria-live="polite">{record === null ? t.captureStatus[captureState] : record === 0 ? t.getReady : t.capturing(record)}</p>
  </div>;
}
