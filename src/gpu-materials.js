import * as THREE from "three/webgpu";
import {
  Fn,
  If,
  abs,
  clamp,
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
  pow,
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
  dots.uniforms = { uSize: uniform(5) };

  const blur = make();
  const particleBackground = make();
  particleBackground.uniforms = { uAspect: uniform(1) };
  particleBackground.fragmentNode = vec4(vec3(0.97, 0.98, 1), 1);
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
    uDebris: uniform(0.45),
    uInner: uniform(1),
    uMode: uniform(0),
    uTime: uniform(0),
    uAspect: uniform(1),
  };
  const d = display.uniforms;
  const hash = (p) => fract(sin(p.dot(vec2(127.1, 311.7))).mul(43758.5453));
  display.fragmentNode = Fn(() => {
    // A little suspended material gives the empty water the texture of a slide.
    const waterCoord = coord.mul(vec2(d.uAspect, 1)).mul(112);
    const grainCell = floor(waterCoord);
    const grainLocal = fract(waterCoord).sub(
      vec2(hash(grainCell.add(19.3)), hash(grainCell.add(71.8))),
    );
    const grainSeed = hash(grainCell.add(3.7));
    const fleck = float(1)
      .sub(smoothstep(0.035, 0.11, length(grainLocal)))
      .mul(step(0.91, grainSeed));
    const fiber = float(1)
      .sub(smoothstep(0.035, 0.11, length(vec2(grainLocal.x.mul(2.3), grainLocal.y.mul(0.5)))))
      .mul(step(0.975, grainSeed));
    const fine = hash(floor(coord.mul(vec2(1100, 800))))
      .sub(0.5)
      .mul(0.009);
    const col = vec3(0.97, 0.98, 1)
      .sub(
        vec3(0.2, 0.16, 0.11)
          .mul(fleck.add(fiber.mul(0.7)))
          .mul(d.uDebris),
      )
      .add(fine)
      .toVar();
    const groups = [d.uField0.sample(coord), d.uField1.sample(coord), d.uField2.sample(coord)];
    const lineLight = vec3(0).toVar();
    const topColor = vec3(0).toVar();
    const maxInside = float(0).toVar();
    const topD = float(0).toVar(),
      secondD = float(0).toVar();
    for (let i = 0; i < 12; i++) {
      If(d.uTypes.greaterThan(i + 0.5), () => {
        const density = groups[Math.floor(i / 4)]["rgba"[i % 4]];
        const color = d.uPalette.value[i];
        const aa = max(fwidth(density).mul(1.5), 0.01);
        const inside = smoothstep(d.uIso.sub(aa), d.uIso.add(aa), density);
        maxInside.assign(max(maxInside, inside));
        const ew = max(fwidth(density).mul(0.85), 0.008);
        const edge = (level, width) =>
          exp(density.sub(d.uIso.mul(level)).div(width).pow(2).negate());
        const main = edge(1, ew),
          mid = edge(1.56, max(ew, 0.009));
        lineLight.addAssign(color.mul(main.mul(0.85).add(d.uInner.mul(mid).mul(0.26))));
        const isTop = density.greaterThan(topD),
          isSecond = density.greaterThan(secondD);
        secondD.assign(select(isTop, topD, select(isSecond, density, secondD)));
        topColor.assign(select(isTop, color, topColor));
        topD.assign(select(isTop, density, topD));
      });
    }
    // Each pixel belongs to the strongest field. Overlaps keep one pigment
    // rather than multiplying or averaging the colours of different types.
    const fillTint = mix(vec3(0.96, 0.97, 0.95), topColor, 0.58);
    const fill = mix(col, fillTint, maxInside.mul(d.uFill).mul(0.52));
    // Fine stipple appears only inside membranes, like translucent cell contents.
    const cellGrid = coord.mul(vec2(d.uAspect, 1)).mul(265);
    const cellId = floor(cellGrid);
    const cellLocal = fract(cellGrid).sub(vec2(hash(cellId.add(11)), hash(cellId.add(59))));
    const granule = float(1)
      .sub(smoothstep(0.045, 0.14, length(cellLocal)))
      .mul(step(0.78, hash(cellId.add(23))))
      .mul(maxInside)
      .mul(d.uFill);
    const texturedFill = mix(fill, topColor.mul(0.56).add(vec3(0.24)), granule.mul(0.24));
    const delta = topD.sub(secondD),
      interfaceWidth = max(fwidth(delta).mul(1.15), 0.012);
    const interfaceLine = float(1)
      .sub(smoothstep(0, interfaceWidth, abs(delta)))
      .mul(smoothstep(d.uIso.mul(0.75), d.uIso.mul(1.25), secondD));
    lineLight.addAssign(topColor.mul(interfaceLine).mul(d.uInner).mul(0.55));
    // Thin saturated ink over the translucent fills, with independent type edges.
    const inkStrength = clamp(length(lineLight).mul(0.8), 0, 0.86);
    const inkTint = clamp(lineLight.div(max(length(lineLight), 0.001)).mul(0.68), 0, 1);
    const contoured = mix(texturedFill, inkTint, inkStrength);
    col.assign(select(d.uMode.lessThan(1.5), contoured, col));
    const noise = hash(floor(coord.mul(vec2(1200, 800))))
      .sub(0.5)
      .mul(0.006);
    return vec4(pow(clamp(col.add(noise), 0, 1), vec3(0.9)), 1);
  })();

  const optics = make();
  optics.uniforms = {
    uImage: texture(blank),
    uAspect: uniform(1),
    uPixel: uniform(new THREE.Vector2(1, 1)),
    uEnabled: uniform(1),
    uVignette: uniform(0.5),
  };
  const o = optics.uniforms,
    p = coord.sub(0.5).mul(vec2(o.uAspect, 1)).div(min(o.uAspect, 1));
  const radius = length(p),
    edge = smoothstep(0.42, 0.69, radius);
  const offset = normalize(p.add(0.00001)).mul(edge).mul(3).mul(o.uPixel);
  const center = o.uImage.sample(coord).rgb;
  const lensBlur = o.uImage
    .sample(coord.add(vec2(o.uPixel.x.mul(3), 0)))
    .rgb.add(o.uImage.sample(coord.sub(vec2(o.uPixel.x.mul(3), 0))).rgb)
    .add(o.uImage.sample(coord.add(vec2(0, o.uPixel.y.mul(3)))).rgb)
    .add(o.uImage.sample(coord.sub(vec2(0, o.uPixel.y.mul(3)))).rgb)
    .mul(0.25);
  const chroma = vec3(
    o.uImage.sample(coord.add(offset)).r,
    center.g,
    o.uImage.sample(coord.sub(offset)).b,
  );
  const image = mix(chroma, lensBlur, edge.mul(0.55));
  const shade = float(1)
    .sub(edge.mul(0.16))
    .mul(float(1).sub(smoothstep(0.68, 0.7, radius)));
  const eyepiece = mix(image, mix(vec3(0.008, 0.009, 0.011), image, shade), o.uVignette);
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
  const r = uv().sub(0.5).length().mul(2);
  const tint = varying(tintNode);
  dots.fragmentNode = vec4(
    tint.mul(float(0.55).add(exp(r.mul(r).mul(-12)).mul(0.15))),
    float(1)
      .sub(smoothstep(0.24, 1, r))
      .mul(0.93),
  );
}
