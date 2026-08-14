---
type: spec
id: SPEC-effects-mastering-ui
title: Progressive-disclosure UI for effects and mastering plugins
status: draft
owner: The Sourdaw team
sources:
  - research.md
---

# Progressive-disclosure UI for effects and mastering plugins

## Intent

Give the effect and mastering plugins (Gluten, Grinder, Crust, Proof, Dutch
Oven) one shared progressive-disclosure UI framework with five tiers — Play,
Shape, Build, Route, Lab — plus a lock-free metering bridge and gain-matched
bypass, without changing any DSP.

## Non-goals

- Any change to plugin DSP, parameter ranges, or audio behavior.
- New plugins; this covers the five existing ones.
- Per-plugin bespoke UI frameworks; all five share the same primitives.

## Requirements

### AC-001 — A shared five-tier disclosure framework

A reusable framework must render exactly five tiers (Play, Shape, Build, Route,
Lab) with a consistent tier selector across all five plugins.

Verify with: `pnpm test:run -- DisclosureFramework`

### AC-002 — Tier selection persists per plugin instance

The selected tier must save with the project and restore per plugin instance on
reload.

Verify with: `pnpm test:run -- tierPersistence`

### AC-003 — A lock-free metering bridge feeds the meters

Meters must read DSP measurements through a lock-free SPSC ring buffer so the
audio thread never blocks on the UI.

Verify with: `pnpm cargo:test -- -p daw-engine metering::spsc_ring`

### AC-004 — Bypass is gain-matched to EBU R128

Toggling bypass must apply R128 loudness matching between processed and
bypassed signal so a level change is not mistaken for an improvement.

Verify with: `pnpm cargo:test -- -p daw-dsp metering::r128_gain_match`

### AC-005 — Gluten exposes its tier-mapped controls

Gluten (compressor) must map its controls across the five tiers per the
research's control assignment.

Verify with: `manual` — open Gluten, step through all five tiers, confirm each control appears at its assigned tier

### AC-006 — Grinder exposes its tier-mapped controls with WebGPU visualization

Grinder (amp sim) must map its controls across the five tiers and render its
Lab-tier visualization via WebGPU.

Verify with: `manual` — open Grinder, confirm tier controls and that the Lab visualization renders

### AC-007 — Crust exposes its tier-mapped controls

Crust (limiter) must map its controls across the five tiers per the research's
control assignment.

Verify with: `manual` — open Crust, step through all five tiers, confirm each control appears at its assigned tier

### AC-008 — Proof exposes its tier-mapped controls

Proof (mastering suite) must map its controls across the five tiers per the
research's control assignment.

Verify with: `manual` — open Proof, step through all five tiers, confirm each control appears at its assigned tier

### AC-009 — Dutch Oven exposes its tier-mapped controls

Dutch Oven (reverb) must map its controls across the five tiers per the
research's control assignment.

Verify with: `manual` — open Dutch Oven, step through all five tiers, confirm each control appears at its assigned tier

### AC-010 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-011 — Per-plugin tier-to-control assignments are authoritative for all five plugins

Each named control in Gluten (R4), Grinder (R5), Crust (R6), Proof (R7), and
Dutch Oven (R8) must be pinned to exactly one tier per the authoritative
assignment below; no control may appear at two tiers (it is visible at its
pinned tier and every tier above it).

- **Gluten** — Play: GR bar meter only. Shape: Threshold, Ratio, Attack,
  Release, Knee, Makeup Gain, Mix, GR peak-hold, Bypass. Build: Sidechain HPF,
  Sidechain LPF, Sidechain parametric band (freq/gain/Q), Stereo Link, Range,
  Hold, Auto-Release, GR history waveform. Route: External sidechain source,
  Mid/Side, Lookahead, Oversampling, Detection mode (Peak/RMS/Hybrid),
  multi-model blend crossfader. Lab: Topology selector (VCA/Opto/FET/Diode
  Bridge), diode curve parameters, transformer harmonics, advanced metering
  (input/output spectrum, crest-factor, transient-density).
- **Grinder** — Play: Amp/Cabinet preset, Gain, Master Volume, Level meter.
  Shape: 3-band EQ (Bass/Mid/Treble), Channel selector, model switches
  (Bright, Fat), Presence, Resonance. Build: drag-drop pedal chain
  (gate/drive/comp/modulation), per-pedal bypass, send/return order. Route:
  WebGPU virtual mic-room (1–2 mics: position X/Y, distance, angle, polar
  pattern; per-mic level/mix). Lab: NAM loader, IR loader, tube bias, sag
  depth, transformer saturation, input impedance calibration, anti-aliasing
  mode, dual-amp split/merge, per-stage meters.
