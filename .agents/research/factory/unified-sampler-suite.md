# Unified Sampler Suite: architecture for a Tauri v2 DAW

**No single DAW sampler combines all best-in-class workflows — and this gap defines the architectural opportunity.** Ableton's drag-and-play speed, Logic's auto-analysis intelligence, Bitwig's modulation depth, and FL Studio's per-slice articulators each lead in isolation, yet users across every major forum consistently wish for one instrument that unifies them all. This document provides the UX research, algorithmic foundations, and concrete Rust/React architectural blueprint for a Unified Sampler Suite that closes these gaps while maintaining strict real-time safety on the audio thread.

The architecture targets four sampler modes — Quick, Drum, Slice, and a shared Warp engine — sharing a common Rust voice engine, disk streamer, and onset detector, with mode-specific MIDI mapping and UI logic handled in React/TypeScript via Tauri v2 IPC.

---

## Part 1 — Competitor UX matrix and workflow analysis

### The landscape: four approaches to sampling, none complete

**Ableton Live (Simpler/Sampler/Drum Rack)** owns the speed crown. Dragging audio onto a MIDI track auto-creates a Simpler; clicking "Slice" maps transients to pads in seconds. Its three Simpler modes (Classic, 1-Shot, Slice) plus six warp algorithms (including Elastique-powered Complex Pro) cover most workflows. The Simpler→Sampler upgrade path — one right-click — gives access to a full multi-zone modulation matrix. Drum Rack nesting gives each slice its own channel strip. **Power users love** the workflow velocity. **They hate** that Drum Rack defaults Simpler to Classic mode instead of 1-Shot (requiring manual user-library configuration for every pad), that there's no direct recording into the sampler, and that preset management is "inelegant."

**Logic Pro (Quick Sampler/Sampler/Drum Machine Designer)** leads in intelligence. Quick Sampler's four drop zones — Original, Optimized, Slice, Recorder — represent the most complete single-instrument workflow. **Optimized mode auto-detects pitch, loudness, and loop points** on a single drag. The built-in Recorder mode captures audio directly to the sampler, eliminating a multi-step workflow no other DAW matches. Flex Speed is a modulation target, enabling LFO-controlled time-stretching. **Users praise** the "zero-friction" Option+drag track creation and auto-MIDI-pattern generation. **They criticize** less flexible routing compared to Ableton's nested racks.

**FL Studio (Slicex/DirectWave)** offers the deepest per-slice manipulation. Slicex's **8 Articulator groups** give each slice independent envelopes and filters. Dual decks with Mod X/Y crossfading enable sample morphing unavailable elsewhere. Edison integration provides seamless drag-copy between editor and slicer. **Power users love** the granular control and piano roll integration. **They hate** the dated interface and the absence of a proper Drum Rack equivalent.

**Bitwig Studio** dominates modulation and sound design. Its unified modulation system — where any parameter on any device becomes a modulation target — is years ahead. The sampler offers granular and wavetable modes natively, and full MPE support. Voice stacking with per-voice detuning creates layered sounds impossible elsewhere. **Power users love** the creative depth and Grid integration. **They hate** the absence of direct-to-sampler recording and the multi-step slice-to-pad workflow.

### Feature comparison across DAW samplers

| Capability                    | Ableton                            | Logic Pro                              | FL Studio           | Bitwig                         |
| ----------------------------- | ---------------------------------- | -------------------------------------- | ------------------- | ------------------------------ |
| One-click sample loading      | ✅ Drag to Drum Rack               | ✅ Option+drag                         | ✅ Channel Sampler  | ✅ Browser drag                |
| Auto-slicing modes            | Transient / Beat / Region / Manual | Transient+Note / Beat / Equal / Manual | Beat detection algo | Onset threshold / Beat / Event |
| Built-in recording to sampler | ❌                                 | ✅ Recorder mode                       | ⚠️ Via Edison       | ❌                             |
| Time-stretch in sampler       | 6 warp modes (incl. Elastique)     | 5 Flex algorithms                      | Per-slice only      | 8 algorithms (incl. Elastique) |
| Auto-pitch detection          | ❌ Manual root note                | ✅ Optimized mode                      | ✅ Edison           | ❌ Manual                      |
| Per-slice FX processing       | ✅ Via Drum Rack chains            | ✅ Per-pad Quick Sampler               | ✅ 8 Articulators   | ⚠️ Via chains                  |
| Modulation depth              | Basic (1 LFO, envelopes)           | Mod matrix (20 slots)                  | 8 Articulators      | ✅✅ Unlimited, visual         |
| Granular mode                 | ❌ (Max4Live needed)               | ❌ (Alchemy separate)                  | ❌                  | ✅ Built-in                    |
| Multi-sample zones            | ✅ Sampler (4 zone types)          | ✅ Unlimited zones                     | ✅ DirectWave       | ✅ Full editor                 |
| Slice→Drum pad (steps)        | 2 clicks                           | 1 click (Create DMD)                   | 2-3 clicks          | 3+ clicks                      |

### What users want that nobody builds

Forum analysis across Reddit, KVR, and Gearspace reveals **eight persistent gaps**:

1. **Context-aware defaults** — detect if a sample is percussive (→ auto-1-shot), a loop (→ auto-slice), or tonal (→ auto-classic with root key). No DAW currently does this, and Ableton's wrong-default-mode complaint is the single most cited frustration.
2. **Record directly to pads** with MPC/SP-404-style threshold triggering — Logic's Recorder is close but limited to one sample at a time.
3. **Independent time-stretch** decoupled from project BPM, as a playable/modulatable parameter.
4. **Unified granular + traditional + slice modes** in one instrument with seamless switching.
5. **Auto-pitch and auto-BPM detection** on every sample import, universally.
6. **In-place slicing** that converts to playable pads without creating a new track or leaving the sampler.
7. **Deep per-slice modulation** (Bitwig-level) combined with per-slice FX chains (Ableton Drum Rack-level).
8. **Smart loop-point detection** that finds zero-crossings and sets crossfade lengths automatically.

### Best-in-class workflow benchmarks

The three target workflows have clear speed leaders. **Loading a one-shot**: Ableton — drag to pad, done (**2 actions**). **Slicing a loop to pads**: Logic — drag to Quick Sampler Slice → Create DMD Track, auto-generates MIDI (**4 actions**, 1 click to convert). **Time-stretching to BPM**: Ableton — drag to track, auto-warps to project tempo (**2 actions**, zero configuration). A unified sampler should match or beat these action counts for each workflow.

---

## Part 2a — Warping and time-stretching algorithms

### Phase vocoder: the frequency-domain workhorse

The phase vocoder decomposes audio into overlapping STFT frames, modifies them in the frequency domain, and resynthesizes via overlap-add. For a signal windowed at analysis hop Hₐ, the instantaneous frequency at bin k is estimated from the phase advance between consecutive frames:

**ω_inst(m,k) = 2πk/N + unwrap(Δφ(m,k) − 2πkHₐ/N) / Hₐ**

Synthesis phases accumulate at the modified hop Hₛ: **φₛ(m,k) = φₛ(m−1,k) + Hₛ · ω_inst(m,k)**. The stretch ratio α = Hₛ/Hₐ. Typical parameters: **N = 2048 samples** (~46ms at 44.1kHz), **hop = N/4** (75% overlap), Hann window.

The standard phase vocoder preserves horizontal phase coherence (across time) but destroys vertical coherence (across frequency bins within a frame), producing the characteristic "phasiness" — a metallic, reverberant quality. **Identity phase locking** (Laroche & Dolson, 1999) solves this by identifying spectral peaks, propagating phases only at peaks, and forcing surrounding bins to maintain their original inter-bin phase relationships: **φₛ(m,k) = φₛ(m,k*) + [φₐ(m,k) − φₐ(m,k*)]** where k\* is the nearest peak.

The newer **RTPGHI algorithm** (Průša & Holighaus, 2022) integrates both partial derivatives of STFT phase — time and frequency — via heap-based integration, automatically enforcing both coherence dimensions without peak picking.

### WSOLA: time-domain simplicity for transients

WSOLA (Verhelst & Roelands, 1993) avoids frequency-domain artifacts entirely. It extracts overlapping frames at synthesis positions and searches within a tolerance window Δ_max for the position that maximizes waveform similarity in the overlap region:

**Δ*{m+1} = argmax*{δ} Σᵣ x̃_m(r) · x(r + σ(m+1) + δ)**

Typical frame length is **50–100ms**, tolerance Δ_max = N/2. Computational cost is O(N · 2Δ_max) per frame — significantly cheaper than the phase vocoder. WSOLA **excels at transients and speech** because it operates in the time domain, preserving waveform shape. It struggles with polyphonic content (only one dominant period can be matched) and degrades beyond **2× stretch ratio**.

### How the best commercial engines work

All three leading implementations use different strategies for the same core challenge: transient preservation alongside tonal fidelity.

