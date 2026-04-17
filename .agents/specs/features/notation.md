# Spec: Notation view — staff display, display quantization, MusicXML bridge

## Reference research

- `.agents/research/features/notation.md` — renderer comparison (VexFlow v5 vs OSMD vs Verovio), display quantization algorithms (grid / DP / HMM), MusicXML 4.0 generation pitfalls, Rust/TS boundary analysis, and phased implementation roadmap.

All renderer performance numbers, algorithm pseudocode (beam grouping, rest insertion, quantization DP recurrence), MusicXML gotchas (`<backup>`, voice numbering across staves, `<tie>` vs `<tied>` duality), and the phased build order live in the research file. This spec references them by topic but does not re-embed them.

---

## Context

Sourdaw is not a notation program. It will not compete with Dorico, Sibelius, or MuseScore on engraving quality, layout automation, or publication workflow. What producers consistently need — and what every serious DAW has historically under-delivered — is a **notation bridge**: a staff view of MIDI content that is readable enough to hand to a session musician and a round-trip path into dedicated notation tools for anything beyond that.

The market baseline was reset by Cubase 14's Dorico-powered Score Editor (clean auto-beaming from live MIDI, display quantization separated from playback, MusicXML export). Sourdaw must match that baseline but does not need to exceed it. Users expect: readable parts from MIDI performances without manual cleanup, enharmonic spelling that respects key context, a clear separation between what is played back and what is drawn, and an escape hatch (MusicXML) to professional tools.

This spec **replaces** the one-paragraph treatment in `.agents/specs/global/full-spec.md` ("Notation as a bridge, not a destination") and the three-bullet entry in `.agents/specs/consolidated/implementation-gaps.md` §6.5 (renderer choice, display quantization, MusicXML export). Those entries remain historically accurate but are superseded by this document as the authoritative notation contract.

### Strategic position

- **Bridge, not destination.** Notation exists to make MIDI legible on a staff, to let users print parts for collaborators, and to hand off to dedicated notation software via MusicXML. It does not exist to typeset scores for publication.
- **MIDI is the source of truth.** The notation view is a rendered projection of underlying MIDI data. Editing notation must write back to MIDI; playback always reads from MIDI. There is no separate "score document" the user edits independently of the MIDI clip.
- **Display quantization is non-destructive.** The raw MIDI ticks used for playback are never modified by the display quantizer. Users can see "readable" notation of a rubato performance while the performance itself plays back untouched.
- **The hand-off is MusicXML.** When users need publication-quality engraving, full page layout, or engraver-specific features (cue sizes, ossia staves, explicit cross-staff beaming, etc.), they export MusicXML and open it in MuseScore, Dorico, or Sibelius. Sourdaw does not pretend to replace those tools.

### Existing codebase context

Sourdaw has a `Notation` module scaffold under `src/modules/` with module boundaries enforced by `no-cross-module-internals` and `models-private-cross`. The notation module must respect the same architectural rules as every other module: contract imports via the module root `index.ts`, use cases as one-function-per-file, presentation layer isolated from engine/repositories, and Tauri commands exclusively in `src-tauri`.

There is no prior notation rendering in the codebase — this spec is a green-field build within the existing module conventions. The piano roll (`src/modules/PianoRoll`) and the arrangement timeline (`src/modules/Arrangement`) are the existing MIDI presentation surfaces the notation view must integrate with.

---

## Goal

After implementation, Sourdaw can open any MIDI clip in a staff-notation view that renders readable notation from unquantized MIDI (without modifying playback data), keeps the piano roll and notation in bidirectional sync (editing a note in either view updates both and updates MIDI), exports a round-trippable MusicXML file that opens correctly in MuseScore and Dorico, and offers the minimum engraving feature set producers expect (grand staff, multiple voices, automatic beaming, rests obeying beat boundaries, ties across bar lines, dynamics, articulations, tuplets, and chord symbols).

---

## User-visible behavior

From a producer's perspective:

- **Open any MIDI clip on a staff.** Right-click a MIDI clip → "Open in Notation View" yields a readable score within ≤ 200 ms on a mid-tier developer machine for clips up to 200 measures.
- **Notation reflects MIDI, not vice versa.** Rubato performances render cleanly (auto-quantized for display) while playback preserves every original tick. A toggle shows the raw performance vs the quantized display.
- **Edit in either view.** Changing a pitch, duration, or velocity in the notation view updates the MIDI clip; changes in the piano roll immediately update the notation next frame.
- **Selection and playhead sync.** Clicking a note in notation highlights it in the piano roll (and vice versa). The playhead scrubs across the staff in lock-step with the arrangement transport.
- **Export / import MusicXML.** "Export MusicXML…" produces a file that opens without errors in MuseScore 4.x and Dorico 5.x. "Import MusicXML…" creates a MIDI-backed clip.
- **Print-ready parts.** "Print / Export PDF" generates a paged layout with title, tempo, bar numbers, and configurable page size.
- **Lead-sheet workflow.** Users can author chord symbols above the staff; symbols are preserved on MusicXML round-trip.

---

## In scope

- Staff view (treble, bass, grand staff) rendering MIDI clip contents via a browser-side renderer, driven by display-quantized note descriptors.
- Non-destructive display quantization (grid-based in phase 1; DP/HMM refinement in later phases).
- Bidirectional edit sync between notation and piano roll: both are views over the same MIDI model.
- Selection sync between notation and piano roll (clicking a note in one highlights it in the other).
- Playback cursor following the transport playhead through the score.
- MusicXML 4.0 export (round-trippable through MuseScore and Dorico).
- MusicXML 4.0 import (for scores generated elsewhere, imported as MIDI-backed clips).
- Automatic beaming per meter, rest insertion respecting beat boundaries, tie insertion at bar lines and required metric boundaries.
- Basic engraved elements: dynamics (pp–ff, hairpins), articulations (staccato, tenuto, accent, marcato), slurs, ties, lyrics.
- Tuplets (at minimum 3-tuplets, 5-tuplets, 7-tuplets).
- Transposing instruments with concert-pitch / written-pitch toggle.
- Enharmonic respell command (user-triggered).
- Scrolling continuous view and paged view, toggleable.
- Print / PDF export.
- Chord symbols above the staff (for lead-sheet workflows).

