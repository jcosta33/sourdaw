# Building factory-grade DSP for native Rust and WASM targets

**Professional-grade instruments and effects are fully viable in Rust targeting both native and WebAssembly, but the two platforms demand different performance budgets.** On native, Rust DSP matches or slightly beats C++ when using fixed-size arrays and proper compiler hints, giving access to multi-core parallelism and 256-bit AVX2 SIMD. On the web, WASM running inside AudioWorklet delivers roughly **1.5–2.5× slower throughput** than native, operates on a single audio thread with a hard **2.9ms processing deadline** per 128-frame block at 44.1kHz, and is limited to 128-bit SIMD. The architectural challenge is designing a shared `audio-core` crate that scales up on native hardware while degrading gracefully within WASM's constraints — and the open-source ecosystem (Glicol, web-synth, NIH-plug, FunDSP) has already proven this dual-target pattern works.

---

## Rust matches C++ for audio DSP — with caveats that matter

The widespread assumption that C++ owns audio performance no longer holds. Benchmarks of IIR biquad filters show Rust with fixed-size array slices running **3% faster than Clang and 17% faster than GCC** on both x86 and ARM. On embedded ARM (nRF52832), a Rust FIR filter implementation measured **1.8× faster** than the reference C CMSIS-DSP implementation. The Computer Language Benchmarks Game consistently shows Rust and C++ trading places within 0–10%.

The critical caveat is that `Vec<f32>` incurs roughly a **2× penalty** over fixed-size arrays because the compiler cannot prove bounds at compile time, preventing auto-vectorization. This means audio-core code should use fixed-size slices, const generics for block sizes, and iterators rather than indexed loops. Nick Wilcox's audio mixing benchmarks demonstrated that idiomatic Rust with properly typed structs (e.g., `StereoSample { l: f32, r: f32 }`) auto-vectorizes to match hand-written SSE intrinsics — the compiler generated code processing **16 samples at a time**, outperforming the hand-tuned 4-at-a-time approach. However, NIH-plug developer Billy Messenger warns that auto-vectorization "can struggle with more complicated real-world DSP pipelines" and recommends checking assembly output for critical paths.

For build optimization, the release profile should use **`lto = "fat"`, `codegen-units = 1`, `opt-level = 3`**, and `target-cpu=native` for native builds. LTO typically yields **5–20% improvement**, PGO adds **10–15%** (especially reducing tail latency — critical for audio where worst-case matters), and the combination delivers 15–25% over default release builds. For WASM, enable `simd128` target feature. The `panic = "abort"` setting saves ~10% binary size and eliminates unwinding overhead.

## The real WASM performance gap and what it means for voice budgets

Academic benchmarks (USENIX ATC 2019, SPEC CPU suites) measured WASM at **1.45× slower in Firefox and 1.55× slower in Chrome** versus native, with peak slowdowns reaching 2.5×. However, for tight DSP inner loops — the kind that dominate audio processing — the overhead narrows to roughly **10–30%** because the code is compute-bound with minimal interop, which is WASM's ideal profile. The real penalty comes from three sources: the JS↔WASM boundary crossing cost, the 128-bit SIMD ceiling, and single-threaded execution.

**WASM SIMD (v128) processes 4 floats per instruction**, identical to SSE2 and ARM NEON. Native code on modern x86 uses AVX2 (8 floats, **2× throughput**) or AVX-512 (16 floats, **4× throughput**). For embarrassingly parallel operations — oscillator banks, buffer mixing, FIR filters — this width gap translates directly to proportional slowdowns. For IIR biquad filters, which are inherently serial (each sample depends on the previous), SIMD width matters less and the gap narrows. FFT performance suffers significantly: WASM v128 is roughly 2× slower than AVX2 for large transforms, directly impacting convolution reverb feasibility.

