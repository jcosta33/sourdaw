# Spec: Effects & Mastering Progressive-Disclosure UI

## Reference research

- `.agents/research/factory/effects-mastering.md` — consolidated findings on the five effects & mastering plugins whose DSP already ships in `crates/daw-dsp/` (`gluten`, `grinder`, `proof`) and `crates/proof-chamber/` (Dutch Oven). The research records which UI/UX features are **pending** versus **implemented**; this spec converts those pending items into a single consolidated UI contract.

All DSP math, topology descriptions, analysis features, and IR/ONNX model references live in the research file. This spec references them by name but does not re-embed them. Implementers go to the research file for "what the algorithm is"; they stay in this spec for "what the UI must do and when it is done."

---

## Context

The DSP for all five effects and mastering plugins is implemented and shipping:

| Plugin | Codename | Category | DSP location | Current UI surface |
| ------------ | ---------- | ------------------ | -------------------------------------- | ------------------------------------------------------ |
| Gluten | Gluten | Bus compressor | `crates/daw-dsp/src/gluten/` | `src/modules/Gluten/presentations/views/GlutenPanel.tsx` |
| Grinder | Grinder | Amp simulator | `crates/daw-dsp/src/grinder/` | `src/modules/Grinder/presentations/views/GrinderPanel.tsx` |
| Crust | Crust | Brickwall limiter | `crates/daw-dsp/src/proof/limiter.rs` | `src/modules/Crust/presentations/views/CrustPanel.tsx` |
| Proof | Proof | Mastering suite | `crates/daw-dsp/src/proof/` | `src/modules/Proof/presentations/views/ProofPanel.tsx` |
| Dutch Oven | Dutch Oven | Reverb | `crates/proof-chamber/` | `src/modules/Plugin/presentations/views/ProofChamberPanel.tsx` |

Every plugin has DSP-complete feature coverage. The audited gap is the **UI/UX progressive-disclosure contract**: each panel currently exposes some of its parameters in an ad-hoc layout, without a consistent hierarchy of tiers, without a shared metering bridge from DSP to UI, and without a common A/B discipline. Users asked to "tweak the compressor" see either too much or too little depending on the panel they opened.

This spec defines **one** UI architecture shared across all five plugins, plus the per-plugin controls assigned to each disclosure tier. It reuses the tier vocabulary established by `factory/fermenter.md` Part 11 (Play / Shape / Build / Route / Lab). It does not alter DSP.

### Relationship to existing work

- `factory/fermenter.md` introduced Play / Shape / Build / Route / Lab for the master synthesizer. This spec adopts the same vocabulary without change so users develop one mental model across instruments and effects.
- `src/modules/Plugin/models/ProofChamberState.ts` already encodes `uiLevel: 1 | 2 | 3 | 4 | 5` on the per-instance state, and `setChamberUILevel` is an existing use case. That pattern is the baseline every other plugin in this spec must conform to.

---

## Goal

Ship a single progressive-disclosure UI framework — with a shared lock-free metering bridge and LUFS-matched bypass — that lets every first-party Sourdaw effect (Gluten, Grinder, Crust, Proof, Dutch Oven) present the same five tiers (Play / Shape / Build / Route / Lab) of consistent, verifiable parameter visibility.

---

## User-visible behavior

- **Every effect panel has the same top-right tier selector.** The user clicks Play / Shape / Build / Route / Lab; the panel reveals or hides controls accordingly. The selection persists per-plugin-instance and per-project.
- **Opening a plugin at Play exposes the minimum set of controls** — one to three knobs and one meter. A new user can get a useful result without knowing the rest exists.
- **Opening the same plugin at Lab exposes every control** — no hidden parameters remain. A power user never has to drop down to a hidden menu.
- **Tier transitions never drop audio.** Switching from Shape to Route while the plugin is processing a live stream produces no click, gap, or parameter reset.
- **Meters update fluidly.** GR, level, and history meters refresh within one display frame of new DSP data — not batched, not stuttered. No audio thread stalls on UI load.
- **A/B bypass is honest.** Toggling bypass on any plugin produces a perceived-loudness match between the processed and bypassed signal to within ±0.5 LU (EBU R128), so the user can evaluate the effect on merit, not on volume.
- **Proof is reorderable.** The mastering chain exposes a drag-to-reorder module list; modules can be enabled, disabled, and reordered at any time.
- **Proof offers translation checks and reference comparison.** The user can audition the master through simulated monitor curves (Car, Phone, Mono, Headphones, NS-10) and compare against up to three loaded reference tracks at matched loudness.

---

## Scope

### In scope

- Shared progressive-disclosure framework implemented as a reusable primitive (helper + hook + type) under `src/modules/PluginUI/` (or an equivalent shared location — see Design decisions).
- Per-instance, per-project persistence of the current tier for each of the five plugins, using the module's existing Vanilla `Store<T>` pattern.
- Per-plugin tier assignment for Gluten, Grinder, Crust, Proof, Dutch Oven — every control in each plugin is pinned to exactly one tier.
- A shared lock-free DSP-to-UI metering bridge (SPSC ring buffer) consumed by all five plugin meter components.
- An EBU R128 gain-matched bypass path shared by all five plugins.
- Proof-specific UI: `@dnd-kit`-based reorderable module chain, translation-curve auditioning, A/B/C reference track comparison, ONNX-backed mastering assistant UI surface.
- Grinder-specific UI: WebGPU virtual mic-room view (tier Route), NAM and IR loader (tier Lab).
- Tests for RT safety of the metering bridge, gain-match accuracy, and per-plugin tier-visibility fixtures.

### Non-goals (explicitly out of scope)

