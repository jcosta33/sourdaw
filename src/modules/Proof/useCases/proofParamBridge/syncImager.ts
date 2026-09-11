import { getProofState } from '../../stores/proofStore';

import { sendProofParam } from './helpers';

/** Send all imager parameters to the engine. */
export function syncImager(deviceId: string): void {
    const patch = getProofState(deviceId).patch;
    for (let i = 0; i < 4; i++) {
        sendProofParam(deviceId, `img_width${i}`, patch.imgBandWidth[i]!);
    }
    sendProofParam(deviceId, 'img_auto_mono_bass', patch.imgAutoMonoBass ? 1 : 0);
    sendProofParam(deviceId, 'img_mono_bass_freq', patch.imgMonoBassFreq);
}
