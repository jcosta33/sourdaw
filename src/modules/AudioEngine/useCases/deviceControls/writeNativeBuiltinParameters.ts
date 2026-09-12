import { sendNativeDeviceParameters } from '../livePlayback/sendNativeDeviceParameters';

import { nativeBuiltinWriteTarget } from './nativeBuiltinWriteTarget';

/**
 * The door a live write reaches the native session through, for values already
 * spelled in the body's own vocabulary (#3124).
 *
 * {@link updateDeviceParam} is the door for a write whose name is a project
 * parameter id: it clamps the declared range, writes the Web Audio node, and
 * translates the id through the body before sending. A built-in whose audible
 * identity is not a `parameterValues` table has writes that door cannot carry
 * — Toaster's kit and pad controls are pushed to its engine as control writes,
 * in the engine's own names, and never pass through a device parameter at all.
 * Those callers already hold the engine's name, so this is the same additive
 * send with the translation left to them.
 *
 * Additive, never exclusive, exactly as {@link nativeBuiltinWriteTarget}
 * describes: the caller keeps writing its Web Audio node, which stays the
 * strip's fallback carrier and has to hold the current value for the moment
 * the session's gate reopens at Stop. Silent when the session is not carrying
 * this device, because a device no splice has placed is not one the engine
 * holds.
 */
export function writeNativeBuiltinParameters(
    trackId: string,
    deviceId: string,
    values: Readonly<Record<string, number>>
): void {
    if (!nativeBuiltinWriteTarget(trackId, deviceId)) {
        return;
    }
    void sendNativeDeviceParameters({ trackId, deviceId, values });
}
