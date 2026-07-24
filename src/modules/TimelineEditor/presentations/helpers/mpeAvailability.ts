import { getNoteExpressionDeviceTypes } from '#/modules/AudioEngine/useCases';

/**
 * MPE per-note expression availability (audit MD-2 — honest surface).
 *
 * The editor captures per-note MPE expression — Pitch Bend, Pressure (channel
 * pressure) and Slide (CC74). Whether those values are *sounded* depends on the
 * track's instrument, so availability is derived from the engine's note-
 * expression registry rather than restated here: a device gaining or losing a
 * per-note expression path moves this surface with it, and the editor can never
 * claim a capability the engine does not have.
 *
 * As of the MD-2 engine lane, Fermenter and Levain sound per-note expression.
 * Grand Boule and Toaster do not — see `getNoteExpressionDeviceTypes`.
 */

/** Device types whose engine sounds per-note expression. Derived, never hand-listed. */
export const MPE_EXPRESSION_DEVICE_TYPES: readonly string[] = getNoteExpressionDeviceTypes();

/**
 * True when at least one shipping instrument sounds per-note expression, i.e.
 * the lanes are worth offering at all. Per-track truth is
 * {@link isMpeExpressionAvailableForDeviceTypes}.
 */
export const MPE_EXPRESSION_AVAILABLE: boolean = MPE_EXPRESSION_DEVICE_TYPES.length > 0;

/** True when one of a track's devices sounds per-note expression. */
export function isMpeExpressionAvailableForDeviceTypes(deviceTypes: readonly string[]): boolean {
    return deviceTypes.some((deviceType) => MPE_EXPRESSION_DEVICE_TYPES.includes(deviceType));
}

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
