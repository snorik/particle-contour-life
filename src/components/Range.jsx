import { Slider } from "./ui/slider";

export function Range({ id, label, min, max, step, value, change }) {
  const integer = ["count", "types", "range", "blob", "minCellSize"].includes(id);
  const shown = integer ? Math.round(value) : Number(value).toFixed(id === "speed" ? 3 : 2);
  return (
    <div className="mb-5 flex flex-col gap-2">
      <label
        htmlFor={id}
        className="flex items-center justify-between gap-3 text-sm font-medium text-slate-700"
      >
        {label} <output className="font-semibold tabular-nums text-slate-950">{shown}</output>
      </label>
      <Slider
        id={id}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => change(id, v)}
        aria-label={label}
      />
    </div>
  );
}
