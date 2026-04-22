import { useEffect, useRef, useState } from 'react';
import { startPitchLoop } from '../audio/pitchDetector.js';
import {
  tonicToMidi,
  scaleMidiNotes,
  midiToHz,
  foldToUpperOctave,
  hzToCanvasY,
  midiToCanvasY,
} from './musicMath.js';

const CANVAS_W = 900;
const CANVAS_H = 520;
const WALL_WIDTH = 44;
const WALL_INTERVAL_MS = 2500;
const BALL_RADIUS = 18;
const LERP = 0.3;

const DIFFICULTY = {
  beginner:     { tol: 50, gapSemi: 3,   speed: 120, lives: 3 },
  intermediate: { tol: 25, gapSemi: 1.5, speed: 160, lives: 2 },
  advanced:     { tol: 15, gapSemi: 1,   speed: 200, lives: 1 },
};

// First 14 walls: ascend 0..6, descend 5..0 (7+6=13), then one extra
// descending tonic; afterwards a random in-key sequence.
function scriptedNoteIndex(wallIdx, scaleLen) {
  if (wallIdx < scaleLen) return wallIdx;                 // 0..6
  const d = wallIdx - scaleLen;                            // 7..
  if (d < scaleLen - 1) return scaleLen - 2 - d;           // 5..0 (6 walls)
  if (wallIdx < 14) return 0;                              // one tonic anchor
  return Math.floor(Math.random() * scaleLen);
}

