import * as THREE from "three/webgpu";
import { instanceIndex, positionLocal, select, uint, vec2, vec3 } from "three/tsl";
import { bindParticleFragments } from "./gpu-materials.js";
import { createGpuPhysics } from "./gpu-physics.js";
import { createPreset } from "./matrix-presets.js";
import { validateMatrix, restoreParticles } from "./configuration.js";
const sliderIds = [
  "minCellSize",
  "barnesHutTheta",
  "types",
  "count",
  "force",
  "range",
  "beta",
  "halfLife",
  "speed",
  "blob",
  "iso",
  "smooth",
  "fill",
  "debris",
  "inner",
];
import { createSimulationLoop } from "./simulation-loop.js";

export function createEngine({
  renderer,
  setDpr,
  canvas,
  onUpdate,
  onError,
  onFps,
  scenes,
  cameras,
  materials,
  onMeshesChange,
}) {
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const rand = (a, b) => a + (b - a) * Math.random();
  const MAX_PARTICLES = 10000;
  const options = {
    types: 5,
    count: 3000,
    force: 1,
    range: 92,
    beta: 0.28,
    halfLife: 0.16,
    approximate: true,
    barnesHut: false,
    barnesHutTheta: 0.5,
    adaptive: false,
    minCellSize: 32,
    speed: 0.25,
    physicsHz: 120,
    fieldScale: 0.67,
    renderScale: "auto",
    blob: 11,
    iso: 0.7,
    smooth: 0.2,
    fill: 0.5,
    debris: 0.45,
    inner: 1,
    mode: "both",
    eyepiece: true,
  };
  let matrix = [],
    particles = [],
    simTime = 0,
    playing = true;
  let worldW = 1200,
    worldH = 720,
    fieldW = 800,
    fieldH = 480;
  let pointsField = [],
    pointsDots = [],
    particleMaterials = [];
  let scenePending = false,
    meshRevision = 0;
  let rawTargets = [],
    pingTargets = [],
    pongTargets = [],
    historyTargets = [],
    hasHistory = false;
  let gpuSimulation = null;
  let physicsOptionsDirty = true,
    physicsMatrixDirty = true;
  let disposed = false;
  let editQueue = Promise.resolve(),
    pendingEdits = 0;
  function queueEdit(action, snapshot = true) {
    pendingEdits++;
    editQueue = editQueue
      .then(async () => {
        if (disposed) return;
        if (snapshot && gpuSimulation) particles = await gpuSimulation.readParticles(renderer);
        if (!disposed) await action();
      })
      .catch((error) => {
        console.error("Particle operation failed", error);
        toast("Particle operation failed: " + error.message);
      })
      .finally(() => {
        pendingEdits--;
      });
    return editQueue;
  }
  const mouse = {
    x: 0,
    y: 0,
    down: false,
    repel: false,
    active: false,
    touch: false,
  };

  const profiling = new URLSearchParams(window.location.search).has("profile");
  function fail(message) {
    onError(message);
  }
  function snapshot() {
    return {
      options: { ...options },
      matrix: matrix.map((row) => [...row]),
      count: particles.length,
      playing,
    };
  }
  function updateUI() {
    onUpdate(snapshot());
  }
  function toast(message) {
    onUpdate({ ...snapshot(), toast: message });
  }
  function renderPixelRatio() {
    const nativeRatio = window.devicePixelRatio || 1;
    if (options.renderScale === "native") return nativeRatio;
    if (options.renderScale === "auto") return Math.min(nativeRatio, 1);
    return Number(options.renderScale);
  }
  renderer.autoClear = false;
  renderer.toneMapping = THREE.NoToneMapping;
  const {
    field: sceneField,
    dots: sceneDots,
    blur: sceneBlur,
    display: sceneDisplay,
    particleBackground: sceneParticleBackground,
    optics: sceneOptics,
  } = scenes;
  const { world: worldCamera, quad: quadCamera } = cameras;
  const {
    field: fieldMaterial,
    dots: dotsMaterial,
    blur: blurMaterial,
    display: displayMaterial,
    optics: opticsMaterial,
    particleBackground: particleBackgroundMaterial,
  } = materials;
  let specimenTarget;
  function target(w, h) {
    return new THREE.RenderTarget(w, h, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }
  function makeMatrix() {
    physicsMatrixDirty = true;
    const palette = [
      0xa34bb1, 0xeb6682, 0x269bab, 0x7560c9, 0x55a87a, 0xe19b46, 0x4b79c7, 0xd8538c, 0x88ad4a,
      0xd17c62, 0x3a9db0, 0xc765ba,
    ];
    for (let i = 0; i < 12; i++) {
      const c = new THREE.Color(i < options.types ? palette[i] : 0);
      displayMaterial.uniforms.uPalette.value[i].value.set(c.r, c.g, c.b);
    }
    displayMaterial.uniforms.uTypes.value = options.types;
    updateUI();
  }
  function usePreset(name) {
    matrix = createPreset(name, options.types);
    makeMatrix();
  }
  function setTypes(n) {
    const oldN = options.types;
    const old = matrix;
    options.types = clamp(Math.round(n), 2, 12);
    matrix = Array.from({ length: options.types }, (_, i) =>
      Array.from({ length: options.types }, (_, j) =>
        i < oldN && j < oldN ? old[i][j] : rand(-1, 1),
      ),
    );
    makeMatrix();
    mixTypes();
    updateUI();
    toast(`Particle types: ${options.types}. New interactions are independent.`);
  }
  function mixTypes() {
    const types = particles.map((_, i) => i % options.types);
    for (let i = types.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [types[i], types[j]] = [types[j], types[i]];
    }
    for (let i = 0; i < particles.length; i++) particles[i].t = types[i];
    rebuildGeometry();
    hasHistory = false;
  }
  function randomParticle() {
    return {
      x: rand(0, worldW),
      y: rand(0, worldH),
      vx: rand(-20, 20),
      vy: rand(-20, 20),
      t: Math.floor(Math.random() * options.types),
    };
  }
  function resetParticles() {
    particles = Array.from({ length: options.count }, randomParticle);
    mixTypes();
    toast("Particles reset; matrix preserved");
  }
  function setParticleCount(n) {
    n = clamp(Math.round(n), 100, MAX_PARTICLES);
    options.count = n;
    while (particles.length < n) particles.push(randomParticle());
    if (particles.length > n) particles.length = n;
    rebuildGeometry();
    updateUI();
    hasHistory = false;
  }
  function rebuildGeometry() {
    scenePending = true;
    for (const material of particleMaterials) material.dispose();
    particleMaterials = [];
    pointsField = [];
    pointsDots = [];
    gpuSimulation?.dispose();
    const count = particles.length;
    gpuSimulation = createGpuPhysics(particles, worldW, worldH);
    physicsOptionsDirty = physicsMatrixDirty = true;
    loop.resetPointer();
    // Initialize both the storage buffers and the active state before queued edits can read them.
    gpuSimulation.resize(renderer, worldW, worldH);
    pointsField = [];
    pointsDots = [];
    const index = instanceIndex.mod(uint(count));
    const copy = instanceIndex.div(uint(count));
    const type = gpuSimulation.typeBuffer.element(index).x;
    let tint = displayMaterial.uniforms.uPalette.value[0];
    for (let i = 1; i < 12; i++)
      tint = select(type.equal(i), displayMaterial.uniforms.uPalette.value[i], tint);
    for (const state of gpuSimulation.states) {
      const field = fieldMaterial.clone(),
        dots = dotsMaterial.clone();
      field.uniforms = fieldMaterial.uniforms;
      dots.uniforms = dotsMaterial.uniforms;
      bindParticleFragments(field, dots, type, tint);
      const pos = state.element(index).xy;
      const world = gpuSimulation.settings.world;
      const shift = vec2(
        select(
          copy.mod(uint(2)).equal(uint(1)),
          select(pos.x.lessThan(world.x.mul(0.5)), world.x, world.x.negate()),
          0,
        ),
        select(
          copy.greaterThanEqual(uint(2)),
          select(pos.y.lessThan(world.y.mul(0.5)), world.y, world.y.negate()),
          0,
        ),
      );
      field.positionNode = positionLocal.mul(field.uniforms.uSize).add(vec3(pos.add(shift), 0));
      dots.positionNode = positionLocal.mul(dots.uniforms.uSize).add(vec3(pos, 0));
      particleMaterials.push(field, dots);
    }
    onMeshesChange({ revision: ++meshRevision, count, materials: particleMaterials });
    updateUI();
  }
  function updateActiveBuffers() {
    pointsField.forEach((mesh, i) => {
      if (mesh) mesh.visible = gpuSimulation.state === gpuSimulation.states[i];
    });
    pointsDots.forEach((mesh, i) => {
      if (mesh) mesh.visible = gpuSimulation.state === gpuSimulation.states[i];
    });
  }
  function render() {
    if (options.mode === "particles") {
      renderer.setRenderTarget(null);
      renderer.render(sceneParticleBackground, quadCamera);
      dotsMaterial.uniforms.uSize.value = (3.4 * worldH) / window.innerHeight;
      renderer.render(sceneDots, worldCamera);
      return;
    }
    if (options.mode !== "particles") {
      fieldMaterial.uniforms.uSize.value = Math.max(2, options.blob * 3);
      for (let group = 0; group < Math.ceil(options.types / 4); group++) {
        fieldMaterial.uniforms.uGroup.value = group;
        renderer.setRenderTarget(rawTargets[group]);
        renderer.setClearColor(0x000000, 0);
        renderer.clear(true, true, true);
        renderer.render(sceneField, worldCamera);
        const next =
          historyTargets[group] === pingTargets[group] ? pongTargets[group] : pingTargets[group];
        blurMaterial.uniforms.uInput.value = rawTargets[group].texture;
        blurMaterial.uniforms.uOld.value = historyTargets[group].texture;
        blurMaterial.uniforms.uKeep.value = hasHistory ? options.smooth * 0.79 : 0;
        blurMaterial.uniforms.uBlur.value = 0.25 + options.smooth * 1.6;
        renderer.setRenderTarget(next);
        renderer.clear(true, true, true);
        renderer.render(sceneBlur, quadCamera);
        historyTargets[group] = next;
      }
      hasHistory = true;
      displayMaterial.uniforms.uField0.value = historyTargets[0].texture;
      displayMaterial.uniforms.uField1.value = historyTargets[1].texture;
      displayMaterial.uniforms.uField2.value = historyTargets[2].texture;
    }
    displayMaterial.uniforms.uTime.value = simTime;
    displayMaterial.uniforms.uIso.value = options.iso;
    displayMaterial.uniforms.uFill.value = options.fill;
    displayMaterial.uniforms.uDebris.value = options.debris;
    displayMaterial.uniforms.uInner.value = options.inner;
    displayMaterial.uniforms.uMode.value = options.mode === "particles" ? 2 : 0;
    renderer.setRenderTarget(specimenTarget);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear(true, true, true);
    renderer.render(sceneDisplay, quadCamera);
    if (options.mode !== "contours") {
      dotsMaterial.uniforms.uSize.value = (3.4 * worldH) / window.innerHeight;
      renderer.render(sceneDots, worldCamera);
    }
    renderer.setRenderTarget(null);
    opticsMaterial.uniforms.uEnabled.value = options.eyepiece ? 1 : 0;
    renderer.render(sceneOptics, quadCamera);
  }
  function resize() {
    const oldW = worldW,
      oldH = worldH;
    const cw = Math.max(1, window.innerWidth),
      ch = Math.max(1, window.innerHeight);
    worldH = 720;
    worldW = (worldH * cw) / ch;
    const pixelRatio = renderPixelRatio();
    setDpr(pixelRatio);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(cw, ch, false);
    if (specimenTarget) specimenTarget.dispose();
    specimenTarget = target(canvas.width, canvas.height);
    opticsMaterial.uniforms.uImage.value = specimenTarget.texture;
    opticsMaterial.uniforms.uAspect.value = cw / ch;
    opticsMaterial.uniforms.uPixel.value.set(1 / specimenTarget.width, 1 / specimenTarget.height);
    worldCamera.left = 0;
    worldCamera.right = worldW;
    worldCamera.top = 0;
    worldCamera.bottom = worldH;
    worldCamera.updateProjectionMatrix();
    if (gpuSimulation) {
      gpuSimulation.resize(renderer, worldW, worldH);
      updateActiveBuffers();
    } else {
      for (const p of particles) {
        p.x = (p.x / oldW) * worldW;
        p.y = (p.y / oldH) * worldH;
      }
    }
    resizeField(cw, ch);
    displayMaterial.uniforms.uAspect.value = cw / ch;
    particleBackgroundMaterial.uniforms.uAspect.value = cw / ch;
  }
  function resizeField(cw, ch) {
    fieldW = Math.max(1, Math.round(cw * options.fieldScale));
    fieldH = Math.max(1, Math.round(ch * options.fieldScale));
    for (const rt of [...rawTargets, ...pingTargets, ...pongTargets]) rt.dispose();
    rawTargets = Array.from({ length: 3 }, () => target(fieldW, fieldH));
    pingTargets = Array.from({ length: 3 }, () => target(fieldW, fieldH));
    pongTargets = Array.from({ length: 3 }, () => target(fieldW, fieldH));
    historyTargets = [...pingTargets];
    hasHistory = false;
    blurMaterial.uniforms.uStep.value.set(1 / fieldW, 1 / fieldH);
  }
  function getConfig() {
    return {
      format: "particle-contour-life-v3",
      version: 3,
      options: { ...options },
      matrix: matrix.map((row) => [...row]),
      particles: particles.map((p) => ({
        x: p.x / worldW,
        y: p.y / worldH,
        vx: p.vx,
        vy: p.vy,
        t: p.t,
      })),
    };
  }
  function download(name, body, type) {
    const blob = new Blob([body], { type }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  const sliderBounds = {
    force: [0.1, 2.5],
    range: [35, 160],
    beta: [0.1, 0.55],
    halfLife: [0.04, 0.48],
    speed: [0.005, 2.5],
    barnesHutTheta: [0.2, 1.5],
    minCellSize: [16, 180],
    blob: [10, 65],
    iso: [0.15, 1],
    smooth: [0, 1],
    fill: [0, 1],
    debris: [0, 1],
    inner: [0, 2],
  };
  function importFile(file) {
    return queueEdit(async () => {
      try {
        const config = JSON.parse(await file.text());
        const { types: n, matrix: m } = validateMatrix(config);
        const saved = { ...config.options };
        for (const id of sliderIds) {
          if (id === "types" || id === "count") continue;
          const bounds = sliderBounds[id],
            v = Number(saved[id]);
          if (bounds && Number.isFinite(v)) options[id] = clamp(v, bounds[0], bounds[1]);
        }
        options.types = n;
        options.physicsHz = [60, 120, 240].includes(Number(saved.physicsHz))
          ? Number(saved.physicsHz)
          : 240;
        options.fieldScale = [0.33, 0.5, 0.67, 1].includes(Number(saved.fieldScale))
          ? Number(saved.fieldScale)
          : 0.67;
        options.renderScale = ["auto", "1", "1.5", "native"].includes(saved.renderScale)
          ? saved.renderScale
          : "auto";
        resize();
        options.barnesHut = saved.barnesHut === true;
        options.adaptive = !options.barnesHut && saved.adaptive === true;
        options.approximate = !options.barnesHut && saved.approximate === true;
        options.mode = ["both", "contours", "particles"].includes(saved.mode) ? saved.mode : "both";
        options.eyepiece = typeof saved.eyepiece === "boolean" ? saved.eyepiece : true;
        matrix = m;
        makeMatrix();
        if (
          Array.isArray(config.particles) &&
          config.particles.length >= 1 &&
          config.particles.length <= MAX_PARTICLES
        ) {
          particles = restoreParticles(config.particles, n, worldW, worldH);
          options.count = particles.length;
        } else {
          options.count = clamp(Math.round(Number(saved.count) || 8000), 100, MAX_PARTICLES);
          particles = Array.from({ length: options.count }, randomParticle);
        }
        rebuildGeometry();
        hasHistory = false;
        updateUI();
        toast("Configuration loaded");
      } catch (err) {
        console.error(err);
        toast("JSON error: " + err.message);
      }
    }, false);
  }
  function togglePlay() {
    playing = !playing;
    updateUI();
  }
  function setOption(id, value) {
    if (id === "types" || id === "count")
      return queueEdit(() => (id === "types" ? setTypes(value) : setParticleCount(value)));
    options[id] = value;
    if (
      [
        "force",
        "range",
        "beta",
        "halfLife",
        "minCellSize",
        "barnesHutTheta",
        "physicsHz",
        "approximate",
        "barnesHut",
        "adaptive",
      ].includes(id)
    )
      physicsOptionsDirty = true;
    if (id === "barnesHut" && value) {
      options.approximate = false;
      options.adaptive = false;
    }
    if ((id === "adaptive" || id === "approximate") && value) options.barnesHut = false;
    if (["blob", "smooth", "mode"].includes(id)) hasHistory = false;
    if (id === "fieldScale")
      resizeField(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight));
    if (id === "renderScale") queueEdit(resize, false);
    updateUI();
  }
  function setCell(i, j, value) {
    matrix[i][j] = clamp(Number.isFinite(value) ? value : 0, -1, 1);
    physicsMatrixDirty = true;
    updateUI();
  }
  function addParticles(x, y) {
    queueEdit(() => {
      const n = Math.min(24, MAX_PARTICLES - particles.length);
      for (let i = 0; i < n; i++)
        particles.push({
          x: (((x + rand(-30, 30)) % worldW) + worldW) % worldW,
          y: (((y + rand(-30, 30)) % worldH) + worldH) % worldH,
          vx: rand(-30, 30),
          vy: rand(-30, 30),
          t: Math.floor(Math.random() * options.types),
        });
      options.count = particles.length;
      rebuildGeometry();
      updateUI();
      toast(`Added ${n} particles`);
    });
  }
  const loop = createSimulationLoop({
    options,
    mouse,
    renderer,
    profiling,
    isPlaying: () => playing,
    hasPendingEdits: () => pendingEdits > 0,
    getSimulation: () => gpuSimulation,
    getMatrix: () => matrix,
    isPhysicsOptionsDirty: () => physicsOptionsDirty,
    clearPhysicsOptionsDirty: () => {
      physicsOptionsDirty = false;
    },
    isPhysicsMatrixDirty: () => physicsMatrixDirty,
    clearPhysicsMatrixDirty: () => {
      physicsMatrixDirty = false;
    },
    advanceTime: (delta) => {
      simTime += delta;
    },
    updateActiveBuffers,
    render,
    fail,
    onFps,
  });
  usePreset("random");
  resize();
  resetParticles();
  updateUI();
  return {
    frame: (time) => {
      if (!scenePending) loop.frame(time);
    },
    sceneReady: (revision, meshes) => {
      if (revision !== meshRevision || disposed) return;
      pointsField = meshes.field;
      pointsDots = meshes.dots;
      updateActiveBuffers();
      scenePending = false;
    },
    resize: () => queueEdit(resize, false),
    pointer: (event, down) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = clamp((event.clientX - rect.left) / rect.width, 0, 1) * worldW;
      const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      mouse.y = (options.mode === "particles" ? y : 1 - y) * worldH;
      mouse.repel = event.button === 2 || event.buttons === 2 || event.shiftKey;
      mouse.touch = event.pointerType === "touch";
      if (down !== undefined) mouse.down = down;
    },
    releasePointer: () => {
      mouse.down = false;
    },
    addAtPointer: () => addParticles(mouse.x, mouse.y),
    setOption,
    setCell,
    togglePlay,
    usePreset,
    reset: () => queueEdit(resetParticles, false),
    scramble: () =>
      queueEdit(() => {
        mixTypes();
        toast("Types shuffled; positions preserved");
      }),
    clearMatrix: () => {
      matrix.forEach((row) => row.fill(0));
      makeMatrix();
    },
    exportJSON: () =>
      queueEdit(() => {
        download(
          "particle-life-rules.json",
          JSON.stringify(getConfig(), null, 2),
          "application/json",
        );
        toast("JSON saved: matrix, settings and state");
      }),
    importFile,
    savePNG: () => {
      try {
        render();
        const link = document.createElement("a");
        link.download = "particle-contour-life.png";
        link.href = canvas.toDataURL("image/png");
        link.click();
        toast("PNG saved");
      } catch (error) {
        toast("Could not save PNG: " + error.message);
      }
    },
    dispose: () => {
      disposed = true;
      gpuSimulation?.dispose();
      for (const material of particleMaterials) material.dispose();
      for (const rt of [...rawTargets, ...pingTargets, ...pongTargets]) rt.dispose();
      specimenTarget?.dispose();
    },
  };
}
