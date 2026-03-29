# Sourdaw Codebase Audit — 2026-03-29

Full technical review from entry point to leaf nodes. Findings organized by severity, then by area.

---

## CRITICAL — Affects correctness

### 1. MIDI scheduling uses `setTimeout` instead of Web Audio clock

**Files:** `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts:191-226`

Fermenter, Grinder, and Orchestral notes are scheduled with nested `setTimeout` calls:

```ts
setTimeout(() => {
    dn.fermenterControls?.noteOn(note.pitch, note.velocity);
    setTimeout(() => {
        dn.fermenterControls?.noteOff(note.pitch);
    }, duration * 1000);
}, scheduleDelay * 1000);
```

`setTimeout` is NOT sample-accurate. JS execution can be delayed by GC, layout, or other tasks. Notes will gradually drift from the Web Audio clock, causing audible timing issues — especially over long playback sessions or at fast tempos. The built-in synth uses `scheduleNote()` which goes through Web Audio's `start(time)` — the three flagship plugins should do the same.

### 2. Async device loading has race conditions

**File:** `src/modules/AudioEngine/engine/TrackNode.ts:228, 281, 332, 391, 448`

When a device loads asynchronously (WASM), the code finds it by index in `deviceNodes` after the await:

```ts
const idx = this.strip.deviceNodes.findIndex((d) => d.deviceId === deviceId);
if (idx !== -1) { this.strip.deviceNodes[idx] = builtinDn; }
```

If the device is removed or reordered between the async load starting and completing, the index is stale. No synchronization prevents this. Could silently replace the wrong device or leave a dangling bypass node.

### 3. AudioContext silent fallback

**File:** `src/modules/AudioEngine/repositories/createWebAudioEngine.ts:39-52`

If the real AudioContext fails to initialize (e.g., cross-origin iframe, browser restriction), the engine silently falls back to a no-op context. The entire app continues running with no audio output and no user notification. This should be a hard error with a visible message.

### 4. Playhead scheduler timing drift

**File:** `src/modules/Transport/useCases/playheadScheduler.ts:237-240`

The main scheduling loop uses `setTimeout(tick, grainMs)` with no clock correction. The actual time between ticks can exceed the grain interval (due to JS event loop delays), but no compensation is applied. Audio clips will gradually desynchronize from MIDI over long playback.

### 5. Undo/redo race condition

**File:** `src/modules/Command/useCases/undoRedo.ts:50`

State is mutated (past/future stacks updated) before the async undo operation executes. If the undo fails, the state has already been changed. Should be transactional — mutate state only after successful execution.

---

## HIGH — Affects reliability or user experience

### 6. AppShell is a god component (406 lines)

**File:** `src/modules/Workspace/presentations/views/AppShell.tsx`

Manages 9 panel open/close states, 8 resize dimension states, 4 separate `useEffect` hooks for document event listeners, and a 6-way conditional render chain for the bottom panel. Every state change re-renders the entire layout tree. Should be decomposed into composable panel components.

### 7. Dual state for panel dimensions

**File:** `src/modules/Workspace/presentations/views/AppShell.tsx:144-152` vs `src/modules/Workspace/models/WorkspaceState.ts:19,27-29`

AppShell maintains local `useState` for `sidebarWidth`, `inspectorWidth`, `mixerHeight`, etc. WorkspaceState also tracks these values. Two sources of truth — local state doesn't persist across sessions, and the store values are never read in AppShell. Pick one.

### 8. Three overlapping keyboard shortcut systems

**Files:**
- `src/modules/Command/presentations/hooks/useGlobalKeyboardShortcuts.ts` (233 lines)
- `src/modules/Workspace/presentations/hooks/useAppKeyboardShortcuts.ts` (103 lines)
- `src/modules/Workspace/useCases/shortcutEngine.ts` (121 lines)

Three separate implementations handling keyboard events with no conflict resolution or priority system. If two systems handle the same key, execution order is undefined. Should consolidate into a single registry with priority levels.

### 9. Event system is not type-safe

**Files:** `AppShell.tsx:112-141`, `useAppEventHandlers.ts`, `TrackDevicesSection.tsx`

Cross-module communication uses raw DOM events with string names (`'sourdaw:show-fermenter-tab'`, `'sourdaw:open-export'`, etc.). No compile-time validation — a typo in an event name is a silent failure. The codebase already has a typed `EventBus` in `src/helpers/Event/EventBus.ts` that should be used instead.

### 10. TrackNode is a 637-line god class

