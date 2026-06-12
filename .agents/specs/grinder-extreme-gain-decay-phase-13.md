# Grinder Extreme Gain Decay Phase 13

## Context

Phases 10 through 12 made Grinder more truthful:

- later-stage controls are less fake
- named amp/power-tube families are more distinct
- `inputMode` now affects live conditioning

The remaining problem is mostly tone quality at extreme gain. The user-level complaint is still that Grinder can sound brittle, fizzy, or weird when the later amp stages do most of the work. The most practical bounded slice is to improve how the high-gain later stages behave after the initial attack.

## Goal

Reduce brittle, edge-heavy decay behavior in the later amp stages under extreme-gain material without flattening the initial pick attack or collapsing the existing family-ordering regressions.

## User-visible behavior

Under high-gain palm-muted or burst material:

- the initial attack should still bite
- the later decay should smooth out instead of hanging onto harsh edge energy
- rectifier/high-gain families should keep their denser feel without turning into fizzy tails

## Scope

**In scope:**

- bounded later-stage retuning in `crates/daw-dsp/src/grinder/triode.rs`
- bounded later-stage retuning in `crates/daw-dsp/src/grinder/power_amp.rs`
- regressions for decay smoothing / edge-to-body behavior under high gain
- audit/task updates

**Out of scope:**

- Neural expansion
- UI redesign
- new patch fields
- full circuit-solver rewrite
- arbitrary modular routing work

## Requirements

1. **Extreme-gain decay smooths after the initial attack**
   High-gain later-stage output should retain less edge-heavy content in the later tail than during the earlier sustain window.

2. **Attack stays intact**
   The smoothing pass must not simply dull the whole amp. The early attack must remain materially stronger/brighter than the later tail.

3. **Existing family ordering survives**
   Rectifier vs Lead JCM and 6L6 vs EL84 regressions must remain green.

4. **Behavior stays bounded**
   The pass must read like later-stage damping/recovery, not a big obvious static low-pass glued onto the output.

5. **RT safety is preserved**
   No allocation or locking in sample processing.

## Constraints

- Reuse existing later-stage structs and state.
- Keep any new state preallocated.
- Favor dynamic damping/recovery behavior over blunt static EQ cuts.

## Acceptance criteria

- [x] A DSP test proves extreme-gain preamp decay becomes less edge-heavy after the attack.
- [x] A DSP test proves extreme-gain power-stage decay becomes less edge-heavy after the attack.
- [x] Existing later-stage family-ordering regressions continue to pass.
- [x] `cargo test -p daw-dsp grinder::` passes.
- [x] `pnpm test:run src/modules/Grinder` passes.
- [x] `pnpm typecheck` passes.

## Test plan

- [x] Add a failing DSP regression for high-gain preamp decay edge-vs-tail behavior.
- [x] Add a failing DSP regression for high-gain power-stage decay edge-vs-tail behavior.
- [x] Re-run the later-stage and family-ordering regressions.
- [x] Run full Grinder DSP tests.
- [x] Run Grinder UI tests.

## Open questions

- None.

## Tradeoffs and risks

- Too much damping will erase pick definition and make the amp feel dead.
- Too little damping will technically change the DSP while leaving the user-facing fizz problem basically intact.
