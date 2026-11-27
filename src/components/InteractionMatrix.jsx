import React from "react";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";

const colors = [
  "#a34bb1",
  "#eb6682",
  "#269bab",
  "#7560c9",
  "#55a87a",
  "#e19b46",
  "#4b79c7",
  "#d8538c",
  "#88ad4a",
  "#d17c62",
  "#3a9db0",
  "#c765ba",
];
export function InteractionMatrix({ matrix, i, j, setSelected, engine }) {
  return (
    <div className="mb-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
      <div id="matrixScroll" className="overflow-x-auto">
        <div
          id="matrix"
          role="group"
          aria-label="Directional force matrix"
          className="grid w-max gap-1"
          style={{ gridTemplateColumns: `repeat(${matrix.length + 1}, 2.25rem)` }}
        >
          <div className="flex h-8 w-8 items-center justify-center sm:h-9 sm:w-9 [&_i]:block [&_i]:size-3 [&_i]:rounded-full" />
          {matrix.map((_, col) => (
            <div
              className="flex h-8 w-8 items-center justify-center sm:h-9 sm:w-9 [&_i]:block [&_i]:size-3 [&_i]:rounded-full"
              key={"h" + col}
            >
              <i style={{ background: colors[col] }} />
            </div>
          ))}
          {matrix.map((row, r) => (
            <React.Fragment key={r}>
              <div className="flex h-8 w-8 items-center justify-center sm:h-9 sm:w-9 [&_i]:block [&_i]:size-3 [&_i]:rounded-full">
                <i style={{ background: colors[r] }} />
              </div>
              {row.map((v, c) => (
                <button
                  key={c}
                  type="button"
                  className={`h-8 w-8 rounded text-[10px] font-semibold text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:h-9 sm:w-9 ${r === i && c === j ? "outline-2 outline-offset-1 outline-primary" : ""}`}
                  style={{
                    background:
                      v > 0.012
                        ? `rgba(5,150,105,${0.12 + Math.abs(v) * 0.4})`
                        : v < -0.012
                          ? `rgba(220,38,38,${0.12 + Math.abs(v) * 0.4})`
                          : "#e8edf2",
                  }}
                  aria-label={`Type ${r + 1} → Type ${c + 1}: ${v.toFixed(2)}`}
                  onClick={() => setSelected([r, c])}
                >
                  {v >= 0 ? "+" : ""}
                  {v.toFixed(2)}
                </button>
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>
          <i className="mr-1 inline-block size-2 rounded-full bg-emerald-600" /> attraction
        </span>
        <span>
          <i className="mr-1 inline-block size-2 rounded-full bg-red-500" /> repulsion
        </span>
        <span>gray = 0</span>
      </div>
      <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-slate-800">
            <span style={{ color: colors[i] }}>●</span> Type {i + 1} →{" "}
            <span style={{ color: colors[j] }}>●</span> Type {j + 1}
          </span>
          <input
            className="h-9 w-20 rounded-lg border border-slate-300 bg-white px-2 text-right text-sm text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Selected pair force"
            type="number"
            min="-1"
            max="1"
            step="0.01"
            value={Number(matrix[i][j].toFixed(2))}
            onChange={(e) => engine.current?.setCell(i, j, Number(e.target.value))}
          />
        </div>
        <Slider
          aria-label="Adjust selected pair force"
          min={-1}
          max={1}
          step={0.01}
          value={[matrix[i][j]]}
          onValueChange={([v]) => engine.current?.setCell(i, j, v)}
        />
        <div className="mt-3 flex items-center gap-2">
          <Button
            className="h-auto min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => engine.current?.setCell(i, j, Math.random() * 2 - 1)}
          >
            Randomize pair
          </Button>
          <Button
            className="h-auto min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => engine.current?.setCell(i, j, 0)}
          >
            0
          </Button>
        </div>
      </div>
    </div>
  );
}
