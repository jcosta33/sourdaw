---
type: spec
id: SPEC-elastic-audio
title: Elastic audio — transient-aware time stretch
status: draft
owner: The Sourdaw team
sources:
  - .agents/specs/elastic-audio/
---

# Elastic audio — transient-aware time stretch

## Intent

Detect transients in an audio clip, place warp markers at them, and let a user
quantize, nudge, or hand-edit those markers so the clip's timing snaps to the
project grid while existing time-stretch DSP follows the markers.

## Non-goals

- New time-stretch DSP; this drives the existing stretch engine via markers.
- Polyphonic note-level pitch editing (that is the Knead/pitch-correction
  domain).
- Automatic tempo detection of the source clip in v1.

## Requirements

### AC-001 — Marker mutations are undoable actions

Detecting, quantizing, nudging, adding, and removing warp markers must each be
reachable through an `AppAction` handler with undo/redo.

Verify with: `pnpm test:run -- elasticAudioHandlers`

### AC-002 — Transient detection places markers at onsets

Running detection on a clip must place warp markers at detected onsets using a
spectral-flux algorithm above the sensitivity threshold.

Verify with: `pnpm cargo:test -- -p daw-dsp transient::spectral_flux_detect`

### AC-003 — A warp marker records its origin and confidence

Each `WarpMarker` must carry an `origin` (detected, manual, quantized) and a
`confidence` value so the UI can distinguish marker provenance.

Verify with: `pnpm test:run -- warpMarkerModel`

### AC-004 — Quantize snaps markers to the grid

Quantizing must move each detected marker to the nearest grid division at the
current strength, preserving inter-marker stretch ratios elsewhere.

Verify with: `pnpm cargo:test -- -p daw-dsp transient::quantize_to_grid`

### AC-005 — A sensitivity slider changes detected marker count

Adjusting the sensitivity slider must re-run detection and change the number of
markers monotonically with the threshold.

Verify with: `manual` — drag the sensitivity slider, confirm markers increase as sensitivity rises

### AC-006 — Markers round-trip through the project file

Saving and reloading a project must restore every warp marker's position,
origin, and confidence unchanged.

Verify with: `pnpm test:run -- elasticAudioPersistence`

### AC-007 — The Elastic tab renders markers over the waveform

The clip editor must show an Elastic tab with the waveform and color-coded
markers (detected vs manual vs quantized) that can be dragged.

Verify with: `manual` — open the Elastic tab, detect transients, drag a marker, confirm the stretch follows

### AC-008 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-009 — Quantize auto-switches stretch mode to timestretch

Quantizing a clip whose `stretchMode` is `'off'` must switch it to
`'timestretch'`.

Verify with: `pnpm test:run -- quantizeTransients` — assert `stretchMode` flips from `off` to `timestretch`

### AC-010 — Re-detection preserves user and grid-snap markers

Re-running detection at a new sensitivity must recompute only
`origin: 'transient-auto'` markers, leaving `origin: 'user'` and
`origin: 'grid-snap'` markers untouched.

Verify with: `pnpm test:run -- detectTransientsForClip` — rerun with different sensitivity and assert `transient-auto` markers replaced while `user`/`grid-snap` markers preserved

### AC-011 — Keyboard shortcuts and Command Palette entries control the workflow

The Elastic workflow must expose keyboard shortcuts (`T` transient tool, `G`
quantize, `Delete` remove selected) and Command Palette entries (`Elastic:
Detect Transients`, `Elastic: Open Editor for Selected Clip`, `Elastic:
Quantize Selected Clip`).

Verify with: `manual` — press T/G/Delete in the editor and run each Elastic command from the palette, confirm each fires

### AC-012 — Last-used sensitivity persists as a user preference

The last-used detection sensitivity must persist as a user preference at
`userSettings.elasticAudio.defaultSensitivity` and seed a fresh detect on a new
clip.

Verify with: `pnpm test:run -- elasticAudioPreferences` — set sensitivity, reload, assert a new clip's first detect uses the saved value

### AC-013 — The Elastic tab is visible only for audio clips

The Elastic bottom-panel tab must appear only when the selected clip is audio
and must be hidden for non-audio clips.

Verify with: `manual` — select an audio clip (tab shows), select a MIDI clip (tab hidden)

### AC-014 — Detection runs off the main thread

Transient detection must run in a dedicated worker without blocking the main
thread.