**Elastique Pro** (zplane) is proprietary but acknowledged as best-in-class. It integrates transient detection directly into the stretching pipeline, with separate processing paths for transient and tonal regions. Its "infiniteStretch" mode holds audio indefinitely. It powers Ableton's Complex Pro, Bitwig's stretcher, Pro Tools, and many others. **All DAWs using Elastique Pro produce identical audio quality** — the difference is purely in workflow, as confirmed by zplane's CTO.

**Rubber Band Library** (v3, R3 engine) achieves near-Elastique quality in open source. Critically, **it is RT-safe when used in real-time mode** — performing no allocation, locking, or blocking after initialization, even when ratios change. The pull-model API queries `getSamplesRequired()`, feeds that many samples, then retrieves output. Start delay is **2048–4096 samples** at 44.1kHz. GPL or commercial license.

**Signalsmith Stretch** takes a novel approach: multiple phase predictions (horizontal, vertical, upward/downward sweeps) blended via weighted complex averaging, with non-linear frequency mapping that preserves harmonics. MIT-licensed, header-only C++ with existing Rust bindings (`ssstretch` crate). Quality is excellent for pitch-shifting and moderate time-stretching (0.75×–1.5×), but degrades at extreme ratios due to limited transient handling.

### The hybrid approach: sines, transients, noise decomposition

State-of-the-art quality comes from **STN decomposition** (Fierro & Välimäki, Aalto University). The signal is separated into three components processed independently: **sines** (phase vocoder with identity phase locking), **transients** (repositioned unmodified on the new time axis), and **noise** (spectral morphing with white-noise excitation). Recombining produces the highest MUSHRA scores, especially at **4× stretch and beyond**.

### Algorithm selection matrix

| Algorithm           | Tonal quality | Transient quality | CPU         | Latency | Best for                                     |
| ------------------- | ------------- | ----------------- | ----------- | ------- | -------------------------------------------- |
| Phase vocoder + IPL | Good          | Poor (smearing)   | Medium      | ~50ms   | Sustained tones, pads                        |
| WSOLA               | Medium        | Good              | Low         | ~100ms  | Drums, speech, real-time                     |
| Signalsmith Stretch | Very good     | Medium            | Medium-high | ~50ms   | Pitch shifting, moderate stretch             |
| Rubber Band R3      | Very good     | Good              | Medium-high | ~90ms   | General purpose, highest open-source quality |
| STN hybrid          | Excellent     | Excellent         | High        | Offline | Master-quality offline rendering             |

### Real-time Rust implementation strategy

Pre-allocate all FFT buffers at initialization using `realfft` (wrapper around `rustfft` for real-valued signals — ~2× speedup). Store magnitudes and phases in separate contiguous arrays (SoA layout) for SIMD auto-vectorization. Use `AtomicU32` to store float parameters as bit patterns for lock-free ratio updates from the UI thread. Circular input/output buffers with fixed capacity handle variable stretch ratios by adjusting the number of input samples consumed per output block — no allocation needed for ratio changes.

The recommended engine architecture is a **dual-mode stretcher**: WSOLA for percussive content and the Beats warp mode, phase vocoder with identity phase locking for tonal content. A transient detector switches between paths automatically, or the user selects a warp mode explicitly. For the highest quality mode, integrate Rubber Band via C FFI (GPL) or Signalsmith Stretch via the `ssstretch` crate (MIT).

---

## Part 2b — Disk streaming without blocking the RT thread

### How Kontakt and HISE solve this problem

Every professional sampler converges on the same architecture: **RAM-cached attack + disk-streamed sustain**. Kontakt's DFD engine preloads the first **60KB** of each sample into RAM (~340ms at 44.1kHz/16-bit stereo). When a note triggers, playback starts instantly from the preload buffer while a background I/O thread fetches the continuation. With modern NVMe SSDs, Spitfire Audio recommends reducing preloads to just **6KB** (~34ms) — enough to cover SSD seek latency.

HISE's open-source streaming engine reveals the full implementation: each active voice gets **two streaming buffers** in a ping-pong pattern. While the audio thread reads buffer A, the I/O thread fills buffer B. When A is exhausted, they swap. Buffer sizes must account for pitch ratio: a sample pitched up 3 octaves (ratio 8×) with a 512-sample audio callback needs **4096 samples** of streaming buffer. Samples exceeding a `MAX_SAMPLER_PITCH` threshold are loaded entirely into RAM.

HISE uses **memory-mapped files** via 64-bit address space, letting the OS manage page caching. Its custom HLAC lossless codec normalizes 24-bit samples in 1024-sample chunks, halving streaming buffer memory while preserving dynamic range. Samples are packed into monolith `.ch1` files for sequential access performance.

### Lock-free ring buffer architecture

The `rtrb` crate is the recommended RT↔I/O boundary. It provides **wait-free SPSC** guarantees — all operations complete in bounded time, with `push()` returning `Err(Full)` and `pop()` returning `Err(Empty)` instead of blocking. The `rtrb-basedrop` fork ensures deallocation never occurs on the RT thread.

```
┌──────────────────────┐   Commands (rtrb SPSC)    ┌──────────────────┐
│   AUDIO RT THREAD    │ ────────────────────────►  │   DISK I/O       │
│                      │                            │   THREAD         │
│  Voice 1 → pop()     │   Per-Voice Audio (rtrb)   │                  │
│  Voice 2 → pop()     │ ◄──────────────────────── │  Priority queue  │
│  Voice N → pop()     │   [f32 samples]            │  by urgency      │
│                      │                            │                  │
│  Send: NEW_VOICE,    │   Voice Status (atomics)   │  Read from mmap  │
│  STOP_VOICE          │ ◄────────────────────────► │  Decode if needed│
│  unpark() I/O thread │                            │  Push to ringbuf │
└──────────────────────┘                            └──────────────────┘
```

Each active voice owns a dedicated `rtrb::RingBuffer<f32>` pair. The I/O thread services voices in a priority queue sorted by `buffered_samples_remaining` ascending — the voice about to run dry gets read first.

### Buffer sizing for 128 voices on NVMe

For a typical configuration at 44.1kHz stereo f32 with 128 max voices on NVMe:

- **Preload per sample**: 12KB (~68ms mono 16-bit) — covers NVMe seek latency with margin
- **Ring buffer per voice**: 16,384 f32 samples = 64KB (~186ms) — survives I/O latency spikes
- **I/O chunk size**: 4,096 samples per read (~16KB, aligns with disk blocks)
- **Voice buffer pool total**: 128 × 64KB × 2 channels = **16MB**
- **Preload total** (5,000 samples): 5,000 × 12KB = **60MB**
- **Command queue**: 256 entries (exceeds any single callback's needs)

Total streaming memory: **~76MB** — trivial for modern systems. On buffer underrun, apply an inverse ramp over 64 samples to fade gracefully to silence, mark the voice as starved, and resume with a fade-in when data arrives.

---

## Part 2c — Onset detection and auto-slicing algorithms

### Five onset detection functions, ranked

The **spectral flux** ODF sums positive magnitude differences between consecutive STFT frames: SF(n) = Σₖ H(|X(n,k)| − |X(n−1,k)|). Half-wave rectification ignores energy decreases, emphasizing onsets over offsets. Simple, fast, ~85% F-measure.

**High-frequency content** (HFC) weights each bin's energy by its frequency index: HFC(n) = Σₖ k · |X(n,k)|². Percussive transients produce broadband bursts that the weighting amplifies. This is **aubio's default method** — very fast, ~82% F-measure, but poor on soft or low-pitched onsets.

The **complex domain** ODF measures the Euclidean distance in the complex plane between the observed STFT and a prediction based on constant phase advancement: CD(n) = Σₖ |X(n,k) − X_target(n,k)|, where X_target extrapolates magnitude and phase from two prior frames. It catches **both energy changes and phase changes**, making it the best single general-purpose ODF at ~85% F-measure.

**SuperFlux** (Böck & Widmer, 2013) applies a maximum filter across adjacent frequency bins before computing log spectral flux: instead of comparing bin k at frame n with the same bin at frame n−1, it compares with **max(bin k−1, k, k+1)** at frame n−d. This tracks vibrato-induced frequency modulation, **reducing false positives by up to 60%** in vibrato-heavy music. At ~87–88% F-measure, it offers the best accuracy-to-complexity ratio among classical methods.

**CNN-based onset detection** (Schlüter & Böck, 2014) processes mel-spectrogram patches through convolutional layers, achieving **~90%+ F-measure** — a 3% improvement over SuperFlux. Inference is fast enough for offline slicing (sub-second for a 5-minute track). The `ort` crate provides production-ready ONNX Runtime bindings for Rust, enabling pre-trained models from madmom to run natively.

### Adaptive peak picking and zero-crossing snap

Raw ODFs require thresholding to extract onset times. The Böck et al. method declares an onset at frame n when the ODF exceeds both a **moving average** (pre_avg=12, post_avg=6 frames) plus a threshold offset, and is a **local maximum** (pre_max=6, post_max=6 frames). Minimum inter-onset interval prevents rapid re-triggering (20–50ms for drums, 100ms for melodic content).

For click-free slicing, onset positions are refined by scanning backward for the nearest **zero-crossing** within a 5–50 sample window. Even with zero-crossing snap, a **1–5ms raised-cosine fade** at slice boundaries is essential — the waveform's slope discontinuity alone can produce audible clicks.

### BPM detection for beat-grid alignment

The Percival-Tzanetakis method computes an onset strength signal, applies generalized autocorrelation GAC(τ) = IFFT(|FFT(OSS)|^0.5), picks peaks within the tempo range (50–200 BPM), and scores candidates by cross-correlating with pulse trains. For well-cut loops, a simpler heuristic works: **BPM = 60 × expected_beats / duration_seconds**. Beat tracking refines this to exact positions using dynamic programming, enabling "snap to grid" quantization of slice points to the nearest 1/16th, 1/8th, or 1/4 note.

### Recommended implementation for the sampler

Implement **SuperFlux** as the primary onset detector (best classical accuracy, vibrato-robust), with **HFC** as a fast percussive-optimized alternative. Expose to users as detection modes: "Percussive" (HFC), "Melodic" (Complex Domain), "Universal" (SuperFlux), "AI" (CNN via `ort`). A single **sensitivity slider** maps to the peak-picking threshold: `threshold = 1.0 − sensitivity × 0.9`. Use `rustfft`/`realfft` for STFT computation, with the full spectrogram computed once and reused across multiple ODFs.

---

## Part 2d — Polyphony, voice stealing, and lock-free allocation

### Atomic bitfield voice allocation

A pre-allocated array of **128 voice structs** (each cache-line aligned at 64 bytes) forms the voice pool. Free-voice tracking uses **two `AtomicU64` values** as a 128-bit bitfield — bit set means free, bit clear means in use. Finding a free voice calls `trailing_zeros()` on each word (**O(N/64)** — scanning 128 voices checks just 2 words). Claiming uses `compare_exchange_weak` with `AcqRel` ordering. Releasing sets the bit with `fetch_or` and `Release` ordering. This is entirely **lock-free and wait-free** — no mutex, no allocation, no blocking.

### Composite voice-stealing priority

When all voices are active, the engine must steal one. The priority cascade, derived from analysis of Kontakt, Surge XT, HISE, and MPC implementations:

1. **Same-note**: If the new note matches an active voice's note, retrigger that voice (essential for realistic performance — RNBO's voice allocator makes this the top priority)
2. **Choke group**: Kill all voices in the same mute group with a **3ms fade-out** (open/closed hi-hat is the canonical example)
3. **Releasing voices**: Voices in their release envelope phase are least audible — steal the quietest among these
4. **Oldest active voice**: FIFO tiebreaker using a monotonic age counter incremented on each note-on
5. **Quietest active voice**: Weighted secondary criterion based on current envelope amplitude

