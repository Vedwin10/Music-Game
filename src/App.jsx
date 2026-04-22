import { useCallback, useEffect, useRef, useState } from 'react';
import Layout from './components/Layout.jsx';
import StartScreen from './components/StartScreen.jsx';
import RequestingMicScreen from './components/RequestingMicScreen.jsx';
import MicErrorScreen from './components/MicErrorScreen.jsx';
import GameActiveScreen from './components/GameActiveScreen.jsx';
import {
  createAudioContextSync,
  requestMicrophone,
  buildCaptureGraph,
  teardownCapture,
} from './audio/initAudio.js';

export default function App() {
  const [screen, setScreen] = useState('start');
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const captureRef = useRef(null);

  const cleanup = useCallback(() => {
    if (captureRef.current) {
      teardownCapture(captureRef.current);
      captureRef.current = null;
    }
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const handleStart = useCallback(async (nextSettings) => {
    setSettings(nextSettings);
    setError(null);

    // Synchronous: still inside the click-handler call stack.
    let ctx;
    try {
      ctx = createAudioContextSync();
    } catch (err) {
      setError({ code: err.code || 'unknown', detail: err.message });
      setScreen('error');
      return;
    }

    setScreen('requesting');

    let stream;
    try {
      stream = await requestMicrophone();
    } catch (err) {
      if (ctx.state !== 'closed') ctx.close().catch(() => {});
      setError({ code: err.code || 'unknown', detail: err.message });
      setScreen('error');
      return;
    }

    let graph;
    try {
      graph = buildCaptureGraph(ctx, stream);
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      if (ctx.state !== 'closed') ctx.close().catch(() => {});
      setError({ code: 'unknown', detail: err.message });
      setScreen('error');
      return;
    }

    // Watch for the OS/user yanking the device mid-session.
    stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        setError({ code: 'in-use', detail: 'Audio track ended unexpectedly.' });
        setScreen('error');
        cleanup();
      };
    });

    captureRef.current = { ctx, stream, source: graph.source, analyser: graph.analyser };
    setScreen('active');
  }, [cleanup]);

  const handleRetry = useCallback(() => {
    cleanup();
    setError(null);
    setScreen('start');
  }, [cleanup]);

  const handleExit = useCallback(() => {
    cleanup();
    setScreen('start');
  }, [cleanup]);

  return (
    <Layout>
      {screen === 'start' && <StartScreen onStart={handleStart} />}
      {screen === 'requesting' && <RequestingMicScreen />}
      {screen === 'error' && (
        <MicErrorScreen code={error?.code} detail={error?.detail} onRetry={handleRetry} />
      )}
      {screen === 'active' && captureRef.current && (
        <GameActiveScreen
          settings={settings}
          capture={captureRef.current}
          onExit={handleExit}
        />
      )}
    </Layout>
  );
}