- **Crust** — Play: Input Gain, Ceiling, Release, GR bar. Shape: Character
  mode (Transparent/Warm/Aggressive), Transient Punch, Mix. Build: ISP
  detection toggle, Oversampling, Auto-release, Soft-clip. Route: Mid/Side,
  Stereo Link, External sidechain. Lab: Detection filter curve, Lookahead
  samples, detailed metering (LUFS-I, LUFS-S, LRA, true-peak, PLR).
- **Proof** — Play: chain overview, master bypass, output LUFS-I, dry/wet,
  preset selector, one headline control per module. Shape: per-module core
  controls, module enable/disable. Build: drag-reorder handles, add/remove
  module, per-module advanced controls. Route: translation-curve bar, A/B/C
  reference slots. Lab: ONNX "Suggest", analysis readouts, dithering config,
  match-EQ snapshot & apply.
- **Dutch Oven** — Play: Size, Tone (shelf), Mix, Space preset
  (Hall/Room/Plate/Chamber/Cathedral/Shimmer/Infinite/Spring). Shape:
  Pre-Delay, Decay, Diffusion, High Cut, Low Cut, Width, Modulation
  Rate/Depth. Build: Early-reflection level, Late-field level, Early/Late
  balance, Ducking (sidechain amount + release), Freeze. Route: Send/Return
  mode, External sidechain source, True-Stereo, Hybrid Mode (Parallel/Series).
  Lab: Matrix Type (FDN-8/FDN-16/Plate/Spring/Convolution), Delay Lengths,
  Shimmer Pitch/Mode, Gravity, Saturation Type, IR loader, Custom-IR EQ,
  hybrid blend.

Verify with: `pnpm test:run -- GlutenPanel.tiers GrinderPanel.tiers CrustPanel.tiers ProofPanel.tiers ProofChamberPanel.tiers` — each fixture asserts the exact `data-testid` set rendered at each tier matches the assignment above

### AC-012 — Proof offers translation-curve auditioning, A/B/C reference comparison, and an ONNX "Suggest" surface

Proof must, at its Route tier, audition the master through simulated monitor
curves (Car / Phone / Mono / Headphones / NS-10 / Club) loudness-matched to the
unprocessed monitor path, and compare against up to three reference tracks at
matched loudness.

Verify with: `pnpm test:run -- ProofPanel.translationCurves ProofPanel.referenceTracks` — translation and reference paths match within ±0.5 LU

### AC-013 — Proof discloses outer chain-wide and inner per-module tiers independently

Proof must expose nested disclosure: the outer panel carries a chain-wide tier
selector, and each module card carries its own tier selector scoped to that
module; changing the outer tier sets a per-card default but must never override
a user-set inner tier, and changing an inner tier must not affect the outer
tier.

Verify with: `pnpm test:run -- ProofPanel.nestedTiers` — clicking a module card's inner Play/Shape/Build/Route/Lab changes only that module's inner visibility, and outer changes set defaults without clobbering user-set inner tiers

### AC-014 — The metering bridge and gain-match meet verifiable real-time thresholds

The metering bridge must drop oldest frames on overflow, write without blocking,
and reflect a DSP frame in the UI within ≤16 ms.

Verify with: `pnpm cargo:test -- -p daw-engine metering::drop_oldest metering::non_blocking_write metering::frame_to_paint_latency`

### AC-015 — ProofChamberState replaces numeric uiLevel with the named DisclosureTier union plus a tested migration

`ProofChamberState.uiLevel: 1 | 2 | 3 | 4 | 5` must be replaced by a named
`DisclosureTier` union (`'play' | 'shape' | 'build' | 'route' | 'lab'`), and a
pure `migrateLegacyUILevel` function must upgrade saved projects on load,
mapping `1..5` to the named tiers and defaulting any other input to `'play'`,
covered by unit tests across all five values and invalid inputs.

Verify with: `pnpm test:run -- migrateLegacyUILevel`

### AC-016 — Dutch Oven name collision with the orchestral suite codename is tracked, not silently renamed

The "Dutch Oven" codename collision with `factory/orchestra.md`'s orchestral
suite (logged `[CRITICAL]` as OQ2 in the original source) must be recorded as a
blocking open question that keeps "Dutch Oven" = reverb pending a product-level
decision.

Verify with: `manual` — confirm the Open questions section records the Dutch Oven vs orchestra.md collision

