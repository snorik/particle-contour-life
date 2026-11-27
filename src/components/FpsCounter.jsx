import { useImperativeHandle, useState } from "react";

export function FpsCounter({ ref }) {
  const [fps, setFps] = useState(0);
  useImperativeHandle(ref, () => setFps, []);

  return (
    <div className="hidden h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-500 sm:flex [&_strong]:text-sm [&_strong]:font-semibold [&_strong]:text-slate-950">
      FPS <strong>{fps || "—"}</strong>
    </div>
  );
}
