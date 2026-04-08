# `inject()` compliance audit

## Scope

Cross-cutting review of **`src/modules/**/useCases/**/*.ts`** and **`src/modules/**/repositories/**/*.ts`** for collaborators (other use cases, repositories, cross-module services) that are **imported and invoked directly** instead of being declared on **`inject({ ... })`** dependency maps.

**Excludes:** presentation (`presentations/`), `*.spec.ts`, pure transformers/validators per `docs/architecture/03-typescript-module.md` §4.10, and intentional hot-path exceptions once explicitly documented.

**Related docs:** `docs/01-dependency-injection.md`, `docs/architecture/03-typescript-module.md` §4.10, `docs/06-testing.md` §5.

---

## Goal

Use cases and service repositories declare **all** outbound collaborators through **`inject(deps)(factory)`** so dependencies are explicit, resolved at call time, and replaceable in tests via **`injectDependencies()`**. No “hidden” imports of other use cases or repos for side-effectful work.

---

## Relevant code paths

- `src/infra/di/inject.ts`, `src/infra/di/testing/injectDependencies.ts`
- `src/modules/**/useCases/**` — primary surface
- `src/modules/**/repositories/**` — especially AudioEngine Web MIDI and similar adapters

---

## Current behavior

- **Many** use cases are already wrapped with `inject()` and tested with `injectDependencies()` (e.g. Transport transport controls, several Arrangement toggles, thin repo forwards).
- **Large** set of orchestration files still export plain functions that import other modules’ use cases or repos and call them without `inject`.
- **Subset** of files use `inject()` but only list **some** deps; other imported functions (`getTransportState`, `updateDeviceParam`, `addClip`, etc.) are still called directly.
- **Repositories** occasionally import use cases (e.g. Web MIDI message path) instead of receiving behavior via injection or narrow ports.

Representative **incomplete `inject` maps:**

- `src/modules/Arrangement/useCases/device/setDeviceParameter.ts` — injects track repo paths; calls `getTransportState`, `updateDeviceParam`, `recordAutomationValue` from imports.
- `src/modules/Arrangement/useCases/clip/duplicateClip.ts` — injects `getTrackState`; calls `duplicateClipAutomation`, `addClip` from imports.
- `src/modules/Transport/useCases/transportControls/startPlayback.ts` — injects transport repo; calls `resumeEngine`, `startPlayheadScheduler`, `ensureTrackStrips` from imports.
- `src/modules/Transport/useCases/transportControls/toggleRecording.ts` — large direct import graph (recording, engine, Arrangement, cache).

Representative **no `inject()`:**

- `src/modules/MIDI/useCases/midiRouting.ts` — imports `updateTrack` from Arrangement and calls it.

Representative **repository → use case imports:**

- `src/modules/AudioEngine/repositories/webMidi/messageHandlers.ts` — many `#/modules/.../useCases/` imports.

---

## Findings

1. **Two migration styles coexist:** thin `inject({ repoFn })` re-exports (e.g. `updateClip.ts`) vs **direct** `repositories/...` imports inside other use cases. Tests and mental model differ by file.
2. **Cross-module orchestration** (Transport scheduling, Command handlers, AI, demos) concentrates the most direct imports; these are the largest refactors.
3. **Incomplete maps** are often **faster to fix** than new wrappers: extend `inject({ ... })` and thread deps; add/update `injectDependencies` specs.
4. **Schedulers** (`scheduleMidiNotes.ts`, etc.) may need a **policy** (full inject vs injected façade vs documented exception for RT/hot path) before bulk edits.

---

## Priorities

1. **Complete `inject` dependency maps** on already-wrapped use cases (`setDeviceParameter`, `duplicateClip`, `startPlayback`, bridges, `midiLearn`, `exportMidiClip` follow-up).
2. **Wrap small leaf use cases** with no `inject` (`midiRouting.ts`, similar one-function files).
3. **Repository boundaries** — e.g. narrow `messageHandlers` dependencies via inject or explicit ports.
4. **Large schedulers / handler registries** — after patterns from (1)–(2) are stable.

---

## Open issues

### 1. Incomplete `inject()` dependency maps

**Problem:** Call sites use collaborators not listed in `inject({ ... })`, so tests cannot substitute them via `injectDependencies()` without `vi.mock`.

**Representative files:**

- `src/modules/Arrangement/useCases/device/setDeviceParameter.ts`
- `src/modules/Arrangement/useCases/clip/duplicateClip.ts`
- `src/modules/Arrangement/useCases/clip/moveClipPreview.ts`
- `src/modules/Arrangement/useCases/clipEditing/splitClipWithUndo.ts`
- `src/modules/Arrangement/useCases/setTrackGainPan.ts`
- `src/modules/Transport/useCases/transportControls/startPlayback.ts`
- `src/modules/Transport/useCases/transportControls/toggleRecording.ts`
- `src/modules/MIDI/useCases/midiLearn.ts`
- `src/modules/MIDI/useCases/exportMidiFile.ts` (`getAllTracks` / `midiStore` vs injected `downloadBlob`)
- `src/modules/Gluten/useCases/glutenParamBridge.ts`, `src/modules/Crust/useCases/crustParamBridge.ts`
- `src/modules/Toaster/useCases/toasterSubscriber.ts`

