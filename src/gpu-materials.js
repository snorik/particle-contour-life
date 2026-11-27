import * as THREE from "three/webgpu";
import {
  Fn,
  If,
  abs,
  clamp,
  cos,
  dFdx,
  dFdy,
  exp,
  float,
  floor,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  normalize,
  select,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  varying,
} from "three/tsl";

// Node materials for the density splats and contour composite.
export function createMaterials() {
  const blank = new THREE.Texture();
  const make = () => new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  const field = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  field.uniforms = { uSize: uniform(55), uGroup: uniform(0) };
  const dots = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  dots.uniforms = { uSize: uniform(5), uOpacity: uniform(1) };

  const blur = make();
  const particleBackground = make();
  const water = { uAspect: uniform(1), uDebris: uniform(0.45), uTime: uniform(0) };
  blur.uniforms = {
    uInput: texture(blank),
    uOld: texture(blank),
    uStep: uniform(new THREE.Vector2(1 / 800, 1 / 480)),
    uKeep: uniform(0),
    uBlur: uniform(1),
  };
  const b = blur.uniforms;
  const coord = uv(),
    s = b.uStep.mul(b.uBlur);
  let blurred = b.uInput.sample(coord).mul(0.38);
  for (const [x, y, w] of [
    [1, 0, 0.12],
    [-1, 0, 0.12],
    [0, 1, 0.12],
    [0, -1, 0.12],
    [1, 1, 0.035],
    [-1, -1, 0.035],
    [1, -1, 0.035],
    [-1, 1, 0.035],
  ]) {
    blurred = blurred.add(b.uInput.sample(coord.add(s.mul(vec2(x, y)))).mul(w));
  }
  blur.fragmentNode = mix(blurred, b.uOld.sample(coord), b.uKeep);

  const display = make();
  display.uniforms = {
    uField0: texture(blank),
    uField1: texture(blank),
    uField2: texture(blank),
    uPalette: {
      value: Array.from({ length: 12 }, () => uniform(new THREE.Vector3())),
    },
    uTypes: uniform(5),
    uIso: uniform(0.7),
    uFill: uniform(0.5),
    uInner: uniform(1),
    ...water,
  };
  const d = display.uniforms;
  const hash = (p) => fract(sin(p.dot(vec2(127.1, 311.7))).mul(43758.5453));
  const slideCoord = coord.mul(vec2(water.uAspect, 1));
  const debris = Fn(() => {
    const waterCoord = slideCoord.mul(65);
    const grainCell = floor(waterCoord);
    const grainSeed = hash(grainCell.add(3.7));
    const phase = hash(grainCell.add(19.3)).mul(6.28318);
    const drift = vec2(
      sin(water.uTime.mul(0.24).add(phase)),
      cos(water.uTime.mul(0.19).add(phase.mul(1.7))),
    ).mul(0.11);
    const local = fract(waterCoord).sub(vec2(0.5).add(drift));
    const angle = phase.add(water.uTime.mul(mix(-0.22, 0.22, hash(grainCell.add(71.8)))));
    const direction = vec2(cos(angle), sin(angle));
    const along = local.dot(direction);
    const across = local.dot(vec2(direction.y.negate(), direction.x));
    const halfLength = mix(0.16, 0.29, hash(grainCell.add(39.4)));
    const curve = along.mul(along).mul(mix(-2.2, 2.2, hash(grainCell.add(11.2))));
    const distance = length(vec2(max(abs(along).sub(halfLength), 0), across.sub(curve)));
    const fiber = float(1)
      .sub(smoothstep(0.008, 0.025, distance))
      .mul(step(0.83, grainSeed));
    return vec3(0.32, 0.27, 0.21)
      .mul(fiber)
      .mul(water.uDebris);
  });
  const grain = hash(floor(slideCoord.mul(840)))
    .sub(0.5)
    .mul(0.024);
  const illumination = float(0.65)
    .add(sin(coord.x.mul(4).add(coord.y.mul(2))).mul(0.035))
    .add(sin(coord.y.mul(18).sub(coord.x.mul(12))).mul(0.009))
    .add(grain);
  const background = vec3(1, 1.035, 0.97).mul(illumination);
  particleBackground.fragmentNode = vec4(background.sub(debris()), 1);

  display.fragmentNode = Fn(() => {
    const groups = [d.uField0.sample(coord), d.uField1.sample(coord), d.uField2.sample(coord)];
    const shadow = vec3(0).toVar();
    const highlight = float(0).toVar();
    const topColor = vec3(0).toVar();
    const maxInside = float(0).toVar();
    const topD = float(0).toVar(),
      secondD = float(0).toVar();
    const innerLevel = d.uIso.add(0.27);
    for (let i = 0; i < 12; i++) {
      If(d.uTypes.greaterThan(i + 0.5), () => {
        const density = groups[Math.floor(i / 4)]["rgba"[i % 4]];
        const color = d.uPalette.value[i];
        const gradient = vec2(dFdx(density), dFdy(density));
        const aa = max(abs(gradient.x).add(abs(gradient.y)), 0.008);
        const inside = smoothstep(d.uIso.sub(aa), d.uIso.add(aa), density);
        maxInside.assign(max(maxInside, inside));
        const edge = (level, width) => exp(density.sub(level).div(width).pow(2).negate());
        // Opposite sides of the same membrane catch light and cast shade.
        const light = clamp(gradient.dot(vec2(0.6, 0.8)).div(aa), -1, 1);
        const rim = edge(d.uIso, aa.mul(1.25)).mul(float(0.36).sub(light.mul(0.3)));
        const inner = edge(innerLevel, aa.mul(0.85)).mul(d.uInner).mul(0.1);
        const absorption = mix(vec3(0.75, 0.81, 0.78), vec3(1).sub(color), 0.42);
        shadow.addAssign(absorption.mul(rim.add(inner)));
        highlight.addAssign(
          edge(d.uIso.sub(aa.mul(1.7)), aa.mul(1.6)).mul(float(0.19).add(light.mul(0.18))),
        );
        const isTop = density.greaterThan(topD),
          isSecond = density.greaterThan(secondD);
        secondD.assign(select(isTop, topD, select(isSecond, density, secondD)));
        topColor.assign(select(isTop, color, topColor));
        topD.assign(select(isTop, density, topD));
      });
    }
    const thickness = max(topD.sub(d.uIso), 0);
    const core = float(1).sub(exp(thickness.mul(-1.15)));
    const fillTint = mix(vec3(0.23, 0.27, 0.25), topColor, 0.52);
    const waterColor = background.sub(debris().mul(float(1).sub(maxInside)));
    const fill = mix(waterColor, fillTint, maxInside.mul(d.uFill).mul(mix(0.27, 0.93, core)));
    const cellGrid = slideCoord.mul(240).add(core.mul(1.1));
    const cellId = floor(cellGrid);
    const cellLocal = fract(cellGrid).sub(vec2(hash(cellId.add(11)), hash(cellId.add(59))));
    const granule = float(1)
      .sub(smoothstep(0.045, 0.14, length(cellLocal)))
      .mul(step(0.78, hash(cellId.add(23))))
      .mul(maxInside)
      .mul(d.uFill);
    const texturedFill = mix(fill, fillTint, granule.mul(mix(0.2, 0.55, core)));
    const delta = topD.sub(secondD),
      interfaceWidth = max(fwidth(delta).mul(1.15), 0.012);
    const interfaceLine = float(1)
      .sub(smoothstep(0, interfaceWidth, abs(delta)))
      .mul(smoothstep(d.uIso.mul(0.75), d.uIso.mul(1.25), secondD));
    shadow.addAssign(vec3(0.11, 0.13, 0.12).mul(interfaceLine).mul(d.uInner));
    const transmitted = texturedFill.mul(exp(shadow.mul(-1.8)));
    return vec4(mix(transmitted, vec3(0.94, 0.98, 0.91), clamp(highlight, 0, 0.65)), 1);
  })();

  const optics = make();
  optics.uniforms = {
    uImage: texture(blank),
    uAspect: uniform(1),
    uPixel: uniform(new THREE.Vector2(1, 1)),
    uEnabled: uniform(1),
    uVignette: uniform(0.95),
  };
  const o = optics.uniforms,
    p = coord.sub(0.5).mul(vec2(o.uAspect, 1)).div(min(o.uAspect, 1));
  const radius = length(p),
    edge = smoothstep(0.27, 0.86, radius);
  const offset = normalize(p.add(0.00001)).mul(edge).mul(0.85).mul(o.uPixel);
  const center = o.uImage.sample(coord).rgb;
  const lensBlur = o.uImage
    .sample(coord.add(vec2(o.uPixel.x.mul(1.5), 0)))
    .rgb.add(o.uImage.sample(coord.sub(vec2(o.uPixel.x.mul(1.5), 0))).rgb)
    .add(o.uImage.sample(coord.add(vec2(0, o.uPixel.y.mul(1.5)))).rgb)
    .add(o.uImage.sample(coord.sub(vec2(0, o.uPixel.y.mul(1.5)))).rgb)
    .mul(0.25);
  const chroma = vec3(
    o.uImage.sample(coord.add(offset)).r,
    center.g,
    o.uImage.sample(coord.sub(offset)).b,
  );
  const image = mix(chroma, lensBlur, edge.mul(0.65));
  const shade = edge
    .mul(0.38)
    .add(smoothstep(0.68, 0.79, radius).mul(0.62))
    .mul(o.uVignette);
  const eyepiece = mix(image, vec3(0.017, 0.028, 0.025), shade);
  optics.fragmentNode = vec4(select(o.uEnabled.greaterThan(0.5), eyepiece, center), 1);
  return { field, dots, blur, display, optics, particleBackground };
}

