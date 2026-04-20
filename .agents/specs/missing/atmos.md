# Dolby Atmos 7.1.4 Immersive Mixing Engine

## Context

The Sourdaw DAW currently supports stereo and basic surround mixing through a standard `StereoPannerNode`. To compete with Pro Tools, Logic Pro, and Nuendo in professional immersive audio production, we need a complete Dolby Atmos-compatible mixing engine. This feature enables object-based spatial audio mixing with speaker rendering (VBAP), headphone monitoring (HRTF), and industry-standard ADM BWF export for delivery.

Research reference: `.agents/research/factory/active/atmos.md`

---

## Goal

Implement a 7.1.4 Atmos-ready mixing engine with per-track bed/object mode selection, 3D VBAP panning, hybrid HRTF/Ambisonics binaural monitoring, and ADM BWF export compliant with Dolby Atmos Master ADM Profile v1.1.

---

## User-visible behavior

### Track Mode Selection

- Each track has a **Bed/Object toggle** in the output window/track header
- **Bed mode**: Channel-based routing (7.1.2 max), fixed speaker mapping
    - Panner cursor color: **green**
    - Circular panner shape (following Logic Pro convention)
- **Object mode**: Position-automated, metadata-driven
    - Panner cursor color: **orange**
    - **Yellow** when automation is off
    - Square panner shape (following Logic Pro convention)
    - Small arrow next to object selector indicates metadata status: green = actively sending to renderer, grey = inactive
- Object tracks display an **object number badge** (1–118 available slots, 10 reserved for bed)
- **Session object budget display** shows "X of 128 objects used" in the transport bar
- Users manage budget by submixing multiple sources to shared object buses

### 3D Panner UI

- **Top View / Hemisphere view**:
    - Top-down rectangular field for Left/Right and Front/Back positioning
    - Draggable position puck
    - Height encoded as puck size (following Nuendo convention)
- **Rear View**: XZ panning view (optional, following Nuendo)
- **Elevation control**:
    - Separate slider (-90° to +90°)
    - Visual height indicator with ascending line (following Pro Tools)
- **Distance control**: Near-field distance adjustment (0.5–2.0 normalized)
- **Size control**: Source size parameter (following Logic Pro)
- **Spread control**: MDAP spread angle (0°–90°) for source width
    - Visual feedback on hemisphere as ring radius
    - 0° = standard VBAP, 10–25° = natural point-source width, 90°+ = ambient diffusion
- **LFE send**: Independent subwoofer send level (excluded from VBAP panning)
- **Theater View / Renderer Window**:
    - Rotatable 3D cube visualization showing all object positions as dots
    - Green height plane indicator (following Pro Tools)
    - Centralized panel listing every bed and object with IDs, source tracks, and binaural render mode settings (following Nuendo ADM Authoring window)
- **Numeric input fields**: XYZ coordinate fields for precise positioning
- Color-coded handles: blue for mono, yellow/red for stereo L/R (following Nuendo)
- Color coding follows Pro Tools convention: green = bed, orange = object, grey = inactive

### Monitoring

- **Format selector dropdown** in control room: 7.1.4, 5.1.4, 5.1, stereo, binaural
- Simultaneous speaker + headphone monitoring when interface has sufficient outputs
- Binaural mode uses hybrid rendering: direct HRTF for lead sources, 3rd-order Ambisonics for bed/ambient
- Per-object binaural render mode (near/far) accessible in object inspector

### Export

- **Export dialog** gains "ADM BWF (Dolby Atmos)" format option
- ADM export renders bed to tracks 1–10 (L, R, C, LFE, Ls, Rs, Lrs, Rrs, Ltf, Rtf), objects to tracks 11–N
- XML metadata contains `audioBlockFormat` elements with timestamped position automation
- Files >4GB automatically use BW64 container format with `ds64` chunk
- Progress indicator shows "Rendering spatial metadata..." phase during export

---

## Scope

### In scope:

1. **Track model extensions**: `atmosMode: 'bed' | 'object' | 'off'`, 3D position parameters, object ID assignment
2. **VBAP panner**: Real-time 3D speaker panning for 7.1.4 layout using convex hull triangulation
3. **HRTF binaural engine**: Hybrid direct convolution + 3rd-order Ambisonics with MagLS decoding
4. **ADM BWF exporter**: RIFF container with `axml`, `chna`, optional `dbmd` chunks
5. **3D panner UI**: Hemisphere view, Top View, Rear View, elevation/distance/spread controls, Theater View visualization
6. **Object budget management**: 128-track ceiling enforcement with session-wide allocation display
7. **Monitoring format switching**: Control room integration for speaker/binaural monitoring modes
8. **Spatial automation**: 3D position parameters (azimuth, elevation, distance) support full automation

### Non-goals (explicitly out of scope):

1. **Dolby Atmos Renderer integration**: No external renderer plugin support; internal engine only
2. **Dolby Vision / video sync**: Audio-only Atmos implementation
3. **Personalized HRTF**: Single KU100 dataset (Bernschütz or SADIE II), no user head measurement
4. **HOA (Higher Order Ambisonics) bed encoding**: Beds remain channel-based per Atmos spec
5. **Dynamic object rendering**: No runtime object limit changes; fixed 128 budget
6. **Legacy Atmos formats**: Focus on 7.1.4 target, not 9.1.6 or other variants
7. **Networked rendering**: Single-machine mixing only
8. **HRTF dataset selection UI**: Single bundled dataset, no user switching
9. **Single bed limitation (Logic-style)**: We support multiple beds like Pro Tools/Nuendo

---

## Requirements

### R1: Bed/Object Track Mode

- **R1.1**: Each track has an `atmosMode` field: `'bed' | 'object' | 'off'` (default `'off'`)
- **R1.2**: Bed mode consumes fixed bed slots (7.1.2 = 10 tracks: L, R, C, LFE, Ls, Rs, Lrs, Rrs, Ltf, Rtf) shared across all bed-mode tracks
- **R1.3**: Object mode assigns a unique object ID (1–118) from the session budget pool
- **R1.4**: Object ID assignment is automatic on first object-mode selection; manual reassignment allowed via inspector
- **R1.5**: Deleting a track or switching to bed/off mode releases its object ID to the pool
- **R1.6**: UI prevents exceeding 118 object slots (plus 10 bed = 128 total)
- **R1.7**: DAW prevents exceeding budget by not offering additional object routing paths (no warning dialogs)
- **R1.8**: Object metadata status indicator: green arrow = actively sending to renderer, grey = inactive

### R2: 3D Position Parameters

- **R2.1**: Object tracks expose: `azimuth` (-180° to +180°), `elevation` (-90° to +90°), `distance` (0.5–2.0)
- **R2.2**: All position parameters are automatable with existing automation system
- **R2.3**: Bed tracks use standard stereo/surround panner; 3D controls disabled
- **R2.4**: Position updates propagate to audio engine at control rate (per 64–512 sample block)
- **R2.5**: Size parameter for source width control (0.0–1.0)

### R3: VBAP Speaker Rendering

- **R3.1**: 7.1.4 speaker layout (ITU-R BS.2051 System C):
    - Ear level: L, R, C, LFE, Ls, Rs, Lrs, Rrs at 0°, ±30°, ±90°, ±135° azimuth (0° elevation)
    - Height: Ltf, Rtf, Ltr, Rtr at ±45°, ±135° azimuth (30–45° elevation)
