---
type: spec
id: SPEC-atmos
title: Dolby Atmos 7.1.4 immersive mixing engine
status: draft
owner: The Sourdaw team
sources:
  - research.md
  - research-special-effects.md
---

# Dolby Atmos 7.1.4 immersive mixing engine

## Intent

Add object-based immersive mixing: per-track bed/object mode, 3D VBAP speaker
panning for a 7.1.4 layout, hybrid HRTF/Ambisonics binaural monitoring across a
selectable control-room monitoring format (7.1.4, 5.1.4, 5.1, stereo, binaural),
and ADM BWF export compliant with the Dolby Atmos Master ADM Profile v1.1.

## Non-goals

- External Dolby Atmos Renderer integration — internal engine only.
- Personalized HRTF measurement; a single bundled dataset ships.
- HOA bed encoding, 9.1.6 layouts, networked rendering, and runtime object-limit
  changes — the budget is a fixed 128.

## Requirements

### AC-001 — Tracks carry an Atmos mode and 3D position

Each track must expose `atmosMode: 'bed' | 'object' | 'off'` (default `'off'`)
plus azimuth, elevation, and distance fields.

Verify with: `pnpm test:run -- atmosTrackModel`

### AC-002 — The object budget is enforced structurally at 128

A 7.1.2 bed must consume 10 fixed slots and object IDs must allocate from the
remaining 118.

Verify with: `pnpm test:run -- atmosObjectPool`

### AC-003 — VBAP gains use the inverse-matrix equation with power normalization

The panner must compute gains as `g̃ = L⁻¹·p` and normalize by
`gᵢ = g̃ᵢ / √(Σg̃²)`.

Verify with: `pnpm cargo:test -- -p daw-dsp atmos::vbap_gain`

### AC-004 — Speaker triangulation yields the expected triplet count

Convex-hull triangulation of the 7.1.4 layout must produce ~16–22 valid
triplets after outward-normal validation and aperture culling.

Verify with: `pnpm cargo:test -- -p daw-dsp atmos::vbap_triangulation`

### AC-005 — MDAP spread generates eight auxiliary sources

Source-width spread must generate 8 auxiliary virtual sources via
`auxₖ = cos(α)·p + sin(α)·(cos(2πk/N)·u + sin(2πk/N)·v)`, summed and
power-normalized.

Verify with: `pnpm cargo:test -- -p daw-dsp atmos::mdap_spread`

### AC-006 — The LFE send is excluded from VBAP

The per-source LFE send must be a separate gain parameter excluded from VBAP
triplet selection and power normalization.

Verify with: `pnpm cargo:test -- -p daw-dsp atmos::lfe_excluded`

### AC-007 — Binaural monitoring uses the hybrid HRTF/Ambisonics path

Binaural rendering must route ≤16 priority sources through direct HRTF
convolution and the remainder through a 3rd-order Ambisonics bus with MagLS
decoding.

Verify with: `pnpm cargo:test -- -p daw-dsp atmos::hybrid_binaural`

### AC-008 — Binaural convolution adds one buffer of latency

UPOLS convolution with 128-sample blocks must add exactly 128 samples
(2.67 ms at 48 kHz) of latency.

Verify with: `pnpm cargo:test -- -p daw-dsp atmos::upols_latency`

### AC-009 — ADM XML carries timestamped position blocks

Export must emit `audioBlockFormat` elements with `rtime`, `duration`, and
azimuth/elevation/distance `position` elements per automation segment, conformant
to ITU-R BS.2076-3.

Verify with: `pnpm cargo:test -- -p daw-dsp atmos::adm_xml`

### AC-010 — The chna chunk uses the 40-byte entry layout

Each `chna` entry must be exactly 40 bytes per ITU-R BS.2076 (1-based track
index, UID, track-format ref, pack-format ref, padding).

Verify with: `pnpm cargo:test -- -p daw-dsp atmos::chna_binary`

### AC-011 — Files over 4 GB use the BW64 container

When the rendered file exceeds 4 GB, export must write a BW64 container with a
`ds64` chunk rather than a 32-bit RIFF.

Verify with: `pnpm cargo:test -- -p daw-dsp atmos::bw64_ds64`

### AC-012 — 3D position parameters are automatable

Azimuth, elevation, and distance must record and play back through the existing
automation system and appear in automation lanes.

Verify with: `pnpm test:run -- atmosPositionAutomation`

### AC-013 — A 3D panner UI exposes position with mode color coding

The panner must render a top-down field with height as puck size, an elevation
control, and color coding (green = bed, orange = object, yellow = automation-off,
grey = inactive).

