import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal, extend, useFrame, useThree } from "@react-three/fiber/webgpu";
import * as THREE from "three/webgpu";
import { createEngine } from "./engine";
import { createMaterials } from "./gpu-materials";

extend(THREE);

function FullscreenPass({ material }) {
  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

export function Simulation({ engineRef, onUpdate, onError, onFps }) {
  const { renderer, setDpr } = useThree();
  const scenes = useMemo(
    () => ({
      field: new THREE.Scene(),
      dots: new THREE.Scene(),
      blur: new THREE.Scene(),
      display: new THREE.Scene(),
      particleBackground: new THREE.Scene(),
      optics: new THREE.Scene(),
    }),
    [],
  );
  const materials = useMemo(() => createMaterials(), []);
  const worldCamera = useRef(null),
    quadCamera = useRef(null);
  const meshes = useRef({ field: [], dots: [] });
  const [particles, setParticles] = useState(null);
  useEffect(() => {
    try {
      if (!renderer.backend.isWebGPUBackend)
        throw new Error("WebGPU is not available on this device.");
      engineRef.current = createEngine({
        renderer,
        setDpr,
        canvas: renderer.domElement,
        scenes,
        materials,
        cameras: { world: worldCamera.current, quad: quadCamera.current },
        onMeshesChange: setParticles,
        onUpdate,
        onError,
        onFps,
      });
      const resize = () => engineRef.current?.resize();
      window.addEventListener("resize", resize);
      return () => {
        window.removeEventListener("resize", resize);
        engineRef.current?.dispose();
        engineRef.current = null;
      };
    } catch (error) {
      onError(error.message);
    }
  }, [renderer, setDpr, engineRef, onUpdate, onError, onFps, scenes, materials]);
  useEffect(
    () => () => {
      Object.values(materials).forEach((material) => material.dispose());
    },
    [materials],
  );
  useLayoutEffect(() => {
    if (particles) engineRef.current?.sceneReady(particles.revision, meshes.current);
  }, [particles, engineRef]);
  useFrame(() => engineRef.current?.frame(performance.now()), { phase: "render" });
  return (
    <>
      <orthographicCamera ref={worldCamera} args={[0, 1200, 0, 720, -2, 2]} position={[0, 0, 1]} />
      <orthographicCamera ref={quadCamera} args={[-1, 1, 1, -1, 0, 2]} position={[0, 0, 1]} />
      {createPortal(
        <FullscreenPass material={materials.particleBackground} />,
        scenes.particleBackground,
      )}
      {createPortal(<FullscreenPass material={materials.blur} />, scenes.blur)}
      {createPortal(<FullscreenPass material={materials.display} />, scenes.display)}
      {createPortal(<FullscreenPass material={materials.optics} />, scenes.optics)}
      {particles &&
        createPortal(
          <>
            {[0, 1].map((i) => (
              <instancedMesh
                key={`${particles.revision}-field-${i}`}
                ref={(mesh) => {
                  meshes.current.field[i] = mesh;
                }}
                args={[null, null, particles.count * 4]}
                frustumCulled={false}
              >
                <planeGeometry args={[1, 1]} />
                <primitive object={particles.materials[i * 2]} attach="material" />
              </instancedMesh>
            ))}
          </>,
          scenes.field,
        )}
      {particles &&
        createPortal(
          <>
            {[0, 1].map((i) => (
              <instancedMesh
                key={`${particles.revision}-dot-${i}`}
                ref={(mesh) => {
                  meshes.current.dots[i] = mesh;
                }}
                args={[null, null, particles.count]}
                frustumCulled={false}
              >
                <planeGeometry args={[1, 1]} />
                <primitive object={particles.materials[i * 2 + 1]} attach="material" />
              </instancedMesh>
            ))}
          </>,
          scenes.dots,
        )}
    </>
  );
}
