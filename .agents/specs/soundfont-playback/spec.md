---
type: spec
id: SPEC-soundfont-playback
title: SoundFont (.sf2) playback
status: draft
owner: The Sourdaw team
sources:
  - intake/implementation-gaps.md
---

# SoundFont (.sf2) playback

## Intent

Add `.sf2` SoundFont playback as an instrument source: a `SoundFontInstrument` node, a
content-browser index of `.sf2` presets (bank/program), and drag-and-drop from the
browser onto a MIDI track to instantiate the instrument pre-configured with the dragged
preset.

## Non-goals

- SFZ format support (a different format; see existing `sample-player-sfz`).
- The unified sampler suite (see existing `unified-sampler-suite`).
- General content-browser intelligence (deferred gaps against `sample-library`).

## Requirements

### AC-001 — SoundFont instrument node

A `SoundFontInstrument` node (via `rustysynth`) must play `.sf2` content; a C-major
scale through the reference SoundFont produces per-note fundamentals within ±1 cent.

Verify with: `pnpm cargo:test -- -p daw-dsp soundfont_pitch_accuracy`

### AC-002 — Bank/program change switches presets

Bank/program-change messages must switch presets within ≤1 block without glitching held
voices.

Verify with: `pnpm cargo:test -- -p daw-dsp soundfont_program_change`

### AC-003 — Browser indexes .sf2 presets

The content system must index `.sf2` files and list their bank/program presets in the
instrument picker.

Verify with: `pnpm test:run -- soundfontBrowserIndex`

### AC-004 — Drag-to-instantiate from the browser

Dragging a `.sf2` preset onto a MIDI track must instantiate a `SoundFontInstrument`
pre-configured with that preset.

Verify with: `manual` — drag a GeneralUser GS preset onto a MIDI track and confirm it plays

### AC-005 — Large SoundFonts stream from disk

`.sf2` files larger than a quarter of available RAM must stream from disk rather than
fully load.

Verify with: `pnpm cargo:test -- -p daw-dsp soundfont_streaming`

## Open questions

- [ ] (non-blocking) Whether the node lives in `daw-dsp` or a dedicated crate. Default:
  `daw-dsp`.

## Affected areas

- `crates/daw-dsp/` (SoundFontInstrument via rustysynth)
- content browser indexing and instrument picker

## Dropped from sources

- None — this spec scopes the §7.8 SoundFont items directly.