- **Any change to the DSP in `crates/daw-dsp/**`, `crates/proof-chamber/**`, or `src-tauri/**`.** DSP is frozen for this spec. If an implementer believes a DSP change is required to satisfy a UI requirement, that is a blocker — escalate rather than mutate the DSP.
- **New effects or plugin categories** — only the five listed above are in scope.
- **VST3/CLAP/AU packaging** of any of these plugins.
- **User-authored tier customization** (reassigning which parameter sits at which tier). Tier assignments are fixed in code for v1.
- **Analytics / telemetry on tier usage.**
- **Writing new DSP** for analysis features beyond what `crates/daw-dsp/src/proof/` already exports. If the research lists an analysis feature (e.g. spectral flatness) that the DSP does not yet emit, surface it as an open question — do not add DSP here.
- **A marketplace or download path for the ONNX mastering assistant model.** v1 ships one model (or no model — see OQ3) bundled with the app.
- **Mobile/tablet UI.** Desktop Tauri and desktop browser only.
- **Replacing the existing per-plugin React panels wholesale.** This spec is additive: existing panels are refactored to consume the shared tier framework; they are not rewritten.

---

## Requirements

Each requirement has at least one verifiable acceptance criterion. Every tier-visibility AC is pinned to a fixture test under `src/modules/<Plugin>/presentations/views/__tests__/`.

### R1. Progressive disclosure framework (shared)

All five plugins expose exactly five visibility tiers, named in order: **Play**, **Shape**, **Build**, **Route**, **Lab**. Tiers are additive: tier N reveals every control visible at tier N−1 plus the controls pinned to tier N. Tier selection is per-plugin-instance and persists inside the plugin's Vanilla `Store<T>` state on the project. A single shared hook (`useDisclosureTier(instanceId)`) returns the current tier and a setter; a single shared helper (`isVisibleAtTier(controlTier, currentTier)`) gates each control's render.

**Acceptance criteria:**

- A fixture test per plugin enumerates the control set visible at each tier and asserts exact equality with a committed snapshot (`<plugin>-tiers.snapshot.ts`). Snapshot drift forces an explicit spec update.
- Tier is represented as `'play' | 'shape' | 'build' | 'route' | 'lab'` — a string-literal union, not a numeric level. The existing `uiLevel: 1 | 2 | 3 | 4 | 5` field on `ProofChamberState` is replaced by the named union; a migration function upgrades saved projects on load.
- In the Tier fixture test, switching a plugin instance from `'play'` to `'lab'` and back leaves every DSP-mapped parameter value untouched (tier change is visibility-only).
- Tier persistence round-trip: save a project at tier `'route'` on instance X; reopen; read tier → equals `'route'`.
- `pnpm deps:validate` passes. The shared tier helpers live in a single module and are consumed by all five plugin modules without any plugin importing another plugin's internals.

### R2. Lock-free DSP-to-UI metering bridge (shared)

Meter values (GR, input level, output level, ISP peaks, spectrum frames) cross the audio-to-UI boundary through a single shared SPSC ring-buffer abstraction. The audio thread is the producer; the UI animation frame is the consumer. Writes from the audio thread never allocate, never lock, and never block. When the UI consumer falls behind, the buffer drops **oldest** frames (not newest) so the UI shows fresh data.

The metering schema supports five frame types used across the five plugins:

| Frame type | Plugins | Rate | Fields |
| --------------- | ----------------------- | --------------- | ------------------------------------------------- |
| `GainReduction` | Gluten, Crust, Proof | ~30 Hz | `{ gr_db: f32, input_db: f32, output_db: f32 }` |
| `Levels` | all five | ~30 Hz | `{ input_db: f32, output_db: f32, lufs_s: f32 }` |
| `IspPeaks` | Crust, Proof | per block | `{ peak_dbtp: f32, occurrences: u32 }` |
| `Spectrum` | Grinder, Proof, Gluten | 10 Hz | `{ bins: [f32; N], smoothing: f32 }` — N is fixed |
| `History` | Gluten (GR waveform) | ~30 Hz | `{ sample: f32 }` (appended to a scroll buffer) |

Sample rate for each frame type is fixed at compile time; the producer writes at that rate regardless of the UI consumer's frame rate. Frame type is a discriminated union carried in the queue payload.

**Acceptance criteria:**

- A Rust test under `crates/daw-dsp/` (or equivalent) wraps the meter-write hot path in `assert_no_alloc` and runs for 60 s of synthetic DSP load across all five plugins; no panic.
- A unit test on the buffer asserts drop-oldest behavior when the consumer is paused for N queue-lengths of writes (N = queue capacity).
- A unit test asserts writes never block: with a paused consumer and a producer trying to write, every write call returns within its first invocation (no spin, no yield, no `std::thread::park`).
- In the shared meter React hook, the latency between a DSP frame timestamp and the first paint that reflects it is ≤ **16 ms** in a 60 fps render loop under a reference load (measured by a timestamp round-trip in an integration test harness).
- The Web Audio path uses `SharedArrayBuffer` + `ringbuf.js` (or equivalent) for the worklet-to-main-thread bridge; the Tauri path uses `rtrb` + a Tauri channel. Both paths conform to the same TS consumer interface (`subscribeMeter(instanceId, frameType): Store<Frame>`).
- No plugin module directly holds a metering queue type — the queue lives in a shared module (see Design decisions) and is injected into each plugin's store via a repository-owned factory.
- The producer side of the queue is parameterless from the DSP's perspective: each plugin's existing DSP crate adds one call site per frame type, passing a typed frame struct. There is no mutex, no `Arc<Mutex<_>>`, no `try_lock`.

### R3. EBU R128 gain-matched bypass (shared)

Every plugin has a **bypass** toggle. When bypass is engaged, the output path substitutes the dry input but first applies a loudness-compensation gain so processed and bypassed signals land within ±0.5 LU (EBU R128 Short-Term window). The compensation value is re-estimated continuously while the plugin is processing (not latched at the moment of bypass). The compensation crossfades over a bounded ramp (≤ 20 ms) when bypass is toggled so the transition is inaudible.

The estimator runs two EBU R128 Short-Term loudness meters in parallel — one on the plugin input, one on the plugin output — and computes `compensation_db = lufs_input - lufs_output`, clamped to ±24 dB to prevent runaway when the plugin is driven near-silent. When bypass is engaged, the dry input is multiplied by `10^(-compensation_db / 20)` before reaching the output bus.