Stolen voices receive a **1–5ms linear fade-out** before reassignment. This eliminates clicks without audible gaps. One KVR developer notes: "With 32+ voices, I can get away with it even without fading — but you shouldn't."

### Round-robin and velocity layering

Per-note round-robin counters cycle through sample variants to eliminate the "machine gun effect." Professional libraries use **5+ velocity layers × 10 round robins = 50 samples per key**. A practical tip from MusicRadar: use an **odd number of RR samples** relative to the time signature (5 or 7 in 4/4) so the cycling never aligns with beats. Random-robin with repeat avoidance provides additional variation — pick a random index, skip if it matches the last played.

### Sharing state between audio and UI threads

For metering and visual feedback, each voice exposes `AtomicU32` fields (peak level, state, note) written by the audio thread with `Relaxed` ordering and read by the UI thread with `Relaxed` ordering. Tearing is acceptable for display purposes. For commands (parameter changes, preset loads), use `rtrb` SPSC ring buffers — the audio thread polls the consumer end each block. The `assert_no_alloc` crate in debug builds panics on any heap allocation during `process()`, catching violations at development time.

---

## Part 3 — Rust module architecture and React/TypeScript frontend

### Three-thread model with strict RT separation

The architecture enforces a hard boundary: the **audio RT thread** touches only pre-allocated memory and atomic operations. The **engine management thread** handles sample loading, onset analysis, warp engine initialization, and Tauri command handlers. The **disk I/O thread** services streaming buffers.