Verify with: `manual` — toggle a track bed↔object, drag the puck, confirm position and colors

### AC-014 — Exported masters pass Dolby validation

A test ADM BWF export must import successfully into the Dolby Atmos Renderer
with intact spatial metadata.

Verify with: `manual` — export a test project, import into the Dolby Atmos Renderer, confirm metadata integrity

### AC-015 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-016 — The 3D panner exposes size, spread, numeric coordinates, and an LFE fader

Beyond the top-down field and elevation control of AC-013, the panner must
expose a source Size control (0.0–1.0), a Spread/Size slider (0°–90°) with
visual hemisphere ring-radius feedback, numeric input fields for azimuth /
elevation / distance (and width / height / depth), and an LFE-send fader
separate from spatial panning.

Verify with: `manual` — open the panner, adjust Size, drag the Spread slider and confirm the ring grows, type a coordinate and confirm the puck moves, set the LFE fader

### AC-017 — A control-room monitoring-format selector switches the render target

The control room must expose a single format-selector dropdown offering 7.1.4,
5.1.4, 5.1, stereo, and binaural.

Verify with: `pnpm test:run -- atmosMonitoringFormat`

### AC-018 — Each object carries a near/far binaural render mode

The object inspector must expose a per-object binaural render mode (near/far).

Verify with: `pnpm cargo:test -- -p daw-dsp atmos::dbmd_binaural_mode`

### AC-019 — The transport bar shows live object-budget usage with color status

