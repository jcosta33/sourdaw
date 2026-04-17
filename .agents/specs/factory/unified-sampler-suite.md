# Unified Sampler Suite

## Context

No single DAW sampler combines all best-in-class workflows. Ableton leads in speed, Logic in intelligence (auto-analysis), FL Studio in per-slice control, and Bitwig in modulation depth. The goal of this architecture is to provide a single instrument that unifies these workflows while maintaining strict real-time safety on the audio thread.

Reference relevant research: `.agents/research/factory/unified-sampler-suite.md` — Part 1 covers the competitor UX matrix, action-count benchmarks across Ableton/Logic/FL/Bitwig, and the "eight gaps" that motivate this suite; Part 2a–2g cover the RT-engine architecture, streaming, analysis, DSP, warp, IPC, and critical constants; the Addendum covers per-slice articulation and modulation depth.

### Research-derived benchmarks (non-normative)

Where feasible, the implementation SHOULD match or beat the competitor action-count benchmarks recorded in research Part 1 for the three canonical workflows: (1) one-shot drag-to-pad load, (2) loop-to-pads slice-and-play, and (3) warp-to-project-tempo. Exact target numbers and test methodology live in the research file; they are treated as direction, not as hard acceptance criteria, because the measurement harness does not exist yet.

---

## Goal

Deliver a Unified Sampler Suite targeting four primary sampler modes (Quick, Drum, Slice, and Warp) sharing a common Rust voice engine, disk streamer, and onset detector, with UI logic and mode-specific MIDI mapping handled in React/TypeScript via Tauri v2 IPC.

---

## User-visible behavior

- **One-click context-aware loading:** Dragging a sample auto-detects if it is percussive (defaults to 1-Shot/Drum), a loop (defaults to Slice), or tonal (defaults to Quick with auto root key).
- **In-place slicing:** Visual waveform with draggable slice markers (absolute `<div>` overlays). Slices map directly to playable pads without leaving the sampler or creating new tracks.
- **MPC/SP-404-style recording:** Support for threshold-triggered recording directly to pads, enabling seamless capture into the instrument.
- **Independent time-stretch:** Time-stretching algorithms that act as playable/modulatable parameters decoupled from project BPM. **Flex Speed** (Logic-style) MUST be a first-class modulation target.
- **Deep modulation and FX:**
    - **8 Articulator Groups** (FL Studio style): Each slice/pad has independent envelopes, filters, and LFOs.
    - **Mod X/Y Crossfading**: Dual decks with morphing capabilities between sample states.
    - **Bitwig-level Modulation**: A unified modulation system where any parameter is a target.
    - **Voice Stacking**: Per-voice detuning and stacking for layered sounds.
- **Smart Loop Points:** Automatic zero-crossing detection and crossfade length calculation for click-free loops.

---

## Scope

## **In scope:**

- **Rust Audio Engine (`sampler_engine`):** A 3-thread model (RT Audio, Disk I/O, Engine Management).
- **Four Playback Modes:** Quick (chromatic), Drum (pads/choke groups), Slice (markers), and Granular/Warp.
- **Dual-mode Time-Stretching:** WSOLA for transients/percussive content, Phase Vocoder with identity phase locking for tonal content.
- **Optional higher-quality stretch tier (deferred):** Research Part 1 documents third-party / hybrid algorithms — Rubber Band R3, Signalsmith `ssstretch`, STN (sines/transients/noise) offline decomposition, and RTPGHI phase reconstruction — as "quality tier" add-ons. These are **NOT** v1 requirements; they are documented here so that the warp pipeline's architecture (pre-allocated buffers, SPSC commands, single RT callback entry) can accommodate them later without a rewrite.
- **Optional CNN onset tier (deferred):** An ONNX / `ort`-based "AI" onset mode is described in research Part 2c alongside SuperFlux/HFC/Complex Domain. v1 ships the three classical detectors; the CNN path is deferred until `ort` integration is scheduled (see Open questions).
- **Disk Streaming:** Wait-free ring buffer (`rtrb`) architecture supporting up to 128 voices with RAM-cached attack (12KB preload) + disk-streamed sustain.
- **Analysis:** Background SuperFlux/HFC onset detection, YIN pitch detection, and beat/BPM estimation.
- **DSP Modulators & Processors:** Cubic Hermite interpolation, 1-multiply iterative AHDSR, Cytomic/Zavalishin TPT SVF filter, and one-pole exponential parameter smoothing.
- **Organization:** Drum Rack-style nesting where each slice has its own channel strip and independent FX chain.
- **React Frontend:** WebGL/Canvas waveform rendering, Zustand state (`useSamplerStore`, `usePadStore`, `useSliceStore`).
- **Interaction Design:** Drag-and-drop for file loading (Tauri `DragDropEvent`) and pad-to-pad reordering. Mini-waveform thumbnails for pads. Velocity-sensitive flash animations on pad triggers.
- **Tauri v2 IPC:** Using binary `tauri::ipc::Response` for transferring waveform peak mipmaps.

