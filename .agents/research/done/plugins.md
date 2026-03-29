# Building Logic Pro-class instruments and effects in a Rust/WASM DAW

A Rust audio engine targeting both native (cpal) and WebAssembly (AudioWorklet) can realistically deliver **80–90% of Logic Pro's factory plugin functionality** by leveraging existing open-source crates, the FAUST→Rust compilation pipeline, and native Web Audio nodes for the browser. The critical insight: **mi-plaits-dsp-rs** provides 24 production-quality synthesis engines under MIT license, **FunDSP** delivers a composable DSP toolkit with oscillators, filters, reverbs, and effects, and **FAUST's Rust backend** unlocks access to over 1,000 proven DSP algorithms that compile to pure Rust — and thus to WASM — without C++ FFI. The web version needs not compromise as much as expected: native Web Audio nodes (`ConvolverNode`, `BiquadFilterNode`, `DynamicsCompressorNode`) run in optimized browser C++ code, handling reverb, EQ, and compression at zero WASM cost, while custom WASM synthesis handles **16–32 voice polyphony** reliably.

---

## What a competitive DAW must ship on day one

Logic Pro bundles **70+ plugins** (22+ instruments, 50+ effects) with **3,000+ Alchemy presets** and a 72GB sound library. Ableton Live Suite ships 20 instruments and 58 effects; Bitwig Studio offers 38 instruments (including 30 drum synths) and 53 audio effects. All three converge on a clear essential set.

**Tier 1 — non-negotiable (DAW is unusable without these):** parametric EQ (≥4 bands with analyzer), compressor, brick-wall limiter, noise gate, algorithmic reverb, stereo delay, basic sampler (single-sample and multi-sample), at least one subtractive/VA synth, drum machine with pad mapping, gain/utility, and level/spectrum metering. Every major DAW bundles all of these. Missing any one makes the product non-functional for professional work.

