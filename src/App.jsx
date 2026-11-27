import { useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber/webgpu";
import * as THREE from "three/webgpu";
import { CanvasErrorBoundary } from "./components/CanvasErrorBoundary";
import { SettingsPanel } from "./components/SettingsPanel";
import { SimulationHeader } from "./components/SimulationHeader";
import { Simulation } from "./Simulation";
import "./tailwind.css";

async function createRenderer(props) {
  if (!navigator.gpu) throw new Error("WebGPU is not available in this browser.");
  const renderer = new THREE.WebGPURenderer({
    canvas: props.canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
    trackTimestamp: new URLSearchParams(location.search).has("profile"),
  });
  await renderer.init();
  return renderer;
}
function App() {
  const engine = useRef(null),
    file = useRef(null),
    fpsCounter = useRef(null),
    timers = useRef({});
  const [state, setState] = useState(null),
    [error, setError] = useState(""),
    [open, setOpen] = useState(() => !window.matchMedia("(max-width:800px)").matches),
    [selected, setSelected] = useState([0, 1]),
    [preset, setPreset] = useState("random"),
    [notice, setNotice] = useState("");
  const update = useCallback((next) => {
    setState(next);
    if (next.toast) setNotice(next.toast);
  }, []);
  const onError = useCallback((message) => setError(message), []);
  const onFps = useCallback((value) => fpsCounter.current?.(value), []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 2300);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const key = (e) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        engine.current?.togglePlay();
      }
      if (e.code === "KeyR" && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        setPreset("random");
        engine.current?.usePreset("random");
      }
      if (e.key.toLowerCase() === "m" && !e.repeat) setOpen((v) => !v);
      if (e.key === "Escape" && matchMedia("(max-width:800px)").matches) setOpen(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    const blur = () => engine.current?.releasePointer();
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("blur", blur);
      Object.values(timers.current).forEach(clearTimeout);
    };
  }, []);
  const change = (id, value) => {
    if (id === "types" || id === "count") {
      setState((s) => ({ ...s, options: { ...s.options, [id]: value } }));
      clearTimeout(timers.current[id]);
      timers.current[id] = setTimeout(() => engine.current?.setOption(id, value), 150);
    } else engine.current?.setOption(id, value);
  };
  const pointer = (e, down) => {
    engine.current?.pointer(e, down);
    if (down) e.currentTarget.setPointerCapture(e.pointerId);
  };
  const opts = state?.options,
    matrix = state?.matrix,
    i = Math.min(selected[0], (matrix?.length || 1) - 1),
    j = Math.min(selected[1], (matrix?.length || 1) - 1);
  return (
    <>
      <div
        id="stage"
        className="fixed inset-0 h-full w-full touch-none select-none cursor-crosshair [-webkit-touch-callout:none]"
        aria-label="Asymmetric Particle Life simulation"
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => pointer(e, true)}
        onPointerMove={(e) => pointer(e)}
        onPointerUp={(e) => pointer(e, false)}
        onPointerCancel={(e) => pointer(e, false)}
        onDoubleClick={(e) => {
          pointer(e);
          engine.current?.addAtPointer();
        }}
      >
        <CanvasErrorBoundary onError={onError}>
          <Canvas renderer={createRenderer}>
            <Simulation engineRef={engine} onUpdate={update} onError={onError} onFps={onFps} />
          </Canvas>
        </CanvasErrorBoundary>
      </div>
      {!state && !error && (
        <div
          id="loader"
          role="status"
          className="fixed inset-0 z-50 grid place-content-center bg-slate-50 text-sm font-medium text-slate-600"
        >
          Preparing simulation
        </div>
      )}
      {error && (
        <div
          id="error"
          role="alert"
          className="fixed inset-x-4 top-20 z-50 mx-auto max-w-lg rounded-xl border border-red-200 bg-white p-6 text-slate-950 [&_h2]:mb-2 [&_h2]:font-semibold [&_p]:text-sm [&_p]:text-slate-600"
        >
          <h2>Could not start simulation</h2>
          <p>{error}</p>
        </div>
      )}
      {state && (
        <>
          <SimulationHeader
            state={state}
            opts={opts}
            engine={engine}
            open={open}
            setOpen={setOpen}
            fpsCounter={fpsCounter}
          />
          <SettingsPanel
            open={open}
            setOpen={setOpen}
            opts={opts}
            matrix={matrix}
            i={i}
            j={j}
            setSelected={setSelected}
            preset={preset}
            setPreset={setPreset}
            change={change}
            engine={engine}
            file={file}
          />
          <div
            id="bottomHelp"
            className={`pointer-events-none fixed bottom-3 right-3 z-10 max-w-[calc(100vw-1.5rem)] rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] leading-5 text-slate-600 sm:bottom-5 sm:right-5 ${open ? "hidden sm:block" : "block"}`}
          >
            <span className="hidden sm:block">
              <b>Left click</b> — attract · <b>Right click / Shift</b> — repel
              <br />
              <b>Double click</b> — add particles · <b>Space</b> — pause · <b>R</b> — randomize
              forces
            </span>
            <span className="sm:hidden">
              <b>Touch and hold</b> — attract particles
            </span>
          </div>
          <div
            id="toast"
            role="status"
            className={`pointer-events-none fixed bottom-16 left-1/2 z-30 max-w-[90vw] -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 ${notice ? "opacity-100" : "opacity-0"}`}
          >
            {notice}
          </div>
          <input
            ref={file}
            id="fileInput"
            className="hidden"
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) engine.current?.importFile(f);
            }}
          />
        </>
      )}
    </>
  );
}
export default App;
