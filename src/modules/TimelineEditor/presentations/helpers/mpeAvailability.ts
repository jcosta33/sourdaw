import { getNoteExpressionDimensions } from '#/modules/AudioEngine/useCases';

/**
 * MPE per-note expression availability (audit MD-2 — honest surface).
 *
 * The editor captures per-note MPE expression — Pitch Bend, Pressure (channel
 * pressure) and Slide (CC74). Whether a given dimension is *sounded* depends on
 * the track's instrument, so availability is derived from the engine's
 * note-expression registry rather than restated here: a device gaining or
 * losing a dimension moves this surface with it, and the editor can never claim
 * a capability the engine does not have.
 *
 * As of the MD-2 engine lane: Fermenter and Levain sound all three dimensions;
 * Grand Boule sounds pitch bend only (a struck string has no continuous
 * pressure or timbre response); Toaster and the drum kits sound none.
 */

/** Expression-lane identifiers that carry MPE per-note expression. */
export const MPE_EXPRESSION_LANES = ['pressure', 'slide', 'pitchBend'] as const;

export type MpeExpressionLane = (typeof MPE_EXPRESSION_LANES)[number];

/** True when `lane` is an MPE expression lane gated behind availability. */
export function isMpeExpressionLane(lane: string): boolean {
    return (MPE_EXPRESSION_LANES as readonly string[]).includes(lane);
}

/**
 * The MPE lanes worth offering for a track, given its devices. Lane ids match
 * the note-data field names, which are also the engine registry's dimension
 * names, so no mapping table can drift between them.
 */
export function getMpeExpressionLanesForDeviceTypes(deviceTypes: readonly string[]): MpeExpressionLane[] {
    const sounded = new Set<string>();
    for (const deviceType of deviceTypes) {
        for (const dimension of getNoteExpressionDimensions(deviceType)) {
            sounded.add(dimension);
        }
    }
    return MPE_EXPRESSION_LANES.filter((lane) => sounded.has(lane));
}

/** True when the given lane is sounded by one of the track's devices. */
export function isMpeLaneAvailableForDeviceTypes(lane: string, deviceTypes: readonly string[]): boolean {
    if (!isMpeExpressionLane(lane)) {
        return true;
    }
    return getMpeExpressionLanesForDeviceTypes(deviceTypes).includes(lane as MpeExpressionLane);
}
