import { type ProofPatch } from '../../models/ProofPatch';
import { updateProofPatch } from '../../stores/proofStore';

import { bridges } from './helpers';
import { syncEqBands, syncDynBands, syncImager, syncExciter } from './loadProofPatchWithAudio';

type SetProofParamWithPatchInput<Key extends keyof ProofPatch> = {
    deviceId: string;
    key: Key;
    value: ProofPatch[Key];
};

/** Set a patch parameter and send to audio engine. */
export function setProofParamWithPatch<Key extends keyof ProofPatch>({
    deviceId,
    key,
    value,
}: SetProofParamWithPatchInput<Key>): void {
    updateProofPatch({ deviceId, patch: { [key]: value } });

    const bridge = bridges.get(deviceId);
    if (!bridge) {
        return;
    }

    if (key === 'inputGain') {
        bridge.setParam('input_gain', value as number);
    } else if (key === 'outputGain') {
        bridge.setParam('output_gain', value as number);
    } else if (key === 'eqBypassed') {
        bridge.setParam('eq_bypass', (value as boolean) ? 1 : 0);
    } else if (key === 'dynBypassed') {
        bridge.setParam('dyn_bypass', (value as boolean) ? 1 : 0);
    } else if (key === 'imgBypassed') {
        bridge.setParam('img_bypass', (value as boolean) ? 1 : 0);
    } else if (key === 'excBypassed') {
        bridge.setParam('exc_bypass', (value as boolean) ? 1 : 0);
    } else if (key === 'limBypassed') {
        bridge.setParam('lim_bypass', (value as boolean) ? 1 : 0);
    } else if (key === 'limCeiling') {
        bridge.setParam('lim_ceiling', value as number);
    } else if (key === 'limRelease') {
        bridge.setParam('lim_release', value as number);
    } else if (key === 'limLookahead') {
        bridge.setParam('lim_lookahead', value as number);
    } else if (key === 'imgAutoMonoBass') {
        bridge.setParam('img_auto_mono_bass', (value as boolean) ? 1 : 0);
    } else if (key === 'imgMonoBassFreq') {
        bridge.setParam('img_mono_bass_freq', value as number);
    } else if (key === 'eqBands') {
        syncEqBands(deviceId);
    } else if (key === 'dynBands' || key === 'dynCrossoverFreqs') {
        syncDynBands(deviceId);
    } else if (key === 'imgBandWidth') {
        syncImager(deviceId);
    } else if (key === 'excBands') {
        syncExciter(deviceId);
    } else if (key === 'ditherMode') {
        bridge.setParam(
            'dither_mode',
            (() => {
                if (value === 'off') {
                    return 0;
                }
                if (value === 'tpdf') {
                    return 1;
                }
                return 2;
            })()
        );
    } else if (key === 'ditherBits') {
        bridge.setParam('dither_bits', value as number);
    } else if (key === 'chainOrder') {
        bridge.reorderModules(value as [number, number, number, number, number]);
    }
}