**Needed:** Add each directly called collaborator to the dependency map (aliased keys as today), update callers if signatures change, extend co-located `injectDependencies` tests.

---

### 2. Use cases without `inject()` wrapping

**Problem:** Exported functions call other use cases/repos with no inject wrapper.

**Representative files:**

- `src/modules/MIDI/useCases/midiRouting.ts` — **done** (see Resolved).
- Remaining handler/orchestration: `trackHandlers`, `clipHandlers`, `exportActions`, `recentProjects`, `analyzeMix`, etc. — grep `#/modules/.../useCases/` from `useCases` to refresh the list. (`trackViewActions`, `scratchPadHandlers`, `trackAlternativeHandlers` addressed in latest pass.)

**Needed:** Introduce `inject({ ... })` per exported function or per module export group; keep one function per file rule where applicable.

---

### 3. Repositories importing use cases

**Problem:** Repository layer pulls in application use cases, inverting the usual direction and bypassing inject for those calls.

**Representative files:**

- `src/modules/AudioEngine/repositories/webMidi/messageHandlers.ts` (primary hotspot)
- `src/modules/AudioEngine/repositories/faustDeviceFactory.ts` (compiler engine use case)
- `src/modules/Arrangement/repositories/presets/factoryPresets.ts` (Fermenter queries)

**Needed:** Extract ports, inject collaborators at repository construction/wiring, or move orchestration up into use cases and keep repos as thin I/O.

---

### 4. Transport / audio schedulers

**Problem:** `scheduleMidiNotes.ts` (and related) import many cross-module use cases; full inject may be noisy or hot-path sensitive.

**Representative files:**

- `src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts`
- `src/modules/Transport/useCases/scheduling/scheduleAudioClips.ts`

**Needed:** Architecture decision: inject all deps vs a single injected “scheduler context” façade vs documented exception with rationale.

---

## Open questions

- [ ] Do schedulers get a **blanket exception** from strict inject for RT performance, or must they use inject anyway?
- [ ] For **demo project** builders under `Project/useCases/demoProjects/`, is compliance required or are they exempt as scripts?

---

## Risks

- **Testability:** hidden deps force `vi.mock` and brittle tests.
- **Refactor safety:** unclear ownership when repositories call use cases.
- **Inconsistent patterns** slow onboarding and encourage new direct imports.

---

## Suggested approaches

- Tackle **issue 1** file-by-file with tests; no codemods (per `AGENTS.md`).
- Use **existing** inject-wrapped use cases (`getTrackById`, `updateClip`, …) as deps where the behavior matches, instead of duplicating repo imports.
- For **messageHandlers**, sketch a **facade** interface injected once rather than 15 separate use-case imports.

---

## Recommendation

Continue with **handler/orchestration** files that still import cross-module use cases without `inject`, then **`scheduleMidiNotes.ts`** (policy decision), then **`webMidi/messageHandlers.ts`** (facade / ports).

---

## Resolved

- **Issue 1 (partial):** `setDeviceParameter`, `duplicateClip`, `moveClipPreview`, `splitClipWithUndo`, `setTrackGainPan`, `startPlayback`, `exportMidiClip`, `toasterSubscriber`, `midiLearn` (`handleMidiMessage`), `toggleRecording`, `glutenParamBridge`, `crustParamBridge` — collaborators moved into `inject({ ... })` maps; specs updated where applicable (`startPlayback`, `exportMidiClip`, `toggleRecording`, `toasterSubscriber`).
- **Issue 2 (partial):** `midiRouting.ts` — `setMidiOutput` / `clearMidiOutput` wrapped with `inject({ updateTrack })`.
- **Issue 2 (more):** `getAutomationValueAtBeat` — `inject({ interpolateAutomationValue })`. `snapToGrid` / `getGridSnap` — `inject({ gridSnapBeats })`. `pasteNotes` — `inject({ createMidiNote })`. `editActionHandlers` — `inject({ updateWorkspaceState })` for both exports.
- **Issue 2 (more):** `trackAlternativeHandlers` — all four handlers use `inject({ getTrackStoreState, setTrackStoreState })`; `trackAlternativeHandlers.spec.ts` added. `scratchPadHandlers` — `executeToggleScratchPad` / capture / commit / clear use `inject` (capture/commit/clear inject scratch-pad use cases). `trackViewActions` — thin wrappers replaced with direct re-exports of underlying use cases (no fake orchestration layer).
- **Issue 3:** `AudioEngine/repositories/webMidi/messageHandlers.ts` — **not** refactored in this pass (large; needs a dedicated session).
- **Issue 4:** Transport schedulers — **not** refactored in this pass.
