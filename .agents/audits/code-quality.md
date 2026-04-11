---
name: code-quality
description: Broad code quality audit — bugs, structural problems, verbosity, over-engineering, poor typing. Covers app entry point through every major module.
type: audit
status: open
date: 2026-04-11
---

# Code Quality Audit

Analysed the full frontend from `src/app/main.tsx` inward through every major module. Issues are grouped by category and ordered roughly by impact.

---

## 1. Bugs / Correctness

### 1.1 `ClipContextMenu` — non-reactive store reads in render body
**Files:** `src/modules/Arrangement/presentations/views/ClipContextMenu.tsx:56,63`

```ts
const clip = trackStore.value?.tracks.flatMap(...).find(...);  // line 56
const selectedIds = workspaceStore.value?.selectedClipIds ?? []; // line 63
```

Both reads happen directly in the component render body without going through `useStore`. The component will not re-render if either store changes while the menu is open. The bug is masked because context menus are typically short-lived, but if clip state changes while the menu is mounted (e.g. from undo), the stale data drives the action buttons.

**Fix:** Use `useStore(trackStore, ...)` and `useStore(workspaceStore, ...)`.

---

### 1.2 `ArrangementBar` — `detectEdge()` not called during `mousedown`
**File:** `src/modules/Arrangement/presentations/views/ArrangementBar.tsx:84–117`

`detectEdge()` is a named function (lines 84–96) for hover. `handleSectionMouseDown` (lines 108–117) duplicates the exact same edge-detection arithmetic inline rather than calling `detectEdge`. Any future fix or tweak to edge detection must be applied to two places.

```ts
// detectEdge (lines 87–96):
const sectionLeftPx = section.startBeat * pixelsPerBeat - scrollX;
const sectionRightPx = section.endBeat * pixelsPerBeat - scrollX;
if (Math.abs(localX - sectionLeftPx) <= EDGE_ZONE) return 'left';
if (Math.abs(localX - sectionRightPx) <= EDGE_ZONE) return 'right';

// handleSectionMouseDown (lines 109–117) — identical:
const sectionLeftPx = section.startBeat * pixelsPerBeat - scrollX;
const sectionRightPx = section.endBeat * pixelsPerBeat - scrollX;
if (Math.abs(localX - sectionLeftPx) <= EDGE_ZONE) { mode = 'resize-left'; }
else if (Math.abs(localX - sectionRightPx) <= EDGE_ZONE) { mode = 'resize-right'; }
```

---

### 1.3 Module-level counters don't account for loaded project state
**Files:** `src/modules/Arrangement/repositories/clipIdCounter.ts`, `src/modules/Arrangement/models/TakeLane.ts`, `src/modules/Arrangement/models/Marker.ts`, `src/modules/Arrangement/models/ScratchPadSection.ts`, `src/modules/Arrangement/models/WarpMarker.ts`, `src/modules/Command/useCases/commandQueries.ts:344–345`

All use `let nextXId = 1` counters that start at 1 on every module load. Loading a project from persistence (which may already contain `clip-5`, `clip-47`, etc.) resets the counter to 1, so the next created clip gets `clip-1`, colliding with any persisted clip whose ID is `clip-1`. The counter doesn't read the project state to find the current maximum.

`crypto.randomUUID()` is already used in some places (e.g. device IDs in `createTrack`) and avoids this class of bug entirely. Counters are only safe when IDs are never persisted or the counter is hydrated from stored state.

---

### 1.4 `getSectionColor` magic sentinel string
**File:** `src/modules/Arrangement/presentations/views/ArrangementBar.tsx:255`

```ts
if (section.color && section.color !== 'oklch(0.35 0.07 260)') {
    return section.color;
}
```

An exact OKLCH string literal is used as a sentinel to mean "this is the old default color, treat as unset". If the palette's default ever changes, or if a user manually picks this exact color, the fallback logic silently misfires. The model should use `''` or `null` as the "no custom color" sentinel and the view should never need to know what the old default value was.

---

## 2. Architecture / Boundary Violations

### 2.1 `RotaryKnob` — shared component with deep module imports
**File:** `src/components/daw/RotaryKnob.tsx:4–5`

```ts
import { midiLearnStore, type MidiLearnState } from '#/modules/MIDI/stores/midiLearnStore';
import { startMidiLearn } from '#/modules/MIDI/useCases/midiLearn/startMidiLearn';
```