Casey Primozic's web-synth project provides the best real-world WASM AudioWorklet data. Running 16 polyphonic voices across 16 AudioWorkletProcessors generated **5,504 process() calls per second** — and a critical discovery: AudioParam overhead (V8 hashmap lookups, string allocation, value copying) consumed more CPU than actual DSP. Reducing parameters from 34 to 6 per processor cut total render time from **5.9ms to 2.3ms** — more than a 50% reduction. The lesson: run all synthesis in a single WASM AudioWorkletProcessor rather than one per voice, minimizing JS boundary crossings.

Estimated polyphony budgets within the 2.9ms AudioWorklet deadline on modern desktop hardware:

- Simple wavetable oscillator + envelope: **100–200 voices**
- FM synth (4–6 operators + envelopes): **32–64 voices**
- Full subtractive voice (2 oscillators + filter + 2 envelopes + LFO): **16–32 voices**
- Unison-heavy voice (7 detuned oscillators + filter + FX): **4–8 voices**

On native, these numbers multiply by roughly **3–5×** per core, with additional scaling across cores via rayon.

## Sample playback engines face fundamentally different constraints per platform

Native sample streaming is well-solved. The **creek crate** (from the RustyDAW/Meadowlark project) implements a two-buffer architecture: cache buffers hold user-defined ranges (typically attack transients, loop regions), while look-ahead buffers auto-load ahead of the playhead in **16,384-frame blocks** on a background I/O thread. The real-time thread only reads from pre-filled buffers — never allocates, never blocks on disk. This mirrors Kontakt's DFD (Direct from Disk) approach, which preloads only the first **60–240KB** of each sample into RAM and streams the rest.

The web platform has no equivalent to disk streaming. Web Audio's `decodeAudioData()` requires the entire file to be loaded into memory before decoding — a dealbreaker for large libraries. The viable approach uses OPFS (Origin Private File System) for persistent storage combined with a custom AudioWorklet that manually manages buffer loading, but this is substantially more complex than native streaming. WASM's **4GB linear memory hard limit** (and practical limits of **1–2GB on mobile**, where Safari kills pages exceeding undocumented thresholds) means only a fraction of professional orchestral libraries fit in browser memory.

For context on what "professional" means here: a full Berlin Strings template requires **~32GB RAM**, BBCSO fully loaded with one mic position consumes **~40GB**, and large multi-library orchestral templates routinely need **64–128GB**. Even single instruments like Cinematic Studio Strings use ~770MB with all articulations. A multi-worker architecture (each with its own 4GB WASM module) can theoretically extend to 16GB, but this adds significant complexity. The pragmatic web strategy is aggressive sample compression, on-demand loading of only active instruments, and accepting a smaller simultaneous sample footprint than native.

For interpolation quality versus cost, **cubic Hermite (4-point)** is the sweet spot for real-time playback at roughly 7–10 ops per sample — flat passband with first sidelobes down ~40dB. Linear (2-point, ~3 ops) introduces audible high-frequency roll-off. Sinc interpolation (8–64 points) approaches ideal reconstruction but costs an order of magnitude more. Multi-sample zone selection should use pre-computed lookup tables indexed by MIDI note × velocity for allocation-free O(1) selection at note-on.

## Synthesis performance: wavetables are cache-friendly, FM is cheap, voice management is everything

Wavetable synthesis maps beautifully to cache-efficient processing. A single cycle at 1,024 samples × 4 bytes = **4KB**, and a full mip-mapped stack (~11 octave-specific band-limited tables) totals roughly **44KB — fitting entirely in L1 cache**. The mip-mapped approach pre-generates band-limited versions per octave at initialization (using additive synthesis), then at runtime selects the appropriate table based on frequency and performs linear or cubic interpolation between adjacent samples. This delivers near-zero aliasing with trivial per-sample cost — just a table lookup and interpolation, converting expensive trigonometric computations to memory reads. Serum uses 2,048-sample tables; Ableton Wavetable uses 1,024. Powers of two enable bit-shift addressing.

