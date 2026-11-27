import { PointsNodeMaterial, Sprite } from "three/webgpu";
import { float, instanceIndex, length, smoothstep, uniform, uv, vec2, vec3 } from "three/tsl";

// A sprite per particle reads positions directly from the simulation's storage buffers.
// Both buffers have a material so switching ping-pong buffers does not recompile shaders.
export function createGpuParticles(simulation, count, color = 0x8d5d9e) {
  const size = uniform(5);
  const sprites = simulation.states.map((state) => {
    const material = new PointsNodeMaterial({
      color,
      transparent: true,
      depthWrite: false,
    });
    material.positionNode = vec3(state.element(instanceIndex).xy, 0);
    material.sizeNode = size;
    const distance = length(uv().sub(vec2(0.5)).mul(2));
    material.opacityNode = float(1)
      .sub(smoothstep(0.5, 1, distance))
      .mul(0.85);
    const sprite = new Sprite(material);
    sprite.count = count;
    sprite.frustumCulled = false;
    return sprite;
  });
  return {
    sprites,
    size,
    update() {
      sprites.forEach((sprite, i) => {
        sprite.visible = simulation.state === simulation.states[i];
      });
    },
    dispose() {
      sprites.forEach((sprite) => sprite.material.dispose());
    },
  };
}
