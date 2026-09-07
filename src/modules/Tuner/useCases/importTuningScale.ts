import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { importScoringTuning } from '#/modules/AudioEngine/useCases';

import { mergeDeviceState } from '../stores/tunerStore';

/**
 * Import a Scala (.scl) or AnaMark (.tun) tuning file into the Tuner device's scoring engine.
 *
 * Mirrors `setA4Reference.ts`: checks `resolveEligibleDeviceWriteTarget(deviceId)`
 * before addressing the engine device, and on a successful import updates
 * the loaded scale description in `tunerStore` so the UI immediately reflects the active temperament.
 */
export async function importTuningScale(
    deviceId: string,
    format: 'scala' | 'tun',
    text: string
): Promise<{ ok: boolean; name?: string }> {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return { ok: false };
    }

    const result = await importScoringTuning(target.trackId, target.deviceId, format, text);
    if (result.ok && result.name) {
        mergeDeviceState(deviceId, { scaleName: result.name });
    }
    return result;
}
