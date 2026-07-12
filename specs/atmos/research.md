---
type: research
id: RESEARCH-atmos
title: Immersive audio — beds, objects, VBAP, binaural, and ADM BWF
status: open
owner: The Sourdaw team
sources:
  - ITU-R BS.2076-3 (ADM), ITU-R BS.2051 (loudspeaker layouts)
  - Pulkki VBAP (1997) and MDAP spread papers; Dolby Atmos Renderer docs
  - libspatialaudio, EBU ADM tooling, SADIE II / Bernschütz KU100 HRTF datasets
---

# Research: Immersive audio — beds, objects, VBAP, binaural, and ADM BWF

## Question

What is the minimum correct technical foundation — channel model, panning math,
binaural rendering, and file format — to build a 7.1.4-monitored, ADM-BWF-
exporting immersive mixing engine in a Rust DSP crate?

## Findings

### R-001 — DAWs split a fixed bed from a capped object pool

- **Claim:** Atmos uses a 7.1.2 bed (10 channels) plus up to 118 dynamic
  objects, for a hard 128-track ceiling; beds are static channel feeds, objects
  carry positional metadata.
- **Evidence:** Dolby Atmos Master spec; Pro Tools / Logic / Nuendo all model a
  10-channel bed + object pool against the same 128 ceiling.
- **Confidence:** high
- **Bears on:** the track model (AC-001) and structural budget (AC-002).

### R-002 — VBAP is the standard amplitude-panning algorithm

- **Claim:** VBAP places a source using the nearest speaker triplet with gains
  `g̃ = L⁻¹·p`, power-normalized; spread is added via MDAP auxiliary sources.
- **Evidence:** Pulkki 1997; libspatialaudio and most renderers implement this
  exact formulation. Triangulation of a 7.1.4 hull gives ~16–22 valid triplets.
- **Confidence:** high
- **Bears on:** gain math (AC-003), triangulation (AC-004), spread (AC-005).

### R-003 — The LFE is panned separately from VBAP

- **Claim:** The LFE channel is a discrete send, not part of the triplet solve
  or power normalization.
- **Evidence:** BS.2051 treats LFE as a non-positional channel; renderers route
  it as a fixed gain.
- **Confidence:** high
- **Bears on:** LFE exclusion (AC-006).

### R-004 — A hybrid HRTF/Ambisonics binaural path balances accuracy and cost

- **Claim:** Convolving every object with HRTFs is too costly; routing a few
  priority sources through direct HRTF and the rest through a 3rd-order
  Ambisonics bus with MagLS decoding keeps localization while bounding CPU.
- **Evidence:** Ambisonics binaural decoding is a fixed cost independent of
  source count; MagLS reduces high-frequency coloration versus naive SAD.
- **Confidence:** medium
- **Bears on:** hybrid binaural (AC-007).

### R-005 — UPOLS convolution adds exactly one block of latency

- **Claim:** Uniformly partitioned overlap-save with 128-sample blocks adds 128
  samples (2.67 ms at 48 kHz), acceptable for monitoring.
- **Evidence:** Standard partitioned-convolution latency analysis; matches the
  engine's existing buffer size.
- **Confidence:** high
- **Bears on:** convolution latency (AC-008).

### R-006 — ADM BWF is a strict XML-in-RIFF format with a binary chna chunk

- **Claim:** Export must emit an `axml` chunk (ITU-R BS.2076-3 XML with
  timestamped `audioBlockFormat` position blocks) and a `chna` chunk of exactly
  40-byte entries; files over 4 GB require the BW64 `ds64` 64-bit container.
- **Evidence:** BS.2076; Dolby Atmos Master ADM Profile constraints; EBU BW64
  spec. The Dolby Atmos Renderer rejects non-conformant masters.
- **Confidence:** high
- **Bears on:** ADM XML (AC-009), chna (AC-010), BW64 (AC-011), validation (AC-014).

## Open questions

- [ ] Q-001 — Bundled HRTF dataset: Bernschütz KU100 (2702 points, better SH
  decomposition) vs SADIE II (streaming-friendly, smaller)?
- [ ] Q-002 — Theater/position renderer technology: WebGL vs Canvas 2D for the
  3D panner field?
- [ ] Q-003 — Do we need a dynamic object-priority heuristic for the ≤16 direct
  HRTF slots, or is a static user-assigned priority sufficient for v1?

## Recommendation

Build the DSP in `daw-dsp` as four units — VBAP panner (R-002/R-003), hybrid
binaural renderer (R-004/R-005), ADM/BW64 writer (R-006), and the bed/object
allocator (R-001) — and treat the 128-track ceiling as a structural invariant
(AC-002) rather than a runtime check. Resolve Q-001 before bundling an HRTF
asset; Q-002–Q-003 are non-blocking polish.

## Restored detail from `research/factory/active/atmos.md`

The condensed findings above dropped several substantive sections from the
original factory research note. They are restored here verbatim (lightly trimmed
to the relevant passages) so the spec's claim that this material "lives in
research.md" is true. Migration-recovery provenance: original at
`bb84b0e:research/factory/active/atmos.md`.

### R-007 — HRTF interpolation methods (restores lost item [1])

