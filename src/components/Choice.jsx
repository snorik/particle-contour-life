import { ChevronDown } from "lucide-react";

export function Choice({ id, label, value, values, change }) {
  return (
    <div className="mb-5 flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <div className="relative">
        <select
          className="h-11 w-full appearance-none rounded-lg border border-slate-300 bg-white ps-3 pe-10 text-sm text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-primary forced-colors:appearance-auto"
          id={id}
          value={value}
          onChange={(e) =>
            change(
              id,
              ["physicsHz", "fieldScale"].includes(id) ? Number(e.target.value) : e.target.value,
            )
          }
        >
          {values.map(([v, text]) => (
            <option key={v} value={v}>
              {text}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-slate-500 forced-colors:hidden"
        />
      </div>
    </div>
  );
}
