import { useEffect, useRef, useState } from 'react';
import { startPitchLoop } from '../audio/pitchDetector.js';
import {
  tonicToMidi,
  scaleMidiNotes,
  NOTE_NAMES,
} from './musicMath.js';

// Perspective projection: sx = CX + x * (f/z), sy = CY - y * (f/z).
// Camera is at world origin looking down +Z. Ball is pinned at screen z=BALL_Z_HOME;
// the "motion" is simulated by advancing ball.s along the road. Walls have absolute
// s positions, so their screen-space spacing never changes. When the ball bounces,
// ball.s decreases — so stripes and walls slide back outward — which is what sells
// the "ball went backward" visual.

const CANVAS_W = 900;
const CANVAS_H = 560;
const CX = CANVAS_W / 2;
const CY = CANVAS_H / 2;
const FOCAL = 520;

const BALL_Z_HOME = 5;          // render z of the ball (fixed)
const CONTACT_OFFSET = 0.2;      // world distance between ball.s and wall.s at contact
const SPAWN_RELZ = 50;           // keep this much road populated ahead of the ball
const CULL_RELZ = -8;            // world units behind the ball before a wall is discarded

const ROAD_Y = -1.2;
const ROAD_HALF_W = 2.6;
const STRIPE_SPACING = 2;
const WORLD_Y_BOTTOM = 0.2;
const WORLD_Y_TOP = 2.3;
// Single-octave view: tonic at the bottom, tonic+12 at the top. Pitch is not
// folded — the player must sing in the octave above the tonic (e.g. C4→C5
// when tonic=C). Multi-octave acceptance can come back later behind a flag.
const SEMITONES_IN_VIEW = 12;
const SEMI_WORLD = (WORLD_Y_TOP - WORLD_Y_BOTTOM) / SEMITONES_IN_VIEW;
// Pitch outside [tonic - this, tonic + 12 + this] semitones is ignored so
// stray harmonics/noise don't yank the ball to an edge.
const PITCH_MARGIN_SEMI = 2;

const BALL_R = 0.18;
const WALL_HALFW = 2.4;
// Walls are all the same rectangle, anchored to the ground and rising to a
// fixed height. The hole punched out at w.y is the only thing that moves
// between walls — the board itself doesn't resize or float.
const WALL_BOTTOM_Y = ROAD_Y;
const WALL_TOP_Y = WORLD_Y_TOP + 0.9;
// Ball idles below the tonic hole so the first wall (which always targets
// the tonic) is NOT a free pass — the player has to actually sing up to it.
const BALL_REST_Y = ROAD_Y + BALL_R;

const WALL_TIME_GAP_S = 2.5;
const Y_TAU = 0.1;               // dt-based smoothing time constant for ball Y
const SILENCE_MS = 180;          // no valid pitch for this long → ball sinks to rest
const VFWD_TAU = 0.7;            // 1/K for first-order relaxation of forward velocity
const BOUNCE_SPEED_MULT = 2.5;   // impulse = -baseSpeed * this on blocked contact

const DIFFICULTY = {
  beginner:     { tol: 50, speed: 7 },
  intermediate: { tol: 25, speed: 9 },
  advanced:     { tol: 15, speed: 11.5 },
};

function proj(x, y, z) {
  const scale = FOCAL / z;
  return { sx: CX + x * scale, sy: CY - y * scale, scale };
}

function scriptedNoteIndex(i, scaleLen) {
  if (i < scaleLen) return i;
  const d = i - scaleLen;
  if (d < scaleLen - 1) return scaleLen - 2 - d;
  if (i < 14) return 0;
  return Math.floor(Math.random() * scaleLen);
}

function midiToWorldY(midi, tonicMidi) {
  const semi = midi - tonicMidi;
  const clamped = Math.max(0, Math.min(SEMITONES_IN_VIEW, semi));
  return WORLD_Y_BOTTOM + (clamped / SEMITONES_IN_VIEW) * (WORLD_Y_TOP - WORLD_Y_BOTTOM);
}
function hzToMidiLocal(hz) {
  return 12 * Math.log2(hz / 440) + 69;
}
function hzToWorldY(hz, tonicMidi) {
  return midiToWorldY(hzToMidiLocal(hz), tonicMidi);
}
function isHzInRange(hz, tonicMidi) {
  if (!(hz > 0)) return false;
  const midi = hzToMidiLocal(hz);
  return midi >= tonicMidi - PITCH_MARGIN_SEMI
      && midi <= tonicMidi + SEMITONES_IN_VIEW + PITCH_MARGIN_SEMI;
}

