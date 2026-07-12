---
type: audit
id: AUDIT-grinder-control-deck
title: Grinder Control Deck and DSP chain
status: open
owner: The Sourdaw team
sources:
  - src/modules/Grinder/
  - crates/daw-dsp/src/grinder/
---

# Audit: Grinder Control Deck and DSP chain

This is the founding audit for the whole Grinder track (phases 1-14 and the
modular rig graph). It records the present state of the Grinder plugin from a
guitar-amp workflow perspective: Control Deck UI, Neural tab, preset browser,
state/bridge wiring, and the audible DSP stages. Each phase spec in the track
cites it.

## Scope

- In scope: `src/modules/Grinder/` (Control Deck UI, stores, param bridge,
  presets, models, presentations) and the DSP stages in
  `crates/daw-dsp/src/grinder/` (input, pedals, triode, power_amp, cabinet,
  neural, engine).
- Out of scope: timeline clip-alignment precision (a user-reported "move clips
  side to side" issue that appears to belong to Arrangement/editing, not Grinder).

## Observations

- Grinder runs a real stage-based chain — input conditioning, noise gate, pre
  pedals, triode preamp, tone stack, power amp, transformer, cabinet convolution,
  speaker model, optional post pedals, neural blend, output limiting — evidence:
  `crates/daw-dsp/src/grinder/engine.rs`.
- The Control Deck changes shape by `uiSection`: `drive` renders the chain-order
  strip and four pedal cards, `neural` renders Engine Mode / Capture Role / Model
  Browser, `lab` includes an explicit gate enable toggle plus advanced amp
  controls — evidence: `src/modules/Grinder/presentations/views/GrinderPanel.tsx`.
- Pedal enable state is stored on `pedal.enabled` (not `params.enabled`) and a
  toggled pedal stays visibly active — evidence: store-level regression test, and
  `src/modules/Grinder/useCases/grinderParamBridge/setGrinderPedalParamWithAudio.ts`.
- The Lab section exposes a `Gate On` / `Gate Off` toggle; the enabled gate closes
  to a deep floor and clamps decisively after hold/release, though the default
  init patch keeps the gate disabled — evidence: `GrinderPanel.tsx`,
  `crates/daw-dsp/src/grinder/engine.rs`.
- Pedal loudness is bounded: distortion and fuzz use input conditioning plus a
  bounded 2x-oversampled nonlinear stage; fuzz settles near silence on silent
  input — evidence: `crates/daw-dsp/src/grinder/pedals.rs` and DSP loudness
  regressions.
- Supported pre-pedal chain order is audible and user-visible (Drive deck strip +
  bridge order params + Rust execution order), not decorative metadata — evidence:
  `syncGrinderPatchToAudio.ts`, `moveGrinderPedalInChainWithAudio.ts`.
- Snapshots recall against a stable hidden `basePatch`; the Browser rail exposes
  snapshot buttons and recall updates both `activeSnapshot` and the live audio —
  evidence: `src/modules/Grinder/stores/grinderStore.ts`,
  `recallGrinderSnapshotWithAudio.ts`.
- Cabinet `mic1Distance`, `mic2Distance`, `roomAmount` audibly change output;
  `cabType` selects IR-only / parametric / combined; `cabIrId` selects a built-in
  voice; `routingMode` selects bounded fixed-chain presets — evidence:
  `crates/daw-dsp/src/grinder/cabinet.rs`, `GrinderPanel.tsx`,
  `GrinderEngine`.
- Later-stage controls are differentiated: `powerAmpBias` changes crossover width
  / asymmetry / headroom; `gridConduction` changes hard-attack clamping;
  `rectifierType` survives patch-sync order; preamp/power-amp decay-shape have
  regressions — evidence: `crates/daw-dsp/src/grinder/triode.rs`,
  `power_amp.rs`.
- Amp-family labels are measurably distinct (Rectifier vs Lead JCM body; 6L6 vs
  EL84 under driven burst), and `inputMode` (`instrument`/`line`/`reamp`) produces
  bounded measurable front-end differences — evidence:
  `crates/daw-dsp/src/grinder/input.rs`, family-ordering regressions.
- Built-in neural model selection loads distinct profiles via a real
  `neuralModelSlot`; imported NAM `.nam` files persist in a reusable local library
  with raw-source retention and export/remove, and selected imports embed in the
  patch — evidence: `crates/daw-dsp/src/grinder/neural.rs`,
  `parseGrinderNamFile.ts`, `neuralLibraryPersistence/`.

## Risks

- Highest-drive later stages can still sound fizzy or generic vs a specialist amp
  plugin — fires when: palm-muted density and sustained feel matter more than
  edge-vs-body release behavior.
- The external Neural path runs a bounded compact internal profile, not full
  third-party runtime parity (no AIDA-X import) — fires when: imported captures
  are compared side-by-side against established Neural capture products.
- Routing presets are bounded within the fixed chain — fires when: a user expects
  arbitrary user-authored split/merge routing.
- Retaining raw imported NAM payloads increases IndexedDB usage — fires when: many
  large captures are imported.
- Later gain-stage regression coverage is thinner than the Neural/cabinet
  regressions — fires when: later amp-stage work introduces a sonic regression.

## Open questions / unverified areas

- Is the clip side-to-side movement complaint an Arrangement/editor snapping issue
  or a Grinder/cab interaction? No Grinder code path matching it was found.
- Does the product want referenceable real amp/pedal emulation, or a stylized
  effect? UI language and preset naming imply realism; some choices behave like an
  experimental effect.
- Should the gate behave like a traditional deep/fast high-gain gate or a softer
  expander? DSP and copy do not make the choice explicit.

## Candidate requirements

<!-- Prose only; AC numbering and Verify-with lines belong to the phase specs. -->

- Extend external Neural delivery beyond the compact NAM-first runtime toward
  fuller model/runtime coverage (priority `I-05`).
- Keep tightening later-stage extreme-gain voicing with targeted regressions
  around palm-muted density, fizz control, and high-gain decay (priority `I-06`).
- Decide whether `inputMode` gains an explicit UI affordance or stays
  preset-authored (priority `I-08`).
- Keep expanding expert-oriented regressions: pedal enable semantics, gate
  attenuation, cabinet distance/room audibility, neural model loading, later
  gain-stage behavior.
