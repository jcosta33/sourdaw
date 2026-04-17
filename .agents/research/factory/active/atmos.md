# Building a 7.1.4 Atmos-ready immersive mixing engine in Rust

**Object-based spatial audio requires three interlocking DSP subsystems — a VBAP panner for speaker rendering, an HRTF convolver for headphone monitoring, and an ADM BWF exporter for Dolby-compliant delivery — all of which can be built efficiently in Rust using existing crate infrastructure.** The bed-versus-object distinction that defines Dolby Atmos is fundamentally a metadata routing decision, not a DSP one: beds are channel-based mixes locked to a speaker layout (maximum 7.1.2), while objects carry per-sample position automation that renderers interpret at playback. This architecture means your DAW's mixer must maintain two parallel signal paths and export time-stamped spatial metadata in the ITU-R BS.2076 Audio Definition Model format. The following report covers every layer of this stack — from the linear algebra of 3D panning through binaural rendering optimization to byte-level file format construction — with formulas, pseudocode, and Rust-specific recommendations throughout.

---

## How Pro Tools, Logic Pro, and Nuendo separate beds from objects

The single most important UX decision in an Atmos-capable DAW is how users designate a track as a **bed** (channel-based, fixed to speakers) versus an **object** (position-automated, metadata-driven). The three major DAWs solve this differently, but converge on a shared pattern: the panner widget itself signals the routing mode.

**Pro Tools** (native Atmos renderer since 2023.12) uses a **Bus/Object toggle button** in the output window. When a track has both a bed bus and an object assignment, a single click switches between them. The pan cursor changes color — **green for bed, orange for object, yellow for automation-off** — providing instant visual feedback. Object metadata status is indicated by a small arrow next to the object selector (green = actively sending to renderer, grey = inactive). The 3D panner offers two modes: a top-down rectangular field with a separate Height knob and ascending line indicator, and a **Theater View** showing a rotatable 3D cube with a green height plane. Pro Tools also provides a dedicated Renderer Window with a 3D box visualization showing all object positions as dots.

**Logic Pro** (Spatial Audio since 10.7) takes a simpler approach: the **shape of the pan control itself** indicates the mode. A **circular** panner means surround/bed routing; a **square** panner means 3D Object. Users switch by Control-clicking the panner or changing the output slot to "3D Object Panner." The 3D Object Panner window provides an upper grid for Left/Right and Front/Back positioning and a lower section for Elevation, plus Size and Spread parameters. Logic supports only a single bed per project (the surround master), which simplifies the mental model but limits flexibility compared to Pro Tools' multiple beds.

**Nuendo** (ADM Authoring since v11) uses the VST MultiPanner with explicit **Bed Mode and Object Mode buttons** at the top of the plugin. It provides the richest visualization: a Top View for XY panning where height is encoded as puck size, and a Rear View for XZ panning. Color-coded handles (blue for mono, yellow/red for stereo L/R) and green/red LED indicators for renderer connection status give clear feedback. The ADM Authoring window provides a centralized panel listing every bed and object with IDs, source tracks, and binaural render mode settings.

All three DAWs share common patterns worth adopting. Monitoring format switching uses a single dropdown (7.1.4, 5.1, stereo, binaural). Simultaneous speaker and headphone monitoring is supported when the interface has sufficient outputs. The **128-input limit** is enforced structurally — a 7.1.2 bed consumes 10 of the 128 slots, leaving 118 for objects. DAWs prevent exceeding this by simply not offering additional object routing paths rather than showing warning dialogs. Users manage the budget by submixing multiple sources to shared object buses.

For your DAW, the recommended UX pattern combines the best of these approaches: a **per-track toggle** (bed/object) with **color-differentiated panner widgets**, a 3D hemisphere or cube visualization with drag-to-pan and a separate elevation control, and a **session-wide object budget display** showing allocation against the 128-track ceiling.

---

## VBAP mathematics: from speaker triangulation to panning gains

Vector Base Amplitude Panning, introduced by Ville Pulkki in 1997, reformulates spatial panning as a matrix equation. Given a virtual source direction vector **p** and an enclosing loudspeaker triplet with direction vectors **l₁**, **l₂**, **l₃**, the unnormalized gain vector is:

**g̃ = L⁻¹ · p**, where L = [l₁ | l₂ | l₃] is the 3×3 matrix of speaker unit vectors.

Power normalization ensures energy preservation: **gᵢ = g̃ᵢ / √(g̃₁² + g̃₂² + g̃₃²)**. This is preferred over amplitude normalization (Σgᵢ = 1) for typical reverberant mixing rooms. Speaker and source directions convert from azimuth/elevation to Cartesian via `x = cos(θ)cos(φ)`, `y = sin(θ)cos(φ)`, `z = sin(φ)`.

