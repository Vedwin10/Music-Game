import { useEffect, useRef, useState } from 'react';
import { startPitchLoop } from '../audio/pitchDetector.js';
import {
  tonicToMidi,
  scaleMidiNotes,
  foldToUpperOctave,
} from './musicMath.js';

// 3D illusion done with a plain canvas-2D perspective projection:
//   sx = CX + x * (FOCAL / z)
//   sy = CY - y * (FOCAL / z)
// The camera sits at the origin looking down +Z. The sphere is pinned at
// z = BALL_Z_HOME; walls spawn at SPAWN_Z and scroll toward the camera.
// The "forward motion" illusion comes from (a) the receding road stripes
// advancing via roadOffset and (b) walls approaching z=0.

const CANVAS_W = 900;
const CANVAS_H = 560;
const CX = CANVAS_W / 2;
const CY = CANVAS_H / 2;
const FOCAL = 520;

const BALL_Z_HOME = 5;
const CONTACT_Z = BALL_Z_HOME + 0.2;
const SPAWN_Z = 55;
const CULL_Z = 0.35;
const MIN_WALL_SPACING = 4; // world units between queued walls

const ROAD_Y = -1.2;
const ROAD_HALF_W = 2.6;
const WORLD_Y_BOTTOM = 0.2;
const WORLD_Y_TOP = 2.3;
const SEMI_WORLD = (WORLD_Y_TOP - WORLD_Y_BOTTOM) / 18;

const BALL_R = 0.18;
const WALL_HALFW = 2.4;
const WALL_HALFH = 1.6;

const WALL_INTERVAL_MS = 2500;
const LERP = 0.3;

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
  if (i < scaleLen) return i;                  // ascending 0..6
  const d = i - scaleLen;
  if (d < scaleLen - 1) return scaleLen - 2 - d; // descending 5..0
  if (i < 14) return 0;                         // tonic anchor at wall 13
  return Math.floor(Math.random() * scaleLen);  // random in-key after 14
}

function midiToWorldY(midi, tonicMidi) {
  const semi = midi - (tonicMidi - 4); // 0..18
  return WORLD_Y_BOTTOM + (semi / 18) * (WORLD_Y_TOP - WORLD_Y_BOTTOM);
}
function hzToWorldY(hz, tonicMidi) {
  const midi = 12 * Math.log2(hz / 440) + 69;
  return midiToWorldY(midi, tonicMidi);
}

