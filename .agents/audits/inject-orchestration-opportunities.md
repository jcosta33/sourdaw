# `inject()` orchestration — remaining opportunities audit

## Scope

**In scope:** `src/modules/**/useCases/**/*.ts` and `src/modules/**/repositories/**/*.ts` where code **orchestrates** other modules by importing and calling their **use cases** (or `executeAppAction`), and whether those collaborators are declared on **`inject({ ... })`** maps for **`injectDependencies()`** testing.

**Out of scope:** `presentations/`, `*.spec.ts`, pure data/transformers, and **type-only** imports from use-case modules (e.g. `import { type X } from '.../useCases/...'`).

**Related docs:** `docs/01-dependency-injection.md`, `docs/architecture/03-typescript-module.md` §4.10, `docs/06-testing.md` §5.

---

## Goal

**Target state:** Orchestration surfaces (especially **`Record<string, ActionHandler>`** handler registries and multi-step flows) expose collaborators through **`inject(deps)(factory)`** so tests can substitute behavior without **`vi.mock`** on whole modules. Single-purpose use cases already follow this pattern in many modules.

---

## Relevant code paths

- `src/infra/di/inject.ts`, `src/infra/di/testing/injectDependencies.ts`
- `src/modules/**/useCases/**/*Handlers.ts` — command / feature handler maps; **`timelineViewActions.ts`** — presentation delegate passthroughs
- `src/modules/Command/useCases/executeAppAction.ts` — central dispatcher (`inject({ logger })`)
- `src/modules/Transport/useCases/scheduling/*.ts` — playhead schedulers
- `src/modules/AudioEngine/repositories/webMidi/messageHandlers.ts` — live MIDI adapter

---

## Current behavior

### A. Handler registries — already migrated to `inject()` (baseline)

These **`*Handlers.ts`** files use **named `execute*`** functions with **`inject({ ... })`** and wire `analysisHandlers` / `trackHandlers` / `clipHandlers` / `workspaceHandlers` / `scratchPadHandlers` / `songStructureHandlers` / `versionControlHandlers` / `trackAlternativeHandlers` / **`transportHandlers`** / **`automationHandlers`** / **`deviceHandlers`** / **`presetHandlers`** / **`restoreHandlers`** / **`stretchHandlers`** / **`batchFeatureHandlers`** / **`undoTreeHandlers`** / **`newFeatureHandlers`** / **`finalFeatureHandlers`** / **`pluginHostHandlers`** / **`collaborationHandlers`** / **`generationHandlers`** / **`aiMidiHandlers`** / **`macroHandlers`** / **`chordTrackHandlers`** / **`patternInstanceHandlers`** / **`aiOrganizationHandlers`** patterns.

### B. Handler registries — **no `inject()`** (grep: `inject(` absent)

*No remaining entries — the former §B `*Handlers.ts` list for this audit is fully migrated.*

**Special cases**

- **`Command/useCases/editActionHandlers.ts`** — Uses **`inject()`** on **individual** exports (`selectAllClips`, `deselectAllClips`), not a `Record` of handlers. Compliant; different shape.
- **`Workspace/presentations/hooks/useAppEventHandlers.ts`** — Presentation hook; out of scope for use-case `inject` audit.

### C. Non-registry orchestrators (call `executeAppAction` or many use cases)

| File | Approx. lines | `inject`? |
|------|---------------|-----------|
| `Collaboration/useCases/collaboration/sessionManagement.ts` | ~775 | No — large Crdt + engine + asset orchestration |
| `AiRuntime/useCases/dsoEditor/compileDso.ts` | ~993 | No — many `executeAppAction` branches |
| `AiRuntime/useCases/aiHistoryActions.ts` | ~35 | **Done** — `inject({ executeAppAction, undoStore, markGroupReverted })`; see **Resolved (this audit)** |
| `AiRuntime/useCases/sendChatMessage.ts` | (large) | **Done** — `inject({ ... })` over orchestration deps; `sendChatMessage.spec.ts`; see **Resolved** |
| `CrdtDocument/useCases/revertAction.ts` | (small) | **Done** — `inject({ executeAppAction, actionHistoryStore, markEntryReverted })`; see **Resolved (this audit)** |
| `Command/useCases/undoRedo.ts` | (small) | **Done** — `undo` / `redo` use `inject({ undoStore, executeAppAction })`; `undoToIndex` delegates to them; see **Resolved** |

**Thin delegates (intentional boundaries, lower priority)**

- `AiRuntime/useCases/aiPanelActions.ts` — **`inject({ executeAppAction })`**, **`inject({ undo })`**, **`inject({ toggleChatPanel })`**; `aiPanelActions.spec.ts`.
- `Arrangement/useCases/timelineViewActions.ts` — Per-export **`inject({ …Impl })`** passthroughs for timeline presentation (clip, clipboard, automation, transport, etc.); `timelineViewActions.spec.ts`.
- `Arrangement/useCases/trackViewActions.ts` — **`setWorkspaceMode`**, **`getAudioDevices`**, **`decodeAudioFile`** (replaces pure re-exports); `trackViewActions.spec.ts`.

