---
type: spec
id: SPEC-workflow-ui
title: MIDI editor professional interactions
status: in-progress
owner: The Sourdaw team
sources:
  - research.md
---

# MIDI editor professional interactions

## Intent

Add the muscle-memory piano-roll interactions every professional DAW ships, on top of Sourdaw's
existing note CRUD and 6-tool editing system: Alt-drag duplicate, duplicate-forward, hold-to-swap
tools, legato, split, join, velocity ramp/paint, multi-clip editing, slip editing, in-place
arrangement editing, constrain-to-scale, and hover audition. Each interaction integrates with the
existing undo system and introduces no shortcut conflicts.

## Non-goals

- Arrangement clip interactions (`../arrangement-clip-interactions/spec.md`).
- Per-note MPE expression depth (`../mpe-expression-editing/spec.md`).
- Visual styling (deferred to the design system) and DSP internals.
- Basic note CRUD, paint/lasso/step-input, arpeggiator, transforms — these already work.

## Requirements

### AC-001 — Alt-drag duplicates selected notes

Alt/Option-dragging selected notes must leave the originals in place, create grid-snapped copies
at the drop position as the new selection, in a single undo entry; Alt-drag on empty space stays
rubber-band.

Verify with: `manual` — Alt-drag a 3-note selection and confirm originals remain, copies land snapped, and one undo removes them

### AC-002 — Ctrl/Cmd+D duplicates the selection forward

Ctrl/Cmd+D must place copies immediately after the selection's time span (stacking on repeat),
falling back to the whole clip content when nothing is selected.

Verify with: `pnpm test:run -- MIDI duplicateForward`

### AC-003 — Holding a tool key temporarily swaps the tool

Holding a tool shortcut (S/C/D/T/E) beyond 300 ms must temporarily activate that tool and revert
on release.

Verify with: `manual` — hold D for ~500 ms to draw then release to revert; tap D quickly to switch permanently

### AC-004 — Legato extends notes to the next note

The legato command (L) must extend or contract each selected note so its end meets the next note
on the same pitch (fallback: the next note on any pitch in the clip, including unselected notes).

Verify with: `pnpm test:run -- MIDI legatoNotes`

### AC-005 — Split at cursor divides notes at the playhead

Shift+S must split each selected note spanning the playhead into two notes that both retain the
original velocity and expression data.

Verify with: `pnpm test:run -- MIDI splitNoteAtBeat`

### AC-006 — Join merges adjacent same-pitch notes

J must merge adjacent selected notes on the same pitch into one note, leaving non-adjacent or
different-pitch notes unaffected.

Verify with: `pnpm test:run -- MIDI joinNotes`

### AC-007 — Shift-drag draws a velocity ramp

Shift-drag in the velocity lane must linearly interpolate velocities across the notes in the drag
range.

Verify with: `pnpm test:run -- MIDI velocityRamp`

### AC-008 — Drag-through paints continuous velocity

A continuous drag through the velocity lane must paint velocity onto every note under the cursor
path in one gesture.

Verify with: `manual` — drag freehand across several notes in the velocity lane and confirm each follows the path

### AC-009 — Multiple clips edit in one piano roll

Multiple MIDI clips must open together, color-coded by source, with a clip selector for new notes
and non-focused notes directly editable (distinct from read-only ghost notes).

Verify with: `manual` — open two clips, confirm color-coding and that edits route to the owning clip

### AC-010 — Slip editing shifts content non-destructively

Ctrl/Cmd+Shift-drag inside a clip must slide its content without moving boundaries, using
`audioOffsetBeats` for audio and a new non-destructive `midiOffsetBeats` for MIDI.

Verify with: `pnpm test:run -- MIDI slipClipContent`

### AC-011 — In-place editing renders notes in the arrangement

An inline piano roll must render notes inside arrangement clip regions with basic select/move/
draw/delete.

Verify with: `manual` — toggle inline editing, draw a note in the arrangement, then double-click to expand

