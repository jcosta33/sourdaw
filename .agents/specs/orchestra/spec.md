---
type: spec
id: SPEC-orchestra
title: Orchestra (Levain) — section and voice sampling engine
status: in-progress
owner: The Sourdaw team
sources:
  - self
---

# Orchestra (Levain) — section and voice sampling engine

## Intent

Orchestra (Levain) is a sample-playback and performance-intelligence engine: a
section + voice core that selects and plays recorded orchestral samples with
real-time-safe lookup, deterministic round-robin, pitch interpolation, and
bounded polyphony. This spec covers the core voice engine; articulation,
expression, legato, mic mixing, and the higher layers are separate specs that
build on it.

## Non-goals

- Articulation switching, expression mapping, legato, mic mixing, release
  triggers — each is its own spec (`SPEC-orchestra-articulation-system`,
  `-expression-dynamics`, `-legato-engine`, `-mic-mixing`, `-release-triggers`).
- Sample authoring (curation, recording, mastering of raw assets) — asset work,
  not code.
- The progressive-disclosure UI (`SPEC-orchestra-progressive-disclosure-ux`).

## Requirements

### AC-001 — Zone lookup is constant-time

When a note-on arrives, the engine must resolve its candidate sample zones
through a precomputed lookup keyed by `(note, velocity bucket, articulation,
mic)` without scanning the full zone list.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::zones::lookup_is_o1`

### AC-002 — Round-robin selection avoids consecutive repeats

When the same note is struck repeatedly at one dynamic, the engine must cycle
round-robin groups so that no group repeats on consecutive strikes when the RR
count is greater than one.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::voice::round_robin_no_repeat`

### AC-003 — Round-robin selection is reproducible

When the same note sequence is played twice with the same seed, the round-robin
group selection must be identical across both runs.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::voice::round_robin_deterministic`

### AC-004 — Pitch interpolation between recorded pitches

When a played note falls between recorded sample pitches, the engine must
resample with cubic Hermite interpolation by default rather than nearest-pitch
playback.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::resample::cubic_hermite`

### AC-005 — Voice stealing follows a fixed priority

When polyphony is exceeded, the engine must steal voices in the order
release-tail-below-threshold, then lowest-energy, then oldest, producing
identical allocation across runs of the same note sequence.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::voice::steal_priority`

### AC-006 — The audio path is allocation-, lock-, and syscall-free

When processing a block, the engine must not allocate, take a lock, or perform
I/O on the audio thread.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::voice::rt_safe_no_alloc`

### AC-007 — Parameter changes arrive lock-free with no string resolution

When the UI changes a parameter, the engine must receive it as a `ParamId`
through an SPSC queue.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::params::spsc_param_by_id`

### AC-008 — Parameter values are smoothed

When a smoothed parameter's target changes, the engine must approach it with a
one-pole smoother rather than stepping the value within a block.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::params::one_pole_smoothing`

### AC-009 — Block size is read at runtime

When `process` is called, the engine must read the output buffer length per call
rather than assuming a fixed render quantum.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::voice::variable_block_size`

### AC-010 — Native and WASM backends produce equivalent output

When the same patch and MIDI performance run on the native and WASM backends at
matched quality settings, the rendered output must match within a fixed
tolerance.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::voice::cross_backend_parity`

### AC-011 — No parameter-name resolution on the audio thread