**File:** `src/modules/AudioEngine/engine/TrackNode.ts`

Handles device loading (5 separate async patterns for Faust, NativeDSP, Fermenter, Grinder, Orchestral — each ~30 lines of nearly identical code), parameter updates, bypass toggling, audio graph wiring, and disposal. The 5 async device loaders are a severe DRY violation — ~150 lines of copy-pasted code with minor variations. Should extract a `DeviceLoader` service.

### 11. Recording resource leak on error

**File:** `src/modules/AudioEngine/repositories/audioRecorder/recording.ts:101-104`

If `getUserMedia` succeeds but encoding setup fails, the catch block returns `false` without releasing the MediaStream or source node. Resources leak until GC collects them (which may never happen for active streams).

### 12. No test coverage for core logic

Only 18 test files exist in the entire codebase (23 modules). Zero unit tests for:
- Audio scheduling / transport
- Undo/redo
- Device chain building
- Store / state management
- Preset loading

### 13. `newProject()` reloads the page without confirmation

**File:** `src/modules/Workspace/presentations/hooks/useAppEventHandlers.ts:23`

```ts
newProject();
window.location.reload();
```

Discards all unsaved work with no confirmation dialog. Any unsaved changes are lost immediately.

### 14. Orchestral instruments show but don't work

**File:** `src/modules/Orchestral/presentations/views/OrchestraPanel.tsx:32-47`

Only "Solo Violin" has `hasSamples: true`. All other instruments (Violins II, Violas, Cellos, etc.) appear in the dropdown but produce no sound. Users can select non-functional instruments with no feedback.

---

## MEDIUM — Code quality, maintainability, polish

### 15. CSP disabled in Tauri config

**File:** `src-tauri/tauri.conf.json:24` — `"csp": null`. Security risk for production.

### 16. TanStack Query is dead code

**File:** `src/app/queryClient.ts` — QueryClient configured but zero `useQuery`/`useMutation` calls in the codebase. Dead dependency.

### 17. Track model is a god object (25+ fields)

**File:** `src/modules/Arrangement/models/Track.ts:13-44`

Mixes device chain, audio metadata, automation state, clip alternatives, and comping info into one type. Should break into focused sub-types.

### 18. Naive clip updates — O(n*m) lookups

**File:** `src/modules/Arrangement/repositories/track/mutations.ts:56-68`

To update a single clip, iterates all tracks then all clips within each track. No indexed lookup. Will degrade with large arrangements.

### 19. `removeTrack` manually cascades to every store

**File:** `src/modules/Arrangement/useCases/removeTrack.ts:19-56`

Manually cleans up automationStore, midiStore, takeLaneStore, etc. If a new store is added that references tracks, this function must be manually updated — easy to miss.

### 20. Faust compilation is fire-and-forget

**File:** `src/modules/Arrangement/useCases/device/addDevice.ts:38-43`

Device is added to the UI before the Faust DSP module finishes compiling. If compilation fails, the device appears in the chain but produces no sound — no user notification.

### 21. WASM binary copied on every instantiation

**Files:** `FermenterNode.ts:82`, `GrinderNode.ts:77`, `OrchestraNode.ts:107`

`wasmBytes.slice(0)` creates a full copy of the WASM binary (1-5MB) for each new instance. Should share the cached binary by reference.

### 22. `buildDeviceChain` silently skips AudioWorklet in offline render

**File:** `src/modules/AudioEngine/useCases/buildDeviceChain.ts:54-57, 72, 99, 123, 148`

When rendering offline (export), AudioWorklet-based devices are silently skipped. The exported audio will be missing effects with no warning to the user.

### 23. Grinder sequencer uses hardcoded 120 BPM

**File:** `src/modules/Grinder/presentations/views/GrinderPanel.tsx:107`

`startSequencer(120)` — should read from the project's transport tempo.

### 24. No touch/pointer event support

**Files:** `src/components/ui/DragResizeHandle.tsx:25-57`, `src/modules/Grinder/presentations/components/PadGrid.tsx:60-66`

All drag and pad interactions use `MouseEvent` only. Won't work on tablets or hybrid laptops. Should use `PointerEvent`.

### 25. Automation drawing has no debounce

**File:** `src/modules/Workspace/presentations/helpers/automationDrag.ts:48`

`paintDrawPoint` called on every mousemove. Creates excessive automation points. Should batch or throttle.

### 26. Pre-roll calculation ignores time signature denominator

