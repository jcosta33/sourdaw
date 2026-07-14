import { persistDevicePatch } from '#/modules/Arrangement/useCases';

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

type PersistedProofParam = {
    name: string;
    value: number;
};

function getPersistedPatchParams(input: SetProofParamWithPatchInput): PersistedProofParam[] {
    switch (input.key) {
        case 'eqBands':
            return input.value.flatMap((band, index) => [
                { name: `eq_band${index}_freq`, value: band.freq },
                { name: `eq_band${index}_gain`, value: band.gain },
                { name: `eq_band${index}_q`, value: band.q },
                { name: `eq_band${index}_type`, value: band.type },
                { name: `eq_band${index}_channel`, value: band.channel },
                { name: `eq_band${index}_enabled`, value: band.enabled ? 1 : 0 },
            ]);
        case 'dynCrossoverFreqs':
            return input.value.map((value, index) => ({ name: `dyn_xover${index}`, value }));
        case 'dynBands':
            return input.value.flatMap((band, index) => [
                { name: `dyn_band${index}_threshold`, value: band.threshold },
                { name: `dyn_band${index}_ratio`, value: band.ratio },
                { name: `dyn_band${index}_attack`, value: band.attack },
                { name: `dyn_band${index}_release`, value: band.release },
                { name: `dyn_band${index}_knee`, value: band.knee },
                { name: `dyn_band${index}_makeup`, value: band.makeup },
                { name: `dyn_band${index}_auto_makeup`, value: band.autoMakeup ? 1 : 0 },
                { name: `dyn_band${index}_bypass`, value: band.bypassed ? 1 : 0 },
            ]);
        case 'imgBandWidth':
            return input.value.map((value, index) => ({ name: `img_width${index}`, value }));
        case 'excBands':
            return input.value.flatMap((band, index) => [
                { name: `exc_band${index}_type`, value: band.type },
                { name: `exc_band${index}_drive`, value: band.drive },
                { name: `exc_band${index}_blend`, value: band.blend },
                { name: `exc_band${index}_enabled`, value: band.enabled ? 1 : 0 },
            ]);
        case 'chainOrder':
            return input.value.map((value, index) => ({ name: `chain_order_${index}`, value }));
        case 'name':
        case 'presetId':
        case 'inputGain':
        case 'outputGain':
        case 'eqBypassed':
        case 'dynBypassed':
        case 'imgBypassed':
        case 'imgAutoMonoBass':
        case 'imgMonoBassFreq':
        case 'excBypassed':
        case 'limBypassed':
        case 'limCeiling':
        case 'limRelease':
        case 'limLookahead':
        case 'ditherMode':
        case 'ditherBits':
        case 'target':
        case 'targetLufs':
            return [];
    }

    return [];
}

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
    const persisted_params = mapped_param ? [mapped_param] : getPersistedPatchParams(input);
    if (persisted_params.length > 0) {
        persistDevicePatch(deviceId, Object.fromEntries(persisted_params.map((param) => [param.name, param.value])));
    }

    if (mapped_param) {
        bridges.get(deviceId)?.setParam(mapped_param.name, mapped_param.value);
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