**Tier 2 — expected by migrating users:** convolution reverb (Logic's Space Designer, Ableton's Convolution Reverb, Bitwig's Convolution), multiband compressor, de-esser, a flagship hybrid synth with wavetable/FM capabilities, chorus/flanger/phaser, tape-style delay, 2–3 distortion flavors, pitch correction (auto-tune style), guitar amp simulation, linear-phase EQ, sample-based acoustic instruments (piano, strings, drums), drum synthesis, LUFS loudness metering, and stereo imaging tools.

**Tier 3 — differentiators:** physical modeling instruments (Logic's Sculpture, Ableton's Collision/Tension), modular synthesis systems (Bitwig's Grid), vocoder, spectral processing effects, granular synth, vintage hardware emulations, and AI-powered stem separation. These distinguish premium offerings but aren't dealbreakers at launch.

The minimum viable launch target should cover all Tier 1 plus the most-demanded Tier 2 items: convolution reverb, a flagship synth, chorus/phaser/flanger, tape delay, saturation/overdrive, and pitch correction. This mirrors what Bitwig shipped at its V1 launch in 2014.

---

## The Rust crate ecosystem already covers most DSP fundamentals

The open-source Rust audio ecosystem has matured enough that roughly **60–70% of required DSP can be assembled from existing crates**, with the remainder requiring custom implementation or FAUST integration.

**Directly reusable crates (MIT/Apache-2.0 licensed):**

- **FunDSP** (`fundsp` v0.23) — the single most valuable crate. Provides bandlimited oscillators (sine, saw, square, triangle, pulse, wavetable), biquad and SVF filters with optional nonlinearities (Jatin Chowdhury), stereo reverbs (allpass loop and 32-channel hybrid FDN), delay lines, chorus, phaser, envelope followers, limiters, panning, DC blocking, convolution engine, granular synthesis (`granular.rs`), and spectral resynthesis (`resynth.rs`). Compiles to WASM via `no_std`. Composable graph notation (`>>` for chain, `&` for sum, `|` for parallel) provides zero-cost abstractions.

- **mi-plaits-dsp-rs** — pure Rust port of Mutable Instruments Plaits with **24 synthesis engines**: virtual analog, waveshaping, FM 2-operator, granular formant, harmonic additive, wavetable, chords, vowel/speech, granular cloud, filtered noise, particle noise, modal/string physical modeling, and analog bass/snare/hi-hat drum synthesis. MIT-licensed, operates at 48kHz. This alone can power a factory synth instrument.

- **RustFFT** (`rustfft` v6.2) + **RealFFT** (`realfft`) — high-performance FFT with explicit **WASM SIMD** support via feature flag. Faster than FFTW in many benchmarks. Foundation for convolution reverb, spectral processing, phase vocoder, and spectrum analysis.

- **Symphonia** — pure Rust audio decoder supporting WAV, FLAC, MP3, OGG/Vorbis, AAC, AIFF, ALAC, and more. MPL-2.0 license. Compiles partially to WASM.

- **rubato** — sample rate conversion with sinc interpolation and polynomial modes. Real-time safe (no allocations during processing). SIMD-optimized.

- **biquad** — `no_std` biquad filter crate implementing Robert Bristow-Johnson's Audio EQ Cookbook. Both Direct Form 1 and Transposed Direct Form 2.

- **pitch-detection** — implements YIN, McLeod, and autocorrelation pitch detectors. Explicitly designed for WASM. `no_std` compatible.

- **bs1770** — full ITU-R BS.1770-4 loudness measurement (LUFS). K-weighting filter, gated integrated loudness, momentary/short-term windows.

- **spectrum-analyzer** — `no_std` FFT-based spectrum analysis with built-in window functions (Hann, Hamming, Blackman-Harris).

- **freeverb** — direct Rust port of the Freeverb algorithm with 64-bit internal processing and WASM bindings via `wasm-bindgen`.

- **dasp** — sample type primitives, frame types, ring buffers, interpolation. `no_std`, zero dependencies.

- **creek** (from MeadowlarkDAW) — realtime-safe disk streaming with cache buffers and look-ahead, built on Symphonia. Ideal for native sampler disk streaming.

**Crates requiring license consideration (GPL-3.0):**

- **synfx-dsp** — DSP algorithm collection including Dattorro reverb, SVF (Simper/Cytomic), PolyBLEP oscillator, oversampling (Butterworth cascade), Hermite interpolation, and fast tanh approximations. From the HexoSynth project.

- **hexodsp** — full runtime-changeable DSP graph engine with oscillators, filters, amplifiers, envelopes, LFOs, delay, and reverb nodes.

**The FAUST→Rust pipeline** is the most underappreciated accelerator. FAUST has a native Rust backend that compiles `.dsp` files directly into pure Rust source code. The `rust-faust` crate provides build-time integration. FAUST's standard library contains **1,000+ production-quality DSP algorithms** — reverbs (Freeverb, Zita-Rev1, FDN), compressors, limiters, EQs, filters, delays, modulation effects, physical models, and more. All compile to pure Rust and therefore to WASM. This gives access to battle-tested DSP without writing C++ FFI or reimplementing from papers.

---

## Flagship hybrid synth: four-source architecture with spectral morphing

Logic's Alchemy uses **four independent sound sources (A/B/C/D)**, each capable of running multiple synthesis elements simultaneously — wavetable, additive, spectral (FFT), granular, and VA. Sources feed through per-source filters, then two main filters in configurable serial/parallel routing, an effects rack, and master output. The Transform Pad morphs between up to 8 snapshots by interpolating every parameter.

The key architectural insight is that Alchemy's synthesis modes are complementary: **additive** handles harmonic tones via individually controllable sine partials, **spectral** uses STFT-based analysis/resynthesis for complex polyphonic material and noise, **granular** provides time/pitch-independent manipulation via grain clouds, and **VA** delivers classic analog waveforms. Spectral resynthesis works by analyzing source audio with STFT, decomposing into magnitude+phase per frequency bin, allowing manipulation (shifting, stretching, morphing), then resynthesizing via inverse FFT.

**Implementation strategy for Rust:**

The wavetable oscillator is the foundation. Use the Nigel Redmon / EarLevel Engineering mip-mapping algorithm: FFT the base waveform, generate one table per octave by progressively zeroing upper harmonics and taking IFFT. A **2048-sample table** is the standard (matches Serum, Vital, Surge XT format). With bandlimited mip-mapped tables, linear interpolation between samples is sufficient — Urs Heckmann of u-he confirms this. For higher quality, Hermite cubic interpolation adds C1 continuity. Cross-table interpolation (crossfading between mip levels at octave boundaries) handles frequency sweeps.

For spectral processing, `rustfft` and `realfft` provide the FFT backbone. Implement STFT as overlapping windowed FFT frames (Hann window, 75% overlap, 2048–4096 point FFT). Spectral morphing interpolates magnitude spectra frame-by-frame between two sources. Phase handling: use phases from one source for simplicity, or interpolate phases for smoother results at the cost of potential artifacts.

Granular synthesis needs a grain scheduler (synchronous for tonal, asynchronous with stochastic intervals for textures), a pool of pre-allocated grains with Hann or Gaussian windows (10–100ms), and independent pitch/position/density control. FunDSP's `granular.rs` provides a starting point.

The modulation matrix is the one component with no off-the-shelf crate. Build it as a flat array of `(source, destination, amount)` tuples evaluated per-block or per-sample. Sources include AHDSR envelopes, LFOs (with multiple shapes), MSEGs, step sequencers, velocity, aftertouch, and mod wheel. Destinations include every synthesis parameter.

**Recommended crate stack for the synth core:**

```toml
fundsp = { version = "0.23", default-features = false }  # Oscillators, filters, effects
rustfft = "6"              # Spectral processing
realfft = "3"              # Real-to-complex FFT
mi-plaits-dsp = "0.5"      # 24 additional synthesis algorithms
dasp = "0.11"              # Sample format utilities
```

**Reference implementations to study:** Vital (GPLv3, C++) demonstrates spectral morph modes (Vocode, Harmonic Stretch, Spectral Formant) operating on wavetable FFTs. Surge XT (GPLv3, C++) implements 12 oscillator algorithms including wavetable with Serum-format support, FM, and a Plaits port. The `Wavetable` crate by icsga handles import from WAV, bandlimiting, and compressed storage.

**WASM polyphony targets:** 16 voices for a wavetable-only patch, 8–12 for multi-engine patches with per-voice effects. Use `#[cfg(target_arch = "wasm32")]` to set lower default voice counts. WASM SIMD (128-bit, 4×f32) is supported in all modern browsers — enable with `RUSTFLAGS="-C target-feature=+simd128"`. Process 4 voices' wavetable interpolation in one SIMD pass for ~50% speedup.

---

## Sampler engine: SFZ format with disk streaming on native, memory-based on web

Professional samplers (Kontakt, EXS24/Sampler, Ableton Sampler) share a three-part architecture: a **region list** parsed from an instrument definition file mapping samples to MIDI events via key zones/velocity layers/round-robin groups, a **common resource pool** (sample cache, envelope/LFO/filter pools, MIDI state), and a **pre-allocated voice pool** (64–256 voices) with voice stealing and exclusive groups.

**SFZ is the recommended primary format.** It's text-based and human-readable, free and open with no licensing restrictions, and supports the full feature set: velocity layers (`lovel`/`hivel`), round-robin (`seq_length`/`seq_position`), crossfading (`xfin`/`xfout`), AHDSR envelopes (`ampeg_*`), LFOs, filters, exclusive groups (`group`/`off_by`), keyswitching, legato detection, and release triggers. SFZ v1 is 97% implemented in sfizz, v2 at 75%. The format has a large community and many free instrument libraries at sfzformat.com.

**No mature standalone SFZ parser exists in Rust** — this must be written, using sfizz's C++ parser as architectural reference. For SF2, the `soundfont` crate provides pure Rust parsing, and **OxiSynth** is a full pure-Rust FluidSynth port. For web delivery, pre-process SFZ instruments into a JSON manifest plus compressed audio files.

**Disk streaming architecture (native):** The `creek` crate provides exactly the needed foundation — realtime-safe streaming using Symphonia for decoding, with **cache buffers** (pre-loaded sample starts, like Kontakt's 6–60KB preload) and **look-ahead buffers** (automatic read-ahead). An IO server thread handles non-realtime operations. The API: `ReadDiskStream::<SymphoniaDecoder>::new(path, start_frame, options)`.

**Web target:** Use OPFS (Origin Private File System) for persistent storage — Safari 17+ supports 38GB+ quota, Chrome is generous, Firefox allows 10GB. Load samples into `Float32Array` in Web Workers, transfer to AudioWorklet. Alternatively, use native `AudioBufferSourceNode` for sample playback (runs in optimized browser C++ code, supports 32–64 voices). Abstract behind a `SampleProvider` trait:

```rust
trait SampleProvider {
    fn preload(&mut self, sample_id: SampleId, start: usize, length: usize);
    fn read(&self, sample_id: SampleId, position: usize, frames: usize) -> &[f32];
}
// Native: DiskStreamProvider wrapping creek
// Web: MemoryProvider backed by OPFS/IndexedDB
```

**Time-stretching:** **Signalsmith Stretch** (MIT license, C++11) is the recommended library — it handles polyphonic material well, has Rust bindings (`signalsmith-stretch` and `ssstretch` crates), and ships an NPM WASM package for web. For monophonic content, the `tdpsola` crate provides pure Rust PSOLA with formant preservation. Avoid Rubber Band for commercial use — it's GPL v2+ and requires a commercial license.

**Drum machine** is built on top of the sampler: 128 pads mapped to MIDI notes, each hosting a `OneShotSampler` with per-pad effect chain, choke groups (exclusive groups where triggering one pad kills voices in the same group — identical to SFZ's `group`/`off_by` opcodes), per-pad volume/pan/pitch/filter, and shared send effects.

---

## Professional effects implementation: what's trivial versus expert-level

Effects span a wide difficulty range. Here is a practical assessment with specific algorithms and Rust resources for each category.

**EQ (trivial to moderate):** The Robert Bristow-Johnson Audio EQ Cookbook — now a W3C Working Group Note at `webaudio.github.io/Audio-EQ-Cookbook/` — provides complete coefficient formulas for lowpass, highpass, bandpass, notch, peaking, low shelf, and high shelf biquad filters. The `biquad` crate implements all types in `no_std` Rust. A professional **8-band parametric EQ** is simply 8 cascaded biquad peaking filters with independent frequency/gain/Q, plus shelving and HP/LP filters at the ends. **Linear-phase EQ** requires FFT: compute the biquad's impulse response, extract magnitude via FFT, apply to input signal's FFT, then IFFT — adds latency equal to half the FIR length.

**Compressor (moderate):** The definitive reference is Giannoulis, Massberg & Reiss, "Digital Dynamic Range Compressor Design — A Tutorial and Analysis" (JAES 2012). Feed-forward topology (sidechain taps before gain reduction) is preferred for digital — it's stable, predictable, and enables true brickwall limiting. Level detection uses `α = exp(-1 / (time * sample_rate))` for attack/release smoothing. Soft knee uses quadratic interpolation over a width W centered on threshold. The `audio-processor-dynamics` crate implements the Giannoulis algorithm. The `compressor` crate provides peak/RMS envelope detection.

**Reverb (trivial to expert):** The `freeverb` crate is a direct Rust port of the classic Freeverb algorithm (8 parallel comb filters + 4 series allpass filters) — trivial to integrate. Jon Dattorro's plate reverb algorithm ("Effect Design Part 1," JAES 1997) is fully documented with all delay lengths and coefficients at `ccrma.stanford.edu/~dattorro/EffectDesignPart1.pdf` — Sean Costello calls it "a Rosetta Stone of reverb design." FunDSP provides `reverb_stereo()` (allpass loop) and `reverb2_stereo()` (32-channel hybrid FDN). **Convolution reverb** with non-uniform partitioned FFT and zero-latency is the expert-level item — implement using rustfft/realfft with direct time-domain convolution for the head (zero latency) and progressively larger FFT blocks for the tail.

**Modulation effects (easy to moderate):** All share a common pattern — delay line(s) modulated by LFO(s). **Chorus**: 3–6 delay taps at 20–50ms base with ±1–5ms LFO modulation. **Flanger**: single short delay (1–10ms) with LFO + feedback creating comb filter. **Phaser**: cascade of 4–12 first-order allpass filters with LFO-modulated cutoff — produces non-harmonically-spaced notches unlike flanger. **Tremolo**: simply `output = input * (1 + depth * LFO(t)) / 2`. Maerorr's NIH-plug plugins provide open-source Rust implementations of chorus, flanger, phaser, and vibrato.

**Delay effects (easy to expert):** Simple delay is a circular buffer with feedback. Ping-pong cross-routes L/R feedback. **Tape delay** is expert-level: requires wow/flutter (multi-rate LFO pitch modulation), tape saturation (waveshaping in the feedback path), high-frequency rolloff (one-pole lowpass in feedback), and per-repeat degradation. Use crossfade between two delay reads for click-free delay time changes.

**Distortion/Saturation (trivial to expert):** Soft clip (`tanh(k*x)`) is one line. Bitcrusher is bit-depth quantization + sample-rate reduction. **Oversampling is essential** for any nonlinear processing — upsample 2–8x, process, downsample with anti-alias filter. The `saturation` crate provides real-time waveshaping with no dynamic allocation. **Tape saturation** via the Jiles-Atherton hysteresis model is expert-level — Jatin Chowdhury's ChowTape (C++, open-source) is the definitive reference, using ODE solvers or neural network approximations.

**Pitch correction (expert):** Requires real-time pitch detection (YIN or pYIN — `pitch-detection` crate implements both), a correction curve snapping detected pitch to the nearest scale degree, and pitch shifting that preserves formants. The `pyin-rs` crate provides FFT-based pYIN. `loqa-voice-dsp` offers a voice-optimized pYIN with formant extraction via LPC.

**Loudness metering (moderate):** The `bs1770` crate implements full ITU-R BS.1770-4 with K-weighting (two cascaded biquads), 400ms momentary windows, absolute gating at -70 LKFS, and relative gating at mean - 10dB.

**Limiter with lookahead (expert):** True peak detection requires 4x oversampling via sinc interpolation, then peak detection on the oversampled signal. The lookahead buffer delays the audio path while letting the sidechain see future samples. Daniel Rudrich's SimpleCompressor (C++, open-source) provides an excellent reference architecture.

---

## The FAUST→Rust pipeline is the secret weapon

FAUST (Functional Audio Stream) has a **native Rust backend** that compiles `.dsp` files directly into pure Rust source code. The `rust-faust` crate (`faust-build`, `faust-types`, `faust-state`) integrates this at compile time. Because the output is pure Rust, it compiles to both native and WASM targets without any FFI.

FAUST's standard library (`libraries/`) contains production-quality implementations of:

- **Reverbs**: Freeverb, Zita-Rev1, FDN reverbs, plate reverb, room reverb
- **Dynamics**: Compressor, limiter, gate, expander, multiband compressor
- **Filters**: Biquad, SVF, Moog ladder, Korg35, Oberheim, resonant bandpass, parametric EQ
- **Delays**: Stereo delay, ping-pong, tape delay, multitap
- **Modulation**: Chorus, flanger, phaser, tremolo, vibrato, wah-wah
- **Distortion**: Tube stages, waveshapers, cubic nonlinearities
- **Physical models**: Karplus-Strong, waveguide, modal synthesis
- **Analysis**: Envelope followers, pitch trackers, spectral analysis

The `lamb-rs` plugin (NIH-plug + FAUST) demonstrates this pipeline: a lookahead compressor/limiter where DSP is written in FAUST, compiled to Rust, and wrapped in a NIH-plug VST3/CLAP plugin. The `nih-faust-jit` plugin takes this further by JIT-compiling FAUST scripts at runtime via libfaust/LLVM.

**Avoid C++ FFI for anything that needs WASM compatibility.** C++ libraries cannot be linked via `#[link]` in a WASM target. To use C++ DSP in WASM, you'd need to compile the C++ itself to WASM via Emscripten — complex and fragile. The FAUST→Rust pipeline sidesteps this entirely.

---

## Web version compromises less than expected

The web target has three powerful advantages that reduce the native-vs-web gap significantly.

**Native Web Audio nodes run in optimized browser C++ code.** The `ConvolverNode` performs partitioned FFT convolution for impulse responses (handles stereo IRs up to ~5 seconds at negligible CPU cost). `BiquadFilterNode` provides all EQ Cookbook filter types. `DynamicsCompressorNode` offers basic compression. `WaveShaperNode` handles distortion curves. `AnalyserNode` provides FFT-based spectrum analysis. `DelayNode` handles basic delay. `GainNode` and `StereoPannerNode` cover utility needs. Using these for standard effects means the WASM AudioWorklet only needs to handle custom synthesis and complex effects.

**SharedArrayBuffer enables efficient cross-thread communication.** In Tauri, you control HTTP headers, so `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` are always available. Use SAB for: audio thread ↔ UI thread visualization data (spectrum, waveform, meters at 30–60fps via `requestAnimationFrame`), parameter automation, and heavy DSP offloading to Web Workers.

**Realistic performance budget:** The AudioWorklet processes **128 frames per callback** (~2.9ms at 44.1kHz). Casey Primozic's benchmarks show a 16-voice wavetable synth running in ~0.013ms per quantum in WASM. Practical targets: **32 voices** for wavetable-only synth, **16 voices** for multi-engine synth with per-voice effects, **32–64 voices** for sample playback via native `AudioBufferSourceNode`, and **2–4 simultaneous** native `ConvolverNode` instances.

**Where web genuinely compromises:**

- No disk streaming — all samples must be decoded into memory (use OPFS for persistent caching, lazy-load from CDN)
- Reduced velocity layers for sample instruments (3–4 vs 8–12 native)
- No multi-threaded DSP — AudioWorklet is single-threaded (workaround: heavy DSP in a Worker thread communicating via SAB)
- WASM SIMD is 128-bit only (4×f32) vs native AVX's 256-bit (8×f32) — roughly 60–80% of native throughput
- Long convolution reverb tails (>5 seconds) stress the single-threaded model — truncate or use algorithmic tail extension

---

## UI strategy: inline panels with Canvas visualization

DAW plugin UIs follow three patterns: **Bitwig's deeply integrated inline panels** (custom Java/OpenGL, consistent across all devices), **Ableton's standardized bottom panel** (fixed-height device view), and **Logic's floating windows** (per-instrument elaborate GUI). For a Tauri/React DAW, the Ableton pattern works best: inline device panels in a bottom dock, with optional floating Tauri windows for expanded views.

**react-knob-headless** is the recommended knob component — it's an unstyled, accessible rotary control primitive designed specifically for audio applications, supporting linear and non-linear interpolation (essential for frequency knobs that need logarithmic mapping), smooth drag gestures, and ARIA compliance. For film-strip image-based knobs (classic DAW aesthetic), **webaudio-controls** provides WebComponents that work with React wrappers.

**Visualization rendering strategy:** Use **SVG** for knobs, sliders, and envelope editors (resolution-independent, interactive, declarative). Use **Canvas 2D** for oscilloscope, waveform display, and spectrum analyzer — draw directly, bypassing React reconciliation for 60fps performance. Use **WebGL** only for GPU-intensive 3D visualizations. Read visualization data from SharedArrayBuffer in a `requestAnimationFrame` loop, never via `postMessage` (which causes GC pauses). The **Cyma** crate provides visualizer components specifically for NIH-plug/VIZIA UIs — study its architecture for the React equivalent.

---

## Content pipeline: presets, samples, wavetables, and impulse responses

**Presets** should use JSON format for human readability, version control, and cross-platform compatibility. Target **200–500 presets per synth instrument** and **20–50 per effect**. Logic's Alchemy ships 3,000+ presets organized hierarchically: Category → Subcategory → Genre → Timbre. Implement tag-based search (genre, character, use case), favorites, and user preset save/load alongside factory presets.

**Sample content** delivery follows Logic's download-on-demand model (72GB library delivered as ~900 individual packs). For a Tauri app, deliver an essential bundle (~500MB–1GB compressed) at install, with additional packs downloadable via the Rust HTTP client. Store on local filesystem (Tauri's advantage over pure web). Use **Opus at 128–192kbps** for general delivery and **FLAC** for quality-sensitive samples. Decode to PCM at runtime via Symphonia.

**Wavetable content** should use the de facto standard: WAV files with **2048 samples per frame**, up to 256 frames per table (Serum-compatible format). The **Adventure Kid Waveforms (AKWF)** collection is public domain and widely used. **KRC Mathwaves** offers 1,600 free wavetables. **WaveEdit** (by Andrew Belt) is an open-source wavetable editor. Bundle 100–200 factory wavetables from these sources, plus generate additional tables from mathematical synthesis and audio analysis.

**Impulse responses** for convolution reverb: curate 50–100 IRs from Creative Commons sources. **OpenAIR** (University of York) provides acoustic spaces under CC licenses. **Voxengo** offers 37 royalty-free IRs. **EchoThief** has 100+ real-world spaces. **reverb.js** provides CC-licensed IRs specifically curated for web use. The `IsaakCode/freeaudio` GitHub repository maintains a comprehensive master list. Use standard WAV format, stereo, 44.1kHz or 48kHz. On the web, the native `ConvolverNode` handles IR loading and processing natively.

---

## Recommended implementation roadmap

**Phase 1 — Essential effects:** Parametric EQ from `biquad` crate (cascade 8 peaking/shelf filters), compressor from Giannoulis algorithm, limiter with lookahead, noise gate, gain/utility, Freeverb reverb from `freeverb` crate, simple stereo delay, and LUFS meter from `bs1770`. These are moderate difficulty and well-served by existing crates.

**Phase 2 — Core instruments:** Wavetable oscillator with mip-mapped bandlimiting (Nigel Redmon algorithm), basic polyphonic synth voice with AHDSR envelopes and SVF filter, SFZ parser and sampler engine with creek disk streaming on native, and drum machine with pad mapping and choke groups.

**Phase 3 — Extended effects:** Convolution reverb (non-uniform partitioned FFT via rustfft/realfft), chorus/flanger/phaser (delay lines + LFOs + allpass chains), tape delay (wow/flutter + saturation + filtering), distortion/saturation (tanh waveshaping + oversampling), and multiband compressor (Linkwitz-Riley crossovers + per-band compression).

**Phase 4 — Flagship synth and advanced features:** Expand wavetable synth with granular engine, spectral processing (STFT via rustfft), additive synthesis, and modulation matrix. Integrate mi-plaits-dsp-rs for additional synthesis modes. Add pitch correction (pitch-detection crate + correction curve + formant-preserving shifting). Build amp simulator from cascaded waveshaping stages with cabinet IR convolution.

**Phase 5 — Content and polish (ongoing):** Factory presets (200+ per synth, 30+ per effect), sample library with download-on-demand packs, wavetable collection from open-source sources, IR library from CC-licensed collections, and WASM optimization pass for web polyphony targets.

## Conclusion

The Rust audio ecosystem has reached a tipping point where building Logic Pro-class factory plugins is ambitious but achievable. The combination of **FunDSP** for composable DSP primitives, **mi-plaits-dsp-rs** for synthesis engines, **FAUST→Rust** for access to 1,000+ proven algorithms, and **rustfft** for spectral processing covers the majority of required DSP. The dual-target architecture works by placing all DSP in a shared `audio-core` crate with `#[cfg(target_arch)]` gates for platform-specific paths: creek-based disk streaming on native, memory-based with OPFS on web; full SIMD on native, WASM SIMD (128-bit) on web; unlimited polyphony on native, 16–32 voices on web. The web version's biggest advantage is leveraging native Web Audio nodes — ConvolverNode, BiquadFilterNode, DynamicsCompressorNode — which run in browser-optimized C++ at zero WASM cost, making the web experience far more capable than a pure-WASM approach would suggest. The remaining hard problems — a production-quality modulation matrix, non-uniform partitioned convolution, real-time pitch correction, and tape saturation modeling — require genuine DSP expertise, but the open-source reference implementations (SimpleCompressor, ChowTape, Dattorro's published algorithm, the Giannoulis compressor paper) provide complete algorithmic foundations rather than leaving implementers to derive from first principles.
