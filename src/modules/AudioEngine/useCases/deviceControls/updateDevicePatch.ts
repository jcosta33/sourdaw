import { audioEngine } from '../../repositories/createWebAudioEngine';
import { sendNativeDeviceParameters } from '../livePlayback/sendNativeDeviceParameters';

import { nativeBuiltinWriteTarget } from './nativeBuiltinWriteTarget';

/**
 * The single door a whole patch reaches the DSP through, sent as one gesture.
 *
 * The Web Audio write always happens: while the native session carries the
 * device it is the sound, but its Web Audio node is the strip's fallback
 * carrier, silent only for as long as the session holds the gate closed on it,
 * and it has to already hold the current patch for the moment that gate
 * reopens at Stop. The native send in {@link nativeBuiltinWriteTarget} is
 * additive on top of that, over the graph command path, for whichever
 * built-in the native session is carrying right now.
 *
 * Projecting the patch through the body is safe whatever a caller passes,
 * including a patch already spelled in the engine's names, which the Fermenter
 * patch bridge sends. The Fermenter projection is idempotent on those:
 * `FERMENTER_DSP_PARAM_OVERRIDES` is keyed by camelCase descriptor id, so a
 * snake_case name misses it, and the fallback only rewrites capitals, of which
 * a snake_case name has none.
 */
export function updateDevicePatch(trackId: string, deviceId: string, patch: Record<string, unknown>): void {
    audioEngine.updateDevicePatch(trackId, deviceId, patch);
    const body = nativeBuiltinWriteTarget(trackId, deviceId);
    if (body) {
        void sendNativeDeviceParameters({ trackId, deviceId, values: body.projectPatch(patch) });
    }
}