Verify with: `pnpm test:run -- detectTransientsPerf` — detect on a 120 s fixture clip and assert completion under 1 s off the main thread

### AC-015 — Detection meets the performance budget

A 120-second clip must finish transient detection in under 1 second.

Verify with: `pnpm test:run -- detectTransientsPerf` — detect on a 120 s fixture clip and assert completion under 1 s off the main thread

### AC-016 — Quantize auto-selects a transient-preserving stretch algorithm

When Quantize runs, the clip's stretch algorithm must auto-switch to a
transient-preserving algorithm (WSOLA or equivalent) so quantized hits are not
smeared. The concrete algorithm choice must be defined in
`getAlgorithmInfo.ts`.

Verify with: `pnpm test:run -- quantizeTransients` — assert the clip's algorithm is set to the transient-preserving choice after quantize

### AC-017 — Quantize is unavailable when the clip has no intrinsic tempo

A one-shot clip with no intrinsic tempo must use a 120 BPM placeholder for
beat conversion and must not offer Quantize; the UI must disable the Quantize
control for such clips.

Verify with: `manual` — select a one-shot clip with no tempo, confirm the Quantize control is disabled

### AC-018 — Marker drag edits targetBeat, with modifier overrides

Dragging a marker must move its `targetBeat` (not `localBeat`); Alt-drag must
move `localBeat` instead (advanced — relocates where the transient is); and
Ctrl-drag must snap to the current grid division.

Verify with: `manual` — drag a marker (targetBeat moves), Alt-drag (localBeat moves), Ctrl-drag (snaps to grid)

### AC-019 — The Elastic toolbar offers a per-clip stretch-mode dropdown

The Elastic toolbar must expose a stretch-mode dropdown letting the user pick
`repitch` or `timestretch` for the clip manually, independent of the
Quantize auto-switch.

Verify with: `manual` — open the Elastic toolbar, switch the stretch-mode dropdown between repitch and timestretch, confirm the clip's `stretchMode` updates

## Known risks

- Stereo handling — detection runs on the mono downmix and the resulting
  markers apply to both channels (v1 design constraint per the detection
  pipeline). A stereo-sensitive onset detector is deferred.
- Clip rendering invalidation — adding or changing a warp marker invalidates
  the track's freeze state; the existing `freezeState: 'stale'` mechanism in
  `initStalenessDetection.ts` already triggers on warp-marker change, so no new
  invalidation wiring is needed.

## Open questions

- [ ] (non-blocking) Should detection cap the marker count for very dense
  material to avoid a "marker explosion", or rely on the sensitivity slider?
- [ ] (non-blocking) (restored detail) When the source clip's tempo is unknown,
  v1 uses a 120 BPM placeholder and disables Quantize (see AC-017); a later
  tempo-guess pass that re-enables Quantize for one-shots is open.
- [ ] (non-blocking) (deferred-gap from intake/full-spec.md) AI warp mode
  auto-detection: analyze audio content and auto-select the optimal warp mode
  from the app's canonical warp family (`repitch` today; the in-house
  `phase-vocoder` and `wsola` once the engine lands — `getAlgorithmInfo.ts`),
  which users currently pick by hand. Classification targets map material class
  (percussive, monophonic, polyphonic, textural) to the most suitable stretch
  algorithm. Implementation guidance: a new
  `src/modules/Arrangement/useCases/audioWarp/autoDetectWarpMode.ts` using pure
  DSP spectral analysis (spectral centroid variance, onset density,
  harmonic-to-noise ratio) to classify material type — no ML model needed; the
  result feeds the existing `setWarpAlgorithm.ts` use case. Run analysis on a
  short 2–4 second segment when audio is first imported or when the user enables
  warping, and surface the detected mode as a suggestion the user can accept or
  override. Note this lives in the Arrangement module's warp-mode selection,
  separate from this spec's transient-marker workflow.

## Affected areas

- `src/modules/Clip/useCases/elasticAudio/`
- `src/modules/Clip/models/WarpMarker.ts`
- `crates/daw-dsp/src/transient/` (onset detection, quantize)
- `src/modules/ClipEditor/presentations/views/Elastic/`

## Dropped from sources

- Automatic source-tempo detection — deferred; v1 quantizes against the project
  grid only.
- Per-marker stretch-algorithm selection (e.g. a different stretch algorithm per marker) —
  uses the existing engine's single algorithm.
- A marker-count safety cap — captured as an open question, not a v1 requirement.
