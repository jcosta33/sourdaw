/**
 * The value each Levain expression controller stands at on an instrument no controller has
 * moved: the one a stored-controller restore returns a controller to when no row of the clip
 * is in force at a relocation. A mirror of `ExpressionState::new` in
 * `crates/daw-dsp/src/levain/expression.rs`, the engine's own source of truth, and pinned to it
 * by a spec. The sustain pedal (CC64) is not here: a pedal's default is up, which the lift gives.
 */
export const LEVAIN_CONTROLLER_DEFAULTS: ReadonlyMap<number, number> = new Map([
    [1, 64],
    [2, 0],
    [7, 100],
    [11, 127],
]);
