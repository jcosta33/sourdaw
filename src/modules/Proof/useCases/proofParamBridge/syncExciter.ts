import { getProofState } from '../../stores/proofStore';

import { sendProofParam } from './helpers';

/** Send all exciter parameters to the engine. */
export function syncExciter(deviceId: string): void {
    const patch = getProofState(deviceId).patch;
    for (let i = 0; i < patch.excBands.length; i++) {
        const band = patch.excBands[i]!;
        sendProofParam(deviceId, `exc_band${i}_type`, band.type);
        sendProofParam(deviceId, `exc_band${i}_drive`, band.drive);
        sendProofParam(deviceId, `exc_band${i}_blend`, band.blend);
        sendProofParam(deviceId, `exc_band${i}_enabled`, band.enabled ? 1 : 0);
    }
}