```
┌──────────────────────────────────────────────────────────────────┐
│  REACT / TYPESCRIPT UI (WebView)                                 │
│  ┌────────────┐ ┌────────────┐ ┌───────────┐ ┌───────────────┐  │
│  │ WaveformView│ │ PadGrid    │ │SliceMarkers│ │ ControlPanel │  │
│  │ (Canvas/GL) │ │ (4×4/8×2) │ │(draggable) │ │ (knobs/faders│  │
│  └──────┬─────┘ └─────┬──────┘ └─────┬─────┘ └──────┬────────┘  │
│         │              │              │               │           │
│         └──────────────┴──────────────┴───────────────┘           │
│                            │ invoke() / events                    │
│                            ▼                                      │
├──────────────────── Tauri IPC Boundary ──────────────────────────┤
│                                                                   │
│  ENGINE MANAGEMENT THREAD (Tauri async commands)                  │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ sampler::commands  (load_sample, set_slice_points,        │   │
│  │                     set_warp_mode, set_pad_mapping,       │   │
│  │                     get_waveform_peaks, analyze_onsets)    │   │
│  └───────────────────────┬───────────────────────────────────┘   │
│                           │ rtrb SPSC ring buffers               │
│                           ▼                                      │
│  AUDIO RT THREAD (cpal callback)                                 │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ sampler_engine::process()                                  │   │
│  │  ├── voice_allocator  (AtomicU64 bitfield)                 │   │
│  │  ├── voice_pool[128]  (pre-allocated)                      │   │
│  │  │    ├── sample_reader (preload buf → ring buf consumer)  │   │
│  │  │    ├── warp_engine  (PV/WSOLA per voice)                │   │
│  │  │    ├── envelope     (AHDSR state machine)               │   │
│  │  │    ├── filter       (per-voice SVF)                     │   │
│  │  │    └── panner                                           │   │
│  │  ├── mode_logic        (Quick | Drum | Slice dispatch)     │   │
│  │  └── output_mixer                                          │   │
│  └───────────────────────┬───────────────────────────────────┘   │
│                           │ rtrb commands                        │
│                           ▼                                      │
│  DISK I/O THREAD                                                 │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ disk_streamer::run()                                       │   │
│  │  ├── priority queue (by buffered_samples_remaining)        │   │
│  │  ├── mmap / file read per voice                            │   │
│  │  └── producer.push_slice() into per-voice ring buffers     │   │
│  └───────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### Rust module hierarchy

```
sampler_engine/
├── lib.rs                    // Public API: SamplerEngine struct
├── voice/
│   ├── mod.rs                // Voice struct, VoiceState enum
│   ├── allocator.rs          // AtomicU64 bitfield allocator
│   ├── stealing.rs           // Composite priority voice stealing
│   ├── envelope.rs           // AHDSR state machine (no alloc)
│   └── pool.rs               // Pre-allocated [Voice; 128]
├── warp/
│   ├── mod.rs                // WarpEngine trait, WarpMode enum
│   ├── phase_vocoder.rs      // PV with identity phase locking
│   ├── wsola.rs              // Time-domain OLA with cross-correlation
│   ├── repitch.rs            // Simple resampling (speed = pitch)
│   └── granular.rs           // Grain cloud engine
├── streaming/
│   ├── mod.rs                // DiskStreamer, IoCommand enum
│   ├── preload.rs            // PreloadBuffer (first 12-64KB per sample)
│   ├── ring_buffer.rs        // Per-voice rtrb consumer wrapper
│   └── io_thread.rs          // Background reader with priority queue
├── analysis/
│   ├── mod.rs                // AnalysisResult struct
│   ├── onset.rs              // SuperFlux, HFC, ComplexDomain ODFs
│   ├── peak_picker.rs        // Adaptive threshold + zero-crossing snap
│   ├── bpm.rs                // Autocorrelation tempo estimator
│   └── pitch.rs              // YIN pitch detector for auto root note
├── modes/
│   ├── mod.rs                // SamplerMode enum dispatch
│   ├── quick.rs              // Single-sample, warp-enabled playback
│   ├── drum.rs               // Multi-pad, choke groups, round-robin
│   └── slice.rs              // Slice map → MIDI note mapping
├── sample/
│   ├── mod.rs                // Sample struct (metadata + data ref)
│   ├── loader.rs             // symphonia decode on background thread
│   ├── format.rs             // WAV/AIFF/FLAC/MP3/OGG support
│   └── peaks.rs              // Mipmap peak generation for waveform UI
└── commands.rs               // #[tauri::command] handlers
```

### Shared vs. mode-specific components

The **voice allocator, warp engine, disk streamer, and envelope generator** are shared across all modes. Mode-specific logic is minimal and non-allocating:

- **Quick mode**: One sample loaded. MIDI note determines pitch (chromatic). Warp engine active. Simple: note → voice with pitch ratio = `2^((note - root) / 12)`.
- **Drum mode**: 128 pads, each with a sample assignment, choke group ID, and round-robin counter. Note-on dispatches to pad by MIDI note. Per-pad: `PadConfig { sample_id, choke_group, rr_count, velocity_layers, one_shot }`.
- **Slice mode**: A slice map (`Vec<SlicePoint>` with start/end sample positions) is frozen at analysis time. MIDI notes index into the slice array. The voice reads from `slice[note].start` to `slice[note].end`, optionally looping with crossfade.

Mode switching is a simple enum change — no reallocation. The voice pool doesn't care which mode triggered it; it just plays from a start position to an end position with a given pitch ratio and warp configuration.

### Tauri v2 IPC design for the sampler

Tauri v2's IPC uses custom protocol requests (ipc://) rather than postMessage, supporting **raw binary payloads** via `tauri::ipc::Response` for array buffers. This is critical for waveform peak data transfer. Key commands:

**Frontend → Rust (invoke):**

- `load_sample(path: String) → SampleMetadata` — decodes on background thread via symphonia, computes peaks, runs auto-analysis (pitch, BPM, onset detection), returns metadata + sample ID
- `analyze_onsets(sample_id: u64, mode: String, sensitivity: f32) → Vec<SlicePoint>` — runs SuperFlux/HFC/CNN, returns slice positions
- `set_sampler_mode(mode: "quick" | "drum" | "slice")` — switches mode logic
- `set_pad_config(pad: u8, config: PadConfig)` — configures drum pad mapping
- `set_warp_params(mode: WarpMode, ratio: f32, pitch: f32)` — queued to RT thread via rtrb
- `get_waveform_peaks(sample_id: u64, width: u32) → Vec<u8>` — returns raw binary via `tauri::ipc::Response` for optimal transfer (~5ms for 10MB on macOS)

**Rust → Frontend (events + channels):**

- `playback_position` — emitted at **~30Hz** (not per-sample) via Tauri Channel API with index-based ordering. The audio thread writes position to an `AtomicU64`; a timer on the management thread samples it and pushes to the channel.
- `voice_activity` — JSON payload with active voice count, peak levels per pad, for meter animation
- `analysis_complete` — fired when onset detection or BPM analysis finishes

The critical insight: **never send audio data through IPC**. Audio flows through cpal directly. IPC handles only control messages, metadata, and visualization data (peaks, positions, levels). Peak data for waveforms is pre-computed at multiple zoom levels (mipmap pattern) and sent as raw `ArrayBuffer` via `tauri::ipc::Response`.

### React/TypeScript frontend architecture

**Waveform rendering** uses **WebGL** via a lightweight wrapper (or Canvas 2D as fallback). Pre-computed peak data at multiple resolutions (stored as min/max pairs per pixel column) enables smooth zoom without recomputation. At 1920px width, only ~3,840 f32 values are needed per zoom level. Use `requestAnimationFrame` for the playback cursor; update position from the `playback_position` channel at 30Hz, interpolate visually at 60fps.

**State management** with **Zustand** (lightweight, no boilerplate) over Redux. Three stores:

- `useSamplerStore` — mode, current sample metadata, warp params, global settings
- `usePadStore` — 128 pad configurations for drum mode, choke groups, RR settings
- `useSliceStore` — slice points array, selected slice, sensitivity, detection mode

**Slice markers** are absolutely-positioned `<div>` elements overlaid on the waveform canvas, made draggable via pointer events. Each marker publishes its new position to `useSliceStore`, which batches updates and invokes `set_slice_points` on the Rust backend. Debounce at 50ms prevents IPC flooding during drags.

**Drag-and-drop** leverages Tauri's built-in `DragDropEvent` (renamed from `FileDropEvent` in v2). The frontend listens for file drops on specific zones (waveform area, individual pads), extracts the file path, and invokes `load_sample`. For pad-to-pad reordering within the drum grid, use HTML5 drag-and-drop with `dataTransfer` carrying the pad index.

**Pad grid** renders as a CSS Grid (4×4 or 8×2, user-switchable). Each pad cell shows the sample name, a mini waveform thumbnail, and a velocity-sensitive flash animation triggered by MIDI input (voice_activity events). Pad color indicates choke group membership.

### Key Rust crate dependencies

| Crate                 | Purpose                               | RT-safety                   |
| --------------------- | ------------------------------------- | --------------------------- |
| `cpal`                | Audio I/O (callback-based)            | Callback is the RT thread   |
| `rtrb`                | Wait-free SPSC ring buffer            | ✅ Designed for audio       |
| `rtrb-basedrop`       | Deferred deallocation                 | ✅ Never frees on RT thread |
| `realfft` / `rustfft` | FFT for PV and onset detection        | ✅ Pre-allocate scratch     |
| `symphonia`           | Audio decoding (WAV/FLAC/MP3/OGG/AAC) | Non-RT only (I/O thread)    |
| `memmap2`             | Memory-mapped file access             | Non-RT only (I/O thread)    |
| `crossbeam-channel`   | MPSC for non-RT communication         | Non-RT only                 |
| `ort`                 | ONNX Runtime for CNN onset detection  | Non-RT only (analysis)      |
| `assert_no_alloc`     | Debug: panic on RT allocation         | Debug builds only           |
| `tauri` v2            | Application framework + IPC           | Management thread           |

---

## Conclusion: the architecture that bridges every gap

The unified sampler suite achieves its design goals through **three architectural principles**. First, strict thread separation: the RT audio thread owns only pre-allocated voice structs, atomic bitfields, and ring buffer consumers — it never allocates, locks, or touches the filesystem. Second, shared-engine composition: all four modes (Quick, Drum, Slice, and future modes) delegate to the same voice pool, warp engine, and disk streamer, differing only in how they map MIDI notes to playback parameters. Third, smart defaults driven by analysis: on sample load, the `analysis` module runs pitch detection, BPM estimation, and onset detection in parallel on a background thread, then recommends a mode (percussive → Drum/1-Shot, loop with tempo → Slice, tonal → Quick with auto-root-note). This eliminates the single most-complained-about friction point across all competing DAWs.

The dual-mode warp engine — WSOLA for transients, phase vocoder with identity phase locking for tonal content, with optional Rubber Band or Signalsmith integration for higher quality — covers the full spectrum from drum loops to vocal pads without requiring users to understand the underlying algorithms. The `rtrb`-based disk streaming architecture supports **128 concurrent voices** within a **76MB memory budget** on NVMe, with graceful degradation on slower storage. And the Tauri v2 IPC layer, designed to transfer only control messages and pre-computed visualization data (never audio), keeps the WebView responsive even during heavy polyphonic playback.

What makes this architecture meaningfully different from existing solutions is not any single subsystem, but the unification: a user drags an audio file onto the sampler, it auto-analyzes and enters the right mode, and they're playing within two actions — matching Ableton's speed with Logic's intelligence, Bitwig's depth available when they reach for it, and FL Studio's per-slice power under the hood.

# Unified Sampler Suite — v2 Implementation Addendum

**This addendum fills twelve implementation-critical gaps identified in the v1 architecture document.** Each section provides the algorithmic detail, per-sample pseudocode, and Rust-specific guidance an AI coding agent needs to implement the subsystem without guessing. All content is sourced from current research and documentation rather than training data.

---

## 1. Sample Interpolation

The v1 document omits the most fundamental DSP operation in any sampler: computing sample values at fractional positions. Every pitched voice requires this.

### Linear interpolation (minimum viable)

For a fractional read position `pos` with integer part `i` and fractional part `f`:

```
output = sample[i] * (1.0 - f) + sample[i + 1] * f
```

This is cheap but introduces high-frequency attenuation and aliasing. Acceptable only for quick previews.

### Cubic Hermite interpolation (recommended default)

Uses four sample points around the read position. The Hermite form avoids matrix inversion:

```
let x0 = sample[i - 1];
let x1 = sample[i];
let x2 = sample[i + 1];
let x3 = sample[i + 2];
let c0 = x1;
let c1 = 0.5 * (x2 - x0);
let c2 = x0 - 2.5 * x1 + 2.0 * x2 - 0.5 * x3;
let c3 = 0.5 * (x3 - x0) + 1.5 * (x1 - x2);
output = ((c3 * f + c2) * f + c1) * f + c0;
```

This gives excellent quality for most sampler use cases at 4 multiplies and 4 adds per sample. It is the interpolation used by most professional samplers in their default mode.

### Windowed sinc interpolation (highest quality)

For band-limited resampling (sample rate conversion or high-quality pitch shifting), a windowed sinc function is required. The mathematical foundation comes from Shannon's sampling theorem: a bandlimited signal can be perfectly reconstructed by convolving samples with a sinc function windowed by a Blackman-Harris or Kaiser window.

The `rubato` crate is the recommended Rust solution. It provides SIMD-accelerated (AVX on x86_64, NEON on aarch64) asynchronous sinc resampling with configurable quality. Its `process_into_buffer()` method performs no allocations, making it RT-safe after initialization. Key parameters from the rubato API:

```rust
let params = SincInterpolationParameters {
    sinc_len: 256,           // filter length (higher = better quality, more CPU)
    f_cutoff: 0.95,          // anti-aliasing cutoff (0.0–1.0)
    interpolation: SincInterpolationType::Cubic,  // between sinc points
    oversampling_factor: 256, // sinc table density
    window: WindowFunction::BlackmanHarris2,
};
```

For the Surge synthesizer's approach, sinc tables are pre-computed at initialization: a windowed sinc function is evaluated at `512 × oversampling_factor` points and stored. During playback, the table is indexed by the fractional position and the nearest values are interpolated — trading memory (~256KB) for avoiding expensive `sin()` calls on the audio thread.

### Recommended strategy for the sampler

Use cubic Hermite as the default interpolation for pitched playback (excellent quality-to-cost ratio). Use `rubato` (SincFixedOut variant) for sample rate conversion when a sample's native rate differs from the session rate — run this conversion on the I/O thread during loading, not on the RT thread. For the highest-quality "HQ" rendering mode, use sinc interpolation per-voice via pre-computed tables.

---

## 2. Phase Vocoder `process()` Flow

The v1 document provides the math (instantaneous frequency, identity phase locking) but not the actual block-by-block processing loop. Here is the complete per-block flow.

### Circular buffer architecture

The phase vocoder maintains:

- An **input circular buffer** of size `fft_size` (e.g. 2048)
- An **output circular buffer** of size `fft_size`
- An **analysis phase array** `phi_a[fft_size/2 + 1]` (previous frame phases)
- A **synthesis phase array** `phi_s[fft_size/2 + 1]` (accumulated synthesis phases)
- An `input_pos` counter tracking how many input samples have been consumed
- An `output_pos` counter tracking how many output samples have been produced

### Per-block processing loop

The audio callback requests `block_size` output samples (e.g. 128). The phase vocoder must decide how many input samples to consume based on the stretch ratio `alpha`:

```
fn process(input: &[f32], output: &mut [f32], alpha: f32) {
    let hop_a = fft_size / 4;          // analysis hop (fixed)
    let hop_s = (hop_a as f32 * alpha) as usize;  // synthesis hop (variable)

    // 1. Feed input samples into the input circular buffer
    input_ring.write(input);

    // 2. While we have enough output to fill the requested block:
    while output_written < block_size {

        // 2a. Check if we need a new STFT frame
        if output_ring.readable() < block_size {

            // 2b. Extract analysis frame from input ring, apply window
            input_ring.read_at(input_pos, fft_size, &mut frame);
            apply_hann_window(&mut frame);

            // 2c. Forward FFT (real → complex, using realfft)
            fft.process(&mut frame, &mut spectrum);

            // 2d. Compute magnitude and phase for each bin
            for k in 0..num_bins {
                mag[k] = spectrum[k].norm();
                phase[k] = spectrum[k].arg();
            }

            // 2e. Phase propagation with identity phase locking
            for k in 0..num_bins {
                // Expected phase advance for this bin
                let expected = 2.0 * PI * k as f32 * hop_a as f32 / fft_size as f32;
                // Actual phase deviation
                let delta = phase[k] - phi_a[k] - expected;
                // Unwrap to [-PI, PI]
                let delta_unwrapped = delta - (delta / (2.0 * PI)).round() * 2.0 * PI;
                // Instantaneous frequency
                let inst_freq = expected + delta_unwrapped;
                // Propagate synthesis phase at modified hop
                phi_s[k] += inst_freq * (hop_s as f32 / hop_a as f32);
            }

            // 2f. Identity Phase Locking (IPL):
            //     Find spectral peaks, lock surrounding bins
            find_peaks(&mag, &mut peak_indices);
            for k in 0..num_bins {
                let nearest_peak = find_nearest_peak(k, &peak_indices);
                if k != nearest_peak {
                    // Lock phase to nearest peak's phase relationship
                    phi_s[k] = phi_s[nearest_peak]
                        + (phase[k] - phase[nearest_peak]);
                }
            }

            // 2g. Reconstruct complex spectrum and inverse FFT
            for k in 0..num_bins {
                spectrum[k] = Complex::from_polar(mag[k], phi_s[k]);
            }
            ifft.process(&mut spectrum, &mut frame);
            apply_hann_window(&mut frame);

            // 2h. Overlap-add into output ring buffer
            output_ring.add_at(output_pos, &frame);
            output_pos += hop_s;

            // 2i. Advance input position
            input_pos += hop_a;
            phi_a.copy_from_slice(&phase);  // store for next frame
        }

        // 3. Read from output ring into the output buffer
        output_written += output_ring.read(&mut output[output_written..]);
    }
}
```

### Startup and flush

At initialization, pad the input ring with `fft_size` zeros to account for the analysis window's group delay. Report the start delay to the host as `fft_size / 2` samples. On flush (end of audio), feed `fft_size` zeros and drain the output ring.

### Variable ratio handling

When the stretch ratio changes mid-stream (e.g. from UI automation), update `hop_s` between frames — never mid-frame. The input consumption rate changes accordingly: higher `alpha` means more output per input, so the input ring drains more slowly. No reallocation is needed because the FFT size is fixed; only the hop ratio changes.

---

## 3. WSOLA Frame Advancement Logic

### Synthesis position tracking

WSOLA maintains a **synthesis time pointer** `t_s` and an **analysis time pointer** `t_a`. The relationship is: `t_a = t_s / alpha` where `alpha` is the stretch ratio. Both advance by `hop_s` and `hop_a` respectively, but `t_a` is adjusted by a delta found via cross-correlation.

### Per-frame processing

```
let frame_len = 1024;  // ~23ms at 44.1kHz
let overlap = frame_len / 2;
let delta_max = frame_len / 4;  // tolerance search window

