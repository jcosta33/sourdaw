---
type: spec
id: SPEC-notation
title: Score notation view
status: draft
owner: The Sourdaw team
sources:
  - research.md
---

# Score notation view

## Intent

Render editable staff notation from a MIDI source of truth, quantizing only the display
layer so performance timing is never altered, with VexFlow rendering and validated
MusicXML 4.0 import/export.

## Non-goals

- Full scorewriter page layout (frames, systems, part extraction, custom system breaks,
  cross-staff beaming, cue-sized notes, ossia staves).
- Audio-to-notation transcription (notation is derived from MIDI, not audio).
- Engraving-grade publication-quality typesetting; manual beam/stem nudging in v1.
- Score-driven playback interpretation (dynamics/articulations are display-only in phase 1).
- SMuFL font bundling/customization beyond a single default font.
- Figured bass.
- Guitar tab in phase 1 (phase-2 candidate; see AC-021).

## Requirements

### AC-001 — MIDI timing is never mutated

Editing display quantization, time signature, or beaming must not alter any stored MIDI
note's onset or duration.

Verify with: `pnpm test:run -- Notation`

### AC-002 — Notatable display quantization

The display quantizer must map every onset to a notatable grid position selectable from
the available grid (down to 1/32 + triplets) without changing the underlying note.

Verify with: `pnpm test:run -- Notation`

### AC-003 — Measure-scoped re-layout

Editing one measure must re-engrave only the affected measure(s), not the whole score.

Verify with: `manual` — edit a measure on a 16-bar score; only that measure repaints

### AC-004 — Selection and playhead sync

Selecting a note on the staff must select the same note in the MIDI editor.

Verify with: `manual` — select a note and scrub; staff and piano-roll stay in sync

### AC-005 — Render module isolation

The notation view must consume MIDI only through the owning module's public surface, with
no cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-006 — MusicXML 4.0 schema validity

Exported MusicXML must validate against the MusicXML 4.0 partwise schema.

Verify with: `pnpm test:run -- Notation`

### AC-007 — Import/export round-trip fidelity

A `MIDI → MusicXML → MIDI` round-trip must preserve pitches, voices, and measure structure.

Verify with: `pnpm test:run -- Notation`

### AC-008 — Meter-aware beam grouping

Beams must group according to the active time signature's beat units (e.g. dotted-quarter
groups in 6/8).

Verify with: `pnpm test:run -- Notation`

### AC-009 — Multi-voice, multi-stave, grand staff (R9)

The view must support grand-staff display with at least two staves per part and at least two
voices per staff, auto-splitting notes by a configurable pitch threshold (default MIDI 60), with
per-voice stem direction and a manual staff override that persists into MusicXML export.

Verify with: `pnpm test:run -- Notation` (fixtures G grand-staff, H two-voice single staff, I manual staff override)

### AC-010 — Stem-direction engraving rules (R10)

Single-voice stems must point up below the middle staff line and down at or above it.

Verify with: `pnpm test:run -- Notation` (fixture J single-voice stem direction)

### AC-011 — Engraved elements: slurs, ties, articulations, dynamics, lyrics (R11)

The view must render and let users author slurs, user-authored ties, articulations
(staccato/tenuto/accent/marcato), dynamics (ppp–fff plus crescendo/decrescendo hairpins), and
lyrics with hyphen/underscore melisma conventions.

Verify with: `pnpm test:run -- Notation` (fixture L: one slur, one manual tie, each articulation, three dynamics, a crescendo hairpin, a lyric line; plus the display-only invariant)

### AC-012 — Transposing instruments and enharmonic spelling (R12)

Each track must carry a per-track semitone transposition offset with a project-wide
concert-pitch / written-pitch toggle (display-only, MIDI unchanged).

Verify with: `pnpm test:run -- Notation` (fixture N transposing instrument)

### AC-013 — Tuplet display (R12)

