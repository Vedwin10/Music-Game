// Pure music-math helpers used by Phase 3/4: scale generation, dual-octave
// pitch matching, and frequency → canvas-Y mapping. No DOM, no audio nodes —
// everything here is unit-testable.

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const A4_MIDI = 69;
export const A4_HZ = 440;

const MAJOR_STEPS = [2, 2, 1, 2, 2, 2, 1];
const MINOR_STEPS = [2, 1, 2, 2, 1, 2, 2];

export function midiToHz(midi) {
  return A4_HZ * Math.pow(2, (midi - A4_MIDI) / 12);
}

export function hzToMidi(hz) {
  return 12 * Math.log2(hz / A4_HZ) + A4_MIDI;
}

// MIDI convention: C-1 = 0, C4 = 60. Default octave 4 puts the tonic in a
// comfortable vocal range; dual-octave acceptance (§3) lets lower voices
// sing the same notes an octave down.
export function tonicToMidi(tonicName, octave = 4) {
  const pc = NOTE_NAMES.indexOf(tonicName);
  if (pc < 0) throw new Error(`Unknown tonic: ${tonicName}`);
  return 12 * (octave + 1) + pc;
}

export function scaleIntervals(mode) {
  if (mode === 'Major') return MAJOR_STEPS;
  if (mode === 'Minor') return MINOR_STEPS;
  throw new Error(`Unknown mode: ${mode}`);
}

// Seven ascending MIDI notes starting at the tonic (no octave repeat).
export function scaleMidiNotes(tonicMidi, mode) {
  const steps = scaleIntervals(mode);
  const notes = [tonicMidi];
  let cur = tonicMidi;
  for (let i = 0; i < steps.length - 1; i++) {
    cur += steps[i];
    notes.push(cur);
  }
  return notes;
}

export function scaleFrequencies(tonicName, mode, octave = 4) {
  return scaleMidiNotes(tonicToMidi(tonicName, octave), mode).map(midiToHz);
}

export function centsBetween(fDetected, fReference) {
  return 1200 * Math.log2(fDetected / fReference);
}

// Dual-octave acceptance (§3). A frame is accepted if |cents(det, target)| ≤
// tol or |cents(det, target/2)| ≤ tol. `branch` tells the caller which match
// won — useful for folding the rendered ball into the upper octave. When
// neither branch is within tolerance, still report the closer one and its
// cents distance so the UI can show "sharp/flat by N cents".
export function matchPitch(fDetected, fTarget, toleranceCents) {
  if (!(fDetected > 0) || !(fTarget > 0)) {
    return { accepted: false, branch: null, cents: NaN };
  }
  const upCents = centsBetween(fDetected, fTarget);
  const downCents = centsBetween(fDetected, fTarget / 2);
  if (Math.abs(upCents) <= toleranceCents) {
    return { accepted: true, branch: 'normal', cents: upCents };
  }
  if (Math.abs(downCents) <= toleranceCents) {
    return { accepted: true, branch: 'down', cents: downCents };
  }
  return Math.abs(upCents) <= Math.abs(downCents)
    ? { accepted: false, branch: 'normal', cents: upCents }
    : { accepted: false, branch: 'down', cents: downCents };
}

// Shift the frequency up by whole octaves until its MIDI value is ≥ tonicMidi.
// Keeps the rendered ball in the upper octave regardless of which branch the
// singer is on (§3).
export function foldToUpperOctave(hz, tonicMidi) {
  if (!(hz > 0)) return hz;
  const midi = hzToMidi(hz);
  if (midi >= tonicMidi) return hz;
  const octavesUp = Math.ceil((tonicMidi - midi) / 12);
  return hz * Math.pow(2, octavesUp);
}

// 18-semitone window centered such that the tonic sits 4 semitones from the
// bottom (§4). Higher pitch → smaller Y (canvas origin is top-left). Pitches
// outside the window clamp to the nearest edge; the caller decides what that
// means for collision.
export function hzToCanvasY(hz, tonicMidi, canvasHeight) {
  const bottomMidi = tonicMidi - 4;
  const topMidi = tonicMidi + 14;
  const midi = hzToMidi(hz);
  const t = (midi - bottomMidi) / (topMidi - bottomMidi);
  const clamped = Math.max(0, Math.min(1, t));
  return canvasHeight * (1 - clamped);
}

// Convenience for wall placement: gap center Y for a given target MIDI note.
export function midiToCanvasY(midi, tonicMidi, canvasHeight) {
  return hzToCanvasY(midiToHz(midi), tonicMidi, canvasHeight);
}
