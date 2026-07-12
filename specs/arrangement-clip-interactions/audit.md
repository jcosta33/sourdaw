---
type: audit
id: AUDIT-arrangement-clip-interactions
title: Multi-track selection in the arrangement
status: open
owner: The Sourdaw team
sources:
  - src/modules/Arrangement/stores/trackStore.ts
  - src/modules/Arrangement/
  - src/modules/Workspace/presentations/
---

# Audit: Multi-track selection in the arrangement

Present state of how the arrangement represents and consumes track selection,
and the blast radius a move to multi-track selection would touch. Recorded to
inform the arrangement clip-interactions spec. Observation only — the
single-track model is described as it stands today, not as it should change.

## Scope

- In scope: the selection state in `trackStore`, the data model that carries it
  to rendering, and the views, use cases, and handlers that read it across
  `src/modules/Arrangement/` and `src/modules/Workspace/`.
- Out of scope: clip-level (as opposed to track-level) selection, and the design
  of any replacement selection model — that belongs in the spec.

## Observations

- Track selection is a single scalar: `selectedTrackId: string | null`,
  defaulting to `null` — evidence: `src/modules/Arrangement/stores/trackStore.ts:25`
  (default at line 32, re-verified 2026-06-12).
- No array/set selection state exists anywhere: no `selectedTrackIds` is defined
  in the codebase — evidence: `rg selectedTrackIds` returns nothing
  (re-verified 2026-06-12).
- `selectedTrackId` is referenced broadly — ~130 files read it — so it is a
  widely-consumed surface, not a local field — evidence: `rg selectedTrackId`
  across `src/` (~130 files, re-verified 2026-06-12).
- The selection value flows into the render path via the timeline render model —
  evidence: `src/modules/Arrangement/models/TimelineRenderModel.ts`.
- The value is serialized/hydrated with project data — evidence:
  `src/modules/Arrangement/models/ProjectData.ts` and related save/load paths.
- Multiple panels read `selectedTrackId` to display the "active" track's
  properties — evidence: `TrackListView.tsx` (active style + ArrowUp/ArrowDown
  navigation), `InspectorPanel.tsx`, `Sidebar.tsx`, `AutomationBottomPanel.tsx`,
  `PluginBrowser.tsx`, `ElasticEditorPanel.tsx`.
- Selection mutation goes through a dedicated use case keyed on a single id —
  evidence: `src/modules/Arrangement/useCases/.../selectTrack.ts`.
- Track-targeted commands read the single id: AI generation handlers target
  `selectedTrackId` (e.g. `handleGenerateMidiPrompt.ts`), and the
  Delete/Backspace shortcut triggers `removeTrack(selectedTrackId)` as a
  single-track operation — evidence: those handlers and the keyboard-shortcut
  wiring.
- Track recording is keyed on the `armed` flag, not on `selectedTrackId`, so the
  recording path is already independent of selection — evidence: the
  `toggleRecording` armed-track loop (cross-referenced in
  `../grinder-stabilization-phase-1/` family work and the deadcode/overview
  inventories).

## Risks

- Panels that show one track's properties (Inspector, PluginBrowser,
  ElasticEditor) assume a single primary target — fires when: a selection model
  exposes more than one selected track and these panels have no rule for which
  track's properties to display.
- The scalar is read in ~130 files — fires when: the selection shape changes and
  any reader that is not updated keeps reading a now-absent or differently-typed
  field, surfacing as a type or runtime break.
- Selection is persisted in project data — fires when: the stored shape changes
  and older saved projects are loaded against a reader expecting the new shape.

## Open questions / unverified areas

- The ~130-file and "active track" reads were grepped but not each traced to
  confirm whether they genuinely require a single primary target or merely happen
  to read the scalar — why not: not exhaustively traced this pass.
- Whether any consumer relies on `selectedTrackId` being `null` to represent "no
  selection" in a way a collection model would have to preserve.
- Whether clip-level interactions in this feature area depend on track selection
  at all, or are independently keyed — not inspected this pass.

## Candidate requirements

<!-- Prose only; AC numbering and Verify-with lines belong to the spec. -->

- A spec should establish a single selection model capable of representing more
  than one selected track, and define how a "primary" target is derived for
  panels that inherently operate on one track (Inspector, PluginBrowser,
  ElasticEditor).
- A spec should cover the selection-mutation surface: how additive (Cmd/Ctrl),
  range (Shift), and replace selection behave, and how the selection-changed
  signal is broadcast to consumers.
- A spec should require track-targeted commands (delete, and the AI generation
  handlers) to operate across the full selection rather than a single id, and
  state the expected behavior of Delete/Backspace as a bulk operation.
- A spec should address persistence and load of the selection shape so existing
  saved projects remain loadable.