### Triangulating the speaker layout

The speaker layout must be triangulated at setup time to determine which three speakers surround any given source direction. For 3D layouts, this is equivalent to computing the **convex hull** of the speaker direction vectors projected onto the unit sphere. The algorithm proceeds as follows: convert all N speaker directions to Cartesian unit vectors, compute the 3D convex hull using Quickhull, validate each triangular face by checking that its normal points outward from the origin (dot product with any vertex > 0), and discard triangles with aperture angles exceeding ~100° (phantom sources across very wide triangles are perceptually poor). For each valid triplet, precompute and store the 3×3 inverse matrix L⁻¹.

A standard **7.1.4 layout** (ITU-R BS.2051 System C) places 7 ear-level speakers at 0°, ±30°, ±90°, ±135° azimuth (all 0° elevation) and 4 height speakers at ±45° azimuth, ±135° azimuth (all at 30–45° elevation). The LFE has no directional position. This produces approximately **16–22 valid triplets** after convex hull triangulation. Two practical issues arise: below the horizontal plane there are no speakers, so an imaginary speaker at nadir should be inserted (gains assigned to it are discarded or distributed to nearest horizontal speakers with a 1/√N factor); similarly, an imaginary zenith speaker helps avoid asymmetric triangulation of the four height speakers.

### Finding the active triplet and computing gains

For a given source direction **p**, iterate through all precomputed triplets and test each:

```rust
let g0 = inv[0]*p[0] + inv[1]*p[1] + inv[2]*p[2];
let g1 = inv[3]*p[0] + inv[4]*p[1] + inv[5]*p[2];
let g2 = inv[6]*p[0] + inv[7]*p[1] + inv[8]*p[2];
if g0 >= -0.001 && g1 >= -0.001 && g2 >= -0.001 {
    // Source is inside this triplet — normalize and apply
    let norm = (g0*g0 + g1*g1 + g2*g2).sqrt();
    gains[speakers[0]] = g0 / norm;
    gains[speakers[1]] = g1 / norm;
    gains[speakers[2]] = g2 / norm;
    break;
}
```

With only ~20 triplets for 7.1.4, this linear search costs a few dozen multiply-adds — trivially fast at control rate. A lookup table (1° resolution = 65,160 entries) is only justified for hundreds of simultaneous sources.

### MDAP spread and the LFE channel

Standard VBAP activates at most 3 speakers, causing **audible width fluctuations** as a source crosses between triangles. Multiple Direction Amplitude Panning (MDAP, Pulkki 1999) addresses this by generating N auxiliary virtual sources (typically 8) arranged in a ring at angular distance α from the main direction on the unit sphere:

**auxₖ = cos(α)·p + sin(α)·(cos(2πk/N)·u + sin(2πk/N)·v)**

where **u** and **v** form an orthonormal basis perpendicular to **p**. Each auxiliary source gets independent VBAP gains; the results are summed and power-normalized. A spread of 0° gives standard VBAP; **10–25° provides natural point-source width**; 90°+ creates ambient diffusion.

The **LFE channel is always excluded from VBAP**. Below ~80 Hz, human hearing cannot localize direction, making spatial panning meaningless for sub-bass content. Provide a separate `lfe_send` gain parameter per source, independent of the spatial panner. Bass management (crossover-based redirection of low frequencies from directional speakers to the subwoofer) belongs in the monitoring chain downstream of VBAP.

For smooth panning, update gains at control rate (per audio block of 64–512 samples) and **linearly interpolate per-sample** between old and new gains to prevent zipper noise. Exponential smoothing with a 5–10 ms time constant works equally well.

---

## Binaural HRTF rendering for headphone monitoring

Headphone monitoring is essential for Atmos mixing accessibility. The engine must convolve each spatial audio object with the appropriate Head-Related Transfer Function for its direction, producing a stereo binaural signal. This section covers dataset selection, interpolation, efficient convolution, and the critical Ambisonics optimization for many-object scenes.

### Choosing an HRTF dataset

Five publicly available datasets dominate the field. The **Bernschütz KU100** dataset (TH Köln) offers the highest spatial resolution at **16,020 measurement positions** on a full-sphere Gauss quadrature grid at 48 kHz, making it ideal for spherical harmonics decomposition up to very high orders. **SADIE II** (University of York) provides 8,802 positions per dummy head at 44.1/48/96 kHz with diffuse-field compensated and minimum-phase variants — notably, Google's YouTube 360 spatial audio uses the SADIE II KU100 set. The **MIT KEMAR** dataset remains a classic baseline with 710 positions and 512-tap HRIRs at 44.1 kHz. **CIPIC** offers 1,250 directions across 45 subjects (useful for personalization research), and the **ARI database** provides over 220 human subjects. All are available in the **SOFA format** (AES69), a NetCDF4/HDF5-based container storing impulse response arrays of shape [M × R × N] (measurements × receivers × samples) with source position metadata.

