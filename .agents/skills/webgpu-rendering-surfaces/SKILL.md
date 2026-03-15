---
name: webgpu-rendering-surfaces
description: >
  Apply when creating, editing, or reviewing the timeline renderer, piano-roll renderer, waveform/spectrogram views, metering surfaces, GPU drawing pipelines, worker-based canvas rendering, zoom/pan interactions, hit-testing layers, or any high-density editor surface that should not be rendered as ordinary React DOM. Enforces a renderer architecture where React owns layout and orchestration, while WebGPU/Canvas/OffscreenCanvas own dense drawing and interaction hot paths. Use WebGPU for primary high-performance rendering when available, with canvas-based fallback paths where required.
---

## Setup

```tsx
// src/modules/Timeline/presentations/components/TimelineSurface.tsx
import { type ReactElement, useEffect, useRef } from "react";

type TimelineSurfaceProps = {
  width: number;
  height: number;
};

export const TimelineSurface = ({
  width,
  height,
}: TimelineSurfaceProps): ReactElement => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    let renderer: { dispose: () => void } | null = null;

    const setup = async () => {
      renderer = await createTimelineRenderer(canvas, {
        width,
        height,
      });
    };

    void setup();

    return () => {
      if (renderer) {
        renderer.dispose();
      }
    };
  }, [width, height]);

  return <canvas ref={canvasRef} width={width} height={height} />;
};
```

```ts
// src/modules/Timeline/useCases/createTimelineRenderer.ts
export type TimelineRenderer = {
  render: () => void;
  resize: (width: number, height: number) => void;
  dispose: () => void;
};

export type CreateTimelineRenderer = (
  canvas: HTMLCanvasElement,
  size: {
    width: number;
    height: number;
  },
) => Promise<TimelineRenderer>;
```

```ts
// src/modules/Timeline/repositories/createWebGpuTimelineRenderer.ts
import type { TimelineRenderer } from "#/modules/Timeline/useCases/createTimelineRenderer";

export const createWebGpuTimelineRenderer = async (
  canvas: HTMLCanvasElement,
  size: {
    width: number;
    height: number;
  },
): Promise<TimelineRenderer> => {
  if (!navigator.gpu) {
    throw new Error("WebGPU not available");
  }

  const adapter = await navigator.gpu.requestAdapter();

  if (!adapter) {
    throw new Error("No WebGPU adapter available");
  }

  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");

  if (!context) {
    throw new Error("Could not create WebGPU context");
  }

  const format = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    format,
    alphaMode: "premultiplied",
  });

  let width = size.width;
  let height = size.height;

  const render = () => {
    const commandEncoder = device.createCommandEncoder();
    const textureView = context.getCurrentTexture().createView();

    const pass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.08, g: 0.09, b: 0.11, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    void width;
    void height;

    pass.end();
    device.queue.submit([commandEncoder.finish()]);
  };

  return {
    render,
    resize: (nextWidth: number, nextHeight: number) => {
      width = nextWidth;
      height = nextHeight;
    },
    dispose: () => {
      return;
    },
  };
};
```

## Core Patterns

### React owns layout; the renderer owns pixels

```tsx
// src/modules/Project/presentations/views/ArrangeView.tsx
import { type ReactElement } from "react";

import { TimelineSurface } from "../components/TimelineSurface";

export const ArrangeView = (): ReactElement => {
  return (
    <div className="grid min-h-screen grid-cols-[280px_minmax(0,1fr)_320px]">
      <aside />
      <TimelineSurface width={1600} height={900} />
      <aside />
    </div>
  );
};
```

Use React for:

- panel layout
- routing
- toolbars
- buttons and forms
- sidebars and inspectors
- command wiring
- selection summaries
- non-hot-path UI state

Use WebGPU or Canvas for:

- timeline lanes
- waveform overviews
- piano-roll note fields
- automation curves
- grid backgrounds
- playhead rendering
- markers
- meters
- spectrograms
- large selection overlays

