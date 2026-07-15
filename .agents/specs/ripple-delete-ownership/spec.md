---
type: spec
id: SPEC-ripple-delete-ownership
title: Ripple-delete ownership
status: done
owner: The Sourdaw team
sources:
  - self
---

# Ripple-delete ownership

## Intent

Place ripple-delete planning and clip/track mutation in Arrangement, which owns track and
clip truth, while Workspace holds only the ripple-editing UI toggle — so deleting clips
ripples correctly without a cross-module initialization cycle.

## Non-goals

- Redesigning the ripple-editing UI or the workspace preference.
- Broader dependency-injection changes such as lazy resolution primitives.
- Unrelated cleanup in Arrangement or Workspace.

## Requirements

### AC-001 — Arrangement owns the ripple-delete write path

Arrangement must own planning, applying the clip shift, and undoing a ripple delete.

Verify with: `pnpm test:run -- rippleDelete`

### AC-002 — Workspace owns only the ripple toggle

Workspace must own only the ripple-editing UI state and the action that toggles it.

Verify with: `pnpm test:run -- rippleEditing`

### AC-009 — Transport-bar toggle enables and disables ripple delete

Toggling ripple editing in the transport bar must enable and disable ripple delete behavior end-to-end (the toggle action flips Workspace state and that state gates whether a delete ripples).

Verify with: `pnpm test:run -- rippleEditing`

### AC-003 — Arrangement reads the flag as cross-module input

Arrangement ripple-delete use cases must read the ripple flag through `getWorkspaceState`
rather than owning it.

Verify with: `pnpm test:run -- rippleDelete`

### AC-004 — No module-initialization cycle

Importing Workspace through an Arrangement consumer must resolve without the prior
`Cannot access 'getTrackStoreState' before initialization` error.

Verify with: `pnpm test:run -- rippleEditing`

### AC-005 — Ripple delete behaves correctly

Deleting clips must shift later clips to close the gap.

Verify with: `pnpm test:run -- rippleDelete`

### AC-006 — No cross-module internal imports

This feature must keep cross-module imports on module-root barrels with intra-module imports
relative.

Verify with: `pnpm deps:validate`

### AC-007 — Ripple undo restores positions

Undoing a ripple delete must restore the shifted clips to their original positions.

Verify with: `pnpm test:run -- rippleDelete`

### AC-008 — Ripple delete keeps MIDI notes in correspondence

Deleting clips via ripple must delete the MIDI notes of each removed clip and shift left, by the
removed clip's duration, the MIDI notes of every clip on the same track that starts after the
removed clip's end — so notes stay aligned with the clips that close the gap.

Verify with: `pnpm test:run -- rippleDeleteClips`

### AC-010 — No Arrangement dependency on Workspace ripple-delete use cases

No Arrangement handler or use case must depend on Workspace ripple-delete use cases; the
write path lives in Arrangement and Workspace must not export ripple-delete planning, applying,
or undoing.

Verify with: `pnpm deps:validate`

### AC-011 — RippleDeletePlan stays local to Arrangement

`RippleDeletePlan` must remain local to Arrangement after the move and must not be exported
from Workspace.

Verify with: `pnpm deps:validate`

## Open questions

