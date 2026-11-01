import { clipSatelliteStateCodec } from './clipSatelliteStateCodec';

/** Validate persisted owner syntax without consulting the current satellite stores. */
export function isValidClipSatelliteStateRestorePlan(value: unknown): boolean {
    try {
        return clipSatelliteStateCodec.decodeRestorePlan(value) !== null;
    } catch {
        return false;
    }
}
