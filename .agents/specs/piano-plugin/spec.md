---
type: spec
id: SPEC-piano-plugin
title: Flagship physically-modeled piano plugin
status: draft
owner: The Sourdaw team
sources:
  - research.md
---

# Flagship physically-modeled piano plugin

## Intent

Ship a physically-modeled 88-key concert grand from a single Rust DSP crate, running
native (Tauri/`cpal`) and in-browser (WASM/`AudioWorkletProcessor`), that is
perceptually competitive on the features listeners weight most — coupled-string
double decay, velocity-dependent timbre, and stretched inharmonic tuning. The
acoustic physics, parameter tables, and competitive landscape live in `research.md`.

## Non-goals

- MIDI 2.0 UMP transport and per-note controllers — the engine takes normalized `f32`
  velocity so MIDI 2.0 can be added at the input stage later. The competitive angle for
  a later upgrade: physical modeling makes MIDI 2.0's 65,536-level velocity resolution
  meaningful (each level maps to a distinct hammer-string interaction, with no
  velocity-layer boundary to mask it), unlike sample engines where Ivory 3's RGB engine
  must interpolate between fixed layers.
- VST3/CLAP/AU packaging — v1 is an internal Sourdaw instrument.
- Neural "warmth" post-processing — the perceptual target is met without runtime ML.
- Full FEM-precomputed soundboard, per-note editing of all parameters, a model
  marketplace, phantom partials/longitudinal modes, duplex-scale resonance, mobile.

## Requirements

### AC-001 — Velocity continuously modulates timbre

Sweeping MIDI velocity on a held note must yield a monotonically non-decreasing
spectral-centroid curve with no jump greater than 10% of its range between adjacent
velocities (no audible velocity-layer boundary).

Verify with: `pnpm cargo:test -- -p daw-dsp grand_boule -- velocity_timbre`

### AC-002 — Coupled strings produce two-stage decay

A struck mf C4 must exhibit a prompt decay (T60 in 0.3–2 s) and an aftersound decay
(T60 in 5–30 s).

Verify with: `pnpm cargo:test -- -p daw-dsp grand_boule -- coupled_strings`

### AC-003 — Partials follow inharmonic, stretched tuning

Partial frequencies must follow `f_n = n·f₁·√(1 + B·n²)`.

Verify with: `pnpm cargo:test -- -p daw-dsp grand_boule -- inharmonicity`

### AC-004 — The DSP engine is real-time safe

The audio callback must perform zero heap allocation, take no locks, and never block
across idle, single-note, 64-note pedal chord, preset change, and temperament change.

Verify with: `pnpm cargo:test -- -p daw-dsp grand_boule -- assert_no_alloc`

### AC-005 — Voice pool is fixed-size and lock-free

A pre-allocated voice pool must hold voices whose capacity never changes after init,
using atomic state transitions and click-free (≤ −60 dBFS) voice stealing.

Verify with: `pnpm cargo:test -- -p daw-dsp grand_boule -- voice_pool`

### AC-006 — Sustain pedal half-pedals continuously

A CC64 sweep while holding mf C4 must produce a monotonically increasing
fundamental-RMS response between CC64 30 and 110 with no derivative sign change.

Verify with: `pnpm cargo:test -- -p daw-dsp grand_boule -- sustain_pedal`

### AC-007 — Una corda shifts timbre

CC67 = 127 must reduce the first-partial attack of mf C4 by 2–6 dB versus CC67 = 0 and
raise the energy in partials 3–5.

Verify with: `pnpm cargo:test -- -p daw-dsp grand_boule -- una_corda`

### AC-008 — Sostenuto sustains only notes held at engagement

A note depressed before sostenuto engages must ring until release of the pedal;
notes played afterward must decay normally on their own key release.

Verify with: `pnpm cargo:test -- -p daw-dsp grand_boule -- sostenuto`

### AC-009 — Sympathetic resonance is gated and harmonic-selective

