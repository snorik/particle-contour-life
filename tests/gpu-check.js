import { WebGPURenderer, Scene, OrthographicCamera } from "three/webgpu";
import { createGpuParticles } from "../src/gpu-particles.js";
import { createGpuPhysics } from "../src/gpu-physics.js";

const result = document.querySelector("#result");
const width = 100;
const beta = 0.28;
const dt = 1 / 60;
const matrix = [
  [0, 1],
  [-1, 0],
];

function referenceStep(particles, radius) {
  const shortest = (d) =>
    d > width / 2 ? d - width : d < -width / 2 ? d + width : d;
  return particles.map((p, i) => {
    let ax = 0,
      ay = 0;
    particles.forEach((q, j) => {
      if (i === j) return;
      const dx = shortest(q.x - p.x),
        dy = shortest(q.y - p.y);
      const distance = Math.hypot(dx, dy);
      if (distance >= radius || distance * distance < 0.00001) return;
      const r = distance / radius;
      const f =
        r < beta
          ? r / beta - 1
          : matrix[p.t][q.t] * (1 - Math.abs(2 * r - 1 - beta) / (1 - beta));
      ax += (dx / distance) * f;
      ay += (dy / distance) * f;
    });
    const damping = 0.5 ** (dt / 0.16);
    const wallForce = (position) => {
      const range = Math.min(width / 2, 80);
      const start = Math.max(0, 1 - position / range);
      const end = Math.max(0, 1 - (width - position) / range);
      return (start * start - end * end) * 1200;
    };
    let vx = p.vx * damping + (ax * 760 + wallForce(p.x)) * dt;
    let vy = p.vy * damping + (ay * 760 + wallForce(p.y)) * dt;
    const speed = Math.hypot(vx, vy);
    if (speed > 380) {
      vx *= 380 / speed;
      vy *= 380 / speed;
    }
    return {
      ...p,
      x: (((p.x + vx * dt) % width) + width) % width,
      y: (((p.y + vy * dt) % width) + width) % width,
      vx,
      vy,
    };
  });
}

