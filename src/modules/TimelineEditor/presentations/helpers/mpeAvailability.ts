/**
 * MPE per-note expression availability (audit MD-2 — honest surface).
 *
 * The editor can capture per-note MPE expression — Pitch Bend, Pressure
 * (channel pressure) and Slide (CC74) — but no shipping instrument currently
 * sounds it: those values are stored on note data yet never reach any live or
 * scheduled synth voice. Surfacing the controls therefore claims a capability
 * the engine does not provide. Until the per-note expression engine path lands
 * (Wave 4, WS-3), the MPE expression lanes are hidden while the underlying
 * state model, use cases and stores are left fully intact.
 *
 * Wave 4 reversal: flip this to `true` once per-note expression reaches the
 * instrument voices — that alone re-surfaces every MPE lane. One-line change.
 */
// Typed `boolean` (not the literal `false`) so consumers gate on a flag that is
// meant to flip, not a value narrowed to a constant.
export const MPE_EXPRESSION_AVAILABLE: boolean = false;

/**
 * Expression-lane identifiers that carry MPE per-note expression and are gated
 * by {@link MPE_EXPRESSION_AVAILABLE}. Velocity and probability are not MPE and
 * are never gated.
 */
export const MPE_EXPRESSION_LANES = ['pressure', 'slide', 'pitchBend'] as const;

/** True when `lane` is an MPE expression lane gated behind availability. */
export function isMpeExpressionLane(lane: string): boolean {
    return (MPE_EXPRESSION_LANES as readonly string[]).includes(lane);
}
