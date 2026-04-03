# High-Density UI Rendering Audit Report (Timeline & Piano Roll)

Based on a code-level audit of the high-density editor surfaces (`src/modules/Arrangement/presentations/views/TimelineSurface.tsx` and `src/modules/Workspace/presentations/views/ClipView/PianoRoll.tsx`), here is the comprehensive audit report:

### 🌟 Architectural Positives

1. **Timeline `AnimationScheduler` & Renderer Interface (`TimelineSurface.tsx`)**:
   *   **Implementation:** The main Arrangement Timeline correctly decouples rendering from the React DOM tree. It uses an `AnimationScheduler` (a `requestAnimationFrame` loop) to check for dirty state and triggers a dedicated `TimelineRenderer` interface (which supports WebGPU fallback to Canvas 2D).
   *   **Impact:** This is the correct architecture for a DAW. It ensures that the playhead can scroll and clips can be drawn at 60-120fps without forcing React to perform expensive Virtual DOM diffing.

### 🚨 Critical Performance & Rendering Bugs

1. **The "React-Coupled Canvas" Anti-Pattern (`PianoRoll.tsx` & `usePianoRollRenderer.ts`)**:
   *   **Issue:** Unlike the main timeline, the Piano Roll MIDI editor is fundamentally broken. It subscribes to the global `midiStore` via `useSyncExternalStore` and performs all of its Canvas 2D drawing inside a `useEffect` within a React hook. 
   *   **Impact:** When a user clicks and drags a MIDI note, `moveMidiNote` is called continuously (`mousemove`). This mutates the global store. React then intercepts this, forces the entire `PianoRoll` component to re-render, reconciles the React tree, and *then* fires the `useEffect` to redraw the canvas. This guarantees that dragging a note will lag, stutter, and drop frames, as React is simply not fast enough to sit between a `mousemove` event and a Canvas repaint at 120Hz.
   *   **Fix:** The Piano Roll must adopt the `TimelineSurface` architecture. Canvas drawing must be completely detached from React renders. Note dragging should mutate an ephemeral, non-reactive Ref or class property, and an `AnimationScheduler` should pull from that Ref to draw the canvas. Global state (`midiStore`) should only be committed on `mouseup`.

2. **Excessive Canvas 2D Overdraw (`usePianoRollRenderer.ts`)**:
   *   **Issue:** The `draw()` function clears and repaints the entire screen every single frame. It redraws the beat ruler, the hundreds of background grid lines, the ghost notes, and every single active note, complete with gradients, shadows, text labels, and velocity bars.
   *   **Impact:** For a 16-bar clip with 16th-note subdivisions, the Canvas 2D API is being asked to perform thousands of path strokes (`ctx.moveTo()`, `ctx.lineTo()`) per frame on the main thread. This will cause severe CPU load and fan spin.
   *   **Fix:** 
       1. **Layering:** The grid and ruler must be drawn *once* to an `OffscreenCanvas` (or separate DOM `<canvas>`) which is only redrawn on zoom/scroll. The foreground interactive notes should be drawn on a separate transparent canvas layer.
       2. **WebGPU Migration:** Just like the main timeline, the Piano Roll should migrate its dense drawing paths to the `createWebGpuRenderer` infrastructure to offload the thousands of rectangles to the GPU.

3. **Global State Mutation on Mouse Move (`usePianoRollInteractions.ts`)**:
   *   **Issue:** Inside `handleMouseMove`, dragging a note calls `moveMidiNote(clipId, id, pitch, beat)`. As discovered in the CRDT audit, mutating a store currently triggers an unthrottled Automerge CRDT sync and a deep JSON serialization.
   *   **Impact:** Dragging a MIDI note is currently performing a Canvas repaint, a React re-render, and a synchronous network CRDT serialization simultaneously on the main thread 60 times a second. 
   *   **Fix:** `handleMouseMove` must update an ephemeral `dragPreviewRef` (similar to what it does for drawing *new* notes) and only commit the actual `moveMidiNote` CRDT mutation inside `handleMouseUp`.

**Summary:** While the main Arrangement Timeline is well-architected for high performance, the Piano Roll editor suffers from severe architectural flaws. It couples 60fps Canvas rendering directly to React's render cycle and global CRDT mutations, which will result in an unusable, laggy MIDI editing experience.
