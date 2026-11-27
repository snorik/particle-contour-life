# Particle Contour Life

An interactive Particle Life simulation with asymmetric interactions and layered contour visualization.

Inspired by a video from the [Programming Chaos](https://www.youtube.com/@programmingchaos8957) YouTube channel.

## Getting started

Requires Node.js 22 and a browser and device with WebGPU support. WebGPU requires a secure context such as HTTPS or localhost; WebGL is not used.

```sh
npm install
npm run dev
```

Use `npm run build` to create a production build and `npm run preview` to serve it locally.

## Simulation

The interface uses React and shadcn/ui. React Three Fiber 10 alpha manages the WebGPU canvas, cameras, scene objects, and frame loop. GPU compute and the multi-pass render targets use Three.js and TSL inside that frame loop. Particle physics, rendering, density fields, contours, and post-processing run on the GPU. Particle positions and types are passed directly from compute buffers to rendering. State is read back to the CPU only for operations such as exporting or changing particles.

The default neighbor search uses a periodic GPU grid with linked lists and no fixed cell capacity. Performance depends on the interaction radius and particle distribution; dense clusters can approach all-pairs complexity. The simulation supports up to 10,000 particles. **Fast dense cells**, enabled by default, limits checks to 64 particles per cell. This can improve performance but changes the forces and dynamics, and the selected particles depend on grid construction order.

The experimental **adaptive grid** subdivides dense cells. The experimental **Barnes–Hut** mode builds a five-level tree on the GPU and aggregates particle counts and positions by type. Nearby particles and regions crossing force-law boundaries are evaluated individually, while suitable distant groups can be approximated by their centers. Higher Barnes–Hut approximation values allow more aggregation at the cost of accuracy. Tree construction has a cost, so this mode is not always faster than the grid.

Particles experience increasing repulsion near the edges; particles that cross an edge wrap to the opposite side.

## Performance and quality

- **Microscope eyepiece**, enabled by default, adds a circular vignette and optical blur in contour modes. It can be switched off in the visualization settings.
- Physics can run at 60, 120, or 240 steps per simulated second. Lower rates reduce work but change accuracy and dynamics.
- Contour field resolution ranges from 33% to 100% of the window size. The field is smoothed and sampled with bilinear filtering.
- Render resolution can be set independently to Auto, 1×, 1.5×, or the display's native resolution. Auto caps the pixel ratio at 1×.

The `?profile` query parameter enables GPU timing output in the developer console when timestamp queries are supported. `compute` and `render` report the latest measured durations in milliseconds, not averages; asynchronous readback can make them refer to different frames. Profiling adds overhead, so compare FPS without it as well.

## GPU checks

The `/tests/gpu-check.html` page compares GPU simulation steps with a CPU reference and checks boundaries, small grids, dense cells, Barnes–Hut, state readback, and world resizing. It requires a running server and a WebGPU-capable browser.

## Deployment

The GitHub Actions workflow builds and deploys the `main` branch to GitHub Pages. The Vite build uses relative asset paths and works both at a domain root and under a repository subpath.

## License

MIT. See [LICENSE](LICENSE).
