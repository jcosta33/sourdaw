import { fromLevainDeviceState } from '../models/LevainDeviceState';
import { levainNativeBankKey } from '../models/LevainNativeBankKey';

export type NativeBankKeyForLevainDeviceStateInput = {
    /** Project snapshot state; only this module may decode it. */
    deviceState: unknown;
};

/**
 * The bank key a Levain device sounds, read off its own project state, or
 * `null` when the chunk names no instrument this build can load.
 *
 * `null` is not a silent fallback to a default instrument: the mapper refuses a
 * Levain device that names no bank rather than splicing a mute sampler onto the
 * strip, and that refusal is what tells a musician the device did not load.
 */
export function nativeBankKeyForLevainDeviceState({
    deviceState,
}: NativeBankKeyForLevainDeviceStateInput): string | null {
    const identity = fromLevainDeviceState(deviceState);
    return identity ? levainNativeBankKey(identity.instrumentId) : null;
}