`RotaryKnob` is a generic shared UI component under `components/daw/`. It should not know about any specific module. Both are deep imports bypassing the module boundary: `stores/midiLearnStore` is private, and the use case is accessed via a deep path rather than `#/modules/MIDI/useCases`. The MIDI awareness should be pushed up to the callsite or injected as props.

---

### 2.2 `registerDependencies.ts` — deep event payload imports
**File:** `src/app/registerDependencies.ts:4–18`

```ts
import { type TrackAddedPayload } from '#/modules/Arrangement/events/TrackAddedEvent';
import { type TrackRemovedPayload } from '#/modules/Arrangement/events/TrackRemovedEvent';
import { type AudioDeviceLoadedPayload } from '#/modules/AudioEngine/events/AudioDeviceLoadedEvent';
import { ... } from '#/modules/Workspace/events/WorkspaceEvents';
```

Event payload types are imported from deep file paths inside each module rather than from that module's root `index.ts`. Events that cross module boundaries are part of the public contract and should be re-exported from the module barrel.

---

### 2.3 `bootstrap.ts` — deep import of Toaster use case
**File:** `src/app/bootstrap.ts:5`

```ts
import { initToasterSubscribers } from '#/modules/Toaster/useCases/toasterSubscriber';
```

Bypasses the module boundary. Should import through `#/modules/Toaster/useCases` if that path exists, or from the module root.

---

### 2.4 `Toaster/useCases/toasterSubscriber.ts` — cross-module model import
**File:** `src/modules/Toaster/useCases/toasterSubscriber.ts:7`

```ts
import type { BuiltinDeviceNode } from '#/modules/AudioEngine/models/AudioEngineState';
```

`models/` is strictly private to its module per AGENTS.md. `Toaster` should define its own local type for the fields it needs from `BuiltinDeviceNode`.

---

### 2.5 `Arrangement/stores/chordTrackStore.ts` — cross-module model import
**File:** `src/modules/Arrangement/stores/chordTrackStore.ts:2`

```ts
import { type ChordEvent } from '#/modules/MIDI/models/ChordEvent';
```

`MIDI/models/` is private. Arrangement's chord track store should define its own local type for the chord fields it needs, or the type should be exported via `#/modules/MIDI` (the module barrel).

---

### 2.6 Intra-module barrel path usage (262 violations in Arrangement alone)
**Files:** Multiple files throughout `src/modules/Arrangement/`

Files inside `src/modules/Arrangement/` import from `#/modules/Arrangement/models/...`, `#/modules/Arrangement/stores/...`, etc. using the path alias rather than relative paths. Per AGENTS.md: "Files under `src/modules/<Name>/` MUST NOT import from `#/modules/<Name>`. Use relative paths."

Samples:
```ts
// src/modules/Arrangement/stores/clipboardStore.ts
import { type Clip } from '#/modules/Arrangement/models/Track'; // should be: ../../models/Track

// src/modules/Arrangement/repositories/presets/padPresets.ts
import { type SoundPreset } from '#/modules/Arrangement/models/SoundPreset'; // should be: ../../models/SoundPreset
```

---

## 3. Structural / Over-engineering

### 3.1 `AppShell` — god component, 820 lines
**File:** `src/modules/Workspace/presentations/views/AppShell.tsx`

This component manages 13 device-panel `useEffect` subscriptions, 13+ device-panel `useState` slots, 15+ dimension setter functions, 5+ launch/overlay state variables, keyboard shortcuts, event subscriptions, and the layout of the entire application. It is the single biggest maintenance burden in the UI layer.

Root causes:
- Device panel state is owned locally per-device rather than via a unified "active device panel" abstraction.
- Each `useEffect` is structurally identical: `closeAllDevicePanels()` then `setXDeviceId(payload.deviceId)`.
- `closeAllDevicePanels()` must be manually updated every time a new panel type is added.

---

### 3.2 Device panel event explosion — 26 nearly-identical files
**Files:** `src/modules/Workspace/useCases/panels/devicePanels/`

There are 13 `onPanelShow*.ts` files and 13 `show*Panel.ts` files. Each is 10–12 lines and wraps a single `eventBus.emit/on` call with a hardcoded event name. The emitter side already has a generic `showDevicePanelForType.ts` that dispatches by device type — the subscriber side never received the same treatment.