### AC-017 — Shared-primitive, drag-drop, IR-source, and persistence open questions are tracked before they gate implementation

The spec must carry the source's unresolved decisions — shared-primitive home
location (OQ4), drag-drop primitive reuse vs `@dnd-kit/core` (OQ5),
translation-curve IR source (OQ7), tier-persistence serialization version
(OQ8), and preset compatibility for the tier rename (OQ9) — as explicit open
questions so none is silently resolved by drift.

Verify with: `manual` — confirm OQ4, OQ5, OQ7, OQ8, and OQ9 each appear in the Open questions section with their recommended resolution noted

### AC-018 — Proof's Lab tier surfaces an ONNX "Suggest" assistant with a placeholder fallback

Proof must, at its Lab tier, surface an ONNX mastering-assistant "Suggest"
button whose suggested module order and parameter values render, or — when no
model is confirmed — a feature-flagged "Mastering assistant unavailable"
placeholder that does not break the panel.

Verify with: `pnpm test:run -- ProofPanel.onnxAssistant` — the assistant returns a chain within 2 s or renders the placeholder

### AC-019 — The gain-match estimator clamps compensation and supports all five frame types

The gain-match estimator must clamp compensation to ±24 dB and support the five
metering frame types (GainReduction, Levels, IspPeaks, Spectrum, History) at
their fixed rates.

Verify with: `pnpm cargo:test -- -p daw-dsp metering::r128_clamp_24db`

### AC-020 — This spec performs no drive-by rename of the Dutch Oven collision

This spec must not perform a drive-by rename of either side of the "Dutch Oven"
vs `factory/orchestra.md` collision.

Verify with: `manual` — confirm no module path, store key, or preset reference is renamed in this spec

### AC-021 — Each plugin shows an "A/B matched" indicator with three states and a numeric dB readout

Next to every plugin's bypass toggle, the UI must render a visible "A/B
matched" indicator with exactly three states — `matched` (|delta| ≤ 0.5 LU),
`estimating` (warm-up window), `unmatched` (compensation exceeds the ±24 dB
clamp) — plus a numeric readout of the current compensation value in dB to one
decimal place, so a user can confirm the match is deliberate, not an artifact.

Verify with: `pnpm test:run -- abMatchIndicator` — the indicator resolves to each of the three states under matched, warm-up, and clamp-exceeded inputs and the readout renders one decimal place

### AC-022 — Gain-match compensation re-estimates continuously and crossfades on bypass toggle

The R128 compensation value must be re-estimated continuously while the plugin
is processing (not latched at the moment of bypass), and toggling bypass must
crossfade the compensation over a bounded ramp of ≤ 20 ms so the transition is
inaudible.

Verify with: `pnpm cargo:test -- -p daw-dsp metering::bypass_crossfade_no_click` — toggling bypass five times over a 5 s active wet stream produces no sample delta > 12 dB per sample across any toggle event

### AC-023 — Per-plugin verification thresholds are pinned

The following per-plugin audio thresholds must hold: Crust's Lab true-peak meter
matches the EBU R128 true-peak of the output within ±0.3 dBTP on a 30 s signal
(R6); switching Gluten topology, Crust/Crust character mode, or Dutch Oven
Matrix Type while processing produces no click above −60 dBFS (R4/R6/R8); Dutch
Oven IR load is non-blocking and gain-matched to the pre-load output within
±0.5 LU (R8); and the cross-plugin tier-switch regression produces no sample
delta > 12 dB during active processing (release gate).

Verify with: `pnpm test:run -- CrustPanel.truepeak GlutenPanel.topologyClick ProofChamberPanel.matrixClick ProofChamberPanel.irGainMatch tierSwitch.clickDetector`

### AC-024 — The metering bridge is dual-platform behind one consumer interface

The Web Audio path must use `SharedArrayBuffer` + `ringbuf.js` (or equivalent)
for the worklet-to-main-thread bridge and the Tauri path must use `rtrb` + a
Tauri channel, with both conforming to the same TS consumer interface
`subscribeMeter(instanceId, frameType): Store<Frame>`. The producer side must
carry no mutex — no `Arc<Mutex<_>>` and no `try_lock`.

Verify with: `pnpm cargo:test -- -p daw-engine metering::no_mutex_on_producer` and `pnpm test:run -- subscribeMeter.contract` — both platform paths satisfy the shared interface and the producer hot path holds no lock type

### AC-025 — Shared-module index.ts re-export discipline and one-function-per-file hold