### D. Repository layer → use case imports

| File | Nature |
|------|--------|
| `AudioEngine/repositories/webMidi/messageHandlers.ts` | Many use-case imports; live MIDI adapter (high churn) |
| `AudioEngine/repositories/faustDeviceFactory.ts` | **`createFaustDevice`** uses `inject({ logger, compileFaustDSP, createFaustNode })` — aligned |
| `Arrangement/repositories/presets/factoryPresets.ts` | Imports **`FERMENTER_PRESETS`** from Fermenter **queries** as **data**, not orchestration |
| `AudioEngine/repositories/offlineScheduler/automationScheduling.ts` | **Type-only** `TempoChange` from `transportQueries` |

### E. Transport schedulers (documented hot path)

- `Transport/useCases/scheduling/scheduleMidiNotes.ts` — Static imports; module comment points to DI docs
- `Transport/useCases/scheduling/scheduleAudioClips.ts` — Same

### F. Demo / script builders

- `Project/useCases/demoProjects/**` — Scripted project construction; typically exempt from strict `inject()` unless a spec requires overrides.

---

## Findings

1. **Two handler patterns coexist:** (a) **`inject` + `execute*`** per action — testable via `injectDependencies`; (b) **inline `execute: (a) => { ... }`** — collaborators hidden unless `vi.mock`’d.
2. **`transportHandlers.ts`** — migrated to pattern (a); **`transportHandlers.spec.ts`** smoke-tests `injectDependencies`.
3. **Handler registry migration (§B)** — completed for all files that were listed in this audit’s §B table; new handler maps should follow **`inject` + `execute*`** from the start.
4. **`sessionManagement.ts` and `compileDso.ts`** are **orchestration monoliths** — `inject()` would require either a very large dep map or a **facade** type (`SessionPorts`, `DsoCommandPorts`) injected once; different trade-off than thin handler maps.
5. **`aiHistoryActions.revertAiActionGroup`** — migrated to `inject`; **`aiHistoryActions.spec.ts`** added.
6. **Repository `messageHandlers`** remains the strongest **architectural** inversion (repo → many use cases); a **ports** object at engine construction is the scalable fix.

---

## Priorities

1. **New `*Handlers.ts` files** — Use **`inject` + `execute*`** + `injectDependencies` smoke tests from creation; §B table in this audit is empty until a gap is found.
2. **`sessionManagement.ts` / `compileDso.ts`** — Needs **design** (facade vs incremental `inject`) before bulk edits.
3. **`messageHandlers` ports** — Structural; schedule after handler migration stabilizes patterns.

---

## Open issues

### 1. Handler registries without `inject()` (§B table)

**Status:** The §B table is **empty** — prior entries are migrated; see **Resolved (this audit)**.

**If a new handler map regresses:** introduce `export const executeFoo = inject({ ... })(...)`, assign `execute: executeFoo`, and add `injectDependencies` smoke tests.

---

### 2. Large orchestrators (`sessionManagement.ts`, `compileDso.ts`)

**Problem:** Hundreds of lines of cross-module calls without a single injection boundary.

**Representative files:** `Collaboration/useCases/collaboration/sessionManagement.ts`, `AiRuntime/useCases/dsoEditor/compileDso.ts`.

**Needed:** Architecture decision: **facade interface** injected at module init / use-case factory vs. **incremental** `inject()` on outer entry points only; document in a short spec or task before editing.

---

### 3. Web MIDI `messageHandlers` (repository)

**Problem:** Repository imports many application use cases.

**Representative file:** `AudioEngine/repositories/webMidi/messageHandlers.ts`.

**Needed:** Define **`MidiMessagePorts`** (or similar), implement default with current imports, inject where the Web MIDI stack is constructed.

---

### 4. Transport schedulers (policy)

**Problem:** `scheduleMidiNotes` / `scheduleAudioClips` intentionally avoid `inject()` for RT/playhead cost.

**Representative files:** `Transport/useCases/scheduling/scheduleMidiNotes.ts`, `scheduleAudioClips.ts`.

**Needed:** None for strict `inject` parity; optional **facade** only if integration tests require finer mocks. Policy already referenced in module comments + DI docs.

---

## Open questions

- [x] **`aiPanelActions.ts`** — Wrapped in **`inject()`** per export (`runAppAction`, `undoLastAction`, `toggleChat`); see **Resolved (this audit)**.
- [ ] For **`compileDso.ts`**, is a full inject map realistic or should DSO sub-operations move behind smaller use-case files first?

---

## Risks

- **Test brittleness:** Handler registries without `inject` encourage module-level `vi.mock`, which breaks when imports move.
- **Circular imports:** Wiring `executeAppAction` into `inject` for handlers that `executeAppAction` already dispatches must follow existing patterns (e.g. `analysisHandlers` / `autoFixMix`).
- **Scope creep:** `sessionManagement` / `compileDso` refactors can balloon; use explicit facades or phased tasks.

