import { describe, it, expect } from 'vitest';
import {
  tonicToMidi,
  midiToHz,
  hzToMidi,
  scaleMidiNotes,
  scaleFrequencies,
  centsBetween,
  matchPitch,
  foldToUpperOctave,
  hzToCanvasY,
} from './musicMath.js';

const closeTo = (a, b, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('MIDI ↔ Hz', () => {
  it('A4 = 440 Hz', () => closeTo(midiToHz(69), 440));
  it('C4 = 60 → ~261.626 Hz', () => closeTo(midiToHz(60), 261.6255653, 1e-4));
  it('hzToMidi is the inverse of midiToHz', () => {
    for (const m of [36, 48, 60, 69, 72, 84]) closeTo(hzToMidi(midiToHz(m)), m, 1e-9);
  });
});

describe('tonicToMidi', () => {
  it('C4 = 60', () => expect(tonicToMidi('C', 4)).toBe(60));
  it('A4 = 69', () => expect(tonicToMidi('A', 4)).toBe(69));
  it('F#3 = 54', () => expect(tonicToMidi('F#', 3)).toBe(54));
  it('throws on unknown note', () => expect(() => tonicToMidi('H')).toThrow());
});

describe('scaleMidiNotes', () => {
  it('C major = C D E F G A B', () => {
    expect(scaleMidiNotes(60, 'Major')).toEqual([60, 62, 64, 65, 67, 69, 71]);
  });
  it('A natural minor = A B C D E F G', () => {
    expect(scaleMidiNotes(69, 'Minor')).toEqual([69, 71, 72, 74, 76, 77, 79]);
  });
  it('G major starts at G, has F#', () => {
    const notes = scaleMidiNotes(tonicToMidi('G', 4), 'Major');
    expect(notes).toEqual([67, 69, 71, 72, 74, 76, 78]); // G A B C D E F#
  });
});

describe('scaleFrequencies', () => {
  it('C4 major starts at ~261.626 Hz', () => {
    const [c, d, e] = scaleFrequencies('C', 'Major', 4);
    closeTo(c, 261.6255653, 1e-4);
    closeTo(d, 293.6647679, 1e-4);
    closeTo(e, 329.6275569, 1e-4);
  });
  it('returns 7 frequencies', () => {
    expect(scaleFrequencies('D', 'Minor', 4)).toHaveLength(7);
  });
});

describe('centsBetween', () => {
  it('same freq = 0 cents', () => closeTo(centsBetween(440, 440), 0));
  it('octave up = +1200 cents', () => closeTo(centsBetween(880, 440), 1200));
  it('semitone up = +100 cents', () => closeTo(centsBetween(midiToHz(70), midiToHz(69)), 100, 1e-9));
});

describe('matchPitch (dual-octave acceptance)', () => {
  const target = 440; // A4

  it('accepts exact match as normal branch', () => {
    const r = matchPitch(440, target, 25);
    expect(r.accepted).toBe(true);
    expect(r.branch).toBe('normal');
  });

  it('accepts within tolerance', () => {
    // +20 cents
    const sharp = 440 * Math.pow(2, 20 / 1200);
    const r = matchPitch(sharp, target, 25);
    expect(r.accepted).toBe(true);
    expect(r.branch).toBe('normal');
    closeTo(r.cents, 20, 1e-6);
  });

  it('rejects outside tolerance', () => {
    const sharp = 440 * Math.pow(2, 60 / 1200);
    const r = matchPitch(sharp, target, 25);
    expect(r.accepted).toBe(false);
  });

  it('accepts the down octave (f_target / 2)', () => {
    const r = matchPitch(220, target, 25);
    expect(r.accepted).toBe(true);
    expect(r.branch).toBe('down');
  });

  it('rejects the up octave', () => {
    // Singing A5 (880 Hz) when the target is A4 — should NOT be accepted.
    const r = matchPitch(880, target, 50);
    expect(r.accepted).toBe(false);
  });

  it('handles zero / negative safely', () => {
    expect(matchPitch(0, 440, 25).accepted).toBe(false);
    expect(matchPitch(440, 0, 25).accepted).toBe(false);
  });
});

describe('foldToUpperOctave', () => {
  it('leaves pitches ≥ tonic unchanged', () => {
    expect(foldToUpperOctave(440, 69)).toBe(440); // A4 at tonic A4
    expect(foldToUpperOctave(880, 69)).toBe(880); // A5 at tonic A4
  });
  it('folds pitches below tonic up by octaves', () => {
    // Singing A3 (220 Hz) with tonic A4 (MIDI 69) → fold to A4 (440 Hz).
    closeTo(foldToUpperOctave(220, 69), 440, 1e-9);
  });
  it('folds multiple octaves if needed', () => {
    // A2 with tonic A4 → A4.
    closeTo(foldToUpperOctave(110, 69), 440, 1e-9);
  });
  it('folds into [tonic, tonic+12) for a pitch just below tonic', () => {
    // G4 (midi 67) with tonic A4 (midi 69) → fold up one octave to G5 (midi 79).
    const g4 = midiToHz(67);
    closeTo(hzToMidi(foldToUpperOctave(g4, 69)), 79, 1e-9);
  });
});

describe('hzToCanvasY', () => {
  const HEIGHT = 600;
  const TONIC_MIDI = 60; // C4

  it('tonic sits 4/18 of the way up from the bottom', () => {
    const y = hzToCanvasY(midiToHz(TONIC_MIDI), TONIC_MIDI, HEIGHT);
    closeTo(y, HEIGHT * (1 - 4 / 18));
  });

  it('top of window maps to y=0', () => {
    const y = hzToCanvasY(midiToHz(TONIC_MIDI + 14), TONIC_MIDI, HEIGHT);
    closeTo(y, 0, 1e-9);
  });

  it('bottom of window maps to y=HEIGHT', () => {
    const y = hzToCanvasY(midiToHz(TONIC_MIDI - 4), TONIC_MIDI, HEIGHT);
    closeTo(y, HEIGHT, 1e-9);
  });

  it('semitone spacing is uniform in pixels', () => {
    const yA = hzToCanvasY(midiToHz(TONIC_MIDI + 5), TONIC_MIDI, HEIGHT);
    const yB = hzToCanvasY(midiToHz(TONIC_MIDI + 6), TONIC_MIDI, HEIGHT);
    const yC = hzToCanvasY(midiToHz(TONIC_MIDI + 7), TONIC_MIDI, HEIGHT);
    closeTo(yA - yB, yB - yC, 1e-9);
    closeTo(yA - yB, HEIGHT / 18, 1e-9);
  });

  it('higher pitch yields smaller Y', () => {
    const low = hzToCanvasY(midiToHz(TONIC_MIDI), TONIC_MIDI, HEIGHT);
    const high = hzToCanvasY(midiToHz(TONIC_MIDI + 7), TONIC_MIDI, HEIGHT);
    expect(high).toBeLessThan(low);
  });

  it('clamps pitches above the window to y=0', () => {
    expect(hzToCanvasY(midiToHz(TONIC_MIDI + 50), TONIC_MIDI, HEIGHT)).toBe(0);
  });

  it('clamps pitches below the window to y=HEIGHT', () => {
    expect(hzToCanvasY(midiToHz(TONIC_MIDI - 20), TONIC_MIDI, HEIGHT)).toBe(HEIGHT);
  });
});