With pedal up and no notes held, sympathetic output must be below −80 dBFS.

Verify with: `pnpm cargo:test -- -p daw-dsp grand_boule -- sympathetic`

### AC-010 — A mechanical-noise layer is present and switchable

Key-down and pedal events must trigger short filtered noise bursts at calibrated
levels.

Verify with: `pnpm cargo:test -- -p daw-dsp grand_boule -- mechanical_noise`

### AC-011 — Low-register modes stay numerically stable

A held A0 rendered for 30 s at 48 kHz on both targets must produce zero denormal or
NaN samples.

Verify with: `pnpm cargo:test -- -p daw-dsp grand_boule -- low_register_stability`

### AC-012 — Presets and structural changes never glitch

Temperament, model, and mic-config changes during active playback must produce no
per-sample level delta greater than 12 dB.

Verify with: `pnpm cargo:test -- -p daw-dsp grand_boule -- preset_switch`

### AC-013 — Project state uses Vanilla `Store<T>`

Parameter, preset, and temperament state must live in `Store<T>` via `createStore` /
`useStore` with no third-party global-state library imported under the module.

Verify with: `pnpm test:run -- PianoPlugin`

### AC-014 — Tauri and WASM targets share one API surface

Both deployment targets must present the same use cases, parameter IDs, and events,
with platform-specific code confined to `repositories/`.

Verify with: `pnpm test:run -- PianoPlugin`

### AC-015 — Module boundaries hold

The plugin module must expose only its root barrel and pass dependency validation.

Verify with: `pnpm deps:validate`

### AC-016 — Zeroing unison detune removes the aftersound

Setting unison detune to 0 cents must remove the aftersound region of a struck mf C4.

Verify with: `pnpm cargo:test -- -p daw-dsp grand_boule -- coupled_strings`

### AC-017 — Default tuning follows a Railsback stretch

Default tuning must follow a Railsback-style stretch (A1 ≈ −19 cents, C8 ≈ +35 cents
vs equal temperament).

Verify with: `pnpm cargo:test -- -p daw-dsp grand_boule -- inharmonicity`

### AC-018 — Sympathetic resonance is harmonic-selective

With pedal down and a struck C4, a harmonically related resonance must exceed a
non-harmonic one by at least 6 dB.

Verify with: `pnpm cargo:test -- -p daw-dsp grand_boule -- sympathetic`

### AC-019 — The mechanical-noise layer is switchable

Toggling the noise master off must null the mechanical-noise bursts to ≤ −120 dBFS.

Verify with: `pnpm cargo:test -- -p daw-dsp grand_boule -- mechanical_noise`

### AC-020 — Multiple mic positions are a user-selectable control

The instrument must expose at least 3 selectable mic positions (close, player,
room/audience), each producing a distinct mic blend, and a mic-config change during
active playback must not glitch the stream (covered by AC-012). Competitive datum:
VSL ships up to 11 mic positions per piano.

Verify with: `pnpm cargo:test -- -p daw-dsp grand_boule -- mic_positions`

### AC-021 — Lid position is a continuous control the 3D view reflects

A lid-position control must continuously shape the output timbre, and the interactive
3D piano view must animate the articulated lid in response to it.

Verify with: `pnpm test:run -- PianoPlugin`

### AC-022 — The browser target is served Cross-Origin-Isolated

The browser build must be served with `Cross-Origin-Embedder-Policy: require-corp` and
`Cross-Origin-Opener-Policy: same-origin` headers so `SharedArrayBuffer` (the
AudioWorklet↔main-thread ring buffer) is available.

Verify with: `pnpm test:run -- PianoPlugin`

### AC-023 — Visualization holds zero buffer underruns under load

A 60-second stress run forcing 60 fps visualization plus 60% audio-thread CPU load must
maintain a buffer-underrun count of zero (native `cpal` callback error count and
AudioWorklet processor-error count both zero).

Verify with: `pnpm cargo:test -- -p daw-dsp grand_boule -- viz_underrun_stress`