Every new device plugin requires: a new event in `AppEvents`, a new `show*Panel.ts`, a new `onPanelShow*.ts`, a new `useState`, a new `useEffect`, and a new setter in `AppShell`. That is 6+ file/callsite edits per plugin.

A single `'panel.showDevice'` event with `{ deviceType, deviceId }` and a unified `activeDevicePanel` store entry would replace the 26 files and collapse `AppShell` significantly.

---

### 3.3 Passthrough use cases add indirection without value
**Files:**
- `src/modules/Arrangement/useCases/createTrack.ts` — wraps `models/Track.createTrack` with an `as Track` cast
- `src/modules/Arrangement/useCases/getNextClipId.ts` — wraps `repositories/clipIdCounter.getNextClipId` with no added logic

```ts
// createTrack.ts
export function createTrack(input: CreateTrackInput): Track {
    return modelCreateTrack(input) as Track; // needs cast because types aren't unified
}

// getNextClipId.ts
export function getNextClipId(): string {
    return allocateClipIdFromCounter(); // alias with a different import name
}
```

The `as Track` cast in `createTrack` signals a deeper problem: `models/Track.Track` and `stores/trackStore.Track` define the same shape independently (see §3.4). The passthrough exists to bridge the type mismatch, which should not exist at all.

---

### 3.4 `Track` type defined twice
**Files:** `src/modules/Arrangement/models/Track.ts` and `src/modules/Arrangement/stores/trackStore.ts`

Both files independently define `TrackKind`, `Clip`, `Device`, `Send`, `TrackAlternative`, `Track`, `StretchMode`, `FollowAction`, and `InputMonitoring`. The store file adds `TrackStoreState`. These are structurally identical but TypeScript treats them as different types, which is why `createTrack` needs `as Track`.

The model file should own the types. The store should import them from the model via a relative path. The `as Track` cast in the useCase would disappear.

---

### 3.5 `duplicateClip` / `duplicateClipToNextBar` near-duplication
**Files:** `src/modules/Arrangement/useCases/clip/duplicateClip.ts`, `duplicateClipToNextBar.ts`

Both functions share ~30 lines of identical logic — finding the clip, calculating duration, calling `addClip`, calling `duplicateClipAutomation`. The only difference is how `nextBarStart` is computed. One parameter would unify them.

---

### 3.6 `GestureEvent` type duplicated
**Files:** `src/modules/Arrangement/presentations/views/TimelineSurface.tsx:3–6`, `src/modules/Workspace/presentations/hooks/usePianoRollInteractions.ts:42–45`

Identical `interface GestureEvent extends UIEvent { scale: number; rotation: number }` defined in both files. Should live in a single helper.

---

### 3.7 `services/` is an undocumented module directory
**Modules:** `Arrangement`, `AudioEngine`, `AiRuntime`, `Extension`, `SoundLibrary`, `Plugin`, `Command`, `Yeast`

The AGENTS.md architecture does not define `services/` as a module layer. Code found there includes pure helpers (`findClipById.ts`, `snapSplitBeatToZeroCrossing.ts`), processor bridges (`beatConversion.ts`, `fermenterProcessor.ts`), and business logic (`applySoloLogic.ts`). Without a clear definition, contributors cannot judge whether new code belongs in `services/` vs `useCases/` vs `repositories/`. The category should be defined or the files redistributed.

---

### 3.8 `offlineRender.ts` — single file, 974 lines, multiple exports
**File:** `src/modules/AudioEngine/useCases/offlineRender.ts`

Exports `cancelExport`, `isExportActive`, `OfflineRenderOptions`, and the main function. Per AGENTS.md: "Every useCase file must export exactly ONE function." The file also owns module-level state (`cancelFlag`, `isRenderingActive`). These should be split or the state moved to a dedicated store/ref.

---

## 4. Verbosity / Naming

### 4.1 Color palettes fragmented across 5+ files
**Files:** `src/modules/Arrangement/models/Track.ts`, `src/modules/Arrangement/presentations/views/ArrangementBar.tsx`, `src/modules/Arrangement/presentations/views/MarkerLane.tsx`, `src/modules/Arrangement/presentations/views/TimelineEmptyMenu.tsx`, `src/modules/Arrangement/presentations/views/ClipContextMenu.tsx`

Each file has its own local OKLCH color array. The values differ slightly between files (different lightness and hue values for the "same" conceptual colours), indicating they have drifted from a common original. A single exported constant in a shared location would make the palette consistent and maintainable.

