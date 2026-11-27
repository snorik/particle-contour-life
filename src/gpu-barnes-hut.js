import {
  Break,
  Fn,
  If,
  Loop,
  abs,
  atomicAdd,
  atomicFunc,
  atomicLoad,
  atomicStore,
  float,
  instanceIndex,
  instancedArray,
  length,
  max,
  min,
  select,
  sqrt,
  uint,
  vec2,
} from "three/tsl";

// A complete quadtree, aggregated separately for each particle type. Integer
// atomic sums use normalized 16-bit positions (safe for the 10,000-particle limit).
export function createBarnesHut(states, types, integrateParticle, settings, count, shortest) {
  const depthLimit = 5,
    side = 1 << depthLimit,
    nodes = (4 ** (depthLimit + 1) - 1) / 3;
  const totals = instancedArray(nodes, "uint").toAtomic();
  const aggregates = instancedArray(nodes * 12 * 3, "uint").toAtomic();
  const heads = instancedArray(side * side, "uint").toAtomic();
  const next = instancedArray(count, "uint");
  const clear = Fn(() => {
    If(instanceIndex.lessThan(uint(nodes)), () => {
      atomicStore(totals.element(instanceIndex), uint(0));
    });
    If(instanceIndex.lessThan(uint(side * side)), () => {
      atomicStore(heads.element(instanceIndex), uint(count));
    });
    atomicStore(aggregates.element(instanceIndex), uint(0));
  })().compute(nodes * 12 * 3);
  const build = (source) =>
    Fn(() => {
      const p = source.element(instanceIndex);
      const normalized = min(max(p.xy.div(settings.world), vec2(0)), vec2(0.999999));
      const kind = uint(types.element(instanceIndex).x);
      const x = uint(normalized.x.mul(65535)),
        y = uint(normalized.y.mul(65535));
      for (let level = 0; level <= depthLimit; level++) {
        const n = 1 << level,
          offset = (4 ** level - 1) / 3;
        const cx = uint(normalized.x.mul(n)),
          cy = uint(normalized.y.mul(n));
        const node = uint(offset).add(cy.mul(n)).add(cx);
        const base = node.mul(36).add(kind.mul(3));
        atomicAdd(totals.element(node), uint(1));
        atomicAdd(aggregates.element(base), uint(1));
        atomicAdd(aggregates.element(base.add(1)), x);
        atomicAdd(aggregates.element(base.add(2)), y);
        if (level === depthLimit) {
          const prev = atomicFunc(
            "atomicExchange",
            heads.element(cy.mul(side).add(cx)),
            instanceIndex,
          ).toVar();
          next.element(instanceIndex).assign(prev);
        }
      }
    })().compute(count);

  const calculate = (source) =>
    Fn(() => {
      const p = source.element(instanceIndex),
        pType = uint(types.element(instanceIndex).x);
      const acceleration = vec2(0).toVar();
      const cx = uint(0).toVar(),
        cy = uint(0).toVar(),
        level = uint(0).toVar();
      const finished = uint(0).toVar();
      const applyForce = (delta, distance, type, mass) => {
        const r = distance.div(settings.radius);
        const coefficient = settings.matrix.element(pType.mul(12).add(type));
        const attraction = coefficient.mul(
          float(1).sub(abs(r.mul(2).sub(1).sub(settings.beta)).div(float(1).sub(settings.beta))),
        );
        const f = select(r.lessThan(settings.beta), r.div(settings.beta).sub(1), attraction);
        acceleration.addAssign(delta.mul(f.mul(mass).div(distance)));
      };
      Loop(
        {
          start: uint(0),
          end: uint(nodes),
          type: "uint",
          name: "visit",
          condition: "<",
        },
        () => {
          If(finished.equal(uint(1)), () => {
            Break();
          });
          const dim = uint(1).shiftLeft(level);
          const offset = uint(1).shiftLeft(level.mul(2)).sub(1).div(3);
          const node = offset.add(cy.mul(dim)).add(cx);
          const population = atomicLoad(totals.element(node)).toVar();
          const size = settings.world.div(float(dim));
          const center = vec2(float(cx).add(0.5), float(cy).add(0.5)).mul(size);
          const deltaCenter = shortest(center.sub(p.xy));
          const near = length(max(abs(deltaCenter).sub(size.mul(0.5)), vec2(0)));
          const far = length(abs(deltaCenter).add(size.mul(0.5)));
          const mid = settings.beta.add(1).mul(0.5).mul(settings.radius);
          const separate = near
            .greaterThan(settings.beta.mul(settings.radius))
            .and(far.lessThan(settings.radius))
            .and(far.lessThan(mid).or(near.greaterThan(mid)));
          const accept = population
            .greaterThan(uint(0))
            .and(level.greaterThan(uint(0)))
            .and(separate)
            .and(max(size.x, size.y).lessThan(length(deltaCenter).mul(settings.barnesHutTheta)));
          const descend = population
            .greaterThan(uint(0))
            .and(near.lessThan(settings.radius))
            .and(accept.not())
            .and(level.lessThan(uint(depthLimit)));
          If(accept, () => {
            Loop(
              {
                start: uint(0),
                end: uint(12),
                type: "uint",
                name: "kind",
                condition: "<",
              },
              ({ kind }) => {
                const base = node.mul(36).add(kind.mul(3));
                const mass = atomicLoad(aggregates.element(base)).toVar();
                If(mass.greaterThan(uint(0)), () => {
                  const sx = atomicLoad(aggregates.element(base.add(1))).toVar();
                  const sy = atomicLoad(aggregates.element(base.add(2))).toVar();
                  const centroid = vec2(float(sx), float(sy))
                    .div(float(mass).mul(65535))
                    .mul(settings.world);
                  const delta = shortest(centroid.sub(p.xy));
                  const distance = length(delta);
                  If(distance.greaterThan(0.00001), () =>
                    applyForce(delta, distance, kind, float(mass)),
                  );
                });
              },
            );
          });
          If(
            population
              .greaterThan(uint(0))
              .and(level.equal(uint(depthLimit)))
              .and(accept.not())
              .and(near.lessThan(settings.radius)),
            () => {
              const j = atomicLoad(heads.element(cy.mul(side).add(cx))).toVar();
              Loop(
                {
                  start: uint(0),
                  end: uint(count),
                  type: "uint",
                  name: "item",
                  condition: "<",
                },
                () => {
                  If(j.greaterThanEqual(uint(count)), () => {
                    Break();
                  });
                  const q = source.element(j),
                    delta = shortest(q.xy.sub(p.xy)),
                    d2 = delta.dot(delta);
                  If(
                    j
                      .notEqual(instanceIndex)
                      .and(d2.greaterThanEqual(0.00001))
                      .and(d2.lessThan(settings.radius.mul(settings.radius))),
                    () => {
                      applyForce(delta, sqrt(d2), uint(types.element(j).x), float(1));
                    },
                  );
                  j.assign(next.element(j));
                },
              );
            },
          );
          If(descend, () => {
            cx.mulAssign(2);
            cy.mulAssign(2);
            level.addAssign(1);
          }).Else(() => {
            // Advance to the next sibling; climb out of completed subtrees.
            Loop(
              {
                start: uint(0),
                end: uint(depthLimit + 1),
                type: "uint",
                name: "up",
                condition: "<",
              },
              () => {
                If(level.equal(uint(0)), () => {
                  finished.assign(uint(1));
                  Break();
                });
                const quadrant = cx.mod(2).add(cy.mod(2).mul(2)).toVar();
                cx.assign(cx.div(2));
                cy.assign(cy.div(2));
                level.subAssign(1);
                If(quadrant.lessThan(uint(3)), () => {
                  quadrant.addAssign(1);
                  cx.assign(cx.mul(2).add(quadrant.mod(2)));
                  cy.assign(cy.mul(2).add(quadrant.div(2)));
                  level.addAssign(1);
                  Break();
                });
              },
            );
          });
        },
      );
      const mouseDelta = shortest(settings.mouse.sub(p.xy)),
        mouseDistance = length(mouseDelta);
      If(mouseDistance.greaterThan(1).and(mouseDistance.lessThan(165)), () => {
        const falloff = float(1).sub(mouseDistance.div(165));
        acceleration.addAssign(
          mouseDelta.div(mouseDistance).mul(falloff.mul(falloff)).mul(settings.mouseStrength),
        );
      });
      integrateParticle(p, acceleration, states[1 - states.indexOf(source)]);
    })().compute(count);
  const builds = states.map(build),
    calculations = states.map(calculate);
  return {
    passes(index) {
      return [clear, builds[index], calculations[index]];
    },
    dispose() {
      totals.value.dispose();
      aggregates.value.dispose();
      heads.value.dispose();
      next.value.dispose();
      clear.dispose();
      for (const pass of [...builds, ...calculations]) pass.dispose();
    },
  };
}
