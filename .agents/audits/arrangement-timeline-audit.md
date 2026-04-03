# Arrangement Timeline Architecture Audit Report

Based on a code-level audit of the Timeline editor (`src/modules/Arrangement/presentations/views/TimelineSurface.tsx`, `useTimelineInteractions.ts`, and `clip/moveClipPreview.ts`), here is the comprehensive audit report:

### 🌟 Architectural Positives

1. **`AnimationScheduler` and WebGPU Rendering (`TimelineSurface.tsx`)**:
   *   **Implementation:** The timeline effectively decouples its high-density rendering from React's Virtual DOM. It runs a `requestAnimationFrame` loop that checks for data changes and invokes the `TimelineRenderer` (WebGPU with a Canvas 2D fallback).
   *   **Impact:** This allows the playhead to scroll continuously at 60-120fps without dragging down the React application.

### 🚨 Critical Performance Bugs (Main-Thread & Network Lockups)

1. **O(N) CRDT Flood on Clip Drag (`moveClipPreview.ts`)**:
   *   **Issue:** When a user clicks and drags a clip to move it, `useTimelineInteractions.ts` fires `handleMouseMove` at 60-120Hz. Inside this handler, it calls `moveClipPreview()`.
   *   **Impact:** `moveClipPreview` directly mutates the global `trackStore` (`setTrackState(...)`) and the global `midiStore` (`shiftClipMidiNotes(...)`). As we know from the State & CRDT audit, mutating these stores synchronously triggers a heavy JSON serialization and an Automerge CRDT document sync.
   *   **The Multi-Clip Multiplier:** If the user has selected 10 clips and drags them together, `handleMouseMove` loops through all 10 clips and calls `moveClipPreview()` for *each one*. This results in **10 synchronous CRDT document serializations and syncs per frame, or 600-1200 heavy network mutations per second** on the main JavaScript thread. This will instantly freeze the DAW during multi-clip edits.
   *   **Fix:** Clip dragging must be entirely ephemeral. `handleMouseMove` should only update an internal, non-reactive `dragState` object that the `TimelineRenderer` uses to draw visual "ghost" previews of where the clips *will* go. The actual `moveClip` CRDT mutations must only be committed once in `handleMouseUp`.
   > ✅ **FIXED:** `clipDragPreviewRef` (module-level mutable ref) is now populated on drag start with original positions for all selected clips. During `handleMouseMove`, trim-start / stretch / move all write ephemeral positions into the ref without touching any store. `buildTimelineRenderModel` reads this ref after the cache check and overlays the preview positions onto the cached model (returning `dataDirty: true` to force a canvas repaint) without mutating the cache. On `handleMouseUp`, the final positions from the ref are committed to the store once — `moveClip` per selected clip (for move), `trimClipStart` / `trimClipEnd` once (for trim modes) — and the ref is cleared. MIDI notes are now shifted by the correct total delta computed inside `moveClip` rather than incrementally on every frame.

2. **Unnecessary O(N) Model Rebuilds (`buildTimelineRenderModel.ts`)**:
   *   **Issue:** In `TimelineSurface.tsx`, the `AnimationScheduler` loop checks if it needs to redraw. It calls `buildTimelineRenderModel()`, which checks `if (trackState !== lastTrackState)`. If the state changed, it maps over *every single track, clip, and MIDI note in the entire project* to build the `TimelineRenderModel`.
   *   **Impact:** Because `moveClipPreview` mutates `trackState` on every pixel of movement, the renderer is forced to rebuild the entire project's structural model 60 times a second during a drag, instead of just updating the coordinates of the one clip being dragged. In a large project with hundreds of clips, this GC churn will cause severe stuttering.
   *   **Fix:** As mentioned above, decoupling the visual drag preview from the global `trackStore` state will naturally fix this. The base model can remain cached, and the renderer can simply draw the ephemeral drag preview layer over the top.
   > ✅ **FIXED:** Coupled to fix above. Because no stores are mutated during drag, `trackState !== lastTrackState` stays false for the entire drag gesture. `buildTimelineRenderModel` returns the cached model (fast path) and then applies the lightweight `clipDragPreviewRef` overlay on top — no O(N) track/clip/MIDI-note rebuild occurs on any drag frame.