### AC-024 — Visualization degrades to a placeholder when WebGPU is absent

When WebGPU is unavailable the views must fall back to a "visualization unavailable"
placeholder without crashing the plugin.

Verify with: `pnpm test:run -- PianoPlugin`

### AC-025 — The hammer↔string delay-free loop is resolved by a documented technique

The hammer↔string feedback path is an implicit delay-free loop and must be resolved by
a documented technique (Bank 2000 / Borin K-method), recorded in the module's top-level
comment; an uncontrolled one-sample-delay fallback that biases hammer contact duration
or peak force out of the research target range at C4 mf must fail the suite.

Verify with: `pnpm cargo:test -- -p daw-dsp grand_boule -- delay_free_loop`

### AC-026 — Repedaling re-engages string energy within the catch window

A note-on → note-off → CC64-down 75 ms later must keep the fundamental RMS at the
re-engagement instant within 3 dB of a continuous-sustain reference; a 250 ms gap must
drop by ≥ 6 dB.

Verify with: `pnpm cargo:test -- -p daw-dsp grand_boule -- repedaling_catch`

### AC-027 — Notes above C7 ring undamped regardless of the sustain pedal

Held C7♯ and higher notes must have effectively identical decay at CC64 = 0 and
CC64 = 127 (the physical piano has no dampers above ~C7); the voice model must not
attempt to damp them.

Verify with: `pnpm cargo:test -- -p daw-dsp grand_boule -- damper_absence_high`

### AC-028 — Install footprint stays small

The shipped instrument must install in under 100 MB, with the modeled engine's
parameter data ~50 MB and no streamed sample library; the optional hybrid-attack tier
(AC-029) is the only sample asset and must not push the default install over the cap.

Verify with: `pnpm test:run -- PianoPlugin`

### AC-029 — An optional hybrid sample-attack tier blends sampled attack into modeled sustain

An optional, default-off quality tier must crossfade a sample-based attack transient
(first 10–50 ms) into the modal sustain; with the tier off the output must be pure
modal synthesis (bit-identical to the non-hybrid path), and the attack samples must come
from a license-compatible source (e.g. Salamander Grand Piano).

Verify with: `pnpm cargo:test -- -p daw-dsp grand_boule -- hybrid_attack`

### AC-030 — The native target is the richer quality tier

The native (Tauri/`cpal`) target must offer a higher voice-pool capacity (256 voices)
and full soundboard modeling, while the browser (WASM) target must run a reduced tier
(64 voices, simplified soundboard) that exposes the same parameter UI. Both tiers must
present identical parameter IDs and use cases (consistent with AC-014).

Verify with: `pnpm cargo:test -- -p daw-dsp grand_boule -- quality_tiers`

## Open questions

- [ ] WASM polyphony envelope: measure per-voice modal cost in `AudioWorkletProcessor`
  on reference hardware. If browser polyphony falls below 32 voices at target quality,
  the browser scope must be renegotiated. Blocks committing the browser target.
- [ ] Realism target and evaluation method (no-audible-glitches disclaimer vs a formal
  listening test). Blocks calling the plugin done.
- [ ] License audit of every imported parameter table (NC-licensed sources are
  incompatible with commercial distribution). Blocks importing any constant.
- [ ] (non-blocking) WebGPU visualization scope — which of the 3D piano, string
  vibration, and spectral waterfall views ship in v1 if one proves too costly.
- [ ] (restored detail) Soundboard model quality is the central perceptual bet.
  Pianoteq 9's major gain was a re-engineered soundboard vibration model that users
  reported eliminated "ear fatigue" from earlier versions. Mitigation if our v1 sounds
  fatiguing: invest in soundboard model quality and use offline FEM precomputation at the
  highest practical resolution. Open: how much soundboard fidelity v1 ships before the
  perceptual gate is met.
