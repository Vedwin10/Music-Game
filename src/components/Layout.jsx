export default function Layout({ children }) {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 text-slate-100">
      <header className="border-b border-white/5 px-6 py-4">
        <h1 className="text-lg font-semibold tracking-wide">
          Pitch Quest
          <span className="ml-2 text-xs font-normal text-slate-400">
            sing in tune, float through
          </span>
        </h1>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="flex flex-col items-center gap-1 border-t border-white/5 px-6 py-3 text-center text-xs text-slate-500">
        <span>Created by Vedik Upadhyay</span>
      </footer>
    </div>
  );
}