3. **Loop Range Dragging Triggers React Renders (`useTimelineInteractions.ts`)**:
   *   **Issue:** When dragging the loop region (`loopDragRef.current`), the `mousemove` handler calls `setLoopRegion()`, which mutates the global `transportStore`.
   *   **Impact:** Because the Transport Bar and many other React components subscribe to the `transportStore`, dragging the loop region forces continuous, full-application React Virtual DOM reconciliations 60 times a second.
   *   **Fix:** Loop region dragging should update a local ref (similar to `playheadPositionRef`) for visual feedback on the timeline, and only commit the change to `transportStore` on `mouseup`.
   > ✅ **FIXED:** `BeatRulerBar.tsx` now uses an ephemeral `loopPreviewRef` during drag. `handleMouseMove` writes to the ref and calls `drawRuler()` directly (bypassing React and `transportStore`). `handleMouseUp` commits the final loop region to `transportStore` exactly once via `setLoopRegion()`. This eliminates 60Hz `transportStore.set()` floods and all associated React re-renders in Transport Bar and other subscribers during loop drag.

### 🚨 Critical Logic Bugs (Broken Audio Playback)

1. **Broken Clip Cropping and Scissor Cuts (`Track.ts` & `scheduleAudioClips.ts`)**:
   *   **Issue:** When a user trims the left edge of an audio clip (`trimClipStart`), or cuts a clip in half with the scissor tool (`splitClip`), the DAW updates the `startBeat` of the clip. However, the `Clip` model completely lacks an `audioOffset` (or `startOffset`) property.
   *   **Impact:** Because there is no offset property, the Web Audio scheduler (`scheduleAudioClips.ts`) always hardcodes the playback offset to zero: `source.start(time, 0, ...)`. It always plays the audio buffer from the absolute beginning, regardless of where the clip starts or how it was cropped on the timeline.
       *   **Trimming:** Dragging the left edge of a clip to "crop" out silence doesn't crop anything; it just visually moves the edge, while the audio playback is delayed and still plays the silence from the beginning.
       *   **Cutting:** Cutting a clip in half and playing it back causes the second half of the clip to abruptly restart the audio from the very beginning of the file, instead of continuing from the cut point.
   *   **Fix:** The `Clip` type must be extended to include an `audioOffsetBeats` (or seconds) property. The `trimClipStart` and `splitClip` functions must calculate how much the left edge was moved, and add that delta to the `audioOffsetBeats`. Finally, `scheduleAudioClips.ts` must pass this offset into the second argument of `source.start()`.
   > ✅ **FIXED:** `Clip.audioOffsetBeats?: number` exists in `Track.ts`. `trimClipStart.ts` correctly sets `audioOffsetBeats: (c.audioOffsetBeats ?? 0) + delta`. `splitClip.ts` sets it on the right clip: `(clip.audioOffsetBeats ?? 0) + (adjustedSplitBeat - clip.startBeat)`. `scheduleAudioClips.ts` reads `clip.audioOffsetBeats ?? 0` and passes it to `source.start(iterStartTime, clipAudioOffsetSeconds, ...)`. All three pieces are in place.

### 🐛 Usability & Accessibility Issues

1. **Missing Horizontal Scrollbar UI**:
   *   **Issue:** The Timeline completely lacks a physical horizontal scrollbar. Navigation relies entirely on capturing `wheel` and `gesture` events in `useTimelineGestures.ts`.
   *   **Impact:** Users without a trackpad or a mouse with horizontal scroll capabilities (e.g., standard two-button mice) have no discoverable or accessible way to pan horizontally across the arrangement.
   *   **Fix:** A dedicated horizontal scrollbar component must be implemented at the bottom of the timeline view, tied to the `timelineViewStore.scrollX` state.
   > ✅ **FIXED:** Added `TimelineHScrollbar` component in `ArrangeView.tsx` and `setScrollX()` in `timelineViewStore.ts`. The scrollbar:
   > - Computes `totalContentWidth` from the maximum clip `endBeat` across all tracks × `pixelsPerBeat` (minimum 256 beats)
   > - Tracks `viewportWidth` via a `ResizeObserver` on the timeline container div — updates automatically on panel resize or window resize
   > - Shows only when content overflows the viewport; hidden otherwise
   > - Thumb size proportional to `viewportWidth / totalContentWidth`; thumb position reflects current `scrollX`
   > - Drag interaction: `mousedown` on thumb captures global `mousemove`/`mouseup`, translates pixel delta to beat offset via `setScrollX()`, released on `mouseup`

**Summary:** While the Timeline boasts an excellent WebGPU rendering foundation, its interactive layer completely undermines it. The timeline treats the global, network-synced CRDT stores as if they were local variables, mutating them continuously during mouse drags. This will cause catastrophic UI freezes and network flooding when interacting with clips. Furthermore, fundamental editing operations like trimming and cutting clips are completely broken for audio playback due to a missing offset variable in the core data model.