**File:** `src/modules/Transport/useCases/transportControls/startPlayback.ts:17-19`

```ts
const preRollBeats = state.preRollBars * state.timeSignatureNumerator;
```

Uses only numerator. In 6/8 time, this gives 6 pre-roll beats instead of the correct 3 (6 eighth-notes = 3 quarter-note beats).

### 27. Fermenter patch storage has no schema versioning

**File:** `src/modules/Fermenter/presentations/views/FermenterPanel.tsx:61-68`

User patches stored in localStorage with no version field. If `FermenterPatch` structure changes, all saved patches silently fail to load.

### 28. Modulation system is a non-functional TODO

**File:** `src/modules/Plugin/useCases/modulatorLibrary.ts:1-12`

The modulators UI exists and shows in the Effects tab (marked "SOON"), but the data model has no Web Audio connection. Users might attempt to set up modulation routes that don't do anything.

### 29. Undo session shared across browser tabs

**File:** `src/modules/Command/stores/undoStore.ts:8`

Uses a single `sessionStorage` key. If multiple Sourdaw instances are open in the same browser, they clobber each other's undo histories.

### 30. `console.warn` used instead of logger

**Files:** `buildDeviceChain.ts`, `createWebAudioEngine.ts`, `faustDeviceFactory.ts`, `lifecycle.ts`, and 10+ others.

Errors are logged to console but not surfaced to users. In production builds, console output is invisible. Should use the existing Logger service or `notifyUser()`.

---

## LOW — Polish, consistency, accessibility

### 31. Manual `useCallback`/`useMemo` despite React Compiler

9 files use manual `useCallback`, 2 use `useMemo`. The project has React Compiler enabled (`babel-plugin-react-compiler` in vite config), which handles memoization automatically. These manual calls are unnecessary and violate the documented convention.

### 32. Inline `clamp()` function re-created every render

**File:** `AppShell.tsx:154` — Should be module-level.

### 33. Hardcoded z-index `z-[9999]`

**File:** `AppShell.tsx:387` — Loading overlay uses magic z-index. No z-index layer system.

### 34. Incomplete accessibility

- Canvas visualizations (ADSR, FilterResponse, etc.) have `aria-label` but no `aria-describedby`
- Grinder pad grid has no keyboard navigation (arrow keys, Enter/Space)
- Euclidean generator inputs lack associated `<label>` elements
- NotificationToast has `role="alert"` but no `aria-live`

### 35. No responsive design

The app assumes 1200px+ desktop screens. No media queries, no mobile layout, no tablet support. Acceptable for a DAW but worth noting.

### 36. Direct `localStorage` usage bypasses Store pattern

8 files access `localStorage` directly instead of using the `Store` + `LocalStorageStorage` abstraction that already exists in the codebase.

### 37. Input detection for keyboard shortcuts too narrow

**File:** `src/modules/Workspace/presentations/hooks/useAppKeyboardShortcuts.ts:69`

Only checks `HTMLInputElement | HTMLTextAreaElement`. Misses `contenteditable` divs, `<select>` elements, and custom text inputs.

### 38. Global mutable track color counter

**File:** `src/modules/Arrangement/models/Track.ts:108`

`trackColorCounter` is a module-level variable that auto-increments. Non-deterministic across sessions, makes tests fragile.

### 39. Clip parent links have no orphan protection

**File:** `src/modules/Arrangement/models/Track.ts:71-74`

`parentClipId` for linked clips has no validation. Deleting a parent clip can orphan children with no cleanup.

### 40. Large audio buffers serialized to JSON for AI denoising

**File:** `src/modules/AudioEngine/repositories/nativeAIBridge/audioDenoising.ts:23`

`Array.from(samples)` converts a Float32Array to a regular array for JSON serialization. For 10 seconds at 48kHz stereo, this creates a ~7.5MB JSON string. Marked as TODO.

---

## Positive observations

- **TypeScript strict mode** fully enabled with `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`
- **Module architecture** is clean DDD: models/useCases/stores/repositories/presentations consistently applied across 23 modules
- **Design system** is comprehensive — 40+ CSS variables, DAW-optimized dark theme, consistent spacing
- **Dependency injection** via Container + EventBus establishes good decoupling foundations
- **Undo/redo** is sophisticated with grouped operations and session persistence
- **Accessibility intent** is visible — skip-to-content link, aria-labels on most interactive elements
- **Component library** uses shadcn/ui + Radix primitives consistently
- **Audio engine** handles complex routing (sends, buses, sidechain) with proper graph management
