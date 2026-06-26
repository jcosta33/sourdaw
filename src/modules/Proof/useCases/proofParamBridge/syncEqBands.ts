import { getProofState } from '../../stores/proofStore';

import { bridges } from './helpers';

/** Send all EQ band parameters to the engine. */
export function syncEqBands(deviceId: string): void {
    const patch = getProofState(deviceId).patch;
    const bridge = bridges.get(deviceId);
    if (!bridge) {
        return;
    }
    for (let i = 0; i < patch.eqBands.length; i++) {
        const band = patch.eqBands[i]!;
        bridge.setParam(`eq_band${i}_freq`, band.freq);
        bridge.setParam(`eq_band${i}_gain`, band.gain);
        bridge.setParam(`eq_band${i}_q`, band.q);
        bridge.setParam(`eq_band${i}_type`, band.type);
        bridge.setParam(`eq_band${i}_channel`, band.channel);
        bridge.setParam(`eq_band${i}_enabled`, band.enabled ? 1 : 0);
    }
}