The display-quantization pipeline must detect triplets, quintuplets, and septuplets and the
renderer must draw each with a bracket and ratio number (e.g. "3"); nested tuplets are out of
scope for phase 1.

Verify with: `pnpm test:run -- Notation` (fixture M: quarter-note and eighth-note triplets render with brackets and "3" labels)

### AC-014 — Rust `quantize_for_display` Tauri command with byte-identical browser fallback (R15)

Display quantization must run in Rust via a pure, deterministic `quantize_for_display` Tauri
command (tauri-specta bindings), and a TypeScript browser fallback must produce byte-identical
descriptors on the shared fixture suite for the non-Tauri deployment.

Verify with: `pnpm test:run -- Notation` (cross-backend parity: each quantization fixture run through both backends yields byte-identical descriptors)

### AC-015 — Chord symbols above the staff (R16)

The view must let users author chord symbols above the staff, stored as notation-module
annotations keyed by time position, and export/reimport them via MusicXML `<harmony>` elements;
automatic chord detection from MIDI is out of scope for phase 1.

Verify with: `pnpm test:run -- Notation` (fixtures Q chord-symbol add, R chord-symbol export/reimport)

### AC-016 — Print / PDF export (R14)

The view must export the current score to PDF via the browser print pipeline (`window.print()`
with a print stylesheet hiding UI chrome and showing page numbers, title, and tempo block, letter
or A4 page size); a Tauri-native Verovio PDF path is a deferred later-phase enhancement.

Verify with: `manual` — print a multi-page score; preview shows correct page count, no clipping, page numbers, hidden UI chrome, and the saved PDF matches the preview

### AC-017 — Scrolling vs paged view toggle (R13, R8)

A toolbar toggle must switch between a continuous scrolling editing view (default) and a paged
print-preview view, preserving playhead and scroll position across the toggle.

Verify with: `manual` — toggle modes and confirm playhead/scroll preserved; play and confirm auto-scroll at 75% viewport and page flips in paged mode

### AC-018 — React integration constraints (R2)

The `NotationView` component must use no `forwardRef`, no `useMemo`/`useCallback`/`React.memo`
(React Compiler), no namespace imports, SVG-only output, and viewport virtualization keeping no
more than ~12 measure SVG groups in the DOM for a 200-measure score.

Verify with: `pnpm lint <changed-files>` and `pnpm deps:validate` (architectural rules); `pnpm test:run -- Notation` (≤ ~12 measure groups during scroll)

### AC-019 — Performance and licensing record (R1, constraints)

The notation bundle must add ≤ 600 KB compressed.

Verify with: `pnpm build` (bundle-size assertion)

### AC-020 — Quantization pipeline: swing, beat-boundary rests, ties at bar lines (R3, R23)

The pipeline must detect swing (on/off-beat eighth ratio ∈ [1.8, 2.5], σ < 0.3) and render
straight eighths with a swing flag, insert beat-boundary rests that never span a strong metric
boundary, and insert ties at bar lines and required metric boundaries, with adaptive per-measure
grid selection capped by a user "maximum quantization value".

Verify with: `pnpm test:run -- Notation` (fixtures C swing, D rest insertion, F tie across bar line)

### AC-021 — Guitar tab (phase-2 candidate) (R17)

Guitar tab rendering (six lines, fret numbers, standard EADGBE tuning, per-note string override,
MusicXML `<tab>`/`<staff-details>` round-trip) is a phase-2 candidate; phase-1 UI must not promise
tab until it is available.

Verify with: `pnpm test:run -- Notation` (phase-2 only: tab render, string reassignment, MusicXML tab round-trip)

### AC-022 — Notation playhead transport sync (R4)

The notation playhead must track transport position bidirectionally.

Verify with: `manual` — select a note and scrub; staff and piano-roll stay in sync

### AC-023 — Multi-voice stem-direction engraving rules (R10)

Multi-voice stems must be up for voice 1 and down for voice 2 regardless of pitch.