> Three interpolation methods exist in order of increasing sophistication.
> **Nearest-neighbor with crossfade** simply selects the closest measured
> position and crossfades when the selection changes — simple but produces
> audible jumps at measurement boundaries. **Barycentric interpolation**
> pre-triangulates the measurement grid (Delaunay on the sphere), finds the
> enclosing triangle for any desired direction, computes barycentric weights
> (w₁, w₂, w₃), and blends three HRIRs: H(θ,φ) = w₁·H₁ + w₂·H₂ + w₃·H₃.
> Critically, the interaural time difference (ITD) must be extracted, removed,
> and re-applied after interpolation to avoid comb-filtering artifacts.
> **Spherical harmonics interpolation** decomposes the entire HRTF dataset into
> SH coefficients offline, enabling continuous reconstruction at any direction
> via H(f, Ω) = Σ hₙₘ(f)·Yₙₘ(Ω). Full-bandwidth reconstruction requires SH
> order ~30–35 (for the Bernschütz dataset this is feasible), but practical
> implementations use order 15–20 with magnitude-only optimization above the
> spatial aliasing frequency.
>
> Barycentric interpolation offers the best quality-to-cost ratio for
> per-object rendering. Reserve SH interpolation for the Ambisonics binaural
> decoding path described below.

- **Confidence:** medium (per the original; barycentric is the recommended
  per-object method, SH the Ambisonics-path method).
- **Bears on:** the binaural path (AC-007) and the per-object render mode (AC-018).

### R-008 — Imaginary nadir/zenith speakers in triangulation (restores lost item [2])

> A standard **7.1.4 layout** (ITU-R BS.2051 System C) places 7 ear-level
> speakers at 0°, ±30°, ±90°, ±135° azimuth (all 0° elevation) and 4 height
> speakers at ±45° azimuth, ±135° azimuth (all at 30–45° elevation). The LFE
> has no directional position. This produces approximately **16–22 valid
> triplets** after convex hull triangulation. Two practical issues arise: below
> the horizontal plane there are no speakers, so an imaginary speaker at nadir
> should be inserted (gains assigned to it are discarded or distributed to
> nearest horizontal speakers with a 1/√N factor); similarly, an imaginary
> zenith speaker helps avoid asymmetric triangulation of the four height
> speakers.

- **Confidence:** high.
- **Bears on:** triangulation (AC-004); the nadir/zenith handling is a
  correctness requirement for below-horizontal and apex sources.

### R-009 — Per-sample gain interpolation to prevent zipper noise (restores lost item [3])

> For smooth panning, update gains at control rate (per audio block of 64–512
> samples) and **linearly interpolate per-sample** between old and new gains to
> prevent zipper noise. Exponential smoothing with a 5–10 ms time constant works
> equally well.

- **Confidence:** high.
- **Bears on:** VBAP gain application at audio rate (AC-003/AC-006) and the new
  smoothing requirement (AC-016).

### R-010 — ADM typeDefinition codes and the dbmd chunk (restores lost item [4])

> Two `typeDefinition` values matter for Atmos: **0001 (DirectSpeakers)** for
> channel-based beds using predefined speaker labels from ITU-R BS.2094 common
> definitions, and **0003 (Objects)** for position-automated elements with
> custom metadata. Beds reference common definition IDs (e.g., `AP_00010017`
> for the standard 7.1.2 pack), eliminating the need to define speaker positions
> in the XML. Objects require custom `audioPackFormat`, `audioChannelFormat`,
> `audioStreamFormat`, and `audioTrackFormat` definitions.
>
> [...] An optional **`dbmd` chunk** carries proprietary Dolby metadata
> (renderer version, downmix settings, per-object binaural distance mode).

- **Confidence:** high.
- **Bears on:** ADM XML (AC-009), bed/object type tagging (AC-019), and the
  per-object binaural distance mode (AC-018) which is carried in `dbmd`.

### R-011 — Monitoring-format switching as a user control (restores lost item [5])

> All three DAWs share common patterns worth adopting. Monitoring format
> switching uses a single dropdown (7.1.4, 5.1, stereo, binaural). Simultaneous
> speaker and headphone monitoring is supported when the interface has
> sufficient outputs.

- **Confidence:** high (surveyed across Pro Tools, Logic Pro, Nuendo).
- **Bears on:** the monitoring-format selector (AC-017) and simultaneous
  speaker+headphone monitoring (AC-020).

### R-012 — Spread, dataset, and sizing specifics (restores lost item [6])

> Multiple Direction Amplitude Panning (MDAP, Pulkki 1999) [...] A spread of 0°
> gives standard VBAP; **10–25° provides natural point-source width**; 90°+
> creates ambient diffusion.
>
> [HRTF datasets] The **MIT KEMAR** dataset remains a classic baseline with 710
> positions and 512-tap HRIRs at 44.1 kHz. **CIPIC** offers 1,250 directions
> across 45 subjects (useful for personalization research), and the **ARI
> database** provides over 220 human subjects. [...] The **Bernschütz KU100**
> dataset (TH Köln) offers the highest spatial resolution at **16,020
> measurement positions** [...] **SADIE II** (University of York) provides 8,802
> positions per dummy head at 44.1/48/96 kHz [...] start with **Bernschütz KU100
> HRIR_L2702** (2,702-point Lebedev grid).
>
> [Sizing] a 128-channel, 5-minute session at 48 kHz/24-bit produces
> approximately 5.3 GB.

- **Confidence:** high (dataset and sizing figures are cited specifics from the
  original survey/format sections).
- **Bears on:** spread control feedback (AC-016/AC-021), the HRTF-dataset open
  question (Q-001), and BW64 sizing (AC-011).

### R-013 — Renderer Window 3D box and Theater View (restores lost item [7])

> The 3D panner offers two modes: a top-down rectangular field with a separate
> Height knob and ascending line indicator, and a **Theater View** showing a
> rotatable 3D cube with a green height plane. Pro Tools also provides a
> dedicated Renderer Window with a 3D box visualization showing all object
> positions as dots.

- **Confidence:** high (surveyed UX pattern from Pro Tools / Nuendo).
- **Bears on:** the session-wide object-position monitor view (AC-021) which the
  condensed AC-013 omitted in favor of the per-track panner only.
