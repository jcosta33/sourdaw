import { logger } from '#/infra/logger/appLogger';

import { GLUTEN_PARAM_IDS, type GlutenParamId } from '../../models/GlutenParamIds';
import { clampOversampling, type GlutenPatch } from '../../models/GlutenPatch';
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

    const params: Array<[GlutenParamId, unknown]> = [
        [GLUTEN_PARAM_IDS.topology, patch.topology],
        [GLUTEN_PARAM_IDS.style, patch.style],
        [GLUTEN_PARAM_IDS.amount, patch.amount],
        [GLUTEN_PARAM_IDS.threshold, patch.threshold],
        [GLUTEN_PARAM_IDS.ratio, patch.ratio],
        [GLUTEN_PARAM_IDS.attack, patch.attack],
        [GLUTEN_PARAM_IDS.release, patch.release],
        [GLUTEN_PARAM_IDS.knee, patch.knee],
        [GLUTEN_PARAM_IDS.makeup, patch.makeup],
        [GLUTEN_PARAM_IDS.mix, patch.mix],
        [GLUTEN_PARAM_IDS.autoMakeup, patch.autoMakeup],
        [GLUTEN_PARAM_IDS.autoRelease, patch.autoRelease],
        [GLUTEN_PARAM_IDS.range, patch.range],
        [GLUTEN_PARAM_IDS.scHpfFreq, patch.scHpfFreq],
        [GLUTEN_PARAM_IDS.scHpfEnabled, patch.scHpfEnabled],
        [GLUTEN_PARAM_IDS.thrust, patch.thrust],
        [GLUTEN_PARAM_IDS.detection, patch.detection],
        [GLUTEN_PARAM_IDS.stereoMode, patch.stereoMode],
        [GLUTEN_PARAM_IDS.stereoLink, patch.stereoLink],
        [GLUTEN_PARAM_IDS.oversampling, patch.oversampling],
        [GLUTEN_PARAM_IDS.lookahead, patch.lookahead],
        [GLUTEN_PARAM_IDS.scLpfFreq, patch.scLpfFreq],
        [GLUTEN_PARAM_IDS.scLpfEnabled, patch.scLpfEnabled],
        [GLUTEN_PARAM_IDS.scEqFreq, patch.scEqFreq],
        [GLUTEN_PARAM_IDS.scEqGain, patch.scEqGain],
        [GLUTEN_PARAM_IDS.scEqQ, patch.scEqQ],
        [GLUTEN_PARAM_IDS.scEqEnabled, patch.scEqEnabled],
        [GLUTEN_PARAM_IDS.deltaListen, patch.deltaListen],
        [GLUTEN_PARAM_IDS.gainMatchBypass, patch.gainMatchBypass],
        [GLUTEN_PARAM_IDS.extSidechain, patch.extSidechain],
        [GLUTEN_PARAM_IDS.inputGain, patch.inputGain],
        [GLUTEN_PARAM_IDS.outputGain, patch.outputGain],
        [GLUTEN_PARAM_IDS.xfmrDrive, patch.xfmrDrive],
        [GLUTEN_PARAM_IDS.allButtons, patch.allButtons],
        [GLUTEN_PARAM_IDS.limitMode, patch.limitMode],
        [GLUTEN_PARAM_IDS.recovery, patch.recovery],
        [GLUTEN_PARAM_IDS.vcaType, patch.vcaType],
        [GLUTEN_PARAM_IDS.vcaCharacter, patch.vcaCharacter],
        [GLUTEN_PARAM_IDS.feedForward, patch.feedForward],
        [GLUTEN_PARAM_IDS.jfetK3, patch.jfetK3],
        [GLUTEN_PARAM_IDS.xfmrK2, patch.xfmrK2],
        [GLUTEN_PARAM_IDS.blendTopology, patch.blendTopology],
        [GLUTEN_PARAM_IDS.blendAmount, patch.blendAmount],
    ];

    for (const [key, rawValue] of params) {
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