- [ ] (restored detail) RT-safe drops on the audio thread — adopt the `basedrop`
  `Shared<T>` deferred-deallocation technique (drops on the audio thread are handed to a
  collector thread) so AC-004's no-alloc/no-block guarantee holds even when a voice or
  buffer is released from the callback. Open: confirm `basedrop` covers every drop path.
- [ ] (restored detail) OQ2 — numerical tolerance for the ±3 dB R5/AC-001-adjacent
  spectral-envelope criterion is an unvalidated guess; before implementation, derive it
  from inter-performance variance of the chosen reference, or replace it with a published
  auditory-model distance (PEMO / Osses & Kohlrausch), or downgrade to perceptual-panel
  only. Blocks committing the spectral-realism numeric target.
- [ ] (restored detail) OQ5 — Salamander Grand Piano (the assumed source for AC-029's
  hybrid attack samples, public domain as of 2022) must be license-audited file-by-file
  before the hybrid tier ships. Blocks shipping the hybrid path.
- [ ] (restored detail) OQ6 — soundboard approach for v1: parametric biquad bank
  (default, always works) vs commuted-FFT IR (better sounding, needs a pre-generated IR
  asset and a partitioned-FFT code path). Confirm v1 does not ship both.
- [ ] (restored detail) OQ8 — how many velocity-curve presets ship (suggested: Linear,
  Soft, Hard, Exponential). Confirm with product.
- [ ] (restored detail) OQ9 — which mechanical-noise event types ship in v1. Research
  lists four (key-down, hammer let-off, damper lift, pedal-down); suggested v1 subset is
  key-down and pedal-down only. Confirm with product.

## Affected areas

- `crates/daw-dsp/src/grand_boule/` (modal engine, hammer, coupling, sympathetic, pedals)
- `src/modules/PianoPlugin/**` (`useCases/`, `events/`, `stores/`, `presentations/views/`, `repositories/`, `engine/`)

## Known risks

Present-state findings from the GrandBoule module audit (off the audio thread —
visualization performance, not RT-safety violations) carried forward for the
implementation to weigh:

- `PianoModel3D.tsx:493-498` copies the vertex scratch buffer element-by-element
  (`uploadBuffer[i] = buf[i]!`) inside the rAF loop — ~10,000 elements per frame at
  NUM_KEYS=88 — and re-uploads via inline `gl.bufferData(... new ...)` once per frame.
  Push directly into the typed array (e.g. `set()` bulk copy) and reuse the GL buffer.
- `StringVibrationView.tsx:33-80` runs at the display refresh rate (60–144 Hz) with no
  cap, allocates a `ctx.beginPath` per string per frame, and walks a full per-pixel sine
  render with no `requestIdleCallback` and no `document.hidden`/visibility gate — so a
  collapsed-but-mounted panel still draws.
- `MorphPanel` keeps the morph knob handler `onMorphPositionChange` bound when
  `morph.enabled === false`; the disabled state is only masked by `pointer-events-none`
  and `opacity-35` on the wrapper. A future change that loosens the wrapper would let a
  "disabled" morph dispatch model A's parameters to the engine.

## Dropped from sources

- MIDI 2.0 transport, VST3/CLAP/AU packaging, neural warmth, full FEM soundboard,
  per-note editing, model marketplace — each scoped out under Non-goals for the reason
  stated there (footprint, unrelated infrastructure, or perceptual-target independence).
- Phantom partials / longitudinal modes and duplex-scale resonance — ranked low on the
  perceptual priority list; v1 relies on transverse-mode inharmonicity. Revisit only if
  the perceptual gate fails.
- Progressive per-voice cost reduction (nonlinear → linear decay for old voices) — v1
  uses one quality tier per voice and voice-stealing; revisit if polyphony budget forces it.
- DRM as a feature is deliberately absent. The competitive pain-point (VSL's
  iLok-Cloud silences on internet drop; Pianoteq's 3-seat activation is the praised
  counter-example) is addressed structurally: a modeled engine ships no sample assets to
  pirate, so AC-028's small modeled footprint removes the need for sample-protection DRM.