For a production DAW, start with **Bernschütz KU100 HRIR_L2702** (2,702-point Lebedev grid) for best spherical harmonics support, or SADIE II KU100 for streaming-compatible output.

### Interpolating HRTFs for arbitrary directions

Three interpolation methods exist in order of increasing sophistication. **Nearest-neighbor with crossfade** simply selects the closest measured position and crossfades when the selection changes — simple but produces audible jumps at measurement boundaries. **Barycentric interpolation** pre-triangulates the measurement grid (Delaunay on the sphere), finds the enclosing triangle for any desired direction, computes barycentric weights (w₁, w₂, w₃), and blends three HRIRs: H(θ,φ) = w₁·H₁ + w₂·H₂ + w₃·H₃. Critically, the interaural time difference (ITD) must be extracted, removed, and re-applied after interpolation to avoid comb-filtering artifacts. **Spherical harmonics interpolation** decomposes the entire HRTF dataset into SH coefficients offline, enabling continuous reconstruction at any direction via H(f, Ω) = Σ hₙₘ(f)·Yₙₘ(Ω). Full-bandwidth reconstruction requires SH order ~30–35 (for the Bernschütz dataset this is feasible), but practical implementations use order 15–20 with magnitude-only optimization above the spatial aliasing frequency.

Barycentric interpolation offers the best quality-to-cost ratio for per-object rendering. Reserve SH interpolation for the Ambisonics binaural decoding path described below.

### Partitioned convolution in Rust

Each source requires stereo HRTF convolution (one filter per ear). For a 256-tap HRIR at 128-sample audio buffer, the **uniformly partitioned overlap-save (UPOLS)** method works as follows: partition the HRIR into P = ⌈256/128⌉ = 2 sub-filters of 128 samples each, pre-compute their FFTs at size 2B = 256. Per audio block: FFT the input (zero-padded to 256), push to a frequency-domain delay line (FDL), multiply-accumulate across P partitions, IFFT, and take the last 128 samples. This adds exactly one buffer of latency (128 samples = **2.67 ms at 48 kHz**).

The `realfft` crate (8.8M downloads, wrapping `rustfft`) provides real-valued FFT that halves computation versus complex FFT for real audio signals. The `sofar` crate binds to libmysofa for SOFA file reading and includes a built-in uniformly partitioned convolution renderer capable of handling "a couple hundred individual spatial emitters" on modern hardware. The `hrtf` crate (used by the Fyrox game engine) implements barycentric interpolation on a triangulated HRIR sphere with overlap-save convolution, though it has known click artifacts with fast-moving sources.

### Ambisonics-based optimization for many objects

Per-object HRTF convolution scales linearly: **N objects × 2 convolutions**. At 60 objects, that is 120 simultaneous convolutions — prohibitively expensive. The Ambisonics approach caps cost at a fixed number regardless of object count.

The key insight: encode all objects into Higher Order Ambisonics channels (a simple per-sample multiply, not a convolution), then decode the combined HOA signal to binaural with a fixed set of HRTF convolutions. Encoding a source at direction Ωₛ to SH channel (n,m) is just aₙₘ(t) = s(t)·Yₙₘ(Ωₛ). Multiple sources sum linearly. Binaural decoding convolves each of the L = (N+1)² Ambisonics channels with pre-computed SH-domain HRTF filters.

The crossover point depends on Ambisonics order:

| Order | Channels | Convolutions (2 ears) | Break-even vs. direct |
| ----- | -------- | --------------------- | --------------------- |
| 3     | 16       | 32                    | **16 objects**        |
| 5     | 36       | 72                    | 36 objects            |
| 7     | 64       | 128                   | 64 objects            |

**3rd-order Ambisonics (16 channels, 32 convolutions)** is the practical sweet spot. Above 16 objects, it is already more efficient than direct rendering, and with MagLS decoding (Magnitude Least Squares, Schörkhuber et al. 2018) the quality is perceptually near-equivalent to direct HRTF convolution. MagLS optimizes only the HRTF magnitude above the SH spatial aliasing frequency (~2 kHz at order 3), exploiting the fact that humans cannot perceive phase errors in continuous signals above this range. Research consensus (Engel et al., Acta Acustica 2022) confirms MagLS as the best-performing method for order-limited binaural Ambisonics rendering.