The shared-primitive module's root `index.ts` must re-export only from
`useCases/`, `events/`, `stores/`, and `presentations/views/` — never from
`models/`, `handlers/`, `repositories/`, `engine/`, or `services/` (R10) — and
every file under the shared module's `useCases/` and `repositories/` must export
exactly one function.

Verify with: `pnpm deps:validate`

### AC-026 — Grinder's WebGPU mic-room view falls back to radio-button positions without crashing

When WebGPU is unavailable, Grinder's mic-room view (R5) must detect the missing
capability and fall back to a non-GPU mic-placement UI using radio-button
positions, without crashing the panel.

Verify with: `pnpm test:run -- GrinderPanel.webgpuFallback` — with WebGPU stubbed unavailable, the panel renders the radio-button mic placement and does not throw

## Open questions

- [ ] (blocking) Is the five-tier model (Play/Shape/Build/Route/Lab) uniform
  across all five plugins, or do some collapse to fewer tiers? Per-plugin tier
  counts must be confirmed before the selector is built.
- [ ] (non-blocking) Should the metering bridge be one ring per meter or one
  multiplexed ring per plugin instance?
- [ ] (non-blocking) WebGPU fallback for Grinder's mic-room visualization when the
  capability is unavailable (see `../chrome-first-capability/spec.md`). The
  fallback itself is a firm requirement (AC-026, radio-button mic positions); the
  open question is only the visual fidelity of the non-GPU view.
- [ ] **[CRITICAL] OQ2** — "Dutch Oven" name collision with `factory/orchestra.md`'s
  orchestral-suite codename; the reverb in `crates/proof-chamber/` already ships
  the name. Recommend renaming the unimplemented orchestral product and keeping
  "Dutch Oven" = reverb; product owner must confirm. Block any rename on this
  decision. (Tracked by AC-016.)
- [ ] **[MAJOR] OQ4** — Shared-primitive home location for the tier / metering /
  gain-match helpers: a new `src/modules/PluginUI/` module, a split across
  `src/helpers/` + `src/infra/metering/`, or an existing module. Survey before
  deciding; recommend a single new dedicated module.
- [ ] **[MAJOR] OQ5** — Drag-and-drop primitive: reuse an existing primitive in
  `src/components/` or `src/helpers/` if present (for Proof module reorder and
  Grinder pedal-chain reorder), else confirm whether adding `@dnd-kit/core` is
  approved.
- [ ] **[MINOR] OQ7** — Translation-curve impulse-response source for Proof: a
  permissively-licensed open IR pack, in-house measurement, or analytical IIR
  approximations. Recommend IIR approximations for v1.
- [ ] **[MINOR] OQ8** — Tier-persistence serialization version: the migration
  needs a project-file schema version bump; align with the existing migration
  system rather than inventing a new one.
- [ ] **[MINOR] OQ9** — Preset compatibility for the tier rename: if any preset
  files persist `uiLevel` as a number they must migrate too; verify tier is
  per-instance UI state (not preset state) before landing R1.
- [ ] (restored detail) Proof preset band-narrowing duplication: `proofPresets.ts`
  carries four identical IIFE-in-`.map()` ladders with magic band indices `1`
  (low-shelf) and `6` (high-shelf) (`proofPresets.ts:23-33, 60-71, 110-120,
  124-134`). A `withBandAdjustments(bands, [[index, partial], …])` helper would
  let presets describe band changes declaratively; settle the helper shape before
  the Proof tier refactor touches these presets.

## Known risks

These are present-state observations from the existing per-plugin panels, carried
forward from the module audits so the tier refactor does not silently inherit
them. They are inventory findings, not new requirements; cite the file:line when
the refactor touches the area.

- **Crust `style` / `algorithm` name collision (`CrustPanel` / `loadCrustPatchWithAudio`).**
  The Crust patch carries both `style` (Level 1, three values:
  transparent/punchy/loud) and `algorithm` (Level 2, eight values:
  transparent/punchy/dynamic/…), which share the names `transparent` and `punchy`
  but mean different things. The two fields are independent (flipping one does not
  write the other) and `loadCrustPatchWithAudio` pushes both to the engine at load,
  so on patch load the engine receives both at once. There is no test for which the
  engine honors at a given tier. (Tracked forward by the engine-contract open
  question.)
- **Crust Attack/Release "Auto" mode is visually indistinguishable from 0 ms**
  (`CrustControlZone.tsx:240-265`). Both knobs treat `value === 0` as "Auto" and
  write `setParam('attackAuto', v === 0)` then `setParam('attack', v)`; a drag
  crossing 0 rapidly toggles `attackAuto` while also writing `0`, and there is no
  visual or screen-reader distinction between "Auto" and a real 0 ms attack — the
  readout shows "Auto" via `fmtKnob` but the knob position is identical.
