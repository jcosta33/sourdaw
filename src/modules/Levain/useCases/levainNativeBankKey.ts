import { fromLevainDeviceState } from '../models/LevainDeviceState';
import { levainNativeBankKey } from '../models/LevainNativeBankKey';
import { DEFAULT_LEVAIN_INSTRUMENT_ID } from '../models/LevainPatch';

export type NativeBankKeyForLevainDeviceStateInput = {
    /** Project snapshot state; only this module may decode it. */
    deviceState: unknown;
};

/**
 * The bank key a Levain device sounds, read off its own project state, or
 * `null` when its chunk names no instrument this build can load.
 *
 * An *absent* chunk is not that case. `initLevainDeviceStatePersistence`
 * records a device on first sight without committing one, so a Levain nobody
 * has edited holds no chunk at all — and the instrument it sounds on the Web
 * Audio carrier is `createDefaultPatch`'s. Answering that instrument's key is
 * what keeps the two carriers on one instrument for such a device; answering
 * `null` would instead hand the mapper a device naming no bank, which refuses
 * the batch and declines the whole session.
 *
 * `null` stays a real answer for a chunk that is *present* and names no
 * loadable instrument — a version this reader cannot read, or an id this build
 * does not ship. That device did not load, and the refusal is what says so
 * rather than a silent substitution of a different instrument.
 */
export function nativeBankKeyForLevainDeviceState({
    deviceState,
}: NativeBankKeyForLevainDeviceStateInput): string | null {
    if (deviceState === undefined) {
        return levainNativeBankKey(DEFAULT_LEVAIN_INSTRUMENT_ID);
    }

    const identity = fromLevainDeviceState(deviceState);
    return identity ? levainNativeBankKey(identity.instrumentId) : null;
}