Verify with: `pnpm test:run -- Notation` (fixture K multi-voice stem direction)

### AC-024 — Articulations and dynamics are display-only (DD5)

Articulations and dynamics must not alter MIDI duration or velocity in phase 1.

Verify with: `pnpm test:run -- Notation` (fixture L: the display-only invariant)

### AC-025 — Enharmonic spelling default and respell (R12)

Note spelling must default from key context (e.g. MIDI 61 → C# in G major, Db in Db major) with a
user "Respell" command that swaps the enharmonic for selected notes.

Verify with: `pnpm test:run -- Notation` (fixtures O enharmonic default, P enharmonic respell)

### AC-026 — Playback cursor auto-scroll and page flip (R13, R8)

The playback cursor must auto-scroll to re-center when it reaches 75% of the viewport width in
scrolling mode and flip pages in paged mode.

Verify with: `manual` — play and confirm auto-scroll at 75% viewport and page flips in paged mode

### AC-027 — Quantization timing budget (R1)

Single-measure and 200-measure quantization must each complete in ≤ 50 ms.

Verify with: `pnpm test:run -- Notation` (quantization timing)

### AC-028 — Scrolling playback frame rate (R1)

Scrolling playback of a 200-measure grand-staff score must hold ≥ 55 fps.

Verify with: `pnpm test:run -- Notation` (fps sampling)

### AC-029 — Third-party license record (constraints)

The third-party-license file must record VexFlow (MIT) and the bundled font license.

Verify with: `manual` (license file updated)

### AC-030 — Bidirectional edit write-back: notation ↔ MIDI ↔ piano roll (R6)

Editing a note's pitch in the notation view must update the corresponding MIDI event (the
pitch number changes) so playback after the edit plays the new pitch, and editing a note's
pitch in the piano roll must update the notation view on next render (the note appears at the
new staff position). The display-quantized projection is recomputed from the updated MIDI; it
is never stored as a persistent document separate from MIDI.

Verify with: `pnpm test:run -- Notation` (dual-representation edit test: edit pitch in notation → MIDI event pitch updates and playback plays the new pitch; edit pitch in piano roll → notation view updates next render)

### AC-031 — Undo/redo symmetry across notation and piano-roll edits (R6)

Undo/redo must work symmetrically: undoing a notation edit restores the MIDI event, and
undoing a piano-roll edit updates the notation view.

Verify with: `pnpm test:run -- Notation` (undo/redo symmetry on a notation pitch edit and on a piano-roll pitch edit)

### AC-032 — Externally-authored (MuseScore) MusicXML import (R5)

