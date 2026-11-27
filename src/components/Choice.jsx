export function Choice({ id, label, value, values, change }) {
  return (
    <div className="mb-5 flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <select
        className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
    </div>
  );
}