**Acceptance criteria:**

- Integration test per plugin: drive a 30-second pink-noise test signal; measure EBU R128 Short-Term loudness of the "wet" path and the "bypassed" path; |LUFS_wet − LUFS_bypass| ≤ 0.5 LU for the final 20 seconds (first 10 s is warm-up).
- Bypass-toggle click test: with an active wet stream, toggle bypass on and off five times over a 5-second capture; the peak-hold click detector reports no sample delta > 12 dB per sample across any toggle event.
- The compensation estimator is implemented once (shared helper) and reused by all five plugins. Imported from the shared primitive module — no plugin re-implements EBU R128.
- The compensation estimator runs on the audio thread inside the existing DSP node (or an equivalent RT-safe path) and is verified `assert_no_alloc`.
- The compensation gain is clamped to ±24 dB. A unit test drives extreme inputs (silence wet, full-scale dry) and asserts the clamp holds.
- The UI exposes a visible "A/B matched" indicator next to each plugin's bypass toggle with states: `matched` (|delta| ≤ 0.5 LU), `estimating` (warm-up window), `unmatched` (exceeds clamp). Flipping bypass while the indicator is `matched` produces no audible level jump beyond the 0.5 LU tolerance.
- A numeric readout next to the indicator shows the current compensation value in dB to one decimal place; users can verify the match is deliberate, not an artifact.

### R4. Gluten UI (bus compressor)

Every Gluten control is pinned to exactly one tier. The tier assignment is authoritative:

- **Play:** GR bar meter only (no knobs).
- **Shape:** Threshold, Ratio, Attack, Release, Knee, Makeup Gain, Mix. GR meter with peak-hold. Bypass toggle.
- **Build:** Sidechain HPF, Sidechain LPF, Sidechain parametric band (freq/gain/Q), Stereo Link (0–100%), Range, Hold, Auto-Release toggle. GR history waveform view.
- **Route:** External sidechain source selector, Mid/Side mode toggle, Lookahead amount, Oversampling factor, Detection mode (Peak / RMS / Hybrid), multi-model blend crossfader.
- **Lab:** Topology selector (VCA / Opto / FET / Diode Bridge), diode curve parameters, transformer harmonic controls, advanced metering (input/output spectrum, crest-factor, transient-density readout).

**Acceptance criteria:**

- Fixture test `src/modules/Gluten/presentations/views/__tests__/GlutenPanel.tiers.spec.tsx` asserts, for each tier, the exact set of `data-testid` values rendered; the snapshot matches the list above.
- No Gluten control is accessible at two different tiers simultaneously. (Enforced by the fixture test: each testid appears at its pinned tier and all tiers above it.)
- Every Gluten parameter writable through the UI has its change persisted via a use case in `src/modules/Gluten/useCases/`; no write path bypasses the store.
- Flipping topology (Lab) while the plugin is processing produces no click above −60 dBFS in the output (click-detector integration test).

### R5. Grinder UI (amp simulator)

Every Grinder control is pinned to exactly one tier:

- **Play:** Amp/Cabinet preset selector, Gain, Master Volume. Level meter.
- **Shape:** 3-band EQ (Bass / Mid / Treble), Channel selector, model-specific switches (Bright, Fat), Presence, Resonance.
- **Build:** Drag-and-drop pedal chain (gate, drive, comp, modulation), per-pedal bypass, send/return order.
- **Route:** WebGPU virtual mic-room view — 3D placement of 1–2 microphones on the cab cone (position X/Y, distance from cone, angle, polar pattern per mic). Per-mic level and mix.
- **Lab:** NAM model loader, IR loader, tube bias, sag depth, transformer saturation, input impedance calibration, anti-aliasing mode, dual-amp split/merge, per-stage meters.

**Acceptance criteria:**

- Fixture test `src/modules/Grinder/presentations/views/__tests__/GrinderPanel.tiers.spec.tsx` asserts per-tier control sets per the list above.
- The WebGPU mic-room view correctly detects WebGPU unavailability and falls back to a non-GPU mic placement UI (radio-button positions) without crashing the panel.
- Pedal reorder via drag updates the DSP chain through a single use case (`reorderGrinderPedals`) and is reflected in an audible null test: re-rendering the same input with pedals reordered produces a different output (sanity check that the reorder reached DSP).
- NAM model loading is handled through a repository and is non-blocking to the audio thread (tested under `assert_no_alloc` during load).

> Naming note: the codename "Grinder" is also used in `.agents/specs/factory/drum-machine.md` for a future drum-machine product. This conflict is recorded in Open questions (OQ1) and must be resolved before a new user-visible rename — this spec keeps "Grinder" as the amp-sim codename pending resolution.

### R6. Crust UI (limiter)

Every Crust control is pinned to exactly one tier:

- **Play:** Input Gain, Ceiling, Release. Gain-reduction bar.
- **Shape:** Character mode (Transparent / Warm / Aggressive), Transient Punch knob, Mix.
- **Build:** Inter-sample Peak (ISP) detection toggle, Oversampling factor, Auto-release toggle, Soft-clip toggle.
- **Route:** Mid/Side mode, Stereo Link, External sidechain toggle.
- **Lab:** Detection filter curve, Lookahead samples, detailed metering (LUFS-I, LUFS-S, LRA, true-peak, PLR).

**Acceptance criteria:**

- Fixture test `src/modules/Crust/presentations/views/__tests__/CrustPanel.tiers.spec.tsx` asserts per-tier control sets per the list above.
- True-peak meter at tier Lab matches the EBU R128 true-peak measurement of the output signal within ±0.3 dBTP on a 30-second test signal.
- Switching character mode (Shape) updates DSP through a single use case without allocating on the audio thread.

Proof's reorderable module chain supports the following modules, already implemented in `crates/daw-dsp/src/proof/`: **EQ**, **Multiband Dynamics**, **Imager**, **Exciter**, **Limiter** (Crust), **Match EQ**, **Dithering**. Modules can be added once each (no duplicates in v1), reordered anywhere in the chain, and toggled enabled/disabled in place.

