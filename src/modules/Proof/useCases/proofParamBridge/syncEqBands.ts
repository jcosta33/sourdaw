import { getProofState } from '../../stores/proofStore';

import { sendProofParam } from './helpers';

/** Send all EQ band parameters to the engine. */
export function syncEqBands(deviceId: string): void {
    const patch = getProofState(deviceId).patch;
    for (let i = 0; i < patch.eqBands.length; i++) {
        const band = patch.eqBands[i]!;
        sendProofParam(deviceId, `eq_band${i}_freq`, band.freq);
        sendProofParam(deviceId, `eq_band${i}_gain`, band.gain);
        sendProofParam(deviceId, `eq_band${i}_q`, band.q);
        sendProofParam(deviceId, `eq_band${i}_type`, band.type);
        sendProofParam(deviceId, `eq_band${i}_channel`, band.channel);
        sendProofParam(deviceId, `eq_band${i}_enabled`, band.enabled ? 1 : 0);
    }
}