A MusicXML 4.0 fixture authored in MuseScore (not generated by Sourdaw's own exporter) must
import as a MIDI-backed clip with correct note count, key signature, and time signature.

Verify with: `pnpm test:run -- Notation` (import a MuseScore-authored MusicXML fixture; assert note count, key signature, and time signature match the source)

### AC-033 — MusicXML import graceful degradation and never-throw (R5)

Unsupported features in an imported MusicXML file (cue-sized notes, cross-staff beaming, etc.)
must be either ignored with a warning surfaced in the import log, or approximated to the
nearest supported representation; import must never throw an unhandled error on well-formed XML.

Verify with: `pnpm test:run -- Notation` (import a well-formed fixture containing cue-sized notes and cross-staff beaming; assert no unhandled error is thrown and each unsupported feature is either logged as a warning in the import log or approximated)

### AC-034 — Selection sync: multi-select, range-select, Escape-clears-both, cross-view store (R7)

Selection must be shared bidirectionally between the notation view and the piano roll:
range-selecting five notes in the piano roll must highlight the same five notes in the notation
view (and vice versa), pressing Escape in either view must clear the selection in both, and
selection state must live in a cross-view UI store (a vanilla `Store<T>` in `stores/`, consumed
via `useStore`, per `AGENTS.md`'s cross-domain UI-state guidance), not in local component state.

Verify with: `pnpm test:run -- Notation` (selection sync test: range-select five notes in piano roll → same five highlighted in notation and vice versa; Escape in either view clears selection in both); `pnpm deps:validate` (selection state imported from the cross-view `stores/` store, not held in local component state)

### AC-035 — MusicXML import self round-trip via the export → import path (R5)

Exporting the R4 canonical fixture to MusicXML and then importing that exported file back
must produce a MIDI clip whose note count, key signature, time signature, and tempo all match
the original fixture. The importer must round-trip the features the R4 exporter produces.

Verify with: `pnpm test:run -- Notation` (self round-trip: export the R4 fixture, import the exported MusicXML, assert note count, key signature, time signature, and tempo match the original)

## Open questions

- [ ] Q-001 — DP quantizer cost weights (onset error vs notation complexity) — defaults
  must be tuned against a human-transcription corpus.
- [ ] Q-002 — Tuplet-detection threshold: when to prefer a triplet over a dotted figure.
- [ ] Q-003 — Multi-voice measure splitting into VexFlow voices.
- [ ] Q-004 — [CRITICAL] Verovio LGPL v3 implications for shipping — OSMD and Verovio are
  rejected for phase 1 (full-score vs page-level rendering, ~10 MB WASM, LGPL v3; see research
  RR-B/RR-C). Before any later-phase Tauri-native Verovio PDF backend (AC-016) is pursued,
  Sourdaw's legal posture on shipping LGPL v3 code (user-replaceability via dynamic linking,
  signing, notarization) must be resolved. Not a blocker for phase 1.
- [ ] Q-005 — [MAJOR] Guitar tab in phase 1 or phase 2 (AC-021)? Working answer: phase 2.
- [ ] Q-006 — (restored detail) Phasing/effort sizing from the source roadmap (~3–4 months
  total), for planning the build order: Phase 1 — basic display-only notation view (grid-based
  Rust quantization, VexFlow measure-level rendering, single voice, beaming/rests,
  clefs/key/time) — 4–6 weeks; Phase 2 — interactive (click-to-select via bounding boxes,
  bidirectional piano-roll sync, playback cursor, viewport virtualization) — 3–4 weeks;
  Phase 3 — advanced quantization (DP quantization, tuplet/swing detection, multi-voice,
  grand staff with auto split) — 3–4 weeks; Phase 4 — MusicXML export (multi-voice backup
  encoding, ties across barlines, compressed .mxl, Dorico/MuseScore/Sibelius compatibility) —
  2–3 weeks; Phase 5 — ongoing (chord symbols, lyrics, dynamics, articulations, page/print
  view, progressive engraving polish). Sub-sizing for the MusicXML exporter (RR-G): a basic
  single-voice/single-part exporter ≈ 3–5 days; production quality with multi-voice, ties,
  tuplets, and cross-application compatibility testing ≈ 2–4 weeks. Estimates only — the
  verifiable scope lives in the ACs (e.g. AC-006/AC-007/AC-013/AC-032); confirm sizing against
  actual progress.

## Affected areas

- `src/modules/Notation/` (new view, display-quantizer service, VexFlow adapter)
- `src/modules/PianoRoll/` (selection sync consumer)
- the MusicXML import/export I/O path
- the transport/playhead subscription

## Dropped from sources

- Print-grade page layout and part extraction (frames, systems, custom system breaks,
  cross-staff beaming, cue-sized notes, ossia staves) — scorewriter scope, a separate later spec.
- Manual engraving nudge controls — engraving polish deferred past v1.
- Figured bass — additive notation layer for a follow-up.

Note: lyrics and chord symbols are NOT dropped. The original notation spec
(`specs/missing/notation.md` R11, R16) keeps both in scope; an earlier condensation wrongly
listed them as non-goals. They are restored here as AC-011 (lyrics) and AC-015 (chord symbols),
and the Non-goals list was corrected accordingly.