export default function GameCanvas({ settings, capture }) {
  const canvasRef = useRef(null);
  const pitchHzRef = useRef(null);
  const hudRef = useRef({ score: 0, lives: 0, combo: 0, inTune: false });
  const [hud, setHud] = useState({ score: 0, lives: 0, combo: 0, inTune: false });
  const [gameOver, setGameOver] = useState(null);
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const diff = DIFFICULTY[settings.difficulty] ?? DIFFICULTY.beginner;
    const tonicMidi = tonicToMidi(settings.tonic, 4);
    const scaleMidis = scaleMidiNotes(tonicMidi, settings.mode);
    const pxPerSemi = CANVAS_H / 18;
    const tolSemis = diff.tol / 100;
    const gapHeight = 2 * BALL_RADIUS + 2 * tolSemis * pxPerSemi;
    const homeX = CANVAS_W * 0.22;

    const state = {
      ball: { x: homeX, y: CANVAS_H / 2, vx: 0 },
      walls: [],
      wallsSpawned: 0,
      msSinceSpawn: WALL_INTERVAL_MS, // spawn immediately on first frame
      score: 0,
      lives: diff.lives,
      combo: 0,
      longestCombo: 0,
      hits: 0,
      misses: 0,
      activeWall: null,
      over: false,
      overEmitted: false,
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
        x: CANVAS_W,
        gapY: midiToCanvasY(targetMidi, tonicMidi, CANVAS_H),
        gapHeight,
        targetMidi,
        targetHz: midiToHz(targetMidi),
        passed: false,
        collided: false,
      });
      state.wallsSpawned++;
    };

    let rafId = 0;
    let last = performance.now();

    const step = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (!state.over) {
        state.msSinceSpawn += dt * 1000;
        if (state.msSinceSpawn >= WALL_INTERVAL_MS) {
          state.msSinceSpawn = 0;
          spawnWall();
        }

        // Pitch → Y (lerped).
        const hz = pitchHzRef.current;
        let targetY = state.ball.y;
        if (hz && hz > 0) {
          const folded = foldToUpperOctave(hz, tonicMidi);
          targetY = hzToCanvasY(folded, tonicMidi, CANVAS_H);
        }
        state.ball.y += (targetY - state.ball.y) * LERP;

        // Ball X: spring back to homeX. Collisions inject a leftward impulse
        // (TikTok-bounce), then the spring/damping carries it forward again.
        const k = 55;   // spring stiffness
        const c = 8;    // damping
        state.ball.vx += (homeX - state.ball.x) * k * dt;
        state.ball.vx -= state.ball.vx * c * dt;
        state.ball.x += state.ball.vx * dt;

        // Walls scroll left.
        for (const w of state.walls) w.x -= diff.speed * dt;

        // Collision + scoring.
        for (const w of state.walls) {
          const overlapX =
            w.x < state.ball.x + BALL_RADIUS && w.x + WALL_WIDTH > state.ball.x - BALL_RADIUS;
          if (!w.collided && !w.passed && overlapX) {
            const gapTop = w.gapY - w.gapHeight / 2;
            const gapBot = w.gapY + w.gapHeight / 2;
            const ballTop = state.ball.y - BALL_RADIUS;
            const ballBot = state.ball.y + BALL_RADIUS;
            const inGap = ballTop >= gapTop && ballBot <= gapBot;
            if (!inGap) {
              w.collided = true;
              state.lives -= 1;
              state.combo = 0;
              state.misses += 1;
              state.ball.vx = -480; // bounce impulse
              if (state.lives <= 0) state.over = true;
            }
          }
          if (!w.passed && !w.collided && w.x + WALL_WIDTH < state.ball.x - BALL_RADIUS) {
            w.passed = true;
            state.hits += 1;
            state.combo += 1;
            state.longestCombo = Math.max(state.longestCombo, state.combo);
            const mult = Math.min(1 + state.combo / 5, 5);
            state.score += Math.round(mult);
          }
        }

        // Active wall = nearest un-passed wall in front of the ball.
        let active = null;
        for (const w of state.walls) {
          if (w.collided || w.passed) continue;
          if (w.x + WALL_WIDTH < state.ball.x - BALL_RADIUS) continue;
          if (!active || w.x < active.x) active = w;
        }
        state.activeWall = active;

        // GC walls.
        state.walls = state.walls.filter((w) => w.x + WALL_WIDTH > -20 && !w.collided);
      }

      // --- Render ---
      g.fillStyle = '#0b1020';
      g.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // Tonic reference line.
      const tonicY = midiToCanvasY(tonicMidi, tonicMidi, CANVAS_H);
      g.strokeStyle = 'rgba(148,163,184,0.18)';
      g.setLineDash([4, 6]);
      g.beginPath();
      g.moveTo(0, tonicY);
      g.lineTo(CANVAS_W, tonicY);
      g.stroke();
      g.setLineDash([]);

      // Home line for the ball.
      g.strokeStyle = 'rgba(129,140,248,0.15)';
      g.beginPath();
      g.moveTo(homeX, 0);
      g.lineTo(homeX, CANVAS_H);
      g.stroke();

      // Walls.
      for (const w of state.walls) {
        const gapTop = w.gapY - w.gapHeight / 2;
        const gapBot = w.gapY + w.gapHeight / 2;
        g.fillStyle = '#334155';
        g.fillRect(w.x, 0, WALL_WIDTH, gapTop);
        g.fillRect(w.x, gapBot, WALL_WIDTH, CANVAS_H - gapBot);
        g.strokeStyle = w === state.activeWall
          ? 'rgba(52,211,153,0.7)'
          : 'rgba(129,140,248,0.45)';
        g.lineWidth = 2;
        g.strokeRect(w.x, gapTop, WALL_WIDTH, gapBot - gapTop);
      }

      // Ball — green when inside the active wall's gap.
      let inTune = false;
      if (state.activeWall) {
        const gapTop = state.activeWall.gapY - state.activeWall.gapHeight / 2;
        const gapBot = state.activeWall.gapY + state.activeWall.gapHeight / 2;
        inTune =
          state.ball.y - BALL_RADIUS >= gapTop && state.ball.y + BALL_RADIUS <= gapBot;
      }
      g.fillStyle = inTune ? '#34d399' : '#e2e8f0';
      g.beginPath();
      g.arc(state.ball.x, state.ball.y, BALL_RADIUS, 0, Math.PI * 2);
      g.fill();

      // HUD sync (only setState on actual changes to avoid per-frame re-renders).
      const prev = hudRef.current;
      if (
        prev.score !== state.score ||
        prev.lives !== state.lives ||
        prev.combo !== state.combo ||
        prev.inTune !== inTune
      ) {
        const next = {
          score: state.score,
          lives: state.lives,
          combo: state.combo,
          inTune,
        };
        hudRef.current = next;
        setHud(next);
      }

      if (state.over && !state.overEmitted) {
        state.overEmitted = true;
        const total = state.hits + state.misses;
        setGameOver({
          score: state.score,
          longestCombo: state.longestCombo,
          accuracy: total === 0 ? 0 : Math.round((state.hits / total) * 100),
        });
      }

      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(rafId);
      stopPitch();
    };
  }, [capture, settings, epoch]);

  const restart = () => {
    setGameOver(null);
    setEpoch((e) => e + 1);
  };

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
        <div className="flex items-center gap-1">
          {Array.from({ length: hud.lives }).map((_, i) => (
            <span key={i} className="text-rose-400">♥</span>
          ))}
          {hud.lives === 0 && <span className="text-slate-600">—</span>}
        </div>
      </div>

      <div className="relative">
        <canvas
          ref={canvasRef}
          className="rounded-xl border border-white/10 bg-slate-950"
        />
        {gameOver && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-slate-950/85 backdrop-blur-sm">
            <div className="flex w-72 flex-col items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/90 p-6 text-center">
              <div className="text-xs uppercase tracking-widest text-rose-400">Game over</div>
              <div className="font-mono text-3xl">{gameOver.score}</div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <dt className="text-slate-400">Longest combo</dt>
                <dd className="text-right font-mono">{gameOver.longestCombo}</dd>
                <dt className="text-slate-400">Accuracy</dt>
                <dd className="text-right font-mono">{gameOver.accuracy}%</dd>
              </dl>
              <button
                type="button"
                onClick={restart}
                className="mt-2 w-full rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold hover:bg-indigo-400"
              >
                Restart
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
