/**
 * Offline automation ordinals for the ProofChamber reverb ("Dutch Oven"). The
 * scheduled path bypasses the WASM string bridge: the worklet posts
 * `{paramId, segments}` and the `proof-chamber` crate dispatches on the ordinal,
 * so ordinal agreement is the whole contract and no compiler checks it.
 *
 * ## Why this lives in `models/` and not next to `ProofChamberNode`
 *
 * Two layers need the table and they may not import each other: `engine/` builds
 * the `paramAutomation` message, and `services/proofChamberProcessor.ts` —
 * AudioWorklet code, which `services-must-stay-pure` forbids from importing
 * `engine/` — must reject any ordinal the crate would ignore. `models/` is the
 * one layer both may read, so the worklet's guard can be *derived* from this
 * table. That guard used to be a bare `paramId > 1` with no named constant at
 * all: a third parameter added here would have been dropped silently, the same
 * failure Fermenter's `oscWaveform` shipped with. `ProofChamberNode` re-exports
 * the table, so existing consumers keep their import path.
 *
 * The table is a `Record`, so nothing about its shape forces the ordinals to be
 * dense `0..n-1`; consumers must not assume a key count is the ordinal bound.
 * The worklet guards on membership in the declared ordinal set instead, which is
 * correct whether or not a hole is ever introduced.
 */
export const PROOF_CHAMBER_AUTOMATION_PARAM_IDS: Readonly<Record<string, number>> = {
    mix: 0,
    decay: 1,
    damping: 2,
    predelay: 3,
    size: 4,
    mod_rate: 5,
    mod_depth: 6,
    diffusion: 7,
    high_cut: 8,
    low_cut: 9,
    width: 10,
    freeze: 11,
    shimmer: 12,
    shimmer_amount: 13,
    gravity: 14,
    early_late: 15,
    density: 16,
    decay_eq_0: 17,
    decay_eq_1: 18,
    decay_eq_2: 19,
    decay_eq_3: 20,
    decay_eq_4: 21,
    decay_eq_5: 22,
};
