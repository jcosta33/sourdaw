import { fromLevainDeviceState } from '../models/LevainDeviceState';
import { getArticulationId } from '../models/LevainPatch';

export type ProjectLevainDeviceStateToNativePatchInput = {
    /** Project snapshot state; only this module may decode it. */
    deviceState: unknown;
};

/**
 * A Levain device's articulation choice as the numeric record its native body
 * applies to the chain (#3124).
 *
 * Articulation identity does not live in `parameterValues` at all. It is a
 * string, and `persistDevicePatch` drops strings, so the choice rides
 * `Device.deviceState` instead (`LevainDeviceState.ts` carries the reason: a
 * reopened orchestral project played violin-1 on every track before it did).
 * `deviceState` never crosses the wire to the native engine, so this is the
 * seam that folds the one numeric fact out of it back into the record the body
 * receives — the same job `projectToasterKitToNativePatch` does for a kit.
 *
 * The instrument id in the same chunk is deliberately absent from the result:
 * it selects which *sample bank* the body is built from, which is a bank key
 * beside the record rather than a parameter inside it
 * ([nativeBankKeyForLevainDeviceState]).
 *
 * `null` for a chunk this build cannot read, exactly as `fromLevainDeviceState`
 * answers: a repaired default here would send a silent `sustain` over whatever
 * the file actually saved.
 */
export function projectLevainDeviceStateToNativePatch({
    deviceState,
}: ProjectLevainDeviceStateToNativePatchInput): Readonly<Record<string, number>> | null {
    const identity = fromLevainDeviceState(deviceState);
    if (!identity) {
        return null;
    }
    return { current_articulation: getArticulationId(identity.currentArticulation) };
}