### R7. Proof UI (mastering suite)

Proof is the mastering suite with a reorderable module chain. Every control is pinned to exactly one tier; additionally, Proof exposes a **nested** disclosure: the outer Proof panel has its own tier selector, and each module card within the chain has its own tier selector scoped to that module.

- **Play (outer):** Module chain overview, master bypass, output loudness meter (LUFS-I), dry/wet, preset selector. Each module shows a single headline control (e.g. EQ: tilt; Imager: width).
- **Shape (outer):** Per-module core controls visible inside each card (per-module tier defaults to Shape when outer tier is Shape). Module enable/disable toggles.
- **Build (outer):** Drag-to-reorder handles appear on each module card (using `@dnd-kit/core` or an equivalent already present in the repo — check first, see Design decisions). Add / remove module buttons. Per-module advanced controls.
- **Route (outer):** Translation-curve monitoring bar: Car / Phone / Mono / Headphones / NS-10 / Club simulation curves auditionable; loudness-matched against the unprocessed monitor path. A/B/C reference-track slots with synchronized loudness.
- **Lab (outer):** ONNX mastering-assistant "Suggest" button and result panel; analysis readouts (spectral centroid, spectral flatness, bass/mid/high energy ratios, tonal balance deviation, LRA, PLR, stereo correlation); dithering configuration; match-EQ snapshot & apply.

**Acceptance criteria:**

- Fixture test `src/modules/Proof/presentations/views/__tests__/ProofPanel.tiers.spec.tsx` asserts outer-tier control sets per the list above.
- Reordering modules via drag-drop updates the DSP chain through a single use case (`reorderProofModules`) and is reflected in audio within one processing block (verified by a click-detector null test across a reorder event).
- The translation-curve auditioning path is loudness-matched to the non-simulated monitor path within ±0.5 LU (shared R3 infrastructure reused).
- A/B/C reference-track slots load audio through the existing repository path (no new I/O layer), and their loudness is matched to the master bus within ±0.5 LU.
- The ONNX mastering assistant either (a) returns a suggested chain within 2 seconds on reference hardware, displaying suggested modules in order with suggested parameter values, or (b) is explicitly disabled pending OQ3 — in which case the "Suggest" button is hidden behind a feature flag and the Lab tier shows a "Mastering assistant unavailable" placeholder that does not break the panel.
- Per-module nested tiers: clicking a module card's own Play/Shape/Build/Route/Lab control changes that module's inner control visibility without affecting the outer tier.

### R8. Dutch Oven UI (reverb)

Every Dutch Oven control is pinned to exactly one tier:

- **Play:** Size, Tone (shelf), Mix. Space preset selector (Hall / Room / Plate / Chamber / Cathedral / Shimmer / Infinite / Spring).
- **Shape:** Pre-Delay, Decay, Diffusion, High Cut, Low Cut, Width, Modulation Rate, Modulation Depth.
- **Build:** Early-reflection level, Late-field level, Early/Late balance, Ducking (sidechain amount + release), Freeze toggle.
- **Route:** Send/Return mode (insert vs send), External sidechain source, True-Stereo toggle, Hybrid Mode (Parallel / Series).
- **Lab:** Matrix Type (FDN-8 / FDN-16 / Plate / Spring / Convolution), specific Delay Lengths, Shimmer Pitch, Shimmer Mode, Gravity, Saturation Type, IR loader, Custom-IR EQ, hybrid-algorithmic/convolution blend.

**Acceptance criteria:**

- Fixture test `src/modules/Plugin/presentations/views/__tests__/ProofChamberPanel.tiers.spec.tsx` asserts per-tier control sets per the list above.
- Existing numeric `uiLevel: 1 | 2 | 3 | 4 | 5` on `ProofChamberState` is replaced by the named union from R1; a migration function converts `1..5` → `'play' | 'shape' | 'build' | 'route' | 'lab'` on project load. A unit test on the migration covers all five values.
- Switching Matrix Type (Lab) while the plugin is processing produces no click above −60 dBFS in the output (click-detector test).
- IR load is non-blocking to the audio thread and gain-matched to the pre-load output within ±0.5 LU.

> Naming note: "Dutch Oven" is also used in `.agents/specs/factory/orchestra.md` as a codename for the orchestral suite. This conflict is recorded in Open questions (OQ2).

---

### R9. Tier persistence and project-file compatibility

Tier selection is stored per-plugin-instance on the project. The project file format already carries per-plugin state; this spec adds one field (`tier: DisclosureTier`) per plugin instance, replaces `ProofChamberState.uiLevel` with `tier`, and ships a migration function so legacy project files load without error.

**Acceptance criteria:**

- A project file saved in the previous version (with `uiLevel: 1..5` on Dutch Oven instances and no `tier` on other plugins) loads under the new version with every plugin instance resolved to a defined `DisclosureTier` — Dutch Oven via the migration function, others defaulting to `'play'`.
- Round-trip: save a project with one plugin per module at tier `'route'`; reopen; every plugin instance reads `'route'` back.
- A project save/load integration test covers both Tauri and browser platforms using the existing project-file repositories.

### R10. Module architecture and deps-validate compliance

Each of the five plugin modules retains its existing domain boundary. Shared primitives (tier helpers, meter bridge, gain-match helper) live in a single new module (home location is OQ4) whose root `index.ts` is the only cross-module surface. Existing panel file paths are preserved (additive refactor).

**Acceptance criteria:**

- `pnpm deps:validate` passes with zero violations after all changes.
- No plugin module imports another plugin module's internals (enforced by existing `no-cross-module-internals`).
- The shared primitive module's `index.ts` re-exports only `useCases/`, `events/`, `stores/`, `presentations/views/`. No re-exports from `models/`, `handlers/`, `repositories/`, `engine/`, `services/`.
- Every file in the shared primitive module's `useCases/` and `repositories/` exports exactly one function.
- Existing per-plugin panel files are edited in place; no panel file is deleted or moved.

