import { useEffect, useRef, useState } from 'react';
import { gestures, type Frame, type Gesture } from './types';
import { Icon } from './icons';
import { download } from './export';

type Measure = { accuracy: number; macroF1: number; confusion: number[][] };
type Comparison = { samples: number; temporalCNN: Measure; rules: Measure };
type Report = { syntheticClips: number; trainingClips: number; validationClips: number; syntheticTest: Comparison; realTest: Comparison | null };
type Clip = { label: Gesture; frames: Frame[] };

function Matrix({ title, metrics }: { title: string; metrics: Measure }) {
  return <section className="matrix">
    <h3>{title}</h3>
    <p>Accuracy {(metrics.accuracy * 100).toFixed(1)}% · Macro F1 {metrics.macroF1.toFixed(3)}</p>
    <table><caption>Confusion matrix · actual rows, predicted columns</caption>
      <thead><tr><th scope="col">Actual</th>{gestures.map(g => <th scope="col" key={g}>{g.split(' ').map(s => s[0]).join('')}</th>)}</tr></thead>
      <tbody>{metrics.confusion.map((row, i) => <tr key={gestures[i]}><th scope="row">{gestures[i]}</th>{row.map((value, j) => <td className={j === i ? 'correct' : ''} key={j}>{value}</td>)}</tr>)}</tbody>
    </table>
  </section>;
}

export default function Lab({ close }: { close: () => void }) {
  const [report, setReport] = useState<Report>();
  const [measureStatus, setMeasureStatus] = useState('');
  const [reportError, setReportError] = useState(false);
  const [label, setLabel] = useState<Gesture>('Open Palm');
  const [clips, setClips] = useState<Clip[]>([]);
  const [captureState, setCaptureState] = useState('Camera off');
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
    setCaptureState('Opening camera…');
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
      setCaptureState('Camera ready');
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
          setCaptureState('Camera tracking stopped. Re-enable the camera to try again.');
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
          if (active.frames.length) { recordRef.current = null; setRecord(null); setCaptureState('A hand left the frame. Try the clip again.'); }
          else if (now > countdownEnd + 2500) { recordRef.current = null; setRecord(null); setCaptureState('Keep one hand in the frame.'); }
          return;
        }
        active.first ??= now;
        active.frames.push({ points: out.landmarks[0], t: now - active.first, confidence: out.handedness[0]?.[0]?.score ?? .8 });
        setRecord(active.frames.length);
        if (active.frames.length === 32) {
          setClips(list => [...list, { label: active.label, frames: active.frames }]);
          setCaptureState('Clip saved locally');
          recordRef.current = null;
          setRecord(null);
        }
      };
      raf = requestAnimationFrame(draw);
    } catch {
      stop?.();
      if (!cancelled) setCaptureState('Camera unavailable. Check permission and try again.');
    }
  }

  async function runBenchmark() {
    setMeasureStatus('Warming up the model…');
    try {
      const result = await (await import('./inference')).benchmark();
      setMeasureStatus(`${result.runs} inferences · median ${result.median.toFixed(2)} ms · p95 ${result.p95.toFixed(2)} ms · ${result.prediction}`);
    } catch (error) { setMeasureStatus(error instanceof Error ? error.message : 'Benchmark unavailable.'); }
  }

  return <div className="dialog lab-dialog" role="dialog" aria-modal="true" aria-labelledby="lab-title">
    <button className="icon-button dialog-close" onClick={close} aria-label="Close gesture lab"><Icon name="close"/></button>
    <p className="kicker">Behind the installation</p>
    <h2 id="lab-title">Gesture lab</h2>
    {report ? <>
      <p>{report.syntheticClips.toLocaleString()} synthetic clips. The {report.syntheticTest.samples.toLocaleString()} test clips use held-out template and trajectory groups.</p>
      <div className="matrices"><Matrix title="Temporal CNN" metrics={report.syntheticTest.temporalCNN}/><Matrix title="Geometry baseline" metrics={report.syntheticTest.rules}/></div>
      <h3>Independent camera test</h3>
      {report.realTest ? <><p>{report.realTest.samples} labeled camera clips.</p><div className="matrices"><Matrix title="Temporal CNN" metrics={report.realTest.temporalCNN}/><Matrix title="Geometry baseline" metrics={report.realTest.rules}/></div></> : <p>0 labeled camera clips. Real-camera accuracy is unmeasured.</p>}
    </> : <p>{reportError ? 'Model metrics are unavailable.' : 'Loading model metrics…'}</p>}
    <div className="row bench"><button className="outline-button" onClick={() => void runBenchmark()}>Measure browser latency</button><span aria-live="polite">{measureStatus}</span></div>
    <h3>Capture a labeled gesture</h3>
    <p>Choose a label, keep one hand in frame, and begin the gesture after the countdown. Each clip contains 32 landmark frames. JSON stays on your device.</p>
    <div className="lab-frame"><video ref={video} playsInline muted/><canvas ref={landmarks} width={640} height={480}/>{!ready && <Icon name="camera" size={28}/>}</div>
    <div className="row lab-controls">
      {!ready && <button className="outline-button" onClick={() => void enable()} disabled={captureState === 'Opening camera…'}>Enable camera</button>}
      <label className="sr-only" htmlFor="gesture-label">Gesture label</label>
      <select id="gesture-label" value={label} onChange={event => setLabel(event.target.value as Gesture)} disabled={record !== null}>{gestures.map(g => <option key={g}>{g}</option>)}</select>
      <button className="outline-button" disabled={!ready || record !== null} onClick={() => { recordRef.current = { label, frames: [] }; setRecord(0); setCaptureState('Get ready…'); }}>Record clip</button>
      <button className="outline-button" disabled={!clips.length || record !== null} onClick={() => download(new Blob([JSON.stringify({ version: 1, clips })], { type: 'application/json' }), 'dear-december-landmarks.json')}>Save JSON ({clips.length})</button>
    </div>
    <p className="capture-detail" aria-live="polite">{record === null ? captureState : record === 0 ? 'Get ready…' : `Capturing ${record}/32`}</p>
  </div>;
}
