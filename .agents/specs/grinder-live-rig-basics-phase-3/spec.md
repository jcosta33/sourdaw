---
type: spec
id: SPEC-grinder-live-rig-basics-phase-3
title: Grinder live rig basics — phase 3 (truthful pedal order and snapshot recall)
status: done
owner: The Sourdaw team
sources:
  - ../grinder-stabilization-phase-1/audit.md
  - ../grinder-modular-rig-graph/spec.md
---

# Grinder live rig basics — phase 3 (truthful pedal order and snapshot recall)

## Intent

Give Grinder two musician-useful live-rig improvements without committing to a full
modular graph: the current front-end pedal chain order becomes truthful and audible,
and stored snapshots become recallable rig scenes rather than dead patch metadata.

## Non-goals

- Full modular graph editing.
- Parallel lanes, split/merge routing, or dual-amp graph work.
- Snapshot authoring UX beyond recalling snapshots already stored in a patch.
- Reworking the cabinet, neural model browser, or broader high-gain DSP stages.
- Arbitrary pedal duplication or pedal families beyond the current supported set.

## Requirements

### AC-001 — Pedal order is truthful

The order of supported `prePedals` in the patch must be the order used by the live DSP
path, for `compressor`, `overdrive`, `distortion`, and `fuzz`.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-002 — Snapshot recall is real

When a patch contains snapshots, switching snapshots must update the live patch and
audio path according to the snapshot's `paramOverrides` and `bypassStates`.

Verify with: `pnpm test:run -- grinderStore`

### AC-003 — Snapshot switching uses a stable base rig

Snapshot recall must apply against a stable base patch and must not mutate state
cumulatively such that values from one snapshot leak into another. The stable base
patch must live in Grinder store state and must not be added to the serialized
`GrinderPatch` contract.

Verify with: `pnpm test:run -- grinderStore`

### AC-004 — Pedal reorder is user-controllable

Grinder must expose a direct UI affordance to move supported front-end pedals earlier
or later in the chain, with the active order visible in the Drive section.

Verify with: `pnpm test:run -- GrinderPanel`

### AC-005 — Active snapshot is persisted

When a snapshot is recalled, Grinder must persist its index in `activeSnapshot`.

Verify with: `pnpm test:run -- grinderStore`

### AC-006 — Unsupported pedal types remain safe

Any unsupported pedal types still present in patch data must not crash Grinder or
corrupt the supported chain order.

Verify with: `pnpm test:run -- grinderStore`

### AC-007 — Active snapshot is visible

The currently active snapshot must be visibly indicated in the Grinder UI, not only
persisted in `activeSnapshot`.

Verify with: `pnpm test:run -- GrinderPanel`

### AC-008 — Pedal order rebuilds, not re-derived per sample

The Rust engine must rebuild its pedal execution order when an order parameter
changes, not recompute it per sample on the audio thread.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

## Constraints

- Keep real-time safety: no dynamic graph traversal, locking, or blocking on the
  audio thread.
- Use existing Grinder stores, use cases, and bridge patterns rather than inventing
  an unrelated state path.
- Keep UI changes incremental and aligned with the current Grinder visual language.

## Open questions

- [ ] (non-blocking) Should this phase also make `postPedals` order real, or keep the
  first slice front-end only? Does not block: front-end ordering delivers the value.
- [ ] (non-blocking) Should the snapshot UI live in Browse/home only, or also in
  Drive/Lab for live switching?

## Affected areas

- `src/modules/Grinder/stores/grinderStore.ts`
- `src/modules/Grinder/useCases/grinderParamBridge/syncGrinderPatchToAudio.ts`
- `src/modules/Grinder/useCases/grinderParamBridge/moveGrinderPedalInChainWithAudio.ts`
- `src/modules/Grinder/useCases/recallGrinderSnapshotWithAudio.ts`
- `src/modules/Grinder/presentations/views/GrinderPanel.tsx`
- `crates/daw-dsp/src/grinder/engine.rs`

## Dropped from sources

- The full Guitar Rig style modular graph — deferred to `../grinder-modular-rig-graph/spec.md`;
  too large for the next practical step.
- Snapshot creation/editing UX — deferred; recall alone unlocks value at far lower risk.
- `postPedals` reordering — left front-end only this phase to avoid overcommitting to the
  graph contract.