---

## Constraints

- **No DSP changes.** Every requirement above is satisfied with UI, use-case, and repository-layer code plus the shared metering bridge and shared gain-match helper. If a criterion cannot be met without DSP change, escalate to an open question.
- **Vanilla `Store<T>` per `AGENTS.md`.** Tier state, metering snapshots exposed to React, bypass state, and all plugin parameter state live in Vanilla `Store<T>` instances. No Zustand, Redux, Jotai, or similar.
- **No `useMemo` / `useCallback` / `React.memo`** — React Compiler handles memoization.
- **No `forwardRef`** — `ref` is a regular prop in React 19.
- **TypeScript soundness (`AGENTS.md` § TypeScript — soundness).** Tier type is a string-literal union; no `any`; no assertion-based silencing of errors.
- **Audio thread safety.** Metering writes, bypass gain-match estimation, and any DSP parameter bridge must be allocation-free, lock-free, non-blocking on the audio thread. Verified with `assert_no_alloc`.
- **Module architecture.** Each of the five plugin modules keeps its existing domain boundary: internals remain private; only what is re-exported from its root `index.ts` is accessible cross-module. Any shared primitive (tier helper, meter bridge, gain-match helper) lives in a dedicated shared module and is imported via its root `index.ts` only.
- **No codemods or AST-altering scripts.** Every file edit is manual per `AGENTS.md`.
- **No new dependencies without explicit sign-off.** `@dnd-kit/core` is only added if not already present — check the existing `package.json` first; if a drag-and-drop primitive already exists in `src/components/` or `src/helpers/`, reuse it.

---

## Design decisions

### Decision: Tier names from `factory/fermenter.md` Part 11

**Chosen:** `'play' | 'shape' | 'build' | 'route' | 'lab'`.

**Considered and rejected:**

- Numeric levels (`1 | 2 | 3 | 4 | 5`) — the existing `ProofChamberState.uiLevel` used this. Rejected because numeric ordinals lose semantic meaning on read (nobody knows "what's level 3?") and force a sibling mapping table on every UI site.
- Per-plugin-specific names (e.g. Gluten: Drive / Glue / Pump) — rejected because the research and this spec want cross-plugin consistency. The user learns one mental model; it should transfer.
- Three-tier scheme (Simple / Standard / Advanced) — rejected because it forces either too many controls at "Standard" (making it indistinguishable from Advanced) or too few at "Simple" (making it useless).

### Decision: Single shared tier primitive, not copy-pasted per plugin

**Chosen:** One helper module (`src/modules/PluginUI/` or equivalent shared location — implementer surveys existing locations before picking) exporting `DisclosureTier` type, `isVisibleAtTier()` helper, `useDisclosureTier(instanceId)` hook, and a migration function for the legacy numeric tier. Each plugin module consumes this primitive and assigns its own controls to tiers; it does not define its own tier type.

**Considered and rejected:** Per-plugin tier enums. Rejected because it reintroduces the drift this spec exists to eliminate and fragments the consumer contract (`useDisclosureTier` would be five different hooks).

### Decision: One shared metering bridge, not per-plugin

