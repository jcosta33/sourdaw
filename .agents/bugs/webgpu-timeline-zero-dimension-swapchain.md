# Bug: WebGPU timeline — zero-height swapchain / invalid texture cascade

## Status

**Open**

## Symptoms (DevTools console)

- `The texture size ([Extent3D width:…, height:0, depthOrArrayLayers:1]) or mipLevelCount (1) is empty.` — `ValidateTextureDescriptor`
- `Could not create a swapchain texture of size 0.` — `APIInjectError`
- Repeated: `[Invalid Texture] is invalid due to a previous error` while calling `CreateView`, then `[Invalid TextureView] … While validating colorAttachments[0]`, `[Invalid CommandBuffer] … Queue.Submit`

The numeric width in the first line (e.g. **1955**) matches a real layout width; **height is 0**, which WebGPU rejects.

## What this means

WebGPU requires non-zero width and height for textures and for the **canvas swapchain**. If the backing store is configured with a **zero** dimension, texture creation fails. Subsequent `getCurrentTexture().createView()` and render passes operate on an invalid swapchain, so errors repeat until the next successful `configure`.

This is **not** a GPU driver bug; it is validation catching an illegal size (often **layout**: container has width but **no height** yet, or height collapsed to 0).

## Likely root cause (this codebase)

The Arrangement **timeline** uses WebGPU when `navigator.gpu` is available:

1. `TimelineSurface` observes the container with `ResizeObserver` and passes `entry.contentRect.width` / `height` to `renderer.resize(…)` — see `src/modules/Arrangement/presentations/views/TimelineSurface.tsx` (init + `ResizeObserver` callback).
2. `createWebGpuRenderer`’s `resize` sets `canvas.width` / `canvas.height` from `w * dpr` and `h * dpr`, then calls `gpuContext.configure({ device, format, … })` — see `src/modules/Arrangement/presentations/renderers/createWebGpuRenderer.ts` (`resize` around lines 434–442).

If **`height === 0`** (or width 0) — e.g. flex/grid not yet resolved, panel collapsed, window edge case, or observer firing before layout stabilizes — the canvas backing store becomes **0×N** or **N×0**, and the swapchain cannot be created.

Initial init also uses `container.getBoundingClientRect()`; that can report **height 0** in the same situations.

## Other WebGPU in repo

- **WebLLM / ONNX / stem separation** may use WebGPU internally; those paths are separate from the timeline canvas. The error text referencing **swapchain** and **canvas-sized** extents strongly points at **`GPUCanvasContext`** (timeline) rather than off-screen compute.
- `SpectrumAnalyzer` uses **Canvas 2D** only (comment mentions WebGPU historically; current code is 2D).

## Reproduction hints

- Open the app with WebGPU enabled; focus the **timeline** surface.
- Resize the window or change layout so the **timeline container** has **width > 0** and **height = 0** (e.g. drag splitters until the track area collapses, or reproduce a layout where the observer reports `contentRect.height === 0`).
- Confirm `crossOriginIsolated` / SharedArrayBuffer are unrelated; this is pure **canvas extent**.

## Suggested fix (when prioritized)

1. In `createWebGpuRenderer` **`resize`**: if `w <= 0` or `h <= 0`, **do not** call `configure` with a zero backing size; optionally skip resizing the canvas or set a **minimum 1×1** backing size and avoid drawing until dimensions are positive (product decision).
2. In **`render`**: if canvas width/height is 0, **return early** before `getCurrentTexture()` (avoids cascading invalid texture errors after a bad configure).
3. Optionally in `TimelineSurface`: clamp observed dimensions or skip `resize` when `height === 0` if that matches UX (timeline “invisible” should not touch WebGPU).

## Verification (after fix)

- With WebGPU timeline, force container to 0 height then restore; console should stay clean (no swapchain size 0).
- Normal resize and playback unchanged.

## References

- `src/modules/Arrangement/presentations/renderers/createWebGpuRenderer.ts` — `resize`, `render`, `gpuContext.configure`
- `src/modules/Arrangement/presentations/views/TimelineSurface.tsx` — `ResizeObserver`, `renderer.resize(rect.width, rect.height)`
