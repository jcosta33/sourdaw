import { persistDeviceParam } from '#/modules/Arrangement/stores';

import { type ProofPatch } from '../../models/ProofPatch';
import { ditherModeToInt } from '../../services/ditherModeToInt';
import { updateProofPatch } from '../../stores/proofStore';

import { bridges } from './helpers';
import { syncDynBands } from './syncDynBands';
import { syncEqBands } from './syncEqBands';
import { syncExciter } from './syncExciter';
import { syncImager } from './syncImager';

type SetProofParamWithPatchInput = {
    [Key in keyof ProofPatch]-?: {
        deviceId: string;
        key: Key;
        value: ProofPatch[Key];
    };
}[keyof ProofPatch];

type GetMappedScalarParamOutput = {
    name: string;
    value: number;
} | null;

function getMappedScalarParam(input: SetProofParamWithPatchInput): GetMappedScalarParamOutput {
    switch (input.key) {
        case 'inputGain':
            return { name: 'input_gain', value: input.value };
        case 'outputGain':
            return { name: 'output_gain', value: input.value };
        case 'eqBypassed':
            return { name: 'eq_bypass', value: input.value ? 1 : 0 };
        case 'dynBypassed':
            return { name: 'dyn_bypass', value: input.value ? 1 : 0 };
        case 'imgBypassed':
            return { name: 'img_bypass', value: input.value ? 1 : 0 };
        case 'excBypassed':
            return { name: 'exc_bypass', value: input.value ? 1 : 0 };
        case 'limBypassed':
            return { name: 'lim_bypass', value: input.value ? 1 : 0 };
        case 'limCeiling':
            return { name: 'lim_ceiling', value: input.value };
        case 'limRelease':
            return { name: 'lim_release', value: input.value };
        case 'limLookahead':
            return { name: 'lim_lookahead', value: input.value };
        case 'imgAutoMonoBass':
            return { name: 'img_auto_mono_bass', value: input.value ? 1 : 0 };
        case 'imgMonoBassFreq':
            return { name: 'img_mono_bass_freq', value: input.value };
        case 'ditherMode':
            return { name: 'dither_mode', value: ditherModeToInt(input.value) };
        case 'ditherBits':
            return { name: 'dither_bits', value: input.value };
        case 'name':
        case 'presetId':
        case 'chainOrder':
        case 'eqBands':
        case 'dynCrossoverFreqs':
        case 'dynBands':
        case 'imgBandWidth':
        case 'excBands':
        case 'target':
        case 'targetLufs':
            return null;
    }
    return null;
}

type SetProofParamWithPatchOutput = void;

/** Set a patch parameter and send to audio engine. */
export function setProofParamWithPatch(input: SetProofParamWithPatchInput): SetProofParamWithPatchOutput {
    const { deviceId, key, value } = input;

    updateProofPatch({ deviceId, patch: { [key]: value } });

    const mapped_param = getMappedScalarParam(input);
    if (mapped_param) {
        bridges.get(deviceId)?.setParam(mapped_param.name, mapped_param.value);
        persistDeviceParam(deviceId, mapped_param.name, mapped_param.value);
        return;
    }

    const bridge = bridges.get(deviceId);
    if (!bridge) {
        return;
    }

    if (input.key === 'eqBands') {
        syncEqBands(deviceId);
    } else if (input.key === 'dynBands' || input.key === 'dynCrossoverFreqs') {
        syncDynBands(deviceId);
    } else if (input.key === 'imgBandWidth') {
        syncImager(deviceId);
    } else if (input.key === 'excBands') {
        syncExciter(deviceId);
    } else if (input.key === 'chainOrder') {
        bridge.reorderModules(input.value);
    }
}
