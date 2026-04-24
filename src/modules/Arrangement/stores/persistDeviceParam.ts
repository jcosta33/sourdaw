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
    const state = trackStore.value;
    if (!state) {
        return;
    }
    const owningTrack = state.tracks.find((t: Track) => t.devices.some((d) => d.id === deviceId));
    if (!owningTrack) {
        return;
    }
    trackStore.set({
        ...state,
        tracks: state.tracks.map((t: Track) =>
            t.id === owningTrack.id
                ? {
                      ...t,
                      devices: t.devices.map((d) =>
                          d.id === deviceId
                              ? { ...d, parameterValues: { ...d.parameterValues, [paramId]: value } }
                              : d
                      ),
                  }
                : t
        ),
    });
}
