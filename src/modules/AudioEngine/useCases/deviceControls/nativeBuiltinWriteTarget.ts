/**
 * The native built-in body a live parameter write to this device belongs to, or
 * `null` when Web Audio still owns the write (#3893).
 *
 * A strip the native session carries is gated out of the Web Audio mix, so its
 * Web Audio node is silent and a write sent there moves nothing a musician
 * hears. Writing both paths is worse than writing only the wrong one: the
 * engine already holds the value it was stamped, and a second driver for the
 * same parameter is two beliefs about where a control stands. The automation
 * writer stands down from a carried device for that reason
 * (`readLiveAutomationWrites`), and a hand-moved control owes the same.
 *
 * Both halves have to hold. The device's type must name a body the engine
 * builds, because the vocabulary a write is spelled in belongs to the body
 * rather than to the caller; and the session must actually be carrying that
 * device, because a device the mapper degraded or one no splice has placed yet
 * is on project truth and not in the engine, so a caller that stopped writing
 * it over the web path would strand it.
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
