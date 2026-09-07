/**
 * What `retire_native_engine` found in the engine slot, and did about it.
 *
 * Hand-mirrored from `RetireOutcome` in
 * `crates/sourdaw-native/src/commands/engine_lifecycle.rs`; the Rust side
 * serializes kebab-case, so these tokens are the wire values verbatim.
 */
export type RetireNativeEngineOutcome =
    /** The slot held a stalled engine and is empty now. */
    | 'retired'
    /** The slot was already empty; the next graph batch boots one anyway. */
    | 'no-engine'
    /** The engine is still rendering, so its slot was left alone. */
    | 'rendering';

const outcomes: readonly RetireNativeEngineOutcome[] = ['retired', 'no-engine', 'rendering'];

export function isRetireNativeEngineOutcome(value: unknown): value is RetireNativeEngineOutcome {
    return typeof value === 'string' && outcomes.includes(value as RetireNativeEngineOutcome);
}

/**
 * What `retireNativeEngine` resolves with: the outcome, and the UI instance
 * ids of every engine-owned plugin record the retire drained.
 *
 * A drained record has no dormant counterpart to re-attach from (see
 * `crates/sourdaw-native/src/commands/engine_lifecycle.rs`), so
 * `retiredInstanceIds` is how the caller learns which plugins it must reload
 * itself. Always empty unless `outcome` is `'retired'`.
 */
export type RetireNativeEngineResult = {
    readonly outcome: RetireNativeEngineOutcome;
    readonly retiredInstanceIds: readonly string[];
};
