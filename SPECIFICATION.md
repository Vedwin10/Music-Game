# Pitch-Detection Singing Game

This is a pitch-detection singing game designed to be a learning experience for students learning music and singing. The game is web-based and can be played on both desktop and mobile devices. It features a floating ball that moves up and down based on the user's voice pitch, and the user needs to sing at the right pitch to make the ball go through a hole to keep going. The game supports different major and minor keys and allows for two acceptable pitches per note (normal octave and down octave). The architecture of this project is designed to support a maximum of 50 concurrent users.

# Architecture & Technology Stack

Single-Page Application (SPA), where audio processing and game physics are handled client-side in the user's browser.

| Component | Technology |
| --- | --- |
| Frontend | Vite + React.js |
| Styling | Tailwind CSS |
| Audio Processing | Web Audio API |
| Pitch Detection | pitchy (McLeod Pitch Method) |
| Reference Tone Synthesis | Web Audio OscillatorNode |
| Game Rendering | HTML5 Canvas API |
| Hosting & Deployment | Vercel |

# Core Mechanics

## 1. Pitch-to-Note Translation
Capture the user's microphone using `navigator.mediaDevices.getUserMedia` and pipe it into the Web Audio API's AnalyserNode. Pass the float time-domain buffer to pitchy's `findPitch()` every animation frame to obtain `(frequency, clarity)`.

To map the frequency to a musical note, use the standard equal temperament formula:

    n = 12 * log2(f / 440)

Where `f` is the detected frequency and `n` is the number of half-steps from A4 (440 Hz).

**Confidence gating.** pitchy returns a clarity score in `[0, 1]`. Discard any frame with `clarity < 0.90` — these are typically silence, breaths, consonants, or background noise. When a frame is discarded, the ball holds its last valid position rather than snapping toward zero or jittering.

## 2. Handling Keys and Scales
Generate arrays of valid target frequencies from interval patterns (in semitones):
- Major scale: `2, 2, 1, 2, 2, 2, 1`
- Natural minor scale: `2, 1, 2, 2, 1, 2, 2`

Selecting "G Major" computes G, A, B, C, D, E, F# and assigns these as the target Y-coordinates for the holes in successive walls.

## 3. Dual-Octave Acceptance
Allow users to sing either the standard octave or one octave below. A frame is accepted if the detected frequency matches either:

1. `f_detected ≈ f_target` (normal octave)
2. `f_detected ≈ f_target / 2` (down octave)

within the tolerance window defined by the selected difficulty (see §5). To keep gameplay consistent regardless of vocal range, the ball is **always rendered at the upper-octave Y coordinate** — when the down-octave branch matches, the detected pitch is multiplied by 2 before being mapped to screen position.

## 4. Pitch-to-Position Mapping
The canvas Y axis maps to *semitones*, not Hertz, so equal musical intervals correspond to equal vertical distances. The mapped range spans **18 semitones (1.5 octaves)** centered on the tonic of the selected key:

    y_min_semitone = tonic_midi - 4    // bottom of canvas
    y_max_semitone = tonic_midi + 14   // top of canvas

Higher pitches map to smaller Y values (top of canvas). The smoothed pitch is converted to a fractional MIDI note number, folded into the upper octave when necessary, then linearly interpolated into pixel space. Pitches outside the window clamp to the canvas edge but are still considered "off-pitch" for collision purposes.

## 5. Difficulty & Tolerance
Tolerance, gap height, and speed scale together so the visible gap always matches the accepted pitch window:

| Mode | Tolerance | Gap height | Scroll speed | Lives |
| --- | --- | --- | --- | --- |
| Beginner | ±50 cents | ~3 semitones | 120 px/s | 3 |
| Intermediate | ±25 cents | ~1.5 semitones | 160 px/s | 2 |
| Advanced | ±15 cents | ~1 semitone | 200 px/s | 1 |

Gap height is computed as `ball_diameter + 2 × tolerance_in_pixels` so the visual gap is exactly the region in which a sustained pitch will pass.

## 6. Audio Reference
Singers cannot reliably target a pitch in silence. The game provides three layered audio aids, all toggleable from the start screen:

1. **Pre-tone (default on).** A short sine-wave tone at the target pitch plays ~1 second before each wall reaches the ball, synthesized by an OscillatorNode with a 50 ms attack/release envelope to avoid clicks.
2. **Tonic drone (default off).** A continuous quiet sine wave at the tonic of the selected key, providing constant tonal grounding.
3. **Metronome tick (default off).** A short click on each wall arrival, useful for rhythm.

All reference audio is routed through a dedicated GainNode that is **not connected to the analyser**, so the synthesized tones never appear in the pitch detector's input. To prevent the speaker output from leaking back into the microphone, the start screen recommends headphones; if no headphones are detected (best-effort, via output device labels), pitch analysis is gated for ~80 ms around each tone onset.

## 7. Calibration (one-time, after permission grant)
After the user grants mic access and before the first wall, run a brief calibration:

1. Display "Sing any comfortable note for 2 seconds."
2. Capture the median of detected frequencies above the clarity threshold.
3. Snap that median to the nearest pitch class and decide whether the user's natural range sits in the upper or lower half of the canvas window. Store this so the dual-octave fold (§3) defaults to the user's actual register.

Calibration can be re-run from a settings menu without re-requesting mic permission.

# Game Loop & Implementation Phases

## Phase 1: Setup and Permissions
Mobile browsers require a physical user interaction to unlock the Web Audio API context. Create a React landing page where the user selects their key (Major/Minor + tonic), difficulty, and audio aids, then taps Start. The Start handler must:

1. **Create the `AudioContext` synchronously inside the gesture handler.** iOS Safari will not unlock it from inside a `.then()` callback or any async continuation.
2. Call `getUserMedia({ audio: true })` and request microphone permission.
3. On permission denial, show a recovery screen with browser-specific re-request instructions (Chrome, Safari, Firefox).
4. Feature-detect `window.AudioContext` (or `webkitAudioContext`) and `navigator.mediaDevices.getUserMedia`. If unsupported, show a "Browser not supported" screen listing recommended browsers.
5. If `enumerateDevices()` returns no `audioinput` devices, show a "No microphone detected" error with troubleshooting tips.
6. On any error during AudioContext setup, surface the error rather than failing silently.

## Phase 2: Audio Engine Loop
Create a `requestAnimationFrame` loop that:
- Extracts the float time-domain data from the AnalyserNode (`fftSize` = 2048).
- Feeds it into pitchy and reads `(frequency, clarity)`.
- Discards frames with `clarity < 0.90` — the ball holds its previous Y on rejected frames.
- Applies a 5-frame rolling **median** (more robust than mean against pitchy's occasional octave errors) to the accepted frequencies.
- Folds the smoothed frequency into the upper octave per §3, then computes the target Y per §4.
- Lerps the rendered ball Y toward the target Y at factor ~0.3 for smooth motion without sluggish lag.

## Phase 3: Physics and Canvas Rendering
- **The Ball:** A circle whose Y is the lerped target from Phase 2. Color shifts (e.g., green when within tolerance of the active wall's target, white otherwise) give immediate in-tune feedback.
- **The Obstacles:** Walls spawn on the right edge with a vertical gap centered at the target note's Y. Wall spacing is **time-based**: one wall every 2.5 seconds at base speed, giving the user time to re-target after each note. The note sequence ascends through the scale, then descends, then continues with a randomized in-key sequence after the first 14 walls.
- **Collision Detection:** AABB check between the ball's bounding box and the solid portion of each wall. Hitting the wall costs one life and destroys that wall; passing through the gap awards 1 point, multiplied by a combo multiplier (`min(1 + consecutive_hits / 5, 5)`) that resets on any miss.
- **Game Over:** Triggered when lives reach 0. Show final score, longest combo, accuracy %, and a Restart button. Restart reuses the existing AudioContext and MediaStream so no second permission prompt is needed.

## Phase 4: Deployment
Push the React code to GitHub and connect the repository to Vercel. Vercel will automatically build and deploy to a global CDN. Since all processing is done locally via the user's own CPU and microphone, server load is effectively zero — the free tier is sufficient.
