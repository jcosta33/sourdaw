# Unified Sampler Suite

## Context

No single DAW sampler combines all best-in-class workflows. Ableton leads in speed, Logic in intelligence (auto-analysis), FL Studio in per-slice control, and Bitwig in modulation depth. The goal of this architecture is to provide a single instrument that unifies these workflows while maintaining strict real-time safety on the audio thread.

Reference relevant research: `.agents/research/unified-sampler-suite.md`

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
   - Voice pool MUST be pre-allocated to 128 voices.
   - Allocation MUST use two `AtomicU64` values as a bitfield. Finding a free voice MUST use `trailing_zeros()` and `compare_exchange_weak` with `AcqRel` ordering.
   - Voice stealing MUST follow this priority: Same-note retrigger -> Choke group -> Releasing voices -> Oldest active -> Quietest. 
   - Stolen voices MUST receive a 1-5ms linear fade-out before reassignment.

3. **Wait-Free Disk Streaming (DFD)**
   - Each voice MUST own a dedicated pair of `rtrb::RingBuffer<f32>` (ping-pong) filled by the background I/O thread.
   - **Budgets:** 12KB preload (~68ms) per sample in RAM, 64KB (~186ms) ring buffer per voice. 
   - **I/O Thread:** MUST use a priority queue sorted by `buffered_samples_remaining`. 
   - **Underrun:** MUST apply an inverse ramp (64 samples) to fade to silence.

4. **Background Auto-Analysis**
   - **Onset Detection:** MUST implement SuperFlux (universal), HFC (percussive), and Complex Domain (melodic). Peak picking MUST use adaptive thresholding (pre_avg=12, post_avg=6 frames) and snap to nearest zero-crossing (5-50 sample window).
   - **Pitch Detection:** YIN algorithm (via `pitch-detection` crate) using a 0.15 threshold over multiple 2048-sample windows. MUST use parabolic interpolation for sub-bin refinement.
   - **BPM Estimation:** Percival-Tzanetakis autocorrelation method (GAC autocorrelation of onset strength signal).
   - **Waveform Peaks:** Hierarchical mipmap reduction (Min/Max pairs). Level 0 base block size: 32 or 64 samples. Subsequent levels MUST be powers of 2.

5. **Precision DSP Implementation**
   - **Interpolation:** Pitched playback MUST use 4-point Cubic Hermite interpolation. Offline sample rate conversion (at load time) MUST use `rubato` windowed sinc.
   - **AHDSR Envelope:** 6-state machine (Idle, Attack, Hold, Decay, Sustain, Release). MUST use 1-multiply iterative exponential curve (`level = (level - offset) * multiplier + offset`). `target_ratio` MUST be adjustable (0.0001 for exponential, 1.0+ for linear).
   - **Filter:** MUST implement Cytomic/Zavalishin TPT SVF. MUST provide simultaneous LP, HP, BP, and Notch outputs. MUST use 2x oversampling for resonance $Q > 10$.
   - **Parameter Smoothing:** One-pole exponential smoother (5-20ms time constant). MUST include denormal prevention (tiny DC offset $1e^{-18}$ or flush-to-zero).
   - **Looping:** Equal-power crossfade (sin/cos gains) at loop boundaries (Forward, PingPong, Reverse). Default length: 50-500 samples.

6. **Warp Engine Mechanics**
   - **Phase Vocoder:** Identity Phase Locking (IPL) MUST identify spectral peaks and lock surrounding bin phases. FFT size: 2048. Overlap: 75% (hop = N/4). Pre-allocate all buffers via `realfft`.
   - **WSOLA:** Frame length: 1024. Overlap: 512. Tolerance window ($\Delta_{max}$): 256. Cross-correlation MUST be optimized via FFT or 4x downsampling.
   - **Granular:** MUST support Hann, Triangle, Tukey, and Gaussian grain window shapes. Inter-onset time (IOT) MUST allow randomization (jitter) up to 30%.

7. **Tauri v2 IPC & UI Performance**
   - **Binary IPC:** Waveform mipmaps MUST be transferred via raw `ArrayBuffer` using `tauri::ipc::Response`.
   - **Position Tracking:** UI MUST update from the `playback_position` channel (emitted at 30Hz). Management thread MUST sample an `AtomicU64` written by the audio thread.
   - **Metering:** Audio thread MUST write `peak_level` and `active_voice_count` to atomics with `Relaxed` ordering.
   - **Responsiveness:** The playback cursor MUST use `requestAnimationFrame` for 60fps visual interpolation between 30Hz position updates. Waveform rendering MUST use mipmap levels to enable smooth, lag-free zoom.

8. **State Management & Interaction**
   - **Stores:** Frontend state MUST use lightweight stores (Zustand) to manage mode, sample metadata, and pad/slice configurations. 
   - **Markers:** Interaction with draggable slice markers MUST be debounced (50ms) to prevent IPC flooding.
   - **Direct Recording:** The engine MUST support a "Recorder" mode with SP-404 style threshold triggering to capture audio directly into memory buffers.

---

## Critical DSP Constants

| Constant | Value | Description |
| :--- | :--- | :--- |
| `MAX_VOICES` | 128 | Pre-allocated voice pool size |
| `PRELOAD_SIZE` | 12KB | RAM-cached attack per sample |
| `STREAM_BUF_SIZE`| 64KB | Per-voice ring buffer capacity |
| `FFT_SIZE_PV` | 2048 | Phase Vocoder STFT window |
| `WSOLA_FRAME` | 1024 | WSOLA frame length |
| `WSOLA_TOLERANCE`| 256 | WSOLA search window ($\Delta_{max}$) |
| `ENV_TARGET_EXP` | 0.0001 | AHDSR target ratio for exponential curve |
| `FADE_STOLEN` | 1-5ms | Linear fade-out for stolen voices |
| `FADE_UNDERRUN` | 64 samples | Inverse ramp for buffer starvation |

---

## Constraints

- Must follow the domain-driven module architecture (`AGENTS.md`).
- Must integrate cleanly with `daw-dsp` and `daw-engine`.
- Audio thread operations MUST execute in O(1) bounded time (no unpredictable loops).

---

## Design decisions

### Decision: Lock-free streaming vs Direct memory mapping on RT thread

**Chosen:** `rtrb`-based wait-free SPSC ring buffers serviced by a priority-queued background disk I/O thread, combined with a RAM preload for the first 12KB (attack).
**Considered and rejected:** Direct memory mapping on the audio thread. Page faults would block the RT thread, causing audio dropouts.

### Decision: Onset Detection Algorithm

**Chosen:** SuperFlux for universal use (robust against vibrato) and HFC (High-Frequency Content) for fast percussive analysis.
**Considered and rejected:** CNN-based (madmom) onset detection. Rejected for initial implementation due to the overhead of integrating ONNX/`ort`.

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