FM synthesis is inherently cheap: each operator requires one sine lookup + one addition + one multiplication per sample, roughly **30–40 cycles per voice for 6 operators** at minimum. With envelopes and modulation index updates, budget ~60–100 cycles per voice. On a 3.5GHz CPU with ~80,000 cycles per sample at 44.1kHz, the theoretical ceiling exceeds **800 voices of 6-operator FM** before filtering and effects — confirming that FM synths like Dexed can run dozens of instances simultaneously. Casey Primozic's Rust+WASM FM synth compiles to only **27KB compressed**.

For anti-aliased oscillators, **PolyBLEP** offers the best cost-to-quality ratio: only 2 samples of correction per discontinuity using a trivial polynomial (~10–15 arithmetic ops). MinBLEP provides superior band-limiting but requires a precomputed table (~55KB) and costs more at higher frequencies — on embedded hardware, a 10kHz sawtooth consumed **51% CPU** versus 17% at 10Hz. The expert consensus: use mip-mapped wavetables when possible (zero-cost band-limiting), PolyBLEP for real-time morphable waveforms, and MinBLEP only when hard sync or arbitrary waveform shapes demand it.

Voice management must be entirely pre-allocated. The proven pattern allocates a fixed array of 64–128 Voice structs at initialization, maintains a free-list using array indices (no heap allocation), and tracks active voices in a separate iterable list. Voice stealing prioritizes voices in release phase first, then oldest held notes, applying a **~10ms rapid fade-out** before reassignment to avoid clicks. Modulation matrices should update at control rate (every **24–64 samples**, ~1–1.5ms) with linear interpolation between updates — per the music-dsp consensus, the difference from true audio-rate exponential curves "can't be heard." Template-based dispatch for constant-detection (flagging unchanged modulation buffers to skip processing) can dramatically reduce overhead in complex routing scenarios.

## Convolution reverb works in WASM up to ~2 seconds — with architectural discipline

Real-time convolution reverb universally uses **non-uniform partitioned convolution**: the impulse response is divided into progressively larger blocks — 128, 256, 512, 1024, up to 8192 samples. The first partition matches the audio buffer size for zero additional latency and runs on the audio thread. All tail partitions run on background threads with generous scheduling windows (a 4096-sample partition at 48kHz has 85ms before its output is needed).

RustFFT 5.0+ is a standout achievement: it **beats FFTW at every tested FFT size** thanks to AVX acceleration, is **5–10× faster than RustFFT 4.0**, and critically, added **WASM SIMD support in version 6.2**. The companion `realfft` crate halves computation for real-valued audio signals. Optimal FFT sizes follow the form 2^n × 3^m, though even awkward sizes like 13,552 are only ~12% slower than the nearest optimal size.

For WASM convolution in AudioWorklet, the head partition (128-sample, 256-point FFT) completes in well under 0.1ms — trivially within budget. The challenge is tail processing: the AudioWorklet thread is single-threaded, so tail partitions must be offloaded to a **Web Worker communicating via SharedArrayBuffer**. Short IRs under 1 second are straightforward. IRs of **1–3 seconds are feasible** with careful worker scheduling. IRs beyond 3 seconds become challenging on lower-end hardware, and **5+ seconds likely requires native-only processing** or accepting quality degradation. Professional native plugins like Convology XT support IRs up to **2 million samples (40 seconds at 48kHz)** using multi-threaded non-uniform partitioning — a capability the single-threaded web platform cannot match at scale.

One critical finding: a thesis comparing WASM versus JS reverb in AudioWorklet found the WASM version was actually slower for algorithmic (non-convolution) reverb due to data copying overhead. Zero-copy approaches via SharedArrayBuffer are essential — without them, the JS↔WASM boundary cost can negate WASM's compute advantage.

## Effects chains scale across cores on native but hit a hard ceiling on web

