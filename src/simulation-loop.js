export function createSimulationLoop({
  options,
  mouse,
  renderer,
  profiling,
  isPlaying,
  hasPendingEdits,
  getSimulation,
  getMatrix,
  isPhysicsOptionsDirty,
  clearPhysicsOptionsDirty,
  isPhysicsMatrixDirty,
  clearPhysicsMatrixDirty,
  advanceTime,
  updateActiveBuffers,
  render,
  fail,
  onFps = () => {},
}) {
  let lastPointerX, lastPointerY, lastPointerStrength;
  let last = performance.now(),
    fpsFrames = 0,
    fpsLast = last,
    accumulator = 0;
  let stopped = false;
  let profilePending = false;
  let profileLastLog = last;
  let profileHasCompute = false;
  function frame(now) {
    if (stopped) return;
    const STEP = 1 / options.physicsHz;
    const delta = Math.min(0.075, Math.max(0, (now - last) * 0.001));
    last = now;
    if (isPlaying() && !hasPendingEdits()) {
      accumulator = Math.min(accumulator + delta * options.speed, 0.12);
      let cycles = 0;
      while (accumulator >= STEP && cycles < 12) {
        try {
          if (cycles === 0) {
            if (isPhysicsOptionsDirty()) {
              getSimulation().setOptions(options);
              getSimulation().settings.dt.value = STEP;
              clearPhysicsOptionsDirty();
            }
            if (isPhysicsMatrixDirty()) {
              getSimulation().setMatrix(getMatrix());
              clearPhysicsMatrixDirty();
            }
            const strength = mouse.down ? (mouse.repel ? -7 : mouse.touch ? 14 : 7) : 0;
            if (
              mouse.x !== lastPointerX ||
              mouse.y !== lastPointerY ||
              strength !== lastPointerStrength
            ) {
              getSimulation().setPointer(mouse.x, mouse.y, strength);
              lastPointerX = mouse.x;
              lastPointerY = mouse.y;
              lastPointerStrength = strength;
            }
          }
          getSimulation().step(renderer);
          profileHasCompute = true;
        } catch (error) {
          console.error("WebGPU physics failed", error);
          stopped = true;
          fail("WebGPU physics error: " + error.message);
          return;
        }
        advanceTime(STEP);
        accumulator -= STEP;
        cycles++;
      }
      if (cycles > 0) updateActiveBuffers();
      if (cycles === 12) accumulator = Math.min(accumulator, STEP);
    }
    render();
    if (profiling && renderer.backend.trackTimestamp && !profilePending) {
      profilePending = true;
      const measuredCompute = profileHasCompute;
      profileHasCompute = false;
      Promise.all([
        measuredCompute ? renderer.resolveTimestampsAsync("compute") : null,
        renderer.resolveTimestampsAsync("render"),
      ])
        .then(([compute, renderTime]) => {
          if (now - profileLastLog >= 1000) {
            console.info("GPU timings (ms, latest measured frame)", {
              compute: compute ?? "no simulation steps",
              render: renderTime ?? "unavailable",
            });
            profileLastLog = now;
          }
        })
        .catch((error) => console.warn("GPU profiling failed", error))
        .finally(() => {
          profilePending = false;
        });
    }
    fpsFrames++;
    if (now - fpsLast > 850) {
      onFps(Math.round((fpsFrames * 1000) / (now - fpsLast)));
      fpsFrames = 0;
      fpsLast = now;
    }
  }
  return {
    frame,
    resetPointer: () => {
      lastPointerX = lastPointerY = lastPointerStrength = undefined;
    },
  };
}