- [ ] (deferred-gap from intake/audit-deferred-fixes.md) **Group A — Timeline / MIDI editing
  (ripple, shift/split/scale use cases).** Non-blocking. The audit's Group A is a broader
  Timeline/MIDI editing scope than this spec's ripple-delete-ownership cut; ripple-delete is one
  member of it (folded as AC-008 above). The remaining Group A behaviors are captured here so the
  detail is not lost; they belong to the consolidated-audit backlog, not to this ownership move.
  The design decision behind them is to keep MIDI stored on `midiStore` keyed by clip id with
  absolute `startBeat` (no migration to relative positioning), and to have every clip-time
  operation call an explicit MIDI use case rather than re-emit a generic `clip.timeChanged` event.
  The full set:
    - **A1 — `deleteTimeRange` partitions MIDI notes (Timeline §1 completion).** For every clip
      touched by `deleteTimeRange(startBeat, endBeat, trackIds)`: notes fully outside
      `[startBeat, endBeat]` unchanged; notes fully inside deleted; notes straddling the start
      truncated to end at `startBeat`; notes straddling the end split — the inside portion deleted,
      the after portion kept and shifted left by `(endBeat - startBeat)`; notes after the range
      shifted left by `(endBeat - startBeat)`. Same partition for CC and pitch-bend point events
      (events at exactly `startBeat` kept; events in `(startBeat, endBeat]` deleted; events after
      `endBeat` shifted left). Introduces `deleteMidiNotesInRange({ trackIds, startBeat, endBeat })`
      in `src/modules/MIDI/useCases/midiNoteCrud/`, called before
      `shiftMidiNotesAfterBeat({ atBeat: endBeat, delta: -(endBeat - startBeat) })`.
    - **A3 — `ClipRenderModel` carries preview transforms.** Add three optional fields (default
      `undefined` = no preview): `visualShiftBeats?: number` (move-drag translation),
      `visualStretchRatio?: number` (stretch/trim multiplicative scale), `visualOriginBeat?: number`
      (stretch anchor, defaults to clip `startBeat`). `buildTimelineRenderModel` populates them from
      active drag-preview state; `clipDrawing.ts` consumes them in `drawWaveformPeaks` and
      `drawMidiNotePreview`; audio-waveform window selection respects `visualStretchRatio`.
    - **A4 — MIDI drag preview moves with the clip (Timeline §4).** `drawMidiNotePreview` adds
      `clip.visualShiftBeats ?? 0` to each note's start before mapping to x, so dragging a MIDI clip
      horizontally shows its notes following the rectangle within the same frame.
    - **A5 — MIDI looping renders as repeats not stretches (Timeline §7).** `drawMidiNotePreview`
      computes x as `(relStartBeat * pixelsPerBeat) % loopWidth` then offsets to the clip's left
      edge; when the clip is longer than `loopLength`, notes wrap and repeat (notes crossing a loop
      boundary split into two draw calls) rather than stretching.
    - **A6 — Stretch/trim preview updates renderers in real time (Timeline §8).** During a
      stretch/trim drag the preview sets `visualStretchRatio` on affected clips; `drawWaveformPeaks`
      recomputes the sample window from the previewed ratio (no audio-buffer change);
      `drawMidiNotePreview` scales note x and width by the previewed ratio anchored on
      `visualOriginBeat`; release commits the ratio via the existing handler chain. (Open sub-point,
      MINOR: when a stretch preview overlaps the snap grid, default is preview-free / snap-on-commit;
      confirm with the original drag implementer.)
    - **A7 — MIDI stretching commits to data (Timeline §6).** Add
      `scaleClipMidiNotes({ clipId, anchorBeat, ratio })` in
      `src/modules/MIDI/useCases/midiNoteCrud/`: per note,
      `startBeat = anchorBeat + (startBeat - anchorBeat) * ratio` and `duration = duration * ratio`;
      CC and pitch-bend `beat` scaled by the same anchor+ratio. The audio `stretchRatio` and the
      MIDI ratio are independent clip properties — committing a MIDI stretch must not touch the
      audio stretch. `handleSetClipStretchRatio` (and any other stretch handler) calls it for MIDI
      clips; anchor defaults to `clip.startBeat`.
    - **A8 — Each timeline use case has a Vitest spec.** `deleteTimeRange`, `rippleDeleteClips`,
      `scaleClipMidiNotes`, `deleteMidiNotesInRange` each get a `__tests__/<name>.spec.ts` covering:
      notes fully inside, notes straddling each edge, notes fully outside, CC + pitch-bend events.

## Affected areas

- `src/modules/Arrangement/useCases/rippleDelete/planRippleDelete.ts`
- `src/modules/Arrangement/useCases/rippleDelete/rippleDeleteClips.ts`
- `src/modules/Arrangement/useCases/rippleDelete/undoRippleDelete.ts`
- `src/modules/Arrangement/handlers/`
- `src/modules/Workspace/useCases/rippleEditing.ts`

## Dropped from sources

- Keeping ripple-delete logic in Workspace with lazy DI to hide the cycle — preserves the ownership leak rather than fixing it.
- Passing `rippleEnabled` through every caller — the flag already has a stable read surface in Workspace; only write ownership needed to move.
- New barrel files or compatibility shims — disallowed; ownership moves cleanly to Arrangement.
