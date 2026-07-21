import { resolveEligibleDeviceWriteTarget } from './resolveEligibleDeviceWriteTarget';
import { type Track, trackStore } from './trackStore';

/**
 * Narrow cross-module write surface: persist a single device parameter into
 * the authoritative track store. Owned by Arrangement because the write lands
 * on `Track.devices[*].parameterValues`, but deliberately colocated with the
 * store instance (not `useCases/`) so synth param bridges (Bacteria, Crust,
 * Fermenter, Gluten, Grinder, Levain, Proof) can call it without importing
 * the full `Arrangement/useCases` graph — that import would re-form the
 * cross-module cycles the bridges previously closed.
 */
export function persistDeviceParam(deviceId: string, paramId: string, value: number): void {
    if (!Number.isFinite(value)) {
        return;
    }

    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    const state = trackStore.value;
    if (!state) {
        return;
    }

    trackStore.set({
        ...state,
        tracks: state.tracks.map((track: Track) => {
            if (track.id !== target.trackId) {
                return track;
            }

            const devices = track.devices.map((device) => {
                if (device.id !== target.deviceId) {
                    return device;
                }

                return {
                    ...device,
                    parameterValues: { ...device.parameterValues, [paramId]: value },
                };
            });

            return { ...track, devices };
        }),
    });
}
