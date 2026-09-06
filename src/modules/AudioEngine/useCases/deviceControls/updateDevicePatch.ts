import { audioEngine } from '../../repositories/createWebAudioEngine';
import { sendNativeDeviceParameters } from '../livePlayback/sendNativeDeviceParameters';

import { nativeBuiltinWriteTarget } from './nativeBuiltinWriteTarget';

/**
 * The single door a whole patch reaches the DSP through, sent as one gesture.
 *
 * A built-in the native session carries takes the patch over the graph command
 * path instead of the web one, for the reason {@link nativeBuiltinWriteTarget}
 * states: the carried strip's Web Audio node is silent, and driving both is two
 * beliefs about where the controls stand.
 *
 * Projecting the patch through the body is safe whatever a caller passes,
 * including a patch already spelled in the engine's names, which the Fermenter
 * patch bridge sends. The Fermenter projection is idempotent on those:
 * `FERMENTER_DSP_PARAM_OVERRIDES` is keyed by camelCase descriptor id, so a
 * snake_case name misses it, and the fallback only rewrites capitals, of which
 * a snake_case name has none.
 */
export function updateDevicePatch(trackId: string, deviceId: string, patch: Record<string, unknown>): void {
    const body = nativeBuiltinWriteTarget(trackId, deviceId);
    if (body) {
        void sendNativeDeviceParameters({ trackId, deviceId, values: body.projectPatch(patch) });
        return;
    }
    audioEngine.updateDevicePatch(trackId, deviceId, patch);
}
