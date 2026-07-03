import { logger } from '#/infra/logger/appLogger';

import { clampOversampling, type GlutenPatch } from '../../models/GlutenPatch';
import { loadGlutenPatch } from '../../stores/glutenStore';

import { createFlushHandlers } from './createFlushHandlers';
import { bridgeDeps, encodeGlutenValue, findDeviceRefGluten } from './helpers';

const { pushParamImmediately } = createFlushHandlers(bridgeDeps);

export function loadGlutenPatchWithAudio(deviceId: string, rawPatch: GlutenPatch): void {
    // Snap oversampling to a supported factor (1/2/4) before it reaches the store
    // or the engine — a hand-built preset or stale persisted patch may carry an
    // unsupported value such as 3.
    const snapped = clampOversampling(rawPatch.oversampling);
    const patch: GlutenPatch = snapped === rawPatch.oversampling ? rawPatch : { ...rawPatch, oversampling: snapped };

    loadGlutenPatch(deviceId, patch);

    const ref = findDeviceRefGluten(deviceId);
    if (!ref) {
        return;
    }

    const params: Array<[string, unknown]> = [
        ['topology', patch.topology],
        ['style', patch.style],
        ['amount', patch.amount],
        ['threshold', patch.threshold],
        ['ratio', patch.ratio],
        ['attack', patch.attack],
        ['release', patch.release],
        ['knee', patch.knee],
        ['makeup', patch.makeup],
        ['mix', patch.mix],
        ['autoMakeup', patch.autoMakeup],
        ['autoRelease', patch.autoRelease],
        ['range', patch.range],
        ['scHpfFreq', patch.scHpfFreq],
        ['scHpfEnabled', patch.scHpfEnabled],
        ['thrust', patch.thrust],
        ['detection', patch.detection],
        ['stereoMode', patch.stereoMode],
        ['stereoLink', patch.stereoLink],
        ['oversampling', patch.oversampling],
        ['lookahead', patch.lookahead],
        ['scLpfFreq', patch.scLpfFreq],
        ['scLpfEnabled', patch.scLpfEnabled],
        ['scEqFreq', patch.scEqFreq],
        ['scEqGain', patch.scEqGain],
        ['scEqQ', patch.scEqQ],
        ['scEqEnabled', patch.scEqEnabled],
        ['deltaListen', patch.deltaListen],
        ['gainMatchBypass', patch.gainMatchBypass],
        ['extSidechain', patch.extSidechain],
        ['inputGain', patch.inputGain],
        ['outputGain', patch.outputGain],
        ['xfmrDrive', patch.xfmrDrive],
        ['allButtons', patch.allButtons],
        ['limitMode', patch.limitMode],
        ['recovery', patch.recovery],
        ['vcaType', patch.vcaType],
        ['vcaCharacter', patch.vcaCharacter],
        ['feedForward', patch.feedForward],
        ['jfetK3', patch.jfetK3],
        ['xfmrK2', patch.xfmrK2],
        ['blendTopology', patch.blendTopology],
        ['blendAmount', patch.blendAmount],
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
        pushParamImmediately(ref, key, encodedValue);
    }
}