A hybrid architecture works best: route the highest-priority sources (lead vocal, featured instrument) through direct per-object HRTF convolution for maximum spatial accuracy, and route all remaining sources through the 3rd-order Ambisonics bus. This caps total convolution cost while preserving perceptual quality where it matters most.

```rust
struct BinauralEngine {
    hrtf_dataset: HrtfDataset,          // Loaded from SOFA via sofar crate
    direct_convolvers: Vec<StereoConvolver>, // High-priority sources
    ambi_encoder: AmbisonicEncoder,     // Order 3 → 16 channels
    ambi_decoder: AmbisonicBinauralDecoder, // 16 × 2 = 32 fixed convolutions
    fft_plans: Arc<FftPlans>,           // Shared realfft plans
}
// Decision: if num_sources <= 16 { direct } else { hybrid }
```

---

## ADM BWF file format: the Atmos delivery container

Dolby Atmos deliveries require an Audio Definition Model Broadcast Wave Format file — a standard WAV with three additional RIFF chunks embedding spatial metadata. Understanding this format at the byte level is essential for building a Rust-native export engine.

### The ADM XML schema (ITU-R BS.2076-3)

The ADM organizes audio metadata in a two-part hierarchy. The **content part** describes _what_ is being presented: an `audioProgramme` references one or more `audioContent` elements (semantic groupings like "dialogue," "music"), each referencing `audioObject` elements. The **format part** describes _how_ audio is formatted: each `audioObject` references an `audioPackFormat` (channel layout definition), which groups `audioChannelFormat` elements containing the actual spatial data via `audioBlockFormat` sub-elements.

The critical element is `audioBlockFormat`, which carries time-stamped position data:

```xml
<audioBlockFormat audioBlockFormatID="AB_00031001_00000001"
                  rtime="00:00:00.00000" duration="00:00:02.00000">
  <position coordinate="azimuth">-90.0</position>
  <position coordinate="elevation">30.0</position>
  <position coordinate="distance">1.0</position>
  <gain>1.0</gain>
  <width>0.2</width>
  <height>0.1</height>
  <depth>0.0</depth>
</audioBlockFormat>
```

The `rtime` and `duration` attributes create a timeline of spatial automation. A moving object generates a sequence of `audioBlockFormat` elements with successive time stamps — this is how panning automation from your DAW translates to Atmos metadata.

Two `typeDefinition` values matter for Atmos: **0001 (DirectSpeakers)** for channel-based beds using predefined speaker labels from ITU-R BS.2094 common definitions, and **0003 (Objects)** for position-automated elements with custom metadata. Beds reference common definition IDs (e.g., `AP_00010017` for the standard 7.1.2 pack), eliminating the need to define speaker positions in the XML. Objects require custom `audioPackFormat`, `audioChannelFormat`, `audioStreamFormat`, and `audioTrackFormat` definitions.

### BWF file structure at the byte level

The ADM BWF file is a RIFF WAVE container with these chunks:

The **`fmt` chunk** uses WAVE_FORMAT_EXTENSIBLE (tag 0xFFFE) for multi-channel audio: 24-bit PCM at 48 kHz, with `channelMask` set to 0 (channel assignment is defined by chna/axml, not the WAV channel mask). The **`chna` chunk** is a binary structure mapping WAV track indices to ADM audioTrackUID references. Each entry is exactly **40 bytes**: 2 bytes for the 1-based track index, 12 bytes for the UID string ("ATU_xxxxxxxx"), 14 bytes for the track format reference, 11 bytes for the pack format reference, and 1 byte of padding. The **`axml` chunk** contains the complete ADM XML document as raw UTF-8 bytes. An optional **`dbmd` chunk** carries proprietary Dolby metadata (renderer version, downmix settings, per-object binaural distance mode).

The standard Atmos channel layout places the **7.1.2 bed in tracks 1–10** (L, R, C, LFE, Ls, Rs, Lrs, Rrs, Ltf, Rtf) with object tracks starting at track 11. The maximum is **128 total tracks** at 48 kHz (64 at 96 kHz). Importantly, the bed format caps at **7.1.2 — not 7.1.4**. The 7.1.4 layout is a monitoring/rendering target; the additional two height channels are synthesized by the renderer from object metadata and bed content.

### Dolby Atmos ADM Profile constraints