try {
  if (!navigator.gpu)
    throw new Error("WebGPU is not available in this browser");
  const renderer = new WebGPURenderer();
  await renderer.init();
  if (!renderer.backend.isWebGPUBackend)
    throw new Error("WebGPU backend is unavailable");
  const cases = [
    {
      radius: 120,
      initial: [
        { x: 20, y: 50, vx: 0, vy: 0, t: 0 },
        { x: 40, y: 50, vx: 0, vy: 0, t: 1 },
      ],
    },
    {
      radius: 50,
      initial: [
        { x: 2, y: 50, vx: -20, vy: 0, t: 0 },
        { x: 98, y: 50, vx: 0, vy: 0, t: 1 },
      ],
    },
    {
      radius: 22,
      initial: Array.from({ length: 48 }, (_, i) => ({
        x: (i * 37 + 2) % width,
        y: (i * 61 + 3) % width,
        vx: (i % 3) - 1,
        vy: (i % 5) - 2,
        t: i % 2,
      })),
    },
    {
      radius: 20,
      initial: Array.from({ length: 80 }, (_, i) => ({
        x: 30 + (i % 10) * 0.23,
        y: 30 + Math.floor(i / 10) * 0.23,
        vx: 0,
        vy: 0,
        t: i % 2,
      })),
    },
  ];
  for (const { initial, radius } of cases) {
    let expected = initial;
    const simulation = createGpuPhysics(initial, width, width);
    simulation.settings.radius.value = radius;
    simulation.setMatrix(matrix);
    for (let step = 0; step < 5; step++) {
      expected = referenceStep(expected, radius);
      simulation.step(renderer);
      const actual = new Float32Array(
        await renderer.getArrayBufferAsync(simulation.state.value),
      );
      expected.forEach((p, i) =>
        [p.x, p.y, p.vx, p.vy].forEach((value, k) => {
          if (Math.abs(actual[i * 4 + k] - value) > 0.01)
            throw new Error(
              `Mismatch at step ${step}, particle ${i}, component ${k}: GPU ${actual[i * 4 + k]}, CPU ${value}`,
            );
        }),
      );
    }
    const dots = createGpuParticles(simulation, initial.length);
    const scene = new Scene();
    scene.add(...dots.sprites);
    dots.update();
    const camera = new OrthographicCamera(0, width, 0, width, -1, 1);
    renderer.setSize(100, 100);
    renderer.render(scene, camera);
    dots.dispose();
    const saved = await simulation.readParticles(renderer);
    if (
      saved.length !== expected.length ||
      saved[0].t !== initial[0].t ||
      Math.abs(saved[0].x - expected[0].x) > 0.001
    )
      throw new Error("Particle readback mismatch");
    simulation.resize(renderer, 200, 150);
    const resized = await simulation.readParticles(renderer);
    if (
      Math.abs(resized[0].x - saved[0].x * 2) > 0.001 ||
      Math.abs(resized[0].y - saved[0].y * 1.5) > 0.001 ||
      Math.abs(resized[0].vx - saved[0].vx) > 0.001
    ) {
      throw new Error("GPU resize mismatch");
    }
    simulation.dispose();
  }
  const wallParticles = [2, 20, 50, 80, 98].map((x) => ({
    x,
    y: 50,
    vx: 0,
    vy: 0,
    t: 0,
  }));
  for (const mode of [{}, { adaptive: true }, { barnesHut: true }]) {
    const simulation = createGpuPhysics(wallParticles, width, width);
    simulation.setOptions({
      range: 10,
      beta,
      force: 0,
      halfLife: 0.16,
      minCellSize: 32,
      ...mode,
    });
    simulation.step(renderer);
    const actual = await simulation.readParticles(renderer);
    const velocities = actual.map((p) => p.vx);
    if (!(
      velocities[0] > velocities[1] &&
      velocities[1] > 0 &&
      Math.abs(velocities[2]) < 0.001 &&
      velocities[3] < 0 &&
      velocities[4] < velocities[3]
    )) {
      throw new Error(
        `Wall repulsion mismatch: ${JSON.stringify({ mode, velocities })}`,
      );
    }
    simulation.dispose();
  }
  const dense = Array.from({ length: 100 }, (_, i) => ({
    x: 20 + (i % 10) * 0.4,
    y: 20 + Math.floor(i / 10) * 0.4,
    vx: 0,
    vy: 0,
    t: i % 2,
  }));
  const exact = createGpuPhysics(dense, width, width);
  const approximate = createGpuPhysics(dense, width, width);
  const options = { range: 50, beta, force: 1, halfLife: 0.16 };
  for (const simulation of [exact, approximate]) simulation.setMatrix(matrix);
  exact.setOptions(options);
  approximate.setOptions({ ...options, approximate: true });
  exact.step(renderer);
  approximate.step(renderer);
  const exactResult = await exact.readParticles(renderer);
  const approximateResult = await approximate.readParticles(renderer);
  if (
    !approximateResult.every(
      (p) => Number.isFinite(p.x) && Number.isFinite(p.vx),
    )
  )
    throw new Error("Approximate mode produced invalid values");
  if (
    !approximateResult.some(
      (p, i) =>
        Math.abs(p.vx - exactResult[i].vx) > 0.001 ||
        Math.abs(p.vy - exactResult[i].vy) > 0.001,
    )
  )
    throw new Error("Approximate mode did not limit dense-cell interactions");
  exact.dispose();
  approximate.dispose();
  const treeInitial = Array.from({ length: 48 }, (_, i) => ({
    x: (i * 37 + 2) % width,
    y: (i * 61 + 3) % width,
    vx: 0,
    vy: 0,
    t: i % 2,
  }));
  const tree = createGpuPhysics(treeInitial, width, width);
  tree.setMatrix(matrix);
  tree.setOptions({
    range: 22,
    beta,
    force: 1,
    halfLife: 0.16,
    barnesHut: true,
    barnesHutTheta: 0.2,
  });
  if (tree.settings.barnesHutTheta.value !== 0.2)
    throw new Error("Barnes-Hut approximation setting was not applied");
  let treeReference = treeInitial;
  for (let step = 0; step < 3; step++) {
    treeReference = referenceStep(treeReference, 22);
    tree.step(renderer);
    const treeActual = await tree.readParticles(renderer);
    treeActual.forEach((p, i) => {
      if (
        ![p.x, p.y, p.vx, p.vy].every(Number.isFinite) ||
        Math.abs(p.x - treeReference[i].x) > 0.1 ||
        Math.abs(p.y - treeReference[i].y) > 0.1 ||
        Math.abs(p.vx - treeReference[i].vx) > 0.3 ||
        Math.abs(p.vy - treeReference[i].vy) > 0.3
      )
        throw new Error(
          `Barnes-Hut mismatch at step ${step}, particle ${i}: ${JSON.stringify(p)} vs ${JSON.stringify(treeReference[i])}`,
        );
    });
  }
  tree.setOptions({
    range: 22,
    beta,
    force: 1,
    halfLife: 0.16,
    barnesHut: true,
    barnesHutTheta: 1.5,
  });
  tree.step(renderer);
  if (
    !(await tree.readParticles(renderer)).every((p) =>
      [p.x, p.y, p.vx, p.vy].every(Number.isFinite),
    )
  )
    throw new Error("High Barnes-Hut approximation produced invalid values");
  tree.dispose();
  result.textContent =
    "PASS: GPU grid and Barnes-Hut agree with CPU within tolerance; boundaries, dense cells and readback checked";
} catch (error) {
  result.textContent = `FAIL: ${error.stack || error}`;
  console.error(error);
}
