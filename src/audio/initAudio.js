// Create the AudioContext synchronously so iOS Safari accepts it as a
// user-gesture activation. Call this from inside the click handler *before*
// any await. Resume is also synchronous so the context is running when
// getUserMedia resolves.
export function createAudioContextSync() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) {
    const err = new Error('AudioContext unsupported');
    err.code = 'unsupported';
    throw err;
  }
  const ctx = new Ctor({ latencyHint: 'interactive' });
  // resume() returns a Promise but the call itself counts as user-gesture
  // activation. We don't await — the caller awaits mic permission next.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export async function requestMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    const err = new Error('getUserMedia unavailable');
    err.code = 'insecure-context';
    throw err;
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
      video: false,
    });
  } catch (raw) {
    throw classifyMicError(raw);
  }
}

function classifyMicError(raw) {
  const err = new Error(raw?.message || 'Microphone unavailable');
  err.cause = raw;
  switch (raw?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      err.code = 'denied';
      break;
    case 'NotFoundError':
    case 'OverconstrainedError':
      err.code = 'no-hardware';
      break;
    case 'NotReadableError':
    case 'AbortError':
      err.code = 'in-use';
      break;
    default:
      err.code = 'unknown';
  }
  return err;
}

// Wire a MediaStream to the AudioContext and return the analyser pieces the
// game loop will read from. Nothing downstream runs yet — this just proves
// capture is live by exposing a time-domain buffer Phase 2 can consume.
export function buildCaptureGraph(ctx, stream) {
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);
  return { source, analyser };
}

export function teardownCapture({ ctx, stream, source }) {
  try {
    source?.disconnect();
  } catch {}
  stream?.getTracks().forEach((t) => t.stop());
  if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {});
}
