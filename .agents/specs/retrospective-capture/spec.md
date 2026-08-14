---
type: spec
id: SPEC-retrospective-capture
title: Retrospective capture
status: draft
owner: The Sourdaw team
sources:
  - research.md
---

# Retrospective capture

## Intent

Always-on buffering of recent MIDI (and optionally audio) so a performance played before
the user pressed record can be recovered into a clip, with inferred tempo and a
musically-snapped bar length.

## Non-goals

- Full multitrack audio recording (capture is a rolling buffer, not the recorder).
- Cloud or cross-session persistence of the capture buffer (it is volatile, per-session).
- Beat-grid editing UI and warp markers on the captured clip.
- Audio-domain MIDI transcription of the captured audio.
- Time-signature inference — default 4/4; no DAW currently auto-detects it, and we do not attempt it.
- Automatic note quantisation on captured material — Ableton avoids it, and we follow suit.
- Audio capture beyond the selected input bus — no track-output, bus-mix, or master-bus capture in v1.

## Requirements

### AC-001 — No audio-thread locks

The capture writer must push events from the realtime thread with no mutex acquisition and
no heap allocation.

Verify with: `pnpm cargo:test -- -p daw-engine capture_assert_no_alloc`

### AC-002 — Consistent buffer snapshot

A consumer reading the buffer during active writing must observe a consistent prefix of
events with no torn or duplicated entries.

Verify with: `pnpm cargo:test -- -p daw-engine capture_snapshot_consistency`

### AC-003 — Orphaned note recovery

A capture window beginning mid-note must produce a clip with no hung notes — every emitted
note-on must have a matching note-off.

Verify with: `pnpm cargo:test -- -p daw-engine capture_orphan_notes`

### AC-004 — Tempo inference

Extracting a free performance must produce a tempo hypothesis from the inter-onset-interval
distribution, falling back to project tempo below a confidence threshold.

Verify with: `pnpm cargo:test -- -p daw-engine capture_tempo_inference`

### AC-005 — Power-of-two bar snapping

The extracted clip length must snap to the nearest power-of-two bar count under the
inferred tempo.

Verify with: `pnpm cargo:test -- -p daw-engine capture_bar_snap`

### AC-006 — Bounded buffer

The ring buffer must never grow beyond its configured capacity — the oldest events are
overwritten once full.

Verify with: `pnpm cargo:test -- -p daw-engine capture_ring_bounded`

### AC-007 — Capture module isolation

The capture feature must not import internals of other modules.

Verify with: `pnpm deps:validate`

### AC-008 — Tempo-inference valid range with octave folding

Inferred tempo must be reported only within 80–160 BPM, folding out-of-range estimates by
doubling or halving until in range (e.g. a 70 BPM performance is reported as 140 BPM).

Verify with: `pnpm cargo:test -- -p daw-engine capture_tempo_octave_fold`

### AC-009 — User-configurable capture window

The capture command must accept a user-selected window — `Last 30 seconds`, `Last 60
seconds`, `Last 8 bars`, `Last 4 bars`, `Last loop iteration`, or a custom value — resolving
bar windows against the project-or-inferred tempo and second windows directly.

Verify with: `pnpm cargo:test -- -p daw-engine capture_window_resolution`

### AC-010 — Power-of-two bar-snap ratio rule

Clip length must snap among 1, 2, 4, 8, 16 bars by the rule: snap to a candidate if `0.875 ×
candidate ≤ span ≤ 1.25 × candidate`, else snap to the next-larger candidate, with ties
resolving upward — verified by the cases 7.8→8, 3.1→4, 2.25→2, 5.0→8.

Verify with: `pnpm cargo:test -- -p daw-engine capture_bar_snap_ratio`

### AC-011 — Audio ring-buffer safety margin

A capture spanning more than `capacity − margin_frames` (a 2–3 s margin) must be flagged
PARTIAL and truncated to the valid region rather than returning corrupted data.

Verify with: `pnpm cargo:test -- -p daw-engine capture_audio_safety_margin`

### AC-012 — MIDI FIFO sizing and batch eviction

The MIDI ring buffer must hold 16,384 events and, when full, batch-evict the oldest 1,024
events at once, with a 128×16 active-note table plus sustain-pedal CC#64 state driving
orphaned-note recovery.

Verify with: `pnpm cargo:test -- -p daw-engine capture_midi_fifo_eviction`

### AC-013 — Non-RT snapshot pipeline on a dedicated worker thread

The snapshot pipeline must run on a dedicated `std::thread::spawn` worker thread (not Tokio),
producing zero audio xruns under a 64-sample / 10-track stress capture and no MIDI-callback
p99.9 latency regression beyond 5% versus a non-capture baseline.

Verify with: `pnpm cargo:test -- -p daw-engine capture_worker_xrun_free`

### AC-014 — Captured-audio file persistence

Captured audio clips must reference WAV files at `captures/<iso-timestamp>-<short-id>.wav`.

Verify with: `pnpm test:run captureMissingAsset`

### AC-015 — Velocity-weighted phrase-start detection

The IOI histogram must weight contributions by note velocity for downbeat / phrase-start
detection (separate from tempo estimation), with optional log-Gaussian autocorrelation
refinement when histogram peaks are within 5% of each other.

Verify with: `pnpm cargo:test -- -p daw-engine capture_velocity_weighted_downbeat`

### AC-016 — Capture button disabled when buffer empty

