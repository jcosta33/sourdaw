import { trackStore } from '#/modules/Arrangement/stores';

/**
 * The type project truth records for one device on one strip, or `null` when
 * the project holds neither.
 *
 * Shared rather than restated because every native-facing write path in this
 * folder turns on the same fact — which body, if any, the engine builds for
 * this device — and a second lookup that resolved a device differently would
 * route two writes to the same parameter down different doors.
 */
export function deviceTypeOnStrip(trackId: string, deviceId: string): string | null {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    return track?.devices.find((device) => device.id === deviceId)?.type ?? null;
}