- **R3.2**: VBAP matrix equation: **g̃ = L⁻¹ · p**, where L = [l₁ | l₂ | l₃] is 3×3 matrix of speaker unit vectors
- **R3.3**: Power normalization: **gᵢ = g̃ᵢ / √(g̃₁² + g̃₂² + g̃₃²)** (preferred over amplitude normalization for reverberant rooms)
- **R3.4**: Cartesian conversion: `x = cos(θ)cos(φ)`, `y = sin(θ)cos(φ)`, `z = sin(φ)`
- **R3.5**: Speaker layout triangulated at setup using convex hull (Quickhull) of speaker direction vectors on unit sphere
- **R3.6**: Valid triplets validated by checking normal points outward (dot product > 0), discard triangles with aperture > ~100°
- **R3.7**: Precompute and store 3×3 inverse matrix L⁻¹ for each valid triplet (~16–22 triplets for 7.1.4). Use **Cramer's rule** for the 3×3 inversion directly — do not pull in a general linear-algebra crate for this fixed-size case (research `factory/active/atmos.md` §Rust crate ecosystem).
- **R3.8**: Active triplet found by iterating all triplets, testing if gains ≥ -0.001 (source inside triangle)
- **R3.9**: Imaginary nadir speaker for below-horizontal sources (gains discarded or distributed to nearest horizontal speakers with 1/√N factor)
- **R3.10**: Imaginary zenith speaker to avoid asymmetric triangulation of height speakers
- **R3.11**: Gains computed per-block with per-sample linear interpolation to prevent zipper noise
- **R3.12**: Alternative: exponential smoothing with 5–10 ms time constant
- **R3.13**: LFE send is separate gain parameter, excluded from VBAP normalization (spatial panning meaningless below ~80 Hz)
- **R3.13a**: Bass management (crossover-based LF redirection from directional speakers to LFE/sub) is **not** part of VBAP. When implemented, it lives in the **monitoring chain downstream of VBAP**, never inside the panner (research `factory/active/atmos.md` §MDAP/LFE).
- **R3.14**: MDAP spread generates 8 auxiliary virtual sources at angular distance α:
    - **auxₖ = cos(α)·p + sin(α)·(cos(2πk/N)·u + sin(2πk/N)·v)** where u, v are orthonormal basis ⊥ to p
- **R3.15**: MDAP results summed and power-normalized

### R4: HRTF Binaural Monitoring

- **R4.1**: HRTF dataset options (choose one to bundle):
    - **Bernschütz KU100**: 16,020 measurement positions, full-sphere Gauss quadrature, 48 kHz (ideal for SH decomposition)
    - **Bernschütz KU100 HRIR_L2702**: 2,702-point Lebedev grid (recommended for production)
    - **SADIE II**: 8,802 positions, 44.1/48/96 kHz, diffuse-field compensated (used by YouTube 360)
- **R4.2**: SOFA format (AES69) support: NetCDF4/HDF5 container with shape [M × R × N] (measurements × receivers × samples)
- **R4.3**: Barycentric interpolation on triangulated HRIR grid (Delaunay on sphere) for per-object rendering
- **R4.4**: ITD extraction/removal/re-application after interpolation to prevent comb-filtering artifacts
- **R4.5**: Hybrid rendering: ≤16 priority sources use direct HRTF convolution; remainder via 3rd-order Ambisonics. Priority selection is explicit per-track metadata, **not** a "bed vs object" split — a bed track flagged high-priority still routes through direct HRTF; an object left unflagged falls into the Ambisonics sum.
- **R4.6**: Priority determined by: **explicit user "feature" flag** (intended for lead vocal / featured instrument per research), then soloed tracks, then by track order (top = highest priority). Research recommends artist-declared priority over pure track order; track order is the tiebreaker only.
- **R4.7**: Uniformly partitioned overlap-save convolution (UPOLS):
    - 256-tap HRIR with 128-sample buffer → P = 2 partitions
    - FFT size 2B = 256, real-valued FFT via `realfft` crate (129 complex coefficients)
    - Latency: 128 samples = **2.67 ms at 48 kHz**
- **R4.8**: 3rd-order Ambisonics: 16 channels, 32 convolutions (2 ears), break-even at 16 objects
- **R4.9**: MagLS decoding (Magnitude Least Squares — Schörkhuber et al. 2018) for Ambisonics path:
    - Optimizes only HRTF magnitude above spatial aliasing frequency (~2 kHz at order 3)
    - Perceptually near-equivalent to direct HRTF convolution per Engel et al. (Acta Acustica 2022)
- **R4.10**: `sofar` crate for SOFA reading + built-in partitioned convolution renderer
- **R4.11**: `realfft` crate (v3.5) wrapping `rustfft` (v6.4) for real-valued transforms
- **R4.12**: Shared FFT plans (Arc<FftPlans>) across convolvers

### R5: ADM BWF Export