### AC-012 — Constrain-to-scale snaps pitches to scale degrees

With a scale selected, a Constrain toggle must lock note input and movement to scale degrees while
the full keyboard stays visible.

Verify with: `manual` — enable Constrain and confirm drawn/moved notes snap to scale degrees with all rows visible

### AC-013 — Hover auditions a note after a delay

Hovering a note for 200 ms must audition it via `playAuditionNote`, toggleable in preferences.

Verify with: `manual` — hover a note ~300 ms and confirm audition; disable in preferences and confirm silence

### AC-014 — "Find similar sound" works on samples and presets

The "Find similar sound" action must be available on any sample **or preset**, returning results
ranked by embedding distance for whichever target it is invoked on (restores R-G2.4's original
sample-or-preset scope; the sample-only home narrowed it without note).

Verify with: `manual` — invoke "Find similar sound" on a preset and confirm ranked similar presets return, then repeat on a sample

### AC-015 — Browser ranking surfaces recently-used and last-used-chain intelligence

The sample browser must intelligently rank results by both "recently used" **and** "last-used
chain" signals (restores the second half of R-G4.5; the sample-only home kept recently-used and
deferred last-used-chain).

Verify with: `pnpm test:run -- SampleLibrary browserRanking`

### AC-016 — A quick tool-key tap switches the tool permanently

A press-and-release of a tool shortcut (S/C/D/T/E) under 300 ms must switch to that tool
permanently.

Verify with: `manual` — tap D quickly and confirm the tool stays selected as the draw tool after release

### AC-017 — Double-click expands inline editing to the full editor

Double-click on an inline piano roll must expand it to the full editor.

Verify with: `manual` — double-click an inline piano roll region and confirm the full editor opens

## Open questions

- [ ] (non-blocking) Is the 300 ms tool-swap threshold user-configurable? Proposed: hardcode initially.
- [ ] (non-blocking) Specify the stem-separation workflow after a compatible model passes admission: drag-and-split, automatic mixer-lane routing, and direct sampler ingestion. Stem separation is currently unavailable; this cross-cutting feature needs its own spec.
- [ ] (non-blocking) (restored detail — R-G4.4 "Smart collections") The source's §G4 bundled "Smart collections & auto-tagging: AI-driven categorization (kick, snare, dark, atmospheric, pad, lead, etc.) upon import." The auto-tagging half is preserved in the sample library (sample-library-intelligence AC-007), but the **smart-collections grouping control** — auto-formed sample groupings surfaced as a browser control, distinct from raw tags — was deferred to incremental follow-up with no current AC in any spec. This belongs to the sample-library domain (outside this spec's MIDI-editor focus) and should land as an AC there when picked up, not here.

## Affected areas

- `src/modules/Workspace/presentations/hooks/usePianoRollInteractions.ts`
- `src/modules/MIDI/useCases/midiNoteTransforms/` (`legatoNotes`, `splitNoteAtBeat`, `joinNotes`)
- `src/modules/Workspace/models/EditingTool.ts` (`TOOL_SHORTCUTS`)
- Clip model (`midiOffsetBeats`), velocity lane components

## Dropped from sources

- The cross-cutting phasing/release-gate scaffolding from the source — each split spec stands alone.
- Trust/confidence scoring for suggestions — research-only.

## Restored from sources

- **R-G2.4 (preset target)** — the source specified "Find similar sound" on any sample **or
  preset**; the sample-library-intelligence home (AC-003) silently narrowed it to samples only.
  The preset target is restored here as AC-014.
- **R-G4.5 (last-used chain)** — the source specified both "recently used" **and** "last-used
  chain" ranking; the sample-library-intelligence home kept recently-used and deferred last-used
  chain. The last-used-chain signal is restored here as AC-015.
- **`## Design decisions` (8 chosen-vs-rejected rationales)** — restored verbatim into
  `research.md` (the source's full rationale section was dropped in the split).