---

### 4.2 `closeAllDevicePanels` is a 12-setter manual list
**File:** `src/modules/Workspace/presentations/views/AppShell.tsx:201–215`

```ts
const closeAllDevicePanels = () => {
    setFermenterDeviceId(null);
    setToasterDeviceId(null);
    setLevainOpen(false);
    setProofChamberDeviceId(null);
    // ... 8 more
};
```

Every new panel type requires a new line here. A unified `activeDevicePanel` store entry would make this `setActiveDevicePanel(null)`.

---

## 5. Typing

### 5.1 `restoreTrack` / `restoreClip` payloads use `unknown`
**File:** `src/modules/Command/useCases/commandQueries.ts:12–36`

The inverse-action payloads for `removeTrack` and `removeClip` use `unknown` typed snapshot fields with a comment that the Arrangement handler "casts them". This means the most critical undo operations — track and clip restoration — have no compile-time safety. A type import violation is being avoided at the cost of correctness. The snapshot shapes should be defined as local types in `commandQueries.ts` or the architecture should allow the Command module to know the minimum shape.

---

### 5.2 `interface` over `type` violations (non-generated files)
**Files:** `src/modules/Knead/models/KneadBlob.ts`, `src/modules/AudioEngine/engine/TrackNode.ts`, `src/modules/Plugin/ProofChamber/stores/chamberStore.ts`, `src/modules/Plugin/ProofChamber/models/ProofChamberState.ts`

AGENTS.md mandates `type` over `interface`. These four files use `export interface`. (Generated `routeTree.gen.ts` is exempt.)

---

### 5.3 Namespace imports (`import * as`) in multiple modules
**Files:**
- `src/modules/Sampler/useCases/**` (~7 files): `import * as bridge from '../../repositories/samplerBridge'`
- `src/modules/CrdtDocument/**` (3 files): `import * as Automerge from '@automerge/automerge'`

AGENTS.md: "Never use namespace imports. Always import named exports individually." The Automerge case is arguably forced by the library's API surface, but the Sampler `bridge` namespace should use named imports.

---

### 5.4 `inject()` types use `any` at the call boundary
**File:** `src/infra/di/inject.ts:15–21`

```ts
export type InjectableFunction = {
    (...args: any[]): any;
    _isInjectable: boolean;
    _deps: Record<string, unknown>;
    _factory: (deps: any) => any;
};
```

The internal `InjectableFunction` type uses `any` throughout. The outer `inject<TDeps>(...)` signature is well-typed but the internal metadata fields are untyped. The `eslint-disable` comments in `executeAppAction.ts` are a downstream symptom.

---

## 6. Module-level Mutable State

The following files carry module-level `let` singletons that are outside any store, not subscribable, not serializable, and not HMR-safe:

| File | Variables |
|---|---|
| `Arrangement/repositories/clipIdCounter.ts` | `nextClipId` |
| `Arrangement/models/TakeLane.ts` | `nextTakeId`, `nextLaneId` |
| `Arrangement/models/Marker.ts` | `nextMarkerId`, `nextSectionId` |
| `Arrangement/models/ScratchPadSection.ts` | `nextScratchId` |
| `Arrangement/models/WarpMarker.ts` | `nextWarpMarkerId` |
| `Arrangement/models/Track.ts` | `trackColorCounter` |
| `Command/useCases/commandQueries.ts` | `nextUndoId`, `nextGroupId` |
| `AudioEngine/useCases/offlineRender.ts` | `cancelFlag`, `isRenderingActive` |
| `Command/useCases/executeAppAction.ts` | `handlerRegistryCache` |
| `Collaboration/useCases/collaboration/sessionManagement.ts` | 15+ session variables |

The counter IDs (`clipIdCounter`, `nextMarkerId`, etc.) are the most risky: they reset to 1 on every HMR cycle and never read project state on load, so IDs will collide with persisted ones.

---

## 7. Control Flow Convention Violations

### 7.1 `if` without braces
**File:** `src/modules/GrandBoule/presentations/components/PianoModel3D.tsx`

Multiple early-return guards and conditional branches omit `{}`:
```ts
if (!isBlackKey(LOWEST_MIDI + i)) count += 1;  // line 25
if (s === null) return null;  // line 88
if (relX >= bkx && relX <= bkx + bkW) return midi;  // line 200
```

