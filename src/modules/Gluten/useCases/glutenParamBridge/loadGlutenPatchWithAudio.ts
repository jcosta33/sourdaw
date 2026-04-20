import { type GlutenPatch } from '../../models/GlutenPatch';
import { loadGlutenPatch } from '../../stores/glutenStore';

import { encodeGlutenValue, findDeviceRefGluten, pushParamImmediately } from './helpers';

export function loadGlutenPatchWithAudio(deviceId: string, patch: GlutenPatch): void {
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
        if (encodedValue !== null) {
            pushParamImmediately(ref, key, encodedValue);
        }
    }
}