Do not render dense editor surfaces as thousands of DOM nodes.

### Prefer WebGPU for primary high-density rendering

```ts
// src/modules/Timeline/repositories/getRendererBackend.ts
export type RendererBackend = "webgpu" | "canvas2d";

export const getRendererBackend = (): RendererBackend => {
  if (navigator.gpu) {
    return "webgpu";
  }

  return "canvas2d";
};
```

Use WebGPU first for:

- large scrolling timelines
- GPU-generated geometry
- waveform batching
- spectrogram rendering
- editor overlays
- compute-assisted preprocessing when appropriate

WebGPU is the preferred renderer because it supports both high-performance drawing and general-purpose GPU compute, but it is not universally available, so fallback rendering must be part of the design. :contentReference[oaicite:1]{index=1}

### Canvas fallback is required

```ts
// src/modules/Timeline/repositories/createCanvasTimelineRenderer.ts
import type { TimelineRenderer } from "#/modules/Timeline/useCases/createTimelineRenderer";

export const createCanvasTimelineRenderer = (
  canvas: HTMLCanvasElement,
  size: {
    width: number;
    height: number;
  },
): TimelineRenderer => {
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Could not create 2D canvas context");
  }

  let width = size.width;
  let height = size.height;

  return {
    render: () => {
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#15171b";
      context.fillRect(0, 0, width, height);
    },
    resize: (nextWidth: number, nextHeight: number) => {
      width = nextWidth;
      height = nextHeight;
    },
    dispose: () => {
      return;
    },
  };
};
```

Every rendering surface must have a fallback path when WebGPU is unavailable.

Fallbacks can use:

- Canvas 2D
- OffscreenCanvas + 2D
- reduced rendering features if needed

Do not make the whole application dependent on WebGPU availability.

### Use OffscreenCanvas and workers for heavy off-main-thread rendering

```ts
// src/modules/Timeline/repositories/startTimelineWorker.ts
export const startTimelineWorker = (
  canvas: HTMLCanvasElement,
): Worker | null => {
  if (!("transferControlToOffscreen" in canvas)) {
    return null;
  }

  const offscreenCanvas = canvas.transferControlToOffscreen();
  const worker = new Worker(
    new URL("../workers/timeline.worker.ts", import.meta.url),
    {
      type: "module",
    },
  );

  worker.postMessage(
    {
      type: "initialize",
      canvas: offscreenCanvas,
    },
    [offscreenCanvas],
  );

  return worker;
};
```

Use `OffscreenCanvas` and workers when:

- redraw cost is high
- hit-testing or raster work is heavy
- timeline surfaces are large
- you want to keep the main thread responsive during zoom/pan

MDN documents that `OffscreenCanvas` decouples canvas rendering from the DOM and can be used in workers, which is ideal for heavy editor surfaces. :contentReference[oaicite:2]{index=2}

### Use `requestAnimationFrame` for redraw scheduling

```ts
// src/modules/Timeline/repositories/createRenderLoop.ts
export const createRenderLoop = (render: () => void) => {
  let frameId = 0;

  const tick = () => {
    render();
    frameId = requestAnimationFrame(tick);
  };

  return {
    start: () => {
      frameId = requestAnimationFrame(tick);
    },
    stop: () => {
      cancelAnimationFrame(frameId);
    },
  };
};
```

Use `requestAnimationFrame` for visual redraw loops.

Do not drive screen updates with:

- `setInterval`
- arbitrary timers
- React re-renders on every frame

MDN documents `requestAnimationFrame` as the browser-coordinated animation redraw mechanism. :contentReference[oaicite:3]{index=3}

### Separate render model from app model

```ts
// src/modules/Timeline/models/TimelineRenderModel.ts
export type TimelineClipRenderModel = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  isSelected: boolean;
};

export type TimelineRenderModel = {
  clips: TimelineClipRenderModel[];
  playheadX: number;
  gridSpacingPx: number;
};
```

