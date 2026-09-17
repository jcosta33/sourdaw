/**
 * Whether the engine holds a body for this device at all (#3998).
 *
 * The weaker half of {@link isDeviceCarriedByNativeSession}, which also
 * requires the strip to be one this session claimed — the question of who
 * *sounds* the device. A body exists either way: a shadowed session builds
 * every strip and claims none, so it holds bodies nobody hears.
 *
 * That difference matters for held state rather than for audio. A pedal or a
 * panic written to a body nobody is listening to still latches on it, with no
 * message coming to clear it once that body becomes the audible one. So the
 * messages that must reach every body in existence ask this, and the ones that
 * decide who voices a note ask the carried question instead.
 */

import { readNativeChain } from './readNativeChain';

export function isDeviceHeldByNativeSession(trackId: string, deviceId: string): boolean {
    return readNativeChain(trackId)?.includes(deviceId) ?? false;
}
