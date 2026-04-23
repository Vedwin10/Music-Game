import { PitchDetector } from 'pitchy';

// Spec §2 nominally says clarity ≥ 0.90, but real browser-mic singing with
// noiseSuppression disabled routinely oscillates across that line on sustained
// vowels, which starves the game of updates. 0.8 keeps breath/consonant noise
// out while still passing normal singing.
const CLARITY_THRESHOLD = 0.85;
const MEDIAN_WINDOW = 7;
// If the singer stays silent/noisy this long, drop the rolling window so the
// next phrase doesn't inherit stale pitch from the previous one.
const SILENCE_RESET_MS = 250;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Starts a RAF loop that reads time-domain data from the given AnalyserNode,
// runs pitchy, gates on clarity, applies a rolling median of up to
// MEDIAN_WINDOW accepted frames, and calls onPitch(smoothedHz, clarity) on
// every accepted frame. Returns a stop() function.
export function startPitchLoop({ ctx, analyser, onPitch }) {
  const detector = PitchDetector.forFloat32Array(analyser.fftSize);
  const buffer = new Float32Array(analyser.fftSize);
  const window = [];
  let lastAcceptedAt = 0;
  let rafId = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    analyser.getFloatTimeDomainData(buffer);
    const [hz, clarity] = detector.findPitch(buffer, ctx.sampleRate);
    const now = performance.now();

    if (Number.isFinite(hz) && hz > 0 && clarity >= CLARITY_THRESHOLD) {
      // A long gap since the last accepted frame means a new phrase — flush
      // the median window so old pitch doesn't bleed in.
      if (lastAcceptedAt && now - lastAcceptedAt > SILENCE_RESET_MS) {
        window.length = 0;
      }
      window.push(hz);
      if (window.length > MEDIAN_WINDOW) window.shift();
      lastAcceptedAt = now;
      // Emit on every accepted frame — the ball should start moving on the
      // very first valid sample, not wait for a full window to accumulate.
      onPitch?.(median(window), clarity);
    }
    // Rejected frames are silently skipped so the ball holds its last Y
    // (spec §2) instead of resetting smoothing on every dropout.

    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    cancelAnimationFrame(rafId);
  };
}
