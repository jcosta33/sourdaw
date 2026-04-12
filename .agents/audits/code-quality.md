---
name: code-quality
description: Broad code quality audit — bugs, structural problems, verbosity, over-engineering, poor typing. Covers app entry point through every major module.
type: audit
status: complete
date: 2026-04-12
---

# Code Quality Audit

Analysed the full frontend from `src/app/main.tsx` inward through every major module. Issues are grouped by category and ordered roughly by impact.

## Resolved findings (updated 2026-04-13)

The following sections have been addressed in branch `agent/refactor-code-quality` (25 commits, 883 files):

**Bugs/Correctness:** §1.1 ✅, §1.2 ✅, §1.3 ✅ (UUID counters), §1.4 ✅, §1.5 ✅ (MIDI cleanup in remove+ripple)
**Architecture:** §2.1 ✅, §2.2 ✅, §2.3 ✅, §2.4 ✅, §2.5 ✅, §2.6 ✅ (zero violations all modules)
**Structural:** §3.2 ✅ (generic panel event), §3.4 ✅, §3.5 ✅, §3.6 ✅, §4.1 ✅, §8.3 ✅
**Typing:** §5.2 ✅, §5.3 ✅, §5.5 ✅ (Grinder/Gluten meters), §41.2 ✅ (AppAction unions tightened), §45.2 ✅ (collision detection)
**Convention:** §7.1/17.1 ✅ (ESLint enforced), §23.3 ✅ (64 calls migrated to logger)
**MIDI:** §9.1 ✅, §9.2 ✅ (updateNotesForClip helper), §46 ✅ (transform helper)
**Infra:** §10.1 ⚠️ (documented — needs DI inversion spec)
**Collaboration:** §13.1 ✅ (11 stores reset), §14.2 ✅, §27 ✅, §51.1 ✅, §51.2 ✅, §100.1 ✅, §101.1 ✅ (snapshot validation)
**Transport:** §11.1 ✅, §23.2 ✅, §28.2 ✅, §55.1 ✅, §80.1 ✅ (dispatch map), §85.1 ✅
**AudioEngine:** §16.2 ✅ (WAV encoder dedup), §23.1 ✅, §25.1 ✅, §25.2 ✅ (named nodes), §25.3 ✅ (LFO dispose), §25.4 ✅, §29 ✅, §132.1 ✅ (ShortTermLUFS)
**AI:** §15.1 ✅ (prompt extracted), §48 ✅ (handler factory), §50 ✅ (notifications), §59 ✅, §91.3 ✅ (if/else)
**Arrangement bugs:** §30.1 ✅, §30.2 ✅, §30.3 ✅, §30.4 ✅, §30.5 ✅, §32 ✅
**Plugin:** §33.1 ✅, §52.2 ✅, §52.3 ✅ (calibration consolidation), §53 ✅ (shared createFindDeviceRef)
**Constants:** §43 ✅ (shared NOTE_NAMES), §98.1 ✅, §110.1 ✅, §114.2 ✅, §138.3 ✅
**ID counters:** §95.1 ✅, §95.2 ✅, §122.1 ✅ (all UUID), §56.4 ✅
**Performance:** §49.1 ✅, §49.2 ✅ (BaseMidiProcessor), §54.1 ✅, §55.1 ✅, §56.3 ✅, §74.2 ✅, §76.1 ✅, §82.1 ✅, §85.1 ✅, §86.1 ✅, §86.2 ✅, §108.1-108.3 ✅, §117.2 ✅, §126.1 ✅, §132.1 ✅, §133.1 ✅, §134.1 ✅, §141.1-141.3 ✅, §148.1 ✅ (worklet shift→splice), §153.2 ✅
**Mutable exports:** All `export let` → getter/setter (HMR safe)
**Workspace:** §12.3 ✅ (localStorage constant), §21.2 ✅ (PreferencesDialog split), §47.1 ✅ (generic event)

---

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

### 1.5 `removeClip` — orphans MIDI notes in `midiStore`
**Files:** `src/modules/Arrangement/useCases/clip/removeClip.ts`, `src/modules/Arrangement/useCases/rippleDelete/rippleDeleteClips.ts`, `src/modules/Arrangement/handlers/clip/handleRemoveClip.ts`

When a clip is removed, neither `removeClip()` nor `rippleDeleteClips()` deletes the clip's MIDI data from `midiStore.notesByClipId`. The handler's `execute()` only calls one of these two functions. By contrast, `removeTrack.ts` (line 42–50) correctly cleans up the MIDI store when a whole track is removed.

Result: every deleted MIDI clip leaves orphaned entries in `midiStore.notesByClipId[clipId]`, `ccByClipId`, and `pitchBendByClipId`. These accumulate in memory for the lifetime of the session and are included in every CRDT write, growing the persisted document unnecessarily.

**Fix:** `handleRemoveClip.execute()` should call `midiStore.set` to delete the clip's key from all three maps after removing the clip.

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

### 5.5 Long positional parameter lists across meter-update functions
**Files:** `src/modules/Grinder/stores/grinderStore.ts:63–94`, `src/modules/Gluten/stores/glutenStore.ts:56–79`, and equivalents in other device stores

`updateGrinderMeters` has 11 positional parameters. `updateGlutenMeters` has 7. All are optional after the first three, making call sites fragile (passing `undefined` positionally) and unreadable. These should be a single options object type.

```ts
// Current:
updateGrinderMeters(deviceId, inputDb, preampDb, powerAmpDb, outputDb, gateOpen?, gateEnvelopeDb?, sagVoltage?, latency?, neuralCpuPercent?, neuralWarmupProgress?)

// Better:
updateGrinderMeters(deviceId: string, meters: GrinderMeterValues): void
```

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

### 8.2 `glutenStore.ts` and 22 others — business logic in store files
**Files:** `Gluten/stores/glutenStore.ts`, `Grinder/stores/grinderStore.ts`, `Fermenter/stores/fermenterStore.ts`, `Bacteria/stores/bacteriaStore.ts`, `Levain/stores/levainStore.ts`, `Knead/stores/kneadStore.ts`, `Proof/stores/proofStore.ts`, `Sampler/stores/padStore.ts`, `Sampler/stores/samplerStore.ts`, `Sampler/stores/sliceStore.ts`, `Toaster/stores/toasterStore.ts`, `Yeast/stores/yeastStore.ts`, `Scoring/stores/scoringStore.ts`, `SampleLibrary/stores/libraryStore.ts`, `Command/stores/undoStore.ts`, `AiRuntime/stores/aiActionHistoryStore.ts`, `AiRuntime/stores/chatStore.ts`, `AiRuntime/stores/mixAnalysisStore.ts`, `Crust/stores/crustStore.ts`, `Plugin/ProofChamber/stores/chamberStore.ts`, `Arrangement/stores/vcaGroupStore.ts` (23 confirmed)

Each file exports mutation functions alongside the store declaration. Each function reads from `store.value`, computes new state, and calls `store.set` — this is use-case logic living in the store layer. `updateGrinderMeters` in `grinderStore.ts` (lines 63–94) takes 11 positional parameters, which should be an options object.

The pattern is structural: the store layer is being used as a service layer because there is no clearly documented place for simple device-state mutations that doesn't require a full `ActionHandler` boilerplate. AGENTS.md should define when a mutation belongs in `useCases/` vs a store helper.

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

### 11.2 `compileDso.ts` — type duplication to avoid circular dependency
**File:** `src/modules/AiRuntime/useCases/dsoEditor/compileDso.ts:28–60`

```ts
// Local type aliases — duplicated from AiGeneration algorithm files to avoid
// a circular module dependency (AiGeneration already imports from AiRuntime).
type MelodyStyle = 'simple' | 'arpeggiated' | ...
type ChordProgressionStyle = 'pop' | 'jazz' | ...
type DrumPatternStyle = ...
```

The same circular dependency between `AiRuntime` ↔ `AiGeneration` that was handled in `togglePlayback` with a dynamic import is here papered over by manually copying union type literals. If the canonical `ChordProgressionStyle` in `AiGeneration` gains a new style member, `compileDso.ts` will silently diverge. The shared types should be extracted to a standalone `models/` file that neither module needs to import from the other.

---

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

## 15. AiRuntime Module

### 15.1 `sendChatMessage.ts` — 340-line function, missing body indentation, hardcoded prompt
**File:** `src/modules/AiRuntime/useCases/sendChatMessage.ts`

Several issues in one file:

1. **Wrong indentation across the entire function body.** Lines 95–338 are not indented inside the `async function sendChatMessage` body — top-level statements sit at column 0. This is a linting blind spot, not a correctness issue, but makes the file visually inconsistent.

2. **51-line system prompt string hardcoded in a use-case file** (lines 42–92). The prompt is product copy / content, not business logic. It should live in a constant file, be loaded from a resource, or at minimum be in a separate module.

3. **Two distinct responsibilities in one function.** Lines 119–213 handle "prompt command mode" (parse → execute `AppAction`s); lines 215–338 handle "chat mode" (LLM streaming). These warrant separate functions.

4. **Streaming callback pattern triplicated.** The `extractThinkBlock(fullContent)` + `updateChatMessage(...)` callback appears identically in all three backend branches (native, cloud, webllm). A `handleToken(token: string)` closure extracted before the branches would remove the repetition.

5. **`AsyncIterable<any>` cast** on line 296 — the WebLLM engine type is not imported, so the chunk generator is typed as `any`.

---

## 22. Security

### 22.1 `runEditorScript` — unsandboxed `new Function()` in main thread
**File:** `src/modules/Extension/useCases/extension/runEditorScript.ts:20`

```ts
const fn = new Function('console', 'daw', code);
fn(sandboxedConsole, createDawApi());
```

User-supplied script code is executed via `new Function` on the main thread with no sandbox. `createDawApi()` exposes the full `executeAppAction` dispatch with no permission check against the extension's declared manifest permissions. A malicious script can call any action in the registry (add/remove tracks, load presets, exfiltrate project state via the transport store, etc.).

The comment in `scripting.ts` (lines 2–11) acknowledges this: "TODO: SECURITY — before shipping: 1. Move to Worker-based execution 2. Validate each action against the extension's declared permissions 3. Rate-limit API calls." Extension commands in the command palette have already been removed because of this (`miscCommands.ts:143`) but `runEditorScript` is still callable.

**Fix:** Move execution into a `Worker` with a `postMessage` proxy that validates each action against the manifest's declared permissions list before forwarding to `executeAppAction`.

---

### 22.2 `keyManagement.ts` — API key in a module-level variable with `dangerouslyAllowBrowser: true`
**File:** `src/modules/AiRuntime/repositories/cloudLlm/keyManagement.ts:6–13`

```ts
let apiKey: string | null = null;
let client: Anthropic | null = null;

export const setCloudApiKey = inject({ logger })(({ logger }) =>
    function setCloudApiKey(key: string): void {
        apiKey = key;
        client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    }
);
```

The Anthropic API key is stored in an unprotected module-level variable and passed to the SDK with `dangerouslyAllowBrowser: true`. In a browser context, the key is accessible from DevTools console (`__importedModule.apiKey`) and any injected script. This is a known limitation of browser-based LLM frontends but should be explicitly documented as a threat-model decision rather than an incidental use of the `dangerous` flag.

---

## 21. Further Architecture Violations

### 21.1 `MIDI/useCases/chordTrack/` — MIDI module writing to Arrangement's store
**Files:** `src/modules/MIDI/useCases/chordTrack/addChordEvent.ts`, `moveChordEvent.ts`, `updateChordEvent.ts`, `clearChordTrack.ts`, `removeChordEvent.ts`, `toggleChordTrack.ts`, `getChordAtBeat.ts` (7 files)

All 7 import `chordTrackStore` from `#/modules/Arrangement/stores`:
```ts
import { chordTrackStore } from '#/modules/Arrangement/stores';
```

`chordTrackStore` is part of the Arrangement module's state. The MIDI module should not write to another module's store. The chord track's data would be better owned by the MIDI module (or a dedicated ChordTrack module), with Arrangement reading from it. As-is, the ownership boundary is inverted: the data lives in Arrangement but the mutations live in MIDI.

---

### 21.2 `PreferencesDialog.tsx` — 8 section components in one 737-line file
**File:** `src/modules/Workspace/presentations/views/PreferencesDialog.tsx`

The file defines 8 section components inline (lines 173–737): `GeneralSection`, `AppearanceSection`, `LayoutSection`, `AudioSection`, `MidiSection`, `PerformanceSection`, `AiSection`, plus imports `ShortcutsSection` from a sibling file. Each section is 30–170 lines. Splitting them into individual files under `presentations/views/preferences/` would align with the project's existing pattern for `Inspector/` subdirectory components and reduce the file's cognitive load.

---

## 16. Undocumented Module Layers

### 16.1 `handlers/` — 14 modules use a layer not in AGENTS.md
**Modules:** `Arrangement`, `AiGeneration`, `AiRuntime`, `AudioAnalysis`, `AudioEngine`, `Automation`, `Collaboration`, `Command`, `CrdtDocument`, `MIDI`, `Plugin`, `Project`, `Transport`, `Workspace`

AGENTS.md defines these module layers: `useCases/`, `stores/`, `repositories/`, `models/`, `events/`, `presentations/`. A `handlers/` directory is present in 14 modules but is not defined anywhere in the architecture documentation.

The handlers implement `ActionHandler<T>` objects (the `createHandler` pattern from `helpers/createHandler.ts`). This is a legitimate and consistent layer — it contains the business logic for undoable commands. However, without documentation, new contributors cannot distinguish between `handlers/` and `useCases/`, or know which functions belong in which layer.

The omission also means `pnpm deps:validate` cannot enforce boundary rules for this layer.

---

### 16.2 `AiGeneration/handlers/aiMidi/audioBufferToWav.ts` — duplicate WAV encoder
**Files:** `src/modules/AiGeneration/handlers/aiMidi/audioBufferToWav.ts` (55 lines) and `src/modules/AudioEngine/repositories/audioEncoders/wavEncoder.ts`

`AiGeneration` contains its own 55-line synchronous 16-bit PCM WAV encoder. The canonical encoder at `AudioEngine/repositories/audioEncoders/wavEncoder.ts` is async and supports 16/24/32 bit depths. Rather than calling through the public `#/modules/AudioEngine` API (`audioBufferToWav`), the module has an independent implementation. If the WAV encoding logic needs a bug fix (e.g. endianness, sample clamping), it must be applied to two places.

---

## 17. Convention Violations (expanded)

### 17.1 `if` without block syntax — 100+ occurrences, not isolated
**Previous finding §7.1 understated the scope.**

`grep` finds over 106 occurrences of `if (condition) return value` (no braces) across module source files. Prominent examples beyond `PianoModel3D.tsx`:
```ts
// src/modules/Workspace/presentations/views/Inspector/deviceLayoutRegistry.tsx:55,58,62
if (exact) return exact;
if (deviceType.startsWith(prefix)) return component;
return null;
```

The pattern is pervasive across `useCases/`, `handlers/`, `repositories/`, and `presentations/` files. AGENTS.md mandates `{}` for all `if` statements.

---

## 18. Workspace Panel Toggle Proliferation

### 18.1 33 files for 33 single-line property setters
**Directory:** `src/modules/Workspace/useCases/togglePanel/panelToggles/`

All 33 files follow the same structure:
```ts
// toggleSidebar.ts (8 lines):
export function toggleSidebar(): void {
    const current = getWorkspaceState();
    if (!current) return;
    updateWorkspaceState({ sidebarOpen: !current.sidebarOpen });
}

// selectClip.ts (4 lines):
export function selectClip(clipId: string): void {
    updateWorkspaceState({ selectedClipId: clipId });
}
```

These are not use cases — they are workspace state property mutations with a function name. They provide no validation, no side effects, and no logic beyond the one-liner. The calling convention (`selectClip(id)`) is equivalent to `updateWorkspaceState({ selectedClipId: id })`, and the extra indirection means every new workspace field requires a new file.

This is the most extreme instance of the passthrough use-case anti-pattern (§3.3) in the codebase: 33 files, each 4–9 lines, all doing the same thing with a different field name.

---

## 19. AudioEngine Encoder Passthroughs

### 19.1 `audioBufferToWav` / `audioBufferToMp3` / `audioBufferToFlac` — 3 passthrough use cases
**Files:** `src/modules/AudioEngine/useCases/audioBufferToWav.ts`, `audioBufferToMp3.ts`, `audioBufferToFlac.ts`

Each is a 15-line file that imports from the repository, gives it the same name, and re-exports it with no added logic:
```ts
import { audioBufferToWav as encode } from '../repositories/audioEncoders/wavEncoder';
export function audioBufferToWav(buffer, bitDepth = 16, onProgress?) {
    return encode(buffer, bitDepth, onProgress);
}
```

Per §3.3, passthroughs add import-graph depth without any value. The three encoder functions could be re-exported directly from the module's `index.ts` barrel pointing to the repository exports.

---

## 20. Inspector / Registry

### 20.1 `deviceLayoutRegistry.tsx` — registry logic mixed with a React component
**File:** `src/modules/Workspace/presentations/views/Inspector/deviceLayoutRegistry.tsx`

The file exports:
- `registerDeviceLayout()`, `registerPrefixLayout()`, `resolveDeviceLayout()` — pure registry functions
- `filterParams()` — pure array utility
- `SectionHeader` — a React functional component

A registry module should not export React components. `SectionHeader` is a small presentational helper that was co-located for convenience; it should live in a `components/` file or alongside the inspector view. As-is, any module that wants `SectionHeader` must import the entire registry, including the mutable `EXACT_LAYOUTS` Map and `PREFIX_LAYOUTS` array.

---

## 24. Demo Project Builders — Large Data Files in `useCases/`

### 24.1 Four demo project files total 7000+ lines of hardcoded note data
**Files:**
- `src/modules/Project/useCases/demoProjects/resonance/createResonanceDemo.ts` — 2240 lines
- `src/modules/Project/useCases/demoProjects/nebulaDrift/createNebulaDriftDemo.ts` — 2026 lines
- `src/modules/Project/useCases/demoProjects/synthwave/createSynthwaveDemo.ts` — 1442 lines
- `src/modules/Project/useCases/demoProjects/sweetDreams/createSweetDreamsDemo.ts` — 1285 lines

Each file is a 1000–2240 line procedural project builder that hardcodes MIDI note arrays, automation curves, and device parameters as TypeScript literals. Issues:

1. **Wrong layer:** Hardcoded data (note arrays, beat positions) in `useCases/`. This is project content, not business logic. The data should be JSON/SDAW files loaded by a generic `loadDemoProject(file)` use case.

2. **Store bypass:** All four files write directly to `trackStore`, `midiStore`, `transportStore`, `automationStore` via `.set()` and `.value` — bypassing `executeAppAction`, the undo stack, and the CRDT semantic context.

3. **`Math.random()` in deterministic demo content:** `createResonanceDemo.ts:28` calls `Math.random()` to humanize velocities — the result is non-deterministic across runs, which makes demos feel slightly different each time they're loaded.

4. **`(device.devices[0] as any).parameterValues`** in `sweetDreamsDemo.ts:212,224` — reaching into device internals through `as any` to set initial parameter values (see §5.1 pattern).

---

## 23. Untyped Property Attachment and `as any` Hotspots

### 23.1 `BuiltinDeviceNode._bypassed` — ad-hoc property via `as any`
**File:** `src/modules/AudioEngine/engine/TrackNode.ts:161,458`

For Faust and generic Web Audio device nodes, bypass state is stored by mutating the node object through an `as any` cast:
```ts
(dn as any)._bypassed = bypassed;   // setter
if ((dn as any)._bypassed) { ... }  // reader
```

`BuiltinDeviceNode` has no `bypassed` field. The property is invisible to the type system: any code searching for `bypassed` will not find this branch. Adding `bypassed?: boolean` to `BuiltinDeviceNode` would eliminate both casts.

---

### 23.2 `(source as any).fadeGainNode` — GainNode stored on AudioBufferSourceNode
**Files:** `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts:106`, `scheduleAudioClips.ts:133`, `playheadScheduler.ts:94,132,256`

Clip fade GainNodes are attached to `AudioBufferSourceNode` instances via `as any`:
```ts
(source as any).fadeGainNode = fadeGain;   // at schedule time
for (const src of activeAudioSources as any[]) {  // at stop/seek
    src.fadeGainNode?.gain.cancelScheduledValues(...)
}
```

The scheduler tracks live `AudioBufferSourceNode` objects in `activeAudioSources`, but to also stop the fade node, the GainNode reference needs to travel with the source. A typed wrapper `{ source: AudioBufferSourceNode; fadeGain: GainNode | null }` would replace all three casts and make the cleanup logic explicit.

---

### 23.3 `console.error`/`console.warn` bypassing the logger abstraction — 86 calls
**Scope:** Entire `src/modules/` tree

The project defines `logger` in `#/infra/logger/appLogger` with typed `.error(Error)`, `.warn(...)`, `.info(...)` methods. Direct `console.error` and `console.warn` calls in production code bypass this abstraction. Any future log writer (remote error reporting, structured telemetry) would not capture these calls. The highest-density offenders are `Collaboration/` (7 calls), `CrdtDocument/` (8), `AudioEngine/` (12), and `AiRuntime/dsoEditor/compileDso.ts` (1 plus several already in scope). Total 86 calls confirmed by grep.

---

---

## 25. AudioEngine Device Factory Issues

### 25.1 `createSidechainCompressorFallback` duplicates `createCompressor`
**Files:** `src/modules/AudioEngine/repositories/devices/dynamics/createSidechainCompressorFallback.ts`, `createCompressor.ts`

The two files are identical except that `createSidechainCompressorFallback` omits the `knee` node:

```ts
// createCompressor.ts
comp.threshold.value = -20;
comp.ratio.value = 4;
comp.attack.value = 0.01;
comp.release.value = 0.1;
comp.knee.value = 6;           // ← only difference
const makeup = ctx.createGain();
makeup.gain.value = 1;
comp.connect(makeup);

// createSidechainCompressorFallback.ts — same block, knee line missing
```

`applySidechainCompressorParams` further duplicates `applyCompressorParams` with `sc-comp-` key prefixes instead of `comp-`. Both files should be unified; the sidechain fallback can call `createCompressor` directly.

---

### 25.2 `applyChorusParams` — fragile positional array indexing into `nodes[]`
**Files:** All `apply*Params.ts` in `AudioEngine/repositories/devices/modulation/`

Node retrieval uses hard-coded indices into the `nodes` array built by `create*` functions:
```ts
// applyChorusParams.ts
const dry    = dn.nodes[1] as GainNode;
const wet    = dn.nodes[2] as GainNode;
const lfo1   = dn.nodes[5] as OscillatorNode;
const lfoGain = dn.nodes[7] as GainNode;
```

If `createChorus` ever reorders its node list (e.g., adding an analyser), `applyChorusParams` silently applies parameters to the wrong nodes with no type error. The `OfflineDeviceNode` shape is `{ inputNode, outputNode, nodes: AudioNode[] }` — a named-field structure (or a device-specific sub-type) would eliminate all positional casts.

---

### 25.3 LFO oscillators started in `create*` have no dispose path — resource leak
**Files:** `createChorus.ts`, `createFlanger.ts`, `createTremolo.ts`, `createAutoPan.ts`

Each `create*` function calls `lfo.start(0)` to begin oscillation, but the `OfflineDeviceNode` type has no `dispose()` method. When a device is removed from a track (e.g., via `removeDevice` action), the oscillator nodes are simply abandoned — their `AudioBufferSourceNode`-equivalent is never stopped, and the `AudioContext` keeps them alive until the context is closed. In a long session with many device additions/removals this accumulates.

---

### 25.4 `applyParams` switch in `deviceNodeFactory.ts` should be a lookup map
**File:** `src/modules/AudioEngine/repositories/deviceNodeFactory.ts:78–136`

The file already has `DEVICE_FACTORIES: Record<string, factory>` for creation. For parameter application, a 19-case `switch` is used instead of a parallel `Record`:

```ts
// current
switch (deviceType) {
    case 'builtin-eq': applyEqParams(dn, params); break;
    case 'builtin-compressor': applyCompressorParams(dn, params); break;
    // … 17 more cases
}

// simpler
const DEVICE_APPLIERS: Record<string, (dn, params) => void> = {
    'builtin-eq': applyEqParams,
    'builtin-compressor': applyCompressorParams,
    // …
};
DEVICE_APPLIERS[deviceType]?.(dn, params);
```

Every time a new device type is added, the developer must update both `DEVICE_FACTORIES` and the switch — easy to miss one.

---

## 26. `builtinEffectDescriptors.ts` Duplicates Audio-Code Defaults (1 234 lines)

**File:** `src/modules/Arrangement/models/pluginDescriptors/builtinEffectDescriptors.ts`

This 1 234-line file declares `PluginDescriptor` objects for every built-in effect and instrument. Each descriptor carries `value` and `defaultValue` fields for every parameter — values that are _also_ hardcoded in `AudioEngine/repositories/devices/create*.ts` as the initial `AudioParam` values.

Example: the EQ low-band default gain is `0` in `builtinEffectDescriptors.ts` (line 19) and also `low.gain.value = 0` in `createEq.ts` (line 10). If a developer changes the audio default and forgets to update the descriptor, the UI inspector shows a stale default mark (◆) even when the parameter is at its "true" default, and preset serialisation stores the wrong baseline.

There is no test or assertion that keeps these two sources in sync. The descriptor's `value`/`defaultValue` should be the single source of truth, driving both the UI and the audio initialisation path — currently they are duplicated with no enforcement.

---

## 27. `AutomergeRepository._loadAllSync` Discards `save()` Return Value

**File:** `src/modules/CrdtDocument/repositories/automergeRepository.ts:276–278`

In the synchronous fallback path for project loading, after replaying all incremental chunks the code calls `Automerge.save()` for every document but does not store the result:

```ts
for (const doc of this.docs.values()) {
    Automerge.save(doc);   // ← return value discarded
}
```

`Automerge.save()` compacts the document's change log into a single binary snapshot and returns a `Uint8Array`. Calling it without using the result achieves nothing — the uncompacted documents with their full incremental chains remain in `this.docs`. The intent was presumably to compact in-place (not possible with Automerge's immutable doc model — you would have to `docs.set(id, Automerge.load(Automerge.save(doc)))`). This is a silent no-op that wastes CPU on every fallback load.

---

## 28. `playheadScheduler.ts` — Module-Level Session State + Tripled Cleanup Block

**File:** `src/modules/Transport/useCases/playheadScheduler.ts`

### 28.1 Nine module-level mutable variables for scheduler state
```ts
let timerId: ReturnType<typeof setTimeout> | null = null;
let lastTickTime = 0;
let accumulatedPosition = 0;
let lastScheduledBeat = -1;
const scheduledAudioClips = new Set<string>();
const scheduledFrozenTracks = new Set<string>();
const activeAudioSources: AudioBufferSourceNode[] = [];
let punchRecordingActive = false;
let punchRecordingClipIds: string[] = [];
```

Nine file-scope mutable variables constitute implicit singleton state for the running scheduler, identical in spirit to the 13-variable singleton in `sessionManagement.ts` (§14.1). Under Vite HMR, when the module is replaced mid-playback the module re-initialises these to defaults while the old `setTimeout` callback still holds a reference to the previous closure — leaving orphaned ticks. Encapsulating in a `class PlayheadScheduler` or a factory-returned object would isolate the state.

### 28.2 Stop-source cleanup block triplicated
The 16-line `for (const src of activeAudioSources as any[])` block that cancels fade ramps and stops each `AudioBufferSourceNode` appears three times verbatim:
- Lines 94–108 (loop point wraparound)
- Lines 132–148 (follow-action jump)
- Lines 256–270 (`stopPlayheadScheduler`)

Extracting it as `function stopActiveSources(sources, ctx)` would remove ~32 lines of duplication and make each call site's intent obvious.

---

## 29. `generateIR` — 8 Positional Parameters

**File:** `src/modules/AudioEngine/repositories/devices/reverbDelay/helpers.ts:5–12`

```ts
export function generateIR(
    sampleRate: number,
    duration: number,
    decayT60: number,
    earlyMs: number,
    earlyLevel: number,
    diffusion: number,
    hfDamping: number,
    lfDamping: number
): AudioBuffer
```

All 10 call sites (the `IR_GENERATORS` map, lines 55–64) pass these parameters positionally with no named keys. Same problem as §5.5 (`updateGrinderMeters` with 11 params) — a single transposition of two float arguments produces a subtly wrong IR with no type error. An `IRConfig` object would make each preset legible.

---

---

## 30. `Arrangement/useCases` Logic Bugs and Structural Issues

### 30.1 `glueClips` silently fails for multi-track selections
**File:** `src/modules/Arrangement/useCases/clipEditing/glueClips.ts:11–16`

```ts
const firstTrack = state.tracks.find((t) => t.clips.some((c) => clipIds.includes(c.id)));
const clips = firstTrack.clips.filter((c) => clipIds.includes(c.id));
```

If `clipIds` span two or more tracks, only the clips found on the first matching track are used. Clips from remaining tracks are silently dropped. No error is thrown and no partial-result is signalled. This diverges from what a user selecting across tracks would expect ("merge these clips into one").

### 30.2 `glueClips` discards source clip content — creates empty shell
**File:** `src/modules/Arrangement/useCases/clipEditing/glueClips.ts:21–34`

The glued clip is spread from `clips[0]` and covers `[min startBeat, max endBeat]` of all input clips. For MIDI clips the resulting clip has no notes — neither `midiStore.notesByClipId` is populated, nor is it cleared for the removed source clips (same orphan issue as §1.5). For audio clips, the glued clip references only the first clip's `audioBufferId`, covering a wider time span than the buffer actually fills.

### 30.3 `splitClipWithUndo` — right fragment discovery is fragile
**File:** `src/modules/Arrangement/useCases/clipEditing/splitClipWithUndo.ts:23–31`

After calling `splitClip`, the undo wrapper searches for the right fragment heuristically:

```ts
const rightClipId = getTrackState()?.tracks.flatMap(…)
    .find((c) =>
        c.id !== clipId &&
        c.trackId === origClip.trackId &&
        c.startBeat >= origClip.startBeat &&
        c.endBeat <= origClip.endBeat
    )?.id;
```

If another clip was concurrently placed in the same beat range (automation, loop record, or collaboration), `find` may return the wrong clip's ID. Undoing would then delete the wrong clip. `splitClip` should return the newly-created clip ID directly instead of requiring a post-hoc search.

### 30.4 `songStructureDetection.ts` — Drop classification branch is unreachable
**File:** `src/modules/Arrangement/useCases/songStructureDetection.ts:149–157`

```ts
} else if (isHigh) {
    sectionInfo = SECTION_PALETTE[3]!;   // Chorus
} else if (isLow) {
    sectionInfo = SECTION_PALETTE[6]!;   // Break
} else if (isHigh && progress > 0.5) {  // ← unreachable: isHigh already caught above
    sectionInfo = SECTION_PALETTE[7]!;   // Drop
```

The `Drop` branch requires `isHigh` to be true, but `isHigh` is already consumed in the preceding `else if (isHigh)` arm. TypeScript does not warn because there is no exhaustive narrowing. The Drop classification is silently never applied.

### 30.5 `stripSilence` — `_minSilenceBeats` parameter accepted but never used
**File:** `src/modules/Arrangement/useCases/stripSilence.ts:6`

```ts
export function stripSilence(clipId: string, thresholdDb = -40, _minSilenceBeats = 0.5): void {
```

The underscore prefix signals that `_minSilenceBeats` is intentionally unused — the minimum silence duration constraint is silently not enforced. A caller passing `minSilenceBeats: 2` (two beats of silence required) will get the same result as a caller passing `0.001`. The parameter should either be implemented or removed from the public signature.

---

## 31. `Automation/stores/automationRecordingState.ts` — Module-Level Mutable Session State

**File:** `src/modules/Automation/stores/automationRecordingState.ts:21–23`

```ts
export const activeRecording = new Map<string, RecordingSession>();
export const pendingPoints   = new Map<string, AutomationPoint[]>();
export const touchActive     = new Set<string>();
```

Three module-level mutable collections are exported as the shared state for automation recording. This is the same pattern flagged in §14.1 (`sessionManagement.ts`) and §28.1 (`playheadScheduler.ts`). Under Vite HMR these collections reset when the module reloads mid-recording, leaving pending points permanently unflushed. The recording subsystem should be encapsulated behind a factory that owns these maps inside a closure.

---

## 32. `generateRiser` / `generateSweepDown` — Structural Duplication

**File:** `src/modules/Arrangement/useCases/fillTransitionGeneration/generation.ts:80–130`

`generateRiser` (lines 80–103) and `generateSweepDown` (lines 106–130) are structurally identical — both iterate `steps` over `durationBeats`, compute a linear pitch interpolation, and push notes with linearly-scaled velocities. The only differences are:
- direction (`startPitch + range * progress` vs `startPitch - range * progress`)
- velocity curve (`60 + 67*p` vs `100 - 40*p`)

A single `generateLinearPitchRun(atBeat, duration, startPitch, endPitch, velStart, velEnd)` would replace both and allow arbitrary curves.

---

---

## 33. Plugin Param-Bridge Pattern Duplicated Across 6 Plugin Modules

**Files:** `Bacteria/`, `Crust/`, `Fermenter/`, `Gluten/`, `Grinder/`, `Toaster/` — each has `useCases/<plugin>ParamBridge/helpers.ts`

### 33.1 `createFindDeviceRef` copied verbatim 6 times

All six helpers independently define:
```ts
export function createFindDeviceRef(getAllTracksFn) {
    return function findDeviceRef(deviceId: string): DeviceRef | null {
        for (const track of getAllTracksFn()) {
            if (track.devices.some((d) => d.id === deviceId)) {
                return { trackId: track.id, deviceId };
            }
        }
        return null;
    };
}
```

`DeviceRef = { trackId: string; deviceId: string }` is also redeclared in each file. A single `createFindDeviceRef` in a shared `AudioEngine` or `Arrangement` utility would eliminate all six copies.

### 33.2 rAF-batched param update state repeated in 4 modules

Bacteria, Crust, Gluten, and Levain each export `pendingUpdates: Map<string, number>` and `latestValues: Map<string, number>` at module level (Levain wraps them inside a closure factory; the others export them bare). The rAF-debouncing pattern (`requestAnimationFrame(() => flushParam(...))`) is implemented independently in each, with the same risk: HMR resets the Maps mid-edit, silently dropping pending param writes to the audio engine.

---

## 34. `ingestDspAnalysis` — Blob-Finalizing Block Duplicated

**File:** `src/modules/Knead/useCases/dspAnalysis.ts:38–56`

The 6-line block that computes `pitchCenterCents`, sets `pitchCurveCents`, and pushes to `blobs` appears twice: once inside the loop (line 38) for regions terminated by an unvoiced frame, and once after the loop (line 51) to capture a region that runs to end-of-buffer:

```ts
// Lines 38–45 (inside loop)
const center = pitchPoints.reduce(...) / pitchPoints.length;
currentBlob.pitchCenterCents = Math.round(center);
currentBlob.pitchCurveCents = pitchPoints.map(...);
blobs.push(currentBlob as NoteBlob);

// Lines 51–56 (after loop) — identical
const center = pitchPoints.reduce(...) / pitchPoints.length;
currentBlob.pitchCenterCents = Math.round(center);
currentBlob.pitchCurveCents = pitchPoints.map(...);
blobs.push(currentBlob as NoteBlob);
```

Extracting `finalizeBlob(currentBlob, pitchPoints)` would consolidate both call sites.

---

---

## 35. `AudioEngine/repositories/audioRecorder/recording.ts` — Module-Level Recording State + Mono-Only

**File:** `src/modules/AudioEngine/repositories/audioRecorder/recording.ts:36–40`

### 35.1 Five module-level mutable variables for recording session
```ts
let mediaStream: MediaStream | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let recordingNode: AudioWorkletNode | null = null;
let recordingWorker: Worker | null = null;
let onRecordingComplete: ((buffer: AudioBuffer) => void) | null = null;
```

This follows the same module-level singleton pattern flagged in §14.1, §28.1, §31.1, etc. Under Vite HMR, a hot reload during recording would null out these references, leaving the `AudioWorkletNode` and `Worker` running orphaned with no cleanup path.

### 35.2 Only mono recording supported
**File:** `src/modules/AudioEngine/repositories/audioRecorder/recording.ts:101`

The `AudioWorkletNode` is constructed with `channelCount: 1`. Stereo microphones and interface inputs silently record only the left channel. There is no option to configure channel count. No user-visible warning is displayed.

---

## 36. `TrackNode.ts` — `DeviceNode` vs `OfflineDeviceNode` Type Divergence

**File:** `src/modules/AudioEngine/engine/TrackNode.ts:413`

```ts
applyParams(dn as any, dn.type, { [paramId]: value });
```

`deviceNodeFactory.applyParams` expects an `OfflineDeviceNode` (the type from `repositories/devices/types.ts`), but the `dn` here is a `DeviceNode` from the engine's internal `TrackNode` representation. Both carry `{ inputNode, outputNode, nodes }` but have evolved independently with different field sets, requiring the `as any` cast to bridge the gap. Unifying or aliasing these types would remove the cast and catch future divergence at compile time.

---

## 37. `loadProject.ts` — Module-Level `stopAutoSave` Singleton

**File:** `src/modules/Project/useCases/projectPersistence/loadProject.ts:11`

```ts
let stopAutoSave: (() => void) | null = null;
```

The auto-save unsubscribe function is stored as a module-level mutable. Under HMR, a module reload while a project is open would create a second `startCrdtAutoSave()` subscription without stopping the first (since `stopAutoSave` resets to `null`), resulting in duplicate write events and doubled persistence calls until the page is reloaded.

---

---

## 38. `usePianoRollInteractions` — 840-Line Hook with 20-Field Argument Object

**File:** `src/modules/Workspace/presentations/hooks/usePianoRollInteractions.ts`

The hook accepts a single `InteractionArgs` object with 20 fields and returns 7 handler functions. Its three largest handlers — `handleMouseDown` (167 lines), `handleMouseUp` (157 lines), and `handleMouseMove` (132 lines) — each contain 3–5 distinct interaction modes (paint, lasso, drag, resize, velocity) handled via nested `if/else` chains inside a single function body.

Specific issues:

- **`PianoRollChordType`** union (17 string literals, lines 47–64) is defined locally — this type is also likely needed in command payloads and tests but can only be reached by importing from a presentation-layer hook.
- **`handleMouseDown`** and **`handleMouseUp`** form a single state machine split across two separate handler functions with no shared context type. The drag state is stored in a `useRef<DragState>` that is written in `Down` and read in `Move`/`Up` — invisible to the type checker.
- 20 props with `Dispatch<SetStateAction<...>>` parameters indicate the hook is managing state that belongs outside: `setZoom`, `setScrollX`, `setSelectedNoteIds`, `setStepBeat` — these writes should go through use-case functions rather than being injected as React dispatch callbacks.

A split into `usePianoRollDrawGesture`, `usePianoRollDragGesture`, `usePianoRollKeyboard`, and `usePianoRollZoom` would reduce each unit to ~100–150 lines and expose the state machine explicitly.

---

---

## 39. Plugin `*Node.ts` — WASM Loading Boilerplate Duplicated Across 6 Files

**Files:** `AudioEngine/engine/BacteriaNode.ts`, `FermenterNode.ts`, `GlutenNode.ts`, `GrinderNode.ts`, `ToasterNode.ts`, `LevainNode.ts`

All six files independently define three identical structural patterns totalling ~960 lines:

### 39.1 `fetchWasmBinary` / `ensureWorkletRegistered` duplicated in each file
```ts
// Present in all 6 files — varies only in the error string and processor name:
const workletRegistrations = new WeakMap<BaseAudioContext, Promise<void>>();
let cachedWasmBytes: ArrayBuffer | null = null;

async function ensureWorkletRegistered(ctx) {
    let p = workletRegistrations.get(ctx);
    if (!p) { p = ctx.audioWorklet.addModule(url); workletRegistrations.set(ctx, p); }
    return p;
}
async function fetchWasmBinary(url) {
    if (cachedWasmBytes) return cachedWasmBytes;
    const r = await fetch(url); cachedWasmBytes = await r.arrayBuffer(); return cachedWasmBytes;
}
```

`cachedWasmBytes` is a module-level mutable — HMR resets it, forcing a refetch on the next worklet creation even if the binary is cached by the browser. A shared `WasmBinaryCache` singleton in a utility module would be a single reset point.

### 39.2 Init-timeout + `settled` flag pattern duplicated in each file
Each `create*Node` function implements a 10-second timeout using a boolean `settled` flag and `clearTimeout`:
```ts
let settled = false;
const timeout = setTimeout(() => {
    if (!settled) { settled = true; reject(new Error('*Node init timeout (10s)')); }
}, 10_000);
node.port.onmessage = (e) => {
    if (e.data.type === 'ready') { if (!settled) { settled = true; clearTimeout(timeout); resolve(); } }
};
```

A factory `function awaitWorkletReady(port, timeoutMs): Promise<void>` would consolidate this.

### 39.3 `*NodeResult` types are structurally identical except for one or two extra callbacks
Each plugin exports a `type *NodeResult = { workletNode, setParam, setBypass, onMeterData, connect, disconnect, destroy, ready }`. GrandBoule adds `noteOn`/`noteOff`/`setSustain`; Toaster adds `setPadParam`; Levain adds `handleCc`. The common surface could be a shared `BaseNodeResult` that plugin-specific types extend.

---

## 40. `wasmDeviceRegistry.ts` — `pendingParams` Placeholder Pattern Repeated 10 Times

**File:** `src/modules/AudioEngine/engine/wasmDeviceRegistry.ts` (508 lines)

Each of the 10 plugin descriptors (Fermenter, Toaster, Levain, ProofChamber, Gluten, Bacteria, Grinder, Proof, Scoring, GrandBoule) implements the exact same loading lifecycle:

```ts
const pendingParams: Array<[string, number]> = [];
const placeholder = loadingBypassNode(context, deviceId, deviceType);
placeholder.<plugin>Controls = { ready: false, noteOn: () => {}, ..., setParam: (n,v) => pendingParams.push([n,v]) };
const loadPromise = create<Plugin>Node(context)
    .then(async (result) => {
        await result.ready;
        for (const [n, v] of pendingParams) result.setParam(n, v);
        onLoaded({ deviceId, type: deviceType, nodes: [result.workletNode], ..., <plugin>Controls: { ready: true, ...result } });
    }).catch((err) => logger.warn(`[WebAudioEngine] <Plugin> failed: ${err}`));
return { placeholder, loadPromise };
```

The only variation is the `<plugin>Controls` field name and the set of callbacks forwarded from `result` to `onLoaded`. A generic `createWasmDescriptor<T>()` factory accepting a `controlsKey`, `create` function, and `mapResult` function would reduce the 10 descriptors (430+ lines) to a data table of ~80 lines.

---

---

## 41. `AppAction.ts` — Typing Weaknesses in 135-Member Union

**File:** `src/modules/Command/models/AppAction.ts` (305 lines)

### 41.1 Inverse-action payloads typed as `unknown`
`restoreTrack` and `restoreClip` carry snapshot fields explicitly typed `unknown`:
```ts
type: 'restoreTrack'; payload: {
    trackSnapshot: unknown;
    automationLaneSnapshots: unknown[];
    midiNotesByClipId: Record<string, unknown>;
    ...
};
```

The actual payload shapes are only known to the Arrangement restore handlers, which cast them with `as`. A type-safe snapshot is possible using the existing concrete types — the Command layer would need to import from Arrangement, but a shared `TrackSnapshot` type in a `models/` barrel would avoid the import. Currently any shape mismatch between emitter and handler is invisible to TypeScript.

### 41.2 Several action payloads typed as bare `string` where a union is available
- `setEditingTool.tool: string` — the supported tools are `'select' | 'draw' | 'cut' | 'stretch' | 'automation'`; using `string` means a typo passes silently.
- `addChordEvent.quality: string` — the supported chord qualities form a finite set already used in `MIDI/useCases/chordTrack/`.
- `addCvOutput.type: string` — should be `'cv-pitch' | 'gate'` (used only in two command entries).
- `setWarpAlgorithm.algorithm: string` — `'elastique-pro'` is the only value in use.

### 41.3 `AutomationMode` redefined in two places
`AppAction` line 145 inlines `'read' | 'write' | 'touch' | 'latch' | 'off'`. `Automation/stores/automationRecordingState.ts` line 10 defines `type AutomationMode = 'read' | 'write' | 'touch' | 'latch' | 'off'`. If a new mode is added, both sites must be updated manually. The comment in `automationRecordingState.ts` acknowledges the duplication: `"Automation-local enum (AGENTS.md §95 — model isolation)"`, but there is no `§95` in AGENTS.md.

---

## 42. `undoToIndex` — O(n) Sequential Undo Without Batching

**File:** `src/modules/Command/useCases/undoRedo.ts:75–97`

```ts
export async function undoToIndex(targetIndex: number): Promise<void> {
    // …
    for (let i = 0; i < stepsBack; i++) {
        await undo();
    }
```

Jumping 30 steps in the undo tree calls `undo()` 30 times sequentially. Each call:
1. Reads `undoStore`
2. Executes an action
3. Writes `undoStore` (triggering React re-renders)

This produces 30 store writes and 30+ re-renders for a single user gesture (clicking an old history entry). A batch variant — collecting all inverse actions then writing the store once — would reduce re-renders to one.

---

---

## 43. `NOTE_NAMES` Constant Duplicated 8 Times

**Files:** `Scoring/models/ScoringState.ts`, `Workspace/presentations/helpers/pianoRollConstants.ts`, `AudioAnalysis/useCases/keyDetection.ts`, `AudioAnalysis/useCases/pitchDetection.ts`, `Arrangement/useCases/audioAnalysis/detectKey.ts`, `AudioEngine/engine/ScoringNode.ts`, `AudioEngine/services/scoringProcessor.ts`, `GrandBoule/models/GrandBoulePerNoteParams.ts`

```ts
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
```

This 12-element array is declared independently in 8 files (2 exported, 6 private). `Scoring/models/ScoringState.ts` already exports it; none of the 6 private copies import from there. A single source (e.g., a shared `MIDI/models/noteNames.ts`) would eliminate all duplicates and ensure consistent handling of enharmonic spellings.

---

## 44. `detectKey` / `detectTempo` Block the Main Thread on Long Buffers

**Files:** `src/modules/AudioAnalysis/useCases/keyDetection.ts`, `tempoDetection.ts`

Both functions run synchronous, CPU-intensive analysis loops over the full audio buffer on the main thread with no yielding:

`detectKey` runs a Goertzel algorithm at 12 semitones × 6 octaves for every 2 048-sample hop in the buffer. For a 3-minute clip at 48 kHz this is ~4 200 hops × 72 frequency bins = 300 000+ Goertzel evaluations, each iterating 4 096 samples — potentially hundreds of millions of multiplications before the function returns. This will freeze the UI for multiple seconds on long files.

`detectTempo` is somewhat lighter (single-pass energy accumulation), but still synchronous over the full buffer.

By contrast, `audioBufferToWav` (same codebase) already yields every 32 768 samples via `await new Promise(r => setTimeout(r, 0))`. Neither analysis function implements any yielding. Both should run in a Web Worker (like `crdtWorker.ts`) or at minimum use `yield` checkpoints.

---

## 45. `executeAppAction` Handler Registry Cache — HMR and Collision Risks

**File:** `src/modules/Command/useCases/executeAppAction.ts:30,55`

### 45.1 Module-level handler cache resets on HMR
```ts
let handlerRegistryCache: Record<string, ActionHandler<any>> | null = null;
```

Under Vite HMR, when any of the 20 `get*Handlers()` functions changes, this cache resets to `null`. The next action call rebuilds from scratch — acceptable, but the old dispatched action (in a tick between reset and rebuild) has no handler and is silently dropped after a `logger.error`.

### 45.2 Handler key collisions are silent — last writer wins
The registry is built by spreading 20 `get*Handlers()` results. If two modules export a handler for the same `action.type`, the last spread wins silently. There is no duplicate-key detection or assertion. Given 135 action types across 20 handler namespaces, a collision becomes increasingly likely as the codebase grows.

---

## 46. MIDI Note Transform Files — 9 Near-Identical Read/Map/Write Functions

**Files:** `src/modules/MIDI/useCases/midiNoteTransforms/*.ts` (9 files)

Every file in the `midiNoteTransforms/` directory follows the same pattern verbatim:

```ts
export function <transformName>(clipId: string, ...params): void {
    const state = midiStore.value;
    if (!state) return;
    const existing = state.notesByClipId[clipId];
    if (!existing) return;
    midiStore.set({
        ...state,
        notesByClipId: {
            ...state.notesByClipId,
            [clipId]: existing.map((n) => ({ ...n, <field>: <transform> })),
        },
    });
}
```

The files are: `transposeNotes`, `invertNotes`, `retrogradeNotes`, `scaleAllVelocities`, `setAllVelocities`, `scaleVelocities`, `quantizeNotes`, `quantizeNoteLengths`, `humanizeNotes`.

The only variation is the mapping expression. This pattern is identical to the finding in §9.2 (`midiNoteCrud/` — 10 near-identical files): the same read-guard-map-write boilerplate is repeated nine times. A shared `transformNotes(clipId, mapper)` helper would reduce each function to a one-liner.

Note also that `scaleAllVelocities` and `setAllVelocities` overlap in purpose (one is a fixed value, the other a multiplier) — both guard `existing.length === 0` but `transposeNotes`/`invertNotes` guard without a length check, creating an inconsistent API contract.

---

## 47. `AppShell.tsx` — Combinatorial Explosion per Plugin Instrument

**File:** `src/modules/Workspace/presentations/views/AppShell.tsx` (820 lines)

### 47.1 13 device state variables + 14 event-listener effects + 13 JSX blocks, all per-plugin

Adding a new plugin instrument currently requires touching the component in **three places**:
1. A `useState` call (e.g. `const [glutenDeviceId, setGlutenDeviceId] = useState<string | null>(null)`)
2. A `useEffect` that subscribes to the panel-show event (calling `closeAllDevicePanels()` then setting state)
3. An `InstrumentBottomPanel` JSX block with plugin-specific label, color, and height

All 14 device `useEffect` hooks are structurally identical:
```tsx
useEffect(() => {
    return onPanelShowX((payload) => {
        closeAllDevicePanels();
        setXDeviceId(payload.deviceId);
    });
}, []);
```

The `closeAllDevicePanels()` function itself manually calls 13 state setters — it must be updated every time a plugin is added or removed.

A registry-driven approach (a `Map<string, ReactNode>` or a plugin descriptor array) would reduce the per-plugin surface to a single declaration.

### 47.2 Module-level `hasShownAlphaNotice` — HMR risk

```ts
let hasShownAlphaNotice = false; // line 97
```

Same class of issue as §14.1, §28.1, §31.1, §35.1, §37.1: module-level mutable state that resets on HMR. In development, the alpha notice dialog will reappear after every hot reload even if `localStorage` has the dismissed flag, because `hasShownAlphaNotice` is reset before the `localStorage` check is reached.

### 47.3 Left/Right panel placement duplicates 4 panels

The horizontal layout section renders the same four panels (Sidebar, InspectorPanel, ChatPanel, GenerativeAiPanel) twice — once for `placement === 'left'` and once for `placement === 'right'`. The only structural difference is which side the `DragResizeHandle` appears. This is ~80 lines of near-identical JSX. A `<PlaceablePanel side={prefs.panelPlacementSidebar}>` abstraction would eliminate it.

### 47.4 14 dimension setter functions

```ts
const setSidebarWidth = (fn) => updateWorkspaceState({ sidebarWidth: fn(sidebarWidth) });
const setInspectorWidth = (fn) => updateWorkspaceState({ inspectorWidth: fn(inspectorWidth) });
// ... 12 more identical setters
```

All 14 follow the same pattern. These could be one generic `makeDimSetter(key, current)` factory or moved into a hook.

---

## 48. Generation Handlers — Structurally Identical Trio

**Files:**
- `src/modules/AiGeneration/handlers/generation/handleGenerateMelody.ts`
- `src/modules/AiGeneration/handlers/generation/handleGenerateChordProgression.ts`
- `src/modules/AiGeneration/handlers/generation/handleGenerateDrumPattern.ts`

All three handlers follow the same skeleton:

```ts
export const handleGenerate<X> = createHandler<'generate<X>'>({
    execute: (a) => {
        const style = VALID_<X>_STYLES.has(a.payload.style) ? a.payload.style as ... : '<default>';
        // optional: validate scale, key, voicing ...
        const trackId = resolveOrCreateMidiTrack(a.payload.trackId, `<Label> (${style})`, { getTrackStoreState, addTrack });
        if (!trackId) return;
        apply<X>ToTrack(trackId, { style, bars: a.payload.bars, ... }, getPlayheadBeat());
    },
    describe: (a) => ({ label: `Generate ${a.payload.style} <x>` }),
    undoable: true,
});
```

The only variation is the validation set, the style type, and the `apply*ToTrack` call. A factory like `createGenerationHandler(config)` could unify them, keeping each file as a single `config` object declaration.

---

## 49. Yeast Processors — Audio-Thread Allocations and Boilerplate Duplication

**Files:** `src/modules/Yeast/useCases/processors/*.ts` (12 files)

### 49.1 Audio-thread allocations in `processMidi()`

`YeastWorkletProcessor` runs in an `AudioWorkletProcessor` context — the audio thread. CLAUDE.md states: "All audio-thread code: no allocation, no mutex locks, no blocking." The processors violate this rule in several ways:

**Template string keys in `Map.set`/`Map.get`** — `Humanizer` and `ScaleQuantizer` both construct keys like `` `${event.kind.channel}:${event.kind.note}` `` on every note event. Template string interpolation allocates a new string per call.

**`MarkovChain.processMidi` on every `noteOn`:**
```ts
this.held.sort((a, b) => a - b);    // allocates comparator context
this.stateToNote = [...this.held];   // spread allocation
if (this.stateCount !== this.held.length) {
    this.initDefaultMatrix(this.held.length);  // allocates full number[][] matrix
}
```
`initDefaultMatrix` allocates a 2D array and calls `row.reduce` — all triggered in the audio thread on every note-on when the chord size changes.

**`Arpeggiator.processMidi` line 102–103:**
```ts
const blockEnd = input.length > 0
    ? Math.max(...input.map((e) => e.timeSamples)) + 128
    : ...;
```
`input.map(...)` allocates a new array, then the spread operator copies it into `Math.max()` arguments — two allocations per block when events are present.

**`ScaleQuantizer.setParam('scale')`:**
```ts
const names = Object.keys(SCALE_PATTERNS); // allocates new array on every param set
```

The correct approach is to use integer keys for the `Map`, precompute the `blockEnd` with a simple `for` loop, and cache `Object.keys(SCALE_PATTERNS)` as a module-level constant.

### 49.2 Boilerplate duplicated across all 12 processor classes

Every processor class repeats the same four members verbatim:
```ts
private bypassed = false;
setBypassed(b: boolean): void { this.bypassed = b; }
isBypassed(): boolean { return this.bypassed; }
latencySamples(): number { return 0; }
```
A `BaseMidiProcessor` abstract class (or mixin) would eliminate ~60 lines of duplication across 12 files. The 12 processors are: Arpeggiator, CCGenerator, ChordGenerator, ChordMemory, EuclideanGenerator, GrooveModule, Harmonizer, Humanizer, MarkovChain, MutationEngine, NoteFilter, NoteRepeater, ScaleQuantizer, Transposer, VelocityProcessor.

### 49.3 Shared LCG constants but different seeds — implicit assumption

`Arpeggiator`, `Humanizer`, and `MarkovChain` all use the same LCG multiplier/increment (`1103515245 + 12345`) but different initial `rngState` values (`0xdead`, `0xcafe`, `0xabcd`). The RNG quality and period depend on the seed — using different seeds without documentation creates an implicit assumption that these are independent streams. A shared seeded-random utility (similar to the one in `helpers/SeededRandom/SeededRandom.ts`) should be used instead of inline LCG implementations.

---

## 50. `AiGeneration/handlers/aiMidi/` — Silent Failures with No User Feedback

**Files:** `src/modules/AiGeneration/handlers/aiMidi/handleStemSeparate.ts`, `handleGenerateAudioAiMidi.ts`, `handleAudioToMidiAiMidi.ts` and others

Multiple AI action handlers use the same silent failure pattern:

```ts
try {
    const result = await doOperation(...);
    // success path
} catch (error) {
    logger.warn(`[Audio AI] Operation failed: ${String(error)}`);
}
```

In `handleStemSeparate` and `handleGenerateAudioAiMidi`, a failure logs a warning but returns `undefined` with no user notification. The `createHandler` wrapper marks these as `undoable: true`, so the undo stack gets an entry for an action that silently produced no effect. This means the user can "undo" an operation that never succeeded — creating an out-of-sync undo history. The correct behavior is either to throw (letting `createHandler` handle the failure) or to call `notifyUser()` with an error message and avoid pushing an undo entry.

---

## 51. Collaboration Module — Base64 Performance and Duplicated Helpers

**Files:** `src/modules/Collaboration/useCases/automergeSync.ts:179–186`, `repositories/peerConnection.ts`, `assetTransfer.ts:236–244`

### 51.1 O(n) string-object allocation in base64 helpers

Both `automergeSync.ts` and `assetTransfer.ts` implement base64 encoding using:
```ts
btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))
```

For a 256 KiB asset chunk (the transfer chunk size), this creates 262,144 single-character string objects, populates an Array of that size, then joins them before passing to `btoa`. This pattern is used in the hot path of every chunk send and every Automerge sync message. The efficient alternative is:
```ts
function bytesToBase64(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
    return btoa(bin);
}
```
Or use `TextDecoder` with ISO-8859-1. The array-allocation approach is the worst option.

### 51.2 `bytesToBase64` / `arrayBufferToBase64` duplicated across two files

`automergeSync.ts:179` and `assetTransfer.ts:236` both implement the same `bytes → base64` function independently. Neither references a shared utility. A single `src/helpers/base64.ts` helper would eliminate both.

### 51.3 `requestAsset` always sends `missingChunks: []` — resume support is dead code

```ts
const msg = {
    type: 'asset.request',
    hash,
    missingChunks: [],   // always empty
};
```
The `AssetControlMessage` type documents `missingChunks` for partial-resume support, but `requestAsset` always passes an empty array, so the remote will always send all chunks. The resume logic in `handleAssetRequest` that reads `missingChunks.length > 0` is therefore unreachable in normal usage.

### 51.4 `peerConnection.ts` — module-level mutable `customIceServers`

```ts
let customIceServers: RTCIceServer[] | null = null;
```
Same class of HMR risk as §14.1, §28.1, §31.1, §35.1, §37.1. Under HMR, this resets to `null` after `setIceServers()` has been called, silently reverting to Google STUN.

---

## 52. GrandBoule — Repeated Track Scan on Every Render and Param Change

**File:** `src/modules/GrandBoule/useCases/resolveGrandBouleEngine.ts`, `presentations/views/GrandBoulePanel.tsx:120`

### 52.1 `resolveGrandBouleEngine` called on every render — O(n) track scan per frame

```tsx
// GrandBoulePanel.tsx:120
const engine: ResolvedGrandBouleEngine = resolveGrandBouleEngine({ deviceId });
```

`resolveGrandBouleEngine` calls `getAllTracks().find(t => t.devices.some(d => d.id === input.deviceId))` plus `ensureTrackStrip()` — a linear scan of all tracks on every render of the panel. Since the `GrandBoulePanel` subscribes to `grandBouleStore`, any parameter change that writes to the store triggers a re-render and thus a fresh track scan. For a project with 20+ tracks, this is 20+ device-list comparisons per store write. The engine reference should be `useMemo`-d or resolved once at mount.

The same `getAllTracks().find(...)` pattern is also called per-invocation in individual parameter setters (`setGrandBouleTemperament`, `setGrandBouleMasterGain`, etc.), compounding the cost.

### 52.2 `clamp` utility redefined locally

`calibrateGrandBouleMidi/helpers.ts:3` defines:
```ts
export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
```
The identical function exists at `#/helpers/Math/clamp` (imported by `AppShell.tsx` and others). Yet another local re-definition of a shared helper.

### 52.3 8 single-liner files in `calibrateGrandBouleMidi/`

All 8 files follow the identical pattern:
```ts
export const setX = (value: number): void => {
    const r = MIDI_CALIBRATION_RANGES.x;
    updateCalibration({ x: clamp(value, r.min, r.max) });
};
```
The entire directory could be replaced with a single `setMidiCalibrationParam(key, value)` function (the same recommendation as §18.1, §46.1, §9.2).

---

## 53. `createFindDeviceRef` — 7th Copy in `ProofChamber`

**File:** `src/modules/ProofChamber/useCases/proofChamberParamBridge.ts:10`

Finding §33.1 documented `createFindDeviceRef` duplicated in 6 plugin bridge helpers. `ProofChamber` (Dutch Oven) contains a 7th copy, bringing the total to **7 files** with verbatim copies of this 8-line helper:

- `Bacteria/useCases/bacteriaParamBridge/helpers.ts`
- `Crust/useCases/crustParamBridge/helpers.ts`
- `Fermenter/useCases/fermenterParamBridge/helpers.ts`
- `Gluten/useCases/glutenParamBridge/helpers.ts`
- `Grinder/useCases/grinderParamBridge/helpers.ts`
- `Toaster/useCases/toasterParamBridge/helpers.ts`
- `ProofChamber/useCases/proofChamberParamBridge.ts`

---

## 54. `builtinSynth.ts` — Per-Note Noise Buffer Allocation and Duplicated Envelope Code

**File:** `src/modules/Synth/useCases/builtinSynth.ts`

### 54.1 Noise buffer allocated fresh for every note

```ts
// scheduleNote lines 166–181
const noiseBuffer = new AudioBuffer({ numberOfChannels: 1, length: noiseLen, sampleRate: ctx.sampleRate });
const data = noiseBuffer.getChannelData(0);
for (let i = 0; i < noiseLen; i++) {
    data[i] = Math.random() * 2 - 1;
}
noiseSource = ctx.createBufferSource();
noiseSource.buffer = noiseBuffer;
```

`AudioBuffer` allocation + `Float32Array` fill (≈4 800 samples at 48 kHz × 0.1 s) runs on **every note** that has `noiseLevel > 0`. Since the buffer is filled with pseudo-random noise, any pre-computed buffer is perceptually equivalent. A module-level cached noise buffer (or lazily computed once per `AudioContext`) would eliminate all this work from the note-scheduling hot path.

### 54.2 Envelope logic duplicated between `scheduleNote` and `scheduleNoteOffline`

Both functions compute the identical ADSR envelope math (velAttack, peakGain, sustainLevel, attackEnd, decayEnd, releaseStart, releaseEnd, and the gain automation lines). `scheduleNoteOffline` is described as a "lightweight" version that skips osc2/sub/noise/vibrato — but it copies the envelope logic verbatim. If the ADSR behaviour changes in one function, the other diverges silently. A shared `applyEnvelope(env, params, ...)` helper would fix both.

### 54.3 Double type assertion bypasses type safety

```ts
(result as unknown as Record<string, number>)[key] = raw; // line 330
```
The `unknown` bridge defeats TypeScript's structural checks. A typed overwrite function or a discriminated approach would be safer.

### 54.4 `Auto-Pan` Faust DSP — `shape` parameter defined but not exposed

`proModulationEffects.ts:183` defines `shape = hslider("shape", 0, 0, 1, 0.01)` in the Faust DSP code, but the corresponding params array (lines 189–216) does not include a `shape` entry. The DSP compiles and runs with `shape = 0` always. The parameter is inaccessible from the UI, making the waveform option (sine vs. triangle) effectively hardcoded while appearing to be a feature.

---

## 55. `evaluateFollowActions` — Array Allocations per Tick and Silent Last-Writer-Wins

**File:** `src/modules/Transport/useCases/evaluateFollowActions.ts`

### 55.1 Per-clip array allocations in scheduler tick

`evaluateFollowActions` is called on every scheduler tick. For clips with follow actions, it allocates and sorts new arrays:
```ts
// play_next: lines 34-35
const nextClips = track.clips.filter(...); // new array
nextClips.sort(...);                        // in-place sort on allocated array

// play_first: lines 46-47
const firstClip = [...track.clips].sort(...)[0]; // spread + sort
```
These allocate on every follow-action trigger. Since this function runs in the scheduler hot path, it should avoid allocation. Pre-sorting clips by `startBeat` at track-load time would reduce all cases to O(1) binary-search lookups.

### 55.2 Multiple simultaneous follow actions — last writer wins silently

If two clips on different tracks both have follow actions triggered in the same tick, the loop overwrites `jumpToPosition` with successive values. Only the last track's clip determines the jump destination; all other clips' follow actions are silently discarded. This is a functional bug for multi-track follow action setups.

### 55.3 Non-reproducible random follow action

`play_random` uses `Math.random()` — no seed, non-reproducible. The scheduler cannot replay a session identically if `play_random` clips are involved.

---

## 56. `SampleLibrary` — Scan Logic Duplication, Module-Level Mutable Export, and Broken Progress

**Files:** `src/modules/SampleLibrary/useCases/connectFolder/helpers.ts`, `connectFolder.ts`

### 56.1 `scanBrowserDirectory` and `scanTauriDirectory` — ~50 lines duplicated

Both functions implement the identical scan lifecycle:
```ts
scanAbortController = new AbortController();
setScanProgress(true, 0);
// ... directory traversal (only part that differs) ...
if (batch.length > 0) addSamples([...batch]);
updateLibraryRootStatus(root.id, 'ready', totalFound);
buildFolderTree(root.id);
await persistLibraryRoots();
await persistSamples();
// finally:
setScanProgress(false, 1);
scanAbortController = null;
```
A shared `runScan(root, traversal: AsyncIterable<Entry>)` function would collapse both to a one-liner.

### 56.2 `export let scanAbortController` — mutable module export breaks encapsulation

```ts
export let scanAbortController: AbortController | null = null; // line 6
```
Exporting a `let` binding makes the module variable reassignable from any importing module. TypeScript won't catch `scanAbortController = something` in another file. The same HMR risk applies as §14.1 (resets to `null` on hot reload). Should be an internal variable exposed via a `cancelScan()` function.

### 56.3 Progress estimate formula never exceeds 50%

```ts
setScanProgress(true, totalFound / Math.max(totalFound + 100, 1)); // line 73
```
When `totalFound = N`, the formula gives `N / (N + 100)` — which asymptotically approaches 1 but never gets above 50% when `N < 100` (50 files = 50/150 = 0.33). The progress bar will stall at ≤50% until the `finally` block sets it to 1, creating a visual jump.

### 56.4 Library root ID generated twice identically

`connectFolderBrowser` (line 16) and `connectFolderTauri` (line 50) both produce:
```ts
const id = `lib-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
```
The expression is identical and should be extracted to a shared `generateLibraryRootId()` helper.

---

## 57. `Sampler` — rAF-Batching Pattern Duplicated, Namespace Imports, Blind `as` Casts

**Files:** `samplerParamBridge/setSamplerParamThrottled.ts`, `repositories/samplerBridge.ts`

### 57.1 rAF-batching Maps pattern — now 5th copy

`setSamplerParamThrottled.ts` maintains module-level `pending` and `latest` Maps with rAF-based flushing:
```ts
const pending = new Map<string, number>();
const latest = new Map<string, { param: string; value: number }>();
```
This is the same pattern documented in §33.2 (4 plugin bridge modules). The Sampler implementation is a 5th copy. Both Maps share the same HMR reset risk as §14.1 — pending rAF callbacks become stale on hot reload, and param values queued between reloads are silently dropped.

### 57.2 `setSamplerParamThrottled` vs `setSamplerParamImmediate` — inconsistent `instanceId` sourcing

`setSamplerParamThrottled(instanceId, param, value)` accepts `instanceId` from the caller. `setSamplerParamImmediate(param, value)` reads it from `samplerStore`. These two functions behave differently if the caller passes an `instanceId` that differs from the store value — the throttled version targets the passed instance, the immediate version targets whatever the store currently holds.

### 57.3 `samplerBridge.ts` — blind `as T` casts on untyped IPC results

```ts
return result as SamplerLoadResult;
return result as OnsetDetectionResult;
return result as LoopPointDetectionResult | null;
```
`tauriInvoke` returns `unknown`. Every bridge function casts the return value directly without runtime validation. If the Rust backend returns a different shape (version mismatch, schema drift), the frontend receives a silently malformed object and crashes downstream with unhelpful errors. Same pattern as §5.1.

---

## 58. `Plugin/useCases/faustEngine/compilerEngine.ts` — Module-Level Singletons and `console.error` Calls

**File:** `src/modules/Plugin/useCases/faustEngine/compilerEngine.ts`

### 58.1 5 module-level mutable singletons

```ts
const modules = new Map<string, FaustModule>();              // line 29
const compilationPromises = new Map<string, Promise<...>>(); // line 32
let compilerPromise: Promise<...> | null = null;             // line 43
let compilerReady = false;                                   // line 44
let compilerError: string | null = null;                     // line 46
```
All five are HMR-reset risks (same class as §14.1). Under Vite HMR:
- `modules` resets → all registered Faust DSPs must re-register from scratch
- `compilationPromises` resets → in-flight compilations (which can take 5–10s for the 15MB compiler) are orphaned
- `compilerPromise` resets → the next call to `getCompiler()` re-downloads the 15MB Faust WASM module

### 58.2 7 `console.error` calls bypass `logger`

Lines 64, 120, 141, 150, 182, 235, 242 — all use `console.error` directly. Same as §23.3.

### 58.3 Side-effect module initializer at line 269

```ts
registerPluginLoader('faust.', async (pluginId, context) => { ... });
```
This side effect fires when `compilerEngine.ts` is first imported. The comment acknowledges this is intentional ("Side-effect at module load is required"), but it means importing this module for testing requires mocking the registry, and import order determines whether the loader is registered before or after other loaders.

---

## 59. `compileDso.ts` — Duplicated Type Unions Now Out of Sync

**File:** `src/modules/AiRuntime/useCases/dsoEditor/compileDso.ts:28–75`

Finding §11.2 documented 5 union types re-declared in `compileDso.ts` to avoid a circular dependency. On closer inspection, these local copies have **diverged** from the originals in `AiGeneration`:

| Type | `AiGeneration` count | `compileDso.ts` count | Extra variants |
|---|---|---|---|
| `DrumPatternStyle` | 8 | 16 | blues, reggae, lofi, house, techno, synthwave, afrobeat, metal, punk |
| `ScaleType` | 7 | 14 | lydian, phrygian, locrian, harmonic-minor, melodic-minor, whole-tone, chromatic |

This means if an LLM-generated action specifies `style: 'techno'` for a drum pattern, the DSO compiler's `compileDso` branch accepts it (since `'techno'` is in its local `DrumPatternStyle`), but the `handleGenerateDrumPattern` handler will coerce it to `'rock'` (since `VALID_DRUM_STYLES` in `generationHandlerHelpers.ts` doesn't include `'techno'`). The DSO path and the direct action path now have silent, inconsistent validation.

---

## 60. `promptInjection.ts` — Module-Level Listener Array Re-Implements Event Bus

**File:** `src/modules/AiRuntime/useCases/promptInjection.ts`

### 60.1 Module-level mutable listener array — HMR risk

```ts
let injectionListeners: Array<(text: string) => void> = [];
```
On HMR, this resets to `[]`. Components that subscribed via `onPromptInjection(cb)` will have registered their callback in the old module instance — the new module instance has no listeners. `injectPromptCommand` becomes a silent no-op until all subscribing components re-mount (which doesn't happen automatically on HMR). Same class as §14.1.

### 60.2 Re-implements event bus functionality locally

`promptInjection.ts` is a hand-rolled 26-line event bus. The project already has a DI-injected `eventBus` with `on`/`emit` semantics. This file exists because the injection system can't be used directly here (cross-module circular risk), but a new named event `'ai.injectPrompt'` on the existing bus would achieve the same result without the new module-level state.

---

## 61. WAM Plugin Host — `loadWAMPlugin` Returns Mismatched ID and Instance

**File:** `src/modules/Plugin/useCases/wamPluginHost/hostOperations/loadWAMPlugin.ts`

### 61.1 Instance ID generated but not returned

```ts
const instanceId = `${pluginId}-${crypto.randomUUID().slice(0, 8)}`;
instances.set(instanceId, instance);
return instance; // ID not returned
```
`loadWAMPlugin` generates an `instanceId`, stores the instance in `instances` by that ID, but returns only the instance — not the ID. Callers cannot look up or reference the instance later (e.g., to unload it). `unloadWAMPlugin` presumably needs an ID to remove from the map, but there's no way to get it from the return value of `loadWAMPlugin`.

### 61.2 `HighEndPluginProcessor` falls back to passthrough GainNode

```ts
node = new AudioWorkletNode(context, 'HighEndPluginProcessor', {...});
// catch: falls back to context.createGain()
```
If `HighEndPluginProcessor` is not registered (which appears to be the common case), the load silently returns an identity GainNode with `initialized: true`. The caller receives an "initialized" instance that is actually a no-op passthrough — no error is thrown or surfaced.

### 61.3 Two `console.warn` calls bypass `logger`

Lines 12 and 24 use `console.warn` directly (same as §23.3).

---

## §62 — `sequencerPlayback.ts` (Toaster)

### 62.1 Five module-level mutable vars — HMR risk

```ts
let running = false;
let fillActive = false;
let playCount = 0;
let nextTickTime = 0;
let timeoutId: ReturnType<typeof setTimeout> | null = null;
```

Same pattern as §14.1, §28.1, §31.1, §35.1, §37.1, §45.1, §47.2, §51.4, §56.2, §57.1, §58.1. HMR resets these silently; a hot-reload mid-playback orphans the running `setTimeout` chain.

### 62.2 `morphPatterns` allocates every tick even at t=0 or t=1

```ts
if (state.morph.enabled && state.morph.targetPatternId) {
    pattern = morphPatterns(sourcePattern, targetPattern, state.morph.position);
}
```

`morphPatterns` creates a full `Pattern` clone (including new `tracks` array and `steps` array per track) every tick. When `t=0` or `t=1` the morph is identical to one of the inputs, but the allocation still happens. For a 16-pad × 64-step kit this is ~1024 `Step` object allocations per tick.

### 62.3 `getFirstToasterDeviceId()` called per tick

`getFirstToasterDeviceId()` scans `getAllTracks()` on every tick to find the device ID. Result should be cached and invalidated only on track change.

---

## §63 — `modulatorLibrary.ts` (Plugin)

### 63.1 Entire modulation system is dead code — no audio engine connection

The file header acknowledges the issue explicitly:

> TODO: DATA MODEL ONLY — no Web Audio engine connection exists yet.
> `createFromPreset()` writes a `ModulationSource` into an in-memory Map
> (`modulationSystem.ts`), but that Map has no `AudioParam.setValueAtTime()` calls,
> no `requestAnimationFrame` loop, and no connection to any AudioNode.
> `getModulatedValue()` math exists but is never invoked during playback.

Any UI showing modulation controls (LFO/envelope/random presets) is displaying non-functional parameters. This is a **feature that appears to work but silently does nothing**.

---

## §64 — `polyphonicAudioToMidi.ts` (AudioAnalysis)

### 64.1 Model URL hardcoded into `node_modules` path — fragile in production builds

```ts
const modelUrl = new URL(
    '../../../node_modules/@spotify/basic-pitch/model/model.json',
    import.meta.url
).href;
```

Vite does not copy arbitrary `node_modules` assets to the dist output. This path will resolve correctly in dev (same server), but break in production builds where the model JSON is not emitted. The correct approach is to import the asset via Vite's `?url` query so it is bundled properly.

### 64.2 Module-level `basicPitchModel` singleton — HMR risk

```ts
let basicPitchModel: BasicPitch | null = null;
```

HMR resets this to `null`; the 10 MB model must be re-downloaded on every hot reload that touches this file.

---

## §65 — `audioToMidi.ts` (AudioAnalysis)

### 65.1 `Math.max(...onsets.map(...))` spread on potentially large array

```ts
const maxAmplitude = Math.max(...onsets.map((o) => o.amplitude), 1e-8);
```

`onsets` can be thousands of items on long audio files. The spread forces the JS engine to allocate a temporary array and pass all elements as positional arguments, which overflows the call stack for very long files. A `for…of` loop accumulation is O(n) without allocation.

---

## §66 — `mixHealthAnalysis.ts` (AudioAnalysis)

### 66.1 `c: any` cast on clip array

```ts
const audioClip = track.clips.find((c: any) => c.type === 'audio' && c.audioBufferId);
```

The clip type is known — this cast bypasses the discriminated union and silences the type checker. Any future rename of `audioBufferId` or `type` goes undetected.

### 66.2 Typo in AI prompt string

```ts
trackSummary += `  - Brigthness: ${features.avgSpectralCentroid.toFixed(0)} Hz\\n`;
```

"Brigthness" should be "Brightness". The typo is baked into the LLM context and will appear in AI responses.

---

## §67 — `pitchDetection.ts` / `engineLifecycle.ts` / `nativeEngine/lifecycle.ts`

### 67.1 `NOTE_NAMES` — 9th copy (§43.1 was 8)

`pitchDetection.ts:36` defines:
```ts
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
```
This is the 9th independent declaration of this constant across the codebase.

### 67.2 `engineLifecycle.ts` — 4 module-level mutable singletons — HMR risk

```ts
let engine: WebLlmEngine | null = null;
let initPromise: Promise<WebLlmEngine> | null = null;
let engineWorker: Worker | null = null;
let activeModelId: string = DEFAULT_WEBLLM_MODEL_ID;
```

HMR resets these; in-flight 6+ GB model downloads (WebLLM models are large) are orphaned — the Worker is still running but `engine`/`initPromise` are null. The next call to `initWebLlmEngine` starts a second download.

### 67.3 `engineLifecycle.ts` — double cast bypasses type safety

```ts
engine = created as unknown as WebLlmEngine;
```

The `as unknown as T` double cast is used because `CreateWebWorkerMLCEngine` returns the real WebLLM engine type, but the local `WebLlmEngine` narrowing type is not compatible. The correct fix is to use the imported type from `@mlc-ai/web-llm` directly.

### 67.4 `nativeEngine/lifecycle.ts` — `nativeEngineReady` module-level mutable — HMR risk

```ts
let nativeEngineReady = false;
```

Same HMR pattern. Any feature-flag check via `isNativeEngineReady()` returns `false` after a hot reload even if the native engine was successfully started.

---

## §68 — `storeRegistry.ts` (infra)

### 68.1 Acknowledged dead code retained to "avoid file deletion"

```ts
// Legacy file — no longer used by createStore.
// Kept to avoid file deletion; will be removed when cleanup is done.
export const storeRegistry = new WeakMap<object, object>();
```

The comment itself says this file is unused and should be deleted. Keeping it adds cognitive overhead for anyone reading the infra layer. The concern about "avoid file deletion" is not a valid reason to retain unused code.

---

## §69 — `SoundLibrary` — `findSimilarSamples` / `getFilteredSamples`

### 69.1 `findSimilarSamples` — O(n) Set allocation per sample comparison

```ts
const overlap = [...targetTags].filter((t) => sampleTags.has(t)).length;
const total = new Set([...targetTags, ...sampleTags]).size || 1;
```

`new Set([...a, ...b])` allocates a new Set for every sample being compared. For a library with 10k samples, this is 10k Set allocations per call. `overlap` can be computed by iterating `targetTags` and counting `.has()` hits; `total` = `targetTags.size + sampleTags.size - overlap`.

### 69.2 `getFilteredSamples` — full pipeline recomputed on every call, no memoization

`getFilteredSamples()` clones the samples array (`[...state.samples]`), runs multiple `filter` passes, evaluates `AUTO_TAG_RULES.filter(...).flatMap(...)` on every call for category filtering, and runs `.sort()` each time. This is called on every keypress in the search box with no debounce or selector. The result should be derived via a memoized selector keyed to the store state.

---

## §70 — `audioFeatures.ts` (AudioAnalysis)

### 70.1 `data.slice()` allocates a new `Float32Array` per analysis frame

```ts
const window = data.slice(offset, offset + bufferSize);
const features = Meyda.extract([...], window);
```

`Float32Array.slice()` copies the data. For a 3-minute clip at 44.1kHz with a 512-sample hop, this is ~17,000 allocations per call. `Float32Array.subarray(offset, offset + bufferSize)` returns a zero-copy view into the same backing buffer and should be used here instead (Meyda reads the values, it does not mutate the view).

### 70.2 `Meyda.sampleRate` / `Meyda.bufferSize` — global state mutation

```ts
Meyda.sampleRate = buffer.sampleRate;
Meyda.bufferSize = bufferSize;
```

Meyda's API is globally stateful. If `extractFeatures` is ever called concurrently (or from two clips in quick succession), the global config set by one call is trampled by the other. This is safe today because calls are sequential, but fragile.

### 70.3 `Math.max(...frames.map(...))` — spread on large array

```ts
const peakRms = Math.max(...frames.map((f) => f.rms));
```

Same issue as §65.1 — spread of a potentially large `frames` array. For a 3-minute clip, `frames.length` is ~17,000.

---

## §71 — `automergeRepository.ts` (CrdtDocument)

### 71.1 4 `console.warn/error` calls bypass `logger` abstraction

Lines 228, 272, 311, 377 use `console.warn` and `console.error` directly instead of going through the `logger` service (§23.3 pattern).

### 71.2 Throwaway doc allocated just to get an actor ID

```ts
private actorId: string = Automerge.getActorId(Automerge.init()).toString();
```

`Automerge.init()` creates a full WASM-backed document that is immediately discarded. Automerge provides `Automerge.uuid()` or a direct UUID generator for actor IDs without allocating a document.

### 71.3 `invokeWorker` has no worker-crash listener — promise leaks on crash

```ts
worker.addEventListener('message', handler);
worker.postMessage({ ...msg, id });
```

If the worker crashes (uncaught exception, OOM, WASM fault), the `message` listener is never triggered and the returned `Promise` hangs forever. Callers `await`ing the promise will stall indefinitely. A `worker.addEventListener('error', ...)` cleanup path is missing.

---

## §73 — `registerDependencies.ts` — AppEvents grows per plugin

```ts
'panel.showFermenter': ShowDevicePanelPayload;
'panel.showToaster': ShowDevicePanelPayload;
'panel.showLevain': ShowDevicePanelPayload;
// ... 11 more entries ...
```

`AppEvents` has 14 per-plugin `panel.show*` event keys, all with identical payload shapes (`ShowDevicePanelPayload`). Each new plugin requires modifying three places in lockstep: `AppEvents` here, a `useEffect` in `AppShell.tsx` (§47.1), and a `useState` in `AppShell.tsx`. A single generic `'panel.showDevice'` event carrying the device type would eliminate all three per-plugin additions.

---

## §74 — `buildTimelineRenderModel.ts` (Arrangement)

### 74.1 Seven module-level mutable vars — HMR risk

```ts
let cachedModel: TimelineRenderModel | null = null;
let lastTrackState: unknown = null;
// ... 5 more
```

Same HMR risk as §14.1 / §28.1. On hot reload the cache is reset; the first render call after HMR rebuilds the full model (acceptable), but if any in-flight render is holding a reference to `cachedModel`, it will see a stale value.

### 74.2 Recording path rebuilds all tracks every render frame

```ts
const recTracks = cachedModel!.tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) =>
        recIds.has(clip.id) ? { ...clip, endBeat: ... } : clip
    ),
}));
```

This clones every track and every clip in the model on every animation frame while recording is active, even if only one clip is growing. The canvas renderer calls `buildTimelineRenderModel()` on every rAF tick. At 60 fps with 30 tracks × 20 clips = 600 object allocations per frame from this path alone.

### 74.3 Drag-preview path builds a full clip lookup Map per render

```ts
const clipById = new Map<string, CachedClip>();
for (const track of cachedModel!.tracks) {
    for (const clip of track.clips) {
        clipById.set(clip.id, clip);
    }
}
```

A new `Map` is built and populated on every render call while a drag preview is active. This should be pre-built and invalidated only when `dataDirty` is true.

---

## §75 — `Workspace/useCases/panels/devicePanels/` — 28 per-plugin single-liner files

The directory contains 28 files total:
- 14 `show*Panel.ts` files — each wraps a single `eventBus.emit('panel.show{Name}', { deviceId })` call
- 14 `onPanelShow*.ts` files — each wraps a single `eventBus.on('panel.show{Name}', handler)` call

Every plugin adds two more files to this directory. All 28 are structurally identical:

```ts
// showFermenterPanel.ts
export const showFermenterPanel = inject({ eventBus })(
    ({ eventBus }) => (function showFermenterPanel(deviceId: string | null): void {
        eventBus.emit('panel.showFermenter', { deviceId });
    })
);
```

A single `showDevicePanel(pluginType: DevicePluginType, deviceId: string | null)` and `onPanelShowDevice(type, handler)` pair would replace all 28 files, and in combination with §73.1 would collapse the 14 `AppEvents` entries to one.

---

## §76 — `shortcutEngine.ts` (Workspace)

### 76.1 `Object.entries(state.bindings)` allocated on every `keydown` event

```ts
for (const [action, binding] of Object.entries(state.bindings)) {
```

`Object.entries()` allocates a new array of `[key, value]` tuples on every `keydown` event globally. The shortcut engine should pre-compile `state.bindings` into a lookup `Map` and refresh it only when `shortcutStore` changes, not on every keypress.

### 76.2 `shortcutStore.value` read on every keydown

The store read is fast (O(1)) but the pattern means any key pressed anywhere in the app (including during text input) still reads the store — only short-circuited by the `tagName` check on line 101.

---

## §77 — `importAudioFile.ts` (Arrangement)

### 77.1 `structuredClone(trackStore.value)` deep-clones entire track store twice for undo

```ts
const trackSnapshotBefore = structuredClone(trackStore.value);
// ... add track + clip ...
const trackSnapshotAfter = structuredClone(trackStore.value);
```

`structuredClone` of the full track store (which could contain 100s of tracks, each with multiple clips) blocks the main thread. The undo entry stores two full snapshots of all track data per audio import. All other undo entries use CRDT-level change deltas; this one bypasses CRDT and snapshots raw store state — inconsistent with the rest of the undo system.

---

## §78 — `trackTemplate.ts` / `soundPresetLibrary.ts` (Arrangement)

### 78.1 Module-level caches — HMR risk + mutable aliasing

`trackTemplate.ts` line 9:
```ts
let templateCache: TrackTemplate[] | null = null;
```

`soundPresetLibrary.ts` lines 5-6:
```ts
let cachedPresets: SoundPreset[] | null = null;
let cachedPlatformKey: string | null = null;
```

Both are module-level mutable singletons (§14.1 pattern). Additionally, `trackTemplate.ts` line 38 mutates the cached array in place via `templates.push(template)`, then reassigns `templateCache = templates` (no-op since same reference). Callers holding the returned array reference from `getTrackTemplates()` see unexpected mutations.

---

## §79 — `resolveComping.ts` (Arrangement)

### 79.1 Indentation broken at function body start

```ts
export function resolveClipsWithComping(trackId: string, clips: Clip[]): ResolvedClip[] {
const laneState = takeLaneStore.value;   // ← column 0, not indented
```

The function body starts at column 0. This is a formatting artifact but indicates the code was edited outside normal formatting tooling.

### 79.2 `[...lane.activeCompRegions].sort(...)` allocates on every call

```ts
const sortedRegions = [...lane.activeCompRegions].sort((a, b) => a.startBeat - b.startBeat);
```

This spreads and sorts the active comp regions array on every call. If `resolveClipsWithComping` is called from a render path (likely — it produces the visible clips for the timeline), it should sort once and cache the result keyed to `activeCompRegions` identity.

---

## §80 — `messageHandlers.ts` (AudioEngine/webMidi)

### 80.1 `handleNoteOn` is a 200-line per-plugin dispatch chain

`handleNoteOn` contains sequential `instrumentTrack?.devices.find(d => d.type === 'fermenter')`, `find('toaster')`, `find('grand-boule')`, `find('levain')` blocks — 4 separate `Array.find` scans on `instrumentTrack.devices` per MIDI note. The same dispatch runs again inside the Yeast path (lines 295–338), totalling up to 8 `.find()` calls per note event. Every new instrument plugin requires inserting a new `if (pluginDev)` block here, in `handleNoteOff`, and in the Yeast inner loop.

### 80.2 `levainDeviceId` mutated onto `ActiveNoteData` via cast — not in the declared type

```ts
(noteData as Record<string, unknown>).levainDeviceId = levainDev.id;
```

Line 392 sets a property that is not declared in `ActiveNoteData`. Line 163 reads it back with a different cast: `(noteData as { levainDeviceId?: string }).levainDeviceId`. This pattern silently bypasses the type system and indicates `ActiveNoteData` was never extended to include Levain's device ID.

### 80.3 `getSynthParamsForTrack(targetTrackId).detune` — unchecked access

```ts
const baseDetune = targetTrackId ? deps.getSynthParamsForTrack(targetTrackId).detune : 0;
```

Lines 541 and 548: `getSynthParamsForTrack` may return `null` if the track has no synth params, but `.detune` is accessed without an optional chain. This throws a `TypeError` at runtime for tracks without synth params during pitch bend messages.

### 80.4 `trackState.tracks.filter(t => t.parentId === parent.id)` — O(n) scan per noteOn

Lines 133 and 280: finding child tracks of a Toaster parent track scans all tracks twice per MIDI note (once in `handleNoteOn`, once in `handleNoteOff`). Should be pre-indexed.

### 80.5 `console.warn` bypasses `logger`

Line 249 uses `console.warn` directly (§23.3 pattern).

---

## §81 — MIDI use-case passthrough wrappers

`MIDI/useCases/transposeForChordTrack.ts` and `MIDI/useCases/formatChordName.ts` are each 5-line files that do nothing but call the same-named function one level down:

```ts
// formatChordName.ts
export function formatChordName(event: ChordEvent): string {
    return formatChordNameModel(event);
}
```

Same pattern as §19.1 (AudioEngine encoder passthroughs). These add a module indirection layer with zero value. Similarly, `AudioEngine/useCases/webMidiInput/initWebMidi.ts` uses `...args` spread just to forward to the real implementation.

---

## §82 — `arpeggiator.ts` (MIDI)

### 82.1 `Math.min/max(...notes.map(...))` spread on large array

```ts
const minBeat = Math.min(...notes.map((n) => n.startBeat));
const maxBeat = Math.max(...notes.map((n) => n.startBeat + n.duration));
```

Same issue as §65.1 — stack overflow risk on clips with many notes.

### 82.2 `random` pattern uses `Math.random()` — non-deterministic

```ts
const j = Math.floor(Math.random() * (i + 1));
```

Same issue as §55.3 — unseeded RNG means the same arpeggio renders differently every time. Should use a seeded RNG for deterministic playback.

---

## §83 — `RoutingMatrix.tsx` / `SessionView.tsx` — UI-only state, `Map` as React state

### 83.1 Routing connections never persisted — closes and loses all routes

`RoutingMatrix.tsx` line 20:
```ts
const [connections, setConnections] = useState<Map<string, RoutingConnection>>(new Map());
```

All routing connections are stored in local React state. Closing and reopening the Routing Matrix panel silently discards all routes. There is no store, no action, no undo entry. The panel appears to configure audio routing but produces no lasting effect.

### 83.2 Session launch state also local-only — panel close resets clip states

`SessionView.tsx` line 22:
```ts
const [activeSlots, setActiveSlots] = useState<Map<string, number>>(new Map());
```

Same issue — launching clips updates local state only. The session view is an in-progress UI mockup.

### 83.3 `Map` as React state — anti-pattern

Both `RoutingMatrix` and `SessionView` use `Map` as React state. While the code correctly clones the Map before mutating (`new Map(prev)`), `Map` identity is a weaker signal than React's object reference comparison. React DevTools, Strict Mode double-render checks, and serialization/hydration all assume plain objects/arrays as state.

### 83.4 `getClipForSlot` calls `tracks.find()` per rendered slot

`SessionView.tsx`:
```ts
const getClipForSlot = (trackId: string, sceneIndex: number): string | null => {
    const track = tracks.find((t: Track) => t.id === trackId);
    ...
    const clipArray = Object.values(track.clips) as Array<{ id: string }>;
    return clipArray[sceneIndex]?.id ?? null;
};
```

Called for each of (tracks.length × SCENE_COUNT) slots during render. With 10 tracks × 8 scenes = 80 `Array.find()` calls per render. Should pre-build a `Map<trackId, Track>` once.

---

## §84 — `generateMidiAI.ts` (AudioEngine/nativeAiBridge) — duplicate local types

```ts
export type MidiGenerationNote = { pitch: number; velocity: number; start_beat: number; duration_beats: number; };
export type MidiGenerationResult = { notes: MidiGenerationNote[]; model_used: ...; generation_time_ms: ...; };
```

The local `MidiGenerationResult` type re-declares `MidiGenerationNote` fields instead of re-using the native bridge type. The function itself is another passthrough wrapper (`...args` spread, §81.1 pattern). The local type and the native `MidiGenerationResult` can silently diverge.

---

## §85 — `undoStore.ts` (Command)

### 85.1 Dynamic `import()` called on every `pushUndo` — Promise overhead per undo entry

```ts
import('../useCases/undoTree/recordToTree').then(({ recordToTree }) => {
    recordToTree(entry);
});
```

`import()` is called every time an action is pushed to the undo stack. While the module loader caches the resolved module (subsequent calls are synchronous cache hits), each call still allocates a Promise and schedules a microtask. `recordToTree` should be imported statically and called synchronously, guarded by the `enabled` flag inside `recordToTree` itself.

### 85.2 `JSON.stringify(trimmed)` serializes full undo stack on every push

```ts
sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(trimmed));
```

The entire undo stack (up to 100 entries) is JSON-stringified and written to `sessionStorage` on every `pushUndo` call. If undo entries carry action payloads (track IDs, clip IDs, parameter maps), this can be large and slow.

---

## §86 — `automationShapes.ts` (Automation)

### 86.1 `points.pop()` mutates the return value of `generateShapePoints`

```ts
const points = generateShapePoints(...);
if (c < cycles - 1) {
    points.pop();  // mutates the returned array
}
allPoints.push(...points);
```

`generateShapePoints` returns an array; the caller pops from it before use. If the function ever returns a frozen or shared array, this throws. More generally, mutating a return value is a code smell — the caller should slice instead.

### 86.2 `allPoints.push(...points)` spread grows per cycle

For many cycles, `push(...largeArray)` may hit call-stack limits (same as §65.1). Should use `Array.prototype.push.apply(allPoints, points)` or `allPoints.push(...points)` only when `points.length` is bounded.

---

## §87 — `createWebAudioEngine.ts` (AudioEngine)

### 87.1 `getSendsForTrack` lambda runs `Array.from + filter` on every invocation

```ts
getSendsForTrack: (tId) =>
    Array.from(this.sendNodes.values()).filter((s) => s.sourceTrackId === tId),
```

This lambda is stored in `TrackNode` and called whenever the node needs its sends. `Array.from(this.sendNodes.values())` allocates a new array and `.filter()` allocates another — O(n sends) on every call. Send nodes should be indexed by source track ID so lookup is O(1).

### 87.2 Hardcoded absolute worklet paths — no compile-time safety

```ts
await this.context.audioWorklet.addModule('/audio/worklets/sidechain-compressor-processor.js');
await this.context.audioWorklet.addModule('/audio/worklets/native-plugin-host-processor.js');
await this.context.audioWorklet.addModule('/audio/worklets/native-plugin-bridge-processor.js');
```

Absolute URL strings bypass Vite's asset graph. If these files are moved or renamed, the error only appears at runtime. The recording processor (line 64) is correctly imported via `?worker&url`; these three should follow the same pattern.

### 87.3 `Set<Promise<any>>` — `any` in private field type

Line 20: `private pendingDevicePromises = new Set<Promise<any>>()`. The `any` type suppresses type errors on anything stored in this set.

---

## §88 — `TrackNode.ts` (AudioEngine)

### 88.1 Dead code: second `find` guard immediately after `some` guard

```ts
if (this.strip.deviceNodes.some((d) => d.deviceId === deviceId)) {
    return;                                      // ← returns if found
}
if (this.strip.deviceNodes.find((n) => n.deviceId === deviceId)) {
    logger.warn(`Device ${deviceId} already exists...`);  // ← unreachable
    return;
}
```

Lines 190–197: the second guard (`find`) can never be truthy because we already returned at line 191 when any match exists. The `logger.warn` on line 195 is dead code.

### 88.2 `grandBouleControls` not cleaned up in `removeDevice`

`removeDevice` (lines 338–349) calls `.destroy()` on `fermenterControls`, `toasterControls`, and `levainControls`, but does not call `grandBouleControls?.destroy()` (if that method exists) or any other cleanup. If GrandBoule holds AudioWorklet resources or WebGL state, they leak on track removal.

### 88.3 Concurrent `rebuildChain()` calls during async device loading

Each async `.then()` callback for Faust/native bridge devices calls `this.rebuildChain()` when it resolves. Since `addDevice` calls `rebuildChain()` synchronously at line 330, and the async resolve calls it again later, concurrent plugin loads produce multiple `rebuildChain()` calls that each disconnect and reconnect the full audio graph. This creates audio glitches and potentially incorrect routing if two loads resolve at the same millisecond.

### 88.4 `dn.nodes[0] as AudioWorkletNode` — blind cast in 4 locations

Lines 281, 374, 383 (and one in `rebuildChain`): `dn.nodes[0] as AudioWorkletNode` is used without checking `instanceof AudioWorkletNode`. If the node is a `GainNode` (the placeholder), `.parameters.get(...)` returns `undefined` and the param update is silently dropped.

---

## §89 — `permissions.ts` (Collaboration)

### 89.1 Security: permission host-check relies on mutable local store — bypassable

```ts
const senderIsHost = state?.peers.find((p) => p.id === peerId && p.isHost);
```

`handleMessage` validates the sender is host by looking up `peerId` in the local `collaborationStore`. If a peer can inject a record into the store with `isHost: true`, it can grant itself and others arbitrary roles. There is no cryptographic signature on role-grant messages. This is a trust-on-store design that must be secured with message signing before shipping.

### 89.2 Permission grants tunnelled through CRDT sync channel using magic string

```ts
broadcastCrdtSync({ type: 'crdt-sync', docId: '__permissions__', ... })
```

The permissions system piggybacks on the CRDT document sync channel using the reserved string `__permissions__` as a discriminator. If a legitimate CRDT document with ID `__permissions__` is ever created, the channel collides. A dedicated message type should be used.

### 89.3 `JSON.parse(...) as PermissionMessage` — no runtime validation

Line 114 casts the parsed JSON directly to `PermissionMessage` without checking field types or presence. A malicious or malformed message could produce unexpected runtime behavior downstream.

---

## §90 — `telemetryAllocator.ts` (AudioEngine)

### 90.1 `console.warn` bypasses `logger`

Line 117 uses `console.warn` directly (§23.3 pattern).

### 90.2 SAB orphaned on HMR — running worklets write to stale memory

`telemetryAllocator` is a module-level singleton. On HMR reset, a new `TelemetryAllocator` is created with a new `SharedArrayBuffer`, but running AudioWorklet processors hold references to the old SAB (passed via `postMessage` at init time). After HMR, the main thread polls from the new SAB (all zeros) while worklets continue writing to the old one — telemetry silently shows zeros.

---

## §91 — `validateActions.ts` / `parsePromptToActions.ts` (AiRuntime)

### 91.1 Security: 162 of 165 AI action types have no payload validation

`validateActions` has payload checks for exactly three action types: `setTempo` (bpm 20–300), `setMasterGain` (0–1), `setMetronomeVolume` (0–1). All other 162 types — including `removeTrack`, `removeClip`, `removeDevice`, `deleteTrackAlternative`, `exportProject`, `importMidiFile`, `createCollabSession`, `loadExternalPlugin` — pass through with their payloads unchecked. An LLM hallucinating or adversarially crafted actions can send arbitrary IDs or values to destructive action handlers.

### 91.2 `KNOWN_ACTION_TYPES` is manually maintained and can diverge

The 165-entry `ReadonlySet<RuntimeActionType>` must be manually updated when new action types are added to `RuntimeActionType`. There is no compile-time linkage that would cause a type error if a new `RuntimeActionType` is omitted from this set. New types silently pass the allowlist check if added to the type union but forgotten here.

### 91.3 Dual `if (result.success)` / `if (!result.success)` instead of `if/else`

```ts
if (result.success) { return { ... }; }
if (!result.success) { logger.warn(...); return { ... }; }  // ← should be else
```

The two branches are logically exhaustive after the first guard returns. The second `if (!result.success)` adds no semantic value over `else` and makes the intent less clear. TypeScript cannot narrow `result` correctly between the two branches.

### 91.4 Dynamic import on every LLM path invocation

```ts
const { executeDsoEdit } = await import('./dsoEditor/executeDsoEdit');
```

This is inside the hot path of every AI request that reaches the LLM fallback. Dynamic imports add micro-latency on first call and complicate module dependency tracing. The function should be imported statically at the top of the file.

---

## §92 — `getProjectContext.ts` (AiRuntime)

### 92.1 `midiStore.value` accessed per clip inside `.map()`

```ts
clips: t.clips.map((c) => ({
    ...
    noteCount: c.type === 'midi' ? (midiStore.value?.notesByClipId[c.id]?.length ?? 0) : 0,
})),
```

`midiStore.value` is re-dereferenced on each clip iteration. At 100 tracks × 20 clips, this is 2000 `.value` accesses. The value should be stored in a `const midiState = midiStore.value` before the outer `.map()`.

### 92.2 No memoization — full context object rebuilt on every AI call

`getProjectContext()` is called on every AI chat message and allocates a full context object graph (all tracks, clips, devices). There is no cache keyed to store version. For large projects this is a noticeable allocation spike on every user message.

---

## §93 — `serializeLogicalState.ts` (AiRuntime DSO Editor)

### 93.1 `revisionCounter` module-level mutable — HMR risk

```ts
let revisionCounter = 0;
```

Hot module replacement resets the counter to 0. Running LLM sessions that use the revision to detect stale context will see an incorrect regression in the counter value without warning.

### 93.2 `recentEdits` module-level mutable array — HMR clears edit history

```ts
const recentEdits: string[] = [];
```

The recent-edits log (used to build prompt context for follow-up requests) is cleared on every HMR. The AI loses awareness of what edits were recently made during a dev session.

### 93.3 Double cast to access properties absent from model types

```ts
gain: (clip as Record<string, unknown>).gain as number | undefined,
name: (device as Record<string, unknown>).name as string | undefined,
```

Both `gain` on `Clip` and `name` on `Device` are not present in their respective model types, requiring runtime casts to access them. This indicates the model types are incomplete. Adding the optional fields to the types would make these casts unnecessary and surface the inconsistency at compile time.

---

## §94 — `executeDsoEdit.ts` (AiRuntime DSO Editor)

### 94.1 Duplicate step comment — "8." appears twice

The inline step comments label step 132 as "8. Validate DSOs" and step 145 as "8. Classify and execute" — the second should be step 9. Minor but misleading in a numbered orchestration function.

### 94.2 `parseEditPlan` performs structural check only — individual DSO payloads unvalidated

```ts
const parsed = JSON.parse(clean) as EditPlan;
if (parsed.kind === 'edit_plan' && Array.isArray(parsed.dsos)) { return parsed as EditPlan; }
```

Only the top-level `kind` field and `Array.isArray(dsos)` are verified. Individual DSO `op`, `id`, and `params` fields are passed to `validateDsos` / `executeDsos` without shape checking. A malformed LLM response (e.g., `dsos: [null]`) reaches those functions and may throw at unexpected locations.

### 94.3 Dynamic import on error path

```ts
const activeModel = (await import('../../repositories/webLlm/engineLifecycle')).getActiveModelId();
```

Inside a `catch` block, a dynamic import is used to read the active model ID. This is an already-imported module (imported statically at the top of the file as `getLlmEngine`). The `getActiveModelId` function should be imported alongside it.

---

## §95 — `clipIdCounter.ts` (Arrangement)

### 95.1 `nextClipId` resets to 1 on HMR

```ts
let nextClipId = 1;
export function getNextClipId(): string { return `clip-${nextClipId++}`; }
```

This is the central ID generator for all clips. On HMR the counter resets to 1. If clips `clip-1`…`clip-N` already exist in the store, the next `getNextClipId()` returns `clip-1` again — a collision. Any map keyed on clip ID (MIDI notes, automation, CRDT documents) will silently merge with the wrong clip's data.

### 95.2 Sequential integer IDs are collision-prone in multi-tab sessions

Each browser tab gets its own module instance and counter starting at 1. Two tabs creating clips simultaneously produce identical IDs. The `crypto.randomUUID()` approach used elsewhere in the codebase should replace this counter.

---

## §96 — `BusNode.ts` (AudioEngine)

### 96.1 Unnecessary `as any` cast on `getFloatTimeDomainData`

```ts
this.strip.analyserNode.getFloatTimeDomainData(data as any);
```

`data` is `Float32Array` and `getFloatTimeDomainData` accepts `Float32Array`. The cast is unnecessary and masks any future type mismatch. The `as any` should be removed.

---

## §97 — `BacteriaNode.ts` (AudioEngine)

### 97.1 Module-level WASM cache — HMR serves stale bytes

```ts
let cachedWasmBytes: ArrayBuffer | null = null;
```

Same pattern as GlutenNode (§55.2): HMR resets this to `null` in the new module version, but the old cached bytes in the old module version may still be in use by running nodes. After hot reload, the first new `createBacteriaNode` call re-fetches the WASM from the server, adding latency and potentially creating a version mismatch if the WASM file was also updated.

### 97.2 `bandLevels` always returns empty array — misleading type

```ts
onMeterData(cb) {
    ...
    cb({ inputDb: ..., outputDb: ..., bandLevels: [], latency: ... });
}
```

`BacteriaMeterData.bandLevels: number[]` is declared as a real field, but the SAB telemetry slot (`BACTERIA_IDX`) has no band-level fields. `bandLevels` is always `[]`. Any consumer that trusts this field for display or analysis gets silent empty data. Either the SAB layout and `BACTERIA_IDX` need band-level entries, or the field should be removed from the type.

### 97.3 Empty `catch {}` blocks swallow disconnect errors

```ts
try { node.disconnect(); } catch {}
```

Both `disconnect()` and `destroy()` use empty catch blocks. This matches the GlutenNode pattern (§55.4) — acceptable for disconnect-on-removal but inconsistent with the rest of the codebase that at least logs errors via `logger`.

---

## §98 — `processorFactory.ts` (Yeast)

### 98.1 Duplicate `ccGenerator` entry in `PROCESSOR_TYPES`

`PROCESSOR_TYPES` (lines 53 and 56) contains two identical entries for `ccGenerator`, and the `// Phase 6 — Lab` section comment is duplicated as well. This is a copy-paste error. The UI presenting this array would render `ccGenerator` twice in the processor picker. The `createProcessor` switch handles only one branch, so the duplicate entry is purely cosmetic — but it pollutes the list.

---

## §100 — `captureSnapshot.ts` / `restoreSnapshot.ts` (Project version control)

### 100.1 Snapshot omits MIDI notes and automation — version restore loses data

`captureSnapshot` only serializes `trackStore`, `markerStore`, and `transportStore`. `midiStore` (notes per clip), `automationStore` (automation lanes and points), and `workspaceStore` are not included. When a version snapshot is restored, all MIDI note content and automation data reverts to the current state rather than the snapshot's state — version control silently skips half the project state.

### 100.2 `new Blob([data]).size` — Blob allocated just to measure byte size

```ts
return { data, size: new Blob([data]).size };
```

`Blob` construction with a large JSON string allocates a full browser Blob object solely to measure byte length. Use `new TextEncoder().encode(data).byteLength` (zero-allocation path) or simply `data.length` as an approximate character count.

---

## §101 — `restoreSnapshot.ts` (Project version control)

### 101.1 No runtime validation on parsed snapshot data

```ts
const parsed = JSON.parse(snapshot.data);
if (parsed.tracks) { trackStore.set(parsed.tracks); }
```

`parsed` is an unvalidated JavaScript value. If the snapshot is corrupted, partially written, or from an older schema version, `parsed.tracks` could be a structurally incorrect object that the store accepts silently, leading to hard-to-diagnose runtime errors.

### 101.2 Restore path matches the gaps in `captureSnapshot`

Because `midiStore` and `automationStore` are not in the snapshot, `restoreSnapshot` cannot restore them even if they were added to `captureSnapshot`. These two functions must be evolved together. Currently the pairing is inconsistent with what the user expects version restore to mean.

---

## §105 — `automationDrawMode.ts` (Automation)

### 105.1 Module-level `activeSession` — HMR abandons in-flight session

`let activeSession: DrawSession | null = null` resets to `null` on HMR. If a user is in the middle of a draw session during development, the old session's `rafId` is never cancelled, and the `flushPendingState` rAF callback will fire against the old module's store reference indefinitely.

### 105.2 Full `lanes.map()` allocation on every painted point

```ts
const nextState: AutomationStoreState = {
    lanes: state.lanes.map((l) => { ... }),
};
```

Even with the rAF-batching optimization (deferred `automationStore.set`), `paintDrawPoint` still allocates a full `AutomationStoreState` + `lanes` array on every `mousemove` event. For a project with 50 automation lanes, this is a 50-element array + lane clone on every pixel of cursor movement.

---

## §108 — `evaluateFollowActions.ts` (Transport)

### 108.1 Array allocations on scheduler tick for sort/filter

`play_next` / `play_previous`: `track.clips.filter(...).sort(...)` — allocates a filtered copy then sorts it.
`play_first` / `play_last`: `[...track.clips].sort(...)` — spreads the entire clips array.

These allocations happen on the scheduler tick path every time the playhead crosses a clip boundary. Pre-sorting clip arrays by `startBeat` at load/edit time would make all lookups O(1) binary searches instead.

### 108.2 `Math.random()` in `play_random` follow action

Unseeded (§55.3 pattern). Non-deterministic across sessions, which is expected for randomness, but inconsistent with the seeded approach used in the drum pattern generator.

### 108.3 `track.clips as Clip[]` cast

The clips array appears to be `readonly (Clip | MidiClip)[]` in context, and `as Clip[]` silences a discriminated union check that should be explicit.

---

## §110 — `assetTransfer.ts` (Collaboration)

### 110.1 `docId: '__asset__'` magic string on CRDT sync channel

Same pattern as §89.2 (`__permissions__`): asset control messages are routed through the CRDT WebRTC channel using a reserved `docId` discriminator. If a real CRDT document with id `__asset__` is ever created, the channel will corrupt both streams. A dedicated `type: 'asset-control'` top-level message type would avoid the collision.

### 110.2 `JSON.parse(message.data) as AssetControlMessage` — no runtime validation

Line 92 parses the incoming JSON and casts directly to `AssetControlMessage`. A malicious or malformed peer message with unexpected field types reaches `handleAssetRequest`, `handleManifest`, or `handleChunk` unvalidated (§89.3 pattern).

### 110.3 `console.error` bypasses `logger`

Lines 102 and 218 use `console.error` directly (§23.3 pattern).

### 110.4 `Array.from` per-chunk base64 encoding creates 256KiB temporary array

```ts
return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
```

For each 256KiB chunk, this creates a 262,144-element temporary `string[]` via `Array.from`, then `.join('')` into another string before `btoa`. A `TextDecoder` or direct `Uint8Array` iteration would avoid the intermediate array.

---

## §109 — `scheduleAudioClips.ts` (Transport)

### 109.1 `requestedAssets` module-level Set — HMR resets deduplication

```ts
const requestedAssets = new Set<string>();
```

This dedup set prevents spamming peer asset requests while waiting for downloads. On HMR, it resets and the scheduler immediately re-requests all pending assets on the next tick. Same §14.1 pattern; here the blast is network requests, not store writes.

---

## §107 — `playheadScheduler.ts` (Transport)

### 107.1 Nine module-level mutable vars — HMR risk at the heart of the scheduler

`timerId`, `lastTickTime`, `accumulatedPosition`, `lastScheduledBeat`, `scheduledAudioClips`, `scheduledFrozenTracks`, `activeAudioSources`, `punchRecordingActive`, `punchRecordingClipIds` — all module-level. On HMR, these reset while the old `setTimeout` tick loop continues firing against the old module's closed-over references. This is the highest-impact instance of §14.1 in the codebase: a stale scheduler and a fresh scheduler running concurrently means double-scheduled MIDI notes, double metronome clicks, and double automation writes.

### 107.2 `activeAudioSources as any[]` — typed wrapper needed for fade node

```ts
for (const src of activeAudioSources as any[]) {
    if (src.fadeGainNode) { ... }
}
```

The array holds `AudioBufferSourceNode` objects with a `fadeGainNode` property attached at runtime. The `any` cast silences TypeScript. A typed wrapper `{ source: AudioBufferSourceNode; fadeGainNode: GainNode | null }` would remove the cast and make the fade-node lifecycle explicit.

### 107.3 Dynamic import inside scheduler tick

```ts
import('./transportControls/stopPlayback').then(({ stopPlayback }) => stopPlayback());
```

Called every tick when `evaluateFollowActions` returns `shouldStop: true`. The dynamic import is unnecessary — `stopPlayback` can be imported statically at the top of the file. As written, the first `shouldStop` event on each HMR cycle triggers a new `import()` resolve.

### 107.4 Audio source stop/fade logic triplicated

The block that cancels all `activeAudioSources` with a 5ms fade appears identically at:
- Loop boundary (lines 93–108)
- Follow-action jump (lines 131–148)
- `stopPlayheadScheduler` (lines 256–269)

This is 75 lines repeated 3×. A `stopAllActiveSources(ctx: BaseAudioContext)` helper would unify the three call sites.

### 107.5 Recording buffer callback clones all tracks×clips

```ts
trackStore.set({
    ...ts,
    tracks: ts.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) =>
            c.id === recClip.id ? { ...c, audioBufferId: bufferId } : c
        ),
    })),
});
```

This callback fires every time a recording buffer chunk arrives. At 30 tracks × 20 clips = 600 object allocations per buffer receive, on the audio recording path. Should use `updateClip(recClip.id, { audioBufferId: bufferId })`.

---

## §106 — `recordAutomationValue.ts` (Automation)

### 106.1 `getTrackById` called on every automation write tick

`getTrackById(trackId)` performs an O(n) linear scan through all tracks. Called at every automation record event (potentially every rAF frame per parameter), this scan occurs dozens of times per second during automation recording.

### 106.2 Throwaway `[]` allocation for missing pending-point entry

```ts
const points = pendingPoints.get(key) ?? [];
points.push(point);
pendingPoints.set(key, points);
```

When `key` is absent from `pendingPoints`, the `?? []` creates a new empty array, which is immediately set back with `pendingPoints.set`. The same two-liner appears twice (lines 41 and 47). Should be `if (!pendingPoints.has(key)) pendingPoints.set(key, [])` once before the block.

---

## §103 — `positionTracking.ts` (Sampler)

### 103.1 Seven module-level mutable vars — HMR creates duplicate polling loops

`pollTimer`, `rafId`, `lastPolledFrame`, `prevPolledFrame`, `pollTimestamp`, `interpolatedFrame`, and `listeners` are all module-level. On HMR, they reset to their initial values while any running `setInterval`/`requestAnimationFrame` loop from the old module instance continues ticking. The next `subscribeToPosition()` call sees `pollTimer === null` and starts a second concurrent polling loop.

### 103.2 `console.error` bypasses `logger`

`positionTracking.ts` line 36 and `smartLoopPoints.ts` line 23 use `console.error` directly (§23.3 pattern).

---

## §104 — `SampleLibrary/useCases/restoreLibrary.ts`

### 104.1 Passthrough wrapper with no added value

```ts
export async function restoreLibrary(): Promise<void> {
    return restoreLibraryFromRepo();
}
```

This file exists solely to re-export the repository function under the same name. It adds no transformation, validation, or behavior. Callers could import from the repository directly, or if the use-case layer boundary is needed, the import alias achieves the same effect with no boilerplate file (§81.1 pattern).

---

## §102 — `proSynthInstruments.ts` (Synth)

### 102.1 Faust `hslider` label/address mismatch in Supersaw Unison

The `Supersaw Unison` Faust code declares its ADSR parameters with bare labels (`"attack"`, `"decay"`, etc.) while the `FaustParamDescriptor` entries use `/synth/attack`, `/synth/decay` prefix paths. Faust computes parameter addresses from the process graph path, not from the descriptor's `address` field. If the computed Faust address doesn't match the descriptor, the UI slider has no effect.

### 102.2 Additive Synth `/additive/partials` param has no runtime effect

```faust
partials = 16;  // Faust compile-time constant
process = sum(i, partials, ...) ...
```

`sum(i, partials, ...)` in Faust is a compile-time unroll, not a runtime loop. `partials = 16` is a static value; no `hslider("partials", ...)` is declared in the Faust code. The UI descriptor for `/additive/partials` exposes a knob that has no effect on the DSP.

---

## §99 — `loadProject.ts` (Project)

### 99.1 Module-level `stopAutoSave` — HMR creates concurrent auto-save loops

```ts
let stopAutoSave: (() => void) | null = null;
```

On HMR, this resets to `null` in the new module version while the old auto-save interval returned by `startCrdtAutoSave()` is still running. The next `loadProject()` call then starts a second loop without stopping the first, producing two concurrent auto-save writers to the same Automerge document.

### 99.2 `console.error` bypasses `logger`

Line 25 uses `console.error(...)` directly (§23.3 pattern).

---

## §115 — `DeviceParameterControl.tsx` (Workspace / Inspector)

### 115.1 Full automation-lane scan per render per parameter

```ts
const autoState = useStore<DeviceAutomationState>(automationStore, { lanes: [] });
const activeLane = autoState.lanes.find((l) => l.trackId === trackId && l.parameterId === param.id);
```

This component subscribes to `automationStore` (the full store, not a selector slice), then scans every lane on every render to find the one relevant lane. With 10 tracks × 10 devices × 8 parameters = 800 mounted `DeviceParameterControl` instances, each re-render from any automation change triggers 800 `.find()` scans across all lanes. A selector `selectLaneForParam(trackId, paramId)` passed as a prop from the parent, or a per-instance derived atom, would confine the subscription to the one relevant lane.

### 115.2 Automation toggle button duplicated verbatim in slider and non-slider branches

Lines 177–196 (slider branch) and lines 217–236 (non-slider branch) contain an identical 18-line automation toggle `<button>` block — same `className` expression, same `onClick` handler, same `aria-label`, same `title`. The only structural difference is the containing `<div>`. Extracting a `<AutomationToggleButton param={param} trackId={trackId} activeLane={activeLane} />` component would unify the two call sites without any behavioral change.

---

## §114 — `sessionManagement.ts` (Collaboration)

### 114.1 Thirteen module-level mutable vars — HMR leaves WebRTC connections open

```ts
let peerManager: PeerConnectionManager | null = null;
let automergeSync: AutomergeSync | null = null;
let assetTransfer: AssetTransfer | null = null;
let permissionManager: PermissionManager | null = null;
let cleanupProjectionBridge: (() => void) | null = null;
let presenceListeners = new Set<(data: PresenceData) => void>();
let playheadBroadcastInterval: ReturnType<typeof setInterval> | null = null;
let pendingInviteId: PeerId | null = null;
const peerCleanupTimers = new Map<PeerId, ReturnType<typeof setTimeout>>();
let branchStoreSnapshot: LocalBranchState | null = null;
let unsubscribeBranchStore: (() => void) | null = null;
let unsubscribeAutomergeChanges: (() => void) | null = null;
let isProjectingBranches = false;
```

This is the highest module-level mutable var count in the codebase (13). On HMR, all 13 reset to their initial values in the fresh module while the old module's `PeerConnectionManager` (WebRTC), `AutomergeSync` (network), `AssetTransfer`, `PermissionManager`, `setInterval` (playhead broadcast), and two store subscriptions continue running with the stale references. The collaboration session becomes split: some network messages route to the old handlers, some to the new; the cleanup timers fire against the stale peer list. The entire session object should be encapsulated in a single class or object returned by `startSession()` and torn down by `leaveSession()`.

### 114.2 `DOC_BRANCHES = '__branches__'` — third magic docId on CRDT sync channel

```ts
const DOC_BRANCHES = '__branches__';
```

This is the third `__x__` string piggybacked on the CRDT WebRTC channel as a discriminator (after `__permissions__` in §89.2 and `__asset__` in §110.1). If three real CRDT documents with those IDs were ever created, all three control channels would corrupt. A typed envelope `{ type: 'control' | 'crdt', subtype: 'branches' | 'permissions' | 'asset', ... }` at the transport layer would eliminate all three collision risks at once.

### 114.3 `JSON.stringify` double-serialization for branch equality check

```ts
if (JSON.stringify(branches) === JSON.stringify(currentBranches)) return;
```

Called on every CRDT change event (potentially many times per second during active collaboration). Both serializations are O(n) in the number of branches and allocate temporary strings. A shallow field-by-field compare or a revision counter on the branch list would avoid the allocation.

---

## §132 — `ShortTermLUFS.ts` + `processRealtimeMidiInput.ts` — cosmetic and structural issues

### 132.1 `ShortTermLUFS` constructor `sampleRate` parameter has no effect

```ts
constructor(sampleRate = 48000) {
    this.maxBlocks = Math.ceil((3 * sampleRate) / (0.4 * sampleRate));
}
```

`sampleRate` appears in both numerator and denominator and cancels out: `(3 × sr) / (0.4 × sr) = 3 / 0.4 = 7.5`. `maxBlocks` is always `Math.ceil(7.5) = 8` regardless of the `sampleRate` argument. The constructor signature implies sample-rate awareness but the computation is sample-rate independent. Should be written as `Math.ceil(3 / 0.4)` with no constructor parameter, or documented that block-count is dimensionless.

### 132.2 Hardcoded 128-sample block end in `processRealtimeMidiInput`

```ts
return processYeastMidi('', [event], sampleTime, sampleTime + 128);
```

The block end `sampleTime + 128` assumes a 128-sample block size. This is the same magic number used in `MarkovChain.ts` (`const blockEnd = now + 128`). If the Web Audio render quantum is not 128 samples (it is 128 in all current browsers, but this is not contractually guaranteed), Yeast MIDI events scheduled within the block may be silently dropped. A named constant or a value from `AudioContext.renderQuantumSize` (a Stage 3 proposal) would make the dependency explicit.

### 132.3 `_trackId` always passed as `''` — unused parameter in public API

```ts
processYeastMidi('', [event], sampleTime, sampleTime + 128);
```

`processYeastMidi`'s `_trackId: string` parameter is prefixed `_` to mark it as unused. Every call passes `''`. The intended per-track routing was never implemented.

---

## §131 — RAVE `encodeAudio.ts` + `decodeLatent.ts` — stub implementations shipped as production code

### 131.1 ONNX model calls replaced with fake sine-wave simulations

`encodeAudio.ts`:
```ts
/**
 * In production this calls the ONNX encoder model.
 * Here we simulate with a deterministic spectral transform.
 */
export function encodeAudio(samples: Float32Array, sampleRate: number, latentDim = 16): LatentVector[] {
    // ... sum += samples[idx]! * Math.sin((d + 1) * j * 0.1) ...
}
```

`decodeLatent.ts`:
```ts
/**
 * Decode latent vectors back to audio samples.
 * In production this calls the ONNX decoder model.
 */
export function decodeLatent(vectors: LatentVector[], sampleRate: number): Float32Array {
    // ... sample += v.values[d]! * Math.sin((2 * Math.PI * (d + 1) * 100 * j) / sampleRate) * 0.1 ...
}
```

Both files have comments acknowledging they are stubs. Neither loads an ONNX runtime. The "encode" is a dot-product with sine weights (not a neural encoder); the "decode" is harmonic series synthesis (not a neural decoder). Any user invoking RAVE timbre transfer receives fake audio generated by these simulations. This is a more complete version of the `KneadEditor.tsx` mock-data pattern (§124.1): both simulate real AI processing with fake data that is presented to users as genuine output.

---

## §130 — `offlineRender.ts` (AudioEngine)

### 130.1 Module-level `cancelFlag` and `isRenderingActive` — HMR corrupts export guard

```ts
let cancelFlag = false;
let isRenderingActive = false;
```

On HMR during an active export: the old module's `isRenderingActive = true` is invisible to the new module instance (reset to `false`). A second concurrent export bypasses the render-lock guard. Simultaneously, the old module's `cancelFlag` is orphaned — calling `cancelExport()` from the UI sets the new module's `cancelFlag`, while the old render loop checks the old one. The export can neither be detected as in-progress nor cancelled from the UI after a hot reload.

---

## §129 — `webMidi/state.ts` (AudioEngine)

### 129.1 Mutable `export let` variables — HMR resets MIDI state; stuck notes possible

```ts
export let midiAccess: MIDIAccess | null = null;
export let activeInput: MIDIInput | null = null;
export let targetTrackId: string | null = null;
export let mpeEnabled = false;
export let tauriMode = false;
export let tauriEventUnlisten: (() => void) | null = null;
export const activeNotes = new Map<number, ActiveNoteData>();
export const channelToNote = new Map<number, number>();
```

Eight module-level mutable variables exported as `let` or mutable `const`. On HMR:
- `midiAccess` resets to `null` — old `MIDIAccess` reference still holds event listeners; new module doesn't know about it
- `tauriEventUnlisten` resets to `null` — old Tauri MIDI event listener is never unregistered, leaking a native event subscription
- `activeNotes` resets to an empty Map — any notes currently held down produce stuck-note state (no `noteOff` for notes that were registered in the old Map)

As with `clipboardStore.ts` (§123.1), the `let` exports also allow any importer to mutate these directly (`midiAccess = null`) without going through the setter functions, bypassing the module's setState/notify mechanism entirely.

---

## §128 — `compilerEngine.ts` (Plugin / Faust)

### 128.1 Five module-level mutable vars — HMR triggers 15MB WASM re-download

```ts
const modules = new Map<string, FaustModule>();
const compilationPromises = new Map<string, Promise<boolean>>();
let compilerPromise: Promise<IFaustCompiler> | null = null;
let compilerReady = false;
let compilerError: string | null = null;
```

On HMR, all five reset. `compilerPromise = null` means the next Faust plugin load or compilation initiates a fresh `instantiateFaustModuleFromFile` call — downloading and instantiating the ~15MB Faust WASM module from scratch. All `modules` entries (registered Faust DSP modules) are lost; any existing `AudioWorkletNode`s that were created from those modules are now orphaned since their module records are gone. The compiler's SHA256 compilation cache (held inside the `FaustCompiler` object, not this module) is also discarded.

### 128.2 `console.error` × 2 bypasses `logger`

Lines 64 and 120 use `console.error` directly (§23.3 pattern).

---

## §127 — `llmMidiGeneration.ts` (AiGeneration)

### 127.1 `fallbackToPatternMatch` defined inside `generateMidiViaLlm` — new closure per call

```ts
export async function generateMidiViaLlm(prompt: string, ...): Promise<MidiGenerationNote[]> {
    // ...
    function fallbackToPatternMatch(promptText: string): MidiGenerationNote[] { ... }
```

This helper is defined inside the exported async function, allocating a new closure on every call to `generateMidiViaLlm`. It should be a module-level function. There is no closure over the outer function's arguments — it only uses its own `promptText` parameter.

### 127.2 `backend === 'cloud'` silently falls back to local pattern match

```ts
} else if (backend === 'cloud') {
    return fallbackToPatternMatch(prompt);
}
```

The `cloud` backend returns the same pattern-matched fallback as `none`. No cloud API call is made; no error or warning is emitted. Users who expect a cloud-powered generation receive local pattern data with no indication that the cloud path was not used.

---

## §126 — `AutomationLaneRow.tsx` (Workspace / AutomationView)

### 126.1 Two O(n) `filter()` passes over all points on every playhead tick

```ts
const before = lane.points.filter((p) => p.beat <= playheadBeat);
const after = lane.points.filter((p) => p.beat > playheadBeat);
```

This component subscribes to `transportStore` and uses `playheadPosition`, which updates at 60fps during playback. On every frame, two full linear scans over `lane.points` find the surrounding automation points. A binary search on the sorted `lane.points` array (points are time-ordered) would reduce this from O(n) × 2 to O(log n).

### 126.2 `new Map(lane.points.map(...))` rebuilt every render inside path segment loop

```ts
const regionIndexMap = new Map(lane.points.map((p, idx) => [p, idx]));
// ... used inside the for-loop building regionPoints
```

This Map is constructed on every render (both in the `virginTerritory` branch at line 131 and the normal branch at line 146), always allocating O(n) Map entries keyed by point object reference. Since `lane.points` is derived from the store and is a stable array reference between renders that don't mutate automation, this Map could be derived once from a stable reference.

### 126.3 `transportStore` subscription causes renders on all transport state changes

```ts
const transport = useStore<AutomationLaneTransportState>(transportStore, defaultTransportState);
```

`AutomationLaneRow` is only interested in `playheadPosition`, but the generic `useStore` subscription fires on any change to `transportStore` — BPM changes, play/pause toggles, loop point moves, etc. With many automation lanes open, every transport state change causes N re-renders. A selector `transportStore` slice for `playheadPosition` would confine re-renders to playhead movement only.

---

## §125 — `WaveformEditor.tsx` (Workspace / ClipView)

### 125.1 `draw` in ResizeObserver `useEffect` dependency array — observer torn down and restarted every render

```ts
useEffect(() => {
    const observer = new ResizeObserver(() => draw());
    if (containerRef.current) { observer.observe(containerRef.current); }
    return () => observer.disconnect();
}, [draw]);
```

`draw` is a plain function defined in the component body without stabilization. React Compiler will memoize it, but its captured values (zoom, warpState, etc.) change on each relevant render, making `draw` a new reference. Each time `draw` changes, the ResizeObserver is disconnected and a new one attached — meaning any resize event that triggers a component update causes the observer to disconnect mid-resize.

### 125.2 `trackStore.value` read directly during render — stale clip ID resolution

```ts
const realClipId =
    trackStore.value?.tracks.flatMap((t) => t.clips)
        .find((c) => c.audioBufferId === clipId || c.id === clipId)?.id ?? clipId;
```

This reads the store synchronously during render without `useStore`, bypassing React's subscription mechanism. If the track store updates (clips added, removed, renamed), `realClipId` won't recompute. Also, `.flatMap` creates a full temporary array of all clips on every render — same pattern as §13.2.

### 125.3 `bufferVersion` increment needed to reflect audio buffer cache changes

The canvas `draw()` reads from `audioBufferCache.getWaveformPeaks(clipId, ...)` but `audioBufferCache` is not subscribed. The only trigger to re-draw after a buffer load is `setBufferVersion(v => v + 1)`, which is called only after a drag-drop replace. If the buffer is loaded via another path (e.g., the audio engine loads it asynchronously after the component mounts), the waveform won't update. The component will show the "drop a file" placeholder even when audio data is already available.

---

## §124 — `KneadEditor.tsx` (Workspace / ClipView)

### 124.1 Hardcoded mock pitch data auto-injected for all Knead devices in production

```ts
useEffect(() => {
    if (hasKnead && (!kneadState || kneadState.blobs.length === 0)) {
        const timer = setTimeout(() => {
            ingestDspAnalysis(trackId, [
                { time: 0.5, f0: 220.0, periodicity: 0.9 },   // A3
                { time: 0.6, f0: 221.0, periodicity: 0.9 },
                // ... 22 more hardcoded frames
                { time: 3.1, f0: null, periodicity: 0.1 },
            ]);
        }, 600); // "give it a slightly satisfying 'thinking' pause"
    }
}, [hasKnead, kneadState, trackId]);
```

Every time a user adds a Knead device to a track and the editor opens, a 600ms timeout fires and writes 25 fabricated pitch frames (A3, E4, C4) into `kneadStore` via `ingestDspAnalysis`. Any user immediately sees fake pitch blobs that look like real analysis output — A3 at 220Hz, E4 at 330Hz, C4 at 262Hz — regardless of what audio is actually in the clip. This data persists in the store. This is stub code that was never removed before production.

### 124.2 `_clipId` prop received but never used

```ts
export const KneadEditor = ({ trackId, clipId: _clipId }: { trackId: string; clipId: string }): ReactElement => {
```

`clipId` is renamed to `_clipId` to suppress the unused-variable lint warning, then never referenced. The Knead editor operates per-track; the clip context is discarded. The prop should either be removed from the interface or used to scope the analysis to the correct audio buffer.

---

## §123 — `clipboardStore.ts` (Arrangement)

### 123.1 Mutable `let` exports — HMR resets clipboard; external mutation possible

```ts
export let clipClipboard: ClipboardEntry[] = [];
export let noteClipboard: NoteClipboardEntry | null = null;
```

Both variables are exported as `let`, meaning any importer can mutate them directly (`clipClipboard = []` without calling `setClipClipboard`). This is an open mutation surface — TypeScript does not prevent it for `let` re-exports. On HMR, both reset to their initial values: a Cmd+C in one dev save cycle loses the clipboard on the next save. Using a `createStore` (even without persistence) would encapsulate the mutation and survive HMR via the store registry.

---

## §122 — Module-level ID counters — systemic HMR-reset risk (41 instances)

### 122.1 Forty-one `let xId = 1` counters, all reset on HMR

```
src/modules/Arrangement/repositories/clipIdCounter.ts           → nextClipId
src/modules/Arrangement/models/Marker.ts                       → nextMarkerId, nextSectionId
src/modules/Arrangement/models/TakeLane.ts                     → nextTakeId, nextLaneId
src/modules/Arrangement/models/ScratchPadSection.ts            → nextScratchId
src/modules/Arrangement/models/WarpMarker.ts                   → nextWarpMarkerId
src/modules/Arrangement/stores/groupComping.ts                 → groupId, takeSetId, regionId
src/modules/Arrangement/stores/adjustmentLayer.ts              → layerId, regionId
src/modules/Arrangement/useCases/recording/startRecording.ts   → recordClipId
src/modules/Arrangement/useCases/freezeBounce/bounceOperations.ts → frozenClipId
src/modules/Arrangement/useCases/preset/presetLoading.ts       → nextPresetDeviceId
src/modules/Arrangement/useCases/preset/presetStorage/...      → nextUserPresetId
src/modules/MIDI/models/MidiNote.ts                            → nextNoteId, nextCcId, nextPitchBendId
src/modules/MIDI/useCases/midiLearn/completeMidiLearn.ts       → nextMappingId
src/modules/MIDI/useCases/patternInstance/createPatternInstance.ts → nextInstanceId (starts at 5000)
src/modules/Command/useCases/commandQueries.ts                 → nextUndoId, nextGroupId
src/modules/Command/models/UndoEntry.ts                        → nextUndoId, nextGroupId (duplicate of above)
src/modules/Transport/repositories/punchRecordingIdCounter/...  → captureId, punchId
src/modules/Transport/repositories/loopStationIdCounter/...    → slotId, layerId
src/modules/Transport/repositories/setlistItemIdCounter.ts     → itemId
src/modules/Transport/models/TempoMap.ts                       → nextTempoChangeId
src/modules/Transport/models/TimeSignatureMap.ts               → nextTimeSignatureChangeId
src/modules/AudioEngine/stores/audioWarp.ts                    → warpMarkerId
src/modules/AudioEngine/stores/controlSurface.ts               → endpointId
src/modules/AudioEngine/stores/controlRoom.ts                  → nextMonitorId, nextCueId
src/modules/AudioEngine/models/SidechainRoute.ts               → nextSidechainId
src/modules/Routing/models/SidechainRoute.ts                   → nextSidechainId (duplicate module)
src/modules/Plugin/stores/nodeView.ts                          → nodeId, connectionId
src/modules/Project/models/ProjectVersion.ts                   → nextVersionId, nextBranchId
src/modules/Synth/stores/cvGate.ts                             → outputId
src/modules/SoundLibrary/services/sampleTaggingHelpers.ts      → nextSampleId
src/modules/CrdtDocument/repositories/automergeRepository.ts   → _crdtWorkerNextId
```

Every one of these counters resets to its initial value on Vite HMR. The practical consequence: after any hot reload, the next entity creation produces an ID like `clip-1`, `undo-1`, `layer-1`, etc., which may already exist in the live store. This can cause:
- Silent store overwrites (new entity at same ID as existing one)
- Two different entities with the same key in maps/lookups
- Undo history corruption (`undo-1` from after HMR collides with `undo-1` from before HMR)

**Notable duplicates:**
- `Command/models/UndoEntry.ts` and `Command/useCases/commandQueries.ts` both define `nextUndoId`, `nextGroupId`, and `createUndoEntry`. The `UndoEntry.ts` copy is dead code — callers import from `commandQueries.ts` via the use-case index. The duplicate definitions are never called, but they are confusing.
- `AudioEngine/models/SidechainRoute.ts` and `Routing/models/SidechainRoute.ts` both define `nextSidechainId = 1`.

The fix is to replace sequential integer counters with `crypto.randomUUID()` everywhere, making IDs collision-resistant without requiring shared mutable state.

---

## §121 — `crdtProjectLifecycle.ts` + `startCrdtAutoSave.ts` (CrdtDocument)

### 121.1 `incrementalSaveCount` module-level — HMR resets compaction counter

```ts
let incrementalSaveCount = 0;
const COMPACTION_THRESHOLD = 50;
```

On every HMR cycle the counter resets to 0. In dev, where HMR fires frequently, the first 49 incremental saves after each reload never trigger compaction. This means the IndexedDB incremental chunk list grows unboundedly during a dev session. In production the counter survives indefinitely so compaction works correctly — the dev behavior is the problem.

### 121.2 `console.warn` in auto-save error path bypasses `logger`

```ts
persistCrdtProject().catch((error) => {
    console.warn('[CrdtAutoSave] Incremental persist failed:', error);
});
```

`startCrdtAutoSave.ts` line 28 uses `console.warn` directly (§23.3 pattern). A failed incremental save is a meaningful persistence event that should go through the structured logger.

---

## §120 — `semanticChangeContext.ts` (CrdtDocument)

### 120.1 Module-level `currentContext` — race condition under concurrent actions

```ts
let currentContext: SemanticContext | null = null;

export const setSemanticContext = (ctx: SemanticContext): void => { currentContext = ctx; };
export const clearSemanticContext = (): void => { currentContext = null; };
```

`executeAppAction` sets the context before the handler runs and clears it after. If two actions are dispatched concurrently — e.g., `await Promise.all([executeAppAction(a), executeAppAction(b)])` — the second call's `setSemanticContext` clobbers the first call's context before the first handler has issued its store writes. The Automerge change message for action `a` ends up with action `b`'s label. The fix is to thread the context as a parameter through the call chain rather than using a module-level slot.

---

## §119 — `createAutomergeStorage.ts` (infra/store/storage)

### 119.1 `JSON.parse(JSON.stringify(value))` on every rAF write

```ts
const toDocSafe = <TValue>(value: TValue): TValue => JSON.parse(JSON.stringify(value));
```

Called in `writeToCrdt` on every batched rAF write. For large stores (`midiStore` with thousands of notes, `trackStore` with many clips), this full round-trip serialization happens every animation frame during any drag or knob sweep. The purpose is to strip Automerge Proxy objects and `undefined` values, which could be done more cheaply by walking only the changed fields.

### 119.2 Triple JSON serialization per store per `hydrate()` call

```ts
const incomingJson = JSON.stringify(value);
const crdtData = JSON.parse(incomingJson) as TData;
const beforeJson = JSON.stringify(cachedValue);
```

`hydrate()` is called on 10 stores in sequence inside `projectCrdtToStores()`, which fires on every Automerge change notification. That is 30 JSON serialization operations per remote CRDT tick: `stringify(incomingAutomergeProxy)` × 10 + `parse(...)` × 10 + `stringify(cachedValue)` × 10. Under active collaboration, CRDT change notifications arrive multiple times per second.

### 119.3 `console.error` bypasses `logger`

Line 81 uses `console.error(...)` in the rAF write error handler (§23.3 pattern).

---

## §118 — WAM Plugin Host (`initWAMEnvironment.ts` / `helpers.ts` / `loadWAMPlugin.ts`)

### 118.1 `groupCounter` module-level — HMR resets WAM group IDs

```ts
let groupCounter = 0;
export async function initWAMEnvironment(context: AudioContext): Promise<string> {
    const groupId = `wam-group-${++groupCounter}`;
    (context as unknown as Record<string, unknown>).__wamGroupId = groupId;
    return groupId;
}
```

On HMR, `groupCounter` resets to 0. The next `initWAMEnvironment()` call produces `wam-group-1` again, colliding with any already-active WAM group. The double cast `as unknown as Record<string, unknown>` attaches a non-standard property to a live `AudioContext` — the WAM spec expects a proper WAM host environment object, not a monkey-patched string property.

### 118.2 `registry` and `instances` Maps module-level — HMR erases all registered plugins

```ts
export const registry = new Map<string, WAMDescriptor>();
export const instances = new Map<string, WAMInstance>();
```

These are the only stores for WAM plugin registration and active instances. On HMR, both Maps reset: every registered plugin definition is lost and every active WAM instance orphaned (its `AudioNode` remains connected in the audio graph but the instance record is gone, preventing cleanup). Same §14.1 pattern.

### 118.3 `console.warn` × 3 in `loadWAMPlugin.ts` bypasses `logger`

Lines 12, 24, and 34 all use `console.warn` directly (§23.3 pattern). These cover the three failure modes: plugin not in registry, custom loader returned null, and `HighEndPluginProcessor` worklet not registered.

---

## §117 — `songStructureDetection.ts` (Arrangement)

### 117.1 Unreachable `Drop` classification branch

```ts
} else if (isHigh) {
    sectionInfo = SECTION_PALETTE[3]!; // Chorus
    confidence = 0.7;
} else if (isLow) {
    sectionInfo = SECTION_PALETTE[6]!; // Break
    confidence = 0.65;
} else if (isHigh && progress > 0.5) {    // ← dead code
    sectionInfo = SECTION_PALETTE[7]!; // Drop
    confidence = 0.6;
}
```

The `else if (isHigh && progress > 0.5)` arm at line 155 is unreachable: `isHigh` is `true` only when `segEnergy > avgEnergy * 1.2`, and that case is already handled by the prior `else if (isHigh)` arm at line 149. No segment classified as "Drop" will ever be returned by this function; all high-energy segments become "Chorus".

### 117.2 `Math.min/max(...array.map(...))` — stack overflow on large arrangements

```ts
const minBeat = Math.min(...allClips.map((c) => c.startBeat));
const maxBeat = Math.max(...allClips.map((c) => c.endBeat));
```

Spread operator passes array elements as individual arguments. For arrangements with thousands of clips, this exceeds the JavaScript call stack argument limit (typically ~65,000 on V8). Use `allClips.reduce(...)` or `Math.min.apply(null, ...)` — or better, compute min/max in the existing `for` loop above to avoid a second pass.

---

## §116 — `stripSilence.ts` (Arrangement)

### 116.1 `_minSilenceBeats` parameter silently ignored

```ts
export function stripSilence(clipId: string, thresholdDb: number = -40, _minSilenceBeats: number = 0.5): void {
```

The `_minSilenceBeats` parameter is declared and documented but never used in the implementation — the `_` prefix marks it as intentionally unused. However, callers passing a minimum silence duration (e.g., `stripSilence(id, -40, 2)`) get no effect from that argument: short silences that should be ignored are still used to split the clip. This is a silent behavioral bug.

### 116.2 Clip IDs generated with `Date.now()` — bypasses central counter, collides on same millisecond

```ts
let nextId = Date.now();
const newClips = regions.map((region) => ({
    ...clip,
    id: `clip-strip-${nextId++}`,
```

Two `stripSilence()` calls within the same millisecond (e.g., processing multiple clips in a batch) start from the same `Date.now()` base, producing overlapping IDs. Additionally, this bypasses `getNextClipId()` (the central counter in `clipIdCounter.ts`), creating a parallel ID space. The central counter at `§95` never sees these clips; future counter advances may eventually collide if the counter reaches Date.now()-scale values (which it won't in practice, but the two-source ID scheme is fragile).

---

## §113 — `compileDso.ts` (AiRuntime DSO Editor)

### 113.1 `lastInsertedDeviceId` module-level — race condition under concurrent AI edits

```ts
/**
 * Reset at the start of each `executeDsos()` call.
 */
let lastInsertedDeviceId: string | null = null;
```

This variable tracks the device inserted by the most recent `insert_device` DSO so subsequent `set_device_param` DSOs can refer to it as `"latest"`. Because it is module-level (not argument-scoped), two concurrent `executeDsos()` calls — for example an AI chat response that triggers while a prior AI edit is still mid-execution — write to the same slot. The second call resets `lastInsertedDeviceId = null` at line 910, clobbering the first call's in-flight device reference. The fix is to hold this state in a local variable inside `executeDsos()` and pass it through the DSO loop as context.

### 113.2 `console.warn` on DSO execution failure bypasses `logger`

```ts
} catch (error) {
    console.warn(`Failed to execute DSO ${dso.op}:`, error);
}
```

Line 918 uses `console.warn` directly. As with the 86 other instances (§23.3), this bypasses the structured `logger` and is invisible to any log aggregation pipeline.

---

## §72 — `modulatorLibrary.ts` / `storeRegistry.ts` — dead code accumulation

These two files are documented dead code (§63.1 and §68.1). They represent a pattern observed more broadly: features/infra scaffolding that is known to be unused but retained without a scheduled removal date or tracking ticket.

---

## Corrections to Earlier Findings

### 5.2 (update) — `interface` violations are 7, not 4
The full list is:
- `Knead/models/KneadBlob.ts:1,16`
- `AudioEngine/repositories/deviceStrategy/AudioDeviceStrategy.ts:4`
- `AudioEngine/engine/TrackNode.ts:11`
- `Plugin/ProofChamber/stores/chamberStore.ts:8`
- `Plugin/ProofChamber/models/ProofChamberState.ts:3,20`

### 5.3 (update) — namespace import violations are 14, not 2
Sampler module: 9 files use `import * as bridge from '../../repositories/samplerBridge'`. CrdtDocument module: 5 files use `import * as Automerge from '@automerge/automerge'`. The Automerge case may be forced by the library's API surface (no default named exports); the Sampler `bridge` namespace should use named imports.

---

## §133 — `useAppInitialization.ts` — double plugin registration on startup

### 133.1 `registerBuiltinPlugins()` and `registerBuiltinFaustDSP()` called twice

`initializeAudioEngine.ts` (lines 21–22):
```ts
registerBuiltinPlugins();
registerBuiltinFaustDSP();
```

`useAppInitialization.ts` (lines 57–58), after `await initializeAudioEngine()` returns:
```ts
registerBuiltinPlugins();   // duplicate
registerBuiltinFaustDSP();  // duplicate
registerProModulationEffects();
registerProSynthInstruments();
```

On every startup both functions are called twice. The plugin registry uses `Map.set()` so there is no crash — the second call silently overwrites the first registration. The immediate impact is doubled `WorkletNode` instantiation cost and confusing state (plugins appear registered before `initializeAudioEngine()` resolves, then registered again from the hook). `registerProModulationEffects()` and `registerProSynthInstruments()` are called only from the hook, creating an asymmetry that makes it unclear which of the four registration functions belong inside the engine initializer and which belong outside it.

Fix: move all four registration calls to a single site (either always inside `initializeAudioEngine()` or always outside) and remove the duplicates.

---

## §134 — `usePianoRollRenderer.ts` — O(n) pitch lookup per note per frame

### 134.1 `visiblePitches.indexOf(pitch)` — linear scan on every note in every draw pass

`drawActiveNotes` (line 523) and `drawGhostNote` (line 458) both call `visiblePitches.indexOf(displayPitch)` once per note per frame. With 128 visible pitches and 200 notes, each frame executes ~25,600 comparisons from these two functions alone. The array is rebuilt identically every tick (same `scaleType`, `scaleRoot`, `isFolded` inputs). A `pitchToRow: Map<number, number>` built once per `visiblePitches` identity (cache by grid key) would reduce all lookups to O(1).

`drawGhostNotes` (line 414) also calls `tracks.filter(t => t.kind === 'midi' && t.id !== trackId)` on every frame, allocating a new filtered array even when the track list has not changed.

---

## §135 — `automergeRepository.ts` — discarded save loop, wasted actor init, console calls, HMR worker leak

### 135.1 `_loadAllSync` discards `Automerge.save()` return values

Lines 276–279 of `_loadAllSync`:
```ts
for (const doc of this.docs.values()) {
    Automerge.save(doc);  // return value discarded
}
```
`Automerge.save()` is pure and has no observable side-effects — the serialized bytes are thrown away immediately. If the intent was to reset incremental state (force-compact), `Automerge.saveIncremental()` would be the correct call. As-is, every synchronous project load runs N full Automerge serializations for nothing.

### 135.2 Actor ID initialization allocates a throwaway document

Line 59 in the class body:
```ts
private actorId: string = Automerge.getActorId(Automerge.init()).toString();
```
`Automerge.init()` creates a full CRDT document (allocating its internal WASM-backed state) solely so `getActorId` can extract a UUID string from it. The document is then immediately GC'd. `crypto.randomUUID()` would generate the same-quality ID without WASM allocation.

### 135.3 Module-level `_crdtWorker` — HMR orphans in-flight promises

`_crdtWorker` and `_crdtWorkerNextId` are module-level. On HMR the new module creates a fresh Worker while the old Worker's message listeners are left attached. Any in-flight `invokeWorker` promises from before the HMR hold event handlers on the old Worker's `message` event — they will never resolve or reject. The new module starts `_crdtWorkerNextId` at 0, potentially recycling IDs that old listeners are still filtering for.

### 135.4 `console.warn`/`console.error` bypass logger (×4)

Lines 228, 272, 311, 377 — all use `console.warn` or `console.error` directly instead of the `logger` abstraction (§23.3 pattern).

---

## §136 — `useStatusBarMetrics.ts` — `className` overwrite at 60fps

### 136.1 `refs.cpuBar.current.className = ...` clobbers entire class list every frame

Lines 94–100:
```ts
refs.cpuBar.current.className = `h-full rounded-full transition-[width] duration-150 ${
    cpuPct < 50
        ? 'bg-[var(--color-state-success)]'
        : cpuPct < 80
          ? 'bg-[var(--color-state-warning)]'
          : 'bg-[var(--color-state-danger)]'
}`;
```
Writing `className` replaces the entire class attribute string on every frame (60fps). Any class added externally (testing selectors, browser extensions, a11y tools) is silently removed each tick. The color class changes only when the CPU threshold crosses a boundary — a one-time `classList.remove`/`add` on threshold change would avoid the constant string assignment.

---

## §137 — `sampleTaggingHelpers.ts` — stub fingerprint function

## §138 — `automergeSync.ts` — quadratic sync fan-out, O(n) base64 encode, constant duplication

### 138.1 `sendSyncToAllPeers()` generates O(peers × docs) sync messages per local change

`subscribeToCrdtChanges` fires `sendSyncToAllPeers()` on every Automerge document mutation. `sendSyncToPeer` in turn calls `sendDocSyncToPeer` for the root doc plus every branch doc. For 3 peers and 10 documents, each note move or knob sweep dispatches 30 `generateSyncMessage` calls. Automerge will return `null` for unchanged docs (no data sent), but the protocol overhead still occurs per-document per-peer per-store-write.

### 138.2 `bytesToBase64` / `base64ToBytes` — temporary array allocation (§110.4 pattern)

```ts
function bytesToBase64(bytes: Uint8Array): string {
    const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
    return btoa(binary);
}
```
`Array.from(bytes, ...)` materializes the full byte array as a string array before `join`. For a 256KiB CRDT sync payload this creates a 262,144-element temporary array. `String.fromCharCode(...bytes)` spread or a chunked loop would avoid the allocation.

### 138.3 Magic docId constants locally re-declared

`DOC_BRANCHES = '__branches__'` and `DOC_PREFIX_ROOT = 'root'` are declared again at lines 22–23 of this file. These same strings are already defined in `sessionManagement.ts` (§114.2) and `CrdtDocumentTypes.ts`. Three separate definition sites mean a rename requires changes in at least 3 files.

### 138.4 `console.error` × 2 bypass logger

Lines 104 and 117 use `console.error(...)` directly (§23.3 pattern).

---

### 137.1 `generateFingerprint` is a name-hash, not an audio fingerprint

```ts
/**
 * Generate a simple string fingerprint from name + path.
 * In production this would use an audio perceptual hash.
 */
export function generateFingerprint(name: string, path: string): string {
    let hash = 0;
    const str = `${name}:${path}`;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash + char) | 0;
    }
    return `fp-${Math.abs(hash).toString(36)}`;
}
```

The function self-documents as a stub. The computed value is a djb2-style hash of the filename and path string — it does not read audio content. Two samples with identical names at the same path but different content will produce the same fingerprint; the same audio at two paths produces different fingerprints. Similarity search built on this fingerprint will produce arbitrary results.

---

## §139 — `connectFolder/helpers.ts` — mutable shared scan controller; broken progress; weak ID

### 139.1 `export let scanAbortController` — shared mutable; HMR + concurrent scan risks

```ts
export let scanAbortController: AbortController | null = null;
```

Two concurrent scans (browser + Tauri, or two folders triggered in quick succession) overwrite each other's controller — aborting one aborts neither or both. HMR during a scan renders the old controller unreachable from the module's exports; `cancelScan()` post-HMR finds `null` and silently no-ops. The scanning async loop still holds its own captured reference to `signal`, but the UI control is lost.

### 139.2 Progress formula never reaches 100% during scanning

Line 73 (and 126):
```ts
setScanProgress(true, totalFound / Math.max(totalFound + 100, 1));
```
The denominator is always `totalFound + 100` which is always greater than `totalFound`, so the value is always `< 1.0`. For a library of 10,000 files, the progress at file 9,900 is `9900 / 10000 = 0.99` — plausible, but this formula assumes "100 remaining" at every point, producing a non-monotonic estimate that compresses the later stages. Progress jumps to exactly 1.0 only when the `finally` block fires.

### 139.3 Library root ID uses `Math.random()` (§55.3 pattern)

```ts
const id = `lib-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
```
`Math.random()` is unseeded (§55.3 pattern). Use `crypto.randomUUID()`.

### 139.4 Sample ID using colon-delimited path is ambiguous

```ts
id: `${rootId}:${relativePath}`,
```
If `relativePath` contains `:` (valid on some POSIX filesystems), the resulting ID is ambiguous. The separator should be a character that cannot appear in a path (e.g., `#` or a UUID).

---

## §140 — `generateMidiVariations.ts` — escaped newline; unnecessary `any` cast

### 140.1 `\\n\\n` produces literal `\n` text, not newlines, in the LLM prompt

Line 59:
```ts
{ role: 'user', content: `${projectContext}\\n\\n${prompt}` },
```
`\\n` in a template literal produces a two-character sequence (backslash + `n`) rather than an actual newline character. The LLM API receives the literal text `\n\n` between context and prompt instead of blank-line separation. Should use `\n\n` (without the extra backslash) or a multi-line template literal.

### 140.2 `(n: any)` unnecessary type cast on typed data

Line 40:
```ts
.map((n: any) => `[pitch=${n.pitch}...`)
```
`notes` is returned by `getNotesForClip()`, a typed internal function. The `any` annotation suppresses TypeScript's ability to catch typos like `n.startbeat` vs `n.startBeat`. Remove the cast and rely on the inferred type.

---

## §141 — `SpectrumAnalyzer.tsx` — per-frame allocation and O(n²) noise rendering at 60fps

### 141.1 Noise texture drawn with 4,000 individual `fillRect` calls per frame

Lines 56–62:
```ts
for (let nx = 0; nx < width; nx += 3) {
    for (let ny = 0; ny < height; ny += 3) {
        const v = Math.random() * 255;
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(nx, ny, 2, 2);
    }
}
```
For the default 300×120 canvas: (300/3) × (120/3) = 4,000 `fillRect` calls per rAF frame, each with a different `fillStyle` string. At 60fps = 240,000 `fillRect` calls/second plus 240,000 template string allocations for the noise effect alone. The noise pattern is random on every frame — a visually indistinguishable static texture that could be generated once into an `OffscreenCanvas` and bitblitted each frame.

### 141.2 `new Float32Array(fftSize)` allocated on every animation frame — 4 components

`SpectrumAnalyzer.tsx` (line 42), `Oscilloscope.tsx` (line 42), `Goniometer.tsx` (line 36), and `Spectrogram.tsx` (line 81) all allocate a new `Float32Array(analyser.frequencyBinCount)` on every rAF tick. The analyser's `frequencyBinCount` is fixed for the lifetime of the node. Each buffer should be allocated once inside `useEffect` and reused across frames.

### 141.3 `Oscilloscope.tsx` — same noise texture anti-pattern as SpectrumAnalyzer

Lines 49–55 of `Oscilloscope.tsx` duplicate the per-frame noise-overlay loop from §141.1: 4,000+ `fillRect` calls per frame on a 200×80 canvas at 60fps. Identical fix applies.

---

## §142 — `SessionView.tsx` — O(tracks²) slot lookup; local-only clip state

### 142.1 `getClipForSlot` runs O(tracks) scan for each of tracks × scenes slots

```ts
const getClipForSlot = (trackId: string, sceneIndex: number): string | null => {
    const track = tracks.find((t: Track) => t.id === trackId);
    ...
};
```
Called for every scene slot during render: 8 tracks × 8 scenes = 64 `tracks.find()` calls per render. A `Map<string, Track>` built once before the render loop would reduce each lookup to O(1).

### 142.2 `activeSlots` is local state — scene launch doesn't interact with the audio engine

`handleLaunchSlot` and `handleLaunchScene` update local React state only — no audio clip is triggered, no transport command is dispatched. The session view's clip launcher has no connection to `playheadScheduler` or the transport layer. Clicking a slot changes the visual indicator but produces no audio.

---

## §143 — `buildTimelineRenderModel.ts` — full model rebuild on every frame during recording

### 143.1 Recording path allocates O(tracks × clips) objects on every rAF frame

Lines 131–141:
```ts
const recIds = new Set(recClips);   // allocation per frame
const recTracks = cachedModel!.tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) =>
        recIds.has(clip.id) ? { ...clip, endBeat: Math.max(clip.startBeat, liveEnd) } : clip
    ),
}));
return { ...cachedModel!, tracks: recTracks, dataDirty: true };
```
While a recording is active, every rAF call to `buildTimelineRenderModel()` copies the entire model: all `N` track objects (spread) and all `M` clip objects (spread or reused). For 20 tracks × 100 clips = 2,000 object copies per frame at 60fps. Only the `endBeat` of the actively recording clips changes — a targeted mutation of just those clips into the cached model, or a separate ref for the live endpoint, would avoid the full copy.

---

## §147 — `audioRecorder/recording.ts` — 5 module-level recording vars; HMR mid-recording silently discards audio

**File:** `src/modules/AudioEngine/repositories/audioRecorder/recording.ts`

### 147.1 HMR during active recording loses the completion callback

Five mutable module-level variables hold the entire recording session state:

```ts
let mediaStream: MediaStream | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let recordingNode: AudioWorkletNode | null = null;
let recordingWorker: Worker | null = null;
let onRecordingComplete: ((buffer: AudioBuffer) => void) | null = null;
```

`onRecordingComplete` is assigned when the caller invokes `startAudioRecording(..., onComplete)` and cleared inside `buildAndDeliver()` after it fires. If Vite HMR re-evaluates this module while a recording is in progress (e.g. a CSS or unrelated TS file change during a long take), all five variables reset to `null`. When the OPFS worker later completes its drain and sends the `{ type: 'pcm' }` message, `buildAndDeliver()` checks:

```ts
const cb = onRecordingComplete;   // null after HMR
onRecordingComplete = null;
if (!cb || samples.length === 0) {
    terminateWorker();             // worker terminated, audio discarded silently
    return;
}
```

The captured audio is silently discarded. The recording store still shows `isRecording: false` (set by `stopAudioRecording` before the worker delivers), so the user sees no error — the take is simply gone.

The same reset also orphans any live `MediaStream` tracks (microphone stays open in the browser tab until GC), and `recordingNode` and `sourceNode` remain connected inside the old `AudioContext` until cleaned up by the next explicit call.

The `§14.1` fix applies: wrap session state in a class or `Ref` object and export a stable reference.

---

## §148 — Audio-worklet MIDI queues use `Array.shift()` inside `process()`

**Files:** `src/modules/AudioEngine/services/fermenterProcessor.ts`, `levainProcessor.ts`, `toasterProcessor.ts`

### 148.1 `Array.shift()` called inside `process()` on the hard-realtime audio thread

All three instrument processors maintain a sorted JavaScript array (`_queue`) for sample-accurate MIDI scheduling. In `_drainQueue()`, which is called directly from `process()`:

```ts
// toasterProcessor.ts (line 130) — identical pattern in fermenter/levain
while (this._queue.length > 0 && this._queue[0].sampleFrame <= blockEndFrame) {
    this._dispatch(this._queue.shift());   // Array.shift() inside process()
}
```

`Array.shift()` is O(n) — it removes the first element and shifts all remaining elements one index to the left, potentially reallocating the internal backing store when the engine decides to compact. This happens inside `process()`, the hard-realtime callback that runs at strict audio deadlines. CLAUDE.md specifies: "All audio-thread code: no allocation, no mutex locks, no blocking."

The companion `_enqueue()` method uses `Array.splice(lo, 0, msg)`, which also shifts elements. It is called from `port.onmessage` (between process cycles, lower priority), but still in the `AudioWorkletGlobalScope`.

Fix: replace the sorted array queue with a pre-allocated ring buffer or a linked list using a typed array. For typical MIDI densities (< 10 events/block), a small fixed-size circular buffer of 64 slots avoids all allocation.

---

## §149 — `MidiRack.processBlock()` allocates multiple arrays per scheduler block in AudioWorklet

**File:** `src/modules/Yeast/useCases/MidiRack.ts`, `src/modules/Yeast/models/MidiProcessor.ts`

### 149.1 Per-block array churn in `processBlock()`

`MidiRack.processBlock()` runs in the `YeastWorkletProcessor.port.onmessage` handler (AudioWorkletGlobalScope). Each call:

```ts
// Line 49 — spread merge: new array allocation
let current: MidiEvent[] = [...inputEvents, ...scheduled];
current.sort((a, b) => a.timeSamples - b.timeSamples);

// Line 56 — new output array per processor in chain
for (const processor of this.processors) {
    const output: MidiEvent[] = [];         // allocation per processor
    processor.processMidi(current, output, transport);
    current = output;
}

// Line 75 — new output separation array
const output: MidiEvent[] = [];
```

With 3 processors in the rack, each call creates at minimum 5 new arrays plus the `ScheduledEventQueue.drainRange()` which creates 2 more (`drained` and `remaining`):

```ts
// MidiProcessor.ts drainRange() — line 58-69
const drained: MidiEvent[] = [];
const remaining: MidiEvent[] = [];
// ... partition events ...
this.events = remaining;  // also reassigns internal events array
```

### 149.2 Template literal string allocation per MIDI event for active-note key

```ts
// Line 66 — allocates a string for every event in the block
const key = `${... ? event.kind.channel : 0}:${... ? event.kind.note : 0}`;
```

With 10 MIDI events per block, this allocates 10 strings per `processBlock()` call. At 375 blocks/second = 3,750 string allocations/second from this line alone.

**Note:** `port.onmessage` runs between `process()` calls, not inside the hard-realtime callback, so these allocations don't risk immediate dropout. However they run in the `AudioWorkletGlobalScope` and contribute to GC pressure that can cause timing jitter in the subsequent `process()` call.

---

## §150 — `Bacteria/SpectrumAnalyzer.tsx` — 128 gradient objects per render + unguarded `useEffect`

**File:** `src/modules/Bacteria/presentations/components/SpectrumAnalyzer.tsx`

### 150.1 128 `createLinearGradient()` calls per render frame

```ts
// Lines 142–146 — inside loop over 128 bars
const gradient = ctx.createLinearGradient(x, height, x, height - barHeight);
gradient.addColorStop(0, 'rgba(244, 63, 94, 0.6)');
gradient.addColorStop(0.5, 'rgba(244, 63, 94, 0.3)');
gradient.addColorStop(1, 'rgba(244, 63, 94, 0.1)');
ctx.fillStyle = gradient;
```

Each `createLinearGradient()` allocates a `CanvasGradient` object backed by a GPU resource. All 128 are created and immediately discarded on every frame. At 60fps = 7,680 gradient allocations/second. This mirrors the §141.1 noise pattern at a lower frequency but with heavier GPU objects. Fix: use a single solid fill (the alpha difference is imperceptible at bar widths < 3px) or pre-bake the gradient as a cached ImageData.

### 150.2 `useEffect` with no dependency array redraws on every parent re-render

```ts
useEffect(() => {
    draw();
}); // No dependency array
```

`draw()` runs after every render, including parent re-renders unrelated to `fftData` changes. Also applies to `WaveshaperEditor.tsx` and `BezierLfoEditor.tsx` (same pattern). All three should either (a) list `[fftData, width, height, ...]` as deps, or (b) use `requestAnimationFrame` directly for live data.

### 150.3 `new Array(128).fill(0)` and heatmap `shift()` on every render

- Line 107: `const barData = new Array(NUM_BARS).fill(0)` — 128-element generic array per render.
- Lines 129–132: `heatmapRef.current.push([...barData])` (spread copy) followed by `heatmapRef.current.shift()` (O(n) element shift) when trail is full.

---

## §151 — `usePresence.ts` — new Map clone on every peer presence update

**File:** `src/modules/Collaboration/presentations/hooks/usePresence.ts`

### 151.1 Full Map copy for every presence heartbeat

```ts
setPresenceMap((prev) => {
    const next = new Map(prev);   // full Map clone every update
    next.set(data.peerId, existing ? { ...existing, ...data } : data);
    return next;
});
```

Peer presence updates (cursor position, playhead) are broadcast at high frequency (typically every 100–500ms per peer). With 3 peers updating 5 times/sec, this creates 15 new Map objects/second + 15 shallow object spreads. Each expiry timeout fires a second Map clone (lines 37–40). The allocations are on the main thread and won't cause audio issues, but they drive unnecessary React re-renders of every subscriber since a new Map reference triggers a new render. Fix: use a `useRef` for the map, update it in place, and trigger renders only when the visible peer set changes or data differs meaningfully.

---

## §152 — `browserStemSeparation.ts` — module-level ONNX session; double dynamic import per call

**File:** `src/modules/AudioAnalysis/repositories/browserStemSeparation.ts`

### 152.1 Module-level ONNX session reset on HMR loses 235MB cached model

```ts
let cachedSession: OrtSession | null = null;
```

HMR re-evaluation resets `cachedSession` to `null`. The next stem separation call re-creates the ONNX `InferenceSession` from the model buffer, which must be downloaded again (~235MB) unless the browser Cache API retains it. The ONNX session itself (GPU pipeline compilation, memory allocation) must also be rebuilt — a potentially expensive operation. (§14.1 pattern)

### 152.2 `onnxruntime-web` imported twice per separation call

```ts
const ort = await import('onnxruntime-web');   // line 102 — session creation
// ...
const ort = await import('onnxruntime-web');   // line 130 — tensor creation
```

Both calls are inside the returned async function, so every stem separation triggers two `import()` calls. While bundler module caching means the second is a cache hit, the `import()` expression itself creates a Promise chain and a microtask. The `ort` from line 102 should be closed over or captured in the outer closure so the inner function doesn't need to re-import.

---

## §153 — `audioToMidi.ts` — `flatMap` over all clips; spread operator over onset array

**File:** `src/modules/AudioAnalysis/useCases/audioToMidi.ts`

### 153.1 `getAllTracks().flatMap(t => t.clips)` allocates full clip array to find one clip

```ts
const clip = getAllTracks()
    .flatMap((t) => t.clips)     // allocates full flat array of all clips
    .find((c) => c.id === clipId);
```

`flatMap` creates a new array containing every clip from every track before `find` can short-circuit. For 20 tracks × 100 clips = 2,000 clip references allocated just to find one. Replace with:
```ts
const clip = getAllTracks().flatMap(t => t.clips).find(c => c.id === clipId);
// → getAllTracks().reduce<Clip | undefined>((found, t) => found ?? t.clips.find(c => c.id === clipId), undefined)
```
or use two nested loops with early exit.

### 153.2 `Math.max(...onsets.map(...), 1e-8)` spread risks stack overflow

```ts
const maxAmplitude = Math.max(...onsets.map((o) => o.amplitude), 1e-8);
```

`onsets.map()` creates a new array; spreading into `Math.max` passes it as call arguments. For dense percussion audio with many transients, `onsets` can be thousands of entries, risking a stack overflow (§4.4/§117.2 pattern). Also calls `getAllTracks()` a second time on line 192 rather than caching the result from line 164.

---

## §154 — `scheduleMidiNotes.ts` — O(N²) note-off lookup; O(notes × tracks) device lookups inside note loop

**File:** `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts`

### 154.1 O(N²) linear scan to find matching noteOff for each noteOn after Yeast processing

```ts
// Line 243 — called once per noteOn event in processed Yeast output
const offEvt = processed.find((e) => {
    if (e.kind.type !== 'noteOff') return false;
    return e.kind.note === evtNote && e.timeSamples > evt.timeSamples;
});
```

For every noteOn event in `processed`, the entire `processed` array is scanned linearly to find the matching noteOff. With N notes (N noteOn + N noteOff events = 2N total), this is O(N²) comparisons. For 100 simultaneous notes in a chord cluster, 100 × 200 = 20,000 comparisons per scheduler block. Fix: build a `Map<note, noteOff event>` before the loop.

### 154.2 `tracks.find()` and `tracks.filter()` inside the innermost note loop

```ts
// Line 313 — O(tracks) scan for every note with a parentId
toasterParentTrack = tracks.find((t) => t.id === track.parentId);

// Line 327 — O(tracks) filter allocation for every Toaster child note
const children = tracks.filter((t) => t.parentId === toasterParentTrack!.id);
```

Both calls are inside the innermost note loop (per-note, per-scheduler-tick). A `Map<trackId, Track>` built once before the track loop would reduce each lookup to O(1), and `children` could be computed once per track rather than per note.

### 154.3 Device-type dispatch chain calls `.some()` + `.find()` per note

Lines 366-394: for each note, a chain of `track.devices.some(d => d.type === 'fermenter')` + `track.devices.find(...)` is called for 4 device types (fermenter, grand-boule, levain, faust). Each `.some()` and `.find()` scans the devices array. For a track with 4 devices, that is 8 array scans per note. Precompute `const devicesByType: Map<string, Device>` once per track before the note loop.

---

## §155 — `applyAutomation.ts` — O(lanes × tracks) scan per tick; template string key per lane; HMR slew reset

**File:** `src/modules/Transport/useCases/scheduling/applyAutomation/applyAutomation.ts`

### 155.1 Module-level slew Map reset on HMR

```ts
const _pluginParamSlew = new Map<string, number>();
```

HMR re-evaluation clears all slew state. On the next scheduler tick after HMR, the IIR filter has no previous value and initializes `prev = value` — making the first tick look like a step change rather than a smooth transition. This causes a brief zipper-noise artifact in all plugin automations at every HMR event during development. Also, stale keys for removed tracks/devices/params accumulate indefinitely since no cleanup path calls `_pluginParamSlew.delete()`. (§14.1 pattern)

### 155.2 O(lanes × tracks) `tracks.find()` per scheduler tick

```ts
// Line 40 — called for every automation lane on every scheduler tick (~100Hz)
const track = tracks?.find((t) => t.id === lane.trackId);
```

`applyAutomation` runs at the scheduler interval (~100Hz). With 20 automation lanes × 20 tracks = 400 array comparisons per tick = 40,000 comparisons/second. A `Map<string, Track>` keyed by `trackId` built once before the lane loop reduces this to O(1) per lane.

### 155.3 Template literal string allocation per automated plugin parameter per tick

```ts
// Line 68 — allocates a new string every tick for every plugin param lane
const slewKey = `${lane.trackId}:${device.id}:${lane.parameterId}`;
```

The key is stable between ticks but is reconstructed on every call. With 10 plugin parameter lanes at 100Hz = 1,000 string allocations/second. Precompute the key when the lane is created and store it on the lane object, or build a `slewKey` cache keyed by `laneId`.

---

## §156 — `findSimilarSamples.ts` — O(samples²) allocations for Jaccard similarity

**File:** `src/modules/SoundLibrary/useCases/sampleDatabase/findSimilarSamples.ts`

### 156.1 Excessive intermediate allocations in Jaccard computation per sample

```ts
const sampleTags = new Set(s.tags.map((t) => t.name));       // Set + array per sample
const overlap = [...targetTags].filter((t) => sampleTags.has(t)).length;  // spread + filter array
const total = new Set([...targetTags, ...sampleTags]).size || 1;          // 2 spreads + Set
return { sample: s, similarity: overlap / total };            // object per sample
```

For a 10,000-sample library, each `findSimilarSamples` call:
- Allocates 10,000 `Set<string>` objects for sample tags
- Allocates 10,000 `[...targetTags]` arrays for overlap counting
- Allocates 10,000 filtered arrays
- Allocates 10,000 `[...targetTags, ...sampleTags]` union arrays + Sets just to compute union size
- Allocates 10,000 `{ sample, similarity }` wrapper objects
- Then sorts all of them, slices top 10, and maps again — 5 passes total

The union size formula is avoidable: `total = targetTags.size + sampleTags.size - overlap`. The overlap can be computed by iterating `targetTags` once and calling `sampleTags.has()` — no spread needed.

Also: the result depends on auto-generated tags from `sampleTaggingHelpers.ts` whose fingerprint is a path-name hash (§137.1), not audio content. Similarity search on unreliable auto-tags produces arbitrary ranking.

---

## §157 — `builtinSynth.ts` — new `AudioBuffer` + 4,800 `Math.random()` calls per note with noise

**File:** `src/modules/Synth/useCases/builtinSynth.ts`

### 157.1 Per-note noise buffer allocation and generation

```ts
// Lines 163-181 — executed for every note where noiseLevel > 0
const noiseBuffer = new AudioBuffer({ ... length: noiseLen, sampleRate: ctx.sampleRate });
const data = noiseBuffer.getChannelData(0);
for (let i = 0; i < noiseLen; i++) {
    data[i] = Math.random() * 2 - 1;  // ~4,800 iterations at 48kHz × 100ms
}
noiseSource = ctx.createBufferSource();
noiseSource.buffer = noiseBuffer;
```

`noiseLen ≈ ctx.sampleRate × 0.1` = ~4,800 samples. For each note with `params.noiseLevel > 0`, this allocates a new `AudioBuffer`, calls `Math.random()` ~4,800 times, and creates a `BufferSourceNode`. At a 16th-note arpeggiator rate of 120 BPM (8 notes/sec): 38,400 `Math.random()` calls/sec just for noise, plus 8 `AudioBuffer` allocations.

Fix: pre-generate a shared `AudioBuffer` (e.g. 2 seconds of noise) once when the synth initializes. Reuse it across all notes — `AudioBufferSourceNode` can reference the same `AudioBuffer` simultaneously. The `loopStart`/`loopEnd` can be randomized per note to avoid audible repetition.

---

## §158 — `getAutomationValueAtBeat.ts` — two O(n) `filter()` allocations per scheduler tick per lane

**File:** `src/modules/Automation/useCases/automation/getAutomationValueAtBeat.ts`

### 158.1 Dual `filter()` over sorted points allocates two arrays per call

```ts
const before = lane.points.filter((p) => p.beat <= beat);   // O(n) + new array
const after = lane.points.filter((p) => p.beat > beat);     // O(n) + new array
```

`getAutomationValueAtBeat` is called from `applyAutomation` on every scheduler tick (~100Hz) for every automation lane. With 20 lanes: 2,000 calls/second → 4,000 `filter()` allocations/second. For 100 points per lane = 200,000 comparisons/second. Automation points are sorted by `beat`, so a binary search finds the split index in O(log n). Only two adjacent points are needed — the last point with `beat <= target` and the first with `beat > target`. No arrays need to be allocated.

Also: the preceding `state.lanes.find(l => l.id === laneId)` (line 10) adds another O(lanes) scan per call on top of the §155.2 `tracks.find` — both called inside the `applyAutomation` lane loop.

---

## §159 — `importMidiFile.ts` — MIDI parse blocks main thread; note IDs reset between imports

**File:** `src/modules/MIDI/useCases/importMidiFile.ts`

### 159.1 `parseMidiFile` runs synchronously on the main thread

```ts
// Lines 179-183 — acknowledged as a known limitation
await new Promise<void>((resolve) => setTimeout(resolve, 0)); // yield once
const { tracks: parsedTracks } = parseMidiFile(buffer);       // then block
```

The `setTimeout(0)` yields the event loop once before the synchronous parse but does not prevent the parse from blocking the UI. For a large orchestral MIDI file (300,000+ events), `parseMidiFile` may run for 200–500ms on the main thread. The comment self-documents that a Web Worker is the full fix. Until then, users experience a UI freeze and dropped frames during MIDI import.

### 159.2 Note IDs are sequential integers scoped to each import call

```ts
let noteId = 0;
// ...
id: `imp-${t}-${noteId++}`,   // resets to 0 on each import()
```

If two MIDI files are imported and their notes are placed into the same clip (or if `importMidiFile` is called concurrently), the same `id` value can be generated by different imports — e.g. `imp-0-0` from file A and `imp-0-0` from file B. The notes end up in different clips so collision is unlikely in practice, but the ID scheme does not guarantee global uniqueness. (§122.1 pattern)

---

## §160 — `useStatusBarMetrics.ts` — `Array.shift()` at 60fps + per-frame className string

**File:** `src/modules/Workspace/presentations/hooks/useStatusBarMetrics.ts`

### §160.1 — `samples.shift()` at 60fps

```ts
// Line 83-84
if (samples.length > 30) {
    samples.shift();   // O(n) element shift on every frame
}
```

`cpuSamplesRef.current` is a plain `number[]` that grows to 30 elements and then evicts the oldest value via `shift()`. `Array.shift()` moves every remaining element one index to the left — O(n) with potential backing-store reallocation for 30 elements at 60fps. A fixed-size circular buffer (`let head = 0; buf[head++ % SIZE] = load;`) gives O(1) writes with zero allocations.

### §160.2 — className string rebuilt every frame

```ts
// Line 94
refs.cpuBar.current.className = `h-full rounded-full transition-[width] duration-150 ${
    cpuPct < 50 ? '...' : cpuPct < 80 ? '...' : '...'
}`;
```

The template literal is concatenated and assigned to `className` on every rAF tick regardless of whether `cpuPct` crossed a threshold. Three class-name strings are allocated per frame and the entire class list is overwritten. Track `prevTone` in a ref; skip the assignment if the colour band hasn't changed.

---

## §161 — `exportMidiFile.ts` — spread-in-loop stack overflow risk for large MIDI

**File:** `src/modules/MIDI/useCases/exportMidiFile.ts`

### §161.1 — `push(...spread)` inside note loop

```ts
// Line 68-71
for (const event of events) {
    const delta = Math.max(0, event.tick - lastTick);
    trackBytes.push(...writeVarLen(delta), ...event.data);  // spread per event
    lastTick = event.tick;
}
trackBytes.push(...writeVarLen(0), 0xff, 0x2f, 0x00);
```

`Array.prototype.push` with spread (`push(...arr)`) passes each spread element as a separate function argument. V8 caps the number of arguments at roughly 65,536. For a complex MIDI clip with 1,000 events this is safe, but an orchestral import might produce 50,000–100,000 note-on/off pairs; combined with `writeVarLen` bytes the spread argument count can exceed the limit and throw a `RangeError: Maximum call stack size exceeded`.

```ts
// Line 102 — same pattern for final Uint8Array
const bytes = new Uint8Array([...headerChunk, ...trackChunk]);
```

This materialises all bytes into a temporary `number[]` via spread before constructing the `Uint8Array`. For a 50,000-note MIDI clip the intermediate array holds ~500,000 elements.

**Fix:** accumulate into a `Uint8Array` written via `DataView` or use `ArrayBuffer` + typed writes; or replace `push(...arr)` with a helper `pushAll(dst, src)` that uses a `for` loop.

---

## §162 — Bacteria canvas editors — `useEffect` no-dep draw (2 more instances)

**Files:** `src/modules/Bacteria/presentations/components/StepSequencerEditor.tsx`, `src/modules/Bacteria/presentations/components/SpectralBinEditor.tsx`

Same pattern as §150.2. Both editors call `useEffect(() => { draw(); })` with no dependency array, triggering a full canvas redraw on every React render regardless of whether `steps`/`values`, `numSteps`, or `mode` changed.

```ts
// StepSequencerEditor.tsx:30  SpectralBinEditor.tsx:32
useEffect(() => {
    draw();
});   // ← no dep array
```

Five canvas editors in the `Bacteria` module share this anti-pattern (§150.2 + this finding): `SpectrumAnalyzer`, `WaveshaperEditor`, `BezierLfoEditor`, `StepSequencerEditor`, `SpectralBinEditor`. All should add a dependency array containing the data slice that drives their canvas (`steps`, `numSteps`, `binValues`, `mode`, etc.).

---

## §163 — `Fermenter/SpectrumAnalyzer.tsx` — `ctx.save()/restore()` per bar; per-bar template strings

**File:** `src/modules/Fermenter/presentations/components/SpectrumAnalyzer.tsx`

### §163.1 — Full context push/pop per bar

```ts
// Lines 101-106
for (let i = 0; i < numBins; i++) {   // numBins ≤ 64
    ctx.save();
    ctx.shadowColor = barColor;
    ctx.shadowBlur = 6;
    ctx.fillStyle = `rgba(${r},${g},${b},0.8)`;
    ctx.fillRect(...);
    ctx.restore();
}
```

`ctx.save()` copies the full 2D rendering context state (transform, clip, shadow, composite, etc.) onto a stack; `ctx.restore()` pops it. Calling them per bar (up to 64 times per draw) pushes and pops 64 full state copies. The fix is to hoist `shadowColor` and `shadowBlur` above the loop, call `ctx.save()` once before the loop and `ctx.restore()` once after.

### §163.2 — Template strings per bar

Lines 98 and 104 construct `rgb(${r},${g},${b})` and `rgba(${r},${g},${b},0.8)` strings for each of the 64 bars on every draw. Since the `useEffect` deps are `[buffer, width, height]`, this fires every time `buffer` updates. If `buffer` is a live telemetry stream the string allocation is continuous.

---

## §164 — `Fermenter/SignalFlowView.tsx` — node graph rebuilt on every render

**File:** `src/modules/Fermenter/presentations/components/SignalFlowView.tsx`

```ts
// Lines 60-283 — OUTSIDE useEffect, runs on every render
const nodes: FlowNode[] = [];
const connections: Array<[number, number]> = [];
// ... push 15-20 FlowNode objects + 15-20 connection tuples
```

The `nodes` and `connections` arrays are built at the top of the component body, allocating ~35 objects on every render. The `useEffect` correctly deps on `[patch, numLayers, activeLayer]`, but the node/connection construction runs unconditionally before that guard fires. Since CLAUDE.md prohibits `useMemo`, the fix is to move the node-building code inside the `useEffect` callback itself, where it would only run when the deps actually change.

---

## §165 — `ScoringPanel` — StrobeDisplay and HistoryGraph redraw on every telemetry tick

**File:** `src/modules/Scoring/presentations/views/ScoringPanel.tsx`

### §165.1 — StrobeDisplay: rAF loop torn down on every `cents` change

```ts
// Lines 372, 435
useEffect(() => {
    // starts rAF loop
    return () => cancelAnimationFrame(rafRef.current);
}, [cents, active]);  // ← re-runs each telemetry tick
```

`cents` is a telemetry value polled from a `SharedArrayBuffer` slot (via `scoringStore`). It updates ~20–60 times per second. Each update causes `useEffect` to cancel the current rAF loop and schedule a new one on the next React commit. This creates a one-frame gap on every `cents` change, producing visible flicker in the strobe visualization. The fix: remove `cents` from deps, read it via `centsRef.current` inside the stable `draw()` closure, as done in `usePianoRollRenderer.ts`.

### §165.2 — StrobeDisplay: per-pixel `fillStyle` string + `fillRect` (480 ops/frame)

```ts
// Lines 405-417
for (let x = 0; x < width; x += 1) {   // width = 480
    ctx.fillStyle = `rgb(${red},${green},${blue})`;   // new string per pixel
    ctx.fillRect(x, 0, 1, height);                    // 1-pixel rectangle
}
```

480 string allocations + 480 separate `fillRect` calls per rAF frame. `ImageData` / `Uint8ClampedArray` direct pixel writes would eliminate all string allocations and reduce the draw to a single `putImageData` call.

### §165.3 — HistoryGraph: `Array.shift()` on 300-element buffer + redraw on each tick

```ts
// Lines 444-521
useEffect(() => {
    historyRef.current.push(cents);
    if (historyRef.current.length > 300) {
        historyRef.current.shift();  // O(n=300) element shift
    }
    // ... full canvas redraw
}, [cents, active]);  // fires on every scoring telemetry tick
```

Same O(n) `shift()` pattern as §160.1, on a 300-element buffer. Also `useEffect` on `[cents, active]` triggers a full canvas redraw on every telemetry tick (§165.1 pattern) rather than accumulating history in a circular buffer and rendering independently via rAF.

---

## §166 — `GrandBoule/SpectralWaterfall.tsx` — per-cell `fillStyle` string allocation

**File:** `src/modules/GrandBoule/presentations/components/SpectralWaterfall.tsx`

```ts
// Lines 138-143  (inner loop body, up to 128 × 176 = 22,528 iterations per frame)
const [r, g, b, a] = colorMap(mag);
ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${(a / 255).toFixed(2)})`;
ctx.fillRect(x, y, cw, rh);
```

For a loud signal with few silent cells the waterfall draws up to 128 × 176 = 22,528 cells per rAF frame. Each cell: one `colorMap` call (2 branches, 6 multiplications), one template-literal string allocation (includes `.toFixed(2)` which produces a 4-char string), and one `fillRect`. The `if (mag <= 0.01) continue` guard significantly reduces this in practice, but a dense harmonic signal (full keyboard played fortissimo) can approach the worst case. The canonical fix is to use an `ImageData` buffer pre-populated by `colorMap` writing to `Uint8ClampedArray` and issued via a single `putImageData`.

---

## §167 — `playheadScheduler.ts` — 8 module-level mutable vars; `any` casts to access injected property

**File:** `src/modules/Transport/useCases/playheadScheduler.ts`

### §167.1 — Module-level playback state HMR reset

```ts
// Lines 22-30
let timerId: ReturnType<typeof setTimeout> | null = null;
let lastTickTime = 0;
let accumulatedPosition = 0;
let lastScheduledBeat = -1;
const scheduledAudioClips = new Set<string>();
const scheduledFrozenTracks = new Set<string>();
const activeAudioSources: AudioBufferSourceNode[] = [];
let punchRecordingActive = false;
let punchRecordingClipIds: string[] = [];
```

HMR during playback re-evaluates the module. `timerId` becomes `null` in the new module while the old timer is still firing. `scheduledAudioClips` and `scheduledFrozenTracks` are empty, causing every clip to be rescheduled and double-played. `activeAudioSources` is empty while live `AudioBufferSourceNode`s still hold references and play — they can no longer be stopped via `stopPlayheadScheduler()`, creating orphaned WebAudio nodes that play until they end or the context is closed. This is the most complete §14.1 instance in the codebase, because it affects the entire audio scheduling pipeline. (§14.1 pattern)

### §167.2 — `as any[]` cast to access dynamically injected `fadeGainNode`

```ts
// Lines 94, 132, 256 — repeated in 3 places
for (const src of activeAudioSources as any[]) {
    if (src.fadeGainNode) { ... }   // property injected in scheduleAudioClips.ts:133
}
```

`fadeGainNode` is attached to `AudioBufferSourceNode` in `scheduleAudioClips.ts:133` via `(source as any).fadeGainNode = fadeGain`. There is no typed wrapper type; the cast to `any[]` is needed in 3 places to access it. If the property name changes in one location the other will silently become `undefined`. Fix: define `type ScheduledSource = AudioBufferSourceNode & { fadeGainNode?: GainNode }` and use it consistently.

### §167.3 — Full track-store spread inside audio-recording callback

```ts
// Lines 178-186  (inside startAudioRecording callback, fires at record-stop time)
trackStore.set({
    ...ts,
    tracks: ts.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) =>
            c.id === recClip.id ? { ...c, audioBufferId: bufferId } : c
        ),
    })),
});
```

O(tracks × clips) object spread just to update one clip's `audioBufferId`. For a 20-track × 100-clip project this creates 2,000 new objects each time recording stops. (§143.1 pattern)

---

## §168 — `scheduleAudioClips.ts` — module-level `requestedAssets` HMR reset; `Math.random` ID in scheduler

**File:** `src/modules/Transport/useCases/scheduling/scheduleAudioClips.ts`

### §168.1 — `requestedAssets` module-level Set cleared on HMR

```ts
// Line 23
const requestedAssets = new Set<string>();
```

HMR re-evaluation clears this guard Set. On the next scheduler tick, every missing collaborative asset is re-requested simultaneously — potentially dozens of `requestAsset()` calls for each missing clip. (§14.1 pattern)

### §168.2 — `Math.random` recording buffer ID in scheduler

```ts
// playheadScheduler.ts:173
const bufferId = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
```

Non-cryptographic, non-unique: 6 base-36 characters → 36^6 ≈ 2.2 billion possible IDs. Multiple simultaneous recordings (multi-track) within the same millisecond could collide. Use `crypto.randomUUID()`. (§55.3 pattern)

---

## §169 — `songStructureDetection.ts` — spread risk for large arrangements; unreachable branch

**File:** `src/modules/Arrangement/useCases/songStructureDetection.ts`

### §169.1 — `Math.min/max(...spread)` on all clips

```ts
// Lines 72-73
const minBeat = Math.min(...allClips.map((c) => c.startBeat));
const maxBeat = Math.max(...allClips.map((c) => c.endBeat));
```

Two passes — each maps then spreads `allClips` as function arguments. For a dense project with 1,000+ clips (common in automated MIDI or sample-heavy arrangements) the spread exceeds V8's ~65,536-argument limit and throws `RangeError`. Use a `for` loop with a running min/max instead (§4.4 pattern).

### §169.2 — Dead `else if (isHigh && progress > 0.5)` branch

```ts
// Lines 149, 155
} else if (isHigh) {
    sectionInfo = SECTION_PALETTE[3]!; // Chorus — matches ALL isHigh cases
    confidence = 0.7;
} else if (isLow) {
    ...
} else if (isHigh && progress > 0.5) {   // ← never reached: isHigh already matched line 149
    sectionInfo = SECTION_PALETTE[7]!; // Drop
```

The `else if (isHigh && progress > 0.5)` at line 155 can never be reached because the unconditional `else if (isHigh)` at line 149 matches all `isHigh === true` cases. The Drop classification was intended to apply only when `isHigh && progress > 0.5`; the current code silently classifies all high-energy late sections as Chorus instead of Drop.

---

## §170 — `semanticChangeContext.ts` — module-level context cleared on HMR mid-action

**File:** `src/modules/CrdtDocument/useCases/semanticChangeContext.ts`

```ts
// Line 18
let currentContext: SemanticContext | null = null;
```

`currentContext` is set by `executeAppAction` before a store mutation and read by `AutomergeStorage.#writeToCrdt` when the store fires its change event. These are synchronous, so in production the window between `set` and `read` is a single JS task. However, in development, if HMR re-evaluates this module during that task (unusual but possible during hot editing of the context module itself), `currentContext` is reset to `null` and the CRDT mutation is recorded with no semantic label — silently corrupting the undo history label. (§14.1 pattern)

---

## §171 — `assetTransfer.ts` — `Array.from` base64 encoding allocates 262K strings per 256 KiB chunk

**File:** `src/modules/Collaboration/useCases/assetTransfer.ts`

```ts
// Line 238
function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
}
```

For each 256 KiB chunk sent: `Array.from` materialises 262,144 single-character strings; `.join('')` concatenates them into a 262,144-char string; `btoa()` encodes it to base64. A 10 MB audio file split into 40 chunks requires ~10.5 million string allocations plus 40 `join` concatenations of 256 K characters each. The allocation pattern is the same as §138.2 (`automergeSync.ts`). Fix: `btoa(String.fromCharCode(...new Uint8Array(buffer)))` — still uses spread (stack risk for large buffers), or use the TextDecoder / a streamed base64 encoder.

---

## §172 — `LoudnessHistory.tsx` — `Array.shift()` on 300-element history while sibling uses circular buffer

**File:** `src/modules/Proof/presentations/components/LoudnessHistory.tsx`

```ts
// Lines 34–39
useEffect(() => {
    const history = historyRef.current;
    history.push(momentaryLufs);
    if (history.length > HISTORY_LENGTH) {
        history.shift(); // O(n) — shifts 299 elements on every update
    }
    // ... draw ...
}, [momentaryLufs, targetLufs, integratedLufs, width, height]);
```

`HISTORY_LENGTH` is 300. At the component's stated update rate of 10fps this is 3,000 element moves per second — less severe than the 60fps instances in §160.1 and §165.3, but still unnecessary. The sibling component `GrHistory.tsx` (same directory) solves the identical problem correctly with a pre-allocated `Float32Array` and a `posRef` write-position index (circular buffer). `LoudnessHistory` should adopt the same pattern.

---

## §173 — `audioAiEngine.ts` — `Array.from(new Uint8Array(audioData))` materialises entire audio buffer as boxed number array for Tauri IPC

**Files:** `src/modules/AudioAnalysis/repositories/audioAiEngine.ts`, `src/modules/AudioEngine/useCases/decodeAudioFile.ts`

```ts
// audioAiEngine.ts:95 (stem separation)
const wavBytes = Array.from(new Uint8Array(audioData)); // number[]
await tauriInvoke('write_audio_file', { path: tempPath, data: wavBytes });

// decodeAudioFile.ts:34 (every audio file import on desktop)
await invoke('write_audio_file', {
    path: tempPath,
    data: Array.from(new Uint8Array(arrayBuffer)),
});
```

`Array.from` converts every byte of the audio `ArrayBuffer` into a boxed `number` object. A stereo 44.1 kHz recording at 32-bit float is 2 × 44100 × 4 = 352,800 bytes/sec; a 5-minute stem separation input allocates ~105 million boxed numbers in one synchronous call, saturating the GC before Tauri IPC even begins. The `decodeAudioFile` path is triggered on every audio import in the Tauri desktop app. The Tauri `invoke` bridge accepts `Uint8Array` directly via Tauri v2's `ArrayBuffer` transfer — remove the `Array.from` and pass the `Uint8Array` directly.

---

## §174 — `useProofAnalyser` + `TonalBalance` — live FFT display is a static snapshot; canvas never redraws

**Files:** `src/modules/Proof/presentations/hooks/useProofAnalyser.ts`, `src/modules/Proof/presentations/components/TonalBalance.tsx`

`useProofAnalyser` correctly reuses a pre-allocated `Float32Array` and mutates it in place via `getFloatFrequencyData`:

```ts
// useProofAnalyser.ts:39
dataRef.current = new Float32Array(analyser.frequencyBinCount);

// line 49 — mutates in place, object identity unchanged
analyserRef.current.getFloatFrequencyData(dataRef.current);
setTick((t) => t + 1); // triggers re-render
```

`ProofPanel` then passes `fftData={dataRef.current}` to `TonalBalance`. Because the `Float32Array` reference is always the same object, `TonalBalance`'s `useEffect` dep array `[fftData, sampleRate, fftSize, genre, width, height]` sees no change on any 15fps tick — `fftData` reference is stable. React fires the effect only on the initial mount (when `fftData` transitions from `null` to the Float32Array). All subsequent data updates are silently ignored and the canvas remains frozen at first-render values.

**Fix:** Either (a) return `{ fftData: dataRef.current, tick }` from the hook and add `tick` to `TonalBalance`'s dep array, or (b) move the rAF loop into `TonalBalance` itself and accept an `AnalyserNode` prop.

---

## §175 — `Grinder/grinderParamBridge/helpers.ts` — 8th copy of `createFindDeviceRef`

**File:** `src/modules/Grinder/useCases/grinderParamBridge/helpers.ts:8–17`

Verbatim duplicate of the same `createFindDeviceRef` factory documented in §33.1 (6 copies) and §53.1 (7th copy in ProofChamber). Total across the codebase is now at least 8 modules each carrying their own copy. The fix remains the same: extract to `#/helpers/Device/createFindDeviceRef.ts` and import.

---

## §176 — `inputMonitoring.ts` — module-level `monitorStream`/`monitorSource` leak live MediaStream on HMR

**File:** `src/modules/AudioEngine/repositories/audioRecorder/inputMonitoring.ts`

```ts
let monitorStream: MediaStream | null = null;
let monitorSource: MediaStreamAudioSourceNode | null = null;
```

On HMR, the module is re-evaluated and both vars reset to `null`. If the user was monitoring input at the time, the `MediaStream` tracks are never stopped and the `MediaStreamAudioSourceNode` is never disconnected — the microphone remains open and the audio routes to the track gain node indefinitely. `stopInputMonitoring()` after HMR is a no-op since both vars are `null`. The pattern is the same as §129.1 and §147.1. Fix: persist state through module re-evaluation or stop monitoring on `import.meta.hot.dispose`.

---

## §177 — `yeastStore.ts` — 4 module-level mutable vars orphan `MidiRack` and `AudioWorkletNode` on HMR

**File:** `src/modules/Yeast/stores/yeastStore.ts`

```ts
let rackInstance: MidiRack | null = null;
const processorTypeMap = new Map<string, ProcessorType>();
let _workletNode: YeastWorkletNodeResult | null = null;
let _workletNodePromise: Promise<YeastWorkletNodeResult | null> | null = null;
```

On HMR all four are reset. Consequences:
- `rackInstance` resets to `null`: the old `MidiRack` is orphaned and continues to exist on the main thread with no reference; its internal processor list is lost
- `processorTypeMap` is cleared: processor type mappings are gone; `syncStoreFromRack()` falls back to `inferType()` (string-match heuristic) for any remaining processors
- `_workletNode` resets: the old `AudioWorkletNode` is disconnected from the new module but continues to run in the AudioWorklet global scope; the new lazy-init call creates a second concurrent worklet node (§14.1 / §128.1 pattern)

`console.warn` on worklet init failure at line 67 also bypasses the `logger` abstraction (§23.3).

---

## §178 — `moveClipPreview.ts` — O(tracks × clips) store write on every drag-move event

**File:** `src/modules/Arrangement/useCases/clip/moveClipPreview.ts`

```ts
// Lines 14–33 — called on every pointermove during clip drag
const tracksWithoutClip = state.tracks.map((t) => {
    // ...
    return { ...t, clips: t.clips.filter((c) => c.id !== clipId) }; // clone every track + clips
});
setTrackState({
    ...state,
    tracks: tracksWithoutClip.map((t) =>
        t.id === movedClip!.trackId ? { ...t, clips: [...t.clips, movedClip!] } : t
    ),
});
```

On every drag-move event the function performs two full `map` passes over all tracks, each filtering and spreading its clips array. For 30 tracks × 100 clips this allocates ~3,000 clip objects per pointermove, then triggers a full store update and React re-render of every clip on every track. Additionally, `shiftClipMidiNotes` (line 49) writes the MIDI store with a further allocation per moved MIDI note. The pattern is the same as §74.2 and §143.1. A ghost-clip preview (mutate only the ghost position, not the real store) would eliminate the hot-path allocations and store writes.

---

## §179 — `reverseClip.ts` — `OfflineAudioContext` created solely to call `createBuffer`, then orphaned

**File:** `src/modules/Arrangement/useCases/clipEditing/reverseClip.ts`

```ts
// Lines 19–20
const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
const reversed = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
```

`OfflineAudioContext` is created but `ctx.startRendering()` is never called — the context object is created purely to access `createBuffer`, then immediately orphaned. An `OfflineAudioContext` is a heavyweight object (allocates an internal audio graph, rendering buffers, and a worker pool). The `AudioBuffer` constructor achieves the same thing without the context: `new AudioBuffer({ numberOfChannels, length, sampleRate })`. `Date.now()` is also used for the new buffer ID at line 28 (§122.1 pattern).

---

## §180 — `createEventBus.ts` — `promises` array allocated on every high-frequency `emit` call; `console.error` bypasses logger

**File:** `src/infra/events/createEventBus.ts`

```ts
// Line 29 — allocated on every emit where handlers exist
const promises: Promise<void>[] = [];
```

`emit` is the hot path for all DAW events including `transport.tick`, telemetry updates, and MIDI. For events with only synchronous handlers (the majority), `promises` is allocated, stays empty, and is discarded after `if (promises.length > 0)` guards against `await`. Fix: defer allocation until an async handler is found (`const promises: Promise<void>[] = []; ` → allocate lazily on first push).

`console.error` at lines 38 and 49 also bypasses the `logger` abstraction (§23.3).

---

## §181 — `MiniMasterSpectrum.tsx` — `createLinearGradient` allocated on every rAF frame; rAF loop restarted on selection change

**File:** `src/modules/Arrangement/presentations/views/MiniMasterSpectrum.tsx`

```ts
// Line 50 — inside the rAF draw() loop
const gradient = ctx.createLinearGradient(0, height, 0, 0);
gradient.addColorStop(0, 'rgba(217, 119, 6, 0.4)');
gradient.addColorStop(0.5, 'rgba(234, 179, 8, 0.8)');
gradient.addColorStop(1, 'rgba(252, 211, 77, 1)');
```

`createLinearGradient` is a GPU-backed object. Creating 60 per second and immediately discarding them stresses the GPU resource allocator. Fix: create the gradient once in `useEffect`, before the loop.

The `useEffect` deps array `[isSelected]` also cancels and restarts the rAF loop every time the master track is selected or deselected, causing a one-frame spectrum blackout on each click (§165.1 pattern).

---

## §182 — `BeatRulerBar.tsx` — canvas dimensions reset + gradient allocated on every draw; side effect during render; rAF loop re-registered on every re-render

**File:** `src/modules/Arrangement/presentations/views/BeatRulerBar.tsx`

Four compounding issues in `drawRuler`:

**1. Canvas dimensions reset at 60fps (line 72–74)**
```ts
// Inside drawRuler(), called from the rAF loop during playback
canvas.width = w * dpr;   // clears all pixel data
canvas.height = h * dpr;  // resets 2D context transform/state
ctx.scale(dpr, dpr);
```
Assigning to `canvas.width` unconditionally resets all canvas pixel data and clears the 2D context state (transform, clip, compositing, etc.) even when dimensions are unchanged. This fires at 60fps during playback. Fix: cache `lastW`/`lastDpr` and only resize when values actually change.

**2. `createLinearGradient` on every draw call (line 77)**
```ts
const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
bgGrad.addColorStop(0, '#151518');
bgGrad.addColorStop(1, '#111114');
```
GPU gradient object allocated and discarded on every `drawRuler` call (up to 60/sec during playback — §181.1 pattern). Fix: cache after first DPR-aware resize.

**3. Side effect during render (lines 226–228)**
```ts
// Outside any useEffect — executes in component render body
if (canvasRef.current) {
    drawRuler(canvasRef.current, playheadPositionRef.current);
}
```
Canvas drawing during the React render phase is a side effect. It runs synchronously on every re-render of the component, including renders triggered by scroll, transport store changes, and collaboration heartbeats.

**4. `drawRuler` in `useEffect` dep array without `useCallback` (line 216)**
```ts
useEffect(() => {
    const loop = () => { drawRuler(canvasRef.current, ...); };
    animationScheduler.register(`beat-ruler-${id}`, loop);
    return () => animationScheduler.unregister(`beat-ruler-${id}`);
}, [isPlaying, drawRuler]); // drawRuler has no useCallback — new ref every render
```
`drawRuler` is defined in the component body without `useCallback`. Its reference changes on every render, causing the rAF loop to be unregistered and re-registered on every re-render during playback. The captured `loop` closure also closes over `pixelsPerBeat`/`scrollX` from the render that produced it — the loop is briefly stale between the unregister/re-register pair.

---

## §183 — `TrackListView.tsx:159` — `window.confirm()` blocks main thread (and audio thread) for track deletion

**File:** `src/modules/Arrangement/presentations/views/TrackListView.tsx`

```ts
// Line 159
if (track && window.confirm(`Delete track "${track.name}"?`)) {
    removeTrack(selectedTrackId);
}
```

`window.confirm()` is a synchronous blocking dialog. While the dialog is open:
- The JS event loop is frozen (no rAF, no timer callbacks, no Web Audio callbacks).
- The audio engine's `setTimeout`-driven playhead scheduler stops advancing; scheduled audio sources may starve.
- The AudioWorklet continues processing audio on its separate thread, but the main-thread scheduler that feeds it new events is blocked.

For a DAW, blocking the main thread mid-playback causes an audible dropout. Fix: replace with a non-blocking confirmation UI (a custom dialog or popover rendered by the existing component system).

---

## §184 — `LevelMeter.tsx` — `crypto.randomUUID()` in render body; `createLinearGradient` + `Array.shift()` at 60fps per meter strip

**File:** `src/modules/Workspace/presentations/views/Metering/LevelMeter.tsx`

Three compounding issues in the mixer level meter:

**1. `crypto.randomUUID()` in render body (line 30)**
```ts
export const LevelMeter = (...): ReactElement => {
    const id = crypto.randomUUID();   // executed on every render
    // ...
    animationScheduler.register(`meter-${id}`, tick);
```
`crypto.randomUUID()` is called at component render time, not inside `useEffect`. On every re-render that does not change `trackId` (e.g. parent re-renders), a new UUID is generated but the old `useEffect` remains registered under the original ID. The UUID generation is unnecessary churn; `id` should be `useRef(crypto.randomUUID()).current`.

**2. `createLinearGradient` on every rAF tick (line 116)**
```ts
const tick = () => {
    // ...
    const grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, safe);
    grad.addColorStop(Math.min(1, dbToPercent(-12) / 100), safe);
    // 4 more addColorStop calls ...
```
A 6-stop GPU gradient object created and discarded on every animation frame at 60fps. With 30 mixer strips visible, this is 1,800 gradient objects/sec across the mixer. The gradient only depends on the meter height (which changes only on resize); hoist it to the `useEffect` body and recreate only in the `ResizeObserver` callback (§181.1 pattern).

**3. `Array.shift()` on RMS buffer at 60fps (line 88)**
```ts
if (buf.length > RMS_BUFFER_SIZE) {
    buf.shift();   // O(n) shift on 30-element array, 60fps per strip
}
```
Same §160.1 pattern. Fix: use a `Float32Array` circular buffer with a write-position index.

---

## §185 — `TrackLevelIndicator.tsx` — `new Float32Array(fftSize)` + rgba template-literal string allocated on every rAF frame per track

**File:** `src/modules/Arrangement/presentations/views/TrackHeader/TrackLevelIndicator.tsx`

```ts
const draw = (): void => {
    const analyser = getTrackAnalyser(trackId);
    let currentDb = DB_FLOOR;

    if (analyser) {
        const data = new Float32Array(analyser.fftSize); // allocated every frame
        analyser.getFloatTimeDomainData(data);
        // ...
    }
    // ...
    ctx.fillStyle = dbToColor(smoothedDb); // rgba template-literal string
```

`new Float32Array(analyser.fftSize)` is allocated on every rAF frame (60fps) per visible track header. With 20 tracks, that is 1,200 `Float32Array` allocations/second (§141.2 pattern). Fix: allocate once in the `useEffect` setup code.

`dbToColor()` constructs a template-literal `rgba(...)` or `rgb(...)` string on every frame (§163.2 pattern). Fix: quantise `smoothedDb` to a band and cache the band's colour string.

---

## §186 — `usePreviewAudio.ts` — `stop()` does not stop tone oscillator; calling `play()` or `stop()` while a tone is active leaves the oscillator running

**File:** `src/modules/Workspace/presentations/hooks/usePreviewAudio.ts`

```ts
const playTone = (id, frequency, durationSec) => {
    stop();  // ← tries to stop previous audio, but see below
    const osc = ctx.createOscillator();
    // ...
    const dummySource = ctx.createBufferSource();   // line 78 — never connected or started
    sourceRef.current = dummySource;                 // stored so stop() can find it
    osc.start();
    osc.stop(ctx.currentTime + durationSec);         // will stop naturally after duration
};

const stop = () => {
    if (sourceRef.current) {
        try {
            sourceRef.current.stop();    // on dummy source: throws InvalidStateError (never started)
        } catch { /* silently ignored */ }
        sourceRef.current.disconnect(); // no-op: dummy source was never connected
        sourceRef.current = null;
    }
    setPlayingId(null);
};
```

**The bug:** `stop()` calls `.stop()` on a dummy `AudioBufferSourceNode` that was never started. The call throws and is silently swallowed. The `osc` oscillator is never stopped — it plays for its full `durationSec` regardless of any `stop()` calls, including the `stop()` at the top of `play()` (line 30).

Consequences:
1. Clicking preview on a second sample while a tone is active does **not** cancel the first tone — two tones play simultaneously.
2. Closing the preview panel does not cancel a running tone.
3. The `playingId` state becomes `null` (from `stop()`) while audio continues playing, putting the UI and audio out of sync.

**Fix:** Store the `OscillatorNode` in `sourceRef` instead of the dummy `BufferSourceNode`. Alternatively, wrap both path types in a uniform stop interface.

---

## §196 — Three more `window.confirm()` callers block the audio thread (§183.1 pattern)

**Files:**
- `src/modules/Workspace/presentations/hooks/useAppEventHandlers.ts:28`
- `src/modules/Arrangement/presentations/views/TrackContextMenu.tsx:165`
- `src/modules/Workspace/presentations/hooks/useChannelStripActions.ts:65`

**Category:** Performance / UX **Severity:** Medium

`window.confirm` is called synchronously on the main thread in three additional places beyond the `TrackListView.tsx:159` already covered at §183.1. Total: **four callers**. All four block JavaScript execution (including the rAF loop and audio scheduler) for the duration the dialog is open, causing an audible audio dropout if the transport is running.

```ts
// useAppEventHandlers.ts:28
if (!window.confirm('Create a new project? Any unsaved changes will be lost.')) return;

// TrackContextMenu.tsx:165
if (window.confirm('Are you sure you want to delete this track? This action cannot be undone.'))

// useChannelStripActions.ts:65
if (window.confirm('Are you sure you want to delete this track? This action cannot be undone.'))
```

Fix: Replace all four with an async non-blocking confirmation dialog (e.g. a `<Dialog>` from the existing component library, or a `notifyUser`-style confirm modal). The audio thread will remain unblocked.

---

## §187 — `GenerativeAiPanel.tsx` — Rules of Hooks violation: two `useStore` calls after an early return

**File:** `src/modules/AiRuntime/presentations/views/GenerativeAiPanel.tsx:107,109`
**Category:** Bug **Severity:** High

```tsx
export const GenerativeAiPanel = (): ReactElement | null => {
    const state = useStore<GenerativeAiState>(aiStore, { ... });  // hook 1 — line 66

    if (!state.isPanelOpen) {
        return null;  // line 78 — early return
    }

    // ... (lines 83–106: handleGenerate, handleStemSep defined)

    // hook 2 — only reached when isPanelOpen is true
    const workspaceState = useStore<GenerativePanelWorkspaceState | null>(workspaceStore, null);  // line 107
    // hook 3 — same
    const trackState = useStore<GenerativePanelTrackState | null>(trackStore, null);  // line 109
```

The `useStore` calls at lines 107 and 109 sit below the early `return null` at line 78. React's Rules of Hooks require hooks to be called in the same order on every render. When `state.isPanelOpen` is false the component returns after hook 1, calling only one hook. When it is true the component calls three hooks. Any toggle of `isPanelOpen` changes the hook call count, causing React to throw an invariant violation in development (`Warning: React has detected a change in the order of Hooks`) and producing unpredictable state corruption in production.

**Fix:** Move the two `useStore` calls to the top of the component body, before any conditional return:

```tsx
const state = useStore<GenerativeAiState>(aiStore, { ... });
const workspaceState = useStore<GenerativePanelWorkspaceState | null>(workspaceStore, null);
const trackState = useStore<GenerativePanelTrackState | null>(trackStore, null);

if (!state.isPanelOpen) {
    return null;
}
```

---

## §188 — `usePromptExecution.ts` — Stale closure in `finally` block silently discards confirmation preview state

**File:** `src/modules/Workspace/presentations/hooks/usePromptExecution.ts:312`
**Category:** Bug **Severity:** Low

```ts
const [preview, setPreview] = useState<PromptPreview | null>(null);

const handleSubmit = async (e: FormEvent): Promise<void> => {
    // ...
    try {
        const result = await parsePromptToActions(value, context, controller.signal);

        if (result.requiresConfirmation && result.actions.length > 0) {
            setPreview(result);         // schedules state update
            setIsProcessing(false);
            return;                     // exits try block — finally still runs
        }
        // ...
    } finally {
        abortRef.current = null;
        setIsProcessing(false);
        if (!preview) {                 // reads stale closure value — always null!
            setValue('');               // always runs, even after setPreview(result) above
        }
    }
};
```

When `result.requiresConfirmation` is true, `setPreview(result)` is called but React doesn't flush synchronously. The `preview` captured in the `handleSubmit` closure still refers to its value at the time the function was created (initially `null`). The guard `if (!preview)` therefore always evaluates to `true`, so `setValue('')` always clears the prompt input — even when a confirmation preview has just been set. The developer intent (preserve input text while a preview is visible) is never fulfilled.

**Fix:** Read the value to be set into a local variable before the `finally`, or track a flag:

```ts
let showingPreview = false;
if (result.requiresConfirmation && result.actions.length > 0) {
    setPreview(result);
    setIsProcessing(false);
    showingPreview = true;
    return;
}
// ...
} finally {
    abortRef.current = null;
    setIsProcessing(false);
    if (!showingPreview) {
        setValue('');
    }
}
```

---

## §189 — `Oscilloscope.tsx`, `SpectrumAnalyzer.tsx`, `Goniometer.tsx` — `new Float32Array` allocated inside rAF draw loops (three more §141.2 instances)

**Files:**
- `src/modules/Workspace/presentations/views/Metering/Oscilloscope.tsx:42`
- `src/modules/Workspace/presentations/views/Metering/SpectrumAnalyzer.tsx:42`
- `src/modules/Workspace/presentations/views/Metering/Goniometer.tsx:36`

**Category:** Performance **Severity:** Low

All three metering components allocate a `new Float32Array` on every animation frame:

```ts
// Oscilloscope.tsx:42 — frequencyBinCount typically 1024 → 4 KB/frame
const data = new Float32Array(bufferLength);
analyser.getFloatTimeDomainData(data);

// SpectrumAnalyzer.tsx:42 — same
const freqData = new Float32Array(fftSize);
analyser.getFloatFrequencyData(freqData);

// Goniometer.tsx:36 — same
const data = new Float32Array(analyser.frequencyBinCount);
analyser.getFloatTimeDomainData(data);
```

Each metering component shown simultaneously contributes to GC pressure (§141.2 pattern, 8th / 9th / 10th instances). `LUFSMeter.tsx` already demonstrates the correct pattern: allocate once in the `useEffect` closure and reuse, reallocating only when `frequencyBinCount` changes.

---

## §190 — `Oscilloscope.tsx` and `SpectrumAnalyzer.tsx` — noise texture redrawn with `Math.random()` + template-literal `rgb()` strings on every rAF tick

**Files:**
- `src/modules/Workspace/presentations/views/Metering/Oscilloscope.tsx:49–54`
- `src/modules/Workspace/presentations/views/Metering/SpectrumAnalyzer.tsx:56–62`

**Category:** Performance **Severity:** Medium

Both components overlay a grain texture by looping over a 3-pixel grid and calling `Math.random()` + allocating a `rgb(v,v,v)` template string per cell on every draw frame:

```ts
// Oscilloscope.tsx — 200×80 canvas → (200/3)×(80/3) ≈ 1,716 iterations / frame
ctx.globalAlpha = 0.025;
for (let nx = 0; nx < width; nx += 3) {
    for (let ny = 0; ny < height; ny += 3) {
        const v = Math.random() * 255;
        ctx.fillStyle = `rgb(${v},${v},${v})`;   // string allocation per cell
        ctx.fillRect(nx, ny, 2, 2);
    }
}

// SpectrumAnalyzer.tsx — 300×120 canvas → 4,000 iterations / frame
```

At 60 fps this produces approximately 103,000 string allocations per second (Oscilloscope) and 240,000 per second (SpectrumAnalyzer). The combined steady-state GC pressure across both components is material.

The noise effect is quasi-static and imperceptible at a per-pixel level. Options to eliminate the hot path:
1. Generate one noise `ImageData` once (outside the draw loop) and draw it with `ctx.putImageData` or `ctx.drawImage` at low `globalAlpha`.
2. Pre-render the grain onto an `OffscreenCanvas` and blit it each frame.

---

## §191 — `SpectrumAnalyzer.tsx` — `createLinearGradient` with 5 color stops inside rAF draw loop

**File:** `src/modules/Workspace/presentations/views/Metering/SpectrumAnalyzer.tsx:105`
**Category:** Performance **Severity:** Low

```ts
// Inside draw() — called at 60 fps
const grad = ctx.createLinearGradient(0, height, 0, 0);
grad.addColorStop(0, 'rgba(0,80,220,0.05)');
grad.addColorStop(0.3, 'rgba(0,180,220,0.15)');
grad.addColorStop(0.5, 'rgba(0,210,120,0.25)');
grad.addColorStop(0.7, 'rgba(200,200,0,0.35)');
grad.addColorStop(1, 'rgba(255,50,0,0.45)');
```

A new GPU gradient object is created and five color stops are registered on every animation tick (§181.1 pattern, 5th instance). The gradient dimensions depend only on `height`, which is a React prop that changes only when the component resizes. The gradient can be created once in the `useEffect` closure (outside `draw`) and reused every frame, recreating only when `height` changes.

---

## §192 — `Goniometer.tsx` — `ctx.getImageData()` on every rAF tick: synchronous GPU readback

**File:** `src/modules/Workspace/presentations/views/Metering/Goniometer.tsx:113`
**Category:** Performance **Severity:** Low

```ts
// Inside draw() — called at 60 fps
// Save frame for phosphor trail
trailRef.current = ctx.getImageData(0, 0, size, size);
```

`getImageData` performs a synchronous pixel readback from the Canvas compositing buffer to CPU-accessible memory. For a 120×120 canvas this copies 57,600 bytes (4 bytes/pixel × 14,400 pixels) every frame. The call stalls the main thread until the GPU finishes writing the current frame (a pipeline flush), adding latency to the rAF budget and contributing to jank when other JS work is scheduled nearby.

An alternative phosphor trail implementation avoids the readback entirely: draw each frame onto a persistent `OffscreenCanvas` (the trail accumulator), applying the fade step with `globalAlpha + fillRect` before each Lissajous pass, then blit the offscreen onto the main canvas. This keeps all data GPU-side and avoids the synchronous CPU roundtrip.

---

## §193 — `Spectrogram.tsx`, `PhaseCorrelationDisplay.tsx` — `new Float32Array` in rAF draw loop (instances 11–14 of §141.2 pattern)

**Files:**
- `src/modules/Workspace/presentations/views/Metering/Spectrogram.tsx:81`
- `src/modules/Workspace/presentations/views/Metering/PhaseCorrelationDisplay.tsx:34,41,42`

**Category:** Performance **Severity:** Low

```ts
// Spectrogram.tsx:81 — fftSize typically 1024 → 4 KB / frame
const freqData = new Float32Array(fftSize);

// PhaseCorrelationDisplay.tsx:34,41,42 — THREE allocations per frame
const data = new Float32Array(analyser.frequencyBinCount); // 4 KB
const left = new Float32Array(halfLen);                    // 2 KB
const right = new Float32Array(halfLen);                   // 2 KB
```

`PhaseCorrelationDisplay` is the only metering component that allocates three typed arrays per frame. The fix is the same as for all §141.2 instances: allocate once in the `useEffect` closure and reuse (or reallocate only when `frequencyBinCount` changes), as `LUFSMeter.tsx:57–63` already demonstrates.

---

## §194 — `PhaseCorrelationDisplay.tsx` — `resolveToken` (= `getComputedStyle`) called conditionally inside rAF draw loop

**File:** `src/modules/Workspace/presentations/views/Metering/PhaseCorrelationDisplay.tsx:80–85`
**Category:** Performance **Severity:** Low

```ts
const draw = (): void => {
    // ...
    const color =
        correlation > 0.5
            ? resolveToken('--color-meter-safe', '#00CC44')   // getComputedStyle at 60fps
            : correlation > 0
              ? resolveToken('--color-meter-hot', '#CCCC00')  // getComputedStyle at 60fps
              : resolveToken('--color-meter-clip', '#FF3300'); // getComputedStyle at 60fps
```

`resolveToken` calls `getComputedStyle(document.documentElement).getPropertyValue(property)` — a synchronous style recalculation that is invoked up to once per rAF tick. `LUFSMeter.tsx:48–51` demonstrates the correct pattern: resolve CSS tokens once in the `useEffect` closure before the draw loop begins and cache them in local variables.

---

## §195 — `WaveformEditor.tsx` — `canvas.width/height` reset on every draw, `ResizeObserver` re-registered every render, `trackStore.value` accessed directly during render

**File:** `src/modules/Workspace/presentations/views/ClipView/WaveformEditor.tsx:115–116,213–214,313–315`
**Category:** Performance / Bug **Severity:** Low

Three separate issues in this component:

**1. Canvas dimensions reset unconditionally (§182.1 pattern)**
```ts
// draw() — called on every state/prop change and every ResizeObserver event
canvas.width = width * dpr;   // clears all pixel data
canvas.height = height * dpr; // resets 2D context transform/state
```
Should compare against current `canvas.width`/`canvas.height` before assigning.

**2. `ResizeObserver` re-registered on every render (§182.4 pattern)**
```ts
// Line 208–214
useEffect(() => {
    const observer = new ResizeObserver(() => draw());
    if (containerRef.current) {
        observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
}, [draw]);  // draw is a plain function defined in the component body — new ref every render
```
Because `draw` has no `useCallback`, its reference changes on every render, causing the `useEffect` dep to fire, the old `ResizeObserver` to be disconnected, and a new one registered. During rapid state changes (zoom slider, warp toggles) this causes frequent observer churn.

**3. `trackStore.value` accessed directly during render without subscription**
```ts
// Line 313–315 — inside the render function
const realClipId =
    trackStore.value?.tracks.flatMap((t) => t.clips).find(...)?.id ?? clipId;
```
`trackStore.value` is a direct store read with no React subscription (`useStore` is not used). The component will not re-render when the track list changes, so `realClipId` can become stale without the UI updating.

---

## §201 — `RoutingGraph.tsx` — sidechain routes read without store subscription

**File:** `src/modules/Workspace/presentations/views/RoutingGraph.tsx:178`

```ts
const sidechainRoutes: RoutingSidechainRoute[] = getAllSidechainRoutes();
```

`getAllSidechainRoutes()` calls `sidechainStore.value?.routes` directly. The component subscribes to `trackStore` via `useStore` (line 175), but has no subscription to `sidechainStore`. If the user adds or removes a sidechain route (compressor sidechain, etc.), the routing graph will not re-render and will display stale connections.

**Fix:** Add `useStore(sidechainStore, defaultSidechainState)` and replace the direct call.

---

## §200 — `NotePropertyLane.tsx` — canvas reset + `resolveToken` in draw effect

**File:** `src/modules/Workspace/presentations/views/AutomationLane/NotePropertyLane.tsx`

**1. Canvas dimensions reset unconditionally on every draw (§182.1)**
```ts
// Lines 87–88 — inside useLayoutEffect([notes, selectedNoteIds, beatWidth, ...])
canvas.width = w * dpr;
canvas.height = h * dpr;
```
The effect fires on every MIDI note edit, note selection change, or zoom. On each trigger, the canvas dimensions are reset, clearing all pixel data and resetting 2D context state even when dimensions haven't changed. Add a dimension guard: `if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = ...; }`.

**2. `resolveToken` called in draw body (§194.1)**
```ts
// Line 97
ctx.fillStyle = resolveToken('--color-bg-overlay', '#151515');
```
`resolveToken` calls `getComputedStyle(document.documentElement)` on every draw. Since the background color never changes between draws, resolve the token once with a `useRef` or resolve at module level.

---

## §199 — `TimelineMinimap.tsx` — canvas reset + gradient allocation on every scroll tick

**File:** `src/modules/Arrangement/presentations/views/TimelineMinimap.tsx`

**1. Canvas dimensions reset unconditionally (§182.1 pattern)**
```ts
// Lines 42–43 — inside useLayoutEffect([tracks, pixelsPerBeat, scrollX, containerWidth])
canvas.width = rect.width * dpr;
canvas.height = MINIMAP_HEIGHT * dpr;
```
`scrollX` is a dep, so the effect runs on every scroll event. During timeline dragging this fires at 60fps, resetting both canvas dimensions and clearing all 2D context state (transform, compositing, line styles) on every frame even when dimensions haven't changed.

**2. Two gradient objects per scroll event (§181.1 pattern)**
```ts
const bgGrad = ctx.createLinearGradient(0, 0, 0, MINIMAP_HEIGHT); // line 70
// ...
const vpGrad = ctx.createLinearGradient(0, 0, 0, MINIMAP_HEIGHT); // line 109
```
Both gradients are fixed (only depend on `MINIMAP_HEIGHT` which is a constant), so recreating them on every scroll tick wastes GPU allocations. Cache them as `useRef`-stored `CanvasGradient` values, or use flat fills.

**3. Dead expression statement**
```ts
// Line 231 — inside handleMouseMove closure
scrollAtDragStart;  // does nothing
```
`scrollAtDragStart` is captured in the closure at line 214 but never actually read inside `handleMouseMove`. This bare expression statement suppresses the unused-variable lint warning but has no runtime effect.

---

## §197 — `ClipGainEnvelopeSection.tsx` — direct store read + fragile manual re-render counter

**File:** `src/modules/Workspace/presentations/views/Inspector/ClipGainEnvelopeSection.tsx:25`

```tsx
// Line 22–23
const [envKey, setEnvKey] = useState(0);
envKey; // used to force re-render when envelope mutates

// Line 25
const envelope = getClipGainEnvelope(clipId);
```

`getClipGainEnvelope` reads directly from the store without going through `useStore`. The component keeps a `envKey` counter and increments it via `setEnvKey((k) => k + 1)` after every mutation it directly triggers. But any external mutation — undo/redo (`pushUndo`), collaborative sync, or an action from another component — will leave the `envelope` data stale without triggering a re-render. The workaround is also fragile: the `envKey` variable is declared, referenced on the next line to suppress the "unused variable" lint rule, and then never actually used as a React key or dependency — making the intent unclear.

**Fix:** Replace `getClipGainEnvelope` with `useStore` subscription to the store that holds the envelope data. Remove the `envKey` workaround.

---

## §198 — `TrackNotesSection.tsx` — derived state from prop never updates

**File:** `src/modules/Workspace/presentations/views/Inspector/TrackNotesSection.tsx:13`

```tsx
const [notesValue, setNotesValue] = useState(track.notes);
```

`useState(initialValue)` only uses the initial value on the first render. Subsequent renders where `track.notes` changes — from undo/redo (`pushUndo`), collaborative sync, or any other external action — do not update `notesValue`. The textarea will keep showing the stale content from when the component first mounted, silently hiding externally-applied changes.

**Fix:**
```ts
useEffect(() => { setNotesValue(track.notes); }, [track.notes]);
```
Or use `key={track.id}` on the component to force remount when the track changes.

---

**File:** `src/modules/Workspace/presentations/views/Inspector/TrackNotesSection.tsx:13`

```tsx
const [notesValue, setNotesValue] = useState(track.notes);
```

`useState` only uses the initial value on mount. If `track.notes` changes after mount — from undo/redo, collaborative sync, or any external action — `notesValue` keeps the stale value and the textarea displays outdated content. The user sees their old note text even after it has been overwritten externally.

**Fix:** Add `useEffect(() => { setNotesValue(track.notes); }, [track.notes])` to sync state with the incoming prop, or add `key={track.id + track.notes}` to force remount when the notes change.

---

## §210 — ScoringPanel.tsx — `createLinearGradient` in rAF draw loop

**File:** `src/modules/Scoring/presentations/views/ScoringPanel.tsx:389,463`
**Category:** Performance | **Severity:** Low

Two `createLinearGradient` objects with fully static color stops are allocated inside the `draw()` rAF callback (~60fps):

```ts
// Lines 389–392 — inside draw(), called at rAF rate
const background = ctx.createLinearGradient(0, 0, 0, height);
background.addColorStop(0, 'rgb(4,4,6)');
background.addColorStop(1, 'rgb(2,2,3)');

// Lines 463–467 — second gradient, same pattern
const background = ctx.createLinearGradient(0, 0, 0, height);
background.addColorStop(0, 'rgb(8,8,11)');
background.addColorStop(1, 'rgb(4,4,6)');
```

Both gradients depend only on `height` (fixed when canvas dimensions are set) and hard-coded color strings. They should be created once and cached in a `useRef` (or outside the draw function body), then reused each frame.

---

## §209 — Plugin panels — `useStore(store, store.value!)` non-null default anti-pattern

**Files:** `src/modules/GrandBoule/presentations/views/GrandBoulePanel.tsx:121`, `src/modules/Toaster/presentations/views/ToasterPanel.tsx:82–83`, `src/modules/Sampler/presentations/views/SamplerPanel.tsx:62–64`, `src/modules/Crust/presentations/views/CrustPanel.tsx:67`
**Category:** Convention | **Severity:** Low

At least four plugin panel components pass the live `store.value!` as the default state argument to `useStore`:

```ts
// GrandBoulePanel.tsx:121
const state = useStore(grandBouleStore, grandBouleStore.value!);

// ToasterPanel.tsx:82–83
const state = useStore(toasterStore, toasterStore.value!);
const trackState = useStore(trackStore, trackStore.value!);

// SamplerPanel.tsx:62–64
const state = useStore(samplerStore, samplerStore.value!);
const pads = useStore(padStore, padStore.value!);
const slices = useStore(sliceStore, sliceStore.value!);
```

The TypeScript non-null assertion (`!`) discards null-checking at compile time. If any store is null at mount time — which is possible before the audio engine initialises, or in test environments — the component receives `null` as state and likely crashes. The correct approach is to provide an explicit typed default value object (e.g. `const defaultState: GrandBouleState = { ... }`), exactly as done in other panels like `LibraryBrowser` (line 38) and `UndoHistoryPanel` (line 17).

---

## §204 — SpectrumAnalyzer.tsx — per-frame noise loop and gradient allocation in rAF draw

**File:** `src/modules/Workspace/presentations/views/Metering/SpectrumAnalyzer.tsx:56–63,105–110`
**Category:** Performance | **Severity:** Medium / Low

Two performance hot spots inside the `draw()` rAF callback (60fps):

**§204.1 — Per-frame pixel noise loop (Medium)**

```ts
// SpectrumAnalyzer.tsx lines 56–63 — runs every animation frame
// Oscilloscope.tsx lines 49–55 — same pattern
ctx.globalAlpha = 0.03;
for (let nx = 0; nx < width; nx += 3) {
    for (let ny = 0; ny < height; ny += 3) {
        const v = Math.random() * 255;
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(nx, ny, 2, 2);
    }
}
```

Both `SpectrumAnalyzer.tsx` and `Oscilloscope.tsx` contain identical per-frame pixel noise loops. For a 300×120 canvas this is ≈ 4 000 `ctx.fillStyle` string assignments and `ctx.fillRect` calls per frame. The Canvas 2D API has significant per-call overhead for state changes; at 60fps this adds up to 240 000 JS-to-C++ bridge calls per second just for the noise overlay. **Fix:** Pre-render the noise to an `ImageData` buffer once at mount (or on resize), then stamp it with a single `ctx.putImageData(noiseBuffer, 0, 0)` call per frame.

**§204.2 — `createLinearGradient` in the draw loop (Low)**

```ts
// Line 105 — runs every animation frame
const grad = ctx.createLinearGradient(0, height, 0, 0);
grad.addColorStop(0, 'rgba(0,80,220,0.05)');
// ... five more addColorStop calls
```

The gradient is entirely static (color stops don't vary with the spectrum data) and should be created once outside the draw loop (cached in a `useRef`), then reused each frame.

---

## §205 — LevelMeter.tsx — gradient allocation in per-frame tick + unstable ID

**File:** `src/modules/Workspace/presentations/views/Metering/LevelMeter.tsx:30,116`
**Category:** Performance / Convention | **Severity:** Low

**§205.1 — `createLinearGradient` inside the per-frame `tick()` (Low)**

```ts
// Line 116 — inside tick() registered with animationScheduler (~60fps)
const grad = ctx.createLinearGradient(0, h, 0, 0);
grad.addColorStop(0, safe);
// ... five more addColorStop calls
ctx.fillStyle = grad;
```

The gradient depends only on `h` (meter height) and the three color constants resolved once at mount. The gradient should be created once (e.g., recreated only in the `ResizeObserver` callback when `h` changes) rather than on every tick.

**§205.2 — `crypto.randomUUID()` in the render body (Low/Convention)**

```ts
// Line 30 — in the render function body, outside any hook
const id = crypto.randomUUID();
```

A new UUID is generated on every render. It is used as `meter-${id}` to register/unregister with `animationScheduler` (lines 154, 157). The value captured inside the `useEffect` closure is stable for the lifetime of the effect (deps `[trackId]`), so the code works, but the UUID is wasteful to regenerate on every render and looks like a bug. **Fix:** `const idRef = useRef(() => crypto.randomUUID())` (or `useRef(crypto.randomUUID())` evaluated once at mount).

---

## §207 — BeatRulerBar.tsx — side-effect in render, canvas reset, gradient, unstable dep

**File:** `src/modules/Arrangement/presentations/views/BeatRulerBar.tsx:72–73,77–80,216,226–228`
**Category:** Bug / Performance | **Severity:** Low

Four issues in the `BeatRulerBar`:

**§207.1 — Side-effect (`drawRuler`) directly in the render function body (Low/Bug)**

```ts
// Lines 226–228 — in the render body, outside any hook
if (canvasRef.current) {
    drawRuler(canvasRef.current, playheadPositionRef.current);
}
```

React discourages direct side-effects in the render body. In Strict Mode, renders fire twice (discarding the first), so `drawRuler` runs twice per logical render. In concurrent mode, renders may be interleaved or abandoned. The intent is a "redraw on state change" — this should be a `useLayoutEffect`.

**§207.2 — Canvas dimensions reset unconditionally in `drawRuler()` (Low)**

```ts
// Lines 72–73 — inside drawRuler(), called at rAF rate during playback
canvas.width = w * dpr;
canvas.height = h * dpr;
```

Same §182.1 pattern. The ruler height is fixed (`HEIGHT = 18`), so the dimensions almost never change. Should guard with a dimension check before assigning.

**§207.3 — `createLinearGradient` inside `drawRuler()` (Low)**

```ts
// Lines 77–80 — inside drawRuler(), called at rAF rate
const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
bgGrad.addColorStop(0, '#151518');
bgGrad.addColorStop(1, '#111114');
```

Same §181.1 / §204.2 pattern. The gradient is static (no dynamic colors) and should be created once and cached.

**§207.4 — Unstable `drawRuler` reference in effect dep array (Low)**

```ts
// Line 216
}, [isPlaying, drawRuler]);
```

`drawRuler` is defined as a `const` inside the component at line 64, so it gets a new reference on every render. The `animationScheduler` effect re-runs on every render when playing, unregistering and re-registering the ticker. Same §206.3 pattern.

---

## §208 — MiniMasterSpectrum.tsx — `createLinearGradient` in rAF draw loop

**File:** `src/modules/Arrangement/presentations/views/MiniMasterSpectrum.tsx:50–53`
**Category:** Performance | **Severity:** Low

```ts
// Lines 50–53 — inside draw(), called at ~60fps via requestAnimationFrame
const gradient = ctx.createLinearGradient(0, height, 0, 0);
gradient.addColorStop(0, 'rgba(217, 119, 6, 0.4)');
gradient.addColorStop(0.5, 'rgba(234, 179, 8, 0.8)');
gradient.addColorStop(1, 'rgba(252, 211, 77, 1)');
```

The gradient depends only on the canvas `height` (fixed) and three hard-coded color stops. Applying the §181.1 / §204.2 pattern: create the gradient once outside the loop and reuse it each frame.

---

## §206 — WaveformEditor.tsx — canvas reset, resolveToken in draw, unstable ResizeObserver dep, direct store read

**File:** `src/modules/Workspace/presentations/views/ClipView/WaveformEditor.tsx:115–116,121,208–214,314`
**Category:** Performance / Bug | **Severity:** Low

Four issues in the `WaveformEditor`:

**§206.1 — Unconditional canvas dimension reset in `draw()` (Low)**

```ts
// Lines 115–116 — inside draw(), which runs on every useEffect trigger
canvas.width = width * dpr;
canvas.height = height * dpr;
```

Same §182.1 pattern: canvas width/height assigned on every draw call regardless of whether the dimensions changed. Each assignment clears all pixel data and resets 2D context state (transforms, globalAlpha, etc.), necessitating a full redraw even when only `warpState` changed.

**§206.2 — `resolveToken` inside `draw()` (Low)**

```ts
// Line 121 — inside draw()
ctx.fillStyle = resolveToken('--color-bg-overlay', '#151515');
```

`resolveToken` calls `getComputedStyle` on every invocation. It should be resolved once (at mount or in a `useMemo`/`useRef`) and captured in a variable that `draw()` closes over.

**§206.3 — `draw` function reference in ResizeObserver effect dep array (Low)**

```ts
// Lines 208–214
useEffect(() => {
    const observer = new ResizeObserver(() => draw());
    if (containerRef.current) {
        observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
}, [draw]); // draw is a plain function — new ref on every render
```

`draw` is not wrapped in `useCallback`, so it gets a fresh reference on every render. The ResizeObserver effect re-runs on every render, immediately disconnecting and reconnecting the observer. The observer is effectively re-created on every render. **Fix:** move `draw` to a `useCallback` (or use a stable ref pattern) and list only the actual deps.

**§206.4 — `trackStore.value` direct read during render (Low)**

```ts
// Line 314 — in the render function body
const realClipId = trackStore.value?.tracks
    .flatMap((t) => t.clips)
    .find((c) => c.audioBufferId === clipId || c.id === clipId)?.id ?? clipId;
```

Same §195.3 / §203.1 pattern. No subscription to `trackStore`; if the clip is moved or the track list changes, `realClipId` goes stale.

---

## §202 — TrackVcaSection.tsx — `getVcaGroups()` reads bare module variable during render

**File:** `src/modules/Workspace/presentations/views/Inspector/TrackVcaSection.tsx:58`
**Category:** Bug | **Severity:** Low

The `<select>` options list is populated by calling `getVcaGroups()` directly in the render body:

```tsx
// Line 58 — renders the options list
{getVcaGroups().map((g) => (
    <option key={g.id} value={g.id}>{g.name}</option>
))}
```

`getVcaGroups()` delegates to `getVcaGroupsState()` which reads a bare module-level `let vcaGroups: VcaGroup[]` variable — there is no reactive store, no `useSyncExternalStore`, and no `useStore` subscription. When `createVcaGroup` (or any mutator) updates `vcaGroups`, React has no reason to re-render `TrackVcaSection` and the dropdown shows a stale options list until the parent re-renders for an unrelated reason.

**Fix:** Expose `vcaGroups` through a proper reactive store and subscribe via `useStore`, or accept the VCA groups as a prop from a parent that already subscribes.

---

## §203 — ClipContextMenu.tsx — two direct store reads during render

**File:** `src/modules/Arrangement/presentations/views/ClipContextMenu.tsx:56,63`
**Category:** Bug | **Severity:** Low

Two stores are read directly in the render body without `useStore` subscriptions:

```tsx
// Line 56
const clip = trackStore.value?.tracks.flatMap((track) => track.clips).find((c) => c.id === clipId);
// Line 63
const selectedIds = workspaceStore.value?.selectedClipIds ?? [];
```

Because the component has no subscription to either store, changes that occur while the menu is open (e.g., the clip being renamed or another clip being selected) are invisible to the menu until an unrelated re-render occurs. Additionally, line 58 derives `useState` initial value from the stale `clip` read:

```tsx
const [newName, setNewName] = useState(clip?.name ?? '');
```

If the clip name changes externally before the rename inline-editor is opened, `newName` is pre-filled with the stale name. The impact is lower than persistent inspector components because context menus are short-lived, but the pattern is the same anti-pattern established across §195.3, §201.1, and §202.

**Fix:** Subscribe via `useStore(trackStore, ...)` and `useStore(workspaceStore, ...)`, or accept pre-resolved `clip` and `selectedIds` as props from the parent that already subscribes.

---

## §211 `TimelineEmptyMenu` — non-reactive marker store read in sub-component render
**File:** `src/modules/Arrangement/presentations/views/TimelineEmptyMenu.tsx:43`

```tsx
// NearbyMarkerColorMenu sub-component — line 43
const markers = markerStore.value?.markers ?? [];
const nearby = markers.filter((m) => Math.abs(m.beat - beat) <= 2);
```

`NearbyMarkerColorMenu` reads `markerStore.value` directly in its component render body with no `useStore` subscription. The marker list is captured once at mount. If a marker is added, removed, or moved while this sub-menu is open, the displayed list does not update and `setMarkerColor` may target a stale marker reference. Same anti-pattern as §203.1 (`ClipContextMenu`). Impact is low because this is a short-lived context menu.

**Fix:** Add `useStore(markerStore, { markers: [] })` in `NearbyMarkerColorMenu`, or pass `markers` as a prop from the parent which already subscribes.

---

## §213 `src/helpers/Store/` — dead class-based Store infrastructure
**Files:** `src/helpers/Store/Store.ts`, `ReadonlyStore.ts`, `AutomergeStorage.ts`, `LocalStorageStorage.ts`, `MemoryStorage.ts`, `Storage.ts`

None of these files are imported by any production code. A codebase-wide grep for `from '.*helpers/Store'` finds only one import: `src/infra/store/storage/createLocalStorage.ts` imports the `LocalStorageKeys` type constant — and nothing else. The full class-based `Store<T>` implementation in `src/helpers/` has been superseded by the factory-function `createStore()` in `src/infra/store/`. The six files (≈400 lines total) are dead code with active unit tests that pass but exercise nothing used in production.

**Specific sub-issue:** `AutomergeStorage.ts:83` has `console.error(...)` that bypasses `logger` — but this is moot since the class is unreachable in production.

**Fix:** Delete `src/helpers/Store/Store.ts`, `ReadonlyStore.ts`, `AutomergeStorage.ts`, `LocalStorageStorage.ts`, `MemoryStorage.ts`, and `Storage.ts`, along with their test files. Keep `LocalStorageKeys.ts`.

**Related (§213.2):** `src/utils/` is a second dead directory — 12 files, zero imports anywhere. Appears to be a stale clone of a `src/helpers/` subset (same files: `resolveToken.ts`, `clamp.ts`, `cn.ts`, `SeededRandom.ts`, `AnimationScheduler.ts`, etc.). Safe to delete entirely.

---

## Summary of Open Items

| # | Category | Severity | File(s) |
|---|---|---|---|
| 1.1 | Bug | High | `ClipContextMenu.tsx:56,63` |
| 1.2 | Bug / Logic | Medium | `ArrangementBar.tsx:84–117` |
| 1.3 | Bug | Medium | `clipIdCounter.ts`, `Marker.ts`, `TakeLane.ts`, … |
| 1.5 | Bug | **High** | `removeClip` / `rippleDeleteClips` — MIDI notes orphaned in `midiStore` on clip delete |
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
| 5.5 | API design | Low | `updateGrinderMeters` / `updateGlutenMeters` — 7–11 positional params |
| 6.* | Correctness | Medium | 10+ files with module-level counters/singletons |
| 7.1 | Convention | Low | `PianoModel3D.tsx` |
| 8.1 | Structure | Medium | `timelineViewStore.ts` — 5 business functions |
| 8.2 | Structure | Medium | `glutenStore.ts` + 20 others — business logic in stores |
| 8.3 | Bug / Structure | High | `clipboardStore.ts` — mutable `export let`, not a `Store<T>` |
| 9.1 | Typing / Structure | Medium | `MIDI/models/MidiNote.ts` vs `stores/midiStore.ts` |
| 9.2 | Verbosity | Medium | `MIDI/useCases/midiNoteCrud/` — 10 near-identical files |
| 10.1 | Arch violation | High | `createAutomergeStorage.ts` — infra imports from CrdtDocument module |
| 11.1 | Bug / Structure | High | `togglePlayback.ts` — silently fire-and-forget, hides circular dep |
| 11.2 | Typing / Structure | Medium | `compileDso.ts` — 5 union types duplicated to avoid AiRuntime↔AiGeneration circular dep |
| 12.1 | Verbosity | Low | 3 independent `SpectrumAnalyzer` components |
| 12.2 | Typing | Low | `useProjectState`/`useTransportState` local type re-definitions |
| 12.3 | Structure | Low | `AppShell.tsx` — direct `localStorage` bypasses store |
| 13.1 | Bug | Medium | `resetModuleStoresToDefault.ts` — plugin stores not reset |
| 14.1 | Structure | Medium | `sessionManagement.ts` — 15+ module-level session vars |
| 14.2 | Verbosity | Low | `sessionManagement.ts` — compress/decompress loop duplication |
| 15.1 | Structure | Medium | `sendChatMessage.ts` — 340 lines, two modes, tripled callback, hardcoded prompt |
| 22.1 | Security | **Critical** | `runEditorScript` — unsandboxed `new Function()` executes user code with full DAW API access |
| 22.2 | Security | Medium | Anthropic API key in module-level variable, `dangerouslyAllowBrowser: true` undocumented |
| 24.1 | Structure | Medium | 4 demo files (7000+ lines) hardcode MIDI data in TypeScript, bypass store contract |
| 23.1 | Typing | Low | `BuiltinDeviceNode._bypassed` — bypass state stored via `as any`, not in the type |
| 23.2 | Typing | Low | `(source as any).fadeGainNode` — fade GainNode attached ad-hoc to AudioBufferSourceNode |
| 23.3 | Convention | Low | 78 `console.error`/`console.warn` calls bypass the `logger` abstraction |
| 21.1 | Arch violation | Medium | MIDI module writes to `Arrangement/stores/chordTrackStore` |
| 21.2 | Structure | Low | `PreferencesDialog.tsx` — 8 section components in one 737-line file |
| 16.1 | Structure | Medium | `handlers/` — undocumented module layer in 14 modules |
| 16.2 | Arch violation | Medium | `AiGeneration` has its own WAV encoder instead of using `AudioEngine` API |
| 17.1 | Convention | Low | `if` without `{}` — 100+ occurrences, not just `PianoModel3D.tsx` |
| 18.1 | Verbosity | High | 33 workspace panel toggle files — 33 single-line property setters as "use cases" |
| 19.1 | Verbosity | Low | 3 AudioEngine encoder passthroughs (`audioBufferToWav/Mp3/Flac.ts`) |
| 20.1 | Structure | Low | `deviceLayoutRegistry.tsx` — React component exported from a registry module |
| 25.1 | Verbosity / Structure | Low | `createSidechainCompressorFallback` duplicates `createCompressor` |
| 25.2 | Typing | Medium | `apply*Params` — fragile positional indexing into `nodes[]` array |
| 25.3 | Bug | Medium | LFO oscillators started in `createChorus` etc. have no dispose path — resource leak |
| 25.4 | Verbosity | Low | `applyParams` switch should be a lookup map like `DEVICE_FACTORIES` |
| 26.1 | Structure | Medium | `builtinEffectDescriptors.ts` (1 234 lines) duplicates audio-code defaults with no sync enforcement |
| 27.1 | Bug | Medium | `AutomergeRepository._loadAllSync` discards `Automerge.save()` return value — silent no-op |
| 28.1 | Structure | Medium | `playheadScheduler.ts` — 9 module-level mutable vars, same HMR risk as §14.1 |
| 28.2 | Verbosity | Low | Stop-source cleanup block triplicated in `playheadScheduler.ts` |
| 29.1 | API design | Low | `generateIR` — 8 positional float parameters (same issue as §5.5) |
| 30.1 | Bug | Medium | `glueClips` — silently drops clips from all tracks except the first |
| 30.2 | Bug | Medium | `glueClips` — produces empty shell clip; MIDI notes orphaned, audio range wider than buffer |
| 30.3 | Bug | Medium | `splitClipWithUndo` — right fragment discovered heuristically; wrong clip undone under race |
| 30.4 | Bug | Low | `songStructureDetection.ts` — Drop branch unreachable (isHigh already caught above) |
| 30.5 | API design | Low | `stripSilence` — `_minSilenceBeats` accepted but never enforced |
| 31.1 | Structure | Medium | `automationRecordingState.ts` — 3 module-level mutable Maps, same HMR risk as §14.1/§28.1 |
| 32.1 | Verbosity | Low | `generateRiser`/`generateSweepDown` — structurally identical, differ only in direction |
| 33.1 | Verbosity | Medium | `createFindDeviceRef` duplicated verbatim in 6 plugin param-bridge helpers |
| 33.2 | Structure | Medium | rAF-batched param update Maps duplicated in 4 plugin bridge modules |
| 34.1 | Verbosity | Low | `ingestDspAnalysis` — blob-finalizing block duplicated inside and after loop |
| 35.1 | Structure | Medium | `recording.ts` — 5 module-level vars for recording session, same HMR risk |
| 35.2 | Bug | Low | `recording.ts` — only mono (channelCount:1), no user warning for stereo inputs |
| 36.1 | Typing | Low | `TrackNode.ts` — `DeviceNode` vs `OfflineDeviceNode` type divergence forces `as any` |
| 37.1 | Structure | Low | `loadProject.ts` — module-level `stopAutoSave` singleton causes double-subscription on HMR |
| 38.1 | Structure | Medium | `usePianoRollInteractions` — 840 lines, 20-field arg, `PianoRollChordType` in presentation layer |
| 39.1 | Verbosity | Medium | 6 plugin `*Node.ts` files — `fetchWasmBinary`/`ensureWorkletRegistered` duplicated, `cachedWasmBytes` singleton per module |
| 39.2 | Verbosity | Low | Init-timeout + `settled` flag pattern duplicated in each of 6 plugin node files |
| 39.3 | Typing | Low | `*NodeResult` types structurally identical across all plugin nodes — no shared base type |
| 40.1 | Verbosity | Medium | `wasmDeviceRegistry.ts` (508 lines) — `pendingParams` placeholder lifecycle repeated 10× |
| 41.1 | Typing | Medium | `AppAction` — `restoreTrack`/`restoreClip` payloads typed `unknown`, handlers cast blindly |
| 41.2 | Typing | Low | `AppAction` — 4 action payload fields typed `string` where a finite union is available |
| 41.3 | Typing | Low | `AutomationMode` union duplicated in `AppAction` and `automationRecordingState.ts` |
| 42.1 | Performance | Low | `undoToIndex` — O(n) sequential undo with 30+ store writes/re-renders for a single gesture |
| 43.1 | Verbosity | Medium | `NOTE_NAMES` constant duplicated in 8 separate files across 6 modules |
| 44.1 | Performance | **High** | `detectKey` blocks main thread — triple-nested Goertzel loop on full audio buffer, no yielding |
| 44.2 | Performance | Medium | `detectTempo` synchronous energy scan blocks main thread on long files |
| 45.1 | Structure | Medium | `executeAppAction` — module-level `handlerRegistryCache` resets on HMR, drops in-flight actions |
| 45.2 | Bug | Medium | Handler registry spread (20 `get*Handlers()`) silently drops collisions — last writer wins |
| 46.1 | Verbosity | Medium | 9 MIDI note transform files — all identical read-state/guard/map/write-state pattern |
| 47.1 | Structure | High | `AppShell.tsx` (820 lines) — 13 device `useState`, 14 device `useEffect`, 13 `InstrumentBottomPanel` blocks, 14 dimension setters, all per-plugin |
| 47.2 | Structure | Low | `AppShell.tsx:97` — module-level `hasShownAlphaNotice` mutable singleton (HMR risk) |
| 47.3 | Verbosity | Low | `AppShell.tsx` — Left/Right panel placement blocks duplicate the same 4 panels (Sidebar, Inspector, Chat, AI) with only side-swapped `DragResizeHandle` |
| 48.1 | Verbosity | Low | 3 generation handlers (melody, chords, drums) — structurally identical: validate style, resolve track, call `apply*ToTrack` |
| 49.1 | Performance | **High** | Yeast processors — audio-thread allocations: template string Map keys, `initDefaultMatrix()` on `noteOn`, `Math.max(...arr.map(...))` per block |
| 49.2 | Verbosity | Low | 12 Yeast processor classes each duplicate 4 bypassed/latency members verbatim |
| 49.3 | Convention | Low | Inline LCG (`1103515245 + 12345`) duplicated in Arpeggiator, Humanizer, MarkovChain — should use shared `SeededRandom` util |
| 50.1 | Bug | Medium | `handleStemSeparate`/`handleGenerateAudio` catch-and-log silently returns; pushes undo entry for failed action — undo stack goes out of sync |
| 51.1 | Performance | Medium | `automergeSync`/`assetTransfer` — base64 helpers create O(n) string objects per byte via `Array.from(...).join('')` before `btoa()` |
| 51.2 | Verbosity | Low | `bytesToBase64`/`arrayBufferToBase64` duplicated in `automergeSync.ts` and `assetTransfer.ts` — no shared helper |
| 51.3 | Bug | Low | `requestAsset` always sends `missingChunks: []` — bitmap-based resume is dead code, every request retransmits all chunks |
| 51.4 | Structure | Low | `peerConnection.ts` — module-level `customIceServers` mutable singleton (HMR risk) |
| 52.1 | Performance | Medium | `resolveGrandBouleEngine` called on every render — `getAllTracks().find()` O(n) scan per store update |
| 52.2 | Verbosity | Low | `calibrateGrandBouleMidi/helpers.ts` — `clamp` utility redefined (shared version exists at `#/helpers/Math/clamp`) |
| 52.3 | Verbosity | Low | 8 single-liner files in `calibrateGrandBouleMidi/` — all identical pattern of `clamp` + `updateCalibration` |
| 53.1 | Verbosity | Medium | `createFindDeviceRef` — 7th copy found in `ProofChamber` (§33.1 documented 6; total is now 7) |
| 54.1 | Performance | Medium | `scheduleNote` — `AudioBuffer` allocated + filled with `Math.random()` for every note that has `noiseLevel > 0`; should be pre-cached |
| 54.2 | Verbosity | Low | ADSR envelope logic duplicated between `scheduleNote` and `scheduleNoteOffline` |
| 54.3 | Typing | Low | `(result as unknown as Record<string, number>)[key]` — double type assertion bypasses safety |
| 54.4 | Bug | Low | `Auto-Pan` Faust DSP — `shape` hslider defined in DSP code but absent from params array; parameter is permanently 0 |
| 55.1 | Performance | Low | `evaluateFollowActions` — `filter`+`sort` array allocations per follow-action trigger in scheduler tick |
| 55.2 | Bug | Low | `evaluateFollowActions` — multiple concurrent follow actions: last writer wins, others silently discarded |
| 55.3 | Convention | Low | `evaluateFollowActions` — `play_random` uses `Math.random()` (unseeded); session replay is non-deterministic |
| 56.1 | Verbosity | Medium | `scanBrowserDirectory`/`scanTauriDirectory` — ~50 lines of identical scan lifecycle duplicated |
| 56.2 | Structure | Low | `export let scanAbortController` — mutable module-level export, HMR risk, breaks encapsulation |
| 56.3 | Bug | Low | Scan progress formula `N / (N + 100)` never exceeds 50%; UI progress stalls then jumps to 100% |
| 56.4 | Verbosity | Low | Library root ID expression duplicated in `connectFolderBrowser` and `connectFolderTauri` |
| 57.1 | Structure | Medium | Sampler `pending`/`latest` rAF-batching Maps — 5th copy of §33.2 pattern |
| 57.2 | API design | Low | `setSamplerParamThrottled` takes `instanceId` from caller; `setSamplerParamImmediate` reads from store — inconsistent |
| 57.3 | Typing | Medium | `samplerBridge.ts` — 8 blind `as T` casts on `tauriInvoke` return values (no runtime validation) |
| 58.1 | Structure | Medium | `compilerEngine.ts` — 5 module-level mutable singletons; HMR resets lose Faust DSP registrations and in-flight 15MB compiler download |
| 58.2 | Convention | Low | `compilerEngine.ts` — 7 `console.error` calls bypass `logger` abstraction |
| 58.3 | Structure | Low | `compilerEngine.ts` — `registerPluginLoader()` side effect at module load time |
| 59.1 | Bug | Medium | `compileDso.ts` — local `DrumPatternStyle`/`ScaleType` unions out of sync with AiGeneration originals; silent validation mismatch (8 vs 16, 7 vs 14 variants) |
| 60.1 | Structure | Low | `promptInjection.ts` — module-level listener array (HMR risk); re-implements `eventBus` locally as hand-rolled 26-line event emitter |
| 61.1 | Bug | Medium | `loadWAMPlugin` — `instanceId` stored in map but not returned; callers cannot reference or unload the instance |
| 61.2 | Bug | Low | `loadWAMPlugin` — `HighEndPluginProcessor` silently falls back to passthrough GainNode when not registered |
| 61.3 | Convention | Low | `loadWAMPlugin` — 2 `console.warn` calls bypass `logger` abstraction |
| 62.1 | Structure | Medium | `sequencerPlayback.ts` — 5 module-level mutable vars (HMR risk); orphaned `setTimeout` chain on hot reload |
| 62.2 | Performance | Medium | `sequencerPlayback.ts` — `morphPatterns` allocates full pattern clone every tick even at t=0/t=1 (no short-circuit) |
| 62.3 | Performance | Low | `sequencerPlayback.ts` — `getFirstToasterDeviceId()` scans all tracks on every tick instead of caching |
| 63.1 | Bug | **High** | `modulatorLibrary.ts` — entire modulation system is dead code (data-only, no Web Audio connection); LFO/envelope/random controls silently do nothing |
| 64.1 | Bug | Medium | `polyphonicAudioToMidi.ts` — model URL points directly into `node_modules`; breaks in production builds where Vite does not emit the asset |
| 64.2 | Structure | Low | `polyphonicAudioToMidi.ts` — `basicPitchModel` module-level singleton; 10MB model re-downloaded on every HMR reset |
| 65.1 | Performance | Low | `audioToMidi.ts` — `Math.max(...onsets.map(...))` spread on large onset array; stack overflow risk on long files |
| 66.1 | Typing | Low | `mixHealthAnalysis.ts` — `c: any` cast on clip discriminated union; silences type checker on field rename |
| 66.2 | Convention | Low | `mixHealthAnalysis.ts` — "Brigthness" typo in AI prompt string |
| 67.1 | Verbosity | Low | `pitchDetection.ts` — 9th copy of `NOTE_NAMES` constant (§43.1 was 8) |
| 67.2 | Structure | Medium | `engineLifecycle.ts` — 4 module-level WebLLM singletons; HMR resets orphan in-flight model downloads |
| 67.3 | Typing | Low | `engineLifecycle.ts` — `as unknown as WebLlmEngine` double cast; should use imported WebLLM type directly |
| 67.4 | Structure | Low | `nativeEngine/lifecycle.ts` — `nativeEngineReady` module-level mutable; HMR resets return `false` after successful engine init |
| 68.1 | Structure | Low | `storeRegistry.ts` — acknowledged dead code retained to "avoid file deletion"; should just be deleted |
| 69.1 | Performance | Low | `findSimilarSamples` — `new Set([...a, ...b])` allocated per sample comparison; O(n) allocations for 10k-sample library |
| 69.2 | Performance | Medium | `getFilteredSamples` — full clone+filter+sort pipeline recomputed on every call (each keypress); no memoization |
| 70.1 | Performance | Medium | `audioFeatures.ts` — `data.slice()` allocates ~17k `Float32Array` copies per analysis; use `subarray()` (zero-copy) |
| 70.2 | Structure | Low | `audioFeatures.ts` — `Meyda.sampleRate/bufferSize` global state mutation; fragile under concurrent calls |
| 70.3 | Performance | Low | `audioFeatures.ts` — `Math.max(...frames.map(...))` spread on ~17k-element array (§65.1 pattern) |
| 71.1 | Convention | Low | `automergeRepository.ts` — 4 `console.warn/error` calls bypass `logger` abstraction (§23.3 pattern) |
| 71.2 | Performance | Low | `automergeRepository.ts` — throwaway `Automerge.init()` doc allocated just to derive an actor ID |
| 71.3 | Bug | Medium | `automergeRepository.ts` — `invokeWorker` has no worker-crash listener; `Promise` hangs forever if worker crashes |
| 73.1 | Structure | Medium | `registerDependencies.ts` — `AppEvents` has 14 per-plugin `panel.show*` events (identical payload); a single generic event + device type would eliminate per-plugin lockstep edits |
| 74.1 | Structure | Low | `buildTimelineRenderModel.ts` — 7 module-level mutable cache vars (HMR risk; same pattern as §14.1) |
| 74.2 | Performance | Medium | `buildTimelineRenderModel.ts` — recording path clones all tracks×clips every rAF frame (~600 objects/frame at 30t×20c) |
| 74.3 | Performance | Low | `buildTimelineRenderModel.ts` — drag-preview path rebuilds full `clipById` Map per render instead of caching when `dataDirty` |
| 75.1 | Verbosity | High | `Workspace/panels/devicePanels/` — 28 per-plugin single-liner files (14 emitters + 14 subscribers); a single generic `showDevicePanel/onPanelShowDevice` would replace all |
| 76.1 | Performance | Low | `shortcutEngine.ts` — `Object.entries(bindings)` allocated on every global `keydown`; should pre-compile to a `Map` keyed on shortcut binding |
| 77.1 | Performance | Medium | `importAudioFile.ts` — `structuredClone(trackStore.value)` deep-clones full track store twice; blocks main thread, inconsistent with CRDT delta-based undo |
| 78.1 | Structure | Low | `trackTemplate.ts`/`soundPresetLibrary.ts` — module-level caches (HMR risk); `templates.push()` mutates cached reference in place |
| 79.1 | Convention | Low | `resolveComping.ts` — function body starts at column 0 (indentation broken) |
| 79.2 | Performance | Low | `resolveComping.ts` — `[...regions].sort(...)` allocates on every call; should cache sort result keyed to `activeCompRegions` identity |
| 80.1 | Structure | High | `messageHandlers.ts` — `handleNoteOn` is a 200-line per-plugin dispatch with 4–8 `Array.find` scans per MIDI note; grows per plugin |
| 80.2 | Typing | Medium | `messageHandlers.ts` — `levainDeviceId` set via `as Record<string, unknown>` cast (not in `ActiveNoteData` type); read back with a different cast |
| 80.3 | Bug | Medium | `messageHandlers.ts` — `getSynthParamsForTrack(...).detune` accessed without null-check on lines 541 and 548; throws `TypeError` for non-synth tracks on pitch bend |
| 80.4 | Performance | Low | `messageHandlers.ts` — `tracks.filter(parentId)` O(n) scan per MIDI noteOn/noteOff for Toaster child-pad lookup |
| 80.5 | Convention | Low | `messageHandlers.ts` — `console.warn` bypasses `logger` abstraction (§23.3) |
| 81.1 | Verbosity | Low | `MIDI/useCases/transposeForChordTrack.ts` and `formatChordName.ts` — 5-line passthrough wrappers with no added value (§19.1 pattern) |
| 82.1 | Performance | Low | `arpeggiator.ts` — `Math.min/max(...notes.map(...))` spread on large note array; stack overflow risk |
| 82.2 | Convention | Low | `arpeggiator.ts` — `random` pattern uses `Math.random()` unseeded; non-deterministic (§55.3 pattern) |
| 83.1 | Bug | Medium | `RoutingMatrix.tsx` — routing connections in local React state only; panel close discards all routes (no store, no persistence) |
| 83.2 | Bug | Medium | `SessionView.tsx` — active clip slots in local state only; panel close resets clip launch state |
| 83.3 | Convention | Low | `RoutingMatrix.tsx`/`SessionView.tsx` — `Map` used as React state; anti-pattern vs plain object/array |
| 83.4 | Performance | Low | `SessionView.tsx` — `getClipForSlot` calls `tracks.find()` per slot during render (n_tracks × 8 `find` calls per render) |
| 84.1 | Verbosity | Low | `generateMidiAI.ts` — passthrough wrapper with locally-duplicated types that can diverge from native bridge (§81.1 pattern) |
| 85.1 | Performance | Low | `undoStore.ts` — dynamic `import()` inside `pushUndo` creates a Promise wrapper on every undo entry push; should be a static import |
| 85.2 | Performance | Low | `undoStore.ts` — full 100-entry undo stack JSON-stringified to `sessionStorage` on every `pushUndo` call |
| 86.1 | Convention | Low | `automationShapes.ts` — `points.pop()` mutates `generateShapePoints` return value; should `slice(0, -1)` instead |
| 86.2 | Performance | Low | `automationShapes.ts` — `allPoints.push(...points)` spread per cycle; use `push.apply` for unbounded arrays |
| 87.1 | Performance | Low | `createWebAudioEngine.ts` — `getSendsForTrack` lambda runs `Array.from + filter` on every call; should index sends by source track ID for O(1) lookup |
| 87.2 | Bug | Medium | `createWebAudioEngine.ts` — 3 worklet paths hardcoded as absolute strings; renamed files fail silently at runtime (no compile-time safety) |
| 87.3 | Typing | Low | `createWebAudioEngine.ts` — `Set<Promise<any>>` uses `any`; suppresses type errors on stored promises |
| 88.1 | Bug | Low | `TrackNode.addDevice` — second `find` guard (line 194) is unreachable dead code; `logger.warn` never fires |
| 88.2 | Bug | Low | `TrackNode.removeDevice` — `grandBouleControls` not cleaned up; potential resource leak on track removal |
| 88.3 | Bug | Medium | `TrackNode.addDevice` — concurrent async device loads call `rebuildChain()` simultaneously; causes audio glitches and potential routing corruption |
| 88.4 | Typing | Low | `TrackNode` — `dn.nodes[0] as AudioWorkletNode` blind cast in 4 places; silently drops param updates when node is a placeholder GainNode |
| 89.1 | Security | **High** | `permissions.ts` — host role verified via mutable local store (`isHost` flag), not cryptographic signature; malicious peer can forge host identity and grant arbitrary roles |
| 89.2 | Structure | Low | `permissions.ts` — role grants tunnelled through CRDT sync channel via magic `__permissions__` docId; collides with any real CRDT doc of same ID |
| 89.3 | Typing | Medium | `permissions.ts` — `JSON.parse(...) as PermissionMessage` with no runtime validation; malformed messages reach downstream trust logic |
| 90.1 | Convention | Low | `telemetryAllocator.ts` — `console.warn` bypasses `logger` abstraction (§23.3) |
| 90.2 | Structure | Medium | `telemetryAllocator.ts` — module-level SAB singleton orphaned on HMR; worklets write to stale memory while main thread reads new zero-filled SAB |
| 91.1 | Security | **High** | `validateActions.ts` — 162 of 165 action types have no payload validation; AI-generated `removeTrack`, `removeClip`, `deleteTrackAlternative` etc. pass through with arbitrary payloads |
| 91.2 | Structure | Low | `validateActions.ts` — 165-entry `KNOWN_ACTION_TYPES` Set is manually maintained; new action types silently miss the allowlist if the Set is not updated |
| 91.3 | Structure | Low | `parsePromptToActions.ts` — `if (result.success)` followed immediately by `if (!result.success)` instead of `if/else`; logically exhaustive but written as two independent branches |
| 91.4 | Performance | Low | `parsePromptToActions.ts` — `await import('./dsoEditor/executeDsoEdit')` on every LLM path invocation; import is already static at module level (unnecessary dynamic import) |
| 92.1 | Performance | Low | `getProjectContext.ts` — `midiStore.value` accessed inside `.map()` per clip; value should be cached outside the loop; with 100t×20c = 2000 `.value` accesses per AI call |
| 92.2 | Performance | Low | `getProjectContext.ts` — called on every AI chat message with no memoization; allocates full context object (100t×20c = 2000+ objects) on every invocation |
| 93.1 | Bug | Medium | `serializeLogicalState.ts` — `let revisionCounter = 0` module-level mutable; HMR resets counter to 0 while running LLM sessions think revision is still > N |
| 93.2 | Bug | Medium | `serializeLogicalState.ts` — `const recentEdits: string[]` module-level mutable array; HMR clears edit history silently |
| 93.3 | Typing | Low | `serializeLogicalState.ts` — `(clip as Record<string, unknown>).gain` and `(device as Record<string, unknown>).name` double-cast to access properties not present in model types; indicates model types are incomplete |
| 94.1 | Structure | Low | `executeDsoEdit.ts` — step comment "8." appears twice (lines 132 and 145); second step 8 should be step 9 |
| 94.2 | Typing | Low | `executeDsoEdit.ts` — `parseEditPlan` does `JSON.parse(...) as EditPlan` with only a `kind` and `Array.isArray(dsos)` structural check; individual DSO payloads are not validated |
| 94.3 | Structure | Low | `executeDsoEdit.ts` — `await import('../../repositories/webLlm/engineLifecycle')` inside `catch` block on the error path; should be a static top-level import |
| 95.1 | Bug | Medium | `clipIdCounter.ts` — `let nextClipId = 1` module-level mutable; resets to 1 on HMR; clips created before reload and after reload share IDs (clip-1, clip-2...) |
| 95.2 | Structure | Low | `clipIdCounter.ts` — sequential integer IDs are predictable and collision-prone in multi-tab sessions; should use `crypto.randomUUID()` |
| 96.1 | Typing | Low | `BusNode.ts` — `getFloatTimeDomainData(data as any)` unnecessary cast; `meterBuffer` is already `Float32Array` |
| 97.1 | Bug | Medium | `BacteriaNode.ts` — `let cachedWasmBytes: ArrayBuffer | null = null` module-level mutable cache; same HMR risk as GlutenNode (§55.2) — stale WASM bytes served after hot reload |
| 97.2 | Bug | Low | `BacteriaNode.ts` — `bandLevels: []` in `onMeterData` callback is always an empty array; `BacteriaMeterData.bandLevels: number[]` type is permanently unfulfilled |
| 97.3 | Convention | Low | `BacteriaNode.ts` — `catch {}` empty catch in `disconnect()` and `destroy()` silently swallows errors |
| 98.1 | Bug | Low | `processorFactory.ts` — `ccGenerator` appears twice in `PROCESSOR_TYPES` (lines 53 and 56) and the `Phase 6 — Lab` comment duplicated; second `ccGenerator` entry is a copy-paste error |
| 99.1 | Bug | Medium | `loadProject.ts` — `let stopAutoSave` module-level mutable; HMR resets to `null` while old auto-save loop continues running; `loadProject()` call on next render starts a second concurrent loop |
| 99.2 | Convention | Low | `loadProject.ts` — `console.error(...)` bypasses `logger` abstraction (§23.3) |
| 100.1 | Bug | Medium | `captureSnapshot.ts` — snapshot omits `midiStore`, `automationStore`, `workspaceStore`; restoring a version loses all MIDI notes and automation points |
| 100.2 | Performance | Low | `captureSnapshot.ts` — `new Blob([data]).size` allocates a full Blob just to measure byte length; use `data.length` or `TextEncoder` |
| 101.1 | Typing | Medium | `restoreSnapshot.ts` — `JSON.parse(snapshot.data)` result is used without runtime validation; malformed/partial snapshot overwrites store data silently |
| 101.2 | Bug | Medium | `restoreSnapshot.ts` — only restores `trackStore`, `markerStore`, `transportStore`; matches `captureSnapshot` gaps — MIDI notes and automation lost after version restore |
| 102.1 | Bug | Low | `proSynthInstruments.ts` — `Supersaw Unison` Faust DSP defines bare-name `hslider("attack", ...)` but param descriptors use `/synth/attack` prefix; address mismatch means UI params may not map to Faust controls |
| 102.2 | Bug | Low | `proSynthInstruments.ts` — `Additive Synth` exposes `/additive/partials` UI param but `partials = 16` is a Faust compile-time constant; the param has no runtime effect |
| 103.1 | Structure | Low | `positionTracking.ts` — 7 module-level mutable vars + `Set`; HMR resets them (§14.1 pattern) while old rAF/setInterval loop continues; duplicate polling loops accumulate |
| 103.2 | Convention | Low | `positionTracking.ts` / `smartLoopPoints.ts` — `console.error(...)` bypasses `logger` abstraction (§23.3) |
| 104.1 | Verbosity | Low | `SampleLibrary/restoreLibrary.ts` — 4-line passthrough wrapper with no added value (§81.1 pattern) |
| 105.1 | Structure | Low | `automationDrawMode.ts` — `let activeSession` module-level mutable; HMR resets it while old session's `rafId` is never cancelled (§14.1 pattern) |
| 105.2 | Performance | Low | `automationDrawMode.ts` — `paintDrawPoint` allocates full `lanes.map()` array on every painted point even within the same rAF batch |
| 106.1 | Performance | Low | `recordAutomationValue.ts` — `getTrackById(trackId)` called on every automation value write (rAF-rate); O(n) track scan per tick |
| 106.2 | Performance | Low | `recordAutomationValue.ts` — `pendingPoints.get(key) ?? []` creates a throwaway array each time the key is absent; value is immediately set back with `pendingPoints.set(key, points)` |
| 107.1 | Structure | Medium | `playheadScheduler.ts` — 9 module-level mutable vars; HMR resets them while old `setTimeout` tick loop continues (§14.1 pattern; this is the hottest scheduler in the app) |
| 107.2 | Typing | Low | `playheadScheduler.ts` — `activeAudioSources as any[]` cast in 3 places to access non-typed `src.fadeGainNode` property added at runtime; typed wrapper should store the fade node alongside the source |
| 107.3 | Structure | Low | `playheadScheduler.ts` — `import('./transportControls/stopPlayback').then(...)` dynamic import inside tight scheduler tick; should be a static import |
| 107.4 | Performance | Low | `playheadScheduler.ts` — audio source stop+fade logic duplicated verbatim at loop boundary, follow-action jump, and `stopPlayheadScheduler`; DRY violation across 3 call sites |
| 107.5 | Performance | Medium | `playheadScheduler.ts` — recording callback (line 172) clones all tracks×clips to update one clip's `audioBufferId`; 600+ object allocations per recording buffer receive |
| 107.6 | Convention | Low | `playheadScheduler.ts` — `Math.random()` used in recording buffer ID (line 173); unseeded (§55.3 pattern); use `crypto.randomUUID()` |
| 108.1 | Performance | Low | `evaluateFollowActions.ts` — `[...track.clips].sort(...)` and `track.clips.filter(...).sort(...)` allocate on every clip-boundary crossing in the scheduler tick |
| 108.2 | Convention | Low | `evaluateFollowActions.ts` — `Math.random()` in `play_random` follow action is unseeded (§55.3 pattern); non-deterministic playback |
| 108.3 | Typing | Low | `evaluateFollowActions.ts` — `track.clips as Clip[]` cast; `clips` is already typed; indicates model type gap |
| 109.1 | Structure | Low | `scheduleAudioClips.ts` — `const requestedAssets = new Set<string>()` module-level mutable; HMR resets the dedup set; peer asset requests are re-sent every scheduler tick until cleared (§14.1 pattern) |
| 110.1 | Structure | Low | `assetTransfer.ts` — `docId: '__asset__'` magic string piggybacked on CRDT sync channel; collides with any real CRDT doc named `'__asset__'` (§89.2 pattern) |
| 110.2 | Typing | Low | `assetTransfer.ts` — `JSON.parse(message.data) as AssetControlMessage` with no runtime field validation (§89.3 pattern) |
| 110.3 | Convention | Low | `assetTransfer.ts` — `console.error(...)` in `handleMessage` and `assembleAsset` bypasses `logger` abstraction (§23.3) |
| 110.4 | Performance | Low | `assetTransfer.ts` — `arrayBufferToBase64` uses `Array.from(bytes, ...).join('')` for each 256KiB chunk; creates a 256K-element temporary array per chunk |
| 111.1 | Performance | Low | `RoutingGraph.tsx` — `isConnectedToSelected` calls `tracks.find()` twice per connection line on every render; `positionMap` rebuilt on every render |
| 112.1 | Performance | Low | `MixHealthDialog.tsx` — `setReport(reportRef.current)` called on every LLM streaming token; triggers `ReactMarkdown` re-parse on every token (high-frequency during generation) |
| 112.2 | Bug | Low | `MixHealthDialog.tsx` — `runAnalysis()` has no `AbortController`; rapid open/close cycles start multiple concurrent analysis requests with no cancellation |
| 112.3 | Convention | Low | `MixHealthDialog.tsx` — `console.error(error)` in two catch blocks bypasses `logger` abstraction (§23.3) |
| 113.1 | Structure | Low | `compileDso.ts` — `let lastInsertedDeviceId` module-level mutable shared across concurrent `executeDsos()` calls; race condition if two AI edits execute in parallel |
| 113.2 | Convention | Low | `compileDso.ts` — `console.warn(...)` on DSO execution failure bypasses `logger` abstraction (§23.3) |
| 114.1 | Structure | Medium | `sessionManagement.ts` — 13 module-level mutable vars (peer connections, intervals, subscriptions); HMR leaves WebRTC connections open, intervals running, and subscriptions active |
| 114.2 | Structure | Low | `sessionManagement.ts` — `DOC_BRANCHES = '__branches__'` is a 3rd magic docId on the CRDT sync channel (§89.2/§110.1 pattern); `__permissions__`, `__asset__`, `__branches__` all collide if real docs use these IDs |
| 114.3 | Performance | Low | `sessionManagement.ts` — `JSON.stringify(branches)` × 2 on every CRDT change notification to detect branch list changes; structural equality check would avoid serialization |
| 115.1 | Performance | Low | `DeviceParameterControl.tsx` — `autoState.lanes.find(...)` scans all automation lanes on every render for every device parameter; subscribes to full automationStore (O(lanes) per param per render) |
| 115.2 | Verbosity | Low | `DeviceParameterControl.tsx` — automation toggle button (18 JSX lines) duplicated verbatim in slider branch and non-slider branch; should be extracted to a variable |
| 116.1 | Bug | Medium | `stripSilence.ts` — `_minSilenceBeats` parameter documented and exposed in function signature but never used in implementation; callers passing a min-silence value get no effect |
| 116.2 | Bug | Low | `stripSilence.ts` — clip IDs generated with `Date.now()` base, bypassing central `getNextClipId()`; two calls in the same millisecond produce colliding IDs |
| 117.1 | Bug | Low | `songStructureDetection.ts` — `else if (isHigh && progress > 0.5)` Drop branch is unreachable; `isHigh` case already handled by the prior Chorus arm; no segment is ever classified as Drop |
| 117.2 | Performance | Low | `songStructureDetection.ts` — `Math.min(...allClips.map(...))` / `Math.max(...)` spread on large array; risks stack overflow for large arrangements (§4.4 pattern) |
| 118.1 | Structure | Low | `initWAMEnvironment.ts` — `let groupCounter = 0` module-level; HMR resets WAM group IDs; `context as unknown as Record<string, unknown>` double cast to attach non-standard property |
| 118.2 | Structure | Medium | `helpers.ts` (WAM) — `registry` and `instances` Maps module-level; HMR erases all registered WAM descriptors and orphans active WAM instances (§14.1 pattern) |
| 118.3 | Convention | Low | `loadWAMPlugin.ts` — `console.warn(...)` in 3 failure paths bypasses `logger` abstraction (§23.3 pattern) |
| 119.1 | Performance | Low | `createAutomergeStorage.ts` — `JSON.parse(JSON.stringify(value))` on every rAF write; full round-trip for large stores (midiStore, trackStore) on every knob sweep or drag |
| 119.2 | Performance | Low | `createAutomergeStorage.ts` — `hydrate()` performs 3 JSON operations per store (stringify incoming + parse + stringify cached); `projectCrdtToStores()` calls it on 10 stores = 30 JSON ops per remote CRDT tick |
| 119.3 | Convention | Low | `createAutomergeStorage.ts` — `console.error(...)` in rAF write error handler bypasses `logger` abstraction (§23.3) |
| 120.1 | Bug | Medium | `semanticChangeContext.ts` — `currentContext` module-level mutable shared across concurrent `executeAppAction` calls; second concurrent action's context clobbers first before first handler writes to store |
| 121.1 | Structure | Low | `crdtProjectLifecycle.ts` — `let incrementalSaveCount = 0` module-level; HMR resets compaction counter; incremental chunks accumulate unboundedly during dev sessions (§14.1 pattern) |
| 121.2 | Convention | Low | `startCrdtAutoSave.ts` — `console.warn(...)` on persist failure bypasses `logger` abstraction (§23.3 pattern) |
| 122.1 | Structure | **High** | 41 `let xId = 1` module-level ID counters across the codebase; HMR resets all to 1 causing silent ID collisions; two pairs are outright duplicated (`nextUndoId`/`nextGroupId` in UndoEntry.ts+commandQueries.ts; `nextSidechainId` in two model files); fix: `crypto.randomUUID()` everywhere |
| 123.1 | Structure | Low | `clipboardStore.ts` — `export let clipClipboard` / `export let noteClipboard` mutable `let` exports; HMR resets clipboard state; `let` re-exports allow external mutation without going through setter |
| 124.1 | Bug | **High** | `KneadEditor.tsx` — hardcoded mock pitch data (A3/E4/C4 at fixed timestamps) is auto-injected into `kneadStore` via `ingestDspAnalysis` for every Knead device after a 600ms timeout; all users see fabricated pitch blobs instead of real analysis |
| 124.2 | Verbosity | Low | `KneadEditor.tsx` — `clipId: _clipId` prop received and immediately discarded; either remove from interface or use to scope analysis |
| 125.1 | Bug | Low | `WaveformEditor.tsx` — `draw` function in ResizeObserver `useEffect` dependency array; observer is torn down and recreated on every render that changes `draw`'s captured values |
| 125.2 | Performance | Low | `WaveformEditor.tsx` — `trackStore.value?.tracks.flatMap(...)` called directly during render (not via `useStore`); bypasses subscription so `realClipId` goes stale; `flatMap` allocates full clip array every render |
| 125.3 | Bug | Low | `WaveformEditor.tsx` — waveform only redraws when `bufferVersion` is incremented (drag-drop path); audio buffers loaded via other paths (engine async decode) won't trigger a redraw |
| 126.1 | Performance | Low | `AutomationLaneRow.tsx` — two O(n) `filter()` passes over all automation points on every playhead tick (60fps); binary search on sorted points would reduce to O(log n) |
| 126.2 | Performance | Low | `AutomationLaneRow.tsx` — `new Map(lane.points.map(...))` rebuilt inside path segment loop on every render; O(n) Map allocation keyed by point object reference |
| 126.3 | Performance | Low | `AutomationLaneRow.tsx` — subscribes to full `transportStore`; re-renders on all transport events (BPM, play/pause, loop) even though only `playheadPosition` is used; N lanes × every transport event |
| 127.1 | Verbosity | Low | `llmMidiGeneration.ts` — `fallbackToPatternMatch` helper defined inside exported async function; new closure on every call; should be module-level |
| 127.2 | Bug | Low | `llmMidiGeneration.ts` — `backend === 'cloud'` silently falls back to local pattern match with no error or warning; users receive local generation without being informed |
| 128.1 | Structure | **High** | `compilerEngine.ts` — 5 module-level mutable vars (compiler singleton, module Map, promise caches); HMR resets all, triggering a fresh 15MB Faust WASM download and orphaning all compiled AudioWorklet nodes |
| 128.2 | Convention | Low | `compilerEngine.ts` — `console.error(...)` × 2 bypass `logger` abstraction (§23.3 pattern) |
| 129.1 | Structure | Medium | `webMidi/state.ts` — 8 mutable `export let` vars for MIDI access, active input, notes, and Tauri listener; HMR resets all, causing stuck MIDI notes, leaked Tauri subscriptions, and lost MIDIAccess reference |
| 130.1 | Structure | Low | `offlineRender.ts` — `cancelFlag` and `isRenderingActive` module-level; HMR resets both mid-export, bypassing the render-lock guard and making `cancelExport()` target the wrong flag |
| 131.1 | Bug | **High** | `encodeAudio.ts` + `decodeLatent.ts` — RAVE ONNX model calls replaced by fake sine-wave simulations; users invoking timbre transfer receive fake audio; both files self-document as stubs but are shipped as production code (§124.1 pattern) |
| 132.1 | Bug | Low | `ShortTermLUFS.ts` — constructor `sampleRate` parameter has no effect; `(3 × sr) / (0.4 × sr)` always equals `8`; misleading API |
| 132.2 | Convention | Low | `processRealtimeMidiInput.ts` — hardcoded `sampleTime + 128` block end; same magic number as `MarkovChain.ts:100`; should be a named constant |
| 132.3 | Verbosity | Low | `processYeastMidi` — `_trackId` parameter always passed as `''`; never implemented; should be removed from the public API |
| 133.1 | Structure | Low | `useAppInitialization.ts` — `registerBuiltinPlugins()` and `registerBuiltinFaustDSP()` called inside `initializeAudioEngine()` (lines 21–22) and then called again explicitly in `useAppInitialization.ts` (lines 57–58) after `await initializeAudioEngine()` returns; `registerProModulationEffects()` and `registerProSynthInstruments()` called only in the hook, creating asymmetry; registry `set()` silently overwrites so no crash but every builtin plugin and DSP module is registered twice on startup |
| 134.1 | Performance | Low | `usePianoRollRenderer.ts` — `visiblePitches.indexOf(pitch)` called once per note per rAF frame in both `drawActiveNotes` and `drawGhostNote`; O(notes × pitches) per frame; also `tracks.filter(...)` allocates on every frame in `drawGhostNotes`; a `pitchToRow` Map built once per grid key change would reduce to O(1) |
| 135.1 | Bug | Medium | `automergeRepository.ts` — `_loadAllSync` loop calls `Automerge.save(doc)` for every doc and discards the return value; `Automerge.save()` is pure with no side-effects; all N full serializations are wasted CPU on every synchronous project load |
| 135.2 | Performance | Low | `automergeRepository.ts` — `Automerge.init()` called solely to extract an actor ID via `getActorId()`; allocates a full WASM-backed CRDT document that is immediately discarded; replace with `crypto.randomUUID()` |
| 135.3 | Structure | Low | `automergeRepository.ts` — `_crdtWorker` module-level; HMR creates new Worker and leaves old Worker's message handlers attached; in-flight `invokeWorker` promises from before HMR never resolve; new module resets `_crdtWorkerNextId` to 0, potentially matching old listeners' IDs |
| 135.4 | Convention | Low | `automergeRepository.ts` — `console.warn`/`console.error` × 4 (lines 228, 272, 311, 377) bypass `logger` abstraction (§23.3 pattern) |
| 136.1 | Performance | Low | `useStatusBarMetrics.ts` — `refs.cpuBar.current.className = ...` overwrites entire className string on every frame (60fps); clobbers any externally added classes; should use `classList` replacement only when threshold crosses a boundary |
| 137.1 | Bug | Medium | `sampleTaggingHelpers.ts` — `generateFingerprint()` self-documents as stub; computes a djb2 hash of filename+path, not audio content; two samples with same name/path but different audio produce the same fingerprint; similarity search built on it produces arbitrary results (§131.1 pattern) |
| 138.1 | Performance | Low | `automergeSync.ts` — `sendSyncToAllPeers()` called on every CRDT change; dispatches O(peers × docs) `generateSyncMessage` calls per local write; with 3 peers + 10 docs, each note move triggers 30 Automerge protocol round-trips |
| 138.2 | Performance | Low | `automergeSync.ts` — `bytesToBase64` uses `Array.from(bytes, ...)` materialization (§110.4 pattern); for 256KiB payloads creates a 262,144-element temp array |
| 138.3 | Convention | Low | `automergeSync.ts` — `DOC_BRANCHES` and `DOC_PREFIX_ROOT` locally re-declared; already defined in `sessionManagement.ts` and `CrdtDocumentTypes.ts`; 3rd copy of same magic strings (§114.2 pattern) |
| 138.4 | Convention | Low | `automergeSync.ts` — `console.error` × 2 bypass `logger` abstraction (§23.3 pattern) |
| 139.1 | Structure | Low | `connectFolder/helpers.ts` — `export let scanAbortController` shared mutable; concurrent scans overwrite each other's controller; HMR leaves old controller unreachable; `cancelScan()` silently no-ops post-HMR (§14.1 + §129.1 pattern) |
| 139.2 | Bug | Low | `connectFolder/helpers.ts` — progress formula `totalFound / (totalFound + 100)` always evaluates to `< 1`; users see monotonically increasing but never-100% progress bar during scanning; final `1.0` only fires in `finally` |
| 139.3 | Convention | Low | `connectFolder.ts` — library root ID uses `Math.random()` (unseeded, §55.3 pattern); use `crypto.randomUUID()` |
| 139.4 | Bug | Low | `connectFolder/helpers.ts` — sample ID uses colon as separator (`${rootId}:${relativePath}`); ambiguous if `relativePath` contains `:` (valid on POSIX); lookup by ID could fail or collide |
| 140.1 | Bug | Low | `generateMidiVariations.ts` — `\\n\\n` in template literal produces literal `\n` characters, not newlines; LLM prompt sends backslash-n text instead of line breaks between context and instructions |
| 140.2 | Typing | Low | `generateMidiVariations.ts` — `(n: any)` cast on line 40 suppresses types on `notes` returned by typed internal `getNotesForClip()`; remove cast |
| 141.1 | Performance | **High** | `SpectrumAnalyzer.tsx` — noise overlay drawn with 4,000 individual `fillRect` calls per rAF frame (300×120 canvas, 3px grid) + 4,000 `Math.random()` calls + 4,000 template string allocations at 60fps = 240,000 ops/second; use an OffscreenCanvas noise texture blitted once per frame |
| 141.2 | Performance | Low | `SpectrumAnalyzer.tsx` + `Oscilloscope.tsx` + `Goniometer.tsx` + `Spectrogram.tsx` — `new Float32Array(fftSize)` allocated on every rAF frame in all 4 metering components; buffer should be created once in `useEffect` and reused |
| 141.3 | Performance | Medium | `Oscilloscope.tsx` — same per-frame noise texture loop as §141.1 (4,000+ `fillRect` calls/frame at 60fps on 200×80 canvas) |
| 142.1 | Performance | Low | `SessionView.tsx` — `getClipForSlot()` calls `tracks.find()` for every scene slot during render (64 O(n) scans for 8 tracks × 8 scenes); use a `Map<trackId, Track>` built once before rendering |
| 142.2 | Bug | Medium | `SessionView.tsx` — `activeSlots` state is local React state only; clicking Launch Slot/Scene dispatches no audio command; session view clip launcher is entirely disconnected from the audio engine |
| 143.1 | Performance | Medium | `buildTimelineRenderModel.ts` — recording path spreads all N track + M clip objects on every rAF frame; for 20 tracks × 100 clips = 2,000 object allocations/frame at 60fps while recording; only the recording clips' `endBeat` changes |
| 144.1 | Convention | Low | `AnimationScheduler.ts` — `console.error(...)` in tick error handler bypasses `logger` abstraction (§23.3 pattern); also module-level singleton; HMR re-evaluation loses all registered rAF callbacks (timeline, status bar, piano roll) until components remount |
| 145.1 | Structure | Low | `keyManagement.ts` — Anthropic API key stored in module-level `let apiKey`; HMR re-evaluation loses the configured key; user must re-enter key after each HMR event in dev mode |
| 145.2 | Security | Low | `keyManagement.ts` — `dangerouslyAllowBrowser: true` with `new Anthropic({ apiKey })` in browser context; key lives in JS heap and is inspectable via browser dev tools; acceptable for desktop Tauri context but a security concern if app ever runs in a shared web context |
| 146.1 | Convention | Low | `sendChatMessage.ts` — function body not indented (lines 95–200+ at column 0 inside exported `async function`); inconsistent with rest of codebase |
| 147.1 | Structure | Medium | `audioRecorder/recording.ts` — 5 module-level mutable vars hold active recording session state (`mediaStream`, `sourceNode`, `recordingNode`, `recordingWorker`, `onRecordingComplete`); HMR mid-recording resets `onRecordingComplete = null`; OPFS worker completes, `buildAndDeliver()` finds `cb === null`, silently discards captured audio; also orphans live `MediaStream` tracks (§14.1 pattern) |
| 148.1 | Performance | Medium | `fermenterProcessor.ts`, `levainProcessor.ts`, `toasterProcessor.ts` — `Array.shift()` called inside `process()` (hard-realtime audio thread); O(n) with potential backing-store reallocation; violates CLAUDE.md "no allocation on audio thread" rule; fix: pre-allocated ring buffer |
| 149.1 | Performance | Low | `MidiRack.processBlock()` — allocates 5–7 new arrays per call (spread merge, per-processor output array, separation array, `drainRange` drained+remaining); called from `YeastWorkletProcessor.port.onmessage` (AudioWorkletGlobalScope); contributes to GC pressure between `process()` cycles |
| 149.2 | Performance | Low | `MidiRack.processBlock()` — template literal `` `${ch}:${note}` `` allocates a string per MIDI event for active-note tracking key; at 10 events/block × 375 blocks/sec = 3,750 string allocations/sec |
| 150.1 | Performance | Medium | `Bacteria/SpectrumAnalyzer.tsx` — 128 `createLinearGradient()` GPU objects created and discarded on every render (7,680/sec at 60fps); use a single solid fill or cached gradient ImageData |
| 150.2 | Performance | Low | `Bacteria/SpectrumAnalyzer.tsx`, `WaveshaperEditor.tsx`, `BezierLfoEditor.tsx` — `useEffect(() => { draw(); })` with no dep array triggers full canvas redraw on every parent re-render, not just on data changes |
| 150.3 | Performance | Low | `Bacteria/SpectrumAnalyzer.tsx` — `new Array(128).fill(0)` per render + heatmap `[...barData]` spread + `shift()` (O(n) element shift) on each frame when heatmap trail is full |
| 151.1 | Performance | Low | `usePresence.ts` — `new Map(prev)` full clone on every peer presence heartbeat; at 3 peers × 5 updates/sec = 15 Map clones/sec, each triggering a React re-render of all subscribers |
| 152.1 | Structure | Low | `browserStemSeparation.ts` — module-level `let cachedSession` reset on HMR; next call must rebuild ONNX session and re-download 235MB model (§14.1 pattern) |
| 152.2 | Performance | Low | `browserStemSeparation.ts` — `await import('onnxruntime-web')` called twice per stem separation (lines 102 and 130); second call is redundant; `ort` from first import should be reused |
| 153.1 | Performance | Low | `audioToMidi.ts` — `getAllTracks().flatMap(t => t.clips).find(...)` allocates full clip array across all tracks before `find` short-circuits; use nested loop with early exit |
| 153.2 | Performance | Low | `audioToMidi.ts` — `Math.max(...onsets.map(...), 1e-8)` spreads potentially thousands of onset amplitudes as call arguments; stack overflow risk for dense percussion (§4.4 pattern); also calls `getAllTracks()` twice |
| 154.1 | Performance | Medium | `scheduleMidiNotes.ts` — O(N²) linear scan to match noteOff events for each Yeast noteOn; for 100 notes = 20,000 comparisons per scheduler block; fix with a pre-built Map keyed by note number |
| 154.2 | Performance | Low | `scheduleMidiNotes.ts` — `tracks.find()` (O(tracks)) and `tracks.filter()` (O(tracks), allocates array) both called inside the innermost per-note loop for Toaster child tracks |
| 154.3 | Performance | Low | `scheduleMidiNotes.ts` — device-type dispatch uses `.some()` + `.find()` pair for 4 device types per note; 8 array scans per note; precompute `Map<type, Device>` once per track |
| 155.1 | Structure | Low | `applyAutomation.ts` — module-level `_pluginParamSlew` Map reset on HMR; slew state lost causing zipper-noise artifact on first post-HMR scheduler tick; stale keys accumulate for removed devices (§14.1 pattern) |
| 155.2 | Performance | Low | `applyAutomation.ts` — `tracks.find(t => t.id === lane.trackId)` called per lane per scheduler tick (~100Hz); 400 comparisons/tick with 20 lanes × 20 tracks; use a Map built before the loop |
| 155.3 | Performance | Low | `applyAutomation.ts` — template literal `` `${trackId}:${deviceId}:${paramId}` `` reconstructed every tick per plugin param lane; 1,000+ string allocations/sec with 10 lanes at 100Hz |
| 156.1 | Performance | Low | `findSimilarSamples.ts` — O(N) Set + array + object allocations per sample for Jaccard computation; for 10,000 samples = 70,000+ allocations per call; union size formula avoidable: `targetSize + sampleSize - overlap` |
| 157.1 | Performance | Low | `builtinSynth.ts` — new `AudioBuffer` + ~4,800 `Math.random()` calls per note where `noiseLevel > 0`; at 8 notes/sec = 38,400 calls/sec; fix: pre-generated shared noise `AudioBuffer` reused across notes |
| 158.1 | Performance | Medium | `getAutomationValueAtBeat.ts` — two `filter()` calls over sorted automation points allocate 2 arrays per call; called from `applyAutomation` at ~100Hz × 20 lanes = 4,000 allocations/sec; replace with binary search (O(log n), zero allocations) |
| 159.1 | Performance | Medium | `importMidiFile.ts` — `parseMidiFile()` runs synchronously on the main thread; `setTimeout(0)` yields once but does not prevent freeze; large orchestral MIDI (300K events) blocks UI for 200–500ms; fix: Web Worker (self-documented as known limitation) |
| 159.2 | Convention | Low | `importMidiFile.ts` — note IDs use sequential `let noteId = 0` counter scoped to each import call; non-unique across concurrent imports; same §122.1 pattern |
| 160.1 | Performance | Low | `useStatusBarMetrics.ts` — `Array.shift()` on a 30-element CPU-sample buffer at 60fps; O(n) per frame; fix: circular buffer |
| 160.2 | Performance | Low | `useStatusBarMetrics.ts` — template-literal className string allocated and assigned every rAF frame; should skip re-assignment when colour band hasn't changed |
| 161.1 | Bug | Low | `exportMidiFile.ts` — `push(...spread)` inside note loop; for 50,000+ events the spread argument count can exceed V8's ~65,536 limit and throw `RangeError`; also `new Uint8Array([...header, ...track])` materialises a ~500,000-element intermediate array |
| 162.1 | Performance | Low | `StepSequencerEditor.tsx`, `SpectralBinEditor.tsx` — `useEffect(() => draw())` with no dep array (§150.2 pattern); 5th and 6th instances across Bacteria canvas editors |
| 163.1 | Performance | Low | `Fermenter/SpectrumAnalyzer.tsx` — `ctx.save()/restore()` called per bar in the glow loop (up to 64× per draw); hoist outside the loop |
| 163.2 | Performance | Low | `Fermenter/SpectrumAnalyzer.tsx` — template-literal `rgb()/rgba()` strings allocated per bar (up to 64 per draw); cache as `CanvasGradient` or solid colour |
| 164.1 | Performance | Low | `Fermenter/SignalFlowView.tsx` — 15-20 `FlowNode` objects + connections array rebuilt on every render (component body, outside `useEffect`); move build into `useEffect` callback |
| 165.1 | Performance | Medium | `ScoringPanel/StrobeDisplay` — `useEffect` deps on `[cents, active]`; rAF loop cancelled and restarted on every scoring telemetry tick; causes one-frame gap per tick; fix: stable `[]` deps, read `centsRef.current` inside draw |
| 165.2 | Performance | Medium | `ScoringPanel/StrobeDisplay` — 480 per-pixel `fillStyle` string + `fillRect` calls per rAF frame; fix: `ImageData` direct pixel writes + single `putImageData` |
| 165.3 | Performance | Low | `ScoringPanel/HistoryGraph` — `Array.shift()` on 300-element buffer + full canvas redraw triggered on every scoring telemetry tick (same §160.1 + §165.1 patterns) |
| 166.1 | Performance | Low | `GrandBoule/SpectralWaterfall.tsx` — up to 22,528 per-cell `fillStyle` template-literal string allocations per rAF frame for dense harmonic signals; fix: `ImageData` buffer |
| 167.1 | Structure | **High** | `playheadScheduler.ts` — 8 module-level mutable vars hold all scheduler state; HMR during playback resets `timerId`, `activeAudioSources`, both Sets and all position counters; old sources cannot be stopped, clips are double-scheduled (§14.1 — most severe instance) |
| 167.2 | Typing | Low | `playheadScheduler.ts` — `activeAudioSources as any[]` cast in 3 places to access `fadeGainNode` injected in `scheduleAudioClips.ts`; define typed `ScheduledSource` wrapper |
| 167.3 | Performance | Low | `playheadScheduler.ts` — O(tracks × clips) full `trackStore` spread at recording-stop time to update one `audioBufferId` (§143.1 pattern) |
| 168.1 | Structure | Low | `scheduleAudioClips.ts` — module-level `requestedAssets` Set cleared on HMR; next tick floods collaboration peer with duplicate `requestAsset()` calls (§14.1 pattern) |
| 168.2 | Convention | Low | `playheadScheduler.ts` — recording buffer ID uses `Math.random()` with 6 base-36 chars; multi-track simultaneous recordings within same ms can collide (§55.3 pattern) |
| 169.1 | Bug | Medium | `songStructureDetection.ts` — `Math.min/max(...allClips.map(...))` spreads all clips as call arguments; throws `RangeError` for 1,000+ clips (§4.4 pattern) |
| 169.2 | Bug | Medium | `songStructureDetection.ts` — `else if (isHigh && progress > 0.5)` at line 155 is dead code; unconditional `else if (isHigh)` at line 149 catches all `isHigh` cases first; Drop section type is never classified |
| 170.1 | Structure | Low | `semanticChangeContext.ts` — module-level `let currentContext` HMR reset; CRDT change records produced between `setSemanticContext` and `clearSemanticContext` lose their semantic label after HMR (§14.1 pattern) |
| 171.1 | Performance | Low | `assetTransfer.ts` — `arrayBufferToBase64` materialises 262,144 single-char strings per 256 KiB chunk via `Array.from`; 10 MB file = ~10.5M string allocations (§138.2 pattern) |
| 172.1 | Performance | Low | `LoudnessHistory.tsx` — `history.shift()` on 300-element array at 10fps; sibling `GrHistory.tsx` already uses a circular Float32Array (§160.1 pattern, 4th instance) |
| 173.1 | Performance | Low | `audioAiEngine.ts:95` — `Array.from(new Uint8Array(audioData))` materialises full audio buffer as boxed number array for Tauri IPC; ~105M allocations for 5-min file; pass `Uint8Array` directly |
| 173.2 | Performance | Low | `decodeAudioFile.ts:34` — same `Array.from(new Uint8Array(arrayBuffer))` pattern for Tauri IPC; triggered on every audio file import in desktop mode (§173.1 pattern) |
| 174.1 | Bug | Medium | `useProofAnalyser` + `TonalBalance` — `Float32Array` is mutated in place; same object reference means `useEffect([fftData, ...])` never re-fires; live tonal balance display is a static snapshot frozen at mount |
| 175.1 | Verbosity | Low | `Grinder/grinderParamBridge/helpers.ts` — 8th verbatim copy of `createFindDeviceRef` (§33.1 / §53.1 pattern) |
| 176.1 | Bug | Medium | `inputMonitoring.ts` — `monitorStream`/`monitorSource` module-level vars; HMR resets both to `null` leaving microphone open and audio routed to track until page reload (§129.1/§147.1 pattern) |
| 177.1 | Structure | Medium | `yeastStore.ts` — `rackInstance`/`processorTypeMap`/`_workletNode`/`_workletNodePromise` module-level; HMR orphans `MidiRack` and old `AudioWorkletNode`; new lazy-init creates second concurrent worklet (§14.1/§128.1 pattern) |
| 178.1 | Performance | Medium | `moveClipPreview.ts` — O(tracks × clips) full store write on every pointermove during clip drag; ~3,000 object allocations + full React re-render per event (§74.2/§143.1 pattern) |
| 178.2 | Performance | Low | `shiftClipMidiNotes.ts` — called from `moveClipPreview` per drag event; `notes.map(n => ({...n, startBeat: n + delta}))` allocates one new note object per note; 60fps × 1,000 notes = 60,000 allocations/sec |
| 179.1 | Verbosity | Low | `reverseClip.ts:19` — `new OfflineAudioContext(...)` created solely for `createBuffer` then orphaned; use `new AudioBuffer({...})` instead; `Date.now()` for buffer ID (§122.1 pattern) |
| 180.1 | Performance | Low | `createEventBus.ts:29` — `promises: Promise<void>[]` allocated on every `emit` even when all handlers are synchronous; lazy-allocate on first `push` instead |
| 180.2 | Convention | Low | `createEventBus.ts:38,49` — `console.error` in handler-error catch blocks bypasses `logger` abstraction (§23.3 pattern) |
| 181.1 | Performance | Low | `MiniMasterSpectrum.tsx:50` — `createLinearGradient` GPU object allocated on every rAF frame (60/sec); hoist outside draw loop |
| 181.2 | Performance | Low | `MiniMasterSpectrum.tsx:72` — `useEffect([isSelected])` restarts rAF loop on selection change; causes one-frame blackout (§165.1 pattern) |
| 182.1 | Performance | Medium | `BeatRulerBar.tsx:72` — `canvas.width = w * dpr` on every `drawRuler` call (60fps during playback) forces full canvas clear + 2D context state reset even when dimensions haven't changed |
| 182.2 | Performance | Low | `BeatRulerBar.tsx:77` — `createLinearGradient` GPU object created on every draw (§181.1 pattern, 2nd instance) |
| 182.3 | Bug | Low | `BeatRulerBar.tsx:226-228` — `drawRuler` called directly in component render body (side effect during render); fires on every re-render |
| 182.4 | Performance | Low | `BeatRulerBar.tsx:216` — `drawRuler` (no `useCallback`) in `useEffect` dep array causes rAF loop to re-register on every render; captured loop closure briefly stale after each dep-change re-register |
| 183.1 | Bug | Medium | `TrackListView.tsx:159` — `window.confirm()` for track deletion blocks the JS event loop and audio scheduler while the dialog is open; causes audible dropout during playback |
| 184.1 | Performance | Low | `LevelMeter.tsx:30` — `crypto.randomUUID()` called in render body (not `useRef`); new UUID on every parent re-render; harmless but wasteful |
| 184.2 | Performance | Medium | `LevelMeter.tsx:116` — `createLinearGradient` (6 color stops) on every rAF tick; 30 mixer strips × 60fps = 1,800 GPU gradient objects/sec (§181.1 pattern) |
| 184.3 | Performance | Low | `LevelMeter.tsx:88` — `Array.shift()` on 30-element RMS buffer at 60fps per strip (§160.1 pattern) |
| 185.1 | Performance | Low | `TrackLevelIndicator.tsx:74` — `new Float32Array(analyser.fftSize)` allocated inside rAF draw loop; 1,200/sec with 20 tracks (§141.2 pattern, 7th instance) |
| 185.2 | Performance | Low | `TrackLevelIndicator.tsx:100` — `dbToColor()` allocates rgba template-literal string per frame per track (§163.2 pattern) |
| 186.1 | Bug | Medium | `usePreviewAudio.ts:78` — `stop()` calls `.stop()` on an unstarted dummy `AudioBufferSourceNode` (throws, swallowed); the `OscillatorNode` playing the tone is never stopped; two tones can overlap and tones cannot be cancelled mid-play |
| 196.1 | Performance / UX | Medium | `useAppEventHandlers.ts:28`, `TrackContextMenu.tsx:165`, `useChannelStripActions.ts:65` — three more `window.confirm()` callers blocking audio thread (§183.1 pattern); all four should use async non-blocking dialogs |
| 187.1 | Bug | **High** | `GenerativeAiPanel.tsx:107,109` — Rules of Hooks violation: two `useStore` calls placed after an early `return null`; hook count changes with panel visibility → invariant violation / state corruption |
| 188.1 | Bug | Low | `usePromptExecution.ts:312` — stale closure: `if (!preview)` in the `finally` block reads the pre-render closure value (always `null`), so `setValue('')` always clears the input even when a confirmation preview was just set |
| 189.1 | Performance | Low | `Oscilloscope.tsx:42`, `SpectrumAnalyzer.tsx:42`, `Goniometer.tsx:36` — `new Float32Array(frequencyBinCount)` allocated inside rAF draw loop on every frame (§141.2 pattern, 8th / 9th / 10th instances); correct pattern in `LUFSMeter.tsx:57–63` |
| 190.1 | Performance | Medium | `Oscilloscope.tsx:49–54`, `SpectrumAnalyzer.tsx:56–62` — noise texture redrawn via nested `Math.random()` + template-literal `rgb(v,v,v)` per cell on every rAF tick; ~103k–240k string allocations/sec |
| 191.1 | Performance | Low | `SpectrumAnalyzer.tsx:105` — `createLinearGradient` (5 color stops) inside rAF draw loop at 60fps (§181.1 pattern, 5th instance) |
| 192.1 | Performance | Low | `Goniometer.tsx:113` — `ctx.getImageData()` on every rAF tick: synchronous GPU→CPU pixel readback (57,600 bytes/frame) stalls the main thread; phosphor trail can be kept GPU-side with an `OffscreenCanvas` accumulator |
| 193.1 | Performance | Low | `Spectrogram.tsx:81`, `PhaseCorrelationDisplay.tsx:34,41,42` — four more `new Float32Array` in rAF draw loops (§141.2 pattern, instances 11–14); `PhaseCorrelationDisplay` allocates 3 arrays per frame |
| 194.1 | Performance | Low | `PhaseCorrelationDisplay.tsx:80–85` — `resolveToken` (= `getComputedStyle`) called conditionally inside rAF draw loop at 60fps; tokens should be resolved once outside the loop (as `LUFSMeter.tsx:48–51` already does) |
| 195.1 | Performance | Low | `WaveformEditor.tsx:115–116` — `canvas.width/height` reset unconditionally on every draw call without dimension check (§182.1 pattern) |
| 195.2 | Performance | Low | `WaveformEditor.tsx:213–214` — `ResizeObserver` disconnected and re-registered on every render because `draw` has no `useCallback` (§182.4 pattern) |
| 195.3 | Bug | Low | `WaveformEditor.tsx:313–315` — `trackStore.value` accessed directly during render without `useStore`; `realClipId` is not reactive and will go stale when the track list changes |
| 197.1 | Bug | Low | `ClipGainEnvelopeSection.tsx:25` — `getClipGainEnvelope` reads store directly, not via `useStore`; manual `envKey` counter only covers mutations from within this component; undo/redo, collab sync, and external actions leave envelope data stale |
| 198.1 | Bug | Low | `TrackNotesSection.tsx:13` — `useState(track.notes)` initialises from prop once at mount; external changes to `track.notes` (undo, collab) are silently ignored; textarea displays stale content |
| 199.1 | Performance | Low | `TimelineMinimap.tsx:42–43` — `canvas.width/height` reset unconditionally inside `useLayoutEffect([..., scrollX])` — fires on every scroll event (60fps drag); §182.1 pattern in the minimap |
| 199.2 | Performance | Low | `TimelineMinimap.tsx:70,109` — two `createLinearGradient` objects per `useLayoutEffect` call (background + viewport indicator); recreated on every scroll/zoom event; same §181.1 pattern |
| 199.3 | Convention | Low | `TimelineMinimap.tsx:231` — bare `scrollAtDragStart;` expression statement inside `handleMouseMove` does nothing; suppresses unused-variable lint but contributes nothing at runtime; dead code |
| 200.1 | Performance | Low | `NotePropertyLane.tsx:87–88` — `canvas.width/height` reset unconditionally on every `useLayoutEffect` call (fires on note edit, selection change, zoom); §182.1 pattern in the velocity/CC/pitch-bend lanes |
| 200.2 | Performance | Low | `NotePropertyLane.tsx:97` — `resolveToken` (= `getComputedStyle`) called inside `useLayoutEffect` draw body; resolves on every note edit and selection change; §194.1 pattern |
| 201.1 | Bug | Low | `RoutingGraph.tsx:178` — `getAllSidechainRoutes()` reads `sidechainStore.value` directly during render without `useStore` subscription; adding or removing sidechain routes doesn't trigger a re-render; graph shows stale connections |
| 202.1 | Bug | Low | `TrackVcaSection.tsx:58` — `getVcaGroups()` reads bare module-level `let vcaGroups` variable during render without any reactive subscription; creating or renaming a VCA group doesn't trigger a re-render; the `<select>` options list goes stale |
| 203.1 | Bug | Low | `ClipContextMenu.tsx:56,63` — `trackStore.value` and `workspaceStore.value` read directly during render without `useStore` subscriptions; clip renames and selection changes while the menu is open are invisible to the component; also derives `useState` initial value from the stale clip read (line 58) |
| 204.1 | Performance | Medium | `SpectrumAnalyzer.tsx:56–63` — per-frame random noise rendering loop calls `ctx.fillStyle` and `ctx.fillRect` ~4 000 times per animation frame (60fps); should pre-render noise to an `ImageData` buffer once and stamp it with `putImageData` |
| 204.2 | Performance | Low | `SpectrumAnalyzer.tsx:105–110` — `ctx.createLinearGradient` allocates a GPU gradient object inside the rAF draw loop (§181.1 pattern); gradient is static and should be created once outside the loop |
| 205.1 | Performance | Low | `LevelMeter.tsx:116` — `ctx.createLinearGradient` called inside the per-frame `tick()` rAF callback (§181.1 pattern); gradient only changes when meter height changes and should be cached |
| 205.2 | Convention | Low | `LevelMeter.tsx:30` — `crypto.randomUUID()` called in the render body (not in a ref or hook); generates a new UUID on every render; functionally correct only because the effect dep array omits it, but confusing and wasteful — replace with `useRef(crypto.randomUUID())`|
| 204.3 | Performance | Medium | `Oscilloscope.tsx:49–55` — same per-frame pixel noise loop as §204.1 (`SpectrumAnalyzer`); ≈3 000 individual fill calls per animation frame |
| 206.1 | Performance | Low | `WaveformEditor.tsx:115–116` — `canvas.width/height` assigned unconditionally inside `draw()` (§182.1 pattern); resets pixel data and 2D context state on every effect trigger |
| 206.2 | Performance | Low | `WaveformEditor.tsx:121` — `resolveToken` (`getComputedStyle`) called inside `draw()` on every effect trigger (§200.2 pattern) |
| 206.3 | Performance | Low | `WaveformEditor.tsx:208–214` — ResizeObserver `useEffect` depends on unstable `draw` function reference; disconnects and reconnects observer on every render |
| 206.4 | Bug | Low | `WaveformEditor.tsx:314` — `trackStore.value` read directly during render without `useStore` subscription; clip lookup goes stale if clips are moved or the track list changes |
| 207.1 | Bug | Low | `BeatRulerBar.tsx:226–228` — `drawRuler()` called directly in the render function body (not in a hook); React Strict Mode fires renders twice, causing double draws; should be `useLayoutEffect` |
| 207.2 | Performance | Low | `BeatRulerBar.tsx:72–73` — `canvas.width/height` unconditionally reset in `drawRuler()` called at rAF rate (§182.1 pattern); ruler height is fixed at 18px and almost never changes |
| 207.3 | Performance | Low | `BeatRulerBar.tsx:77–80` — `createLinearGradient` with static color stops allocated inside `drawRuler()` at rAF rate (§181.1 pattern) |
| 207.4 | Performance | Low | `BeatRulerBar.tsx:216` — unstable `drawRuler` function reference in `animationScheduler` effect dep array; re-registers ticker on every render during playback (§206.3 pattern) |
| 208.1 | Performance | Low | `MiniMasterSpectrum.tsx:50–53` — `createLinearGradient` with fixed color stops allocated inside the rAF `draw()` loop at ~60fps (§181.1 pattern) |
| 209.1 | Convention | Low | `GrandBoulePanel.tsx:121`, `ToasterPanel.tsx:82–83`, `SamplerPanel.tsx:62–64`, `CrustPanel.tsx:67` — `useStore(store, store.value!)` uses non-null assertion on live store value as default; crashes if store is null at mount; replace with explicit typed default objects |
| 210.1 | Performance | Low | `ScoringPanel.tsx:389,463` — two `createLinearGradient` objects with static color stops allocated inside the rAF `draw()` loop (§181.1 pattern); should be cached outside the loop |
| 211.1 | Bug | Low | `TimelineEmptyMenu.tsx:43` — `NearbyMarkerColorMenu` sub-component reads `markerStore.value?.markers` directly during render with no `useStore` subscription; marker list goes stale while the menu is open (§203.1 pattern) |
| 212.1 | Convention | Low | `ArrangementSelector.tsx:22` — `useStore(arrangementStore, arrangementStore.value!)` uses non-null assertion on live store value as default; crashes if store is null at mount (§209.1 pattern, 5th instance) |
| 213.1 | Structure | Low | `src/helpers/Store/` — `Store.ts`, `ReadonlyStore.ts`, `AutomergeStorage.ts`, `LocalStorageStorage.ts`, `MemoryStorage.ts`, `Storage.ts` are ~400 lines of dead code; superseded by `src/infra/store/`; no production import found; safe to delete (keep `LocalStorageKeys.ts`) |
| 213.2 | Structure | Low | `src/utils/` — 12 files, entire directory is unreferenced dead code; zero imports found via `#/utils` alias or relative paths; appears to be a stale clone of a `src/helpers/` subset; safe to delete entirely |