## **Non-goals (explicitly out of scope):**

- Transmitting raw audio data through Tauri IPC.
- Memory allocation, disk I/O, or mutex locking on the RT audio thread.
- Proprietary stretch algorithms (e.g., Elastique Pro).

---

## Requirements

1. **Strict RT Thread Separation**
    - The RT audio thread MUST only interact with pre-allocated memory and wait-free atomic operations.
    - The `assert_no_alloc` crate MUST pass in debug builds during playback.
    - Any parameter change from the UI must be delivered via an `rtrb` SPSC command queue or `AtomicU32` (using bit patterns for floats).

2. **Lock-Free Voice Allocation & Stealing**
    - Voice pool MUST be pre-allocated to 128 voices, **cache-line aligned (64 bytes)** per voice struct to avoid false sharing across cores (research Part 2b).
    - Allocation MUST use two `AtomicU64` values as a bitfield. Finding a free voice MUST use `trailing_zeros()` and `compare_exchange_weak` with `AcqRel` ordering. This is `O(N/64)` — a fixed bounded cost for 128 voices (two words) — treated as O(1) for practical purposes.
    - Voice stealing MUST follow this priority: Same-note retrigger -> Choke group -> Releasing voices -> Oldest active -> Quietest.
    - **Fade-out on reassignment:** stolen voices receive a **1–5 ms linear fade-out**; choke-group kills use a fixed **3 ms** raised-cosine fade (research Part 2b choke). The two constants are intentionally distinct: steal fade minimizes click; choke fade is tuned for mute-group musical feel.

3. **Wait-Free Disk Streaming (DFD)**
    - Each voice MUST own a dedicated pair of `rtrb::RingBuffer<f32>` (ping-pong) filled by the background I/O thread.
    - **Budgets:** 12KB preload (~68ms) per sample in RAM, 64KB (~186ms) ring buffer per voice. Total streaming RAM budget at 128 voices is **~76 MB** (research Part 2b).
    - **I/O Thread:** MUST use a priority queue sorted by `buffered_samples_remaining`. Disk reads use fixed chunk sizes (e.g. **4096 samples**) aligned to typical disk blocks.
    - **Command queue depth:** The SPSC command queue between engine-management and I/O threads is sized at a fixed depth (e.g. **256 entries**); overflow is reported back to the management thread as a non-fatal event.
    - **Pitch-ratio full-RAM promotion:** Samples whose playback pitch ratio exceeds a configured `MAX_SAMPLER_PITCH`-style threshold MAY be promoted to fully resident in RAM at load time (HISE/Kontakt precedent, research Part 2b). The exact threshold is an open question (see Open questions).
    - **Underrun:** MUST apply an inverse ramp (64 samples) to fade to silence when the ring starves, AND MUST apply a short fade-**in** when data is available again, so a transient underrun does not leave a hard click on resumption (research Part 2b).

4. **Background Auto-Analysis**
    - **Onset Detection:** MUST implement SuperFlux (universal), HFC (percussive), and Complex Domain (melodic). Peak picking MUST use adaptive thresholding (pre_avg=12, post_avg=6 frames) and snap to nearest zero-crossing (5-50 sample window). Spectral flux is acknowledged in research Part 2c as a baseline ODF for reference ranking but is not required.
    - **Onset gating:** MUST enforce a minimum inter-onset interval to suppress double-triggers. Defaults per research Part 2c: **20–50 ms for percussive material, 100 ms for melodic**. Slice cuts MAY apply a 1–5 ms raised-cosine fade at each slice boundary to prevent clicks when a slice is triggered.
    - **Sensitivity mapping:** The UI sensitivity control (`[0, 1]`) MUST map to the peak-picking threshold as `threshold = 1.0 - sensitivity * 0.9` (research Part 2c).
    - **Tempo / beat grid:** After BPM estimation, the analysis pipeline MUST expose beat positions so the UI / slicer can snap slice markers to musical subdivisions (1/16, 1/8, 1/4). Beat-position refinement uses the dynamic-programming beat tracker described in research Part 2c.
    - **Pitch Detection:** YIN algorithm (via `pitch-detection` crate) using a 0.15 threshold over multiple 2048-sample windows. MUST use parabolic interpolation for sub-bin refinement. Robustness: skip the attack region (first ~40 ms) and average the result of 3–5 analysis windows before reporting, per research Part 2c.
    - **BPM Estimation:** Percival-Tzanetakis autocorrelation method (GAC autocorrelation of onset strength signal).
    - **Waveform Peaks:** Hierarchical mipmap reduction (Min/Max pairs). Level 0 base block size: 32 or 64 samples. Subsequent levels MUST be powers of 2.