The Dolby Atmos Master ADM Profile (v1.1) imposes specific constraints beyond the base ITU standard: only **one audioProgramme** element is permitted, only DirectSpeakers (0001) and Objects (0003) type definitions are allowed (no HOA or Matrix), a maximum of **10 audioChannelFormatIDRef** entries per DirectSpeakers pack, and exactly **1 audioChannelFormatIDRef** per Objects pack. Default naming follows "Atmos_Bed_M" for beds and "Atmos_Obj_N" for objects. Files exceeding 4 GB must use the **BW64 container** (ITU-R BS.2088) with a `ds64` chunk for 64-bit sizes — a 128-channel, 5-minute session at 48 kHz/24-bit produces approximately 5.3 GB.

---

## Rust crate ecosystem and implementation architecture

Building the complete stack requires careful crate selection across five functional areas.

For **FFT and convolution**, `rustfft` (v6.4, 15.5M downloads, MIT/Apache-2.0) provides arbitrary-length complex-to-complex FFT in pure Rust with SIMD auto-vectorization. Wrap it with `realfft` (v3.5, 8.8M downloads) for real-valued transforms that halve computation — critical since audio signals are real-valued. For a 128-sample buffer with 256-tap HRIRs, use FFT size 256 with `realfft` producing 129 complex coefficients.

For **HRTF and SOFA file handling**, the `sofar` crate provides high-level Rust bindings to libmysofa (the C library used by OpenAL Soft and VLC) with built-in SOFA reading, resampling, nearest-neighbor/interpolated lookup, and a uniformly partitioned convolution renderer. The `hrtf` crate (v0.8.1) offers a pure-Rust alternative with barycentric interpolation on triangulated measurement grids, though it lacks SOFA support and has known artifacts with fast source movement.

For **WAV file writing**, the `hound` crate (v3.5, 7.5M downloads) handles standard WAV but **cannot write custom RIFF chunks** (axml, chna, bext). ADM BWF export requires manual RIFF construction — write the RIFF header, fmt chunk (WAVE_FORMAT_EXTENSIBLE), bext chunk, chna chunk (binary, 40 bytes per entry), axml chunk (UTF-8 XML bytes), and data chunk (interleaved 24-bit PCM) using standard `std::io::Write` + `Seek`. Use `BufWriter` for performance and handle RIFF word-alignment padding (odd-length chunks get a trailing zero byte).

For **XML generation**, `quick-xml` is the recommended choice — it provides a streaming writer that generates well-formed XML without building a DOM tree, which is important for the potentially large ADM XML documents that time-varying object metadata produces.

For **convex hull triangulation** (VBAP speaker layout setup), implement 3×3 matrix inversion directly using Cramer's rule (trivial for the fixed-size case) rather than pulling in a full linear algebra crate. For the convex hull itself, port the Quickhull algorithm or use `nalgebra` for the geometric primitives. This computation runs once at layout configuration time, so performance is not critical.

### Recommended architecture summary

The complete system comprises three processing layers operating at different rates:

- **Control rate** (per audio block, every 2–10 ms): VBAP gain computation for each source, HRTF filter selection/interpolation, Ambisonics encoding coefficients
- **Audio rate** (per sample): gain interpolation and application for VBAP, partitioned convolution for binaural rendering
- **Offline** (at bounce/export time): ADM XML serialization from panning automation data, chna chunk construction from session track layout, multi-channel interleaved PCM writing with custom RIFF chunks

The frontend (React/TypeScript) communicates spatial parameters to the Rust audio engine via a low-latency message channel. Each track's bed/object designation, 3D position (azimuth, elevation, distance), spread, and LFE send level are control parameters updated at UI frame rate and smoothly interpolated in the audio thread. The 3D panner UI should provide both a hemisphere/top-down drag visualization and numeric XYZ fields, with color differentiation between bed (green) and object (orange) modes following the established Pro Tools convention.

---

## Conclusion: key architectural decisions

The most consequential design choice is the **hybrid binaural rendering architecture** — direct HRTF convolution for high-priority sources, 3rd-order Ambisonics with MagLS decoding for everything else. This caps CPU cost at a fixed ceiling regardless of object count while maintaining perceptual quality. For VBAP, real-time computation per block is fast enough for 7.1.4 (only ~20 triplets to test) that lookup tables add unnecessary complexity. The ADM BWF exporter must be built from raw RIFF primitives since no Rust crate handles custom chunks, but the format is straightforward once the chna binary structure and XML schema are understood. The bed format maxes at 7.1.2 in the Atmos ecosystem — 7.1.4 exists only as a renderer output — which simplifies the export path. Finally, the `sofar` + `realfft` + `quick-xml` crate combination covers the critical dependencies, with manual RIFF writing for the final file assembly. This architecture positions the DAW for full Dolby Atmos compliance while keeping the Rust audio engine deterministic and real-time safe.
