const MESSAGES = {
  denied: {
    title: 'Microphone access blocked',
    body:
      'Pitch Quest needs your microphone to hear you sing. Open your browser site settings, allow microphone access for this page, then try again.',
    cta: 'Try again',
  },
  'no-hardware': {
    title: 'No microphone found',
    body:
      "We couldn't find a microphone on this device. Plug one in (or enable your built-in mic) and try again.",
    cta: 'Try again',
  },
  'in-use': {
    title: 'Microphone is busy',
    body:
      'Another app or tab seems to be using your microphone. Close it (video calls, other recording tabs) and try again.',
    cta: 'Try again',
  },
  'insecure-context': {
    title: 'Secure connection required',
    body:
      'Browsers only grant microphone access over HTTPS or localhost. Reload the page over a secure URL.',
    cta: 'Reload',
  },
  unsupported: {
    title: 'Browser not supported',
    body:
      'Your browser does not support the Web Audio API. Try a recent version of Chrome, Safari, Firefox, or Edge.',
    cta: 'Try again',
  },
  unknown: {
    title: 'Something went wrong',
    body: 'We could not start audio capture. Try again, or reload the page.',
    cta: 'Try again',
  },
};

export default function MicErrorScreen({ code, detail, onRetry }) {
  const msg = MESSAGES[code] || MESSAGES.unknown;
  const handle = code === 'insecure-context' ? () => window.location.reload() : onRetry;
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-6 py-12 text-center">
      <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-left">
        <h2 className="text-xl font-semibold text-rose-100">{msg.title}</h2>
        <p className="mt-2 text-sm text-rose-100/80">{msg.body}</p>
        {detail && (
          <p className="mt-3 font-mono text-xs text-rose-200/50">{detail}</p>
        )}
      </div>
      <button
        type="button"
        onClick={handle}
        className="rounded-xl bg-orange-500 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-orange-500/20 transition hover:bg-orange-400 active:scale-[0.99]"
      >
        {msg.cta}
      </button>
    </div>
  );
}
