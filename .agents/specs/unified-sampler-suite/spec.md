---
type: spec
id: SPEC-unified-sampler-suite
title: Unified sampler suite
status: draft
owner: The Sourdaw team
sources:
  - research.md
---

# Unified sampler suite

## Intent

Deliver one sampler instrument with Quick, Drum, Slice, and Warp modes over a shared
real-time-safe Rust voice engine, disk streamer, and analyzer — combining Ableton's loading
speed, Logic's auto-analysis, FL's per-slice control, and Bitwig's modulation depth.

## Non-goals

- Transmitting raw audio data through Tauri IPC.
- Memory allocation, disk I/O, or mutex locking on the RT audio thread.
- Proprietary stretch algorithms (Elastique Pro).

## Requirements

### AC-001 — The RT process callback is allocation-free

The `process()` callback must perform no heap allocation during playback, verified by
`assert_no_alloc` in debug builds.

Verify with: `pnpm cargo:test -- -p daw-engine sampler`

### AC-002 — Voice allocation is lock-free

Voice allocation must use the `AtomicU64` bitfield with `trailing_zeros` and
`compare_exchange_weak`, taking no mutex.

Verify with: `pnpm cargo:test -- -p daw-engine voice_allocator`

### AC-003 — Voice stealing follows a fixed priority

When the pool is full, stealing must follow same-note → choke group → releasing → oldest →
quietest.

Verify with: `pnpm cargo:test -- -p daw-engine voice_stealing`

### AC-004 — 128 voices stream from disk without underrun

The engine must play 128 simultaneous disk-streamed voices through per-voice `rtrb` ring
buffers without audible dropouts.

Verify with: `pnpm cargo:test -- -p daw-engine streaming`

### AC-005 — Sample load picks a context-aware mode

Dragging a sample must auto-detect percussive → Drum, loop → Slice, and tonal → Quick.

Verify with: `pnpm test:run -- sampler`

### AC-006 — Root note is detected by YIN

Loading a tonal sample must report the correct root note (an A4 sine resolves to 440 Hz)
using YIN (de Cheveigné & Kawahara, 2002) with parabolic refinement. Detection must use
an absolute threshold of 0.15 (recall-favoring; the paper's 0.1 is higher-accuracy but
misses more), run on a 2048-sample window taken from the sustain portion (skipping the
attack transient, whose pitch is unstable), and average the estimate over 3–5 windows;
frequency resolves as `f0 = sample_rate / τ_refined` and the note as
`midi = 69 + 12·log2(f0 / 440)` rounded to nearest.

Verify with: `pnpm cargo:test -- -p daw-dsp pitch` — an A4 sine resolves to 440 Hz / MIDI 69 with
the 0.15 threshold, 2048-sample sustain window, and 3–5-window averaging applied

### AC-007 — Onset slicing snaps to zero-crossings

A percussive loop must place slice markers at SuperFlux-detected transients snapped to the
nearest zero-crossing.

Verify with: `pnpm cargo:test -- -p daw-dsp onset`

### AC-008 — Round-robin advances sequentially

In Sequential mode, triggering a pad of N variants N+1 times from reset must produce the
sequence S0…S(N-1), S0.

Verify with: `pnpm cargo:test -- -p daw-engine round_robin`

### AC-009 — Overlapping velocity layers crossfade

Overlapping velocity layers must crossfade with equal-power gains summing to approximately
unity at the overlap midpoint.

Verify with: `pnpm cargo:test -- -p daw-engine velocity_layers`

### AC-010 — Parameter changes produce no zipper noise

Changing filter cutoff or stretch ratio during playback must not produce zipper noise or
clicks.

Verify with: `manual` — sweep filter cutoff during playback and confirm no zipper artifacts

### AC-011 — Waveform mipmaps cross IPC as binary

`get_waveform_peaks` must return a binary mipmap payload via `tauri::ipc::Response`, never
JSON-encoded audio.

Verify with: `pnpm test:run -- sampler`