**Chosen:** A single metering-bridge module exports the SPSC queue type, the producer API (Rust side, compiled into each plugin's DSP node), and the consumer hook (TS side, parameterized by a schema). Every meter component across all five plugins consumes this hook.

**Considered and rejected:**

- Per-plugin metering queues — rejected because they multiply the allocation/lock-discipline review surface by five.
- Polling DSP state via Tauri `invoke` — rejected because it is not RT-safe on the Tauri side and introduces main-thread JS overhead per meter sample.
- `postMessage` from the worklet — rejected because `postMessage` is serialization-heavy and drops under load. The research explicitly cites `SharedArrayBuffer`-based ring buffers as the correct approach.

### Decision: Gain-matched bypass is mandatory

**Chosen:** Every plugin's bypass path runs through the shared EBU R128 compensation helper. This is mandatory, not opt-in.

**Considered and rejected:** Opt-in per plugin. Rejected because "bypass louder than wet" or "bypass quieter than wet" is the single most common reason users misjudge whether a plugin helps. The research flagged this explicitly for Gluten and Proof; generalizing it is cheaper than arguing it plugin-by-plugin.

### Decision: Vanilla `Store<T>` for tier and meter-consumer state

**Chosen:** Tier is a field on each plugin's existing per-instance store state. Meter consumer state (rendered values for React to read) is a separate Vanilla `Store<T>` fed by the ring-buffer consumer on each animation frame.

**Considered and rejected:** React Context for tier state — rejected because tier must persist across panel unmount/remount and across project save/load. Context does not persist; a store does.

### Decision: Reuse existing drag-and-drop primitive if present; only add `@dnd-kit/core` if no primitive exists

**Chosen:** Before adding a dependency for Proof's module reorder and Grinder's pedal-chain reorder, survey `src/components/` and `src/helpers/` for an existing drag-drop primitive (e.g. something built on HTML5 drag events, `react-aria`, or an existing wrapper). Reuse if present. Add `@dnd-kit/core` only if no existing primitive fits.

**Considered and rejected:** Immediately adding `@dnd-kit/core` — rejected because `AGENTS.md` forbids adding packages without explicit instruction, and because this spec must survey prior art (`write-spec` skill rule #3) before introducing a new primitive.

### Decision: Outer/inner tier nesting for Proof

**Chosen:** The Proof outer panel has a single tier selector governing chain-wide visibility (chain overview, translation bar, reference slots, ONNX assistant). Each module card inside the chain also has its own tier selector scoped to that module's controls (e.g. a Proof-EQ card tier selector only affects the EQ's own control visibility). Changing the outer tier sets a default for each inner card but does not override user-set inner tiers.

**Considered and rejected:** Global single tier that collapses both outer and inner. Rejected because users want to see chain-level controls at Play while still diving into a single EQ band at Lab without flipping the whole panel.

### Decision: Named string union, with migration from legacy numeric tier

**Chosen:** `type DisclosureTier = 'play' | 'shape' | 'build' | 'route' | 'lab'`. A pure function `migrateLegacyUILevel(level: 1 | 2 | 3 | 4 | 5 | undefined): DisclosureTier` maps old stored values. `ProofChamberState.uiLevel: 1 | 2 | 3 | 4 | 5` is replaced by `tier: DisclosureTier`.

**Considered and rejected:** Supporting both representations in parallel — rejected because dual representation is exactly the kind of drift this spec exists to eliminate.

### Decision: Naming conflicts are open questions, not silent renames

**Chosen:** Both naming conflicts (Grinder vs drum-machine.md; Dutch Oven vs orchestra.md) are logged as `[CRITICAL]` open questions. This spec keeps the current names pending resolution. Rename must happen via a deliberate product-level decision, not as a drive-by edit inside this spec.

**Considered and rejected:** Renaming one half of each conflict inside this spec. Rejected because (a) product codenames affect marketing, preset compatibility, and URL routes; (b) the codebase already uses both names in production paths.

---

## Acceptance criteria / release gate

The spec is considered shippable when ALL of the following are true:

- [ ] All R1–R10 per-requirement acceptance criteria pass.
- [ ] `pnpm deps:validate` passes with zero violations.
- [ ] `pnpm typecheck` passes.
- [ ] `cargo test --release` passes for `daw-dsp`, `proof-chamber`, and `src-tauri`.
- [ ] Five tier-fixture specs (one per plugin: Gluten, Grinder, Crust, Proof, Dutch Oven) exist under each plugin's `presentations/views/__tests__/` and pass with committed snapshots.
- [ ] One RT-safety test (Rust, `assert_no_alloc`) covers meter writes across all five plugins' DSP nodes.
- [ ] One LUFS-match integration test per plugin asserts ±0.5 LU between wet and bypassed output.
- [ ] One cross-plugin tier-switching regression test asserts that switching any plugin from `'play'` to `'lab'` and back during active processing produces no sample delta > 12 dB (click detector).
- [ ] Legacy `ProofChamberState.uiLevel` migration passes unit-test coverage for all five input values and `undefined`.
- [ ] Open questions OQ1, OQ2, OQ3 are either resolved with a decision recorded in this spec or the corresponding features are disabled behind a feature flag (Proof ONNX assistant) / deferred (Grinder + Dutch Oven rename).
- [ ] Self-review section in the task file is fully answered with pasted command outputs.

---

## Implementation notes

### Ordering and sequencing

- **Start with the shared primitives, not with a plugin.** Land `DisclosureTier`, `useDisclosureTier`, `isVisibleAtTier`, the migration function, and the SPSC metering bridge first. Refactor one plugin (suggest: Dutch Oven, since `ProofChamberState` already has `uiLevel` and the migration is the tightest path) to prove the primitive. Then roll out to Gluten, Crust, Grinder, Proof.
- **Keep the tier selector visually identical across plugins.** One shared component with a five-segment horizontal toggle. This is how users learn the system — if it drifts in shape or position per plugin, the consistency promise fails.
- **Per-plugin tier fixtures are the source of truth.** Before moving a control between tiers, update the fixture snapshot with an accompanying note; do not let the spec and the snapshot drift.
- **The gain-match helper lives next to the metering bridge.** It needs LUFS estimation of both the input (pre-DSP) and the output (post-DSP) streams, which the metering bridge already touches. Folding them into one module avoids duplicate loudness estimators.
- **Do not delete the existing per-plugin panel files.** The refactor is additive — each panel keeps its file path and test file path; what changes is that each panel imports the shared tier hook and gates its control render on tier. This keeps the diff reviewable.

### Per-plugin guidance

- **Gluten:** `GlutenPanel.tsx` currently renders most controls at once. Introduce a top-right tier selector, group existing controls into `<TierSection tier="shape">…</TierSection>` wrappers, gate each group by the tier hook. Test IDs for every control are already present in the fixture spec; extend the fixture to enumerate by tier.
- **Grinder:** Build the fallback (radio-button mic positions) first and make sure the feature works without WebGPU, then layer the 3D view on top. Mirror the `piano-plugin.md` approach for WebGPU views.
- **Crust:** Currently uses `CrustControlZone` for layout; wrap the zone contents in tier sections. The ISP detection and oversampling controls currently live in the header — move them to Build tier.
- **Proof:** Implement outer and inner tiers as two separate `DisclosureTier` values in the Proof store (one chain-level field, one per-module field); do not overload a single tier. The ONNX assistant is an additive side-panel at Lab tier — keep it in a separate subcomponent so it can be feature-flagged off cleanly.
- **Dutch Oven:** Do the migration first. The numeric `uiLevel` field on `ProofChamberState` is the baseline the new `DisclosureTier` type replaces; write the migration function before changing the type so project-file compatibility is preserved.

### Shared primitive shape (indicative)

```ts
export type DisclosureTier = 'play' | 'shape' | 'build' | 'route' | 'lab';

export const TIER_ORDER: readonly DisclosureTier[] = [
    'play',
    'shape',
    'build',
    'route',
    'lab',
] as const;

export function isVisibleAtTier(controlTier: DisclosureTier, currentTier: DisclosureTier): boolean {
    return TIER_ORDER.indexOf(controlTier) <= TIER_ORDER.indexOf(currentTier);
}

export function migrateLegacyUILevel(level: unknown): DisclosureTier {
    if (level === 1) {
        return 'play';
    }
    if (level === 2) {
        return 'shape';
    }
    if (level === 3) {
        return 'build';
    }
    if (level === 4) {
        return 'route';
    }
    if (level === 5) {
        return 'lab';
    }
    return 'play';
}
```

### Metering bridge consumer shape (indicative)

```ts
export type MeterFrame =
    | { kind: 'gain-reduction'; grDb: number; inputDb: number; outputDb: number }
    | { kind: 'levels'; inputDb: number; outputDb: number; lufsS: number }
    | { kind: 'isp-peaks'; peakDbtp: number; occurrences: number }
    | { kind: 'spectrum'; bins: Float32Array; smoothing: number }
    | { kind: 'history'; sample: number };
```

The TS consumer hook is parameterized by `frameType` so callers ask for exactly the frame shape they need; the bridge handles the SPSC drain inside a `requestAnimationFrame` loop and feeds a `Store<MeterFrame | null>`.

---

## Test plan

### Unit tests (shared primitives)

- [ ] `isVisibleAtTier` — covers all 25 `(controlTier, currentTier)` pairs. Asserts monotonic visibility (a control visible at tier N is visible at every tier ≥ N).
- [ ] `migrateLegacyUILevel` — inputs `1`, `2`, `3`, `4`, `5`, `0`, `6`, `undefined`, `null`, `'3'`, `{}`, `NaN`; all produce a defined `DisclosureTier`. Invalid inputs default to `'play'`.
- [ ] Tier persistence round-trip — set tier, serialize store, re-hydrate, read back; assert identity for all five tier values.
- [ ] SPSC queue drop-oldest — fill the queue, pause consumer, overflow by 1.5×, resume consumer; asserts the drained items are the newest 1.0× of the input.
- [ ] SPSC queue non-blocking — timed test: under a paused consumer, every `push` returns within 100 µs.
- [ ] EBU R128 compensation math — input/output LUFS estimators produce the expected compensation for synthetic test signals (pure-sine at known RMS, pink noise at known LUFS).
- [ ] EBU R128 clamp — extreme input/output ratios produce a clamped compensation (±24 dB); no NaN or Infinity escapes.

### Per-plugin tier-fixture tests

Every test lives at `src/modules/<Plugin>/presentations/views/__tests__/<Panel>.tiers.spec.tsx` and follows the same shape:

1. Render the panel at each of the five tiers.
2. Collect every `data-testid` that is currently in the DOM.
3. Compare against a committed snapshot listing the expected testids per tier.
4. Assert monotonic accumulation: `testids(shape) ⊇ testids(play)`, etc.

- [ ] `GlutenPanel.tiers.spec.tsx` — covers R4 tier assignments.
- [ ] `GrinderPanel.tiers.spec.tsx` — covers R5 tier assignments. Also covers the WebGPU-unavailable fallback rendering.
- [ ] `CrustPanel.tiers.spec.tsx` — covers R6 tier assignments.
- [ ] `ProofPanel.tiers.spec.tsx` — covers R7 outer-tier assignments. A second fixture inside the same file covers inner-module tier behavior by rendering a single Proof-EQ card at each inner tier.
- [ ] `ProofChamberPanel.tiers.spec.tsx` — covers R8 tier assignments.

### Cross-cutting integration tests

- [ ] **RT-safety (Rust)** — a single `assert_no_alloc`-guarded stress test that drives 60 s of combined meter-write load across all five plugins' DSP nodes; must not panic. Located under `crates/daw-dsp/src/**/__tests__/` or the equivalent per-crate test layout.
- [ ] **LUFS bypass match (per plugin, five tests)** — pink-noise drive, EBU R128 Short-Term on wet vs bypass, |delta| ≤ 0.5 LU after 10 s warm-up.
- [ ] **Cross-plugin tier-switching regression** — automated switch of `'play' → 'shape' → 'build' → 'route' → 'lab' → 'play'` on each plugin during active processing; click detector asserts no sample delta > 12 dB.
- [ ] **Migration coverage (integration)** — loads a project file with the legacy `uiLevel` as a saved fixture; reads `tier` after migration; asserts correct mapping per the unit test.

### Proof-specific integration

- [ ] Proof reorder — drag-reorder of modules updates DSP within one processing block; audible null test verifies the reorder reached the engine.
- [ ] Proof translation curves — each of Car / Phone / Mono / Headphones / NS-10 / Club produces an output loudness-matched to the non-simulated monitor within ±0.5 LU.
- [ ] Proof reference tracks (A/B/C) — three loaded reference tracks play back at loudness matched to the master within ±0.5 LU; switching between master and reference produces no click.
- [ ] Proof ONNX assistant (conditional on OQ3) — either (a) the "Suggest" button returns a suggested chain within 2 seconds and renders the suggested module order + parameter deltas, or (b) the feature-flag-off path renders the "Mastering assistant unavailable" placeholder without error.

### Grinder-specific integration

- [ ] Grinder WebGPU fallback — run the fixture test in a test environment with WebGPU unavailable; panel renders without crash and the radio-button mic placement works.
- [ ] Grinder pedal reorder — drag reorder updates DSP audibly; `assert_no_alloc` covers the update path.
- [ ] Grinder NAM load — NAM model loading is covered by a test that loads a bundled test NAM file and asserts the DSP chain reflects the loaded model on the next processing block, with no `assert_no_alloc` violation during the load.

### Manual

- [ ] Manual 10-minute free-play per plugin — two developers play each plugin at each tier for two minutes and record any audible glitch, tier drift, or meter stall. Findings recorded in the task file.
- [ ] Manual A/B bypass audit — for each plugin, listen to the bypass toggle on three genres of source material (drums, vocals, full mix); note any perceived loudness jump. Any clear jump is a bug, not a tolerance question.

---

## Open questions

- [ ] **[CRITICAL] OQ1 — "Grinder" name collision with `factory/drum-machine.md`.** The drum-machine spec uses "Grinder" as the codename for a future flagship drum machine; the amp simulator in `crates/daw-dsp/src/grinder/` already uses it in production. One must change. Options: (a) rename the drum machine (spec is not yet implemented), (b) rename the amp simulator (breaks existing module paths, store keys, preset file references, and panel URL routes), (c) scope the name ("Grinder Amp" vs "Grinder Drums") and live with the ambiguity. Recommend (a) — rename the unimplemented product — but product owner must confirm. Block any user-visible rename on this decision. (Spec keeps "Grinder" = amp sim pending resolution.)
- [ ] **[CRITICAL] OQ2 — "Dutch Oven" name collision with `factory/orchestra.md`.** The orchestral suite spec uses "Dutch Oven" as its codename; the reverb in `crates/proof-chamber/` is already labelled "Dutch Oven" in `ProofChamberPanel`. Same resolution pattern as OQ1. Recommend renaming the orchestral product (unimplemented) and keeping "Dutch Oven" = reverb; confirm with product owner. Block any rename on this decision.
- [ ] **[MAJOR] OQ3 — ONNX mastering-assistant model choice & license.** R7 requires either a working mastering assistant or an explicit feature-flagged "unavailable" state. To ship the working state, the implementer needs: (a) a chosen ONNX model (genre classifier + settings suggester), (b) its license (must be permissive — MIT/Apache/CC0/CC-BY — not NC), (c) confirmed inference-time budget on reference hardware, (d) a suggested-chain schema the UI can render. No candidate is currently committed. If no model is confirmed before implementation, ship with the feature-flagged "unavailable" placeholder and treat the assistant as a follow-up.
- [ ] **[MAJOR] OQ4 — Shared-primitive home location.** Where do the shared tier / metering / gain-match helpers live? Options: (a) a new `src/modules/PluginUI/` module with its own `index.ts`; (b) split across `src/helpers/` (for pure functions) and a new `src/infra/metering/` (for the ring buffer); (c) add them to an existing module like `Plugin`. Implementer must survey before deciding (`write-spec` rule 3). Recommend (a): one new module dedicated to plugin-UI shared primitives. Confirm before creating.
- [ ] **[MAJOR] OQ5 — Drag-and-drop primitive.** Is there an existing drag-drop primitive in `src/components/` or `src/helpers/`? If yes, reuse it for Proof module reorder and Grinder pedal-chain reorder. If no, is adding `@dnd-kit/core` approved? Block pedal-chain and module-chain reorder implementation on this check.
- [ ] **[MAJOR] OQ6 — Analysis features for Proof Lab tier.** R7's Lab tier lists spectral centroid, spectral flatness, bass/mid/high energy ratios, tonal balance deviation, LRA, PLR, stereo correlation. Confirm which of these the DSP already emits (likely LRA, PLR, stereo correlation via existing limiter/metering) versus which require new DSP (likely spectral flatness, tonal balance deviation). For the ones that require new DSP, the scope is out of this spec (non-goal: no DSP changes) — they must be cut from Lab until a follow-up DSP spec lands. Implementer audits `crates/daw-dsp/src/proof/` exports before freezing the Lab control set.
- [ ] **[MINOR] OQ7 — Translation-curve impulse responses source.** The Car / Phone / Mono / Headphones / NS-10 / Club simulations need IRs or IIR approximations. Options: (a) permissively-licensed open IR pack, (b) measured in-house, (c) analytical IIR approximations. Recommend (c) for v1 (small, no asset download, easy to license) with a follow-up to upgrade to measured IRs. Confirm with audio-engineering owner.
- [ ] **[MINOR] OQ8 — Tier persistence serialization version.** When the migration function runs, it needs a project-file schema version bump. Align with the existing project-file versioning scheme (there is an existing migration system; use it — do not invent a new one). Confirm the exact version field and migration-registration path before landing the tier rename.
- [ ] **[MINOR] OQ9 — Preset compatibility for tier rename.** If any preset files persist `uiLevel` as a number, they must migrate too. Confirm no preset files store tier (tier is per-instance UI state, not preset state — if this holds, there is no preset migration to do). Verify before landing R1.

---

## Tradeoffs and risks

- **Consistency tax.** Forcing one tier vocabulary across five plugins means some plugin-specific controls land in a tier that is slightly awkward (e.g. Crust's "Release" is arguably an essential control and could have been Play tier, not Shape tier). Cost: a few controls feel misplaced until users learn the system. Mitigation: the tier-fixture snapshots make drift visible; if a control placement is clearly wrong, a deliberate spec update moves it — but not drift by drift.
- **Shared metering bridge regression risk.** One bug in the SPSC queue affects all five plugins' meters. Cost: a single PR could knock out every meter. Mitigation: the shared RT-safety test wraps all five meter hot paths in `assert_no_alloc`; the shared queue has unit tests for drop-oldest, overflow, and consumer-stall.
- **Gain-matched bypass changes perceived plugin behavior.** Users who have internalized "Gluten makes things louder" now see it at matched loudness and may think "the plugin does nothing." Cost: documentation burden and support-channel noise. Mitigation: the A/B indicator is visible; the LUFS delta is displayed as a readout so the user sees the matched state is deliberate.
- **WebGPU mic room (Grinder) is high-risk.** Cost: mic room ships broken or not at all. Mitigation: the fallback (radio-button mic positions) is the v1 minimum and is verified independently — mic room is a visual upgrade layered on top.
- **ONNX mastering-assistant scope.** Cost: Proof ships with the assistant placeholder and users expect a working assistant. Mitigation: OQ3 is resolved before implementation by either confirming a model or explicitly feature-flagging the assistant off; the placeholder is honest ("Mastering assistant unavailable — coming in a later release").
- **Naming conflicts.** Cost: presets, routes, docs, and marketing diverge between product lines. Mitigation: OQ1 and OQ2 are blocked on a product-level rename decision; this spec is explicit that a rename is not a drive-by change.
- **Two plugins currently modeled differently (Dutch Oven vs the others).** Dutch Oven lives under `src/modules/Plugin/` with its panel at `Plugin/presentations/views/ProofChamberPanel.tsx`, whereas Gluten/Grinder/Crust/Proof live in their own modules. Refactoring Dutch Oven into its own module is out of scope for this spec; the tier migration targets its current location. If a later architectural spec relocates the reverb, the tier plumbing moves with it.
- **Scope creep.** Adding new analysis features, new translation curves, a preset marketplace, or telemetry is seductive. Cost: never shipping. Mitigation: they are in Non-goals; reopening requires an explicit spec revision.
