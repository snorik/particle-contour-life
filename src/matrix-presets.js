const rand = (a, b) => a + (b - a) * Math.random();

export function createPreset(name, types) {
  const n = types;
  let matrix = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? rand(0.3, 0.66) : rand(-0.21, 0.21))),
  );
  if (name === "random") {
    return Array.from({ length: n }, () => Array.from({ length: n }, () => rand(-1, 1)));
  }
  if (name === "colonies") {
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) matrix[i][j] = i === j ? rand(0.54, 0.87) : rand(-0.55, -0.08);
  }
  if (name === "chase") {
    for (let i = 0; i < n; i++) {
      matrix[i][i] = rand(0.13, 0.56);
      for (let j = 0; j < n; j++) if (i !== j) matrix[i][j] = rand(-0.35, 0.25);
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
      for (let j = 0; j < n; j++) matrix[i][j] = i === j ? rand(0.15, 0.32) : rand(0.32, 0.7);
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
      for (let j = 0; j < n; j++) matrix[i][j] = i === j ? rand(0.7, 0.95) : rand(-0.15, 0.15);
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
          i === j ? rand(0.2, 0.6) : (i + j) % 3 === 0 ? rand(0.35, 0.8) : rand(-0.65, 0.25);
  }
  return matrix;
}