function noteLabel(midi) {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[pc]}${octave}`;
}

export default function GameCanvas({ settings, capture }) {
  const canvasRef = useRef(null);
  const pitchHzRef = useRef(null);
  const pitchAtRef = useRef(0);
  const hudRef = useRef({ score: 0, combo: 0, inTune: false, pitchHz: null });
  const [hud, setHud] = useState({ score: 0, combo: 0, inTune: false, pitchHz: null });

  useEffect(() => {
    const diff = DIFFICULTY[settings.difficulty] ?? DIFFICULTY.beginner;
    const tonicMidi = tonicToMidi(settings.tonic, 4);
    const scaleMidis = scaleMidiNotes(tonicMidi, settings.mode);
    const cutoutR = BALL_R + (diff.tol / 100) * SEMI_WORLD;
    const baseSpeed = diff.speed;
    const WALL_SPACING = baseSpeed * WALL_TIME_GAP_S; // absolute world units — never changes
    const BOUNCE_VELOCITY = -baseSpeed * BOUNCE_SPEED_MULT;

    const state = {
      ballS: 0,
      vForward: baseSpeed,
      // Rest on the ground, below the tonic hole. Pitch drives it upward,
      // and it sinks back down when the singer stops.
      ballY: BALL_REST_Y,
      walls: [],
      wallsSpawned: 0,
      nextWallS: WALL_SPACING, // first wall one spacing ahead
      score: 0,
      combo: 0,
    };

    const stopPitch = startPitchLoop({
      ctx: capture.ctx,
      analyser: capture.analyser,
      onPitch: (hz) => {
        pitchHzRef.current = hz;
        pitchAtRef.current = performance.now();
      },
    });

    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_W * dpr;
    canvas.height = CANVAS_H * dpr;
    canvas.style.width = `${CANVAS_W}px`;
    canvas.style.height = `${CANVAS_H}px`;
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);

    const spawnAt = (wallS) => {
      const idx = scriptedNoteIndex(state.wallsSpawned, scaleMidis.length);
      const targetMidi = scaleMidis[idx];
      state.walls.push({
        s: wallS,
        y: midiToWorldY(targetMidi, tonicMidi),
        cutoutR,
        targetMidi,
        passed: false,
      });
      state.wallsSpawned++;
    };

    let rafId = 0;
    let last = performance.now();

    const drawWall = (w, renderZ) => {
      const tl = proj(-WALL_HALFW, WALL_TOP_Y, renderZ);
      const br = proj(+WALL_HALFW, WALL_BOTTOM_Y, renderZ);
      const center = proj(0, w.y, renderZ);
      const width = br.sx - tl.sx;
      const height = br.sy - tl.sy;
      if (width < 1 || height < 1) return;
      const holeR = w.cutoutR * (FOCAL / renderZ);

      g.save();
      g.beginPath();
      g.rect(tl.sx, tl.sy, width, height);
      g.clip();

      // Solid opaque fill. Subtle vertical gradient reads as a wall surface.
      const wg = g.createLinearGradient(0, tl.sy, 0, br.sy);
      if (w.passed) {
        wg.addColorStop(0, '#475569');
        wg.addColorStop(1, '#1e293b');
      } else {
        wg.addColorStop(0, '#94a3b8');
        wg.addColorStop(1, '#334155');
      }
      g.fillStyle = wg;
      g.fillRect(tl.sx, tl.sy, width, height);

      // Outer frame + inner bevel.
      g.strokeStyle = '#0f172a';
      g.lineWidth = 3;
      g.strokeRect(tl.sx + 1.5, tl.sy + 1.5, width - 3, height - 3);

      // Note label — above the hole when there's room, otherwise below.
      // Keeps the label inside the wall surface so it never clips off.
      const labelAboveY = w.y + w.cutoutR + 0.5;
      const labelBelowY = w.y - w.cutoutR - 0.5;
      const labelWorldY = labelAboveY <= WALL_TOP_Y - 0.25 ? labelAboveY : labelBelowY;
      const labelWorld = proj(0, labelWorldY, renderZ);
      const fontPx = Math.max(14, 0.6 * (FOCAL / renderZ));
      g.font = `bold ${fontPx}px system-ui, -apple-system, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = Math.max(1, fontPx * 0.1);
      g.strokeStyle = '#0f172a';
      g.strokeText(noteLabel(w.targetMidi), labelWorld.sx, labelWorld.sy);
      g.fillStyle = '#f8fafc';
      g.fillText(noteLabel(w.targetMidi), labelWorld.sx, labelWorld.sy);

      // Punch the circle hole so the ball can thread through it.
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.arc(center.sx, center.sy, holeR, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = 'source-over';

      // Ring around the hole.
      g.strokeStyle = 'rgba(165,180,252,0.95)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(center.sx, center.sy, holeR, 0, Math.PI * 2);
      g.stroke();

      g.restore();
    };

    const step = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // Pitch → world Y. Single octave: only accept pitches near [tonic, tonic+12].
      // On silence (no valid sample for SILENCE_MS), target the bottom so the ball
      // rests there instead of hanging wherever the last note left it. Smoothing
      // is dt-based so motion is framerate-independent and doesn't jitter.
      const hz = pitchHzRef.current;
      const sinceHz = now - pitchAtRef.current;
      const hzValid = hz && hz > 0 && sinceHz < SILENCE_MS && isHzInRange(hz, tonicMidi);
      let targetY;
      if (hzValid) {
        targetY = hzToWorldY(hz, tonicMidi);
      } else if (sinceHz >= SILENCE_MS) {
        targetY = BALL_REST_Y;
      } else {
        // Short dropout (out-of-range blip, one stale frame) — hold.
        targetY = state.ballY;
      }
      const alphaY = 1 - Math.exp(-dt / Y_TAU);
      state.ballY += (targetY - state.ballY) * alphaY;

      // Forward velocity relaxes toward baseSpeed (first-order). After a
      // bounce this carries vForward smoothly from a large negative impulse
      // back through zero up to baseSpeed — the "slows, stops, speeds back up"
      // described in the spec.
      state.vForward += (baseSpeed - state.vForward) * (dt / VFWD_TAU);

      let proposedS = state.ballS + state.vForward * dt;

      // Front = closest non-passed wall.
      let front = null;
      for (const w of state.walls) {
        if (!w.passed && (!front || w.s < front.s)) front = w;
      }

      if (front) {
        const wallFrontS = front.s - CONTACT_OFFSET;
        const aligned = Math.abs(state.ballY - front.y) < (front.cutoutR - BALL_R);
        if (proposedS >= wallFrontS) {
          if (aligned) {
            front.passed = true;
            state.combo += 1;
            const mult = Math.min(1 + state.combo / 5, 5);
            state.score += Math.round(mult);
            state.ballS = proposedS;
          } else {
            // Blocked. Clamp position, slam velocity negative so the ball
            // noticeably recoils before the spring pulls it forward again.
            state.ballS = wallFrontS;
            state.vForward = BOUNCE_VELOCITY;
            state.combo = 0;
          }
        } else {
          state.ballS = proposedS;
        }
      } else {
        state.ballS = proposedS;
      }

      // Keep the road ahead populated. Walls sit at absolute s positions, so
      // consecutive walls are always exactly WALL_SPACING apart regardless of
      // how the ball is moving.
      while (state.nextWallS - state.ballS <= SPAWN_RELZ) {
        spawnAt(state.nextWallS);
        state.nextWallS += WALL_SPACING;
      }
      state.walls = state.walls.filter((w) => w.s - state.ballS > CULL_RELZ);

      // Aligned-with-front feedback (sphere turns green).
      let inTune = false;
      if (front && !front.passed) {
        const aligned = Math.abs(state.ballY - front.y) < (front.cutoutR - BALL_R);
        const relZ = front.s - state.ballS;
        if (aligned && relZ < 20) inTune = true;
      }

      // --- Render ---
      const sky = g.createLinearGradient(0, 0, 0, CY);
      sky.addColorStop(0, '#0b1020');
      sky.addColorStop(1, '#1e1b4b');
      g.fillStyle = sky;
      g.fillRect(0, 0, CANVAS_W, CY);
      const ground = g.createLinearGradient(0, CY, 0, CANVAS_H);
      ground.addColorStop(0, '#1f2937');
      ground.addColorStop(1, '#0f172a');
      g.fillStyle = ground;
      g.fillRect(0, CY, CANVAS_W, CANVAS_H - CY);

      // Road polygon.
      const nearL = proj(-ROAD_HALF_W, ROAD_Y, 0.8);
      const nearR = proj(+ROAD_HALF_W, ROAD_Y, 0.8);
      const farL  = proj(-ROAD_HALF_W, ROAD_Y, SPAWN_RELZ + BALL_Z_HOME);
      const farR  = proj(+ROAD_HALF_W, ROAD_Y, SPAWN_RELZ + BALL_Z_HOME);
      g.fillStyle = '#111827';
      g.beginPath();
      g.moveTo(nearL.sx, nearL.sy);
      g.lineTo(nearR.sx, nearR.sy);
      g.lineTo(farR.sx, farR.sy);
      g.lineTo(farL.sx, farL.sy);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(129,140,248,0.35)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(nearL.sx, nearL.sy); g.lineTo(farL.sx, farL.sy);
      g.moveTo(nearR.sx, nearR.sy); g.lineTo(farR.sx, farR.sy);
      g.stroke();

      // Stripes are anchored to ball.s. When ball.s decreases during a bounce
      // these automatically slide outward — the road itself shows the ball
      // moving backward, without any separate animation state.
      const stripePhase = ((state.ballS % STRIPE_SPACING) + STRIPE_SPACING) % STRIPE_SPACING;
      const maxZ = SPAWN_RELZ + BALL_Z_HOME;
      for (let zWorld = STRIPE_SPACING - stripePhase; zWorld < maxZ; zWorld += STRIPE_SPACING) {
        if (zWorld < 0.8) continue;
        const L = proj(-ROAD_HALF_W, ROAD_Y, zWorld);
        const R = proj(+ROAD_HALF_W, ROAD_Y, zWorld);
        const alpha = Math.max(0, 1 - zWorld / maxZ);
        g.strokeStyle = `rgba(148,163,184,${0.06 + 0.3 * alpha})`;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(L.sx, L.sy);
        g.lineTo(R.sx, R.sy);
        g.stroke();
      }

      // Walls split around the sphere so passed walls (closer to camera than
      // the ball) render ON TOP of the sphere, matching their depth.
      const renderable = state.walls
        .map((w) => ({ w, renderZ: (w.s - state.ballS) + BALL_Z_HOME }))
        .filter((r) => r.renderZ > 0.4)
        .sort((a, b) => b.renderZ - a.renderZ);

      for (const r of renderable) {
        if (r.renderZ > BALL_Z_HOME) drawWall(r.w, r.renderZ);
      }

      // Ball shadow on road.
      const ballScreenR = BALL_R * (FOCAL / BALL_Z_HOME);
      const shadowProj = proj(0, ROAD_Y, BALL_Z_HOME);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.ellipse(
        shadowProj.sx, shadowProj.sy,
        ballScreenR * 1.1, ballScreenR * 0.35,
        0, 0, Math.PI * 2,
      );
      g.fill();

      // Sphere.
      const ballProj = proj(0, state.ballY, BALL_Z_HOME);
      const grad = g.createRadialGradient(
        ballProj.sx - ballScreenR * 0.35, ballProj.sy - ballScreenR * 0.4, ballScreenR * 0.1,
        ballProj.sx, ballProj.sy, ballScreenR,
      );
      if (inTune) {
        grad.addColorStop(0, '#d1fae5');
        grad.addColorStop(1, '#059669');
      } else {
        grad.addColorStop(0, '#f8fafc');
        grad.addColorStop(1, '#64748b');
      }
      g.fillStyle = grad;
      g.beginPath();
      g.arc(ballProj.sx, ballProj.sy, ballScreenR, 0, Math.PI * 2);
      g.fill();

      // Walls that are already behind the ball render on top of it.
      for (const r of renderable) {
        if (r.renderZ <= BALL_Z_HOME) drawWall(r.w, r.renderZ);
      }

      const prev = hudRef.current;
      const pitchHz = hzValid ? hz : null;
      // Avoid React re-renders for sub-Hz pitch wiggle — only push when it
      // changes meaningfully, or on score/combo/tune changes.
      const pitchChanged =
        (pitchHz == null) !== (prev.pitchHz == null) ||
        (pitchHz != null && Math.abs(pitchHz - (prev.pitchHz ?? 0)) > 1);
      if (
        prev.score !== state.score ||
        prev.combo !== state.combo ||
        prev.inTune !== inTune ||
        pitchChanged
      ) {
        const next = { score: state.score, combo: state.combo, inTune, pitchHz };
        hudRef.current = next;
        setHud(next);
      }

      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(rafId);
      stopPitch();
    };
  }, [capture, settings]);

  const mult = Math.min(1 + hud.combo / 5, 5);
  const pitchLabel = hud.pitchHz
    ? (() => {
        const midi = 12 * Math.log2(hud.pitchHz / 440) + 69;
        const rounded = Math.round(midi);
        const pc = ((rounded % 12) + 12) % 12;
        const octave = Math.floor(rounded / 12) - 1;
        const cents = Math.round((midi - rounded) * 100);
        const sign = cents > 0 ? '+' : '';
        return `${NOTE_NAMES[pc]}${octave} ${sign}${cents}¢ · ${hud.pitchHz.toFixed(1)} Hz`;
      })()
    : '—';

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex w-full max-w-[900px] items-center justify-between text-sm">
        <div className="flex items-center gap-4">
          <div>
            <span className="text-slate-400">Score </span>
            <span className="font-mono text-lg">{hud.score}</span>
          </div>
          <div>
            <span className="text-slate-400">Combo </span>
            <span className="font-mono">{hud.combo}</span>
            <span className="ml-1 text-xs text-slate-500">×{mult.toFixed(1)}</span>
          </div>
        </div>
        <div className="font-mono text-xs text-slate-400">
          <span className="text-slate-500">Pitch </span>
          <span className={hud.pitchHz ? 'text-slate-200' : 'text-slate-600'}>{pitchLabel}</span>
        </div>
      </div>
      <canvas ref={canvasRef} className="rounded-xl border border-white/10 bg-slate-950" />
    </div>
  );
}
