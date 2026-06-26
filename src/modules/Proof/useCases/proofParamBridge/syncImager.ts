import { getProofState } from '../../stores/proofStore';

import { bridges } from './helpers';

/** Send all imager parameters to the engine. */
export function syncImager(deviceId: string): void {
    const patch = getProofState(deviceId).patch;
    const bridge = bridges.get(deviceId);
    if (!bridge) {
        return;
    }
    for (let i = 0; i < 4; i++) {
        bridge.setParam(`img_width${i}`, patch.imgBandWidth[i]!);
    }
    bridge.setParam('img_auto_mono_bass', patch.imgAutoMonoBass ? 1 : 0);
    bridge.setParam('img_mono_bass_freq', patch.imgMonoBassFreq);
}