The transport bar must display object-budget usage as "X/128 objects" (or "X of
128 objects used") with a color-coded status: green below 80%, yellow at
80–100%, red when full.

Verify with: `pnpm test:run -- atmosObjectBudgetDisplay`

### AC-020 — Speaker and headphone monitoring run simultaneously when outputs allow

When the audio interface has sufficient output channels, the engine must drive
the speaker (VBAP) and headphone (binaural HRTF) mixes simultaneously to
separate output sets rather than forcing an exclusive choice.

Verify with: `pnpm test:run -- atmosSimultaneousMonitoring`

### AC-021 — A session-wide object-position view lists and shows every bed and object

The UI must provide a Theater View — a rotatable 3D cube showing every object
position as a dot with a green height plane — and an ADM Authoring panel
listing every bed and object with its IDs, source tracks, and binaural render
mode.

Verify with: `manual` — open the Theater View with several objects placed, confirm each appears as a dot and the authoring panel lists them with IDs and render mode

### AC-022 — Panner shape and metadata status encode mode at a glance

The panner shape must follow the bed/object convention (circular = bed, square =
object), alongside the AC-013 cursor colors.

Verify with: `manual` — toggle a track bed↔object and confirm the shape switches; arm/disarm renderer send and confirm the arrow turns green↔grey

### AC-023 — Bass management stays downstream of the panner, never inside VBAP

Crossover-based low-frequency redirection (bass management) must not be part of
VBAP gain computation or normalization; it must live in the monitoring chain
downstream of the panner.

Verify with: `pnpm cargo:test -- -p daw-dsp atmos::bass_management_downstream`

### AC-024 — The binaural path must not depend on the Fyrox `hrtf` crate

The v1 binaural renderer must build on the `sofar`-based UPOLS path and must not
take the Fyrox `hrtf` crate as a dependency (known click artifacts with
fast-moving sources).

Verify with: `! cargo tree -p daw-dsp | grep -E '^\S* hrtf v'` — confirm the `hrtf` crate is absent

### AC-025 — A 119th object is prevented by withholding the routing path

The DAW must prevent a 119th object by not offering the routing path rather than
showing a warning dialog.

Verify with: `pnpm test:run -- atmosObjectPool`

### AC-026 — Selecting a monitoring format reconfigures the render target

Selecting a format from the control-room dropdown must reconfigure the render
target accordingly.

Verify with: `pnpm test:run -- atmosMonitoringFormat`

### AC-027 — The chosen binaural render mode is exported to ADM `dbmd` metadata

The chosen per-object binaural render mode must be carried through to the ADM
`dbmd` per-object binaural distance metadata on export.

Verify with: `pnpm cargo:test -- -p daw-dsp atmos::dbmd_binaural_mode`

### AC-028 — An object metadata status indicator encodes renderer-send state

An object metadata status indicator must show a green arrow when actively sending
to the renderer and grey when inactive.

Verify with: `manual` — toggle a track bed↔object and confirm the shape switches; arm/disarm renderer send and confirm the arrow turns green↔grey

### AC-029 — Users work within the 128-object budget by submixing to shared object buses

The DAW must let users submix multiple sources to a shared object bus so that
several sources share a single object slot, giving an explicit workflow for
staying within the fixed 128-object budget (10 bed + 118 object) rather than
only enforcing the ceiling. This is the stated mitigation for object-budget
exhaustion: instead of consuming one object ID per source, grouped sources route
through one bus that occupies one object ID. (Restores the original
User-visible-behavior / R7.5 / Tradeoffs-table control, dropped in migration;
complements the structural ceiling of AC-002/AC-025.)

Verify with: `pnpm test:run -- atmosObjectBusSubmix` — route multiple sources to one shared object bus and confirm they consume a single object slot

### AC-030 — Direct-HRTF slot priority is determined by an explicit order: user feature flag, then solo, then track order

Priority for the ≤16 direct-HRTF slots (AC-007) must be determined by an explicit
ordering: first an explicit per-track user "feature" flag (intended for the lead
vocal / featured instrument), then soloed tracks, then track order as the
tiebreaker (top = highest priority). Artist-declared priority must take precedence
over pure track order; track order is only the final tiebreaker. (Restores
original R4.6 as a resolved requirement; supersedes research.md Q-003, which had
demoted this resolved mechanism back to an open question. The user-facing control
is the per-track feature flag.)

Verify with: `pnpm cargo:test -- -p daw-dsp atmos::hrtf_priority_order` — assert a flagged track outranks an unflagged solo, a solo outranks an unflagged non-solo, and ties break by track order

### AC-031 — Priority routing is not a bed-vs-object split

Direct-HRTF priority selection (AC-007, AC-030) must be driven by the per-track
priority flag and must not be a "bed vs object" split: a bed track flagged
high-priority must still route through direct HRTF convolution, and an object
left unflagged must fall into the 3rd-order Ambisonics sum. (Restores the original
R4.5 disambiguation, dropped in migration; AC-007 alone leaves room for the exact
misreading this clarification was written to prevent.)

Verify with: `pnpm cargo:test -- -p daw-dsp atmos::hrtf_priority_not_bed_split` — assert a flagged bed track routes through direct HRTF and an unflagged object routes through the Ambisonics sum

### AC-032 — Panner handles are color-coded by channel: blue for mono, yellow/red for stereo L/R

The 3D panner must color-code its position handles by source channel layout
following the Nuendo convention: blue for a mono handle, and yellow / red for the
stereo Left / Right handles. This is distinct from the bed/object/automation/
inactive cursor color coding of AC-013 (green / orange / yellow / grey), which
encodes mode rather than channel. (Restores the original User-visible-behavior /
R6.8 handle color encoding, dropped in migration.)

Verify with: `manual` — open the panner on a mono track and confirm the handle is blue; switch to a stereo track and confirm separate yellow (L) and red (R) handles

### AC-033 — The distance control covers the 0.5–2.0 normalized near-field range

The object distance field (AC-001) must accept a normalized near-field distance
in the range 0.5–2.0, and the panner's distance control must expose that range as
a near-field distance adjustment. Azimuth must span -180° to +180° and elevation
-90° to +90° (standard ranges); the 0.5–2.0 distance bound is the non-obvious
recovered detail. (Restores the original R2.1 / R6.x distance range and near-field
semantics, dropped from AC-001/AC-012 in migration.)

Verify with: `pnpm test:run -- atmosDistanceRange` — assert the distance field clamps to 0.5–2.0 and rejects values outside that near-field range

### AC-034 — ADM BWF export constructs the RIFF container manually with word-aligned chunks

ADM BWF export must build the RIFF container manually via `std::io::Write` + `Seek`
rather than relying on a standard WAV writer. The crate-ecosystem finding behind
this constraint: the `hound` crate handles standard WAV but cannot write the custom
RIFF chunks an ADM BWF needs (`axml`, `chna`, `bext`). The exporter must therefore
write each chunk itself — RIFF header, `fmt` (WAVE_FORMAT_EXTENSIBLE), `bext`,
`chna`, `axml` (UTF-8 XML bytes), `data` — and must apply RIFF word-alignment
padding so any odd-length chunk gets a trailing zero byte. (Restores the original
crate-ecosystem / Rust-implementation finding dropped in migration; complements the
byte-level chunk requirements of AC-009/AC-010/AC-011.)

Verify with: `pnpm cargo:test -- -p daw-dsp atmos::adm_riff_word_alignment` — write an odd-length custom chunk and assert a trailing padding byte is emitted so the next chunk starts word-aligned

## Open questions

- [ ] (restored detail) Recommended-crate provenance behind the `sofar` + `realfft`
  + `quick-xml` stack (versions and maturity signals the research recommendation
  cited; informational, not a v1 dependency-pin requirement): FFT/convolution —
  `rustfft` v6.4 (15.5M downloads, MIT/Apache-2.0, pure-Rust with SIMD
  auto-vectorization) wrapped by `realfft` v3.5 (8.8M downloads) for real-valued
  transforms; WAV writing — `hound` v3.5 (7.5M downloads), used as the baseline
  that the AC-034 manual-RIFF path works around; binaural — `sofar` (libmysofa
  bindings) as the recommended path, with `hrtf` v0.8.1 named as the version of
  the Fyrox crate that AC-024 forbids; convex-hull triangulation for VBAP
  layout setup (AC-004) — recommendation is to implement 3×3 matrix inversion
  directly via Cramer's rule and port Quickhull for the hull, pulling `nalgebra`
  only for geometric primitives, since the computation runs once at layout time
  and is not performance-critical. Open: confirm these versions still resolve and
  pin them at implementation time, or record the actually-resolved versions then.
- [ ] (non-blocking) Which HRTF dataset to bundle: Bernschütz KU100 2702-point
  (better SH decomposition) or SADIE II (streaming-compatible)?
- [ ] (non-blocking) Theater View renderer: WebGL or Canvas 2D?
- [ ] (non-blocking) Include the Rear View (XZ) panner in v1 or defer?
- [ ] (non-blocking) (deferred-gap from intake/future-spec.md, item D
  "Object-based and format-flexible mixing") Generalize the render-target
  switcher beyond the fixed Atmos pipeline into a format-flexible mixing
  architecture where the user authors *one* mix graph that targets stereo,
  headphones binaural, 5.1 / 7.1.2 bed, bed + objects, ADM export, and
  future renderer targets without rebuilding the session. The current spec's
  monitoring-format selector (AC-017/AC-026) and bed/object track modes
  (AC-001) are the Atmos-specific instance; the generalization adds: (a) a
  broader **Render Target** switcher whose targets are renderer-defined, not
  hardcoded to one ecosystem; (b) richer track declarations beyond
  bed/object/off — *channel track*, *bed member*, *object source*, *scene
  object*, and *listener-adaptive source*; (c) per-object metadata not yet in
  v1 — *divergence*, *motion* (automated trajectories), *priority*, and
  explicit *render fallback behavior* per object (the current spec has
  position, size, spread, and near/far binaural mode only); (d) spatial
  editing surfaces beyond the top-down field / Theater View — a **2D room
  view** and a **3D object inspector** alongside the existing lane view; (e) an
  internal mix graph that **separates source semantics from the renderer
  target**, carried by a `SpatialSourceDescriptor` (fields: source type, object
  metadata, bed membership, binaural preferences, downmix priorities) and a
  track signal path that streams **metadata alongside audio**; (f) pluggable
  export adapters — stereo render, binaural render, ADM metadata package, and a
  generic *renderer handoff package* — with the capabilities graph declaring
  which runtime/device can preview which target. Acceptance targets implied by
  the intake: one session switches stereo↔object-based preview without
  rebuilding routing; **downmix preview highlights conflicts or likely masking
  changes** (no downmix-conflict preview exists in v1); ADM-style metadata
  serializes from the internal graph. Treated as a forward architecture gap
  rather than v1 requirements because it decouples the engine from the fixed
  128-object / 7.1.4 Atmos pipeline this spec scopes; non-blocking for the
  Atmos v1 deliverable.

## Affected areas

- `src/modules/Atmos/` (models, stores, use cases, panner UI, export dialog)
- `src/modules/Arrangement/models/Track.ts` (Atmos fields)
- `crates/daw-dsp/src/atmos/` (`vbap.rs`, `hrtf.rs`, `binaural.rs`, `adm_export.rs`)

## Dropped from sources

- 9.1.6 and other layouts beyond 7.1.4 — out of scope; the bed maxes at 7.1.2
  per the Atmos ecosystem and 7.1.4 is a monitoring/render target only.
- Quality slider for adaptive Ambisonics order / MDAP spread — a degradation
  follow-up, not a v1 requirement.
- The Yeast/Knead sound-design tooling in `research-special-effects.md` informs
  adjacent work; it is not implemented by this spec.
- The `sofar` upstream emitter-count ceiling — "a couple hundred individual
  spatial emitters" on modern hardware — is recorded by the original source as an
  informal QA sanity bound, not a hard requirement. It is not asserted as a
  behavior AC here; use it as a performance sanity check rather than a gate. (The
  related Fyrox `hrtf`-crate click-artifact hazard is now a binding constraint —
  see AC-024.) Recovered from `bb84b0e:specs/missing/atmos.md`
  (Tradeoffs and risks table).