### AC-012 — No cross-module internal imports

This feature must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-013 — Each pad/slice carries 8 independent articulator slots

Each pad/slice must support 8 independent articulator slots (AHDSR/LFO/MSEG/filter/pitch/pan/bitcrush/drive),
pre-allocated per voice with runtime add/remove via the SPSC command queue and no RT-thread allocation.

Verify with: `pnpm cargo:test -- -p daw-engine articulators` — 8-slot pad processes 10,000 note-ons with `assert_no_alloc` reporting zero RT allocations

### AC-014 — Unified mod matrix addresses any source→destination by stable ID

The engine must expose a unified modulation matrix where any `{source, destination}` pairing is
addressable by stable ID, supporting up to 32 active routings per pad/slice; sources include
velocity/aftertouch/CC/LFO/env/MSEG/modX/modY/macro1-8 and destinations include warp ratio,
filter cutoff/Q, grain density, pitch, pan, and round-robin bias.

Verify with: `pnpm cargo:test -- -p daw-engine mod_matrix` — 32 routings evaluate in bounded time/block; adding a 33rd is rejected at config time with a UI error

### AC-015 — Mod X/Y dual-deck equal-power crossfade

Each pad may carry decks A and B with `AtomicF32` modX/modY in `[0,1]` gating an equal-power crossfade,
such that modX 0.0 plays deck A, 1.0 plays deck B, and 0.5 plays both at −3 dB.

Verify with: `pnpm cargo:test -- -p daw-engine mod_xy` — modX 0.0/0.5/1.0 → A / −3 dB both / B within ±0.5 dB

### AC-016 — Flex Speed is a first-class modulation target

The warp ratio (Flex Speed, Logic-style) must be addressable by the modulation matrix at control rate
without triggering allocation or FFT-buffer resize.

Verify with: `pnpm cargo:test -- -p daw-engine flex_speed` — LFO→warp-ratio over 1,000 cycles with `assert_no_alloc` and pre/post FFT-buffer-capacity check

### AC-017 — The RT process() callback follows a fixed 5-step orchestration

The single RT `process()` entry point must execute, in order: (1) drain the SPSC command queue,
(2) drain MIDI and resolve velocity layer → round-robin → stack → voice allocation,
(3) per-voice read → warp → filter → envelope → pan, (4) write metering atomics, (5) signal the disk I/O thread.

Verify with: `pnpm cargo:test -- -p daw-engine process_callback` — full orchestration runs under `assert_no_alloc` in debug builds

### AC-018 — Tauri command surface is the only engine entry point

The frontend must reach the engine only through the enumerated command surface: `load_sample`,
`analyze_onsets`, `set_sampler_mode`, `set_pad_config`, `set_slice_config`, `set_warp_params`,
`set_articulator`, `set_mod_route`, `reset_round_robin`, `start_recording`, `stop_recording`,
and `get_waveform_peaks` (binary `tauri::ipc::Response`), with events `playback_position`,
`voice_activity`, `analysis_complete`, `sample_load_progress`, and `underrun_event`, all typed via `tauri-specta`.

Verify with: `pnpm test:run -- sampler-ipc` — every listed command/event is present and typed with no `any` on the boundary

### AC-019 — Recorder mode supports SP-404 threshold triggering

The engine must support a Recorder mode that captures audio directly into a pad via SP-404-style
threshold triggering, with no audible gaps or clicks at capture start.

Verify with: `pnpm cargo:test -- -p daw-engine recorder` — threshold-triggered capture starts on signal crossing the threshold and joins gaplessly

### AC-020 — Smart loop points auto-detect zero-crossings and crossfade length

Loading or looping a sample must automatically detect zero-crossings and compute a crossfade length
for click-free loops, applying an equal-power sin/cos crossfade at loop boundaries for Forward/PingPong/Reverse modes.

Verify with: `pnpm cargo:test -- -p daw-dsp smart_loop` — detected loop points land on zero-crossings and the boundary crossfade is equal-power