---

## Suggested approaches

- Migrate **one handler file per PR/session**; run `pnpm typecheck` and targeted tests after each.
- Copy the **`trackHandlers` / `workspaceHandlers`** shape: `ExtractAction` types, one `execute*` per action, `satisfies ActionHandler<...>` unchanged.
- For **repositories**, prefer **ports** over growing static import lists in `messageHandlers`.

---

## Resolved (prior baseline — not part of this audit’s open work)

The following were already addressed in the **earlier inject migration** (handler maps and use cases such as `analyzeMix`, `loadRecentProject`, `createFaustDevice`, `trackHandlers`, `clipHandlers`, `workspaceHandlers`, etc.).

## Resolved (this audit — migration sessions)

- **`Transport/useCases/transportHandlers.ts`** — All transport command actions use `execute*` + `inject`; `transportHandlers.spec.ts` (smoke tests).
- **`AiRuntime/useCases/aiHistoryActions.ts`** — `revertAiActionGroup` = `inject({ executeAppAction, undoStore, markGroupReverted })`; `aiHistoryActions.spec.ts`.
- **`Automation/useCases/automationHandlers.ts`** — Six automation actions (`scale` / `stretch` / `invert` / `reverse` / `thin` / `quantize`); `automationHandlers.spec.ts`.
- **`Arrangement/useCases/deviceHandlers.ts`** — Device / send / MPE / latency / sidechain handlers; `deviceHandlers.spec.ts`.
- **`Arrangement/useCases/presetHandlers.ts`** — `loadPreset` / `savePreset`; `presetHandlers.spec.ts`.
- **`Arrangement/useCases/restoreHandlers.ts`** — `restoreTrack` / `restoreClip` (inverse actions); `restoreHandlers.spec.ts`.
- **`Arrangement/useCases/stretchHandlers.ts`** — Stretch mode / ratio / fit-to-beats; `stretchHandlers.spec.ts`.
- **`Arrangement/useCases/batchFeatureHandlers.ts`** — Search samples, comp group, punch/loop record, scenes, setlist, tempo detect, adjustment layer; `batchFeatureHandlers.spec.ts`.
- **`Command/useCases/undoTreeHandlers.ts`** — Toggle undo tree / label branch; `undoTreeHandlers.spec.ts`.
- **`Arrangement/useCases/newFeatureHandlers.ts`** — Fills, transitions, reference mix, control room, mentor tips; `newFeatureHandlers.spec.ts`.
- **`AudioEngine/useCases/finalFeatureHandlers.ts`** — Transients stub, node view, control surface, CV/Push, RAVE, warping; `finalFeatureHandlers.spec.ts`.
- **`Plugin/useCases/pluginHostHandlers.ts`** — Scan / load external plugin; `pluginHostHandlers.spec.ts`.
- **`Collaboration/useCases/collaborationHandlers.ts`** — Create / join / leave session; `collaborationHandlers.spec.ts`.
- **`AiGeneration/useCases/generationHandlers.ts`** — Drum / melody / chords / groove; `generationHandlers.spec.ts`.
- **`AiGeneration/useCases/aiMidiHandlers.ts`** — AI MIDI, analysis, generate audio, stem separation; `aiMidiHandlers.spec.ts`.
- **`Command/useCases/macroHandlers.ts`** — Macro record / play / delete; `macroHandlers.spec.ts`.
- **`MIDI/useCases/chordTrackHandlers.ts`** — Chord track CRUD; `chordTrackHandlers.spec.ts`.
- **`MIDI/useCases/patternInstanceHandlers.ts`** — Pattern instance create / detach; `patternInstanceHandlers.spec.ts`.
- **`AiRuntime/useCases/aiOrganizationHandlers.ts`** — Auto-organize project; `aiOrganizationHandlers.spec.ts`.
- **`AiRuntime/useCases/aiPanelActions.ts`** — Thin delegates `runAppAction` / `undoLastAction` / `toggleChat`; `aiPanelActions.spec.ts`.
- **`CrdtDocument/useCases/revertAction.ts`** — `revertAction`; `revertAction.spec.ts`.
- **`Command/useCases/undoRedo.ts`** — `undo` / `redo`; `undoRedo.spec.ts`.
- **`AiRuntime/useCases/sendChatMessage.ts`** — Full orchestration map (chat store, backends, `executeAppAction`, etc.); `sendChatMessage.spec.ts`.
- **`Arrangement/useCases/timelineViewActions.ts`** — Timeline presentation delegate surface; `timelineViewActions.spec.ts`.
- **`Arrangement/useCases/trackViewActions.ts`** — Track sidebar / input / decode delegates; `trackViewActions.spec.ts`.

---

## Verification commands (when working issues)

- `pnpm typecheck`
- `pnpm test:run`
- After cross-module import churn: `pnpm deps:validate` (per `AGENTS.md`)
