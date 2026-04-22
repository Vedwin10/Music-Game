export default function RequestingMicScreen() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-6 py-16 text-center">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
      <h2 className="text-lg font-medium">Waiting for microphone permission…</h2>
      <p className="text-sm text-slate-400">
        Look for the browser prompt near the address bar and click Allow.
      </p>
    </div>
  );
}