### AC-021 — Critical DSP constants hold their specified values

The engine must define MAX_VOICES=128, PRELOAD_SIZE=12KB, STREAM_BUF_SIZE=64KB, FFT_SIZE_PV=2048,
WSOLA_FRAME=1024, WSOLA_TOLERANCE=256, ENV_TARGET_EXP=0.0001, FADE_STOLEN=1–5ms, and FADE_UNDERRUN=64 samples.

Verify with: `pnpm cargo:test -- -p daw-engine constants` — each constant resolves to its specified value

### AC-022 — Round-robin offers Sequential, Random, and RandomNoRepeat cycle modes

A trigger must support an ordered list of 1–32 variants under three selectable cycle modes — Sequential,
Random (uniform over N), and RandomNoRepeat (uniform over the N−1 excluding the last played) — all allocation-free,
with `reset_round_robin` returning the counter to index 0.

Verify with: `pnpm cargo:test -- -p daw-engine round_robin_modes` — RandomNoRepeat over 1,000 triggers has no adjacent repeats; reset returns to S0; `assert_no_alloc` over 10,000 triggers

### AC-023 — AHDSR is a 6-state, single-multiply machine with three retrigger modes

The envelope must be a 6-state machine (Idle/Attack/Hold/Decay/Sustain/Release) using the
single-multiply iterative exponential (`level = (level − offset) * mult + offset`) with adjustable
`target_ratio` (0.0001 exponential / 1.0+ linear) and three retrigger modes (Legato / RetriggerFromCurrent / HardRetrigger).

Verify with: `pnpm cargo:test -- -p daw-dsp ahdsr` — state transitions, target_ratio curve shape, and each retrigger mode behave as specified

### AC-024 — TPT SVF exposes all six outputs with high-Q oversampling

The Cytomic/Zavalishin TPT SVF must provide simultaneous LP/HP/BP/Notch/Peak/AllPass outputs and apply
2× oversampling when resonance Q > 10.

Verify with: `pnpm cargo:test -- -p daw-dsp svf` — all six outputs are present and 2× oversampling engages for Q > 10

### AC-025 — Velocity layering supports up to 16 layers

Each pad/slice must support up to 16 velocity layers.

Verify with: `pnpm cargo:test -- -p daw-engine velocity_coverage` — a `[10..20],[30..40]` config is rejected naming the uncovered ranges; 16-layer config resolves deterministically

### AC-026 — Voice stacking applies symmetric per-voice detune

A pad may declare `stack_count` in `[1,8]` and `stack_detune_cents` in `[0,50]`; on note-on the engine
allocates that many voices with detunes symmetrically distributed and shared round-robin/velocity state.

Verify with: `pnpm cargo:test -- -p daw-engine voice_stacking` — `stack_count=4, detune=20` yields offsets ≈ {−20, −6.67, +6.67, +20} cents (±2 cents by FFT)

### AC-027 — MPE per-note controllers are first-class mod sources

The engine must accept per-note pitch bend (±48 st configurable), per-note pressure, and per-note CC74,
projecting each into a `PerNoteControllers` struct whose fields are first-class modulation-matrix sources.

Verify with: `pnpm cargo:test -- -p daw-engine mpe` — channels 2–8 carrying distinct note-ons route to distinct voice slots and their per-note pitch-bend source modulates pitch

### AC-028 — Granular warp exposes its full parameter set under COLA

Granular warp must support Hann/Triangle/Tukey/Gaussian windows, IOT jitter up to 30%, a `MAX_GRAINS`
cap, spray, pitch_random, pan_spread, and density, with density × grain size respecting the COLA
constraint so unmodulated output is continuous.

Verify with: `pnpm cargo:test -- -p daw-engine granular_warp` — each window shape, jitter bound, and the COLA continuity property hold

### AC-029 — Disk streaming uses per-voice ping-pong rings with a priority I/O queue

