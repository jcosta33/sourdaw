/**
 * Whether the native engine — not the Web Audio twin — is the analyser whose
 * Tuner reading the panel should show for this device.
 *
 * Two conditions, and both have to hold, for the reasons
 * {@link readNativeEngineStripPeak} and {@link isDeviceCarriedByNativeSession}
 * each state one of. The session has to be the audible carrier: a shadowed
 * session still renders, but it writes zeros at the device and Web Audio is
 * what the musician hears, so the web twin's reading is the true one then and
 * a needle fed from the shadowed engine would sit still while the player
 * played. And the device has to be in a chain the engine *reports* it built on
 * a strip this session claimed — a device the mapper degraded, or one added
 * mid-roll that no splice has placed yet, has no native body publishing for it
 * at all, so its only reading is the web twin's.
 *
 * The device's strip is not a parameter because the caller holding a native
 * reading has only the device id: the payload is keyed by device, and which
 * strip the engine placed it on is the engine's own record. So this asks the
 * carried set rather than being told.
 */

import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';
import { readNativeChain } from './readNativeChain';

export function isTunerTelemetryNativelyOwned(deviceId: string): boolean {
    if (!nativeLiveGraphSession.audibleCarrier) {
        return false;
    }
    return [...nativeLiveGraphSession.carriedStripIds].some((stripId) => readNativeChain(stripId)?.includes(deviceId));
}