AGENTS.md: "All `if` statements must use block syntax `{}`."

---

---

## 8. Store Files as Service Modules

### 8.1 `timelineViewStore.ts` — business logic in a store file
**File:** `src/modules/Arrangement/stores/timelineViewStore.ts`

Exports five business-logic functions alongside the store declaration: `zoomTimeline`, `scrollTimeline`, `setScrollX`, `setAutoScroll`, `toggleAutoScroll`, `setScrollY`. These belong in `useCases/`. `setScrollY` reads from `trackStore` to compute scroll bounds — a cross-store dependency that should not live inside a store file.

---

### 8.2 `glutenStore.ts` — business logic in a store file
**File:** `src/modules/Gluten/stores/glutenStore.ts`

Exports four mutation functions alongside the store declaration: `getGlutenState`, `setGlutenParam`, `setGlutenUiLevel`, `loadGlutenPatch`, `updateGlutenMeters`. Each reads from `glutenStore.value`, computes new state, and calls `glutenStore.set`. This is use-case logic living in the store layer. The same pattern is repeated across at least 20 other store files in the codebase (checked: Toaster, Automation, ProofChamber, GrandBoule, Levain, Grinder, Knead, Bacteria, Sampler).

---

### 8.3 `clipboardStore.ts` — mutable module-level arrays, not a `Store<T>`
**File:** `src/modules/Arrangement/stores/clipboardStore.ts`

```ts
export let clipClipboard: ClipboardEntry[] = [];
export let noteClipboard: NoteClipboardEntry | null = null;
```

Despite living in `stores/`, this file uses `export let` mutable variables with imperative setters, not `createStore<T>()`. The clipboard state is therefore not subscribable, not reactive, not HMR-safe, and not serializable. Any component reading `clipClipboard` directly will not re-render when it changes. The file name is misleading — it is a module-level variable pair, not a store.

---

## 9. MIDI Module

### 9.1 `MidiNote` / `MidiCC` / `MidiPitchBend` defined twice
**Files:** `src/modules/MIDI/models/MidiNote.ts` and `src/modules/MIDI/stores/midiStore.ts`

`MidiNote`, `MidiCC`, `MidiPitchBend` are independently defined in both files with identical shapes. The store file re-exports its own copies; the model file defines the canonical types plus `createMidiNote()`. Callers import from one or the other depending on which path they discovered first, resulting in type mismatches that require casts. Mirrors the `Track` duplication in the Arrangement module (§3.4).

---

### 9.2 MIDI CRUD boilerplate — 10 near-identical files
**Files:** `src/modules/MIDI/useCases/midiNoteCrud/*.ts`

Every file in this directory follows the exact same pattern:

```ts
const state = midiStore.value;
if (!state) return;
const existing = state.notesByClipId[clipId];
if (!existing) return;
midiStore.set({ ...state, notesByClipId: { ...state.notesByClipId, [clipId]: <mutation> } });
```

The only difference between files is the mutation expression (filter, map, spread). The boilerplate is 10+ lines per file and is duplicated across `addMidiNote`, `removeMidiNote`, `moveMidiNote`, `resizeMidiNote`, `setNoteVelocity`, `setNoteProbability`, `shiftClipMidiNotes`, `setNotesForClip`, `getNotesForClip`, `batchAddMidiNotes`.

A `updateNotesForClip(clipId, fn)` helper would reduce each file to 2–3 lines.

---

## 10. Infra Layer Violations

### 10.1 `createAutomergeStorage.ts` — infra importing from domain module
**File:** `src/infra/store/storage/createAutomergeStorage.ts:1–3`

```ts
import { automergeRepository } from '#/modules/CrdtDocument/repositories/automergeRepository';
import { getSemanticContext } from '#/modules/CrdtDocument/useCases/semanticChangeContext';
```

`src/infra/` is the dependency-free infrastructure layer. It should not depend on any `src/modules/` code. The correct inversion is that `CrdtDocument` depends on a generic storage adapter interface defined in `infra/`. These two imports tie the infra layer to a specific domain module, making it impossible to use `createAutomergeStorage` without also importing the CRDT module.

**Fix:** Define an `IAutomergeRepository` interface in `infra/` and inject it at call sites.

---

## 11. Circular Dependency Workarounds

### 11.1 `togglePlayback` — dynamic import hides circular dependency
**File:** `src/modules/Transport/useCases/transportControls/togglePlayback.ts:10–13`

