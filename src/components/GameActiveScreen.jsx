import { useEffect, useRef, useState } from 'react';
import { startPitchLoop } from '../audio/pitchDetector.js';

// Phase 2 sanity screen: level meter + console-logged smoothed pitch.
// Phase 3 will replace this with the canvas.
export default function GameActiveScreen({ settings, capture, onExit }) {
  const [level, setLevel] = useState(0);
  const [pitch, setPitch] = useState(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const { ctx, analyser } = capture;
    const buf = new Float32Array(analyser.fftSize);
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      setLevel(Math.sqrt(sum / buf.length));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    const stopPitch = startPitchLoop({
      ctx,
      analyser,
      onPitch: (hz, clarity) => {
        // eslint-disable-next-line no-console
        console.log(`pitch ${hz.toFixed(2)} Hz (clarity ${clarity.toFixed(2)})`);
        setPitch(hz);
      },
    });

    return () => {
      cancelAnimationFrame(rafRef.current);
      stopPitch();
    };
  }, [capture]);

  const pct = Math.min(100, Math.round(level * 400));

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-emerald-400">● Game active</div>
          <h2 className="mt-1 text-2xl font-semibold">Mic is live</h2>
        </div>
        <button
          type="button"
          onClick={onExit}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm hover:border-white/20"
        >
          End
        </button>
      </header>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="text-xs uppercase tracking-wider text-slate-400">Input level</div>
        <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full bg-gradient-to-r from-emerald-400 to-indigo-400 transition-[width] duration-75"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-3 text-sm text-slate-400">
          Try singing or humming — the bar should move. When it stays at zero, your mic is muted
          or the wrong device is selected.
        </p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-slate-300">
        <div className="text-xs uppercase tracking-wider text-slate-400">Session</div>
        <dl className="mt-2 grid grid-cols-2 gap-y-1">
          <dt className="text-slate-500">Key</dt>
          <dd>
            {settings.tonic} {settings.mode}
          </dd>
          <dt className="text-slate-500">Difficulty</dt>
          <dd className="capitalize">{settings.difficulty}</dd>
          <dt className="text-slate-500">Pre-tone</dt>
          <dd>{settings.aids.preTone ? 'on' : 'off'}</dd>
          <dt className="text-slate-500">Tonic drone</dt>
          <dd>{settings.aids.tonicDrone ? 'on' : 'off'}</dd>
          <dt className="text-slate-500">Metronome</dt>
          <dd>{settings.aids.metronome ? 'on' : 'off'}</dd>
        </dl>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="text-xs uppercase tracking-wider text-slate-400">Smoothed pitch</div>
        <div className="mt-2 font-mono text-2xl">
          {pitch ? `${pitch.toFixed(1)} Hz` : <span className="text-slate-500">—</span>}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Values appear once clarity ≥ 0.90 for 5 consecutive frames. Open the devtools console
          for the full log.
        </p>
      </section>
    </div>
  );
}
