import React from "react";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Range } from "./Range";
import { Choice } from "./Choice";
import { InteractionMatrix } from "./InteractionMatrix";

const controls = [
  ["count", "Particle count", 100, 10000, 50],
  ["force", "Interaction strength", 0.1, 2.5, 0.05],
  ["range", "Interaction radius", 35, 160, 1],
  ["beta", "Short-range repulsion β", 0.1, 0.55, 0.01],
  ["halfLife", "Damping half-life, s", 0.04, 0.48, 0.01],
  ["speed", "Simulation speed", 0.005, 2.5, 0.005],
  ["barnesHutTheta", "Barnes–Hut approximation", 0.2, 1.5, 0.05],
  ["minCellSize", "Minimum cell size", 16, 180, 1],
  ["blob", "Membrane radius", 10, 65, 1],
  ["iso", "Boundary threshold", 0.15, 1, 0.01],
  ["smooth", "Membrane smoothing", 0, 1, 0.01],
  ["fill", "Fill intensity", 0, 1, 0.05],
  ["debris", "Water debris", 0, 1, 0.05],
  ["inner", "Internal membranes", 0, 2, 0.05],
];
export function SettingsPanel({
  open,
  setOpen,
  opts,
  matrix,
  i,
  j,
  setSelected,
  preset,
  setPreset,
  change,
  engine,
  file,
}) {
  const range = (id) => {
    const [key, label, min, max, step] = controls.find((c) => c[0] === id);
    return (
      <Range
        key={key}
        id={key}
        label={label}
        min={min}
        max={max}
        step={step}
        value={opts[key]}
        change={change}
      />
    );
  };
  return (
    <aside
      id="panel"
      inert={!open}
      className={`fixed bottom-3 left-3 top-[4.5rem] z-10 w-[min(26rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 text-slate-900 sm:bottom-5 sm:left-5 sm:top-20 sm:p-6 ${open ? "translate-x-0" : "pointer-events-none -translate-x-[calc(100%+2rem)]"} motion-safe:transition-transform motion-safe:duration-200`}
    >
      <div className="mb-4 flex items-center justify-between gap-4 text-sm font-semibold text-slate-950 [&_span]:text-xs [&_span]:font-medium [&_span]:text-slate-400">
        Directional interactions <span>01 / 04</span>
      </div>
      <div className="mb-6 text-sm leading-6 text-slate-600">
        The matrix row is <b>the moving type</b>; the column is <b>the other type</b>.{" "}
        <b className="font-semibold text-emerald-700">+1</b> attracts and{" "}
        <b className="font-semibold text-primary">−1</b> repels. <b>A → B</b> can differ from{" "}
        <b>B → A</b>.
      </div>
      <Range
        id="types"
        label="Number of types"
        min={2}
        max={12}
        step={1}
        value={opts.types}
        change={change}
      />
      <div className="mb-5 flex flex-wrap gap-2">
        <Button
          className="h-auto min-h-10 flex-1 rounded-lg border border-primary bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => {
            setPreset("random");
            engine.current?.usePreset("random");
          }}
        >
          ↝ Randomize forces
        </Button>
        <Button
          className="h-auto min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => engine.current?.clearMatrix()}
        >
          Clear matrix
        </Button>
      </div>
      <Choice
        id="preset"
        label="Presets"
        value={preset}
        change={(_, v) => {
          setPreset(v);
          engine.current?.usePreset(v);
        }}
        values={[
          ["chase", "Chase"],
          ["colonies", "Colonies"],
          ["cycle", "Hunting cycle"],
          ["symbiosis", "Symbiosis"],
          ["partners", "Partner colonies"],
          ["schools", "Schools"],
          ["chains", "Food chains"],
          ["orbit", "Orbit"],
          ["ecosystem", "Ecosystem"],
          ["random", "Random"],
        ]}
      />
      <InteractionMatrix matrix={matrix} i={i} j={j} setSelected={setSelected} engine={engine} />
      <div className="my-6 border-t border-slate-200" />
      <div className="mb-4 flex items-center justify-between gap-4 text-sm font-semibold text-slate-950 [&_span]:text-xs [&_span]:font-medium [&_span]:text-slate-400">
        Particle Life physics <span>02 / 04</span>
      </div>
      {["count", "force", "range", "beta", "halfLife", "speed"].map(range)}
      <Choice
        id="physicsHz"
        label="Physics steps per simulated second"
        value={opts.physicsHz}
        change={change}
        values={[
          [60, "60 — faster"],
          [120, "120 — balanced"],
          [240, "240 — more accurate"],
        ]}
      />
      {[
        ["barnesHut", "Barnes–Hut (experimental)", "barnesHutTheta"],
        ["adaptive", "Adaptive grid (experimental)", "minCellSize"],
        ["approximate", "Fast dense cells (approximate)", null],
      ].map(([id, label, extra]) => (
        <React.Fragment key={id}>
          <div className="mb-4 flex items-center justify-between gap-3 text-sm font-medium text-slate-800">
            <label htmlFor={id} className="text-sm font-medium text-slate-700">
              {label}
            </label>
            <Switch id={id} checked={opts[id]} onCheckedChange={(v) => change(id, v)} />
          </div>
          {extra && range(extra)}
        </React.Fragment>
      ))}
      <div className="my-4 text-xs leading-5 text-slate-500">
        Force depends on distance: particles repel at short range, follow the matrix at intermediate
        range, and exert no force beyond the interaction radius.
      </div>
      <div className="my-6 border-t border-slate-200" />
      <div className="mb-4 flex items-center justify-between gap-4 text-sm font-semibold text-slate-950 [&_span]:text-xs [&_span]:font-medium [&_span]:text-slate-400">
        Contour Life visualization <span>03 / 04</span>
      </div>
      <Choice
        id="mode"
        label="Display"
        value={opts.mode}
        change={change}
        values={[
          ["both", "Contours + particles"],
          ["contours", "Contours only"],
          ["particles", "Particles only"],
        ]}
      />
      <div className="mb-4 flex items-center justify-between gap-3 text-sm font-medium text-slate-800">
        <label htmlFor="eyepiece">Microscope eyepiece</label>
        <Switch
          id="eyepiece"
          checked={opts.eyepiece}
          onCheckedChange={(value) => change("eyepiece", value)}
          aria-describedby="eyepiece-help"
        />
      </div>
      <p id="eyepiece-help" className="-mt-2 mb-5 text-xs leading-5 text-slate-500">
        Adds a vignette and optical blur in contour modes.
      </p>
      {["blob", "iso"].map(range)}
      <Choice
        id="renderScale"
        label="Render resolution"
        value={opts.renderScale}
        change={change}
        values={[
          ["auto", "Auto — up to 1×"],
          ["1", "1×"],
          ["1.5", "1.5×"],
          ["native", "Native display resolution"],
        ]}
      />
      <Choice
        id="fieldScale"
        label="Contour field resolution"
        value={opts.fieldScale}
        change={change}
        values={[
          [0.33, "33% — faster"],
          [0.5, "50% — balanced"],
          [0.67, "67% — detailed"],
          [1, "100% — full resolution"],
        ]}
      />
      {["smooth", "fill", "debris", "inner"].map(range)}
      <div className="my-6 border-t border-slate-200" />
      <div className="mb-4 flex items-center justify-between gap-4 text-sm font-semibold text-slate-950 [&_span]:text-xs [&_span]:font-medium [&_span]:text-slate-400">
        Experiment <span>04 / 04</span>
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        <Button
          className="h-auto min-h-10 flex-1 rounded-lg border border-primary bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => engine.current?.reset()}
        >
          ↻ Reset particles
        </Button>
        <Button
          className="h-auto min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => engine.current?.scramble()}
        >
          ⇄ Shuffle types
        </Button>
        <Button
          className="h-auto min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => engine.current?.exportJSON()}
        >
          ↓ Save JSON
        </Button>
        <Button
          className="h-auto min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => file.current?.click()}
        >
          ↑ Load JSON
        </Button>
        <Button
          className="h-auto min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => engine.current?.savePNG()}
        >
          ▧ Save PNG
        </Button>
        <Button
          className="h-auto min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => setOpen(false)}
        >
          Hide panel
        </Button>
      </div>
    </aside>
  );
}