fn wsola_process(input: &[f32], alpha: f32) -> Vec<f32> {
    let hop_s = overlap;                    // synthesis hop (fixed)
    let hop_a = (hop_s as f32 / alpha);     // analysis hop (nominal)
    let mut t_a: f32 = 0.0;                 // analysis pointer (fractional)
    let mut t_s: usize = 0;                 // synthesis pointer
    let mut prev_delta: i32 = 0;

    loop {
        // Nominal analysis position for this frame
        let nominal = (t_a + hop_a) as i32 + prev_delta;

        // Search within [nominal - delta_max, nominal + delta_max]
        // for position that maximizes cross-correlation with the
        // tail of the previous output frame
        let best_delta = (-delta_max..=delta_max)
            .max_by_key(|&delta| {
                let pos = (nominal + delta) as usize;
                cross_correlate(
                    &output[t_s..t_s + overlap],     // overlap region of prev output
                    &input[pos..pos + overlap]         // candidate from input
                )
            })
            .unwrap();

        let read_pos = (nominal + best_delta) as usize;

        // Extract frame from input at read_pos, apply window
        let frame = &input[read_pos..read_pos + frame_len];

        // Overlap-add: fade out previous, fade in current over overlap region
        for i in 0..overlap {
            let fade_out = 0.5 * (1.0 + (PI * i as f32 / overlap as f32).cos());
            let fade_in = 1.0 - fade_out;
            output[t_s + i] = output[t_s + i] * fade_out + frame[i] * fade_in;
        }
        // Write non-overlapping portion
        output[t_s + overlap..t_s + frame_len]
            .copy_from_slice(&frame[overlap..frame_len]);

        prev_delta = best_delta;
        t_a += hop_a;
        t_s += hop_s;
    }
}
```

### Cross-correlation optimization

The inner cross-correlation is O(overlap × 2 × delta_max). For `overlap=512` and `delta_max=256`, that is ~262K multiply-adds per frame. Optimize by computing the normalized cross-correlation using the FFT (via `realfft`), reducing it to O(N log N). Alternatively, downsample both signals by 4× before correlation and refine the peak at full resolution — this cuts cost by ~16× with negligible quality loss.

---

## 4. AHDSR Envelope State Machine

### Per-sample exponential curve via multiplier

The standard approach (used by EarLevel Engineering's widely-referenced implementation and virtually all professional synthesizers) computes an exponential transition iteratively using a single multiply per sample. Given a transition from `start_level` to `end_level` over `length_samples`:

```rust
// target_ratio controls curve shape:
//   small (0.0001) = nearly exponential
//   large (1.0+)   = nearly linear
fn calculate_multiplier(
    start: f32, end: f32, length: usize, target_ratio: f32
) -> (f32, f32, f32) {  // returns (base, multiplier, offset)
    let offset = (end - start) * if end > start {
        (1.0 + target_ratio) / target_ratio
    } else {
        (1.0 + target_ratio).recip() * -target_ratio
    };
    let base = start - offset;
    let coeff = ((base + offset) / base).ln() / length as f32;
    let multiplier = coeff.exp();
    (base, multiplier, offset)
}

// Per-sample: level = base * multiplier^n + offset
// Iteratively: level = (level - offset) * multiplier + offset
```

### State machine with 6 states

```rust
enum EnvState { Idle, Attack, Hold, Decay, Sustain, Release }

struct AhdsrEnvelope {
    state: EnvState,
    level: f32,
    multiplier: f32,
    base: f32,
    offset: f32,
    hold_counter: u32,   // samples remaining in hold phase
    // Parameters (set from UI)
    attack_time: f32,    // seconds
    hold_time: f32,      // seconds
    decay_time: f32,     // seconds
    sustain_level: f32,  // 0.0–1.0
    release_time: f32,   // seconds
    attack_curve: f32,   // target_ratio for attack shape
    decay_curve: f32,    // target_ratio for decay/release shape
}

