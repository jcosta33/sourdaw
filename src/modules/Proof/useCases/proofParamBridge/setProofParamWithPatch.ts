import { type ProofPatch } from '../../models/ProofPatch';
import { updateProofPatch } from '../../stores/proofStore';

import { bridges } from './helpers';

/** Set a patch parameter and send to audio engine. */
export function setProofParamWithPatch<K extends keyof ProofPatch>(
    deviceId: string,
    key: K,
    value: ProofPatch[K]
): void {
    updateProofPatch(deviceId, { [key]: value });

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
    }
}