## Non-goals

- **Publication-quality engraving.** Sourdaw will not match Dorico's or Sibelius's engraving quality. Professional engraving is left to dedicated tools.
- **SMuFL font bundling and customization.** A single default music font ships with the app. Users cannot swap fonts or install third-party SMuFL fonts.
- **Collaborative multi-user score editing.** Multi-user collaboration is out of scope for the notation view; if it ever ships, it applies to the project as a whole, not the score.
- **Advanced page layout controls.** No cross-staff beaming, no custom system breaks, no cue-sized notes, no ossia staves, no system dividers. Those belong in a dedicated notation tool.
- **Score-driven playback interpretation.** The notation view does not alter MIDI velocity from dynamics markings or change timing from articulations. Articulations and dynamics are display-only annotations in phase 1. Score-affects-playback is a separate future feature.
- **Audio-to-notation transcription.** Transcription from audio (MP3/WAV) is out of scope for this spec. Users must have a MIDI clip first.
- **Graphical score layout for film scoring / cue sheets.** Text frames, tempo maps with rehearsal marks, movement structure, and film timecode readout are out of scope.

---

## Requirements

### R1 — Renderer choice: VexFlow v5

**Requirement.** The notation view uses **VexFlow v5** (MIT-licensed, TypeScript-native, measure-level rendering, SVG output) as the rendering engine. OSMD and Verovio are explicitly rejected for phase 1.

**Rationale.**

- **VexFlow v5** offers measure-level granularity (re-render a single measure on edit, ~5 ms), MIT licensing (no legal encumbrance), native TypeScript types, ~400 KB bundle size, and SVG output (hit-testable without workarounds).
- **OSMD** is rejected: it renders the entire score on every update (400 ms for a medium score, 2–8 s for large scores), making it unusable for interactive editing. Its MusicXML parsing adds no value for the MIDI-first pipeline, and it roughly doubles VexFlow's bundle size.
- **Verovio** is rejected for phase 1: the ~10 MB WASM binary and LGPL v3 licensing are significant drawbacks, and its MEI-centric architecture adds a format translation layer. It is a candidate for a future "export to high-quality PDF" backend (see R14), reached via Tauri for native PDF generation — out of scope for phase 1 browser-side rendering.

**Acceptance criteria.**

- VexFlow v5 is the only rendering engine integrated into the notation module. No OSMD or Verovio code is imported in phase 1.
- The notation renderer bundle (VexFlow + required font) adds **≤ 600 KB** to the app's compressed JS bundle. Verified via build output.
- A trivial single-measure score (4/4, four quarter notes, treble clef) renders in **≤ 50 ms** measured via `performance.now()` wrapping the render call, on a mid-tier developer machine.
- Editing one note in an 8-measure, single-voice score triggers re-render of **only the affected measure**; measures before and after are untouched. Verified by logging measure-level render calls.
- Licensing: VexFlow's MIT license is recorded in the app's third-party-license file and no LGPL/GPL code is introduced by this feature.

### R2 — React integration pattern

**Requirement.** A React component `NotationView` encapsulates VexFlow's imperative lifecycle and exposes a declarative data-in interface.

**Constraints** (per `AGENTS.md`):

- **`ref` is a regular prop.** Do not use `forwardRef`.
- **No `useMemo`, `useCallback`, `React.memo`** — the React Compiler handles memoization.
- **No namespace imports** — import VexFlow named exports individually.
- SVG output only (not Canvas) so notes become DOM elements addressable for hit-testing, selection, and accessibility.
- Virtualization: only measures within the viewport (and a configurable overscan window) are rendered. Off-screen measures are removed from the DOM.
- Measure-level invalidation: when a prop change affects only measures M through N, only those measures re-render; unaffected measures remain mounted.

**Acceptance criteria.**