5. **Precision DSP Implementation**
    - **Interpolation:** Pitched playback MUST use 4-point Cubic Hermite interpolation. Offline sample rate conversion (at load time) MUST use `rubato` windowed sinc.
    - **AHDSR Envelope:** 6-state machine (Idle, Attack, Hold, Decay, Sustain, Release). MUST use 1-multiply iterative exponential curve (`level = (level - offset) * multiplier + offset`). `target_ratio` MUST be adjustable (0.0001 for exponential, 1.0+ for linear). MUST support **retrigger modes** (research Part 2e): `Legato` (same note re-uses active envelope state), `RetriggerFromCurrent` (new envelope starts from current level), and `HardRetrigger` (reset to zero); the choice is per-pad/slice configuration.
    - **Filter:** MUST implement Cytomic/Zavalishin TPT SVF. MUST provide simultaneous LP, HP, BP, Notch, **Peak**, and **AllPass** outputs (research Part 2e). MUST use 2x oversampling for resonance $Q > 10$.
    - **Parameter Smoothing:** One-pole exponential smoother (5-20ms time constant). MUST include denormal prevention (tiny DC offset $1e^{-18}$ or flush-to-zero). Implementation SHOULD use **per-block** smoothing update with linear interpolation across samples within a block, rather than per-sample coefficient updates, to reduce CPU cost for modulation-heavy patches (research Part 2e performance note).
    - **Pan law:** Pan / crossfade mixing MUST use an equal-power (sin/cos) law (research Part 2g); linear pan MUST NOT be used for sample mixing.
    - **Looping:** Equal-power crossfade (sin/cos gains) at loop boundaries (Forward, PingPong, Reverse). Default length: 50-500 samples.

6. **Warp Engine Mechanics**
    - **Phase Vocoder:** Identity Phase Locking (IPL) MUST identify spectral peaks and lock surrounding bin phases. FFT size: 2048. Overlap: 75% (hop = N/4). Pre-allocate all buffers via `realfft`.
    - **WSOLA:** Frame length: 1024. Overlap: 512. Tolerance window ($\Delta_{max}$): 256. Cross-correlation MUST be optimized via FFT or 4x downsampling. WSOLA is understood to degrade on complex polyphonic sources and above ~2× stretch (research Part 2f limitations); the UI MAY recommend PV for extreme stretch ratios.
    - **Granular:** MUST support Hann, Triangle, Tukey, and Gaussian grain window shapes. Inter-onset time (IOT) MUST allow randomization (jitter) up to 30%. Additional granular parameters (research Part 2f): `MAX_GRAINS` (hard cap on concurrent grains per voice), `spray` (grain read-head randomization window), `pitch_random` (per-grain detune), `pan_spread` (stereo distribution), and `density` (grains per second) — `density` combined with grain size MUST respect COLA (constant overlap-add) at default settings so unmodulated output sounds continuous.

7. **Tauri v2 IPC & UI Performance**
    - **Binary IPC:** Waveform mipmaps MUST be transferred via raw `ArrayBuffer` using `tauri::ipc::Response`.
    - **Position Tracking:** UI MUST update from the `playback_position` channel (emitted at 30Hz). Management thread MUST sample an `AtomicU64` written by the audio thread.
    - **Metering:** Audio thread MUST write `peak_level` and `active_voice_count` to atomics with `Relaxed` ordering.
    - **Responsiveness:** The playback cursor MUST use `requestAnimationFrame` for 60fps visual interpolation between 30Hz position updates. Waveform rendering MUST use mipmap levels to enable smooth, lag-free zoom.

