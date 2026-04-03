# Audit Report: `useEffect` vs `useLayoutEffect`

## Overview
This audit examines all usages of `useEffect` in the `src/` directory to identify instances where `useLayoutEffect` should be used instead. 

`useLayoutEffect` fires synchronously after all DOM mutations but before the browser has a chance to paint. It is crucial to use `useLayoutEffect` instead of `useEffect` when:
1. Synchronously measuring DOM elements (e.g., `getBoundingClientRect`, `clientWidth`).
2. Performing state updates that depend on the layout/measurements.
3. Mutating DOM properties that affect layout or scroll positions (e.g., `scrollLeft`, `scrollTop`).
4. Sizing or drawing to a canvas initially to avoid a "flash" of an empty or incorrectly sized canvas.

Using `useEffect` for these operations causes the browser to paint the initial state, run the effect, and then repaint, resulting in visible flickering, layout shifts, or scroll jumping.

## Findings & Recommendations

### 1. Scroll Positioning (Synchronous Layout Mutation)
When scroll positions are modified in a `useEffect`, the browser will first paint the un-scrolled frame, and then the effect will force a scroll, causing a visible jump.

* **`src/modules/VirtualKeyboard/presentations/views/VirtualKeyboard.tsx`** (L168-176)
  * **Context**: Modifying `scrollLeft` on `scrollRef.current` based on the active octave.
  * **Recommendation**: Change to `useLayoutEffect` to ensure the keyboard is scrolled to the correct octave before it is painted to the screen.

* **`src/modules/Arrangement/presentations/views/TrackListView.tsx`** (L74-86)
  * **Context**: Syncing the vertical scroll position (`el.scrollTop = scrollY`).
  * **Recommendation**: Change to `useLayoutEffect` to ensure the track list stays perfectly in sync with the timeline without a one-frame jitter.

### 2. DOM Measurement and State Updates on Mount
Reading layout properties and subsequently updating React state in a `useEffect` causes a secondary render after the initial paint, resulting in layout thrashing.

* **`src/modules/Workspace/presentations/views/ArrangeView.tsx`** (L58-69)
  * **Context**: Reading `el.clientWidth` and calling `setViewportWidth(el.clientWidth)`.
  * **Recommendation**: Change to `useLayoutEffect` so the viewport width state is set synchronously before the user sees the unmeasured state.

* **`src/modules/Workspace/presentations/views/AutomationBottomPanel.tsx`** (L22-38)
  * **Context**: The `useContainerWidth` hook initializes width state using `el.clientWidth`.
  * **Recommendation**: Change to `useLayoutEffect` to calculate the container width before the panel's content renders.

* **`src/modules/Arrangement/presentations/views/TimelineMinimap.tsx`** (L135-151)
  * **Context**: Sizing the minimap by setting state via `setContainerWidth(container.getBoundingClientRect().width)`.
  * **Recommendation**: Change to `useLayoutEffect` to avoid a delayed layout shift.

* **`src/modules/Workspace/presentations/views/ClipView/PianoRoll.tsx`** (L97-110)
  * **Context**: Reading `parent.clientWidth` and calling `onContentWidthChange` to report layout to the parent.
  * **Recommendation**: Change to `useLayoutEffect` to ensure the parent receives the correct layout dimensions before painting.

### 3. Canvas Sizing and Initialization
When canvases dynamically size themselves to match their DOM containers, the measurement and assignment of `canvas.width` and `canvas.height` must happen before the paint to avoid flashes of distorted or default-sized canvases.

* **`src/modules/Arrangement/presentations/views/TimelineMinimap.tsx`** (L39-54)
  * **Context**: Reading `container.getBoundingClientRect().width` to assign `canvas.width` and `canvas.height`.
  * **Recommendation**: Change to `useLayoutEffect` to prevent the canvas from flashing at its default 300x150 dimensions.

* **`src/modules/Workspace/presentations/views/AutomationLane/NotePropertyLane.tsx`** (L59-74)
  * **Context**: Setting canvas width and height based on `container.getBoundingClientRect()`.
  * **Recommendation**: Change to `useLayoutEffect` for synchronous sizing.

* **`src/modules/Workspace/presentations/views/ClipView/KneadEditor.tsx`** (L148-161)
  * **Context**: The `resizeCanvas` function reads `parent.clientWidth/clientHeight` and applies it to the canvas.
  * **Recommendation**: Change to `useLayoutEffect` to prevent flashing.

* **`src/modules/AiRuntime/presentations/views/PatternBrowser.tsx`** (L35-50)
  * **Context**: Measuring `canvas.clientWidth` to explicitly set `canvas.width`.
  * **Recommendation**: Change to `useLayoutEffect` to set dimensions prior to any drawing taking place.

### 4. Static Canvas Rendering (General Recommendation)
Across the codebase (e.g., `src/modules/Levain/presentations/components/ExpressionPanel.tsx`, `src/modules/Gluten/presentations/components/GlutenCurve.tsx`, and various visualizers in `components/daw/visualizers/`), static canvas drawings are performed inside `useEffect`. 

While this is functionally correct, it can result in a single frame where the canvas appears empty if the component mounts before the effect fires. 
* **Recommendation**: For any canvas that draws static or rarely-changing content on mount (as opposed to being driven by a continuous `requestAnimationFrame` loop), consider switching to `useLayoutEffect` to ensure the graphics are rendered onto the canvas buffer before the browser commits the frame to the screen.
