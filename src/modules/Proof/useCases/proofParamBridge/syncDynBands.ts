import { getProofState } from '../../stores/proofStore';

import { bridges } from './helpers';

/** Send all dynamics band parameters to the engine. */
export function syncDynBands(deviceId: string): void {
    const patch = getProofState(deviceId).patch;
    const bridge = bridges.get(deviceId);
    if (!bridge) {
        return;
    }
    for (let i = 0; i < 3; i++) {
        bridge.setParam(`dyn_xover${i}`, patch.dynCrossoverFreqs[i]!);
    }
    for (let i = 0; i < patch.dynBands.length; i++) {
        const band = patch.dynBands[i]!;
        bridge.setParam(`dyn_band${i}_threshold`, band.threshold);
        bridge.setParam(`dyn_band${i}_ratio`, band.ratio);
        bridge.setParam(`dyn_band${i}_attack`, band.attack);
        bridge.setParam(`dyn_band${i}_release`, band.release);
        bridge.setParam(`dyn_band${i}_knee`, band.knee);
        bridge.setParam(`dyn_band${i}_makeup`, band.makeup);
        bridge.setParam(`dyn_band${i}_auto_makeup`, band.autoMakeup ? 1 : 0);
        bridge.setParam(`dyn_band${i}_bypass`, band.bypassed ? 1 : 0);
    }
}
