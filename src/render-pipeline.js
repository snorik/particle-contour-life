import * as THREE from "three/webgpu";

// The R3F scene owns this pipeline and its render targets for its entire lifetime.
export function createRenderPipeline({ renderer, scenes, cameras, materials }) {
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
  let getState;
  let rawTargets = [],
    pingTargets = [],
    pongTargets = [],
    historyTargets = [];
  let hasHistory = false,
    specimenTarget;
  renderer.autoClear = false;
  renderer.toneMapping = THREE.NoToneMapping;
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
  function render() {
    const { options, worldH, simTime } = getState();
    if (options.mode === "particles") {
      renderer.setRenderTarget(specimenTarget);
      renderer.render(sceneParticleBackground, quadCamera);
      dotsMaterial.uniforms.uSize.value = (3.4 * worldH) / window.innerHeight;
      renderer.render(sceneDots, worldCamera);
    } else {
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
    if (options.mode !== "particles") {
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
    }
    renderer.setRenderTarget(null);
    opticsMaterial.uniforms.uEnabled.value = options.eyepiece ? 1 : 0;
    opticsMaterial.uniforms.uVignette.value = options.vignette;
    renderer.render(sceneOptics, quadCamera);
  }
  function resizeField(cw, ch) {
    const { options } = getState();
    const fieldW = Math.max(1, Math.round(cw * options.fieldScale));
    const fieldH = Math.max(1, Math.round(ch * options.fieldScale));
    for (const rt of [...rawTargets, ...pingTargets, ...pongTargets]) rt.dispose();
    rawTargets = Array.from({ length: 3 }, () => target(fieldW, fieldH));
    pingTargets = Array.from({ length: 3 }, () => target(fieldW, fieldH));
    pongTargets = Array.from({ length: 3 }, () => target(fieldW, fieldH));
    historyTargets = [...pingTargets];
    hasHistory = false;
    blurMaterial.uniforms.uStep.value.set(1 / fieldW, 1 / fieldH);
  }
  function resize(cw, ch, width, height) {
    specimenTarget?.dispose();
    specimenTarget = target(width, height);
    opticsMaterial.uniforms.uImage.value = specimenTarget.texture;
    opticsMaterial.uniforms.uAspect.value = cw / ch;
    opticsMaterial.uniforms.uPixel.value.set(1 / width, 1 / height);
    resizeField(cw, ch);
    displayMaterial.uniforms.uAspect.value = cw / ch;
    particleBackgroundMaterial.uniforms.uAspect.value = cw / ch;
  }
  return {
    configure: (readState) => {
      getState = readState;
    },
    render,
    resize,
    resizeField,
    resetHistory: () => {
      hasHistory = false;
    },
    dispose: () => {
      for (const rt of [...rawTargets, ...pingTargets, ...pongTargets]) rt.dispose();
      specimenTarget?.dispose();
    },
  };
}