The Capture button must be disabled with an explanatory tooltip when the ring buffer is
empty — never a silent no-op.

Verify with: `pnpm test:run captureButtonDisabledState`

### AC-017 — Inferred tempo applied to the new clip only

When the transport is stopped and the user has set no tempo, the inferred tempo must be
applied to the newly-created clip only; the project tempo must not be silently changed.

Verify with: `pnpm cargo:test -- -p daw-engine capture_inferred_tempo_clip_scoped`

### AC-018 — Missing-asset handling for captured audio

Deleting the captures directory must surface a missing-asset placeholder rather than crashing.

Verify with: `pnpm test:run captureMissingAsset`

### AC-019 — Clip creation reuses the Arrangement use case

The capture flow must terminate in the existing Arrangement clip-creation use cases — it must not introduce a parallel clip factory or mutate the store directly; if the existing use case does not support the needed input shape it must be extended (or an adjacent use case added in the same module), never bypassed.

Verify with: `pnpm deps:validate`

### AC-020 — Hotkey reuses the existing shortcut registry

The Capture hotkey (default `Shift+C`, see Q-005) must register through the existing keyboard shortcut registry — the feature must not ship a second shortcut system.

Verify with: `pnpm test:run captureHotkeyRegistry`

### AC-021 — Capture confirmation modal

On capture, a confirmation modal must present the detected result and the resolved snap (e.g. "Captured: 7.8 bars @ 118 BPM -> snapped to 8 bars") with `[Accept]`, `[Adjust window]`, and `[Discard]` controls — never a silent placement.

Verify with: `pnpm test:run captureConfirmationModal`

### AC-022 — Clip placement defaults to the edit cursor, overridable via Adjust

A captured clip must be placed at the current edit cursor by default, and that placement must be overridable via the modal's Adjust control.

Verify with: `pnpm test:run captureClipPlacement`

### AC-023 — Typed capture-complete event contract

The `capture-complete` event carrying clip metadata from the worker to the frontend must use a `tauri-specta`-generated typed contract — it must not use a stringly-typed payload.

Verify with: `pnpm test:run captureCompleteEventContract`

## Open questions

- [ ] Q-001 [CRITICAL] — Default audio ring size vs the minimum supported RAM configuration.
      60 s stereo at 48 kHz is ~22 MB (proposed default cap); a 5 min stereo hard maximum is
      ~110 MB; 5 min + 8 channels reaches ~880 MB per the research. Need decisions on the
      default cap, the hard maximum exposed in settings, and low-RAM behavior (detect, warn,
      auto-downgrade?). Blocks AC-011.
- [ ] Q-002 [MAJOR] — Confidence threshold below which inferred tempo is discarded for project
      tempo (see AC-004); also the capture policy when the window contains silence / no events
      (warn-and-extend, capture-anyway, or disable Capture below a content threshold).
- [ ] Q-003 [MAJOR] — Does always-on audio capture share the MIDI buffer lifecycle or stay
      opt-in per track? Includes whether the existing retroactive punch recording already owns
      a MIDI input FIFO that AC-012's ring should extend rather than duplicate.
- [ ] Q-004 [MINOR] — Multi-input audio capture for v2: keep the ring-buffer API from
      foreclosing it even though it is a v1 non-goal.
- [ ] Q-005 [MINOR] — Capture-hotkey default (`Shift+C` placeholder) — confirm no collision
      with existing bindings.
- [ ] Q-006 [MINOR] — "Capture and keep buffering" vs. "Capture and flush" affordance for
      rapidly capturing several takes without bleed between windows.

## Affected areas

- the Rust audio engine (`daw-engine`): SPSC ring buffer, atomic write head, locked memory
- the tempo-inference service (IOI histogram, bar snapping)
- `src/modules/Arrangement/` clip-extraction use case (consumer)
- the Tauri command surface for "capture last performance"

## Dropped from sources

- Always-on audio capture — deferred behind Q-003; MIDI capture ships first.
- Cross-session buffer persistence — the buffer is intentionally volatile.
- Warp/beat-grid editing of the captured clip — separate editing-surface scope.
- Tradeoffs and risks (informative) — the original `specs/missing/retrospective-capture.md`
  named six risks. They are recorded here as informative context, not as fresh requirements;
  where a risk encodes a testable threshold, that behavior is already pinned by an AC above:
    - **Memory footprint** — a default config holds ~22 MB audio + ~1 MB MIDI + ~20 KB note
      table ≈ 23 MB resident per session; the final numbers are gated by Q-001 [CRITICAL].
    - **Tempo-inference false confidence** — rubato or strong syncopation yields no clear
      histogram peak; the ≥ 16-note threshold and the "no confident answer" path (AC-004) must
      be wired end-to-end so users never ship clips at nonsense tempos.
    - **Orphaned-note edge cases** — a note held across a 16,384-event eviction is the worst
      case (AC-003, AC-012); bugs here produce loud stuck notes, so coverage is over-invested.
    - **Safety-margin mis-tuning** — too tight truncates captures under load, too loose shrinks
      the usable window; the 2–3 s margin (AC-011) should be measured on target hardware, not
      guessed.
    - **Worker-thread backpressure** — if the worker drain loop falls behind, its authoritative
      copy drifts from the live ring (AC-013); the ~10 ms poll interval and secondary-buffer
      size need explicit sizing.
    - **Feature-adoption risk** — a slow, unreliable, or wrong-tempo Capture gets disabled once
      and never retried; the correctness bar is higher than for opt-in features.