Streaming must use a per-voice ping-pong ring pair filled by an I/O thread whose priority queue is
sorted by `buffered_samples_remaining`, reading fixed 4096-sample disk chunks over a 256-entry SPSC
command queue whose overflow is reported as a non-fatal event.

Verify with: `pnpm cargo:test -- -p daw-engine streaming_io` — 4096-sample chunk reads, priority ordering by remaining buffer, and non-fatal 256-entry overflow reporting

### AC-030 — Onset analysis uses adaptive peak-picking with zero-crossing snap and gating

Onset detection must use adaptive peak-picking (pre_avg=12, post_avg=6), snap onsets to the nearest
zero-crossing within a 5–50 sample window, gate by minimum inter-onset interval (20–50 ms percussive /
100 ms melodic), and map UI sensitivity `[0,1]` to `threshold = 1.0 − sensitivity * 0.9`.

Verify with: `pnpm cargo:test -- -p daw-dsp onset_picking` — peak-pick windows, ZC snap range, gating intervals, and the sensitivity→threshold mapping are applied

### AC-031 — Voice structs are cache-line aligned

Each voice struct must be 64-byte cache-line aligned to avoid false sharing.

Verify with: `pnpm cargo:test -- -p daw-engine voice_layout` — `size_of`/alignment is 64-byte aligned; steal fade is linear 1–5 ms and choke fade is 3 ms raised-cosine

### AC-032 — Design decisions and the engine test plan are recorded in the spec

The spec must record the three design-decision records (lock-free streaming vs mmap; onset algorithm
choice with deferred CNN; stretch algorithm scope with deferred tiers and the licensing-not-license
rationale) and the engine test plan (manual choke 3 ms fade test, AtomicU64 allocator unit tests,
YIN accuracy, SPSC starvation tests).

Verify with: `manual` — confirm the "## Design decisions" and "## Test plan" sections below enumerate all three decisions and the four test items

### AC-033 — Implementation status of existing sampler primitives is recorded

The spec must record where basic sampler functionality already exists — `Fermenter` (`sampler.rs`),
`Levain` (`voice.rs`), and `Grand_Boule` (`attack_sampler.rs`) — and note that the missing/refactor
items were tracked separately in the prior spec-of-the-gaps.

Verify with: `manual` — confirm the "## Implementation status" section below names the three existing engines and their files

### AC-034 — Incomplete velocity layer sets are rejected with uncovered ranges

A velocity layer set whose union does not cover `0..=127` must be rejected, surfacing the uncovered
ranges as a validation error to the UI rather than playing silence.

Verify with: `pnpm cargo:test -- -p daw-engine velocity_coverage` — a `[10..20],[30..40]` config is rejected naming the uncovered ranges

### AC-035 — Voice allocation uses compare_exchange_weak with AcqRel ordering

Voice allocation must use `compare_exchange_weak` with `AcqRel` ordering.

Verify with: `pnpm cargo:test -- -p daw-engine voice_layout` — allocation uses `compare_exchange_weak` with `AcqRel` ordering

### AC-036 — Stolen and choked voices receive distinct fades

Stolen voices must receive a 1–5 ms linear fade while choke kills use a fixed 3 ms raised-cosine fade.

Verify with: `pnpm cargo:test -- -p daw-engine voice_layout` — steal fade is linear 1–5 ms and choke fade is 3 ms raised-cosine

### AC-037 — Analysis exposes beat positions and snap-to-subdivision for slice markers

After BPM estimation, the analysis pipeline must expose beat positions so the UI/slicer can snap
slice markers to musical subdivisions (1/16, 1/8, 1/4). Beat-position refinement uses the
dynamic-programming beat tracker described in research Part 2c.

Verify with: `pnpm cargo:test -- -p daw-dsp beat_grid` — estimated beat positions are exposed and a slice
marker snaps to the nearest 1/16, 1/8, and 1/4 subdivision

### AC-038 — BPM is estimated by the Percival-Tzanetakis autocorrelation method

