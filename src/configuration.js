const clamp = (x, min, max) => Math.max(min, Math.min(max, x));

export function validateMatrix(config) {
  if (!config || !Array.isArray(config.matrix) || !config.options)
    throw new Error("Expected matrix and options fields");
  const types = Math.round(Number(config.options.types));
  if (!Number.isFinite(types) || types < 2 || types > 12 || config.matrix.length !== types)
    throw new Error("Type count must be between 2 and 12");
  const matrix = config.matrix.map((row) => {
    if (!Array.isArray(row) || row.length !== types) throw new Error("Invalid matrix dimensions");
    return row.map((value) => {
      if (!Number.isFinite(value) || value < -1 || value > 1)
        throw new Error("Forces must be between −1 and +1");
      return value;
    });
  });
  return { types, matrix };
}

export function restoreParticles(particles, types, width, height) {
  return particles.map((particle) => ({
    x: clamp(Number(particle.x) || 0, 0, 1) * width,
    y: clamp(Number(particle.y) || 0, 0, 1) * height,
    vx: clamp(Number(particle.vx) || 0, -380, 380),
    vy: clamp(Number(particle.vy) || 0, -380, 380),
    t: clamp(Math.round(Number(particle.t) || 0), 0, types - 1),
  }));
}
