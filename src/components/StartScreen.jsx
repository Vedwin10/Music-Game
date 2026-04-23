import { useState } from 'react';

const TONICS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MODES = ['Major', 'Minor'];
const DIFFICULTIES = [
  { id: 'beginner', label: 'Beginner', detail: '±50 cents' },
  { id: 'intermediate', label: 'Intermediate', detail: '±25 cents' },
  { id: 'advanced', label: 'Advanced', detail: '±15 cents' },
];

export default function StartScreen({ onStart }) {
  const [tonic, setTonic] = useState('C');
  const [mode, setMode] = useState('Major');
  const [difficulty, setDifficulty] = useState('beginner');

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8 px-6 py-10">
      <section className="text-center">
        <h2 className="text-3xl font-semibold">Ready to sing?</h2>
        <p className="mt-2 text-sm text-slate-400">
          Pick a key and a difficulty. You&apos;ll be asked for microphone permission
          after you start.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium uppercase tracking-wider text-slate-400">Key</h3>
        <div className="flex flex-wrap gap-2">
          {TONICS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTonic(t)}
              className={`min-w-12 rounded-lg border px-3 py-2 text-sm transition ${
                tonic === t
                  ? 'border-orange-400 bg-orange-500/20 text-orange-100'
                  : 'border-white/10 bg-white/5 text-slate-200 hover:border-white/20'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${
                mode === m
                  ? 'border-emerald-400 bg-emerald-500/20 text-emerald-100'
                  : 'border-white/10 bg-white/5 text-slate-200 hover:border-white/20'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium uppercase tracking-wider text-slate-400">Difficulty</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {DIFFICULTIES.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setDifficulty(d.id)}
              className={`rounded-lg border px-3 py-3 text-left transition ${
                difficulty === d.id
                  ? 'border-orange-400 bg-orange-500/20'
                  : 'border-white/10 bg-white/5 hover:border-white/20'
              }`}
            >
              <div className="text-sm font-medium">{d.label}</div>
              <div className="text-xs text-slate-400">{d.detail}</div>
            </button>
          ))}
        </div>
      </section>

      <button
        type="button"
        onClick={(e) => {
          // Must stay synchronous: AudioContext creation below requires the
          // click event to still be the active user gesture (iOS Safari).
          e.preventDefault();
          onStart?.({ tonic, mode, difficulty });
        }}
        className="mt-2 rounded-xl bg-orange-500 px-6 py-4 text-base font-semibold text-white shadow-lg shadow-orange-500/20 transition hover:bg-orange-400 active:scale-[0.99]"
      >
        Start Game
      </button>
    </div>
  );
}
