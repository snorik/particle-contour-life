import { Button } from "./ui/button";
import { FpsCounter } from "./FpsCounter";

export function SimulationHeader({ state, opts, engine, open, setOpen, fpsCounter }) {
  return (
    <header className="pointer-events-none fixed inset-x-3 top-3 z-20 flex items-start justify-between gap-2 sm:inset-x-5 sm:top-5">
      <div className="pointer-events-auto flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white p-2">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-xl font-bold text-white">
          ◈
        </div>
        <h1 className="hidden text-sm font-bold tracking-tight text-slate-950 lg:block">
          PARTICLE × CONTOUR LIFE
        </h1>
      </div>
      <div className="pointer-events-auto flex items-center gap-2">
        <div className="hidden h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-500 sm:flex [&_strong]:text-sm [&_strong]:font-semibold [&_strong]:text-slate-950">
          Particles <strong>{state.count}</strong>
        </div>
        <div className="hidden h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-500 sm:flex [&_strong]:text-sm [&_strong]:font-semibold [&_strong]:text-slate-950">
          Types <strong>{opts.types}</strong>
        </div>
        <FpsCounter ref={fpsCounter} />
        <Button
          className="h-11 w-11 rounded-lg border border-slate-200 bg-white p-0 text-lg font-semibold text-slate-900 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-primary"
          title={state.playing ? "Pause / Space" : "Resume / Space"}
          aria-label={state.playing ? "Pause simulation" : "Resume simulation"}
          onClick={() => engine.current?.togglePlay()}
        >
          {state.playing ? "Ⅱ" : "▶"}
        </Button>
        <Button
          className="h-11 w-11 rounded-lg border border-slate-200 bg-white p-0 text-lg font-semibold text-slate-900 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-primary"
          aria-label="Show or hide settings"
          aria-controls="panel"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          ☰
        </Button>
      </div>
    </header>
  );
}