8. **State Management & Interaction**
    - **Stores:** Frontend state MUST use lightweight stores (Zustand) to manage mode, sample metadata, and pad/slice configurations.
    - **Markers:** Interaction with draggable slice markers MUST be debounced (50ms) to prevent IPC flooding.
    - **Direct Recording:** The engine MUST support a "Recorder" mode with SP-404 style threshold triggering to capture audio directly into memory buffers.

9. **Round-Robin Sample Rotation**
    - A single trigger (pad / MIDI note / slice) MUST support an ordered list of 1–32 round-robin sample variants.
    - The engine MUST provide three selectable cycle modes: `Sequential` (advance the index by 1 modulo N on each trigger), `Random` (uniform random over all N variants), and `RandomNoRepeat` (uniform random over the N−1 variants that exclude the last played — equivalent to "random-robin with repeat avoidance" in research Part 2d).
    - The round-robin counter MUST be stored per-pad (Drum mode) or per-slice (Slice mode), advance synchronously with note-on on the audio thread, and MUST NOT allocate.
    - A `reset_round_robin` command MUST set the counter back to index 0 via the SPSC command queue (for deterministic playback / rendering).
    - Round-robin selection MUST compose with velocity layering: the velocity layer is resolved first, then round-robin selects among variants within that layer.

10. **Velocity Layering**
    - Each pad / slice MUST support up to 16 velocity layers. Each layer defines a MIDI velocity range `[v_lo, v_hi]` over `0..=127` and a sample list (each list itself subject to requirement 9).
    - The engine MUST resolve a layer in O(log N) or O(N) bounded time on the audio thread (no allocation) by selecting the first layer whose range contains the incoming velocity.
    - Layer ranges MAY overlap. When they overlap, overlapping layers MUST be crossfaded by an equal-power (sin/cos) gain based on the position of the incoming velocity within the overlap window. Non-overlapping layers MUST produce a single hard-selected layer with gain 1.0.
    - Configuration MUST reject layer sets whose union does not cover `0..=127`; unreachable velocities MUST be surfaced as a validation error to the UI (not silently played as silence).
    - Layer resolution MUST be deterministic: given identical `{velocity, layer_config, round_robin_state}`, the same voice(s) and gains MUST be produced.

11. **Per-slice articulation and modulation depth**

    The user-visible promises of FL Studio-style articulator groups, Bitwig-level modulation, Mod X/Y crossfading, and voice stacking MUST be formalised as engine surface area — they are not implementation-detail footnotes.

    - **Articulator groups:** Each pad / slice MUST support at least **8 independent articulator slots**. An articulator is one of `{AHDSR envelope, LFO, MSEG, filter, pitch-shift, pan, bitcrush, drive}`. Each slot is pre-allocated per voice at initialisation; adding or removing slots at runtime MUST go through the SPSC command queue and not allocate on the RT thread.
    - **Mod-matrix surface:** The engine MUST expose a unified modulation matrix where any `{source, destination}` pairing is addressable by stable ID. Sources include MIDI velocity, aftertouch, CC, LFOs, envelopes, MSEGs, mod X, mod Y, macro 1..8. Destinations include per-slot articulator parameters, warp ratio (Flex Speed), filter cutoff/Q, grain density, pitch, pan, and round-robin selection bias. The matrix MUST support up to **32 active routings per pad/slice** (compile-time constant).
    - **Mod X/Y crossfading (dual-deck):** Each pad / slice MAY carry two "decks" (A and B) of independent sample + articulator state. Mod X and Mod Y are two `AtomicF32` parameters in `[0, 1]` that gate crossfading between decks via equal-power (sin/cos) gains. Switching a pad from single-deck to dual-deck MUST occur off-audio-thread through the SPSC queue.
    - **Voice stacking with per-voice detuning:** Each pad / slice MAY declare a `stack_count ∈ [1, 8]` and a `stack_detune_cents ∈ [0, 50]`. On note-on, the engine allocates `stack_count` voices with detunes symmetrically distributed across `[-detune_cents, +detune_cents]`; each voice is subject to the normal allocation/stealing rules (requirement 2) and contributes to the overall voice count. Stack voices MUST share round-robin and velocity-layer state so that the perceived variant is identical across the stack.
    - **MPE-awareness:** The engine MUST accept per-note pitch bend (±48 semitones range configurable), per-note pressure, and per-note CC74 (timbre/Y). Each incoming MPE channel maps to a dedicated voice slot; these per-note controllers are first-class mod-matrix sources. MPE is not required to be wire-protocol MPE — MIDI 1.0 per-channel-note and MIDI 2.0 per-note controllers both resolve to the same internal `PerNoteControllers` struct.
    - **Flex Speed as modulation target:** The warp ratio exposed by requirement 6 MUST be addressable by the modulation matrix at control rate. Modulating it MUST NOT trigger allocation or FFT-buffer resize — the warp engine's pre-allocated buffers (requirement 6) are sized for the maximum configured ratio at patch load.
    - **RT discipline:** All articulator computations, matrix routing, deck crossfade, stack mixing, and MPE resolution MUST respect requirement 1 (no alloc, no locks, no blocking on RT thread). The entire matrix evaluation for one audio block MUST complete in bounded `O(active_routings × active_voices)` time.

