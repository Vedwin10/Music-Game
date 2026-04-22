import GameCanvas from '../game/GameCanvas.jsx';

export default function GameActiveScreen({ settings, capture, onExit }) {
  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-5 px-4 py-6">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-emerald-400">● Game active</div>
          <h2 className="mt-1 text-xl font-semibold">
            {settings.tonic} {settings.mode}
            <span className="ml-2 text-sm font-normal capitalize text-slate-400">
              · {settings.difficulty}
            </span>
          </h2>
        </div>
        <button
          type="button"
          onClick={onExit}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm hover:border-white/20"
        >
          End
        </button>
      </header>

      <GameCanvas settings={settings} capture={capture} />
    </div>
  );
}