- **R5.1**: Export format option "ADM BWF (Dolby Atmos)" in ExportDialog
- **R5.2**: ADM XML schema (ITU-R BS.2076-3) with two-part hierarchy:
    - **Content part**: `audioProgramme` → `audioContent` (semantic groupings) → `audioObject`
    - **Format part**: `audioObject` → `audioPackFormat` → `audioChannelFormat` → `audioBlockFormat`
- **R5.3**: `audioBlockFormat` structure with timestamped position data:
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
- **R5.4**: `rtime` and `duration` create timeline of spatial automation; moving objects generate sequence of blocks
- **R5.5**: Bed tracks: typeDefinition **0001 (DirectSpeakers)**, reference common definition AP_00010017 (7.1.2 pack)
- **R5.6**: Object tracks: typeDefinition **0003 (Objects)** with custom pack/format/stream/track definitions
- **R5.7**: RIFF chunk structure:
    - `fmt`: WAVE_FORMAT_EXTENSIBLE (tag 0xFFFE), 24-bit PCM at 48 kHz, channelMask = 0
    - `chna`: 40 bytes per entry — 2 bytes **1-based** track index + 12 bytes UID ("ATU_xxxxxxxx") + 14 bytes track format ref + 11 bytes pack format ref + 1 byte padding
    - `bext` (optional but recommended for BWF interchange): EBU Broadcast Wave extension chunk; written before `chna` in canonical order (`fmt` → `bext` → `chna` → `axml` → `data`)
    - `axml`: Complete ADM XML as raw UTF-8 bytes
    - `dbmd` (optional): Dolby metadata (renderer version, downmix settings, per-object binaural distance mode)
- **R5.8**: Standard channel layout: bed in tracks 1–10, objects in tracks 11–N
- **R5.9**: Maximum 128 total tracks at 48 kHz (64 at 96 kHz)
- **R5.10**: Bed format maxes at 7.1.2 (not 7.1.4); 7.1.4 is monitoring/rendering target only
- **R5.11**: Dolby Atmos Master ADM Profile v1.1 constraints:
    - Only one `audioProgramme` element permitted
    - Only DirectSpeakers (0001) and Objects (0003) allowed (no HOA or Matrix)
    - Max 10 `audioChannelFormatIDRef` per DirectSpeakers pack
    - Exactly 1 `audioChannelFormatIDRef` per Objects pack
    - Default naming: "Atmos_Bed_M" for beds, "Atmos_Obj_N" for objects
- **R5.12**: BW64 container (ITU-R BS.2088) with `ds64` chunk for files >4 GB. Sizing reference: a **128-channel, 5-minute session at 48 kHz / 24-bit produces ~5.3 GB** — BW64 is not optional for typical Atmos masters.
- **R5.13**: `quick-xml` streaming writer for XML generation (not DOM)
- **R5.14**: Manual RIFF construction: `std::io::Write` + `Seek` + `BufWriter`
- **R5.15**: RIFF word-alignment padding: odd-length chunks get trailing zero byte

### R6: 3D Panner UI

- **R6.1**: Top View: top-down grid with draggable position puck, height encoded as puck size
- **R6.2**: Rear View: XZ panning view (optional)
- **R6.3**: Elevation slider (-90° to +90°) with ascending line indicator linking to view
- **R6.4**: Numeric input fields for azimuth, elevation, distance, width, height, depth
- **R6.5**: Spread/Size slider (0°–90°) with visual feedback on hemisphere (ring radius)
- **R6.6**: LFE send fader (separate from spatial panning)
- **R6.7**: Color coding: bed = green, object = orange, automation-off = yellow, inactive = grey (per Pro Tools)
- **R6.8**: Color-coded handles: blue = mono, yellow/red = stereo L/R (per Nuendo)
- **R6.9**: Object metadata status: green arrow = active, grey = inactive
- **R6.10**: Theater View: rotatable 3D cube showing all object positions as dots with green height plane
- **R6.11**: ADM Authoring window: centralized panel listing every bed and object with IDs, source tracks, binaural render mode

### R7: Object Budget Management