```ts
// Dynamic import to avoid circular dependency
import('./pausePlayback').then(({ pausePlayback }) => pausePlayback());
import('./startPlayback').then(({ startPlayback }) => startPlayback());
```

Dynamic `import()` inside a function body converts a module-initialization circular dependency into a runtime one. The underlying issue — a circular dependency between `Transport` → `AudioEngine` → `Transport` — is papered over rather than resolved. The dynamic import also makes this function fire-and-forget (the promise is not returned or awaited), which means errors in `pausePlayback`/`startPlayback` are silently swallowed.

---

## 12. Presentation Layer Duplication

### 12.1 Three independent `SpectrumAnalyzer` implementations
**Files:**
- `src/modules/Bacteria/presentations/components/SpectrumAnalyzer.tsx` (180 lines) — crossover-band heatmap
- `src/modules/Fermenter/presentations/components/SpectrumAnalyzer.tsx` (116 lines) — DFT-based
- `src/modules/Workspace/presentations/views/Metering/SpectrumAnalyzer.tsx` (221 lines) — WebGPU + canvas fallback

All three display FFT spectrum data on a canvas. They differ in props and rendering strategy but share substantial structural logic (canvas resize, animation frame loop, magnitude display). A single parameterized component in `src/components/daw/` or a shared canvas drawing hook would serve all three use cases.

---

### 12.2 `useProjectState` / `useTransportState` redefine local view types
**Files:** `src/modules/Workspace/presentations/hooks/useProjectState.ts`, `useTransportState.ts`

Both files have comment markers `local re-implementation` and define their own local `ProjectViewState` / `TransportViewState` types by manually listing the fields they need from the underlying store type. If the canonical store type gains or renames a field, the local type silently drifts. These should simply re-export the canonical store state type (or a `Pick<>` of it).

---

### 12.3 `AppShell.tsx` — direct `localStorage` access bypassing store
**File:** `src/modules/Workspace/presentations/views/AppShell.tsx:174,806`

```ts
const hasDismissed = localStorage.getItem('sourdaw-alpha-notice-dismissed') === 'true'; // line 174
localStorage.setItem('sourdaw-alpha-notice-dismissed', 'true');                          // line 806
```

Direct `localStorage` reads/writes bypass the project's store/storage-adapter abstraction. The key is a stringly-typed constant, not a shared symbol, making it impossible to find all readers/writers from type info. Should use a small dedicated store with a `LocalStorage` adapter or at least a repository.

---

## 13. Project Load / Persistence

### 13.1 `resetModuleStoresToDefault` omits plugin stores
**File:** `src/modules/Project/useCases/projectPersistence/helpers/resetModuleStoresToDefault.ts`

Resets `trackStore`, `transportStore`, `automationStore`, `midiStore`, `tempoMapStore`, `timeSignatureMapStore`, `markerStore`, `takeLaneStore`, and sidechain routes. It does **not** reset `glutenStore`, `fermenterStore`, `grinder`, `bacteriaStore`, or other per-device-instance stores. Loading a new project leaves stale device state from the previous project in memory, visible to any component that reads those stores before the device is re-initialized.

---

## 14. Collaboration Session Module

### 14.1 `sessionManagement.ts` — 15+ module-level variables as session state
**File:** `src/modules/Collaboration/useCases/collaboration/sessionManagement.ts:44–68`

```ts
let peerManager: PeerConnectionManager | null = null;
let automergeSync: AutomergeSync | null = null;
let assetTransfer: AssetTransfer | null = null;
let permissionManager: PermissionManager | null = null;
let cleanupProjectionBridge: (() => void) | null = null;
let presenceListeners = new Set<...>();
let playheadBroadcastInterval: ReturnType<typeof setInterval> | null = null;
let pendingInviteId: PeerId | null = null;
const peerCleanupTimers = new Map<...>();
let branchStoreSnapshot: LocalBranchState | null = null;
let unsubscribeBranchStore: (() => void) | null = null;
let unsubscribeAutomergeChanges: (() => void) | null = null;
let isProjectingBranches = false;
```

Thirteen module-level variables represent session state. This makes the module a static singleton: only one collaboration session can ever exist, HMR resets all live session state, and unit tests cannot run sessions in isolation without importing the module fresh each time.

**Fix:** Encapsulate session state in a `CollaborationSession` class or closure returned by `createSession()`.

