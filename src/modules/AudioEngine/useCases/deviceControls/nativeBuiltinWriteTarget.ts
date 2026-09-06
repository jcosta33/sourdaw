/**
 * The native built-in body a live parameter write to this device must ALSO
 * reach natively, or `null` when Web Audio alone owns the device right now
 * (#3893).
 *
 * This is additive, never exclusive: the caller keeps writing the Web Audio
 * node whatever this returns. A strip the native session carries is gated out
 * of the Web Audio mix while rolling, but that node is the strip's fallback
 * carrier — `stopNativeLiveGraphSession` claims the carried set empty at Stop,
 * so the strip is heard through Web Audio again the moment the gate reopens,
 * and it has to already hold the current value for that moment.
 *
 * Both halves have to hold. The device's type must name a body the engine
 * builds, because the vocabulary a write is spelled in belongs to the body
 * rather than to the caller; and the session must actually be carrying that
 * device, because a device the mapper degraded or one no splice has placed yet
 * is on project truth and not in the engine, so a native send would address a
 * device the engine does not hold.
 */

import { trackStore } from '#/modules/Arrangement/stores';

import { isDeviceCarriedByNativeSession } from '../livePlayback/isDeviceCarriedByNativeSession';
import { nativeBuiltinBody, type NativeBuiltinBody } from '../livePlayback/nativeBuiltinBodies';

function deviceType(trackId: string, deviceId: string): string | null {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    return track?.devices.find((device) => device.id === deviceId)?.type ?? null;
}

export function nativeBuiltinWriteTarget(trackId: string, deviceId: string): NativeBuiltinBody | null {
    const type = deviceType(trackId, deviceId);
    if (type === null) {
        return null;
    }
    const body = nativeBuiltinBody(type);
    if (!body) {
        return null;
    }
    return isDeviceCarriedByNativeSession(trackId, deviceId) ? body : null;
}