impl AhdsrEnvelope {
    fn process(&mut self) -> f32 {
        match self.state {
            EnvState::Idle => return 0.0,
            EnvState::Attack => {
                self.level = (self.level - self.offset) * self.multiplier + self.offset;
                if self.level >= 1.0 {
                    self.level = 1.0;
                    self.state = EnvState::Hold;
                    self.hold_counter = (self.hold_time * sample_rate) as u32;
                }
            }
            EnvState::Hold => {
                // Level stays at 1.0
                if self.hold_counter == 0 {
                    self.state = EnvState::Decay;
                    self.recalc_decay();
                } else {
                    self.hold_counter -= 1;
                }
            }
            EnvState::Decay => {
                self.level = (self.level - self.offset) * self.multiplier + self.offset;
                if self.level <= self.sustain_level {
                    self.level = self.sustain_level;
                    self.state = EnvState::Sustain;
                }
            }
            EnvState::Sustain => {
                // Level stays at sustain_level until note-off
            }
            EnvState::Release => {
                self.level = (self.level - self.offset) * self.multiplier + self.offset;
                if self.level <= 0.0001 {
                    self.level = 0.0;
                    self.state = EnvState::Idle;
                }
            }
        }
        self.level
    }

    fn note_on(&mut self) {
        self.state = EnvState::Attack;
        self.recalc_attack();
        // Retrigger: start from current level (not 0) for click-free legato
    }

    fn note_off(&mut self) {
        self.state = EnvState::Release;
        // Release always starts from current level
        self.recalc_release_from_current();
    }
}
```

### Key design notes

- **Attack shape**: The classic analog capacitor-charging curve (concave downward) is produced by targeting a value above 1.0 (e.g. 1.0001) and clamping. This is the natural shape of `RC` charging and matches hardware synthesizer behavior per the EarLevel Engineering analysis.
- **Retrigger behavior**: On retriggering during release, the attack starts from the current level, not from zero. This prevents clicks. For a "hard retrigger" option, reset to zero with a 1ms fade.
- **Legato mode**: Skip the attack phase entirely on retrigger; just update the pitch. The envelope remains in whatever state it was in.
- **`target_ratio` as curve control**: A value near 0.0001 gives a steep exponential curve. A value near 1.0 approaches linear. This single parameter replaces complex curve-type selectors and is how EarLevel's implementation (widely cited on KVR forums) achieves adjustable curves with trivial computation.

---

## 5. SVF Filter Topology (Cytomic/Zavalishin TPT)

The recommended filter is Andrew Simper's trapezoidal-integrated SVF, derived from Vadim Zavalishin's topology-preserving transform in "The Art of VA Filter Design." This filter is the gold standard for virtual analog because it preserves zero-delay feedback, has excellent time-varying behavior (critical for filter sweeps), and produces simultaneous LP/HP/BP/notch outputs.

### Per-sample computation

From Simper's `SvfLinearTrapOptimised2.pdf`:

```rust
struct SvfFilter {
    ic1eq: f32,  // state variable 1 (integrator 1 output, delayed)
    ic2eq: f32,  // state variable 2 (integrator 2 output, delayed)
    a1: f32,     // coefficients, recomputed when cutoff/Q change
    a2: f32,
    a3: f32,
    // mixing coefficients for output type
    m0: f32,
    m1: f32,
    m2: f32,
}

impl SvfFilter {
    fn set_params(&mut self, cutoff_hz: f32, q: f32, sample_rate: f32, filter_type: FilterType) {
        let g = (PI * cutoff_hz / sample_rate).tan();
        let k = 1.0 / q;  // damping (k = 2*R in Zavalishin's notation)
        self.a1 = 1.0 / (1.0 + g * (g + k));
        self.a2 = g * self.a1;
        self.a3 = g * self.a2;

        // Output mixing coefficients determine filter type
        match filter_type {
            FilterType::LowPass  => { self.m0 = 0.0; self.m1 = 0.0; self.m2 = 1.0; }
            FilterType::BandPass => { self.m0 = 0.0; self.m1 = 1.0; self.m2 = 0.0; }
            FilterType::HighPass => { self.m0 = 1.0; self.m1 = -k;  self.m2 = -1.0; }
            FilterType::Notch    => { self.m0 = 1.0; self.m1 = -k;  self.m2 = 0.0; }
            FilterType::Peak     => { self.m0 = 1.0; self.m1 = -k;  self.m2 = -2.0; }
            FilterType::AllPass  => { self.m0 = 1.0; self.m1 = -2.0*k; self.m2 = 0.0; }
        }
    }

    fn process_sample(&mut self, v0: f32) -> f32 {
        let v3 = v0 - self.ic2eq;
        let v1 = self.a1 * self.ic1eq + self.a2 * v3;
        let v2 = self.ic2eq + self.a2 * self.ic1eq + self.a3 * v3;
        self.ic1eq = 2.0 * v1 - self.ic1eq;
        self.ic2eq = 2.0 * v2 - self.ic2eq;

        self.m0 * v0 + self.m1 * v1 + self.m2 * v2
    }
}
```

### Why TPT SVF over biquad

Per Andrew Simper's analysis and discussion on the KVR DSP forum: the trapezoidal SVF maintains stability under fast modulation (filter sweeps, LFO on cutoff) where direct-form biquads become unstable. Coefficients can be updated every sample without artifacts. The `g = tan(π * fc / fs)` term handles frequency warping correctly — at Nyquist the filter reaches full attenuation, matching analog behavior. As demonstrated in Simper's comparative plots, biquads produce high-energy artifacts under modulation that the SVF avoids entirely.

### 2× oversampling for high resonance

At very high resonance values (Q > 10) and high cutoff frequencies, the TPT SVF's frequency response deviates from the analog prototype due to the bilinear transform's frequency warping. For synthesizer-style aggressive filtering, process at 2× the session sample rate: upsample input (zero-stuff + LP), run the SVF at 2× rate, then decimate. This pushes the warping region above audibility.

---

## 6. Loop Modes

### Four loop modes with crossfade

Every professional sampler (Kontakt, Bitwig, Studio One) supports at minimum: no loop, forward loop, ping-pong (forward-reverse alternating), and reverse loop. The crossfade at loop boundaries is essential for click-free looping.

```rust
enum LoopMode { NoLoop, Forward, PingPong, Reverse }

struct LoopState {
    mode: LoopMode,
    start: usize,         // loop start in samples
    end: usize,           // loop end in samples
    crossfade_len: usize, // crossfade length in samples
    direction: i32,       // +1 forward, -1 reverse (for ping-pong)
    position: f64,        // fractional sample position
}

impl LoopState {
    fn advance(&mut self, pitch_ratio: f64) -> f64 {
        self.position += pitch_ratio * self.direction as f64;
        let loop_len = (self.end - self.start) as f64;

        match self.mode {
            LoopMode::NoLoop => {
                // Clamp at end, voice enters release
            }
            LoopMode::Forward => {
                while self.position >= self.end as f64 {
                    self.position -= loop_len;
                }
            }
            LoopMode::PingPong => {
                if self.direction > 0 && self.position >= self.end as f64 {
                    self.position = 2.0 * self.end as f64 - self.position;
                    self.direction = -1;
                } else if self.direction < 0 && self.position <= self.start as f64 {
                    self.position = 2.0 * self.start as f64 - self.position;
                    self.direction = 1;
                }
            }
            LoopMode::Reverse => {
                while self.position <= self.start as f64 {
                    self.position += loop_len;
                }
            }
        }
        self.position
    }
}
```

### Equal-power crossfade at loop point

For forward looping, when the read position is within `crossfade_len` samples of `loop_end`, blend the current region with audio from `loop_start`:

```rust
fn read_with_crossfade(&self, sample_data: &[f32], pos: f64) -> f32 {
    let main = interpolate_cubic(sample_data, pos);

    let dist_to_end = self.end as f64 - pos;
    if dist_to_end < self.crossfade_len as f64 && dist_to_end >= 0.0 {
        // We're in the crossfade zone
        let fade = dist_to_end / self.crossfade_len as f64;
        // Wrap-around position: where we'd be after the loop
        let wrap_pos = self.start as f64 + (self.crossfade_len as f64 - dist_to_end);
        let wrap_sample = interpolate_cubic(sample_data, wrap_pos);

        // Equal-power crossfade
        let gain_main = (fade * PI * 0.5).sin();
        let gain_wrap = ((1.0 - fade) * PI * 0.5).sin();
        main * gain_main as f32 + wrap_sample * gain_wrap as f32
    } else {
        main
    }
}
```

Equal-power crossfade (using `sin`/`cos` curves) maintains constant perceived loudness through the transition, unlike linear crossfade which dips by ~3dB at the midpoint. A typical crossfade length is 50–500 samples (1–10ms), user-adjustable.

---

## 7. Parameter Smoothing

### One-pole exponential smoother

The universal standard for eliminating zipper noise from parameter changes, as documented by Nigel Redmon (EarLevel Engineering) and discussed extensively on the KVR DSP forum, is a one-pole lowpass filter applied to each parameter value before it reaches the DSP:

```rust
struct ParamSmoother {
    current: f32,
    target: f32,
    coeff: f32,   // filter coefficient (0.0 = instant, 0.999 = very slow)
}