- `NotationView` is a function component with no `forwardRef`, no `useMemo`/`useCallback`, and no `React.memo`. ESLint architectural rules pass.
- Given a 200-measure score with viewport covering 8 measures, the DOM contains no more than ~12 measure SVG groups at any time (8 visible + overscan).
- Scrolling through a 200-measure score maintains ≥ 55 fps on a mid-tier developer machine (measured via the browser's performance recorder).
- Editing a single note in measure 42 of a 200-measure score triggers exactly one measure re-render (measure 42), verified by a test-only render counter.
- `pnpm deps:validate` passes with zero violations after the module is added.

### R3 — Display quantization algorithm (grid-based phase 1; DP refinement phase 2)

**Requirement.** Raw MIDI tick data is transformed into readable notation via a **display quantization** pipeline that does not modify the underlying MIDI. The phase 1 algorithm is **grid-based snapping** with adaptive grid selection per measure; phase 2 introduces a DP-based refinement. Tuplet detection (triplets, quintuplets, septuplets), swing detection, voice splitting, rest insertion, tie insertion, and beam grouping are all part of the quantization pipeline, not the renderer.

**Pipeline** (summary; full pseudocode in research file):

1. Build the beat grid from the project's tempo map and time signature map.
2. Detect tuplets per beat window (triplet/quintuplet/septuplet grid tested against straight grid; tuplet if tuplet_error < straight_error × 0.6).
3. Detect swing (on-beat/off-beat eighth ratio ∈ [1.8, 2.5] with σ < 0.3); display as straight eighths with a "swing" annotation.
4. Snap onsets to the chosen grid (straight or tuplet).
5. Snap durations with a minimum floor of one grid unit.
6. Voice-split: piano grand-staff splits at a configurable pitch threshold (default MIDI 60, middle C); single-staff voice assignment uses greedy minimum-pitch-leap cost.
7. Insert rests following beat-boundary rules (never span strong metric boundaries; no dotted-half rest crossing mid-bar in 4/4).
8. Insert ties at bar lines and at required metric boundaries (mid-bar in 4/4; every beat in 3/4; per compound beat unit in 6/8, 9/8, 12/8).
9. Assign beam groups per time signature (groups of 2 in simple meters, groups of 3 in compound; never beam across beat 2–3 in 4/4).
10. Decompose durations into notation-legal values (greedy largest-legal-fits-within-beat; tie together when no single duration fits).

**Acceptance criteria.**

- **Fixture test A (grid baseline).** Given a MIDI fixture of eight quarter notes on a 4/4 bar where each note's onset is offset by ±5 ticks from a clean grid (simulating unquantized input at 480 PPQ), the quantized output has all eight notes on exact beat positions, rendered as eight straight quarter notes.
- **Fixture test B (triplet detection).** Given a MIDI fixture of a beat containing three evenly-spaced notes each 160 ticks long at 480 PPQ, the output marks them as a triplet group (not three mangled sixteenth/eighth combinations).
- **Fixture test C (swing).** Given a MIDI fixture of a 2/4 bar containing four eighths with alternating long (~320 tick) / short (~160 tick) durations, the output is flagged as swing and rendered as four straight eighths.
- **Fixture test D (rest insertion).** Given a MIDI fixture with silence from beat 1.5 to beat 4 in a 4/4 bar, the rendered rests are: eighth rest (finish beat 1), quarter rest (beat 2), quarter rest (beat 3). Never a dotted half rest.
- **Fixture test E (beam grouping 4/4).** Given a MIDI fixture of eight eighth notes in a 4/4 bar, the output produces two beam groups of four (beats 1–2 beamed together, beats 3–4 beamed together). Never a single beam of eight.
- **Fixture test F (tie across bar).** Given a MIDI fixture of a half note starting on beat 3 of a 4/4 bar, the output ties a half into the next bar only if the note crosses the bar line; otherwise a single half-note is drawn.
- **Non-destructive invariant.** After quantization, the source MIDI clip's tick data, durations, and velocities are byte-identical to the pre-quantization state. Verified by hashing the MIDI model before and after the quantization call.

Phase 2 acceptance (DP refinement) is deferred to a follow-up spec but must fit behind the same interface as phase 1.

### R4 — MusicXML export pipeline (MusicXML 4.0, round-trippable)

**Requirement.** The notation module exports MusicXML 4.0 (`<score-partwise>` top element) with full support for multi-voice encoding via `<backup>`, tied notes at bar lines, tuplets, key/time signatures, and score metadata (title, composer, copyright).

**Design constraints.**

- **Divisions.** Use `divisions=24` (divisible by both 3 for triplets and 4 for sixteenths) unless the source PPQ makes a direct mapping cleaner. Duration values are expressed in divisions, not ticks.
- **Voices.** Voice numbers are unique across staves in a multi-staff part (voices 1–2 on staff 1, voices 3–4 on staff 2) to avoid the Dorico cross-staff collision gotcha.
- **Ties.** Every tied note emits **both** `<tie type="start"/>` (the sound element, inside `<note>`) **and** `<tied type="start"/>` (the notation element, inside `<notations>`). Missing either causes rendering failures in some importers.
- **Note type.** Every `<note>` element includes `<type>` alongside `<duration>`.
- **XML generation.** String template literals are acceptable for phase 1 (MusicXML is structurally repetitive). No third-party MusicXML library is introduced (the available NPM options are unmaintained, AGPL, or flagged "use at your own risk"). If a library becomes necessary later, it must be license-audited.

**Acceptance criteria.**

- **Round-trip through MuseScore.** A canonical fixture score (treble staff, 16 bars in 4/4, key of G, tempo 120, title "Test Piece", two voices, one triplet, one tied note across a bar line, one dynamic marking) is exported as MusicXML. When opened in MuseScore 4.x: title matches, key signature matches, time signature matches, tempo matches, note count matches (including the triplet and the tied pair counted correctly), voice assignment matches, and the dynamic marking is present.
- **Round-trip through Dorico.** The same fixture opens in Dorico without parse errors; voice numbering does not produce cross-staff chord collisions on the grand-staff variant.
- **XML schema validity.** The exported file validates against the MusicXML 4.0 schema with zero errors (verified via `xmllint --schema musicxml.xsd` in a test script).
- **Non-destructive invariant.** Exporting does not modify the source MIDI model.

### R5 — MusicXML import

**Requirement.** The notation module imports MusicXML 4.0 files. The import produces a MIDI clip (the source of truth) that is rendered by the normal notation view.

**Design constraints.**

- A custom parser is acceptable for phase 1; OSMD's parser is not introduced just for import (its rendering layer is explicitly rejected per R1, and pulling in only its parser would drag the OSMD dependency).
- Imports must handle the features produced by the R4 exporter (round-trippable through the repo's own export → import path), plus MuseScore's common output patterns.

**Acceptance criteria.**

- **Self round-trip.** Exporting the R4 fixture, then importing the exported file, produces a MIDI clip with note count, key signature, time signature, and tempo matching the original.
- **MuseScore-authored fixture.** A MusicXML fixture authored in MuseScore (not generated by Sourdaw) imports with correct note count, key signature, and time signature.
- **Graceful degradation.** Unsupported features in an imported file (cue-sized notes, cross-staff beaming, etc.) are either ignored with a warning surfaced in the import log, or approximated to the nearest supported representation. Import never throws unhandled errors on well-formed XML.

### R6 — Dual representation (display vs playback)

**Requirement.** The notation view is a **projection** of the underlying MIDI model. MIDI is the source of truth for playback. The display-quantized notation is a view computed from MIDI. When the user edits the notation (changes a pitch, shifts a duration, deletes a note, adds an articulation), the edit writes back to the MIDI model; the view recomputes from the updated MIDI. The display-quantized intermediate representation is never stored as a persistent document separate from MIDI.

**Architectural constraints.**

- The MIDI model lives in the existing `Arrangement` / `Clip` modules. The notation module does not own any note data.
- Use-case functions in the notation module (`editNoteInNotation`, `addArticulation`, `setVoiceAssignment`, etc.) are one-function-per-file and re-exported from the module root `index.ts`. They call into the MIDI-owning module's use cases via that module's contract.
- The notation module's internal types (e.g. `DisplayMeasure`, `DisplayNote`, `BeamGroup`) are models of the **display projection**, not of MIDI. They are strictly private to the notation module (per the module-privacy rule).
- Articulations and dynamics attached only to the notation view (not affecting MIDI playback in phase 1) are stored as notation-module-owned annotations keyed by MIDI note ID. They persist with the project but do not modify MIDI event data.

**Acceptance criteria.**

- Editing a note's pitch in the notation view updates the corresponding MIDI event (pitch number changes), and playback after the edit plays the new pitch.
- Editing a note's pitch in the piano roll updates the notation view on next render (the note appears at the new staff position).
- Undo/redo works symmetrically: undoing a notation edit restores the MIDI event; undoing a piano-roll edit updates the notation view.
- Articulations added in notation (e.g. staccato) do not change MIDI note duration or velocity in phase 1. The articulation is a display annotation only.
- `pnpm deps:validate` passes: notation module imports from the MIDI-owning module only via its contract (`#/modules/Arrangement` barrel, no deep imports).

### R7 — Piano roll ↔ notation selection sync

**Requirement.** Note selection is shared between the piano roll and the notation view. Selecting a note in one highlights it in the other; deselecting does the same. Multi-selection and range selection behave consistently across views.

**Acceptance criteria.**

- Clicking a note in the notation view highlights the corresponding note in the piano roll (if the piano roll is open alongside the notation view), and vice versa.
- Range-selecting five notes in the piano roll highlights the same five notes in the notation view.
- Pressing Escape in either view clears the selection in both.
- Selection state lives in a cross-view UI store (per `AGENTS.md`'s guidance on cross-domain UI state — a vanilla `Store<T>` in `stores/`, consumed via `useStore`), not in local component state.

### R8 — Playback cursor in score

**Requirement.** During playback, a cursor follows the transport playhead through the notation view. The user can toggle between **scrolling** mode (view auto-scrolls to keep the cursor on screen) and **page** mode (the view advances by whole pages when the cursor reaches the end).

**Acceptance criteria.**

- During playback at 120 BPM, the cursor's horizontal position advances smoothly (visually at ≥ 55 fps on a mid-tier developer machine).
- In scrolling mode, when the cursor reaches 75% of the viewport width, the view scrolls to re-center the cursor. The user can disable auto-scroll with a toggle.
- In page mode, when the cursor reaches the end of the current page, the view flips to the next page. No mid-page scrolling occurs in this mode.
- Pausing playback freezes the cursor in place. Scrubbing the transport timeline repositions the cursor accordingly.

### R9 — Multi-voice, multi-stave, grand staff

**Requirement.** The notation view supports multi-voice display (at minimum two voices per staff), multi-staff parts (at minimum two staves per part for grand-staff keyboard instruments), and correct stem direction per voice.

**Design constraints.**

- Grand staff auto-assignment splits notes by pitch at a configurable threshold (default MIDI 60; user-overridable per clip).
- Voice 1 on a staff is stem-up by default; voice 2 is stem-down.
- MusicXML export (per R4) must use unique voice numbers across staves (1–2 on staff 1; 3–4 on staff 2).

**Acceptance criteria.**

- **Fixture test G (grand staff).** A MIDI fixture containing notes in the ranges C2–B3 and C4–C6 renders on a grand staff with lower notes on the bass staff and upper notes on the treble staff.
- **Fixture test H (two-voice single staff).** A MIDI fixture with two simultaneous melodic lines on a single staff (e.g. SATB soprano + alto) renders with stem-up for voice 1 and stem-down for voice 2, correct rests per voice, and correct tie direction.
- **Fixture test I (manual staff override).** The user can manually move a note from treble to bass (or vice versa) in a grand-staff context; the assignment persists and is included in MusicXML export.

### R10 — Stem direction

**Requirement.** Stem direction follows the standard engraving rules:

- **Single voice on a staff:** stems up for notes below the middle staff line, stems down for notes at or above the middle line.
- **Multi-voice on a staff:** voice 1 stems up, voice 2 stems down, regardless of pitch.

**Acceptance criteria.**

- **Fixture test J (stem direction single voice).** A MIDI fixture of C4 (below middle line on treble) through A4 (above middle line) renders with stems up for C4–B4 below the middle line and stems down at and above the middle line.
- **Fixture test K (stem direction multi-voice).** In any two-voice fixture, voice 1 stems are always up, voice 2 stems are always down, irrespective of pitch.

### R11 — Engraved elements (slurs, ties, articulations, dynamics, lyrics)

**Requirement.** The notation view renders the following engraved elements and supports adding and editing them via UI:

- **Slurs:** curved lines over groups of notes; authored by selecting a range and invoking "Add slur."
- **Ties:** automatically inserted at bar lines and required metric boundaries (per R3); user-authored ties are also supported.
- **Articulations:** staccato, tenuto, accent, marcato. Attached per note. Display-only in phase 1 (no MIDI change).
- **Dynamics:** `ppp`, `pp`, `p`, `mp`, `mf`, `f`, `ff`, `fff`, and hairpins (crescendo / decrescendo). Attached to a staff at a time position. Display-only in phase 1.
- **Lyrics:** text syllables aligned under notes, one syllable per note, with hyphen (`-`) and underscore (`_`) conventions for melismas.

**Acceptance criteria.**

- **Fixture test L (each element).** A fixture score containing one slur, one manual tie, one of each articulation (staccato, tenuto, accent, marcato), three dynamics (p, mf, ff), one crescendo hairpin, and a line of lyrics renders all elements correctly.
- **MusicXML round-trip (per R4).** The same fixture exports to MusicXML, opens in MuseScore, and the slur, ties, articulations, dynamics, hairpin, and lyrics are preserved.
- **Articulations do not alter playback in phase 1.** A note with staccato plays back with identical MIDI note duration and velocity to a note without the articulation. (Altering playback from articulations is a future feature.)

### R12 — Tuplets, transposing instruments, enharmonic spelling

**Requirement.**

- **Tuplets.** The display quantization pipeline detects triplets, quintuplets, and septuplets (per R3) and the renderer draws them with a tuplet bracket and ratio number (e.g. "3"). Nested tuplets are out of scope for phase 1.
- **Transposing instruments.** Each notation-track has a transposition property (semitone offset, e.g. Bb clarinet = −2). A project-wide toggle switches between **concert pitch** display (all instruments at sounding pitch) and **written pitch** display (transposed per instrument). The toggle is purely a display transform; MIDI playback is unaffected.
- **Enharmonic spelling.** A default spelling is chosen per note based on key context (key of G → F# not Gb; key of Eb → Bb not A#). A user-triggered "Respell note" command swaps the enharmonic for selected notes. Automatic key-context spelling is phase 1; interactive respell is phase 1. Chromatic context-aware respelling heuristics beyond the key signature are phase 2.

**Acceptance criteria.**

- **Fixture test M (triplets).** A MIDI fixture of a 4/4 bar with one quarter-note triplet (three notes of 320 ticks each at 480 PPQ) and one eighth-note triplet (three notes of 160 ticks each) renders with correct tuplet brackets and "3" labels.
- **Fixture test N (transposing instrument).** A MIDI clip on a Bb-clarinet-assigned track with note C5 (MIDI 72) renders at D5 (written) when "Written pitch" is toggled and at C5 (concert) when "Concert pitch" is toggled. Playback is unchanged in both modes.
- **Fixture test O (enharmonic default).** A MIDI note 61 in a G-major key renders as C# by default; in a Db-major key renders as Db by default.
- **Fixture test P (enharmonic respell).** The user selects a C# and invokes "Respell enharmonic"; it becomes Db. Invoking again swaps back to C#.

### R13 — Scrolling vs page view toggle

**Requirement.** A view-mode toggle switches between **continuous scrolling** (horizontal scroll through all measures on one line, or a long wrapped single-column view) and **paged** (measures laid out in systems on letter-sized or A4 pages). The scrolling mode is the default for editing; the paged mode is preferred for print preview.

**Acceptance criteria.**

- The toggle is available in the notation view's toolbar.
- In scrolling mode, all measures are laid out in a single column with system breaks, no page margins, no page numbers.
- In paged mode, measures are laid out in systems within page boundaries (letter default; A4 available in print settings). Page margins, page numbers, and the title/composer block appear on the first page.
- Switching between modes preserves the current playhead position and the user's scroll position (translated to the nearest equivalent in the new mode).

### R14 — Print / PDF export

**Requirement.** The notation view can export the current score to PDF. Phase 1 uses the browser's own print pipeline: SVG → CSS print stylesheet → `window.print()` → user saves as PDF via the print dialog. This is a pragmatic path that requires no extra dependencies.

**Later-phase option (out of phase 1 scope).** A Tauri-native PDF path using Verovio compiled as a Rust library is deferred. It is noted here so the architecture can accommodate it without rework: the display-quantized representation (per R3) is serializable to MEI or MusicXML and can be handed to a native Verovio renderer for higher-quality PDF output. This is an explicit later-phase enhancement, not a phase 1 requirement.

**Acceptance criteria.**

- Invoking "Print" on a multi-page score renders each page correctly in the browser's print preview (no clipping, no overlapping systems, page numbers visible).
- Saved PDFs from the browser print dialog open in a standard PDF viewer with the same layout as the print preview.
- The print stylesheet hides UI chrome (toolbars, inspectors, playback cursor) and shows only the score pages.

### R15 — Rust `quantize_for_display` Tauri command

**Requirement.** Display quantization runs in **Rust** via a Tauri command. The TypeScript frontend calls `quantize_for_display` passing MIDI notes, time-signature events, tempo map, and quantization options; the command returns display-ready note descriptors (the output of the R3 pipeline). The TypeScript layer is responsible only for mapping the descriptors to VexFlow objects and rendering.

**Design constraints** (per `AGENTS.md` and the Tauri-platform skill):

- The command lives in `src-tauri`, consumed only from a repository in the notation module (one-function-per-file, under `repositories/`).
- Types are shared via `tauri-specta` using `serde(transparent)` newtypes where appropriate.
- The command must be pure and deterministic: same input → same output. No filesystem or global state access.
- **Browser fallback.** When running in a non-Tauri browser context (web deployment, dev server), a TypeScript implementation of the same pipeline is used. Both implementations must produce identical output on a shared fixture suite.

**Acceptance criteria.**

- `quantize_for_display` is declared in Rust under `src-tauri/src/commands/` (or wherever existing commands live), with `tauri-specta`-generated TypeScript bindings.
- Calling the Rust command from the TypeScript frontend on a fixture (the same fixtures used in R3) produces the expected descriptor structure.
- Running the same fixtures through the TypeScript browser fallback produces byte-identical descriptors. Verified by a cross-backend fixture test.
- A 200-measure grand-staff score quantizes in **≤ 50 ms** via the Rust command on a mid-tier developer machine (excluding IPC overhead; IPC overhead itself is documented but not gated).

### R16 — Chord symbols

**Requirement.** The notation view renders chord symbols (e.g. `Cmaj7`, `F#m7b5`, `G/B`) above the staff. Chord symbols are authored in the notation view (not auto-derived from the MIDI content in phase 1). A user adds a chord symbol at a time position by clicking above the staff and typing the symbol.

**Design constraints.**

- Chord symbols are notation-module-owned annotations, keyed by time position, stored with the project but separate from the MIDI data (similar to articulations per R11).
- MusicXML export encodes chord symbols using `<harmony>` elements per the MusicXML 4.0 spec.
- Auto-derivation of chord symbols from MIDI content (chord detection) is **explicitly out of scope** for phase 1.

**Acceptance criteria.**

- **Fixture test Q (chord symbol add).** The user clicks above beat 1 of measure 1 and types `Cmaj7`. The chord symbol renders above the staff at the correct time position.
- **Fixture test R (chord symbol export).** A score with four chord symbols across four measures exports to MusicXML with four `<harmony>` elements; reimport restores the same symbols at the same positions.

### R17 — Guitar tab (phase 2 candidate)

**Requirement.** Basic guitar tablature rendering for guitar-assigned tracks. The user can toggle between staff view and tab view (or show both, staff above tab). Notes in the MIDI clip are mapped to fret/string pairs using a default mapping per standard tuning; the user can override the string assignment per note.

**Status.** This requirement is a **phase 2 candidate**. Phase 1 may ship without tab support; the user-facing UI must not promise tab until tab is available. A **[MAJOR]** open question below tracks whether tab is in phase 1 or phase 2.

**Acceptance criteria (phase 2 only).**

- A MIDI clip on a guitar-assigned track renders as tab (six lines, fret numbers) with standard tuning (EADGBE).
- The user can select a note and reassign it to a different string; the fret recalculates.
- MusicXML export encodes tab via `<staff-details>` and `<tab>` elements; import roundtrips.

---

## Constraints

- **Module boundaries:** All notation code lives in `src/modules/Notation/` and respects `no-cross-module-internals` + `models-private-cross`. Cross-module access to Notation is through its root `index.ts` only.
- **Tauri commands:** Rust `quantize_for_display` (R15) lives in `src-tauri/` only. The browser fallback lives in `src/modules/Notation/services/` as pure TS.
- **One function per file** in `useCases/` and `repositories/`.
- **Performance targets:**
    - 200-measure grand-staff score: ≥ 55 fps during scrolling playback.
    - Display quantization of 200 measures: ≤ 50 ms (Rust backend).
    - Notation bundle adds ≤ 600 KB compressed.
- **No destructive edits to MIDI.** Display quantization is pure projection; playback data is never modified by the quantizer.
- **Licensing:** VexFlow (MIT) is acceptable. Any Verovio (LGPL) inclusion is deferred to a later phase and gated on the [CRITICAL] open question.
- **React 19 / React Compiler active:** no manual `useMemo`/`useCallback`/`React.memo`; no `forwardRef`.

## Design decisions

### DD1 — Renderer: VexFlow, not OSMD or Verovio

Taken in R1. Measure-level rendering, MIT licensing, and TypeScript-native codebase outweigh OSMD's bundled MusicXML parser (we do not need it because our pipeline is MIDI → quantize → descriptors → VexFlow, not MIDI → MusicXML → OSMD) and Verovio's superior engraving (the LGPL encumbrance, ~10 MB WASM, and MEI layer are disproportionate costs for a notation bridge). Verovio remains a candidate for a later-phase PDF backend via Tauri-native compilation.

### DD2 — Dual representation, not overwrite

MIDI is the source of truth for playback; notation is a rendered projection recomputed on every relevant edit. The alternative — storing a separate notation document that edits overwrite the MIDI — was rejected because it splits the truth in two (the user sees one thing, playback produces another) and introduces a synchronization problem that notation-first tools solve by giving up playback fidelity. Our users care about the performance, not the engraving.

### DD3 — Display quantization in Rust, MusicXML generation in TypeScript

Quantization is CPU-bound pure computation (DP / HMM variants are O(N × G²) per measure) with no DOM or DAW-state dependencies. Rust is the right home for it: no GC pauses, unit-testable without a browser, reusable across live rendering and MusicXML export. MusicXML generation, in contrast, is pure string manipulation on already-quantized data; running it in Rust buys nothing. Keeping it in TypeScript avoids an IPC hop on a user-triggered export and keeps the MusicXML code close to the renderer types.

### DD4 — Browser fallback for quantization

The same pipeline is implemented twice: once in Rust (native Tauri context), once in TypeScript (browser / non-Tauri context). This costs some duplication but is unavoidable — the browser deployment target cannot call Tauri commands, and the notation view must work there too. Both implementations share a fixture suite to stay in sync; if they drift, the fixture test fails.

### DD5 — Articulations and dynamics are display-only in phase 1

Articulations (staccato, tenuto, accent, marcato) and dynamics (pp–ff, hairpins) are rendered in phase 1 but do not alter MIDI playback (velocity, duration, timing). Doing otherwise would entangle the notation view with playback interpretation — a scope explosion. Score-affects-playback is a legitimate future feature but requires its own spec (defining how staccato shortens a note, how crescendo scales velocity, whether the changes are destructive or overlay).

### DD6 — XML generation via template literals, not a library

The available MusicXML JS/TS libraries are either unmaintained (`@stringsync/musicxml` flagged "use at your own risk"), problematically licensed (`musicxml-interfaces` is AGPL), or parsing-only (OSMD, explicitly rejected per R1). Rather than import a questionable dependency, phase 1 generates MusicXML via string template literals. MusicXML is structurally repetitive and this is a 3–5 day spike for single-voice / 2–4 week spike for full multi-voice. A dedicated library can be introduced later if a reputable one appears.

### DD7 — No codemods, no automated refactors

Per `AGENTS.md`, every file change is manual. This spec does not introduce any large-scale file-mutation step; the notation module is built from scratch in its existing scaffold and integrates with existing modules via their contracts. Migrations, if needed, are a separate spec.

---

## Open questions

### [CRITICAL]

1. **Verovio LGPL implications for shipping** — R1 rejects Verovio for phase 1 and defers it as a future Tauri-native PDF backend. Before the later-phase PDF path is pursued, Sourdaw's legal posture on shipping LGPL v3 code in a commercial product must be determined. LGPL v3 requires that users be able to replace the LGPL library with a modified version (typically via dynamic linking or equivalent). The cost of meeting that obligation in our distribution model — including desktop app signing, macOS notarization, and end-user-replaceability of a linked library — has not been assessed. **Resolution required before any Verovio work begins.** (Not a blocker for phase 1.)

### [MAJOR]

1. **Guitar tab in phase 1 or phase 2?** — R17 describes tab as a phase 2 candidate. The decision depends on how many users have guitar-heavy workflows and how much engineering runway remains after the phase 1 core ships. **Working answer:** phase 2. Phase 1 ships without tab; the feature is announced as "coming in v1.x." **Resolution required before Phase 1 feature scoping is finalized for release communications.**

### [MINOR]

1. **SMuFL font bundling** — Phase 1 ships the single default VexFlow font (Bravura or similar, MIT/SIL-OFL licensed). Allowing users to swap in alternative SMuFL fonts (Petaluma, Leland, etc.) is a cosmetic feature with modest demand. **Working answer:** ship a single font; evaluate user demand after release; add a font picker only if demand materializes. **Not blocking.**

2. **Chord symbol rendering font** — Chord symbols (R16) traditionally use a sans-serif chord-specific font (e.g. the jazz-style "dashed" vs "italic" variants). The choice is cosmetic; a single sensible default suffices for phase 1. **Working answer:** render chord symbols in a standard sans-serif with a small superscript for chord extensions (`maj7`, `m7b5`). **Not blocking.**

3. **Print page-size defaults by locale** — R14 defaults to letter in the US and A4 elsewhere. The detection mechanism (browser locale, OS setting, user project preference) is not specified. **Working answer:** user-configurable in print settings with a locale-based default. **Not blocking.**

4. **Enharmonic respell heuristics beyond the key** — R12 defines key-context spelling for phase 1 and interactive respell. More sophisticated automatic spelling (chromatic context, voice-leading rules) is a future refinement. **Not blocking.**

---

## Acceptance criteria / release gate

The notation view is considered shippable when **all** of the following hold:

1. R1 through R16 each have their acceptance criteria fixture tests passing in CI. (R17 tab is explicitly deferred.)
2. `pnpm deps:validate` passes with zero violations in the notation module.
3. `pnpm typecheck` passes across the repository.
4. MusicXML export round-trips through MuseScore 4.x and Dorico 5.x on the R4 fixture without errors.
5. MusicXML import handles the R5 self-round-trip fixture and at least one externally authored (MuseScore) fixture.
6. The notation view renders a 200-measure grand-staff score at ≥ 55 fps on a mid-tier developer machine during scrolling playback.
7. Display quantization of a 200-measure score completes in ≤ 50 ms (Rust backend) on a mid-tier developer machine.
8. The browser (non-Tauri) fallback of the quantization pipeline produces byte-identical output to the Rust backend on the shared fixture suite.
9. All [CRITICAL] open questions are resolved in writing before the implementation of the affected requirement begins. (Verovio LGPL only blocks later-phase PDF; phase 1 is not blocked.)
10. The third-party license file is updated to include VexFlow (MIT) and the bundled music font license.

---

## Test plan

### Renderer fixtures (R1, R2)

- **Bundle-size check.** After `pnpm build`, assert the notation-related chunk adds ≤ 600 KB compressed.
- **Single-measure render timing.** Render a trivial 4/4 single-measure score 100 times; assert median render time ≤ 50 ms.
- **Measure-level invalidation.** Mount a 200-measure score, edit one note, assert only the edited measure's SVG group is re-mounted (via a test-only render counter stubbed into the renderer).
- **Viewport virtualization.** Scroll through a 200-measure score; at any time the DOM contains ≤ 12 measure SVG groups.

### Quantization fixtures (R3)

Fixtures are stored as JSON files under `src/modules/Notation/__tests__/fixtures/quantization/`:

- **Grid baseline** (eight slightly-off quarter notes → eight clean quarters).
- **Triplet detection** (three 160-tick notes → triplet group).
- **Swing detection** (alternating long/short eighths → straight eighths + swing flag).
- **Rest insertion** (gap mid-bar → correct rest sequence, never mid-bar-spanning).
- **Beam grouping in 4/4** (eight eighths → two groups of four; never one of eight).
- **Tie across bar line** (half note spanning bars → two tied halves).
- **Non-destructive invariant** — hash MIDI before and after quantization, assert identical.

### Cross-backend parity (R15)

For each quantization fixture, run it through both the Rust command and the TypeScript browser fallback; assert byte-identical descriptor output. Fixture drift between the two backends fails this test.

### MusicXML round-trip fixtures (R4, R5, R11)

- **Canonical fixture** (R4): 16 bars, key of G, 4/4, title, tempo, two voices, one triplet, one tied note, one dynamic.
- **Multi-voice fixture**: two simultaneous voices on one staff; asserts unique voice numbers per staff on export and correct voice separation on import.
- **Grand staff fixture**: two staves, voices 1–2 on staff 1 and 3–4 on staff 2; asserts no cross-staff chord collisions when reimported into Dorico.
- **Engraved elements fixture** (R11): slur, manual tie, staccato, tenuto, accent, marcato, three dynamics, crescendo hairpin, lyrics.

For each fixture: export to MusicXML → assert schema validity → (manual) open in MuseScore and Dorico, verify visual and structural correctness → import back into Sourdaw, assert the MIDI model matches the original.

### Dual-representation edit test (R6)

- Edit a note's pitch in the notation view; assert the MIDI event pitch updates; assert playback plays the new pitch.
- Edit a note's pitch in the piano roll; assert the notation view updates on next render.
- Undo/redo symmetry on both edits.
- Add a staccato in notation; assert MIDI note duration and velocity are unchanged.

### Selection sync test (R7)

- Click note in notation → assert highlighted in piano roll.
- Range-select five notes in piano roll → assert same five highlighted in notation.
- Escape clears selection in both.

### Playback cursor test (R8)

- Start playback at 120 BPM; assert cursor advances horizontally at ≥ 55 fps via `requestAnimationFrame` sampling.
- Reach 75% viewport width in scrolling mode; assert auto-scroll engages.
- Reach end of page in paged mode; assert view flips to next page, no mid-page scrolling.

### Grand staff and multi-voice tests (R9)

- Fixture G, H, I — see R9 acceptance criteria.

### Stem direction tests (R10)

- Fixture J, K — see R10 acceptance criteria.

### Tuplet, transposition, enharmonic tests (R12)

- Fixture M (triplet render), N (transposing instrument), O (key-context spelling default), P (manual respell).

### Scrolling/page toggle test (R13)

- Toggle between modes; assert layout changes; assert playhead position is preserved across the toggle.

### Print / PDF test (R14)

- Invoke print on a multi-page score; assert print preview shows correct page count, no clipped systems, page numbers on each page.
- Save as PDF; open in a standard viewer; visually compare to the print preview.

### Chord symbol tests (R16)

- Fixture Q (add chord symbol), R (export/reimport chord symbols).

### Architectural validation

- `pnpm deps:validate` after notation module changes: zero violations.
- `pnpm typecheck`: zero errors.
- Verify notation module does not `export type` use-case types to other modules (per `AGENTS.md` "Use-case types stay private").
- Verify notation module's `handlers/`, `models/`, `repositories/`, `engine/`, `transformers/`, `services/`, `presentations/hooks/`, and `presentations/components/` are not imported from any other module.
- Verify no `forwardRef`, `useMemo`, `useCallback`, or `React.memo` usages in the notation module (ESLint rule).

---
## Implementation notes

- **Phasing:** Build order follows the research's phased roadmap — renderer + grid quantization first (R1, R2, R3 baseline, R6), then MusicXML export (R4), then DP/HMM quantization refinement (R3 phase 2), then import (R5) and engraved elements (R11), then chord symbols and print (R14, R16). R17 (tab) is phase-2 candidate, not phase-1 blocker.
- **Rust quantization command:** `quantize_for_display(midi_notes, meter, tempo, options) -> Vec<DisplayNote>` returns a pure data structure; no Tauri events, no streaming. Browser fallback signature is identical.
- **VexFlow integration:** Render one SVG per measure (for measure-level invalidation). Mount with React 19 refs-as-props pattern. The React Compiler handles memoization — no manual wrapping.
- **MusicXML generation:** Template-literal strings with escaped XML; validate output against `partwise.xsd` before writing. Do not pull in a full XML library — see DD6.
- **Avoid codemods.** Every file change is deliberate per `AGENTS.md`.

## Tradeoffs and risks

- **Trade-off — VexFlow vs OSMD/Verovio:** VexFlow ships smaller and renders faster but has weaker engraving quality than Verovio. Accepted because Sourdaw is explicitly a bridge, not an engraver (see Goal and non-goals).
- **Trade-off — dual representation complexity:** Keeping MIDI + display in sync on every edit doubles the write paths. Mitigated by routing all edits through a single `applyNoteEdit` use case that writes MIDI first and re-projects the display model next frame.
- **Risk — cross-backend drift:** The Rust and TS implementations of `quantize_for_display` must produce byte-identical output (R15, test plan §Cross-backend parity). Any divergence surfaces as user-visible differences between Tauri and browser deployments. Mitigation: shared fixture suite and CI parity check.
- **Risk — MusicXML round-trip loss:** MuseScore and Dorico interpret edge cases differently (voice numbering, tied chords, cross-staff beams). Mitigation: a frozen fixture set (R4, R5, R11 canonical fixtures) must pass on every release; new edge cases must be added as fixtures before their requirement is considered complete.
- **Risk — Verovio LGPL:** If phase-2 print needs Verovio-quality layout, the LGPL obligation (dynamic linking or re-license) must be resolved before inclusion. Mitigation: phase-1 ships VexFlow-only; Verovio is gated behind [CRITICAL] open question.