- **R7.1**: Session-wide object pool: 118 available IDs (10 reserved for 7.1.2 bed)
- **R7.2**: Transport bar displays "X/128 objects" with visual indicator (green <80%, yellow 80–100%, red = full)
- **R7.3**: Attempting to assign object mode when pool exhausted: DAW does not offer additional object routing paths (structural enforcement, not warning dialogs)
- **R7.4**: Object ID inspector allows manual reassignment to unused IDs; prevents duplicates
- **R7.5**: Users manage budget by submixing multiple sources to shared object buses

### R8: Monitoring Integration

- **R8.1**: Control room monitoring format selector includes: 7.1.4, 5.1.4, 5.1, stereo, binaural
- **R8.2**: Speaker mode renders VBAP to physical outputs; binaural mode renders HRTF to headphone outputs
- **R8.3**: Simultaneous output when audio interface has sufficient channels (separate speaker/phone mixes)
- **R8.4**: Per-object binaural render mode setting (near/far) accessible in object inspector
- **R8.5**: Format change requires audio engine reconfiguration (slow path, not hot-swappable during playback)

---

## Constraints

1. **Must follow domain-driven module architecture** (`AGENTS.md`): New `Atmos` module with standard subdirectories
2. **Must follow web-audio-engine skill**: AudioWorklet for custom DSP, one live AudioContext, parameter changes separate from topology
3. **Must follow Rust architecture** (`AGENTS.md`): Heavy DSP (VBAP, HRTF convolution) in `daw-dsp` or new crate, not JavaScript
4. **Must be RT-safe**: No allocation, locks, or blocking on audio thread
5. **Must compile on stable Rust**: No nightly features
6. **Must support 48kHz/24-bit**: Primary target for Atmos delivery
7. **Must handle up to 128 objects**: Memory and CPU planning must accommodate full object budget
8. **Three processing rates**:
    - **Control rate** (per audio block, 2–10 ms): VBAP gain computation, HRTF filter selection/interpolation, Ambisonics encoding coefficients
    - **Audio rate** (per sample): Gain interpolation and application for VBAP, partitioned convolution for binaural rendering
    - **Offline** (at bounce/export): ADM XML serialization, chna chunk construction, multi-channel interleaved PCM writing

---

## Design decisions

### Decision: Hybrid Binaural Architecture

**Chosen:** Direct HRTF convolution for ≤16 priority sources + 3rd-order Ambisonics for remainder

**Rationale:**

- Per-object HRTF scales linearly: N objects × 2 convolutions
- At 60 objects = 120 convolutions — prohibitively expensive
- 3rd-order Ambisonics = 16 channels = 32 fixed convolutions regardless of object count
- Break-even at ~16 objects; above this, Ambisonics is more efficient
- MagLS decoding provides perceptually equivalent quality to direct HRTF (Engel et al. 2022)

**Considered and rejected:**

- Pure direct HRTF: Too CPU-intensive for many objects
- Pure Ambisonics: Lower spatial accuracy for lead sources (vocals, featured instruments)
- Higher-order Ambisonics (5th = 36 channels, 7th = 64 channels): Diminishing returns, higher convolution cost

### Decision: VBAP Gain Computation

**Chosen:** Real-time computation per control block (linear search through ~20 triplets)

**Rationale:**

- 7.1.4 layout produces ~16–22 valid triplets after convex hull
- Linear search = few dozen multiply-adds — negligible at control rate
- Lookup table (1° resolution = 65,160 entries) only justified for hundreds of sources
- Simpler implementation, no interpolation artifacts at triangle boundaries

**Considered and rejected:**

- Precomputed lookup table: Unnecessary memory for small triplet count
- GPU compute: Overkill for control-rate task, adds complexity

### Decision: HRTF Interpolation Method

**Chosen:** Barycentric interpolation on triangulated HRIR grid for per-object; Spherical Harmonics for Ambisonics decoding

**Rationale:**

- Barycentric offers best quality-to-cost ratio for per-object rendering
- ITD extraction/removal/re-application prevents comb-filtering artifacts
- Reserve SH interpolation for Ambisonics path where it's most efficient

**Considered and rejected:**

- Nearest-neighbor with crossfade: Simple but produces audible jumps at measurement boundaries
- Spherical harmonics for per-object: Overkill, better for Ambisonics path