The fundamental scaling constraint is identical on both platforms: **effects on a single track form a serial pipeline that cannot be parallelized across cores.** A chain of 7 plugins each taking 3ms would consume the entire 21ms budget of a 1024-sample buffer at 48kHz. Multiple independent tracks can run on separate cores — this is how native DAWs like Logic Pro achieve hundreds of tracks.

Real-world per-instance CPU costs on modern hardware at 44.1kHz with a 512-sample buffer:

| Effect type                              | CPU per instance | Instances per core |
| ---------------------------------------- | ---------------- | ------------------ |
| Simple parametric EQ (IIR biquad)        | 0.02–0.05%       | 2,000–5,000        |
| Full-featured EQ (FabFilter Pro-Q class) | 0.3–0.5%         | 200–300            |
| Linear-phase EQ                          | 1–3%             | 30–100             |
| Feed-forward compressor                  | 0.02–0.1%        | 1,000–5,000        |
| Algorithmic reverb (Valhalla class)      | 0.3–1%           | 100–300            |
| Convolution reverb (1–2s IR)             | 1–5%             | 20–100             |
| Multiband compressor                     | 0.25–0.5%        | 200–400            |

DAWBench testing shows top CPUs (Intel Ultra 9 285K, AMD Ryzen 9950X3D) handling **400+ multiband compressor instances** at 1024 buffer / 44.1kHz, and **6,000–9,600 Kontakt voices** across cores. The AMD 9800X3D's large L3 cache gives it an edge at low latency (ASIO 64 buffer) for memory-hungry sample instruments.

For SIMD-optimized biquad filters, the recursive nature (output depends on previous output) prevents vectorization over time. Instead, apply SIMD across channels (process L/R simultaneously), across parallel filters (4-band crossover fills SSE 4-lane perfectly), or by restructuring cascaded biquads into parallel form. Optimized NEON biquad implementations achieve **under 4 cycles per sample** on ARMv8, with hand-tuned SIMD delivering **2.5–5× speedup** over auto-vectorized code.

Plugin delay compensation requires modeling the signal flow as a DAG, computing maximum latency across all parallel paths, and inserting compensation delays at merge points. Zero-latency effects (most EQs, compressors, delays) add no PDC. Lookahead limiters add **128–2,048 samples** (3–45ms). Linear-phase EQs add **1,024–8,192 samples** (23–186ms) — making them the most latency-expensive common effect. Logic Pro's "Anticipative FX" pre-renders non-armed tracks ahead of time, effectively eliminating their real-time CPU cost and allowing more budget for live processing.

## Architecting the shared core: what can and cannot be unified

The proven dual-target architecture uses a three-crate pattern: a pure `audio-core` crate (`#![no_std]` compatible, zero platform dependencies) containing all DSP algorithms, a `native` crate wrapping it with cpal/rtrb/basedrop for real-time I/O, and a `wasm` crate wrapping it with AudioWorklet glue. Glicol, web-synth, FunDSP, and `web-audio-api-rs` all demonstrate this pattern in production.

**Code that must be platform-specific:**

- **SIMD intrinsics**: Native uses `core::arch::x86_64` (AVX2) or `core::arch::aarch64` (NEON); WASM uses `core::arch::wasm32` (v128). Use `cfg(target_arch)` conditional compilation, or write DSP against a `SimdFloat4` abstraction that maps to v128/SSE, with native builds getting runtime dispatch to wider registers. Surge XT uses the `simde` library for this exact purpose across SSE/NEON/WASM.
- **Threading and parallelism**: Native voices process in parallel via rayon; WASM AudioWorklet is strictly single-threaded. The shared core should expose `process_block()` per voice, with the native wrapper calling these in parallel and the WASM wrapper calling them sequentially.
- **Memory management**: Native uses basedrop for deferred deallocation and jemalloc for non-RT allocations; WASM uses linear memory with pre-allocated high initial size to avoid runtime `memory.grow`. Both must pre-allocate all audio buffers at initialization.
- **I/O layer**: Entirely platform-specific — cpal callbacks on native, AudioWorkletProcessor.process() on web.