impl ParamSmoother {
    fn new(smoothing_time_ms: f32, sample_rate: f32) -> Self {
        let coeff = (-TAU / (smoothing_time_ms * 0.001 * sample_rate)).exp();
        Self { current: 0.0, target: 0.0, coeff }
    }

    fn set_target(&mut self, value: f32) {
        self.target = value;
    }

    /// Call once per sample
    fn next(&mut self) -> f32 {
        self.current = self.target + self.coeff * (self.current - self.target);
        self.current
    }

    fn is_settled(&self) -> bool {
        (self.current - self.target).abs() < 1e-6
    }
}
```

### Smoothing time guidelines

- **Volume/pan**: 5–10ms (fast response, avoids audible lag)
- **Filter cutoff**: 5–20ms (needs to be fast for sweeps, smooth enough to avoid clicks)
- **Delay time**: 50–100ms (longer to avoid pitch glitches)
- **General UI knobs**: 10ms is a good universal default

### Per-block optimization

For parameters that don't need per-sample granularity, compute the smoothed value once per block (e.g. every 64 or 128 samples) and hold it constant within the block. This saves CPU when many parameters are active. A KVR developer's approach: run the smoother at 1/16 sample rate and multiply the coefficient by the downsampling factor to maintain the same time constant.

### Denormal prevention

The one-pole filter's feedback will decay asymptotically toward zero, potentially producing denormal floating-point values that cause massive CPU spikes on x86. Add a tiny DC offset: `self.current += 1e-18` after each iteration, or use `_mm_setcsr(_mm_getcsr() | 0x8040)` to enable flush-to-zero globally on the audio thread.

---

## 8. Granular Engine

### Grain scheduling architecture

A granular engine maintains a **grain pool** (pre-allocated array of grain structs) and a **scheduler** that triggers new grains at intervals determined by grain density.

```rust
const MAX_GRAINS: usize = 128;

struct Grain {
    active: bool,
    position: f64,     // current read position in source sample
    start_pos: f64,    // where this grain started reading
    pitch_ratio: f64,  // playback speed
    age: usize,        // samples since grain onset
    duration: usize,   // total grain duration in samples
    pan: f32,          // stereo position
}

struct GranularEngine {
    grains: [Grain; MAX_GRAINS],
    next_onset: usize,          // samples until next grain trigger
    // Parameters
    grain_size_ms: f32,         // 10–100ms typical
    density: f32,               // grains per second (10–1000)
    position: f64,              // playhead position in source (0.0–1.0)
    spray: f32,                 // random position offset range (0.0–1.0)
    pitch: f32,                 // pitch shift in semitones
    pitch_random: f32,          // random pitch variation range
    pan_spread: f32,            // stereo spread (0.0 = center, 1.0 = full)
}
```

### Inter-onset time and density

Grain density controls how often new grains are triggered. The inter-onset time (IOT) is `sample_rate / density`. For asynchronous granular synthesis, IOT can be randomized: `iot = base_iot * (1.0 + random(-0.3, 0.3))` to avoid mechanical periodicity, which is a core technique documented in Barry Truax's original real-time granular synthesis work from 1986.

### Per-block grain processing

```
fn process_block(&mut self, output_l: &mut [f32], output_r: &mut [f32], source: &[f32]) {
    for sample_idx in 0..block_size {
        // 1. Check if it's time to spawn a new grain
        if self.next_onset == 0 {
            self.spawn_grain(source);
            // Next onset with optional jitter
            let base_iot = (sample_rate / self.density) as usize;
            self.next_onset = base_iot + random_range(-base_iot/4, base_iot/4);
        }
        self.next_onset -= 1;

        // 2. Sum all active grains
        let (mut sum_l, mut sum_r) = (0.0, 0.0);
        for grain in &mut self.grains {
            if !grain.active { continue; }

            // Read from source with interpolation
            let sample = interpolate_cubic(source, grain.position);

            // Apply grain envelope (Hann window)
            let env_phase = grain.age as f32 / grain.duration as f32;
            let envelope = 0.5 * (1.0 - (TAU * env_phase).cos());

            let out = sample * envelope;
            sum_l += out * (1.0 - grain.pan) * 0.5_f32.sqrt();
            sum_r += out * grain.pan * 0.5_f32.sqrt();

            // Advance grain
            grain.position += grain.pitch_ratio;
            grain.age += 1;
            if grain.age >= grain.duration {
                grain.active = false;
            }
        }
        output_l[sample_idx] += sum_l;
        output_r[sample_idx] += sum_r;
    }
}
```

### Grain window shapes

- **Hann** (default): `0.5 * (1 - cos(2π * t/N))` — smooth, no clicks, good overlap behavior
- **Triangle**: sharper transients, more rhythmic character
- **Tukey** (flat-top cosine): `cos²` tapers at edges, flat middle — preserves more of the source character
- **Gaussian**: `exp(-0.5 * ((t - N/2) / (σ * N/2))²)` — softest, most "cloudy"

### Grain density vs. grain size interactions

When `grain_size > inter_onset_time`, grains overlap. At typical settings of 50ms grains and 100 grains/second (IOT = 10ms), ~5 grains overlap simultaneously. The Hann window has the COLA (Constant Overlap-Add) property at 50% overlap, meaning overlapping Hann-windowed grains sum to constant amplitude — producing smooth, artifact-free textures.

---

## 9. Sample Rate Conversion

When a 48kHz sample plays in a 44.1kHz session (or vice versa), the sample data must be resampled. This should happen **at load time on the I/O thread**, not on the RT thread.

### Strategy

Use the `rubato` crate's synchronous FFT resampler for fixed-ratio conversion (e.g. 48000→44100). This is the highest-quality mode: FFT-based, no approximation, handles the ratio 160/147 exactly. It is significantly faster than the asynchronous sinc resampler for fixed ratios.

```rust
use rubato::{FftFixedInOut, Resampler};

fn convert_sample_rate(input: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate { return input.to_vec(); }

    let mut resampler = FftFixedInOut::<f32>::new(
        from_rate as usize,
        to_rate as usize,
        1024,  // chunk size
        1      // channels
    ).unwrap();

    // Process in chunks...
    let output_buffer = resampler.output_buffer_allocate(true);
    // ... standard rubato chunked processing loop
}
```

### When NOT to resample

For the "repitch" warp mode (where pitch = speed), no sample rate conversion is needed — the pitch ratio already accounts for everything. SRC is only needed when the sample should play at its original pitch in a session with a different sample rate.

---

## 10. YIN Pitch Detection

YIN (de Cheveigné & Kawahara, 2002) is the recommended algorithm for auto-detecting a sample's root note on import. The `pitch-detection` Rust crate provides a production-ready implementation with FFT-accelerated autocorrelation, but understanding the algorithm is necessary for tuning parameters.

### Six-step algorithm

**Step 1 — Difference function**: For each lag `τ`, compute how different the signal is from a shifted copy of itself:

```
d(τ) = Σ(i=0..W-τ) (x[i] - x[i + τ])²
```

where `W` is the integration window (typically half the buffer size). This is zero at lag 0 and at the true period.

**Step 2 — Cumulative mean normalized difference**: The raw `d(τ)` always has a minimum at lag 0, causing false detections. YIN normalizes by the running average:

```
d'(τ) = 1                               if τ = 0
d'(τ) = d(τ) / ((1/τ) * Σ(j=1..τ) d(j))  otherwise
```

This starts at 1.0 and dips below 1.0 when `d(τ)` is below its running average — the first dip below threshold is the pitch period.

**Step 3 — Absolute threshold**: Search for the first `τ` where `d'(τ) < threshold`. The original paper recommends `threshold = 0.1` for high accuracy (with occasional missed detections). For the sampler's auto-detect, use `threshold = 0.15` for better recall.

**Step 4 — Parabolic interpolation**: Refine the integer lag estimate by fitting a parabola through `d'(τ-1)`, `d'(τ)`, `d'(τ+1)`:

```
τ_refined = τ + (d'(τ-1) - d'(τ+1)) / (2 * (d'(τ-1) - 2*d'(τ) + d'(τ+1)))
```

**Step 5 — Convert to frequency**: `f0 = sample_rate / τ_refined`

**Step 6 — Convert to MIDI note**: `midi_note = 69 + 12 * log2(f0 / 440.0)`, rounded to nearest integer.

### Rust crate usage

```rust
use pitch_detection::detector::yin::YINDetector;
use pitch_detection::detector::PitchDetector;

let mut detector = YINDetector::new(buffer_size, buffer_size / 2);
let pitch = detector.get_pitch(
    &audio_buffer,
    sample_rate,
    0.15,  // threshold
    None,  // no prior
);
if let Some(p) = pitch {
    let midi_note = 69.0 + 12.0 * (p.frequency / 440.0).log2();
    let root_note = midi_note.round() as u8;
}
```

