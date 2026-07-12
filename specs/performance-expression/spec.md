---
type: spec
id: SPEC-performance-expression
title: Unified performance expression model and editor
status: draft
owner: The Sourdaw team
sources:
  - intake/differentiators.md
  - intake/full-spec.md
  - intake/future-spec.md
---

# Unified performance expression model and editor

## Intent

Edit expressive performance semantically rather than as disconnected MIDI notes,
CC lanes, and pitch-bend curves. A higher-level internal model carries named
expressive axes (timing feel, dynamic contour, accent, vibrato, pitch drift,
onset/sustain/release character, timbral bias, phrase energy, note role) computed
from existing note data, and a Performance Editor surfaces them across three
synchronized views with a phrase concept between clip and note.

## Non-goals

- Cross-target downgrade mapping and the portability report (see `expression-portability`).
- Instrument capability discovery / adopt-semantics (see `instrument-semantics`).
- Articulation maps and keyswitch management (see `articulation-maps`).
- A full MIDI 2.0/UMP migration — only resolution-independent internal storage is in scope.

## Requirements

### AC-001 — Expression survives copy and paste

When notes carrying pressure, slide, and pitch-bend are copied and pasted (clip or
note clipboard), the pasted notes must retain every expression field.

Verify with: `pnpm test:run -- pasteNotes pasteClip`

### AC-002 — Expression-aware copy modes

The clipboard must offer copy/paste of notes-only, expression-only, and
notes-plus-expression, where expression-only transfers pressure/slide/pitch-bend/
velocity onto matching target notes.

Verify with: `pnpm test:run -- pasteExpressionOnly pasteNotesWithoutExpression`

### AC-003 — Three synchronized piano-roll views

The piano roll must offer Note, Phrase, and Lane view modes that share selection,
beat width, and horizontal scroll; Lane view stacks all expression lanes at once.

Verify with: `pnpm test:run -- PianoRollToolbar`

### AC-004 — Phrase is a first-class clip-scoped object

A phrase must reference its member note ids (not copies); deleting a note removes it
from any phrase, and deleting a phrase never deletes its notes.

Verify with: `pnpm test:run -- phraseModel`

### AC-005 — Transfer feel between phrases

When the user applies one phrase's feel to another, the target's microtiming and
velocity profile must take on the source's groove, extending existing groove extraction.

Verify with: `pnpm test:run -- extractGrooveFromPhrase`

### AC-006 — Performance overlays visualize feel

The piano roll must offer toggleable overlays for timing heat and dynamic contour
computed from existing note fields.

Verify with: `manual` — enable timing-heat overlay and confirm off-grid notes are tinted

### AC-007 — Internal expression stored resolution-independently

Expression dimensions must be represented internally as floating-point (0.0–1.0)
at the editing layer so a later move to higher output resolution is a boundary
conversion, not a UI rewrite.

Verify with: `pnpm test:run -- expressionResolution`

### AC-008 — Per-note expression lanes in the piano roll

Lane view must expose per-note timbre, pressure, and pitch expression lanes in
the piano roll (not channel-wide only), so a single note's pressure, slide
(timbre), and pitch-bend can be edited independently of its neighbours.

Verify with: `pnpm test:run -- PressureLane SlideLane PitchBendLane`

## Open questions

- [ ] (non-blocking) Do phrases live in `midiStore` alongside notes or in a sibling
  `phraseStore`? Default: alongside notes, keyed by clip id.
- [ ] (non-blocking) Is "note role in texture" auto-computed or user-assigned at v1?
  Default: user-assigned, optional.
- [ ] (non-blocking) (deferred-gap from intake/full-spec.md, item "0. Expression data
  loss on paste") Paste root cause to verify against when implementing AC-001/AC-002:
  `pasteNotes.ts` (around lines 24–25) and `pasteClip.ts` (around lines 50–51) in
  `src/modules/Arrangement/useCases/clipboard/` route copied notes through
  `createMidiNote()`, which accepts only 5 args (pitch, startBeat, duration, velocity)
  and therefore strips `pressure`, `slide`, and `pitchBend`. The clipboard itself
  preserves all fields (spread in `copySelectedNotes.ts`); only paste discards them.
  The fix is to spread the source note (`{ ...n, id, startBeat }`) instead of calling
  `createMidiNote`. Regression assertions belong in the existing `pasteNotes.spec.ts`
  and `pasteClip.spec.ts`. This is a standalone data-loss bug to fix before other
  feature work; AC-001/AC-002 already encode the requirement.
- [ ] (non-blocking) (deferred-gap from intake/future-spec.md, item "Cross-feature: 1.
  canonical internal representation") The internal model must preserve a richer
  semantic model than any external transport format, with a fixed priority order when
  data must be reconciled: (1) project semantics, (2) performance semantics, (3)
  provenance, (4) constraints, (5) decisions, (6) branch lineage, (7) external
  transport projection. Governing principle: never let export formats become the
  source of truth — export is always a downward projection from the internal model,
  not the canonical store. AC-007 covers float resolution-independence; this captures
  the broader source-of-truth ordering, which spans beyond this feature.
- [ ] (non-blocking) (deferred-gap from intake/full-spec.md, item "11. MIDI 2.0 / UMP
  native architecture") Explicit decision: do NOT attempt a full MIDI 2.0 migration
  now — the ecosystem is not ready (the `midir` crate used in
  `src-tauri/src/commands/midi.rs` lacks MIDI 2.0; no Rust crate provides UMP parsing
  as of 2026-04). Phase 1 (in scope here, AC-007): keep 7-bit at the storage layer but
  use floating-point (0.0–1.0) at the editing/UI layer for `velocity`, `pressure`,
  `slide`, `pitchBend`, converting to 7-bit/14-bit at output boundaries, so the later
  transition is a storage change not a UI rewrite. Phase 2 (deferred, when ecosystem
  ready): define a `UmpNote` type with 32-bit fields (velocity/pressure/pitch-bend at
  ~4.3 billion steps vs 128), per-note controllers without MPE channel hacking,
  Property Exchange for automatic hardware detection, bidirectional `MidiNote`↔`UmpNote`
  translation, and backward-compatible degradation to MIDI 1.0 for legacy
  plugins/hardware. GrandBoule's `crates/daw-dsp/src/grand_boule/midi2.rs` is
  instrument-specific MIDI 2.0 handling, not a universal transport.
- [ ] (non-blocking) (deferred-gap from intake/implementation-gaps.md, item "5.5 Deep
  MPE Editing & Hardware Scripting") Hardware-scripting half is out of this feature's
  scope: expand the scripting API to support auto-mapped hardware controller profiles
  for grid/expressive controllers (e.g., Ableton Push, Novation Launchpad) with
  community sharing of those profiles. The per-note expression-lanes half of this item
  (timbre/pressure/pitch lanes in the piano roll) is in scope and captured by AC-008.

## Affected areas

- `src/modules/MIDI/` (Phrase model, groove extraction, expression services)
- `src/modules/Arrangement/useCases/clipboard/`
- `src/modules/Workspace/presentations/views/ClipView/` (piano roll, lanes, toolbar)

## Dropped from sources

- "Extract Performance DNA from audio" with a reconstruction confidence score —
  deferred; audio-derived expression depends on `ml-onset-detection` and pitch analysis.
- The future-spec "Performance DNA Editor" as a separate top-level panel — folded into
  the existing piano-roll view modes to avoid another side panel.