12. **Engine callback contract (single RT entry point)**

    The RT `process()` callback MUST execute the following orchestration for every audio block, in this order (research Part 2 Addendum §11):

    1. Drain the SPSC command queue from the engine-management thread into non-allocating voice/sample state mutations. Commands that require allocation or blocking MUST have been resolved on the management thread before enqueue; the callback MUST never take the allocation path.
    2. Drain the MIDI input queue for the block, resolving velocity layer → round-robin → stack → voice allocation per requirements 2, 9, 10, 11.
    3. For each active voice: read preload / ring → warp (PV / WSOLA / repitch / granular, per mode) → filter (SVF) → envelope (AHDSR) → pan / mix into the block accumulator.
    4. Write metering atomics (`peak_level`, `active_voice_count`, per-pad activity) with `Relaxed` ordering.
    5. Signal the disk I/O thread (via an `AtomicBool` or park-token unpark) when any voice's `buffered_samples_remaining` crosses the refill threshold.

    The callback MUST complete in bounded O(active_voices × active_routings) time; `assert_no_alloc` MUST pass on the full orchestration in debug builds.

13. **IPC contract (Tauri command / event surface)**

    The frontend MUST reach the engine only through the following surface. Changes to this surface require a spec update (research Part 2 Addendum §7):

    - **Commands (`invoke`):** `load_sample`, `analyze_onsets`, `set_sampler_mode`, `set_pad_config`, `set_slice_config`, `set_warp_params`, `set_articulator`, `set_mod_route`, `reset_round_robin`, `start_recording`, `stop_recording`, `get_waveform_peaks` (returns `tauri::ipc::Response` with a binary mipmap payload).
    - **Events (server → client):** `playback_position` (~30 Hz), `voice_activity` (per-pad meter, ~30 Hz), `analysis_complete` (onsets / BPM / root key / peaks), `sample_load_progress`, `underrun_event` (telemetry only; the engine does not block on this).
    - All command and event shapes MUST be typed end-to-end via `tauri-specta`; no `any` on the boundary. Large binary payloads (waveform mipmaps, recorder captures) MUST use `tauri::ipc::Response` rather than being JSON-encoded.
    - The audio stream itself MUST NOT cross IPC; UI receives metering and decimated waveform views only (see Non-goals).

---

## Critical DSP Constants

| Constant          | Value      | Description                              |
| :---------------- | :--------- | :--------------------------------------- |
| `MAX_VOICES`      | 128        | Pre-allocated voice pool size            |
| `PRELOAD_SIZE`    | 12KB       | RAM-cached attack per sample             |
| `STREAM_BUF_SIZE` | 64KB       | Per-voice ring buffer capacity           |
| `FFT_SIZE_PV`     | 2048       | Phase Vocoder STFT window                |
| `WSOLA_FRAME`     | 1024       | WSOLA frame length                       |
| `WSOLA_TOLERANCE` | 256        | WSOLA search window ($\Delta_{max}$)     |
| `ENV_TARGET_EXP`  | 0.0001     | AHDSR target ratio for exponential curve |
| `FADE_STOLEN`     | 1-5ms      | Linear fade-out for stolen voices        |
| `FADE_UNDERRUN`   | 64 samples | Inverse ramp for buffer starvation       |

---

## Constraints

- Must follow the domain-driven module architecture (`AGENTS.md`).
- Must integrate cleanly with `daw-dsp` and `daw-engine`.
- Audio thread operations MUST execute in O(1) bounded time (no unpredictable loops).

---

## Design decisions

### Decision: Lock-free streaming vs Direct memory mapping on RT thread

