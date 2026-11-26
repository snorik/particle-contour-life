import * as THREE from "three/webgpu";
import {
  instanceIndex,
  positionLocal,
  select,
  uint,
  vec2,
  vec3,
} from "three/tsl";
import { bindParticleFragments, createMaterials } from "./gpu-materials.js";
import { createGpuPhysics } from "./gpu-physics.js";
import "./style.css";
function fail(message) {
  document.getElementById("loader")?.remove();
  document.body.classList.remove("loading");
  document.getElementById("errorText").textContent = message;
  document.getElementById("error").style.display = "block";
}
start().catch((e) => {
  console.error(e);
  fail("WebGPU/JavaScript error: " + e.message);
});
async function start() {
  const $ = (id) => document.getElementById(id);
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
    speed: 0.5,
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
  };
  let matrix = [],
    selected = [0, 1],
    colors = [],
    particles = [],
    simTime = 0,
    playing = true;
  let worldW = 1200,
    worldH = 720,
    fieldW = 800,
    fieldH = 480;
  let pointsField = [],
    pointsDots = [];
  let rawTargets = [],
    pingTargets = [],
    pongTargets = [],
    historyTargets = [],
    hasHistory = false;
  let gpuRenderer = null,
    gpuSimulation = null;
  let physicsOptionsDirty = true,
    physicsMatrixDirty = true;
  let lastPointerX, lastPointerY, lastPointerStrength;
  let editQueue = Promise.resolve(),
    pendingEdits = 0;
  function queueEdit(action, snapshot = true) {
    pendingEdits++;
    editQueue = editQueue
      .then(async () => {
        if (snapshot && gpuSimulation)
          particles = await gpuSimulation.readParticles(renderer);
        await action();
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
  const mouse = { x: 0, y: 0, down: false, repel: false, active: false };

  const canvas = $("stage");
  const profiling = new URLSearchParams(window.location.search).has("profile");
  if (!navigator.gpu)
    throw new Error("WebGPU is not available in this browser.");
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
    trackTimestamp: profiling,
  });
  await renderer.init();
  if (!renderer.backend.isWebGPUBackend)
    throw new Error("WebGPU is not available on this device.");
  gpuRenderer = renderer;
  if (profiling && !renderer.backend.trackTimestamp)
    console.info(
      "GPU profiling unavailable: timestamp queries are not supported.",
    );
  function renderPixelRatio() {
    const nativeRatio = window.devicePixelRatio || 1;
    if (options.renderScale === "native") return nativeRatio;
    if (options.renderScale === "auto") return Math.min(nativeRatio, 1);
    return Number(options.renderScale);
  }
  renderer.autoClear = false;
  const sceneField = new THREE.Scene(),
    sceneDots = new THREE.Scene(),
    sceneBlur = new THREE.Scene(),
    sceneDisplay = new THREE.Scene(),
    sceneParticleBackground = new THREE.Scene(),
    sceneOptics = new THREE.Scene();
  let specimenTarget;
  const worldCamera = new THREE.OrthographicCamera(0, worldW, 0, worldH, -2, 2);
  worldCamera.position.z = 1;
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  quadCamera.position.z = 1;
  const {
    field: fieldMaterial,
    dots: dotsMaterial,
    blur: blurMaterial,
    display: displayMaterial,
    optics: opticsMaterial,
    particleBackground: particleBackgroundMaterial,
  } = createMaterials();
  sceneParticleBackground.add(
    new THREE.Mesh(new THREE.PlaneGeometry(2, 2), particleBackgroundMaterial),
  );
  sceneBlur.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMaterial));
  sceneDisplay.add(
    new THREE.Mesh(new THREE.PlaneGeometry(2, 2), displayMaterial),
  );
  sceneOptics.add(
    new THREE.Mesh(new THREE.PlaneGeometry(2, 2), opticsMaterial),
  );
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
  function rgb(type) {
    return colors[type] || colors[0];
  }
  function cssColor(type) {
    return "#" + rgb(type).getHexString();
  }
  function initColors() {
    colors = [];
    for (let i = 0; i < options.types; i++) {
      const color = new THREE.Color();
      color.set(
        [
          0xa34bb1, 0xeb6682, 0x269bab, 0x7560c9, 0x55a87a, 0xe19b46, 0x4b79c7,
          0xd8538c, 0x88ad4a, 0xd17c62, 0x3a9db0, 0xc765ba,
        ][i],
      );
      colors.push(color);
    }
    for (let i = 0; i < 12; i++) {
      const c = colors[i] || new THREE.Color(0);
      displayMaterial.uniforms.uPalette.value[i].value.set(c.r, c.g, c.b);
    }
    displayMaterial.uniforms.uTypes.value = options.types;
  }
  function randomizeMatrix() {
    matrix = Array.from({ length: options.types }, () =>
      Array.from({ length: options.types }, () => rand(-1, 1)),
    );
    makeMatrix();
    toast("New asymmetric matrix applied");
  }
  function usePreset(name) {
    const n = options.types;
    matrix = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) =>
        i === j ? rand(0.3, 0.66) : rand(-0.21, 0.21),
      ),
    );
    if (name === "random") {
      randomizeMatrix();
      return;
    }
    if (name === "colonies") {
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          matrix[i][j] = i === j ? rand(0.54, 0.87) : rand(-0.55, -0.08);
    }
    if (name === "chase") {
      for (let i = 0; i < n; i++) {
        matrix[i][i] = rand(0.13, 0.56);
        for (let j = 0; j < n; j++)
          if (i !== j) matrix[i][j] = rand(-0.35, 0.25);
      }
      matrix[0][1] = 0.9;
      matrix[1][0] = -0.85;
      if (n > 2) {
        matrix[2][0] = 0.74;
        matrix[0][2] = -0.55;
      }
      if (n > 3) {
        matrix[3][2] = 0.78;
        matrix[2][3] = -0.62;
      }
    }
    if (name === "cycle") {
      for (let i = 0; i < n; i++) {
        matrix[i][i] = rand(0.08, 0.4);
        for (let j = 0; j < n; j++) if (i !== j) matrix[i][j] = rand(-0.2, 0.2);
      }
      for (let i = 0; i < n; i++) {
        const next = (i + 1) % n;
        matrix[i][next] = 0.92;
        if (n > 2) matrix[next][i] = -0.85;
      }
      if (n === 2) {
        matrix[0][1] = 0.92;
        matrix[1][0] = -0.85;
      }
    }
    if (name === "symbiosis") {
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          matrix[i][j] = i === j ? rand(0.15, 0.32) : rand(0.32, 0.7);
    }
    if (name === "partners") {
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          matrix[i][j] =
            i === j
              ? rand(0.25, 0.55)
              : Math.floor(i / 2) === Math.floor(j / 2)
                ? rand(0.55, 0.85)
                : rand(-0.55, -0.12);
    }
    if (name === "schools") {
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          matrix[i][j] = i === j ? rand(0.7, 0.95) : rand(-0.15, 0.15);
    }
    if (name === "chains") {
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          matrix[i][j] =
            i === j
              ? rand(0.25, 0.45)
              : j === (i + 1) % n
                ? rand(0.65, 0.9)
                : i === (j + 1) % n
                  ? rand(-0.45, -0.18)
                  : rand(-0.2, 0.1);
    }
    if (name === "orbit") {
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          matrix[i][j] =
            i === j
              ? rand(0.2, 0.45)
              : i === 0
                ? rand(0.3, 0.6)
                : j === 0
                  ? rand(0.65, 0.9)
                  : rand(-0.5, -0.2);
    }
    if (name === "ecosystem") {
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++)
          matrix[i][j] =
            i === j
              ? rand(0.2, 0.6)
              : (i + j) % 3 === 0
                ? rand(0.35, 0.8)
                : rand(-0.65, 0.25);
    }
    makeMatrix();
    toast(
      "Applied directional rules: " +
        $("preset").selectedOptions[0].textContent,
    );
  }
  function valColor(v) {
    const a = Math.abs(v);
    if (v > 0.012) return `rgba(58,168,120,${(0.12 + a * 0.4).toFixed(3)})`;
    if (v < -0.012) return `rgba(221,99,112,${(0.12 + a * 0.4).toFixed(3)})`;
    return "#e6eee8";
  }
  function cellDescription(i, j) {
    return `Type ${i + 1} → Type ${j + 1}: ${matrix[i][j].toFixed(2)}`;
  }
  function drawCell(i, j) {
    const el = $(`m_${i}_${j}`);
    if (!el) return;
    const v = matrix[i][j];
    el.textContent = (v >= 0 ? "+" : "") + v.toFixed(2);
    el.style.background = valColor(v);
    el.title = cellDescription(i, j);
    el.setAttribute("aria-label", el.title);
  }
  function selectCell(i, j) {
    selected = [i, j];
    document
      .querySelectorAll(".mcell.selected")
      .forEach((e) => e.classList.remove("selected"));
    const el = $(`m_${i}_${j}`);
    if (el) el.classList.add("selected");
    $("pairTitle").innerHTML =
      `<span style="color:${cssColor(i)}">●</span> Type ${i + 1} → <span style="color:${cssColor(j)}">●</span> Type ${j + 1}`;
    $("cellRange").value = matrix[i][j];
    $("cellNum").value = matrix[i][j].toFixed(2);
    setSliderFill($("cellRange"));
  }
  function setCell(v) {
    const [i, j] = selected;
    matrix[i][j] = clamp(Number.isFinite(v) ? v : 0, -1, 1);
    physicsMatrixDirty = true;
    drawCell(i, j);
    selectCell(i, j);
  }
  function makeMatrix() {
    physicsMatrixDirty = true;
    const n = options.types;
    initColors();
    const grid = $("matrix");
    grid.textContent = "";
    grid.style.gridTemplateColumns = `repeat(${n + 1}, var(--tile))`;
    const addLabel = (type) => {
      const el = document.createElement("div");
      el.className = "mlbl";
      if (type !== null) {
        const dot = document.createElement("i");
        dot.style.background = cssColor(type);
        el.appendChild(dot);
        el.title = "Type " + (type + 1);
      }
      return el;
    };
    grid.appendChild(addLabel(null));
    for (let j = 0; j < n; j++) grid.appendChild(addLabel(j));
    for (let i = 0; i < n; i++) {
      grid.appendChild(addLabel(i));
      for (let j = 0; j < n; j++) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "mcell";
        b.id = `m_${i}_${j}`;
        b.addEventListener("click", () => selectCell(i, j));
        grid.appendChild(b);
        drawCell(i, j);
      }
    }
    if (selected[0] >= n) selected[0] = 0;
    if (selected[1] >= n) selected[1] = Math.min(1, n - 1);
    selectCell(...selected);
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
    toast(
      `Particle types: ${options.types}. New interactions are independent.`,
    );
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
    $("numTop").textContent = particles.length;
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
    for (const mesh of [...pointsField, ...pointsDots]) {
      mesh.parent.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
    }
    gpuSimulation?.dispose();
    const count = particles.length;
    gpuSimulation = createGpuPhysics(particles, worldW, worldH);
    physicsOptionsDirty = physicsMatrixDirty = true;
    lastPointerX = lastPointerY = lastPointerStrength = undefined;
    // Initialize both the storage buffers and the active state before queued edits can read them.
    gpuSimulation.resize(renderer, worldW, worldH);
    pointsField = [];
    pointsDots = [];
    const index = instanceIndex.mod(uint(count));
    const copy = instanceIndex.div(uint(count));
    const type = gpuSimulation.typeBuffer.element(index).x;
    let tint = displayMaterial.uniforms.uPalette.value[0];
    for (let i = 1; i < 12; i++)
      tint = select(
        type.equal(i),
        displayMaterial.uniforms.uPalette.value[i],
        tint,
      );
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
      field.positionNode = positionLocal
        .mul(field.uniforms.uSize)
        .add(vec3(pos.add(shift), 0));
      dots.positionNode = positionLocal
        .mul(dots.uniforms.uSize)
        .add(vec3(pos, 0));
      const fieldMesh = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        field,
        count * 4,
      );
      const dotMesh = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        dots,
        count,
      );
      fieldMesh.frustumCulled = dotMesh.frustumCulled = false;
      sceneField.add(fieldMesh);
      sceneDots.add(dotMesh);
      pointsField.push(fieldMesh);
      pointsDots.push(dotMesh);
    }
    updateActiveBuffers();
    $("numTop").textContent = count;
    $("typesTop").textContent = options.types;
  }
  function updateActiveBuffers() {
    pointsField.forEach((mesh, i) => {
      mesh.visible = gpuSimulation.state === gpuSimulation.states[i];
    });
    pointsDots.forEach((mesh, i) => {
      mesh.visible = gpuSimulation.state === gpuSimulation.states[i];
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
          historyTargets[group] === pingTargets[group]
            ? pongTargets[group]
            : pingTargets[group];
        blurMaterial.uniforms.uInput.value = rawTargets[group].texture;
        blurMaterial.uniforms.uOld.value = historyTargets[group].texture;
        blurMaterial.uniforms.uKeep.value = hasHistory
          ? options.smooth * 0.79
          : 0;
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
    renderer.render(sceneOptics, quadCamera);
  }
  function resize() {
    const oldW = worldW,
      oldH = worldH;
    const cw = Math.max(1, window.innerWidth),
      ch = Math.max(1, window.innerHeight);
    worldH = 720;
    worldW = (worldH * cw) / ch;
    renderer.setPixelRatio(renderPixelRatio());
    renderer.setSize(cw, ch, false);
    if (specimenTarget) specimenTarget.dispose();
    const pixelRatio = renderer.getPixelRatio();
    specimenTarget = target(
      Math.round(cw * pixelRatio),
      Math.round(ch * pixelRatio),
    );
    opticsMaterial.uniforms.uImage.value = specimenTarget.texture;
    opticsMaterial.uniforms.uAspect.value = cw / ch;
    opticsMaterial.uniforms.uPixel.value.set(
      1 / specimenTarget.width,
      1 / specimenTarget.height,
    );
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
    for (const rt of [...rawTargets, ...pingTargets, ...pongTargets])
      rt.dispose();
    rawTargets = Array.from({ length: 3 }, () => target(fieldW, fieldH));
    pingTargets = Array.from({ length: 3 }, () => target(fieldW, fieldH));
    pongTargets = Array.from({ length: 3 }, () => target(fieldW, fieldH));
    historyTargets = [...pingTargets];
    hasHistory = false;
    blurMaterial.uniforms.uStep.value.set(1 / fieldW, 1 / fieldH);
  }
  function setSliderFill(el) {
    const lo = Number(el.min),
      hi = Number(el.max),
      v = Number(el.value);
    el.style.setProperty(
      "--pct",
      ((100 * (v - lo)) / (hi - lo)).toFixed(2) + "%",
    );
  }
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
  function updateUI() {
    for (const id of sliderIds) {
      const el = $(id);
      el.value = options[id];
      $(id + "Val").textContent = [
        "count",
        "types",
        "range",
        "blob",
        "minCellSize",
      ].includes(id)
        ? String(Math.round(options[id]))
        : Number(options[id]).toFixed(id === "speed" ? 3 : 2);
      setSliderFill(el);
    }
    $("mode").value = options.mode;
    $("approximate").checked = options.approximate;
    $("barnesHut").checked = options.barnesHut;
    $("adaptive").checked = options.adaptive;
    $("physicsHz").value = String(options.physicsHz);
    $("fieldScale").value = String(options.fieldScale);
    $("renderScale").value = options.renderScale;
    $("numTop").textContent = particles.length;
    $("typesTop").textContent = options.types;
  }
  const particleEditTimers = {};
  for (const id of sliderIds) {
    $(id).addEventListener("input", () => {
      const v = Number($(id).value);
      if (id === "types" || id === "count") {
        $(id + "Val").textContent = String(Math.round(v));
        setSliderFill($(id));
        clearTimeout(particleEditTimers[id]);
        particleEditTimers[id] = setTimeout(() => {
          queueEdit(() => (id === "types" ? setTypes(v) : setParticleCount(v)));
        }, 150);
      } else {
        options[id] = v;
        if (
          [
            "force",
            "range",
            "beta",
            "halfLife",
            "minCellSize",
            "barnesHutTheta",
          ].includes(id)
        )
          physicsOptionsDirty = true;
        $(id + "Val").textContent = ["range", "blob", "minCellSize"].includes(
          id,
        )
          ? String(Math.round(v))
          : v.toFixed(id === "speed" ? 3 : 2);
        setSliderFill($(id));
        if (id === "blob" || id === "smooth") hasHistory = false;
      }
    });
  }
  $("approximate").addEventListener("change", () => {
    physicsOptionsDirty = true;
    options.approximate = $("approximate").checked;
    if (options.approximate) {
      options.barnesHut = false;
      $("barnesHut").checked = false;
    }
  });
  $("barnesHut").addEventListener("change", () => {
    physicsOptionsDirty = true;
    options.barnesHut = $("barnesHut").checked;
    if (options.barnesHut) {
      options.approximate = false;
      options.adaptive = false;
      $("adaptive").checked = false;
      $("approximate").checked = false;
    }
  });
  $("adaptive").addEventListener("change", () => {
    physicsOptionsDirty = true;
    options.adaptive = $("adaptive").checked;
    if (options.adaptive) {
      options.barnesHut = false;
      $("barnesHut").checked = false;
    }
  });
  $("mode").addEventListener("change", () => {
    options.mode = $("mode").value;
    hasHistory = false;
  });
  $("physicsHz").addEventListener("change", () => {
    options.physicsHz = Number($("physicsHz").value);
    physicsOptionsDirty = true;
  });
  $("fieldScale").addEventListener("change", () => {
    options.fieldScale = Number($("fieldScale").value);
    resizeField(
      Math.max(1, window.innerWidth),
      Math.max(1, window.innerHeight),
    );
  });
  $("renderScale").addEventListener("change", () => {
    options.renderScale = $("renderScale").value;
    queueEdit(resize, false);
  });
  $("cellRange").addEventListener("input", () =>
    setCell(Number($("cellRange").value)),
  );
  $("cellNum").addEventListener("change", () =>
    setCell(Number($("cellNum").value)),
  );
  $("randomCell").addEventListener("click", () => setCell(rand(-1, 1)));
  $("zeroCell").addEventListener("click", () => setCell(0));
  $("randomMatrix").addEventListener("click", () => {
    $("preset").value = "random";
    randomizeMatrix();
  });
  $("zeroMatrix").addEventListener("click", () => {
    for (const row of matrix) row.fill(0);
    makeMatrix();
    toast("All matrix forces are zero (except short-range repulsion)");
  });
  $("preset").addEventListener("change", () => usePreset($("preset").value));
  $("resetParticles").addEventListener("click", () =>
    queueEdit(resetParticles, false),
  );
  $("scrambleTypes").addEventListener("click", () => {
    queueEdit(() => {
      mixTypes();
      toast("Types shuffled; positions preserved");
    });
  });
  function toast(msg) {
    const node = $("toast");
    node.textContent = msg;
    node.style.opacity = "1";
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (node.style.opacity = "0"), 2300);
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
  $("exportJSON").addEventListener("click", () =>
    queueEdit(() => {
      download(
        "particle-life-rules.json",
        JSON.stringify(getConfig(), null, 2),
        "application/json",
      );
      toast("JSON saved: matrix, settings and state");
    }),
  );
  $("importJSON").addEventListener("click", () => $("fileInput").click());
  $("fileInput").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    e.target.value = "";
    queueEdit(async () => {
      try {
        const config = JSON.parse(await file.text());
        if (!config || !Array.isArray(config.matrix) || !config.options)
          throw new Error("Expected matrix and options fields");
        const n = Math.round(Number(config.options.types));
        if (
          !Number.isFinite(n) ||
          n < 2 ||
          n > 12 ||
          config.matrix.length !== n
        )
          throw new Error("Type count must be between 2 and 12");
        const m = config.matrix.map((r) => {
          if (!Array.isArray(r) || r.length !== n)
            throw new Error("Invalid matrix dimensions");
          return r.map((v) => {
            if (!Number.isFinite(v) || v < -1 || v > 1)
              throw new Error("Forces must be between −1 and +1");
            return v;
          });
        });
        const saved = { ...config.options };
        for (const id of sliderIds) {
          if (id === "types" || id === "count") continue;
          const input = $(id),
            v = Number(saved[id]);
          if (Number.isFinite(v))
            options[id] = clamp(v, Number(input.min), Number(input.max));
        }
        options.types = n;
        options.physicsHz = [60, 120, 240].includes(Number(saved.physicsHz))
          ? Number(saved.physicsHz)
          : 240;
        options.fieldScale = [0.33, 0.5, 0.67, 1].includes(
          Number(saved.fieldScale),
        )
          ? Number(saved.fieldScale)
          : 0.67;
        options.renderScale = ["auto", "1", "1.5", "native"].includes(
          saved.renderScale,
        )
          ? saved.renderScale
          : "auto";
        resize();
        options.barnesHut = saved.barnesHut === true;
        options.adaptive = !options.barnesHut && saved.adaptive === true;
        options.approximate = !options.barnesHut && saved.approximate === true;
        options.mode = ["both", "contours", "particles"].includes(saved.mode)
          ? saved.mode
          : "both";
        matrix = m;
        makeMatrix();
        if (
          Array.isArray(config.particles) &&
          config.particles.length >= 1 &&
          config.particles.length <= MAX_PARTICLES
        ) {
          particles = config.particles.map((q) => ({
            x: clamp(Number(q.x) || 0, 0, 1) * worldW,
            y: clamp(Number(q.y) || 0, 0, 1) * worldH,
            vx: clamp(Number(q.vx) || 0, -380, 380),
            vy: clamp(Number(q.vy) || 0, -380, 380),
            t: clamp(Math.round(Number(q.t) || 0), 0, n - 1),
          }));
          options.count = particles.length;
        } else {
          options.count = clamp(
            Math.round(Number(saved.count) || 8000),
            100,
            MAX_PARTICLES,
          );
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
  });
  $("savePNG").addEventListener("click", () => {
    render();
    try {
      const link = document.createElement("a");
      link.download = "particle-contour-life.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
      toast("PNG saved");
    } catch (err) {
      toast("Could not save PNG: " + err.message);
    }
  });
  const mobile = () => window.matchMedia("(max-width:800px)").matches;
  function syncPanelState() {
    const open = mobile()
      ? document.body.classList.contains("mobile-open")
      : !document.body.classList.contains("closed");
    $("panel").inert = !open;
    $("menuBtn").setAttribute("aria-expanded", String(open));
  }
  function togglePanel() {
    if (mobile()) document.body.classList.toggle("mobile-open");
    else document.body.classList.toggle("closed");
    syncPanelState();
  }
  $("menuBtn").addEventListener("click", () => {
    togglePanel();
  });
  $("closePanel").addEventListener("click", () => {
    document.body.classList.remove("mobile-open");
    document.body.classList.add("closed");
    syncPanelState();
    $("menuBtn").focus();
  });
  syncPanelState();
  function togglePlay() {
    playing = !playing;
    $("playBtn").textContent = playing ? "Ⅱ" : "▶";
    $("playBtn").title = playing ? "Pause / Space" : "Resume / Space";
    $("playBtn").setAttribute(
      "aria-label",
      playing ? "Pause simulation" : "Resume simulation",
    );
  }
  $("playBtn").addEventListener("click", togglePlay);
  function mousePosition(e) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = clamp((e.clientX - rect.left) / rect.width, 0, 1) * worldW;
    mouse.y = clamp((e.clientY - rect.top) / rect.height, 0, 1) * worldH;
    mouse.repel = e.button === 2 || e.buttons === 2 || e.shiftKey;
    mouse.active = true;
  }
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    mousePosition(e);
    mouse.down = true;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    mousePosition(e);
    if (e.buttons === 2) mouse.repel = true;
  });
  canvas.addEventListener("pointerup", () => {
    mouse.down = false;
  });
  canvas.addEventListener("pointercancel", () => {
    mouse.down = false;
    mouse.active = false;
  });
  canvas.addEventListener("dblclick", (e) => {
    mousePosition(e);
    const x = mouse.x,
      y = mouse.y;
    queueEdit(() => {
      const n = Math.min(24, MAX_PARTICLES - particles.length);
      for (let i = 0; i < n; i++) {
        particles.push({
          x: (((x + rand(-30, 30)) % worldW) + worldW) % worldW,
          y: (((y + rand(-30, 30)) % worldH) + worldH) % worldH,
          vx: rand(-30, 30),
          vy: rand(-30, 30),
          t: Math.floor(Math.random() * options.types),
        });
      }
      options.count = particles.length;
      rebuildGeometry();
      updateUI();
      toast(`Added ${n} particles`);
    });
  });
  document.addEventListener("keydown", (e) => {
    if (
      ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)
    )
      return;
    if (e.code === "Space" && !e.repeat) {
      e.preventDefault();
      togglePlay();
    }
    if (
      e.code === "KeyR" &&
      !e.repeat &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      $("randomMatrix").click();
    }
    if (e.key.toLowerCase() === "m" && !e.repeat) {
      togglePanel();
    }
    if (e.key === "Escape" && mobile()) {
      document.body.classList.remove("mobile-open");
      syncPanelState();
    }
  });
  window.addEventListener("blur", () => {
    mouse.down = false;
  });
  window.addEventListener("resize", () => {
    syncPanelState();
    queueEdit(resize, false);
  });
  let last = performance.now(),
    fpsFrames = 0,
    fpsLast = last,
    accumulator = 0;
  let profilePending = false;
  let profileLastLog = last;
  let profileHasCompute = false;
  function frame(now) {
    const STEP = 1 / options.physicsHz;
    const delta = Math.min(0.075, Math.max(0, (now - last) * 0.001));
    last = now;
    if (playing && !pendingEdits) {
      accumulator = Math.min(accumulator + delta * options.speed, 0.12);
      let cycles = 0;
      while (accumulator >= STEP && cycles < 12) {
        try {
          if (cycles === 0) {
            if (physicsOptionsDirty) {
              gpuSimulation.setOptions(options);
              gpuSimulation.settings.dt.value = STEP;
              physicsOptionsDirty = false;
            }
            if (physicsMatrixDirty) {
              gpuSimulation.setMatrix(matrix);
              physicsMatrixDirty = false;
            }
            const strength = mouse.down ? (mouse.repel ? -7 : 7) : 0;
            if (
              mouse.x !== lastPointerX ||
              mouse.y !== lastPointerY ||
              strength !== lastPointerStrength
            ) {
              gpuSimulation.setPointer(mouse.x, mouse.y, strength);
              lastPointerX = mouse.x;
              lastPointerY = mouse.y;
              lastPointerStrength = strength;
            }
          }
          gpuSimulation.step(gpuRenderer);
          profileHasCompute = true;
        } catch (error) {
          console.error("WebGPU physics failed", error);
          fail("WebGPU physics error: " + error.message);
          return;
        }
        simTime += STEP;
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
    if (document.body.classList.contains("loading")) {
      document.body.classList.remove("loading");
      $("loader").remove();
    }
    fpsFrames++;
    if (now - fpsLast > 850) {
      $("fpsTop").textContent = Math.round(
        (fpsFrames * 1000) / (now - fpsLast),
      );
      fpsFrames = 0;
      fpsLast = now;
    }
    requestAnimationFrame(frame);
  }
  usePreset("chains");
  resize();
  resetParticles();
  updateUI();
  requestAnimationFrame(frame);
}
