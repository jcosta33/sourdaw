import { extractBacteriaModAssignments } from '../../engine/BacteriaNode';
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
 *
 * A Bacteria patch's `modAssignments` rides the same native batch as its
 * parameter records (#4685 slice 2), through `extractBacteriaModAssignments`
 * — the same reader the Web Audio worklet's own patch door uses, so the two
 * carriers agree on what counts as a well-formed table without a second
 * validator. An absent or malformed table appends no mod command and leaves
 * the native engine's routing untouched; an empty array is sent and clears it.
 */
export function updateDevicePatch(trackId: string, deviceId: string, patch: Record<string, unknown>): void {
    audioEngine.updateDevicePatch(trackId, deviceId, patch);
    const body = nativeBuiltinWriteTarget(trackId, deviceId);
    if (!body) {
        return;
    }
    const values = body.projectPatch(patch);
    const modAssignments = extractBacteriaModAssignments(patch);
    if (modAssignments === null) {
        void sendNativeDeviceParameters({ trackId, deviceId, values });
        return;
    }
    void sendNativeDeviceParameters({ trackId, deviceId, values, modAssignments });
}