The renderer should consume a render model that is already prepared for drawing.

The renderer should not be responsible for:

- fetching domain data
- querying React state directly
- owning business logic
- interpreting route params
- deciding domain semantics

Renderers draw data. They do not decide product behavior.

### Use batching and geometry buffers, not per-object imperative draw logic everywhere

```ts
// src/modules/Timeline/models/TimelineBatch.ts
export type TimelineBatch = {
  vertexBuffer: Float32Array;
  indexBuffer: Uint32Array;
  itemCount: number;
};
```

For large surfaces, build batched geometry/data structures.

Prefer:

- one draw pass for many clips
- one pass for grid
- one pass for selections/overlays
- reusable GPU buffers
- dirty-region updates where possible

Do not treat 10,000 clips as 10,000 independent React components or ad hoc draw calls.

### Keep hit-testing separate from rendering

```ts
// src/modules/Timeline/useCases/hitTestTimeline.ts
export type HitTestResult =
  | {
      kind: "clip";
      clipId: string;
    }
  | {
      kind: "empty";
    };

export type HitTestTimeline = (x: number, y: number) => HitTestResult;
```

The renderer may help with coordinate transforms, but interaction logic should have a dedicated hit-testing layer.

This keeps:

- selection logic testable
- pointer behavior deterministic
- renderer code simpler
- future worker offloading possible

### Use WebGPU only where it helps

```ts
// decision boundary
export type SurfaceKind =
  | "timeline"
  | "waveform"
  | "piano-roll"
  | "meter"
  | "transport";
```

Use WebGPU for surfaces that are:

- large
- dense
- continuously updated
- geometry-heavy
- shader-friendly
- potentially compute-assisted

Do not use WebGPU for:

- ordinary forms
- dialogs
- standard toolbars
- inspector controls
- simple cards/lists

React + Shadcn own normal UI. WebGPU owns the hot drawing surfaces.

## Common Mistakes

### CRITICAL Rendering editor surfaces as DOM trees

Wrong:

```tsx
// anti-pattern
export const Timeline = ({ clips }: { clips: { id: string }[] }) => {
  return (
    <div>
      {clips.map((clip) => {
        return <div key={clip.id} className="absolute" />;
      })}
    </div>
  );
};
```

Correct:

```tsx
export const Timeline = (): ReactElement => {
  return <TimelineSurface width={1600} height={900} />;
};
```

Dense editor surfaces must not be implemented as giant DOM forests.

### CRITICAL Putting render-loop state into React component state

Wrong:

```tsx
const [playheadX, setPlayheadX] = useState(0);

useEffect(() => {
  const id = requestAnimationFrame(function tick() {
    setPlayheadX((value) => value + 1);
    requestAnimationFrame(tick);
  });

  return () => cancelAnimationFrame(id);
}, []);
```

Correct:

```ts
// keep frame state inside renderer / engine loop
```

Do not use React state as the per-frame animation store for editor surfaces.

### HIGH Assuming WebGPU is always available

Wrong:

```ts
const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();
```

Correct:

```ts
if (!navigator.gpu) {
  return createCanvasTimelineRenderer(canvas, size);
}
```

WebGPU availability must be feature-detected and fallback behavior must exist. :contentReference[oaicite:4]{index=4}

### HIGH Running heavy redraw work on the main thread when workers are appropriate

Wrong:

- waveform rasterization on the React thread
- large hit-test recomputation in pointer handlers
- spectrogram generation on the main thread

Correct:

- move heavy raster/geometry work to workers when needed
- use OffscreenCanvas for worker-based canvas rendering
- keep main thread responsive for UI interaction

### HIGH Mixing business logic into renderer code

Wrong:

```ts
if (project.isPublished && user.canEdit && clip.isLocked === false) {
  // renderer decides behavior
}
```

Correct:

```ts
// render model already contains drawable state
```

Renderers should draw prepared state, not decide domain behavior.
