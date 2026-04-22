import { PitchDetector } from 'pitchy';

const CLARITY_THRESHOLD = 0.9;
const MEDIAN_WINDOW = 5;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// Starts a RAF loop that reads time-domain data from the given AnalyserNode,
// runs pitchy, gates on clarity ≥ 0.90, applies a 5-frame rolling median over
// accepted frames, and calls onPitch(smoothedHz, clarity) each time the window
// is full. Returns a stop() function.
export function startPitchLoop({ ctx, analyser, onPitch }) {
  const detector = PitchDetector.forFloat32Array(analyser.fftSize);
  const buffer = new Float32Array(analyser.fftSize);
  const window = [];
  let rafId = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    analyser.getFloatTimeDomainData(buffer);
    const [hz, clarity] = detector.findPitch(buffer, ctx.sampleRate);

    if (Number.isFinite(hz) && hz > 0 && clarity >= CLARITY_THRESHOLD) {
      window.push(hz);
      if (window.length > MEDIAN_WINDOW) window.shift();
      if (window.length === MEDIAN_WINDOW) {
        onPitch?.(median(window), clarity);
      }
    } else {
      // Break smoothing continuity on silence / noisy frames so the median
      // doesn't drag stale pitch into a new phrase.
      if (window.length) window.length = 0;
    }

    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    cancelAnimationFrame(rafId);
  };
}
