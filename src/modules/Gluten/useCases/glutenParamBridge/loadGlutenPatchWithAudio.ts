import { logger } from '#/infra/logger/appLogger';

import { clampOversampling, type GlutenPatch } from '../../models/GlutenPatch';
import { GLUTEN_PRESET_PARAMETER_ORDER } from '../../models/GlutenPresetParameterOrder';
import { loadGlutenPatch } from '../../stores/glutenStore';

import { createFlushHandlers } from './createFlushHandlers';
import { bridgeDeps, encodeGlutenValue, paramBatcher } from './helpers';

const { pushParamImmediately } = createFlushHandlers(bridgeDeps);

export function loadGlutenPatchWithAudio(deviceId: string, rawPatch: GlutenPatch): void {
    const target = bridgeDeps.resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    // Snap oversampling to a supported factor (1/2/4) before it reaches the store
    // or the engine — a hand-built preset or stale persisted patch may carry an
    // unsupported value such as 3.
    const snapped = clampOversampling(rawPatch.oversampling);
    let patch = rawPatch;
    if (snapped !== rawPatch.oversampling) {
        patch = { ...rawPatch, oversampling: snapped };
    }

    loadGlutenPatch(deviceId, patch);

    for (const key of GLUTEN_PRESET_PARAMETER_ORDER) {
        const rawValue = patch[key];
        const encodedValue = encodeGlutenValue(key, rawValue);
        if (encodedValue === null) {
            // An unencodable value never reaches the engine, so the store and the
            // audio graph drift apart for this param. Log it so the desync is
            // observable instead of silent.
            logger.warn(
                `loadGlutenPatchWithAudio: skipped param "${key}" for device "${deviceId}" — value did not encode`,
                rawValue
            );
            continue;
        }
        paramBatcher.cancel(`${deviceId}:${key}`);
        pushParamImmediately(deviceId, key, encodedValue);
    }
}
