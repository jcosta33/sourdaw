# Grinder Live Rig Basics Phase 3

## Context

Grinder has moved past its worst control-truth and overdrive/gate issues, but it still falls short of even a modest live-rig workflow.

Current grounded problems:

- The patch model already stores `prePedals` and `postPedals` as arrays, but the bridge and DSP flatten them back into a fixed order (`compressor -> overdrive -> distortion -> fuzz`) regardless of array order.
- The patch model already stores `snapshots` and `activeSnapshot`, but the UI and store do not expose real snapshot recall behavior.
- The broader "full Guitar Rig style graph" spec at `.agents/specs/grinder-modular-rig-graph.md` is intentionally larger than what should be built next.

This phase is the practical middle step: make the current rig more live-usable without committing to a full modular graph.

## Goal

Grinder gains two real, musician-useful workflow improvements: the current pedal chain order becomes truthful and audible, and stored snapshots become recallable rig scenes rather than dead patch metadata.

## User-visible behavior

In the Drive section, the user can change the order of the currently supported front-end pedals and hear that order change in the actual signal path. On the main Grinder view, if the rig includes snapshots, the user can switch between them and the rig recalls the intended gain/bypass scene immediately without stale values leaking from the previous scene.

## Scope

**In scope:**

- Make the existing `prePedals` array order real in the DSP path for the currently supported pedal types.
- Expose a simple pedal-chain ordering UI for the current front-end pedal deck.
- Add a real snapshot recall flow using the existing `snapshots` and `activeSnapshot` fields.
- Store a `basePatch`-style truth in Grinder state so snapshot recall can reapply scenes consistently.
- Add tests for chain ordering and snapshot recall behavior.

**Non-goals (explicitly out of scope):**

- Full modular graph editing.
- Parallel lanes, split/merge routing, or dual-amp graph work.
- Snapshot authoring UX beyond what is required for recalling the snapshots already stored in a patch.
- Reworking the cabinet, neural model browser, or broader high-gain DSP stages.
- Arbitrary pedal duplication or support for additional pedal families beyond the current supported set.

## Requirements

1. **Pedal order is truthful**
   The order of supported `prePedals` in the patch must be the order used by the live DSP path.

2. **Pedal reorder is user-controllable**
   Grinder must expose a direct UI affordance to move the current supported front-end pedals earlier or later in the chain.

3. **Unsupported pedal types remain safe**
   Any unsupported pedal types still present in patch data must not crash Grinder or corrupt the supported chain order.

4. **Snapshot recall is real**
   If a patch contains snapshots, switching snapshots must update the live patch and audio path according to the snapshot's `paramOverrides` and `bypassStates`.

5. **Snapshot switching uses a stable base rig**
   Snapshot recall must apply against a stable base patch, not mutate state cumulatively such that values from one snapshot leak into another.

6. **Active snapshot is visible and stored**
   Grinder must persist the currently recalled snapshot index in `activeSnapshot`.

7. **Regression coverage exists**
   Tests must prove both chain ordering and snapshot recall semantics directly.

## Constraints

- Stay within the current Grinder patch model rather than introducing a full rig graph in this phase.
- Keep real-time safety: no dynamic graph traversal, locking, or blocking on the audio thread.
- Use existing Grinder stores/use cases/bridge patterns rather than inventing an unrelated state path.
- Keep UI changes incremental and aligned with the current Grinder visual language.

## Design decisions

### Decision: make the existing array order real instead of adding a graph now

**Chosen:** use `prePedals` array order as the source of truth for the currently supported front-end chain.

**Rejected:**

- Starting the full modular graph now.
  Rejected because it is too large for the next practical step.
- Keeping DSP fixed-order while only reordering cards in the UI.
  Rejected because it would be a lie.

### Decision: store a base patch in Grinder state for snapshot recall

**Chosen:** extend Grinder state so snapshot recall applies against a stable base rig rather than the currently recalled snapshot result.

**Rejected:**

- Applying snapshot overrides on top of the current patch only.
  Rejected because switching snapshots would leave stale values behind whenever the next snapshot does not override the same field set.

### Decision: recall existing snapshots before building snapshot authoring

**Chosen:** make stored snapshots meaningful now, defer full scene authoring UX.

**Rejected:**

- Designing snapshot creation/editing UI in the same phase.
  Rejected because recall alone already unlocks value and is much lower risk.

## Acceptance criteria

- [ ] A store-level test proves reordering supported pre-pedals updates patch order deterministically.
- [ ] A DSP-level Grinder test proves changing supported pedal order changes the rendered signal path.
- [ ] A store-level test proves snapshot recall applies against a stable base patch rather than cumulatively against the previously recalled snapshot.
- [ ] A Grinder panel test proves the active pedal chain order is visible in the Drive section.
- [ ] A Grinder panel or store test proves snapshot selection updates `activeSnapshot`.
- [ ] Existing Grinder tests continue to pass.
- [ ] Targeted `cargo test -p daw-dsp grinder::` passes.

## Implementation notes

- Restrict the real chain ordering to the currently supported front-end types:
    - `compressor`
    - `overdrive`
    - `distortion`
    - `fuzz`
- The bridge can transmit explicit order indices for these supported pedals rather than introducing a graph payload in this phase.
- The Rust engine should rebuild its pedal execution order when an order parameter changes, not per sample.
- `basePatch` belongs in Grinder store state, not in the serialized `GrinderPatch` contract.
- Snapshot recall should preserve the snapshot list itself while updating the live patch fields and pedal bypass states.

## Test plan

- [ ] Add Grinder store tests for pedal reorder and snapshot recall semantics.
- [ ] Add Grinder panel tests for chain order display and snapshot UI behavior.
- [ ] Add Grinder DSP tests for order-dependent signal changes.
- [ ] Run targeted Grinder Vitest files.
- [ ] Run targeted Grinder DSP tests.

## Open questions

- [ ] **[MINOR]** Should this phase also make `postPedals` order real, or keep the first slice front-end only?
- [ ] **[MINOR]** Should the snapshot UI live in the Browse/home section only, or also appear in Drive/Lab for live switching?

## Tradeoffs and risks

- This phase improves live rig usefulness without solving the larger routing architecture.
- Adding `basePatch` to Grinder state introduces more internal truth, but it is the minimum needed for reliable scene recall.
- Front-end-only pedal ordering is intentionally limited; it buys honesty and musical control now without overcommitting to the full graph spec.