BPM estimation must use the Percival-Tzanetakis autocorrelation method: compute an onset-strength
signal (OSS), take its generalized autocorrelation `GAC(τ) = IFFT(|FFT(OSS)|^0.5)`, pick peaks
within the 50–200 BPM tempo range, and score candidates by cross-correlating against pulse trains.
For a well-cut loop, the engine MAY instead apply the heuristic `BPM = 60 × expected_beats / duration_seconds`.

Verify with: `pnpm cargo:test -- -p daw-dsp bpm` — a clip of known tempo resolves to its BPM via GAC
autocorrelation `IFFT(|FFT(OSS)|^0.5)` over the 50–200 BPM range, and the well-cut-loop heuristic
matches for a clip with known beat count and duration

### AC-039 — Waveform peaks use hierarchical Min/Max-pair mipmap reduction

Waveform peak generation must use hierarchical mipmap reduction storing Min/Max pairs (the peak-file
pattern from BBC's peaks.js and KVR peak-file discussions, analogous to texture mipmaps). The level-0
base block size must be 32 or 64 samples, and every subsequent level must be a power of 2.

Verify with: `pnpm cargo:test -- -p daw-dsp waveform_mipmap` — level 0 reduces a 32/64-sample base block to a
Min/Max pair and each subsequent level is a power-of-two reduction of the level below

### AC-040 — Repitch warp skips sample-rate conversion

In the "repitch" warp mode (pitch = speed), the engine must not run sample-rate conversion: the pitch
ratio already accounts for the rate difference. SRC is performed only when a sample must play at its
original pitch in a session whose rate differs from the sample's native rate, and that conversion runs
at load time on the I/O thread, never on the RT thread.

Verify with: `pnpm cargo:test -- -p daw-dsp src_skip` — a sample loaded in repitch mode in a mismatched-rate
session triggers no SRC pass, while the same sample at original pitch does, and the SRC pass runs off
the RT thread

## Design decisions

Restored from the prior `specs/implemented/unified-sampler-suite.md`; these are the original
design-decision records that informed this spec.

### Decision: Lock-free streaming vs direct memory mapping on the RT thread

**Chosen:** `rtrb`-based wait-free SPSC ring buffers serviced by a priority-queued background disk
I/O thread, combined with a RAM preload for the first 12KB (attack).
**Considered and rejected:** Direct memory mapping on the audio thread — page faults would block the
RT thread, causing audio dropouts. Memory-mapped I/O MAY still be used on the dedicated I/O thread
(HISE/Kontakt precedent) — an implementation detail of the I/O thread, not a change to the RT contract.

### Decision: Onset detection algorithm (with deferred CNN)

**Chosen:** SuperFlux for universal use (robust against vibrato), HFC for fast percussive analysis,
and Complex Domain for melodic material.
**Deferred:** CNN-based (madmom-style) onset detection via ONNX/`ort` — documented as a fourth
("AI" / "Universal+") mode. Deferred for v1 pending the `ort` integration schedule; the analysis
pipeline's contract (ODF → peak-pick → ZC-snap) accommodates it with no architectural change.

### Decision: Stretch algorithm scope (with deferred tiers and licensing rationale)

**Chosen:** First-party WSOLA + Phase Vocoder (IPL) covering the "transient vs tonal" split.
**Deferred:** Higher-quality tiers — Rubber Band R3, Signalsmith / `ssstretch`, STN offline
decomposition, RTPGHI — remain documented in research but out of scope for v1. The Non-goal on
"proprietary stretch (Elastique Pro)" is licensing-driven; it does not exclude MIT/BSD/GPL-compatible
third-party libraries that might ship in a later quality tier. The tier ordering reflects the
research's algorithm-selection matrix (latency / CPU): Phase vocoder + IPL ~50 ms / medium, WSOLA
~100 ms / low, Signalsmith ~50 ms / medium-high, Rubber Band R3 ~90 ms / medium-high, and STN hybrid
offline (not real-time) / high — so the deferred tiers are the higher-CPU or offline-only ones.

## Test plan

Restored from the prior `specs/implemented/unified-sampler-suite.md`.

- **Manual:** Load a 5+ minute audio file. Verify waveform peaks render instantly via binary IPC.
- **Manual:** Trigger choke groups in Drum mode. Verify click-free cutoffs (3 ms fade).
- **Automated:** Unit tests for the `AtomicU64` voice allocator.
- **Automated:** Integration tests for YIN detector accuracy with parabolic refinement.
- **Automated:** SPSC ring buffer starvation tests.

## Implementation status

Restored from the prior `specs/implemented/unified-sampler-suite.md`.

- **What is implemented:** Basic sampler functionality is present within `Fermenter` (`sampler.rs`),
  `Levain` (`voice.rs`), and `Grand_Boule` (`attack_sampler.rs`).
- **What is not implemented / needs refactoring:** Tracked in the prior `spec-of-the-gaps` document.
- **What is done well:** Core audio primitives (reading buffers, basic playback) exist in other engines.

## Open questions

- [ ] **[blocking]** Memory budget: hard MB cap for refused presets, the pitch-ratio threshold that promotes a sample to fully resident, and whether a stream/RAM/auto control is per-sample or per-instrument.
- [ ] **[blocking]** Missing or relocated sample files at load — fail, load placeholder silence, or enter a relink state; and the RT contract for a triggered missing sample.
- [ ] **[blocking]** Sample-rate mismatch — mandatory load-time conversion vs playback-time interpolation, and the authoritative `rubato` variant.
- [ ] **[blocking]** MPE protocol surface — full MPE 1.0 wire protocol, a simplified per-note surface, or defer to a later version.
- [ ] **[blocking]** Voice stacking vs streaming budget — count stacks against the 128-voice pool, reserve a stack pool, or degrade under pressure.
- [ ] (non-blocking) CNN onset path in v1 (defer until `ort` is scheduled); beat-grid snapping default; round-robin persistence across sessions.
- [ ] (non-blocking) (restored detail) HQ interpolation render mode: whether to adopt Surge's pre-computed windowed-sinc-table approach (sinc evaluated at `512 × oversampling_factor` points, ~256KB) per voice to avoid `sin()` on the RT thread, versus runtime `rubato` SincFixedOut. The default playback interpolation (cubic Hermite, ~4 mul + 4 add/sample) is settled; only the optional HQ tier is open.
- [ ] (non-blocking) (restored detail) YIN tuning detail behind AC-006: the algorithm's first two steps are the difference function `d(τ) = Σ(i=0..W−τ) (x[i] − x[i+τ])²` over an integration window `W` (typically half the buffer), which is zero at lag 0 and at the true period, followed by the cumulative-mean-normalized difference `d'(τ) = d(τ) / ((1/τ)·Σ(j=1..τ) d(j))` for τ > 0 (and `d'(0) = 1`), which starts at 1.0 and dips below 1.0 where `d(τ)` falls under its running average — the first dip below the 0.15 threshold is the pitch period, refined by the parabolic interpolation `τ_refined = τ + (d'(τ−1) − d'(τ+1)) / (2·(d'(τ−1) − 2·d'(τ) + d'(τ+1)))` already named in AC-006. Open only as to whether to compute these directly or rely on the `pitch-detection` crate's FFT-accelerated implementation.

## Affected areas

- `sampler_engine/` (`voice/`, `warp/`, `streaming/`, `analysis/`, `modes/`, `sample/`)
- `src-tauri` sampler commands and events
- `src/modules/Sampler/` frontend stores and waveform/pad views

## Dropped from sources

- Higher-quality stretch tiers (Rubber Band R3, Signalsmith `ssstretch`, STN, RTPGHI) — deferred; the warp architecture accommodates them later (see `research.md`).
- CNN onset detection — deferred until `ort` integration is scheduled; v1 ships the classical detectors.
- Elastique Pro — excluded on licensing grounds.
