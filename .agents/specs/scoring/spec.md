---
type: spec
id: SPEC-scoring
title: Video scoring
status: draft
owner: The Sourdaw team
sources:
  - research.md
---

# Video scoring

## Intent

Score to picture: load a video, make it the transport master, lock the audio engine to it
via SMPTE timecode and a phase-locked loop, place hit-point markers, and export a muxed
video with the final mix.

## Non-goals

- Video editing (cuts, transitions, colour) — picture is a fixed reference.
- Multi-camera / multi-clip video timelines.
- Real-time video effects or compositing.
- Subtitle / caption authoring.
- **Superclock / sample-rate-independent internal time base** (e.g., Ardour's
  508,032,000-per-second unit, Meadowlark's 282,240,000) — an explicit v1 non-goal. v1
  stores time as `u64` sample positions at the project sample rate. See
  `## Design decisions → Internal time base (Superclock deferred)` for the rationale and
  migration path.

## Requirements

### AC-001 — Audio-mastered transport with video slaved by playbackRate

While scoring, the Rust CPAL audio thread must be the transport master clock and the
`<video>` element must slave to it, with `playbackRate` micro-adjustments locking picture
to the audio playhead.

Verify with: `manual` — play A/V; the video frame tracks the audio playhead frame-accurately

### AC-002 — Exact SMPTE math

Timecode conversion (including 29.97 drop-frame) must use exact rational arithmetic with
zero accumulated drift over a 1-hour timeline.

Verify with: `pnpm cargo:test -- -p daw-core smpte_timecode`

### AC-003 — PLL keeps long-form sync

Over a 10-minute playback the audio must stay locked to the video within one frame, with
no audible pitch jump from rate correction.

Verify with: `manual` — play 10 min A/V; confirm lock at the end and no pitch artefacts

### AC-004 — Audio extraction

Loading a video with an audio track must extract that audio into an aligned clip on a
dedicated reference track.

Verify with: `pnpm cargo:test -- -p daw-io video_audio_extract`

### AC-005 — Scene-marker seeding

Running scene detection must place hit-point markers at detected cuts that the user can
then move or delete.

Verify with: `manual` — run detection on a multi-cut clip; markers land at cuts

### AC-008 — PLL steady-state engineering target (±10 ms)

Once the PLL has converged (after the 1–3 s pre-roll), measured drift between
`audioPlayheadSecs` and the `<video>` `requestVideoFrameCallback` `metadata.mediaTime`
must stay within **±10 ms** for at least 95% of sampled frames during a 10-minute
continuous playback run at 48 kHz / 29.97 fps. This is the engineering target the control
loop must achieve when stable; it is a distinct criterion from the release gate (AC-009)
and must not be silently loosened to the ±40 ms gate value. Measurement is by an automated
harness that records `{audioPlayheadSecs, metadata.mediaTime, drift}` per frame callback and
computes the distribution.

Verify with: `pnpm test:run scoring/pll-drift-harness` — 10-min 48 kHz / 29.97 fps run; assert ≥95% of post-convergence samples within ±10 ms

### AC-009 — PLL release gate, cumulative drift (±40 ms hard ceiling)

Across a 10-minute continuous playback run, measured drift between the audio playhead and
the video `metadata.mediaTime` must **never exceed ±40 ms (±1 frame at 25 fps, the lowest
supported frame rate)** at any frame callback. This is a hard ceiling: a single sample
outside ±40 ms fails the gate. The ±40 ms gate exists alongside the ±10 ms engineering
target (AC-008) precisely because correct convergent PLL behavior may legitimately excurse
into the 10–300 ms medium-drift correction zone (after a dropped frame, GC pause, tab
throttling, or codec reseek) before re-converging; gating on ±10 ms for the whole window
would wrongly fail correct behavior, while a never-locking implementation running at a
steady ±35 ms must fail — which AC-008 enforces.

Verify with: `pnpm test:run scoring/pll-drift-harness` — same 10-min run; assert no sample exceeds ±40 ms

### AC-010 — Scene-marker typing, absolute-time lock, and detector tolerances

Scene-detection markers must be typed as `SceneMarker`, a type **distinct** from standard
(tempo-relative) markers and from SMPTE-locked markers, and must be **absolute-time locked**
so that they are unaffected by tempo-map edits. The detector must, given the fixture
`tests/fixtures/video/scene-cuts-10.mp4` (10 labelled cuts at known timestamps), return
**exactly 10** markers; each marker timestamp must fall within **±0.5 s** of the labelled
ground truth (half a second, to accommodate detector-vs-ground-truth alignment on faded
cuts), and **hard cuts must match within ±1 frame at the source video frame rate**. Cut
timestamps are expressed in project seconds, derived from the video's PTS and the project
SMPTE offset.

Verify with: `pnpm cargo:test -- -p daw-io scene_cut_detector_fixture` — feed `tests/fixtures/video/scene-cuts-10.mp4`; assert exactly 10 `SceneMarker` entries, each within ±0.5 s (±1 frame for hard cuts) of ground truth

### AC-006 — Muxed export

Exporting must mux the final stereo mix with the source video into a single playable file.

Verify with: `pnpm cargo:test -- -p daw-io video_export_mux`

### AC-007 — Scoring module isolation

The scoring feature must not import internals of other modules.

Verify with: `pnpm deps:validate`

## Design decisions

### Sync drift target (engineering target vs release gate)

**Chosen:** A two-tier criterion — an **engineering target of ±10 ms steady-state** (the
PLL must converge to and hold within ±10 ms once locked, per AC-008) and a **release gate
of ±40 ms (±1 frame at 25 fps) cumulative drift over a 10-minute window** (a hard ceiling,
per AC-009).

**Considered:** A single ±10 ms criterion over the full 10-minute window, as implied by the
research's "±10 ms class accuracy" figure.

**Justification:** The research's ±10 ms figure describes the PLL's steady-state convergence
band (the `<10 ms` branch of the three-tier correction algorithm), not a guaranteed long-run
envelope. Over 10 minutes the `<video>` element may legitimately cross into the 10–300 ms
"medium drift" correction zone (after a dropped frame, GC pause, tab throttling, or codec
reseek), and the PLL is designed to allow excursions up to ~300 ms before re-converging.
Gating release on ±10 ms for the entire window would fail the product on correct, convergent
behavior. We therefore keep ±10 ms as the engineering target the control loop must achieve
when stable, and use ±40 ms (one frame at the lowest supported frame rate, 25 fps) as the
release gate — a guaranteed maximum the system never exceeds. This matches the ±1-frame
tolerance Logic Pro, Cubase, and Pro Tools target for professional scoring. The ±10 ms
target must **not** be silently loosened to 40 ms; it is preserved as the distinct
criterion AC-008.

**Rejected:** Accepting 40 ms only, with no engineering target — this would let an
implementation that never actually locks the PLL (e.g., permanently running at ±35 ms) pass
release, defeating the purpose of the PLL architecture. AC-008 prevents this.

### Internal time base (Superclock deferred)

**Chosen:** v1 uses `u64` sample positions at the project sample rate as the canonical
internal time base. Superclock (a sample-rate-independent integer base unit, e.g., Ardour's
508,032,000-per-second, Meadowlark's 282,240,000) is an explicit non-goal for v1.

**Justification:** Superclock only pays off when the project sample rate changes mid-session
or when losslessly interchanging sessions across sample rates. v1 fixes the project sample
rate at load time, so sample-position time is already exact. Introducing Superclock now would
require touching every time-bearing type (clips, automation, markers, tempo map, timecode),
which is disproportionate to the v1 scope.

**Forward pointer / migration path:** When sample-rate-agnostic time becomes a requirement
(session interchange, runtime sample-rate switching, or hi-res SMPTE offsets per
Ardour/Meadowlark precedent), file a dedicated spec. The migration path is: (a) introduce a
`SuperclockTicks` newtype in `daw-core`; (b) convert `sample -> ticks` at the I/O boundary;
(c) store ticks in the project model; (d) convert back to samples at the audio-thread
boundary. The `smpte_seconds = sample_position / sample_rate` invariant must be preserved
under the new unit.

## Open questions

- [ ] Q-001 — FFmpeg licensing: which build (LGPL vs GPL) is shippable, bundled or
  system-resolved? Blocks extraction/export.
- [ ] Q-002 — PLL correction window / max rate deviation before audible artefacts.
- [ ] Q-003 — Scene-detection default threshold and whether it ships on by default.

## Affected areas

- `src/modules/Scoring/` (new view, video element, marker track)
- `daw-core` SMPTE timecode types (rational)
- `daw-io` FFmpeg extraction + export path
- the transport subsystem (master-source switching)

## Dropped from sources

- Video editing / multi-clip video timelines — picture is a fixed reference, not editable.
- Real-time video effects and compositing — out of scope.
- Subtitle authoring — unrelated workstream.

### Corrected: master-clock direction (was inverted)

A prior revision of AC-001 read "the video element must be the transport master and the
audio engine must slave to its reported time." That inverted the source. The original
research (`research/factory/active/scoring.md`, restored verbatim in `research.md`) states
twice — its opening bold thesis and its conclusion — that **the Rust CPAL audio thread is
the master clock and the `<video>` element is the slave**, locked via `playbackRate`
micro-adjustments in a PLL. AC-001 has been corrected to the original intent.
