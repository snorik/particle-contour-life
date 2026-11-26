import { Vector2 } from "three/webgpu";
import { createBarnesHut } from "./gpu-barnes-hut.js";
import { createAdaptiveGrid } from "./gpu-adaptive.js";
import {
  Break,
  Fn,
  If,
  Loop,
  abs,
  atomicFunc,
  atomicLoad,
  atomicStore,
  floor,
  float,
  instanceIndex,
  instancedArray,
  length,
  max,
  min,
  mod,
  select,
  sqrt,
  uint,
  uniform,
  uniformArray,
  vec2,
  vec4,
} from "three/tsl";

// Two state buffers are required: every invocation must read the same snapshot.
// Each particle occupies two vec4s: position/velocity and type (x component).
export function createGpuPhysics(particles, worldWidth, worldHeight) {
  const count = particles.length;
  if (count === 0)
    throw new Error("GPU physics requires at least one particle");
  const initial = new Float32Array(count * 4);
  const types = new Float32Array(count * 4);
  particles.forEach((p, i) => {
    initial.set([p.x, p.y, p.vx, p.vy], i * 4);
    types[i * 4] = p.t;
  });
  const states = [
    instancedArray(initial, "vec4"),
    instancedArray(initial.slice(), "vec4"),
  ];
  const typeBuffer = instancedArray(types, "vec4");
  // A cell is a linked list in GPU storage; no fixed per-cell capacity is needed.
  const gridSize = 64;
  const heads = instancedArray(gridSize * gridSize, "uint").toAtomic();
  const next = instancedArray(count, "uint");
  const settings = {
    world: uniform(new Vector2(worldWidth, worldHeight)),
    radius: uniform(92),
    beta: uniform(0.28),
    force: uniform(1),
    halfLife: uniform(0.16),
    dt: uniform(1 / 60),
    maxPerCell: uniform(count),
    minCellSize: uniform(32),
    adaptiveApproximate: uniform(0),
    barnesHutTheta: uniform(0.5),
    mouse: uniform(new Vector2()),
    mouseStrength: uniform(0),
    matrix: uniformArray(Array(144).fill(0), "float"),
  };
  const shortest = (d) =>
    select(
      d.greaterThan(settings.world.mul(0.5)),
      d.sub(settings.world),
      select(d.lessThan(settings.world.mul(-0.5)), d.add(settings.world), d),
    );
  const gridDimensions = () =>
    vec2(
      min(64, max(1, floor(settings.world.x.div(settings.radius)))),
      min(64, max(1, floor(settings.world.y.div(settings.radius)))),
    );
  const cellPosition = (p, dimensions) =>
    min(floor(p.xy.div(settings.world).mul(dimensions)), dimensions.sub(1));
  const clearGrid = Fn(() => {
    atomicStore(heads.element(instanceIndex), uint(count));
  })().compute(gridSize * gridSize);
  const buildGrid = (source) =>
    Fn(() => {
      const dimensions = gridDimensions();
      const cell = cellPosition(source.element(instanceIndex), dimensions);
      const bin = uint(cell.y).mul(gridSize).add(uint(cell.x));
      const previous = atomicFunc(
        "atomicExchange",
        heads.element(bin),
        instanceIndex,
      ).toVar();
      next.element(instanceIndex).assign(previous);
    })().compute(count);
  const integrateParticle = (p, acceleration, destination) => {
    const damping = float(0.5).pow(settings.dt.div(settings.halfLife));
    // The wall force is independent of the particle interaction strength.
    const wallRange = min(settings.world.mul(0.5), vec2(80));
    const nearStart = max(vec2(1).sub(p.xy.div(wallRange)), vec2(0));
    const nearEnd = max(
      vec2(1).sub(settings.world.sub(p.xy).div(wallRange)),
      vec2(0),
    );
    const wallAcceleration = nearStart
      .mul(nearStart)
      .sub(nearEnd.mul(nearEnd))
      .mul(1200);
    const velocity = p.zw
      .mul(damping)
      .add(acceleration.mul(settings.force.mul(760).mul(settings.dt)))
      .add(wallAcceleration.mul(settings.dt))
      .toVar();
    const speed = length(velocity);
    velocity.mulAssign(min(float(1), float(380).div(max(speed, 0.00001))));
    const position = mod(
      mod(p.xy.add(velocity.mul(settings.dt)), settings.world).add(
        settings.world,
      ),
      settings.world,
    );
    destination.element(instanceIndex).assign(vec4(position, velocity));
  };
  const computeForces = (source, destination) =>
    Fn(() => {
      const p = source.element(instanceIndex);
      const pType = uint(typeBuffer.element(instanceIndex).x);
      const acceleration = vec2(0).toVar();
      const dimensions = gridDimensions();
      const cell = cellPosition(p, dimensions);
      const nx = uint(dimensions.x),
        ny = uint(dimensions.y);
      // For dimensions of one or two cells, visit each wrapped cell only once.
      Loop(
        {
          start: uint(0),
          end: min(ny, uint(3)),
          type: "uint",
          name: "cy",
          condition: "<",
        },
        ({ cy }) => {
          Loop(
            {
              start: uint(0),
              end: min(nx, uint(3)),
              type: "uint",
              name: "cx",
              condition: "<",
            },
            ({ cx }) => {
              const x = uint(cell.x)
                .add(cx)
                .add(select(nx.greaterThanEqual(3), nx.sub(1), uint(0)))
                .mod(nx);
              const y = uint(cell.y)
                .add(cy)
                .add(select(ny.greaterThanEqual(3), ny.sub(1), uint(0)))
                .mod(ny);
              const cellSize = settings.world.div(dimensions);
              const center = vec2(float(x).add(0.5), float(y).add(0.5)).mul(
                cellSize,
              );
              const nearest = max(
                abs(shortest(center.sub(p.xy))).sub(cellSize.mul(0.5)),
                vec2(0),
              );
              If(
                nearest
                  .dot(nearest)
                  .lessThan(settings.radius.mul(settings.radius)),
                () => {
                  const j = atomicLoad(
                    heads.element(y.mul(gridSize).add(x)),
                  ).toVar();
                  Loop(
                    {
                      start: uint(0),
                      end: uint(settings.maxPerCell),
                      type: "uint",
                      name: "item",
                      condition: "<",
                    },
                    () => {
                      If(j.greaterThanEqual(uint(count)), () => {
                        Break();
                      });
                      const q = source.element(j);
                      const delta = shortest(q.xy.sub(p.xy));
                      const distance2 = delta.dot(delta);
                      If(
                        j
                          .notEqual(instanceIndex)
                          .and(
                            distance2.lessThan(
                              settings.radius.mul(settings.radius),
                            ),
                          )
                          .and(distance2.greaterThanEqual(0.00001)),
                        () => {
                          const distance = sqrt(distance2);
                          const r = distance.div(settings.radius);
                          const coefficient = settings.matrix.element(
                            pType.mul(12).add(uint(typeBuffer.element(j).x)),
                          );
                          const attraction = coefficient.mul(
                            float(1).sub(
                              abs(r.mul(2).sub(1).sub(settings.beta)).div(
                                float(1).sub(settings.beta),
                              ),
                            ),
                          );
                          const f = select(
                            r.lessThan(settings.beta),
                            r.div(settings.beta).sub(1),
                            attraction,
                          );
                          acceleration.addAssign(delta.mul(f.div(distance)));
                        },
                      );
                      j.assign(next.element(j));
                    },
                  );
                },
              );
            },
          );
        },
      );
      const mouseDelta = shortest(settings.mouse.sub(p.xy));
      const mouseDistance = length(mouseDelta);
      If(mouseDistance.greaterThan(1).and(mouseDistance.lessThan(165)), () => {
        const falloff = float(1).sub(mouseDistance.div(165));
        acceleration.addAssign(
          mouseDelta
            .div(mouseDistance)
            .mul(falloff.mul(falloff))
            .mul(settings.mouseStrength),
        );
      });
      integrateParticle(p, acceleration, destination);
    })().compute(count);
  const passes = states.map((state, i) => [
    clearGrid,
    buildGrid(state),
    computeForces(state, states[1 - i]),
  ]);
  const resizeScale = uniform(new Vector2(1, 1));
  const resizePasses = states.map((source, i) =>
    Fn(() => {
      const particle = source.element(instanceIndex);
      states[1 - i]
        .element(instanceIndex)
        .assign(vec4(particle.xy.mul(resizeScale), particle.zw));
    })().compute(count),
  );
  let current = 0,
    useBarnesHut = false,
    useAdaptive = false,
    barnesHut = null,
    adaptive = null;
  return {
    settings,
    states,
    typeBuffer,
    setOptions(options) {
      useBarnesHut = options.barnesHut === true;
      useAdaptive = options.adaptive === true;
      settings.minCellSize.value = options.minCellSize;
      settings.adaptiveApproximate.value = options.approximate ? 1 : 0;
      settings.barnesHutTheta.value = options.barnesHutTheta ?? 0.5;
      settings.radius.value = options.range;
      settings.beta.value = options.beta;
      settings.force.value = options.force;
      settings.halfLife.value = options.halfLife;
      settings.maxPerCell.value = options.approximate
        ? Math.min(count, 64)
        : count;
    },
    setMatrix(matrix) {
      settings.matrix.array.fill(0);
      matrix.forEach((row, i) =>
        row.forEach((value, j) => {
          settings.matrix.array[i * 12 + j] = value;
        }),
      );
    },
    resize(renderer, width, height) {
      resizeScale.value.set(
        width / settings.world.value.x,
        height / settings.world.value.y,
      );
      renderer.compute(resizePasses[current]);
      current = 1 - current;
      settings.world.value.set(width, height);
    },
    setPointer(x, y, strength) {
      settings.mouse.value.set(x, y);
      settings.mouseStrength.value = strength;
    },
    async readParticles(renderer) {
      const data = new Float32Array(
        await renderer.getArrayBufferAsync(states[current].value),
      );
      return particles.map((particle, i) => ({
        x: data[i * 4],
        y: data[i * 4 + 1],
        vx: data[i * 4 + 2],
        vy: data[i * 4 + 3],
        t: particle.t,
      }));
    },
    dispose() {
      barnesHut?.dispose();
      adaptive?.dispose();
      for (const state of states) state.value.dispose();
      typeBuffer.value.dispose();
      heads.value.dispose();
      next.value.dispose();
      for (const pair of passes)
        for (const pass of pair) if (pass !== clearGrid) pass.dispose();
      clearGrid.dispose();
      for (const pass of resizePasses) pass.dispose();
    },
    get state() {
      return states[current];
    },
    step(renderer) {
      if (useAdaptive) {
        adaptive ||= createAdaptiveGrid(
          states,
          typeBuffer,
          integrateParticle,
          settings,
          count,
          shortest,
        );
        renderer.compute(adaptive.passes(current));
      } else if (useBarnesHut) {
        barnesHut ||= createBarnesHut(
          states,
          typeBuffer,
          integrateParticle,
          settings,
          count,
          shortest,
        );
        renderer.compute(barnesHut.passes(current));
      } else {
        renderer.compute(passes[current]);
      }
      current = 1 - current;
    },
  };
}