**Chosen:** `rtrb`-based wait-free SPSC ring buffers serviced by a priority-queued background disk I/O thread, combined with a RAM preload for the first 12KB (attack).
**Considered and rejected:** Direct memory mapping on the audio thread. Page faults would block the RT thread, causing audio dropouts. Memory-mapped I/O MAY still be used on the dedicated I/O thread (HISE/Kontakt precedent — research Part 2b) — this is an implementation detail of the I/O thread, not a change to the RT contract.

### Decision: Onset Detection Algorithm

**Chosen:** SuperFlux for universal use (robust against vibrato), HFC (High-Frequency Content) for fast percussive analysis, and Complex Domain for melodic material.
**Deferred:** CNN-based (madmom-style) onset detection via ONNX/`ort`. Research Part 2c documents this as a fourth ("AI" / "Universal+") mode. Deferred for v1 pending `ort` integration schedule; the analysis pipeline's contract (ODF → peak-pick → ZC-snap) accommodates it with no architectural change.

### Decision: Stretch algorithm scope

**Chosen:** First-party WSOLA + Phase Vocoder (IPL) covering the "transient vs tonal" split.
**Deferred:** Higher-quality tiers — Rubber Band R3, Signalsmith / `ssstretch`, STN offline decomposition, RTPGHI — remain documented in research but out of scope for v1. The Non-goal on "proprietary stretch (Elastique Pro)" is licensing-driven; it does not exclude MIT/BSD/GPL-compatible third-party libraries that might ship in a later quality tier.

---

## Acceptance criteria

- [ ] `pnpm deps:validate` passes with zero violations.
- [ ] `assert_no_alloc` verifies zero heap allocations occur in the `process()` callback.
- [ ] Engine plays 128 simultaneous streamed voices from disk without audible dropouts or buffer underruns on a standard NVMe drive.
- [ ] Dragging a sample onto the sampler correctly auto-detects and switches to the recommended mode (Percussive -> Drum, Loop -> Slice, Tonal -> Quick).
- [ ] Threshold-triggered recording captures audio into a pad without audible gaps or clicks.
- [ ] Waveform zoom and scroll remain responsive (60fps) during heavy 128-voice playback.
- [ ] Pad-to-pad reordering via drag-and-drop correctly updates the underlying `usePadStore`.
- [ ] Dragging a tonal sample successfully triggers the YIN pitch detector, returning the correct root MIDI note.
- [ ] YIN pitch detector reports 440Hz for an A4 test sine wave with parabolic refinement.
- [ ] Dragging a percussive loop successfully runs SuperFlux, placing slice markers at transients within 5ms accuracy and snapping to zero-crossings.
- [ ] Changing filter cutoff or time-stretch ratio during playback does not produce zipper noise or audible clicks.
- [ ] Voice allocation bitfield scan completes in O(1) using `trailing_zeros()` and `compare_exchange_weak` without mutex locking.
- [ ] Mipmap generation completes for a 10-minute stereo file in <500ms and UI receives the peak data via binary IPC.
- [ ] **Round-robin — Sequential:** Given `N` samples `[S0..S(N-1)]` assigned to one pad in `Sequential` mode, triggering the pad `N+1` times (from reset) produces the voice sequence `S0, S1, …, S(N-1), S0`.
- [ ] **Round-robin — RandomNoRepeat:** Given `N ≥ 2` samples in `RandomNoRepeat` mode, across 1,000 consecutive triggers no two adjacent triggers select the same variant, and each variant is selected at least once.
- [ ] **Round-robin — reset:** After `reset_round_robin` is dispatched via the SPSC command queue, the next trigger in `Sequential` mode MUST produce `S0`, regardless of prior counter state.
- [ ] **Round-robin is allocation-free:** `assert_no_alloc` reports zero allocations during 10,000 consecutive round-robin triggers across 128 voices.
- [ ] **Velocity layering — non-overlap:** Given layers `[0..63] → L_lo`, `[64..127] → L_hi` with one sample each, triggers at velocities `1, 63, 64, 127` play exactly `L_lo, L_lo, L_hi, L_hi` respectively with gain 1.0.
- [ ] **Velocity layering — crossfade:** Given layers `[0..80] → L_lo` and `[70..127] → L_hi` overlapping in `[70..80]`, a trigger at velocity 75 MUST sound both layers with equal-power gains summing to approximately unity (±0.5 dB), gains corresponding to the crossfade position 0.5 within the overlap window.
- [ ] **Velocity layering — coverage validation:** A layer configuration of `[10..20], [30..40]` MUST be rejected at configuration time with an error surfaced to the UI identifying the uncovered velocity ranges.
- [ ] **Round-robin composes with velocity layers:** Given a pad with two velocity layers, each containing 3 round-robin variants in `Sequential` mode, triggering 4 times alternating within the same layer advances that layer's counter `0 → 1 → 2 → 0` while the other layer's counter remains unchanged.
- [ ] **Articulator slots allocate-free:** A pad configured with 8 articulator slots (envelope+LFO+MSEG+filter+pitch+pan+bitcrush+drive) processes 10,000 consecutive note-ons with `assert_no_alloc` reporting zero allocations on the RT thread.
- [ ] **Mod matrix — 32 routings:** A pad with 32 active `{source → destination}` routings evaluates its matrix in bounded time per block; adding the 33rd routing is rejected at configuration time with a UI error.
- [ ] **Mod X/Y dual deck:** Setting `mod_x = 0.0` plays deck A at full amplitude, `mod_x = 1.0` plays deck B at full amplitude, `mod_x = 0.5` produces both decks at −3 dB (sin/cos crossfade within ±0.5 dB tolerance).
- [ ] **Voice stacking:** A pad with `stack_count = 4, detune_cents = 20` triggered once produces 4 simultaneous voices with fundamental-frequency offsets of approximately `{-20, -6.67, +6.67, +20} cents` (±2 cents tolerance as measured by FFT peak-picking).
- [ ] **MPE per-note:** Sending MIDI channels 2–8 carrying simultaneous note-ons at different pitches routes each to a distinct voice slot whose per-note pitch-bend source is addressable in the mod matrix and produces the expected pitch modulation at FFT analysis.
- [ ] **Flex Speed modulation:** Routing an LFO → warp ratio produces audible pitch/time modulation; during 1,000 LFO cycles `assert_no_alloc` reports zero allocations and the warp engine's FFT buffers retain their pre-allocated capacity (verified by inspecting buffer pointers before/after).