Run on a 2048-sample window from the sustain portion of the sample (skip the attack transient, which has unstable pitch). Average over 3–5 windows for robustness.

---

## 11. The `process()` Callback Flow

This is the central function that ties everything together. The v1 document describes the components but not how they connect per audio callback.

```rust
impl SamplerEngine {
    /// Called by cpal's audio callback. MUST be RT-safe:
    /// no allocations, no locks, no I/O, no panics.
    fn process(&mut self, output: &mut [f32], num_frames: usize) {
        // ── 1. Poll command queue (parameter changes from UI) ──
        while let Ok(cmd) = self.cmd_consumer.pop() {
            match cmd {
                Cmd::SetWarpMode(mode) => self.warp_mode = mode,
                Cmd::SetPadConfig(pad, cfg) => self.pads[pad] = cfg,
                Cmd::SetFilterParams(cutoff, q) => {
                    // Don't apply directly — store targets for smoothing
                    self.filter_cutoff_target = cutoff;
                    self.filter_q_target = q;
                }
                Cmd::LoadSampleReady(id, preload) => {
                    self.samples[id] = preload;
                }
                // ... other commands
            }
        }

        // ── 2. Process MIDI events for this block ──
        while let Ok(event) = self.midi_consumer.pop() {
            match event {
                MidiEvent::NoteOn { note, velocity } => {
                    // 2a. Determine sample to play based on mode
                    let (sample_id, start, end, pitch_ratio) =
                        self.mode_logic.resolve_note(note, velocity);

                    // 2b. Handle choke groups (drum mode)
                    if let Some(choke) = self.pads[note].choke_group {
                        self.kill_choke_group(choke);
                    }

                    // 2c. Allocate voice (bitfield scan)
                    let voice_idx = self.voice_allocator.allocate()
                        .unwrap_or_else(|| self.steal_voice());

                    // 2d. Initialize voice
                    let voice = &mut self.voices[voice_idx];
                    voice.activate(sample_id, start, end, pitch_ratio, velocity);
                    voice.envelope.note_on();

                    // 2e. Request disk streaming for this voice
                    self.io_cmd_producer.push(IoCmd::StartVoice {
                        voice_idx, sample_id, start_pos: start
                    }).ok();
                }
                MidiEvent::NoteOff { note } => {
                    for voice in &mut self.voices {
                        if voice.active && voice.note == note {
                            voice.envelope.note_off();
                        }
                    }
                }
            }
        }

        // ── 3. Render all active voices ──
        // Zero the output buffer
        for s in output.iter_mut() { *s = 0.0; }

        for voice in &mut self.voices {
            if !voice.active { continue; }

            for frame in 0..num_frames {
                // 3a. Read sample data (preload buffer or ring buffer consumer)
                let raw_sample = voice.read_sample();

                // 3b. Apply warp engine (if not repitch mode)
                let warped = match self.warp_mode {
                    WarpMode::Repitch => raw_sample,  // pitch = speed
                    WarpMode::Beats => voice.wsola.process(raw_sample),
                    WarpMode::Tonal => voice.phase_vocoder.process(raw_sample),
                    WarpMode::Granular => voice.granular.process(raw_sample),
                };

                // 3c. Apply per-voice filter (smoothed cutoff)
                let filtered = voice.filter.process_sample(warped);

                // 3d. Apply envelope
                let env_level = voice.envelope.process();
                let shaped = filtered * env_level * voice.velocity_gain;

                // 3e. Check if voice is done
                if voice.envelope.is_idle() {
                    voice.deactivate();
                    self.voice_allocator.free(voice.index);
                    break;
                }

                // 3f. Pan and accumulate to stereo output
                let (l_gain, r_gain) = equal_power_pan(voice.pan);
                output[frame * 2]     += shaped * l_gain;
                output[frame * 2 + 1] += shaped * r_gain;
            }
        }

        // ── 4. Write metering data (atomics, Relaxed ordering) ──
        let peak = output.iter().fold(0.0f32, |a, &b| a.max(b.abs()));
        self.peak_level.store(peak.to_bits(), Ordering::Relaxed);
        self.active_voice_count.store(
            self.voices.iter().filter(|v| v.active).count() as u32,
            Ordering::Relaxed
        );

        // ── 5. Wake I/O thread if any voice buffers are low ──
        if self.voices.iter().any(|v| v.active && v.buffer_low()) {
            self.io_thread_unpark.unpark();
        }
    }
}
```

### Equal-power pan law

```rust
fn equal_power_pan(pan: f32) -> (f32, f32) {
    // pan: 0.0 = hard left, 0.5 = center, 1.0 = hard right
    let angle = pan * FRAC_PI_2;  // 0 to π/2
    (angle.cos(), angle.sin())
}
```

---

## 12. Waveform Peak Mipmap

### Hierarchical min/max reduction

As described in KVR forum discussions on peak file implementations and used by tools like BBC's peaks.js, the standard approach stores min/max pairs at progressively coarser resolutions, analogous to texture mipmaps in 3D graphics.

**Level 0** (finest): min/max per 32 samples
**Level 1**: min/max per 64 samples (derived from pairs of level 0 entries)
**Level 2**: min/max per 128 samples
**...continuing by powers of 2...**
**Level N**: min/max for the entire file (1 entry)

### Generation algorithm (runs on background thread during sample load)

```rust
struct PeakMipmap {
    levels: Vec<Vec<(f32, f32)>>,  // Vec of (min, max) pairs per level
    base_block_size: usize,         // typically 32 or 64
}

impl PeakMipmap {
    fn generate(samples: &[f32], base_block_size: usize) -> Self {
        // Level 0: reduce raw samples to min/max blocks
        let num_blocks = (samples.len() + base_block_size - 1) / base_block_size;
        let mut level0 = Vec::with_capacity(num_blocks);

        for chunk in samples.chunks(base_block_size) {
            let min = chunk.iter().copied().fold(f32::INFINITY, f32::min);
            let max = chunk.iter().copied().fold(f32::NEG_INFINITY, f32::max);
            level0.push((min, max));
        }

        let mut levels = vec![level0];

        // Higher levels: reduce pairs of previous level entries
        while levels.last().unwrap().len() > 1 {
            let prev = levels.last().unwrap();
            let next: Vec<(f32, f32)> = prev.chunks(2).map(|pair| {
                let min = pair.iter().map(|p| p.0).fold(f32::INFINITY, f32::min);
                let max = pair.iter().map(|p| p.1).fold(f32::NEG_INFINITY, f32::max);
                (min, max)
            }).collect();
            levels.push(next);
        }

        Self { levels, base_block_size }
    }

    /// Returns the appropriate mipmap level for rendering at given zoom
    fn get_peaks_for_view(
        &self, start_sample: usize, end_sample: usize, pixel_width: usize
    ) -> Vec<(f32, f32)> {
        let samples_per_pixel = (end_sample - start_sample) / pixel_width;
        // Find the mipmap level where block_size ≈ samples_per_pixel
        let level = (samples_per_pixel as f32 / self.base_block_size as f32)
            .log2()
            .max(0.0) as usize;
        let level = level.min(self.levels.len() - 1);

        let block_size = self.base_block_size << level;
        let start_block = start_sample / block_size;
        let end_block = (end_sample + block_size - 1) / block_size;
        let end_block = end_block.min(self.levels[level].len());

        self.levels[level][start_block..end_block].to_vec()
    }
}
```

### Memory budget

For a 10-minute stereo file at 44.1kHz (~53M samples per channel), with base block size 32:

- Level 0: ~1.65M entries × 8 bytes = ~13MB per channel
- All higher levels combined: ~13MB (geometric series converges to 2×)
- Total: ~52MB for stereo — acceptable, and generated in <500ms on modern hardware.

For the Tauri IPC transfer, send only the peaks needed for the current view: at 1920px width, that is `1920 × 2 × 4 bytes = 15KB` — trivial to transfer as a raw `ArrayBuffer` via `tauri::ipc::Response`.

### Rendering in the WebView

Each pixel column draws a vertical line from `min` to `max` at that position. The filled area between min and max represents the waveform body. For stereoscopic display, draw the positive half above the center line and the negative half below, using the max for the upper extent and the min for the lower.

```typescript
function drawWaveform(
    ctx: CanvasRenderingContext2D,
    peaks: Float32Array, // interleaved [min0, max0, min1, max1, ...]
    width: number,
    height: number
) {
    const center = height / 2;
    ctx.fillStyle = 'var(--waveform-color)';
    ctx.beginPath();

    for (let x = 0; x < width; x++) {
        const min = peaks[x * 2];
        const max = peaks[x * 2 + 1];
        const yTop = center - max * center;
        const yBottom = center - min * center;
        ctx.rect(x, yTop, 1, yBottom - yTop);
    }
    ctx.fill();
}
```

Use `requestAnimationFrame` for smooth scrolling during playback. Update the playback cursor position from the `playback_position` Tauri channel event at 30Hz; interpolate the cursor position visually at 60fps between updates using the known playback rate.