// Position and type are read from the same storage buffers as the compute pass.
export function bindParticleFragments(field, dots, typeNode, tintNode) {
  const lane = varying(typeNode).sub(field.uniforms.uGroup.mul(4));
  const radius2 = uv().sub(0.5).mul(2).length().pow(2);
  const weight = exp(radius2.mul(-4.6))
    .mul(0.84)
    .mul(float(radius2.lessThanEqual(1)));
  field.fragmentNode = vec4(
    float(lane.greaterThanEqual(-0.1).and(lane.lessThan(0.5))),
    float(lane.greaterThanEqual(0.5).and(lane.lessThan(1.5))),
    float(lane.greaterThanEqual(1.5).and(lane.lessThan(2.5))),
    float(lane.greaterThanEqual(2.5).and(lane.lessThan(3.1))),
  ).mul(weight);
  const local = uv().sub(0.5).mul(2);
  const r = length(local);
  const tint = varying(tintNode);
  const glint = exp(
    length(local.add(vec2(0.24, -0.24)))
      .pow(2)
      .mul(-10),
  );
  dots.fragmentNode = vec4(
    mix(tint.mul(0.46), vec3(0.84, 0.9, 0.81), glint.mul(0.64)),
    float(1)
      .sub(smoothstep(0.16, 1, r))
      .mul(dots.uniforms.uOpacity),
  );
}