---

## Open questions

- [CRITICAL] **Memory budget for large sampled instruments (stream vs fully-loaded).** Research Part 2b quantifies a ~76MB budget for 128 voices with 12KB preload + 64KB ring buffer. For multi-GB instruments (e.g. 5 velocity layers × 10 round-robins × 88 keys) this remains feasible only while each sample is streamed. HISE's `MAX_SAMPLER_PITCH` heuristic forces full-RAM loads above a pitch-ratio threshold. We need to decide: (a) the hard MB cap above which the engine refuses to load a preset and reports back to the UI, (b) the pitch-ratio threshold that promotes a sample from streaming to fully-resident, and (c) whether a user-visible "stream / RAM / auto" control is exposed per-sample or per-instrument.
- [CRITICAL] **Missing or relocated sample files at load time.** Presets reference samples by path or content hash. The spec must define behavior when a file is missing, moved, or fails checksum: (a) does the preset fail to load, load partially with placeholder silence voices, or enter a "relink required" state surfaced to the UI? (b) Is there a relink flow (manual path substitution, directory-wide search, hash-based lookup)? (c) What is the RT-thread contract when a voice is triggered for a missing sample — silent voice with telemetry event, or hard refuse to allocate the voice?
- [CRITICAL] **Sample rate mismatch between asset and engine.** Research Part 2g states SRC must run on the I/O thread using `rubato` at load time. The spec must pin down: (a) is conversion mandatory at load, or does the engine support mixed-rate samples resolved at playback via the existing Cubic Hermite interpolator? (b) which `rubato` variant is authoritative for fixed-ratio conversions (`FftFixedInOut`) vs non-integer ratios (`SincFixedOut`)? (c) What happens during recorded / Recorder-mode captures when the session rate changes while a pad's buffer is already resident — re-resample, refuse, or mark the pad as rate-locked?
- **Round-robin persistence across sessions.** Should the round-robin counter be persisted in the project file (deterministic re-renders) or reset on project load (avoids surprising "why does this track sound different after reopening")? Research does not specify.
- **Velocity layer crossfade curve selection.** Research Part 2d fixes equal-power (sin/cos) for loop crossfades but does not specify a curve for inter-layer velocity crossfades. Options include equal-power, linear, or user-selectable. This is non-critical because equal-power is a defensible default and can be revisited.
- [CRITICAL] **MPE protocol surface.** Requirement 11 accepts MPE as a first-class mod source but does not pin down whether v1 must accept the full MIDI Polyphonic Expression 1.0 spec (master channel + member channels + per-channel pitch bend range negotiation) or just the internal `PerNoteControllers` projection fed by any source. Decide: (a) full MPE 1.0 wire protocol including RPN 0,6 pitch-bend-range messages, (b) simplified "per-note-aware" surface (channel-per-note routing without RPN negotiation), or (c) defer MPE to v1.1 with only per-channel pressure and pitch-bend as mod sources in v1. Affects the input-stage spec and downstream MIDI 2.0 compatibility path.
- [CRITICAL] **Voice stacking interaction with disk streaming budget.** Requirement 11's stack_count up to 8 multiplies active voice count by up to 8× per trigger, which can push the pre-allocated 128-voice pool + 16MB ring buffer budget (research Part 2b) into starvation on large sampled instruments. Decide: (a) hard cap `total_active_voices ≤ MAX_VOICES` (128) where stacks count as N voices (and the stealing cascade applies), (b) reserve a separate `stack_voice_pool` budget, or (c) degrade stacked voices to lower-quality interpolation under memory pressure. Resolve before implementing requirement 11.
- [CRITICAL] **CNN onset path in v1.** Research Part 2c specifies an optional "AI" mode alongside SuperFlux/HFC/Complex Domain. Decide: (a) include as an optional analysis backend in v1 (adds `ort` runtime dependency and model bundling), or (b) defer and remove from any user-facing product messaging until `ort` integration is scheduled. Current spec default: defer.
- [MAJOR] **Beat-grid snapping UX.** The analysis layer now exposes beat positions (requirement 4). Product must decide whether slice markers auto-snap to the beat grid by default, snap only when the user chooses a subdivision (1/16, 1/8, 1/4, off), or never auto-snap. Default proposal: user-selectable subdivision with a snap-to-beat toggle per slice.
- **Articulator slot count.** v1 fixes this at 8 per FL Studio precedent. Confirm with product whether the dual-deck case should also carry 8 per deck (16 total per pad) or 8 shared across decks.
- **Crate stack for deferred free paths.** Research mentions `rtrb-basedrop` and `crossbeam-channel` as options for deferred-deallocation of voice data crossing RT → non-RT. v1 uses plain `rtrb` + SPSC; confirm whether the deferred-free path ships in v1 or v1.1.