### Decision: ADM BWF Manual Construction

**Chosen:** Manual RIFF writing using `std::io::Write` + `quick-xml` for XML

**Rationale:**

- No Rust crate supports custom RIFF chunks (`axml`, `chna`, `dbmd`)
- `hound` crate (v3.5) handles standard WAV but cannot write custom chunks
- Manual construction provides full control over byte-level layout for Dolby compliance
- Use `BufWriter` for performance; handle RIFF word-alignment padding

**Considered and rejected:**

- Using `hound` with extensions: Crate doesn't support custom chunks
- Wrapping external tool (ffmpeg): Adds dependency, less control over metadata

### Decision: Multi-Bed Support

**Chosen:** Support multiple beds like Pro Tools/Nuendo (not Logic's single bed limitation)

**Rationale:**

- Multiple beds provides greater flexibility for complex mixes
- 7.1.2 bed format maxes at 10 channels regardless of bed count
- Users can organize different instrument groups into separate beds

**Considered and rejected:**

- Single bed per project (Logic approach): Simpler mental model but limits flexibility

---

## Acceptance criteria

- [ ] Track model has `atmosMode`, `atmosPosition` (azimuth/elevation/distance), `atmosObjectId` fields
- [ ] Bed mode uses 7.1.2 channel layout (L, R, C, LFE, Ls, Rs, Lrs, Rrs, Ltf, Rtf)
- [ ] Object mode assigns IDs 1–118; bed consumes 10 slots = 128 total ceiling
- [ ] Object assignment respects 128-track ceiling via structural enforcement (not warnings)
- [ ] Session object budget displays "X/128 objects" in transport bar with color-coded status
- [ ] VBAP panner implements **g̃ = L⁻¹ · p** with power normalization
- [ ] VBAP triangulation produces ~16–22 valid triplets for 7.1.4 layout
- [ ] MDAP spread generates 8 auxiliary sources with formula **auxₖ = cos(α)·p + sin(α)·(cos(2πk/N)·u + sin(2πk/N)·v)**
- [ ] LFE send is separate from VBAP (excluded from normalization)
- [ ] Binaural monitoring uses hybrid: ≤16 direct HRTF + 3rd-order Ambisonics for remainder
- [ ] UPOLS convolution with 128-sample blocks, 2.67ms latency at 48kHz
- [ ] MagLS decoding for Ambisonics path above ~2kHz spatial aliasing frequency
- [ ] ADM BWF export produces files that pass Dolby Atmos validation tools
- [ ] ADM XML contains correct `audioBlockFormat` with `rtime`, `duration`, `position` (azimuth/elevation/distance)
- [ ] Bed tracks use typeDefinition 0001 (DirectSpeakers) referencing AP_00010017
- [ ] Object tracks use typeDefinition 0003 (Objects) with custom definitions
- [ ] `chna` chunk: 40 bytes per entry per ITU-R BS.2076 spec
- [ ] Files >4GB use BW64 container with `ds64` chunk
- [ ] 3D panner UI: top-down view with puck size = height, elevation slider with ascending line
- [ ] Theater View shows all object positions as dots with green height plane
- [ ] Color coding: green = bed, orange = object, yellow = automation-off, grey = inactive
- [ ] Position parameters are automatable and appear in automation lanes
- [ ] Export dialog includes Atmos format with bed/object configuration preview
- [ ] `pnpm deps:validate` passes with zero violations after implementation
- [ ] Test ADM file imports successfully into Dolby Atmos Renderer (manual QA)

---

## Implementation notes

### Rust crate structure

```
crates/
  daw-dsp/
    src/
      atmos/
        vbap.rs          # Triangulation (Quickhull), gain computation (L⁻¹·p)
        hrtf.rs          # SOFA loading (sofar), barycentric interpolation
        binaural.rs      # Hybrid direct + Ambisonics renderer with MagLS
        adm_export.rs    # ADM BWF file writer (manual RIFF + quick-xml)
```

### Rust crate dependencies

- `rustfft` v6.4: Complex-to-complex FFT with SIMD auto-vectorization
- `realfft` v3.5: Real-valued FFT (halves computation)
- `sofar`: SOFA file reading via libmysofa, includes partitioned convolution renderer
- `quick-xml`: Streaming XML writer for ADM (no DOM)
- `nalgebra` (optional): For convex hull geometric primitives (runs once at setup)

### AudioWorklet processors needed

1. `VbapPannerWorklet`: Applies VBAP gains to input, outputs 12 channels (7.1.4)
2. `HrtfConvolverWorklet`: Stereo HRTF convolution for direct path (UPOLS)
3. `AmbisonicsEncoderWorklet`: Encodes sources to 3rd-order Ambisonics (16 channels)
4. `AmbisonicsDecoderWorklet`: Decodes HOA to binaural with MagLS (32 convolutions)

### Frontend module structure

```
src/modules/Atmos/
  models/
    AtmosTypes.ts          # AtmosMode, AtmosPosition, ObjectBudget
  stores/
    atmosStore.ts          # Object pool (118 slots), monitoring mode
  useCases/
    setTrackAtmosMode.ts   # Bed/object toggle with pool management
    setAtmosPosition.ts    # Update 3D position
    assignObjectId.ts      # Manual object ID assignment
    exportAdmBwf.ts        # Trigger ADM export
  repositories/
    atmosEngineBridge.ts   # Tauri commands for Rust engine
  presentations/
    components/
      AtmosPanner3D.tsx    # Hemisphere/Top View drag UI
      RearView.tsx         # XZ panning view
      TheaterView.tsx      # 3D cube with all object dots
      AdmAuthoringPanel.tsx # Centralized bed/object list
      ObjectBudgetBadge.tsx # Transport bar indicator
      AtmosExportDialog.tsx # ADM export options
```

### Key integration points

1. **Track model**: Add Atmos fields to `Track` type in `src/modules/Arrangement/models/Track.ts`
2. **Audio engine**: Replace `StereoPannerNode` with `VbapPannerWorklet` when Atmos mode active
3. **Export system**: Add Atmos handler to `ExportDialog.tsx` and `offlineRender.ts`
4. **Automation**: Extend automation lane system to include Atmos position parameters

### HRTF dataset bundling

- Include Bernschütz KU100 HRIR_L2702.sofa in app bundle (~50MB)
- Lazy-load on first Atmos track creation to reduce initial download
- Decompose to SH coefficients offline for Ambisonics decoder
- Cache in memory during engine operation

### ADM XML generation

- Use `quick-xml` streaming writer (not DOM) for memory efficiency
- Generate `audioBlockFormat` per automation segment (linear interpolation = 2 blocks)
- Validate against ITU-R BS.2076-3 schema
- Handle `rtime`/`duration` timestamps for spatial automation timeline

### Processing rate architecture

```
Control Rate (2–10 ms per block):
├── VBAP gain computation for each source
├── HRTF filter selection/interpolation
├── Ambisonics encoding coefficients
└── Parameter smoothing (5–10 ms time constant)

Audio Rate (per sample):
├── Gain interpolation and application for VBAP
└── Partitioned convolution for binaural rendering

Offline (export):
├── ADM XML serialization from panning automation
├── chna chunk construction from session track layout
└── Multi-channel interleaved PCM writing with custom RIFF chunks
```

---

## Test plan

### Manual testing

1. **VBAP accuracy**: Render test tone to individual speakers, verify correct physical speaker activation matches UI position
2. **VBAP triangulation**: Verify ~16–22 valid triplets produced for 7.1.4 layout
3. **MDAP spread**: Test 0° (point), 10–25° (natural width), 90°+ (ambient diffusion)
4. **Binaural perception**: Pan source around head in binaural mode, verify perceived direction matches UI
5. **Hybrid binaural**: Verify ≤16 sources use direct HRTF, remainder via Ambisonics
6. **Object budget**: Create 118 object tracks, verify structural enforcement at 119th (not warning dialog)
7. **ADM validation**: Export test project, run through Dolby Atmos Renderer, verify metadata integrity
8. **ADM XML**: Verify `audioBlockFormat` contains correct `rtime`, `duration`, `position` elements
9. **chna chunk**: Binary verify 40-byte structure per ITU-R BS.2076
10. **Automation**: Record 3D position automation, verify smooth spatial movement during playback
11. **Color coding**: Verify green=bed, orange=object, yellow=automation-off, grey=inactive
12. **Theater View**: Verify all object positions displayed as dots with green height plane

### Automated testing

1. **VBAP math unit tests**: Test gain computation **g̃ = L⁻¹ · p** for known speaker directions
2. **Power normalization**: Verify **gᵢ = g̃ᵢ / √(Σg̃²)** vs amplitude normalization
3. **Triangulation tests**: Verify convex hull (Quickhull) produces expected triplets for 7.1.4
4. **Cartesian conversion**: Test `x = cos(θ)cos(φ)`, `y = sin(θ)cos(φ)`, `z = sin(φ)`
5. **MDAP formula**: Verify **auxₖ = cos(α)·p + sin(α)·(cos(2πk/N)·u + sin(2πk/N)·v)**
6. **ADM chunk validation**: Binary verify `chna` 40-byte structure
7. **ADM XML schema**: Validate generated XML against ITU-R BS.2076-3
8. **Object pool tests**: Allocation, deallocation, reassignment logic with 118-slot limit
9. **BW64 conversion**: Verify `ds64` chunk added for files >4GB

---

## Open questions

- [ ] **[MINOR]** Which HRTF dataset to bundle: Bernschütz KU100 2702-point (better SH decomposition) or SADIE II (streaming compatible, used by YouTube 360)? Research also lists MIT KEMAR (710 positions), CIPIC (1,250), and ARI (220+ subjects) as optional alternates for future work — out of scope for v1 bundle.
- [ ] **[MINOR]** Should we support 9.1.6 layout as advanced option, or strictly 7.1.4?
- [ ] **[MINOR]** Theater View implementation: WebGL (better visuals) or Canvas 2D (simpler)?
- [ ] **[MINOR]** Rear View (XZ panning): Include in v1 or defer to later release?
- [ ] **[MINOR]** If offline HRTF tooling decomposes datasets into spherical harmonics, which order? Research: full-bandwidth reconstruction needs SH order ~30–35; practical systems use 15–20 with magnitude-only optimization above the spatial aliasing frequency.

---

## Tradeoffs and risks

| Risk                                            | Impact                               | Mitigation                                                    |
| ----------------------------------------------- | ------------------------------------ | ------------------------------------------------------------- |
| HRTF dataset size (50MB+) increases bundle size | Download/install friction            | Lazy-load dataset on first Atmos track creation               |
| VBAP/HOA CPU usage on lower-end machines        | Dropouts during complex mixes        | Quality slider: reduce Ambisonics order or MDAP spread        |
| ADM export complexity (manual RIFF)             | Potential format incompatibilities   | Extensive validation testing with Dolby tools                 |
| Object budget confusion (128 vs 118 vs 10)      | User error, unexpected limits        | Clear UI explaining bed = shared (10 ch), object = individual |
| Binaural vs speaker monitoring discrepancy      | Mix decisions don't translate        | A/B comparison feature, translation check utility             |
| ITD handling in HRTF interpolation              | Comb-filtering artifacts if wrong    | Implement extract/remove/re-apply workflow per research       |
| Bed limited to 7.1.2 not 7.1.4                  | User confusion about height channels | Document that 7.1.4 is monitoring target, 7.1.2 is bed format |
| `hrtf` crate (Fyrox) — known click artifacts with fast-moving sources | Audible transient glitches in prototypes | If evaluated, prefer `sofar`-based UPOLS path; `hrtf` crate is not a v1 dependency |
| `sofar` emitter count ("a couple hundred" per upstream) | QA ceiling unclear on low-end hardware | Use as informal sanity bound in perf tests; adaptive degradation already specified |

**What was considered and rejected:**

---

## Implementation Status

**What is implemented:**
- None. The 7.1.4 immersive mixing engine, `VbapPannerWorklet`, and ADM BWF export logic are not present in the codebase.

**What is not implemented:**
- All features described in the spec, including 3D panner UI, bed/object routing, and Dolby Atmos compatible metadata exports.

**What is done well:**
- N/A

**What needs refactoring:**
- N/A