- **`CrustWaveformDisplay` rAF tick counter grows unbounded**
  (`CrustWaveformDisplay.tsx:74,97,119`). `tickRef.current++` is never reset and
  the modulo test against `frameSkip` (1/2/4) shifts unexpectedly if the counter
  ever overflowed (negative-modulo). Harmless in practice (JS integers hold to
  2^53) but worth bounding when the display is touched.
- **`CrustGainStrip.spec.tsx` assertion is too loose to catch a label rename**
  (`__tests__/CrustGainStrip.spec.tsx:6-12`). The test asserts only
  `getByText(/gain/i)`, which would still pass if "Gain" were renamed to "PUSH" so
  long as "gain" appeared anywhere; it cannot catch a "Gain" → "PUSH" regression.
- **`updateGlutenMeters` partial updates can persist stale values**
  (`glutenStore.ts:70-85`). `crest`, `phaseCorr`, and `latency` are optional, so
  when omitted the prior values persist, while `inputDb`, `outputDb`, `grDb` are
  required with no meaningful default; a half-populated meter message would leave
  the store holding mixed-stale values. The descriptor builder does not send
  partial messages today, but the contract does not enforce full-struct-or-none.
- **`defaultGlutenInstances` is a module-scoped mutable `{}` reused across panels**
  (`GlutenPanel.tsx:313`). `useStore` never mutates it today, but the type is
  mutable; a future `mutate(default)` would corrupt every panel. Recommended
  `Object.freeze({})` (or an empty-object factory).
- **Gluten `Knob` re-creates its `onChange` arrow per render**
  (`GlutenPanel.tsx:298`), capturing a fresh `param` each render. The React
  Compiler memoises this so it stays AGENTS.md-compliant; recorded only as a
  caveat that the rule relies on the Compiler recognizing the idiom.
- **Proof `Level1Play` target buttons duplicate the rail's chip with divergent
  a11y/styling.** The Play-tier target buttons are a plain styled `<button>`
  (`ProofPanel.tsx:407-423`) while the rail uses `DawPluginChip`
  (`ProofPanel.tsx:211-227`) — two implementations of the same UI element with
  different accessibility and styling. The tier refactor should converge on one.
- **`useStore(proofStore, {})` can oscillate / tear** (`ProofPanel.tsx:173`). If
  `proofStore.value` ever flips `null` ↔ `{}` (e.g. a reset), the snapshot
  reference oscillates between the fallback `{}` and a fresh value and React can
  tear. Not triggerable today, but a fragile snapshot-stability surface.
- **Proof `bridges` registry is a module-level mutable singleton**
  (`proofParamBridge/helpers.ts:7`). It persists across HMR (every reload re-`set`s
  the entries) and registering the same `deviceId` twice silently overwrites the
  prior bridge with no warning; there is no `clearAllBridges()` for tests.
- **`useProofAnalyser` returns `sampleRate`/`fftSize` from `getAudioSampleRate()`
  re-evaluated per render** (`useProofAnalyser.ts:98-103`). The hook returns a
  fresh object each render with `sampleRate: getAudioSampleRate()` and `fftSize`
  re-evaluated, so callers using them in `useEffect` deps see an unstable
  reference — a stable-reference contract violation, even though the values are
  stable in practice.

## Affected areas

- `src/modules/PluginUI/disclosure/` (tier framework, selector, shared primitives)
- `src/modules/Plugins/{Gluten,Grinder,Crust,Proof,DutchOven}/`
- `crates/daw-engine/src/metering/` (SPSC ring), `crates/daw-dsp/src/loudness/` (R128)

## Dropped from sources

- Correction: an earlier draft listed the AI / translation "match-reference"
  mastering workflow for Proof as a dropped future feature. The original source
  (`specs/missing/effects-mastering-ui.md`, R7) had it **in scope** — Proof's
  Route-tier translation curves, A/B/C reference comparison, and the Lab-tier
  ONNX "Suggest" surface. It is restored to scope under AC-012; the ONNX model
  itself remains gated by OQ3 (ship a feature-flagged "unavailable" placeholder
  if no model is confirmed).
- Groove/feel presets and preset-morphing across tiers — UX polish, deferred.
- Per-plugin DSP additions implied by some Lab controls — out of scope; this
  spec wires existing parameters only (the original source records these as OQ6,
  to be audited against `crates/daw-dsp/src/proof/` exports before the Lab
  control set is frozen).