---

## Implementation notes (Rust Module Hierarchy)

- `sampler_engine/`
    - `voice/` (`allocator.rs`, `stealing.rs`, `envelope.rs`, `pool.rs`)
    - `warp/` (`phase_vocoder.rs`, `wsola.rs`, `repitch.rs`, `granular.rs`)
    - `streaming/` (`preload.rs`, `ring_buffer.rs`, `io_thread.rs`)
    - `analysis/` (`onset.rs`, `peak_picker.rs`, `bpm.rs`, `pitch.rs`)
    - `modes/` (`quick.rs`, `drum.rs`, `slice.rs`)
    - `sample/` (`loader.rs`, `format.rs`, `peaks.rs`)

---

## Test plan

- [ ] **Manual:** Load a 5+ minute audio file. Verify waveform peaks render instantly via binary IPC.
- [ ] **Manual:** Trigger choke groups in Drum mode. Verify click-free cutoffs (3ms fade).
- [ ] **Automated:** Unit tests for `AtomicU64` voice allocator.
- [ ] **Automated:** Integration tests for YIN detector accuracy with parabolic refinement.
- [ ] **Automated:** SPSC ring buffer starvation tests.

---

## Tradeoffs and risks

- **Risk:** Variations in disk I/O latency. **Mitigation:** 64KB ring buffers (~186ms) and priority queue scheduling.
- **Tradeoff:** CPU vs. Quality for IPL Phase Vocoder. **Mitigation:** Pre-allocated FFT buffers and SIMD-ready SoA data layout.

## Implementation Status

- **What is implemented:** Basic sampler functionalities are present within `Fermenter` (`sampler.rs`), `Levain` (`voice.rs`), and `Grand_Boule` (`attack_sampler.rs`).
- **What is not implemented:** A standalone `sampler_engine` Rust crate or a dedicated `modules/Sampler` React module for the Unified Sampler Suite. The four playback modes, unified UI, and advanced warp/slice features as a standalone instrument are missing.
- **What is done well:** Core audio primitives (reading buffers, basic playback) exist in other engines.
- **What needs refactoring:** The sampler logic needs to be consolidated into the proposed `sampler_engine` architecture and the frontend `Sampler` module needs to be built from scratch.