export default function GameCanvas({ settings, capture }) {
  const canvasRef = useRef(null);
  const pitchHzRef = useRef(null);
  const hudRef = useRef({ score: 0, combo: 0, inTune: false });
  const [hud, setHud] = useState({ score: 0, combo: 0, inTune: false });

  useEffect(() => {
    const diff = DIFFICULTY[settings.difficulty] ?? DIFFICULTY.beginner;
    const tonicMidi = tonicToMidi(settings.tonic, 4);
    const scaleMidis = scaleMidiNotes(tonicMidi, settings.mode);
    const cutoutR = BALL_R + (diff.tol / 100) * SEMI_WORLD;

    const state = {
      ball: {
        y: midiToWorldY(tonicMidi, tonicMidi),
        zOffset: 0,
        vz: 0,
      },
      walls: [],
      wallsSpawned: 0,
      msSinceSpawn: WALL_INTERVAL_MS, // spawn on first frame
      roadOffset: 0,
      score: 0,
      combo: 0,
    };

    const stopPitch = startPitchLoop({
      ctx: capture.ctx,
      analyser: capture.analyser,
      onPitch: (hz) => { pitchHzRef.current = hz; },
    });

    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_W * dpr;
    canvas.height = CANVAS_H * dpr;
    canvas.style.width = `${CANVAS_W}px`;
    canvas.style.height = `${CANVAS_H}px`;
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);

    const spawnWall = () => {
      const idx = scriptedNoteIndex(state.wallsSpawned, scaleMidis.length);
      const targetMidi = scaleMidis[idx];
      state.walls.push({
        z: SPAWN_Z,
        y: midiToWorldY(targetMidi, tonicMidi),
        cutoutR,
        targetMidi,
        passed: false,
        pinned: false,
      });
      state.wallsSpawned++;
    };

    let rafId = 0;
    let last = performance.now();

    const step = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      state.msSinceSpawn += dt * 1000;
      if (state.msSinceSpawn >= WALL_INTERVAL_MS) {
        state.msSinceSpawn = 0;
        spawnWall();
      }
      state.roadOffset = (state.roadOffset + diff.speed * dt) % 2;

      // --- Pitch → world Y (lerped) ---
      const hz = pitchHzRef.current;
      if (hz && hz > 0) {
        const folded = foldToUpperOctave(hz, tonicMidi);
        const targetY = hzToWorldY(folded, tonicMidi);
        state.ball.y += (targetY - state.ball.y) * LERP;
      }

      // --- Ball z-bounce: spring back toward home (zOffset = 0) ---
      // Negative zOffset = ball pushed toward camera (visibly "bounced back").
      const K = 55, C = 6;
      state.ball.vz += (-K * state.ball.zOffset - C * state.ball.vz) * dt;
      state.ball.zOffset += state.ball.vz * dt;
      const ballZ = BALL_Z_HOME + state.ball.zOffset;

      // --- Walls ---
      // Only the front-most non-passed wall can reach the ball. Others queue
      // behind it with a minimum spacing so new walls don't stack on a pinned
      // wall while the singer is still trying to match its pitch.
      const notPassed = state.walls.filter((w) => !w.passed).sort((a, b) => a.z - b.z);
      const front = notPassed[0] ?? null;

      let inTune = false;

      for (const w of state.walls) {
        if (w.passed) {
          // After passing, wall continues toward/past the camera until culled.
          w.z -= diff.speed * dt;
          continue;
        }

        const aligned = Math.abs(state.ball.y - w.y) < (w.cutoutR - BALL_R);

        if (w === front) {
          if (!w.pinned) {
            w.z -= diff.speed * dt;
            if (w.z <= CONTACT_Z) {
              if (aligned) {
                // Sphere threads the circle → wall passes through.
                w.passed = true;
                state.combo += 1;
                const mult = Math.min(1 + state.combo / 5, 5);
                state.score += Math.round(mult);
              } else {
                // Blocked. Pin the wall at the contact plane, kick the sphere
                // toward the camera so it visibly rebounds.
                w.z = CONTACT_Z;
                w.pinned = true;
                state.ball.vz = -6;
                state.combo = 0;
              }
            }
          } else {
            if (aligned) {
              w.pinned = false;
              w.passed = true;
              state.combo += 1;
              const mult = Math.min(1 + state.combo / 5, 5);
              state.score += Math.round(mult);
            } else if (Math.abs(state.ball.zOffset) < 0.08 && Math.abs(state.ball.vz) < 0.6) {
              // Sphere has settled back against the pinned wall while still
              // off-pitch — re-kick so it keeps bouncing visibly.
              state.ball.vz = -6;
            }
          }
          if (aligned && w.z < 15) inTune = true;
        } else {
          // Queued behind the front wall: advance only up to the min spacing.
          const stopZ = Math.max(CONTACT_Z, front.z + MIN_WALL_SPACING);
          if (w.z > stopZ) {
            w.z -= diff.speed * dt;
            if (w.z < stopZ) w.z = stopZ;
          }
        }
      }
      state.walls = state.walls.filter((w) => w.z > CULL_Z);

      // --- Render ---
      // Sky
      const sky = g.createLinearGradient(0, 0, 0, CY);
      sky.addColorStop(0, '#0b1020');
      sky.addColorStop(1, '#1e1b4b');
      g.fillStyle = sky;
      g.fillRect(0, 0, CANVAS_W, CY);
      // Ground fill (everything below horizon, behind the road polygon)
      const ground = g.createLinearGradient(0, CY, 0, CANVAS_H);
      ground.addColorStop(0, '#1f2937');
      ground.addColorStop(1, '#0f172a');
      g.fillStyle = ground;
      g.fillRect(0, CY, CANVAS_W, CANVAS_H - CY);

      // Road polygon
      const nearL = proj(-ROAD_HALF_W, ROAD_Y, 0.8);
      const nearR = proj(+ROAD_HALF_W, ROAD_Y, 0.8);
      const farL  = proj(-ROAD_HALF_W, ROAD_Y, SPAWN_Z);
      const farR  = proj(+ROAD_HALF_W, ROAD_Y, SPAWN_Z);
      g.fillStyle = '#111827';
      g.beginPath();
      g.moveTo(nearL.sx, nearL.sy);
      g.lineTo(nearR.sx, nearR.sy);
      g.lineTo(farR.sx, farR.sy);
      g.lineTo(farL.sx, farL.sy);
      g.closePath();
      g.fill();

      // Road edges
      g.strokeStyle = 'rgba(129,140,248,0.35)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(nearL.sx, nearL.sy); g.lineTo(farL.sx, farL.sy);
      g.moveTo(nearR.sx, nearR.sy); g.lineTo(farR.sx, farR.sy);
      g.stroke();

      // Receding rungs — these sell the forward-motion illusion.
      for (let zS = 2 - state.roadOffset; zS < SPAWN_Z; zS += 2) {
        if (zS < 0.8) continue;
        const L = proj(-ROAD_HALF_W, ROAD_Y, zS);
        const R = proj(+ROAD_HALF_W, ROAD_Y, zS);
        const alpha = Math.max(0, 1 - zS / SPAWN_Z);
        g.strokeStyle = `rgba(148,163,184,${0.06 + 0.28 * alpha})`;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(L.sx, L.sy);
        g.lineTo(R.sx, R.sy);
        g.stroke();
      }

      // Walls: painter's algorithm, far to near.
      const sortedWalls = [...state.walls].sort((a, b) => b.z - a.z);
      for (const w of sortedWalls) {
        const tl = proj(-WALL_HALFW, w.y + WALL_HALFH, w.z);
        const br = proj(+WALL_HALFW, w.y - WALL_HALFH, w.z);
        const center = proj(0, w.y, w.z);
        const width = br.sx - tl.sx;
        const height = br.sy - tl.sy;
        if (width < 1 || height < 1) continue;
        const holeR = w.cutoutR * (FOCAL / w.z);

        g.save();
        // Clip to the wall rect so destination-out only punches this wall.
        g.beginPath();
        g.rect(tl.sx, tl.sy, width, height);
        g.clip();

        g.fillStyle = w.pinned ? 'rgba(244,63,94,0.88)' : 'rgba(71,85,105,0.96)';
        g.fillRect(tl.sx, tl.sy, width, height);
        g.strokeStyle = 'rgba(15,23,42,0.9)';
        g.lineWidth = 2;
        g.strokeRect(tl.sx + 1, tl.sy + 1, width - 2, height - 2);

        // Punch the circular hole.
        g.globalCompositeOperation = 'destination-out';
        g.beginPath();
        g.arc(center.sx, center.sy, holeR, 0, Math.PI * 2);
        g.fill();
        g.globalCompositeOperation = 'source-over';

        // Ring around the hole so it reads as a target.
        g.strokeStyle = w.pinned ? 'rgba(253,164,175,0.95)' : 'rgba(165,180,252,0.85)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(center.sx, center.sy, holeR, 0, Math.PI * 2);
        g.stroke();

        g.restore();
      }

      // Sphere shadow on the road.
      const shadowProj = proj(0, ROAD_Y, ballZ);
      const ballScreenR = BALL_R * (FOCAL / ballZ);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.ellipse(
        shadowProj.sx, shadowProj.sy,
        ballScreenR * 1.1, ballScreenR * 0.35,
        0, 0, Math.PI * 2,
      );
      g.fill();

      // Sphere.
      const ballProj = proj(0, state.ball.y, ballZ);
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

      // HUD sync (only on change).
      const prev = hudRef.current;
      if (prev.score !== state.score || prev.combo !== state.combo || prev.inTune !== inTune) {
        const next = { score: state.score, combo: state.combo, inTune };
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
      </div>
      <canvas ref={canvasRef} className="rounded-xl border border-white/10 bg-slate-950" />
    </div>
  );
}
