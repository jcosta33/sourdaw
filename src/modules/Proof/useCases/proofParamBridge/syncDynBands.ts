import { getProofState } from '../../stores/proofStore';

import { sendProofParam } from './helpers';

/** Send all dynamics band parameters to the engine. */
export function syncDynBands(deviceId: string): void {
    const patch = getProofState(deviceId).patch;
    for (let i = 0; i < 3; i++) {
        sendProofParam(deviceId, `dyn_xover${i}`, patch.dynCrossoverFreqs[i]!);
    }
    for (let i = 0; i < patch.dynBands.length; i++) {
        const band = patch.dynBands[i]!;
        sendProofParam(deviceId, `dyn_band${i}_threshold`, band.threshold);
        sendProofParam(deviceId, `dyn_band${i}_ratio`, band.ratio);
        sendProofParam(deviceId, `dyn_band${i}_attack`, band.attack);
        sendProofParam(deviceId, `dyn_band${i}_release`, band.release);
        sendProofParam(deviceId, `dyn_band${i}_knee`, band.knee);
        sendProofParam(deviceId, `dyn_band${i}_makeup`, band.makeup);
        sendProofParam(deviceId, `dyn_band${i}_auto_makeup`, band.autoMakeup ? 1 : 0);
        sendProofParam(deviceId, `dyn_band${i}_bypass`, band.bypassed ? 1 : 0);
    }
}