When processing a parameter change, the engine must never resolve a parameter
name to an id on the audio thread.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::params::spsc_param_by_id`

## Open questions

- [ ] (non-blocking) Velocity bucket count for the lookup key — fixed (e.g. 8)
  or per-instrument from its dynamic-layer count?
- [ ] (non-blocking) (restored detail) Tail virtualization — in this core spec
  or folded into voice stealing? The source prescribed it as a stated behavior,
  not just an option: **when sustain pedal or long releases are active, freeze the
  release tail into an auxiliary reverb send (or a low-rate resynthesis tail) and
  free the voice earlier** — called a "practical necessity under strict quantum
  budgets" (small WASM voice pools of 32–64; native 256–1024). The open question
  is only its home/layering, not whether the behavior is wanted.

- [ ] (non-blocking) (restored detail) Orchestral-realism reference corpus — the
  source carried an 11-section "Achieving Orchestral Realism" appendix (~700
  lines) of reusable design substance for the eventual physical-modeling /
  ensemble augmentation layers. It has no current home in any sibling spec
  (orchestra-physical / spectral-modeling both dropped it as "design rationale").
  Capturing the load-bearing specifics here so they are not lost; where this
  material lands long-term (a research note vs. those specs) is the open part.

  - Bowed-string friction (Smith & Woodhouse): measured violin-rosin
    coefficients `μ_s ≈ 0.8` (static), `μ_d ≈ 0.3` (dynamic at high velocity),
    characteristic velocity `v₀ ≈ 0.1 m/s`; friction force
    `f = μ(v_rel) × F_bow × sign(v_rel)`; Friedlander graphical construction with
    stick→slip / slip→stick hysteresis. Thermal-friction upgrade keys friction
    off rosin contact temperature (glass transition ≈ 49 °C violin, ≈ 25 °C bass).
    Refs: Smith & Woodhouse (2000), "The tribology of rosin," _JMPS_ 48(8)
    1633–1681; Woodhouse (2003), _Acta Acustica_ 89, 355–368
    (https://euphonics.org/wp-content/uploads/2022/03/Thermal_bowing.pdf);
    elasto-plastic model van Walstijn et al. (2024), _Frontiers in Signal Proc._
    (https://www.frontiersin.org/journals/signal-processing/articles/10.3389/frsip.2025.1525044/full);
    two-polarisation Desvages & Bilbao (2016), _Applied Sciences_ 6(5) 135
    (https://www.mdpi.com/2076-3417/6/5/135).

  - Violin body modes (Princeton NBody LPC, Smith/Cook): **524, 1156, 1870,
    2302, 2836, 3758 Hz** (Hardanger fiddle: 580, 987, 1894, 2234, 2584,
    3465 Hz). Critical mode map: C1 ≈185, A0 260–290, C2 ≈405, A1 430–490,
    C3 490–590, C4 ≈700 Hz, "bridge hill" 2000–3000 Hz; > ~1.5 kHz the modes go
    statistical (use a 2D waveguide mesh, Karjalainen & Smith 2000,
    https://quod.lib.umich.edu/i/icmc/bbp2372.2000.171). Family scaling:
    `H_cello(f) ≈ H_violin(f × L_violin / L_cello)`. NBody DB:
    https://www.cs.princeton.edu/~prc/ism98fin.pdf.

  - Per-band string damping (NESS), measured T60 for a violin D-string:
    294 Hz → 0.8–1.2 s; 600 → 0.5–0.8; 1200 → 0.3–0.5; 2400 → 0.15–0.3;
    5000 → 0.05–0.15; 10000 → 0.02–0.05 s. Implement as higher-order per-band
    loss filters replacing the simple one-pole. Ref: Desvages, Bilbao, Ducceschi
    (2016), _Proc. ICA_, Buenos Aires.

  - Reed/lip excitation: single-reed mass-spring-damper
    `m_r·d²x/dt² + r·dx/dt + k·(x − x₀) = ΔP·S_eff` with Bernoulli flow
    `U = w·x·sign(ΔP)·√(2|ΔP|/ρ_air)` for `x > 0` (reed beats → `U = 0`);
    digital reed reflection as a memoryless nonlinear table indexed by
    `P_mouth − P_bore` (Backus 1963 flow exponent ≈ 3, not 0.5). Refs: Scavone
    (1997) Ph.D. CCRMA; Smith PAPS "Single-Reed Instruments"; port-Hamiltonian
    stable tonehole model Darabundit & Scavone (2025), _Frontiers in Signal Proc._

  - Ensemble realism (vs. one voice ×N): pitch scatter SD ≈ **5 cents**
    preferred, ≈14 cents max tolerable (Ternström, "Preferred scatter in choir
    singing," _JASA_ 1993); timing scatter ±5–20 ms; decorrelated per-player
    vibrato `rate ~ N(5.5, 0.8) Hz`, `depth ~ N(25, 8) cents`,
    `phase ~ U(0, 2π)`; gain `~ N(1.0, 0.05)`; pan = section ± N(0, 0.05);
    air absorption −1 dB/10 m above 5 kHz. Ref: Kahlin & Ternström (1999),
    "The chorus effect revisited," _Proc. ICMC_.

  - Commuted synthesis (Smith 1993): exploit body linearity to commute the body
    filter onto the excitation — `output = string_model(body_filter(bow_input))`
    instead of `body_filter(bridge_force(string_model(bow_input)))` — so the body
    runs once on the excitation, not per partial. Ref: Jaffe (1995),
    "Performance Expression in Commuted Waveguide Synthesis of Bowed Strings."

  - Reference codebases (with licenses, vet before reuse): NESS, Edinburgh —
    **MIT** (https://github.com/Edinburgh-Acoustics-and-Audio-Group/ness);
    STK, Cook/Scavone — **BSD-style**
    (https://github.com/thestk/stk); Faust `physmodels.lib`, GRAME — **LGPL**
    (https://github.com/grame-cncm/faustlibraries); twang, Rust — **Apache-2.0 /
    MIT** (https://github.com/NibbleRealm/twang); plus MoReeSC (Silva et al. 2014,
    research Python), PFFDTD (https://github.com/bsxfun/pffdtd, research). Primary
    cross-cutting reference throughout: Julius O. Smith III, _Physical Audio
    Signal Processing_ and _Spectral Audio Signal Processing_ (ccrma.stanford.edu)
    — ~23 cited papers in total across the original appendix.

## Affected areas

- `crates/daw-dsp/src/levain/zones/` (zone model, O(1) LUT, arena)
- `crates/daw-dsp/src/levain/voice/` (allocator, stealing, RT-safe process loop)
- `crates/daw-dsp/src/levain/resample/` (linear / cubic Hermite / windowed-sinc)
- `crates/daw-dsp/src/levain/params/` (registry, SPSC updates, smoothing)
- `crates/daw-core/` (newtypes: `VoiceId`, `ZoneId`, `ArticulationId`, `MicId`)

## Dropped from sources

- Disk streaming vs WASM preload, the LOD/quality governor, and WASM voice
  budgets — moved to `SPEC-orchestra-lod-governor`.
- Sample format / loading (`rubato` resampling on load, manifest metadata) —
  asset-load concern; tracked under the LOD/streaming spec, not the hot path.
- The reference-library survey (Spitfire, VSL, OT, CSS, SWAM) — design rationale
  that informed the engine; it shaped requirements but is not itself a
  requirement.
