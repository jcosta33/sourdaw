/**
 * Whether the native engine — not Web Audio — is the one driving this device
 * (#3568).
 *
 * Two conditions, and both have to hold. The strip has to be one this session
 * claimed, or Web Audio is still sounding it and the engine holds no body for
 * the device at all. And the device has to be in the chain the engine *reports*
 * it built: a device the mapper degraded, or one added mid-roll that no splice
 * has placed yet, is on project truth and not in the engine, so a caller that
 * stopped writing it over IPC would strand it.
 */

import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';
import { readNativeChain } from './readNativeChain';

export function isDeviceCarriedByNativeSession(trackId: string, deviceId: string): boolean {
    if (!nativeLiveGraphSession.carriedStripIds.has(trackId)) {
        return false;
    }
    return readNativeChain(trackId)?.includes(deviceId) ?? false;
}
