---
name: midi-coordinate-convention
description: MidiNote.startBeat uses clip-relative in some paths and timeline-absolute in others — causes empty clips when startBeat > 0.
type: audit
status: open
last_verified: '2026-04-20'
---

# MIDI Note Coordinate Convention

## Scope

Every code path that reads or writes `MidiNote.startBeat`. Covers M-01, M-02, T-01 (remaining), S-08, S-09 from the original consolidated audit.

## Goal

One convention for `MidiNote.startBeat` across the entire codebase. Notes visible in both timeline preview and piano roll regardless of `clip.startBeat`.

## Relevant code paths

| File | Convention | Line | Formula |
|------|-----------|------|---------|
| `clipDrawing.ts` | Clip-relative | 386 | `relStart = (note.startBeat - midiOffset) - clip.startBeat + loopOffset` |
| `renderOffline.ts` | **Correct for clip-relative** | 97 | `noteStart = (clip.startBeat - startBeat + note.startBeat) / tempo * 60` — adds clip offset from render start + note offset within clip |
| `duplicateClipCore.ts` | **WRONG** — adds clip delta to clip-relative notes | 42 | `startBeat: note.startBeat + beatDelta` — should be `note.startBeat` (notes are already clip-relative) |
| `usePianoRollRenderer.ts` | Clip-relative | 526 | `x = note.startBeat * beatWidth` |
| `usePianoRollInteractions.ts` | Clip-relative | 435-469 | `beat = snap(x / beatWidth)` |
| `applyMelodyToTrack.ts` | Timeline-absolute | 42 | `startBeat: startBeat + note.startBeat` |
| `applyChordProgressionToTrack.ts` | Timeline-absolute | 44 | `startBeat: startBeat + note.startBeat` |
| `applyDrumPatternToTrack.ts` | Timeline-absolute | 38 | `startBeat: startBeat + note.startBeat` |
| `PatternBrowser.tsx` | Clip-relative | 301 | `startBeat: note.startBeat` (template-local) |
| `scheduleMidiNotes.ts` | Expects clip-relative | 388 | `rawStartBeat = clip.startBeat + iterOffset + (note.startBeat - midiOffset)` — adds `clip.startBeat` to convert |
| `importMidiFile.ts` | Masks issue | 52 | Forces `clip.startBeat = 0` |

## Current behavior

The piano roll, pattern browser, MIDI import, offline render, and the standard playback scheduler all use **clip-relative** beats (0 = start of clip). The outliers are:

- The 3 AI apply functions (`applyMelodyToTrack`, `applyChordProgressionToTrack`, `applyDrumPatternToTrack`) which store timeline-absolute beats
- `duplicateClipCore` which converts clip-relative notes to timeline-absolute on duplicate by adding `beatDelta`

When `clip.startBeat = 0`, both conventions produce the same result — which is why the bug only surfaces when the playhead is at a non-zero position.

## Findings

- **Clip-relative is the majority convention.** Piano roll editing, pattern insert, MIDI import, the standard scheduler, and `renderOffline` all treat `startBeat` as clip-relative. The outliers are: AI apply functions (3 files) and `duplicateClipCore`.
- **renderOffline is actually correct.** The formula `(clip.startBeat - startBeat + note.startBeat)` computes (clip offset from render start) + (note offset within clip) — this works correctly for clip-relative notes. No change needed.
- **The scheduler already expects clip-relative.** `scheduleMidiNotes.ts:388` computes `clip.startBeat + iterOffset + (note.startBeat - midiOffset)` — it adds `clip.startBeat` to convert from clip-relative to timeline-absolute at playback time.
- **All utility files are already compatible.** Verified: `arpeggiator.ts`, `pasteNotes.ts`, `legatoNotes.ts`, `splitNoteAtBeat.ts`, `quantizeNotes.ts`, `humanizeNotes.ts`, `retrogradeNotes.ts`, `applyGroove.ts`, `extractGroove.ts` — all operate within one clip's coordinate space or are convention-agnostic. **0 utility files need changes.**
- **Migration scope:** 4 files need changes + a data migration for existing projects that have AI-generated notes stored as absolute.

## Open issues

### 1. MidiNote.startBeat dual convention (M-01)

**Problem:** Half the codebase stores clip-relative, half stores timeline-absolute.

**Needed:**
1. Standardize on **clip-relative** (the majority convention).
2. Fix `applyMelodyToTrack.ts:42` — change `startBeat: startBeat + note.startBeat` to `startBeat: note.startBeat`.
3. Fix `applyChordProgressionToTrack.ts:44` — same change.
4. Fix `applyDrumPatternToTrack.ts:38` — same change.
5. Fix `duplicateClipCore.ts:42` — change `startBeat: note.startBeat + beatDelta` to `startBeat: note.startBeat` (notes are clip-relative; the clip's `startBeat` carries the offset; the scheduler adds `clip.startBeat + note.startBeat` at playback).
6. ~~renderOffline.ts~~ — **no change needed**. Formula is correct for clip-relative notes.
7. Write a data migration that detects absolute-stored notes and converts them.
8. Add test: clip at `startBeat = 8`, single note at beat 0 (clip-relative), assert visible in both timeline preview and piano roll.

### 2. PatternBrowser empty clip at playhead > 0 (M-02)

**Blocked on M-01.** PatternBrowser already stores clip-relative — once M-01 lands, this path is correct.

### 3. Fold contract for off-scale notes (S-08, S-09)

**Blocked on M-01.** The fold/scale-lock decision for chord helper notes depends on the coordinate spec. Once M-01 establishes clip-relative, the fold contract can be designed around a known coordinate space.

## Risks

- **Data migration:** Existing projects may have AI-generated notes stored as timeline-absolute. A migration must detect and convert these without corrupting manually-entered clip-relative notes.
- **Scheduler regression:** The standard scheduler already expects clip-relative. Fixing the outlier paths should not break playback, but needs thorough testing.

## Recommendation

Fix the 3 AI apply functions first (one-line each), then `duplicateClipCore`. Write the test before any code change. Data migration last. `renderOffline` needs no change.