**Code that shares cleanly:** All DSP algorithms (filters, oscillators, envelopes, FFT processing, modulation routing, voice management, effects), sample interpolation, wavetable generation, parameter smoothing, and the audio graph topology. This typically represents **80–90% of the codebase**.

The SIMD width gap requires a deliberate strategy. The most portable approach: write inner loops using **16-sample processing blocks** (512 bits — the maximum useful SIMD width). On AVX-512, this processes in one instruction; on AVX2, two instructions; on WASM v128, four instructions. The high-level loop structure remains identical, with the compiler handling width-specific unrolling. Nick Wilcox's research confirms that properly structured Rust code with explicit types auto-vectorizes to the available width without conditional compilation.

For memory, NIH-plug's **`assert_process_allocs`** feature provides a Rust-unique compile-time guarantee: the program aborts if any allocation occurs in the process callback during debug builds. Basedrop's `Owned<T>` and `Shared<T>` smart pointers enable wait-free O(1) drops on the audio thread by pushing freed memory onto an MPSC queue for reclamation on a non-RT thread. The rtrb crate provides wait-free SPSC ring buffers for inter-thread communication — and `rtrb-basedrop` ensures even the ring buffer's underlying allocation is never freed on the RT thread.

## What's impractical on the web — and what the hard limits actually are

The web platform's hard architectural limits create a clear tier system for what's feasible:

**Fully viable on web**: Subtractive synths (16–32 voices), FM synths (32–64 voices), wavetable synths (16–32 voices with effects), parametric EQ, compressors, delay effects, algorithmic reverb, basic convolution reverb (≤1s IR), distortion/saturation, chorus/flanger/phaser. These represent the core toolkit for a production-capable web DAW.

**Feasible with constraints**: Convolution reverb with 1–3s IRs (requires Web Worker offloading), sampler instruments with libraries under ~1GB, 8–16 track sessions with full effect chains, unison-heavy synth patches (4–8 voices). Quality and polyphony must be managed more aggressively than native.

**Impractical or impossible on web**: Large orchestral sample libraries (>2GB), convolution reverb with 5+ second IRs at full quality, 100+ simultaneous tracks with instruments and effects, multi-core audio graph processing, sub-3ms round-trip recording latency, linear-phase EQ with heavy oversampling across many tracks. These remain native-only capabilities.

The single-threaded AudioWorklet ceiling means total web processing capacity equals roughly **one native core's budget minus 30–50% WASM overhead**. A native DAW on a 16-core CPU has approximately **20–40× the total processing capacity** of the same DAW running in a browser. The strategic implication: the web version should target songwriter/producer workflows (16–32 tracks, moderate effects) while the native version targets professional mixing/mastering and orchestral production.

## Conclusion

The performance data supports a clear architectural strategy: a shared Rust `audio-core` crate handles 80–90% of DSP code identically across targets, with platform-specific wrappers handling SIMD dispatch (v128 vs AVX2), threading (sequential vs rayon), memory management (linear memory vs basedrop), and I/O. RustFFT beating FFTW, Rust matching C++ for biquad filters, and the NIH-plug ecosystem's real-time safety guarantees collectively establish Rust as a production-viable DSP language — not a compromise. The key insight from real-world projects is that **JS↔WASM boundary overhead and AudioParam marshaling cost more than the actual DSP computation** in web contexts, making architectural decisions about how you structure the AudioWorklet interface more impactful than micro-optimizing inner loops. Build the shared core around fixed-size block processing (16-sample minimum blocks for SIMD alignment), pre-allocated voice pools with zero-allocation process callbacks, control-rate modulation (24–64 sample updates with interpolation), and mip-mapped wavetables for cache-efficient, alias-free synthesis. The native version scales by parallelizing voice and track processing across cores; the web version fits within its single-thread budget by limiting polyphony, using simpler reverb algorithms, and streaming less sample data.