---

### 14.2 `compressInvite` / `decompressInvite` — near-duplicate streaming loops
**File:** `src/modules/Collaboration/useCases/collaboration/sessionManagement.ts:719–769`

Both functions contain identical chunk-accumulation loops (10 identical lines each):
```ts
const chunks: Uint8Array[] = [];
const reader = stream.readable.getReader();
for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value!);
}
const total = chunks.reduce((n, c) => n + c.length, 0);
const result = new Uint8Array(total);
let offset = 0;
for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
```

A `readAllChunks(stream: ReadableStream<Uint8Array>): Promise<Uint8Array>` helper would DRY this out.

---

## Summary of Open Items

| # | Category | Severity | File(s) |
|---|---|---|---|
| 1.1 | Bug | High | `ClipContextMenu.tsx:56,63` |
| 1.2 | Bug / Logic | Medium | `ArrangementBar.tsx:84–117` |
| 1.3 | Bug | Medium | `clipIdCounter.ts`, `Marker.ts`, `TakeLane.ts`, … |
| 1.4 | Bug | Low | `ArrangementBar.tsx:255` |
| 2.1 | Arch violation | High | `RotaryKnob.tsx` |
| 2.2 | Arch violation | Medium | `registerDependencies.ts` |
| 2.3 | Arch violation | Low | `bootstrap.ts` |
| 2.4 | Arch violation | Medium | `Toaster/useCases/toasterSubscriber.ts` |
| 2.5 | Arch violation | Medium | `Arrangement/stores/chordTrackStore.ts` |
| 2.6 | Arch violation | Medium | 262 intra-module barrel paths in Arrangement |
| 3.1 | Structure | High | `AppShell.tsx` |
| 3.2 | Structure | High | `panels/devicePanels/` (26 files) |
| 3.3 | Verbosity | Medium | `createTrack.ts`, `getNextClipId.ts` |
| 3.4 | Typing / Structure | Medium | `models/Track.ts` vs `stores/trackStore.ts` |
| 3.5 | Verbosity | Low | `duplicateClip.ts`, `duplicateClipToNextBar.ts` |
| 3.6 | Verbosity | Low | `TimelineSurface.tsx`, `usePianoRollInteractions.ts` |
| 3.7 | Structure | Medium | 8 modules with `services/` directories |
| 3.8 | Structure | Medium | `offlineRender.ts` |
| 4.1 | Verbosity | Low | Color palettes in 5+ files |
| 4.2 | Verbosity | Medium | `AppShell.tsx:closeAllDevicePanels` |
| 5.1 | Typing | High | `commandQueries.ts:12–36` |
| 5.2 | Convention | Low | 4 files use `interface` |
| 5.3 | Convention | Low | Sampler + CrdtDocument namespace imports |
| 5.4 | Typing | Low | `inject.ts` internal `any` |
| 6.* | Correctness | Medium | 10+ files with module-level counters/singletons |
| 7.1 | Convention | Low | `PianoModel3D.tsx` |
| 8.1 | Structure | Medium | `timelineViewStore.ts` — 5 business functions |
| 8.2 | Structure | Medium | `glutenStore.ts` + 20 others — business logic in stores |
| 8.3 | Bug / Structure | High | `clipboardStore.ts` — mutable `export let`, not a `Store<T>` |
| 9.1 | Typing / Structure | Medium | `MIDI/models/MidiNote.ts` vs `stores/midiStore.ts` |
| 9.2 | Verbosity | Medium | `MIDI/useCases/midiNoteCrud/` — 10 near-identical files |
| 10.1 | Arch violation | High | `createAutomergeStorage.ts` — infra imports from CrdtDocument module |
| 11.1 | Bug / Structure | High | `togglePlayback.ts` — silently fire-and-forget, hides circular dep |
| 12.1 | Verbosity | Low | 3 independent `SpectrumAnalyzer` components |
| 12.2 | Typing | Low | `useProjectState`/`useTransportState` local type re-definitions |
| 12.3 | Structure | Low | `AppShell.tsx` — direct `localStorage` bypasses store |
| 13.1 | Bug | Medium | `resetModuleStoresToDefault.ts` — plugin stores not reset |
| 14.1 | Structure | Medium | `sessionManagement.ts` — 15+ module-level session vars |
| 14.2 | Verbosity | Low | `sessionManagement.ts` — compress/decompress loop duplication |
