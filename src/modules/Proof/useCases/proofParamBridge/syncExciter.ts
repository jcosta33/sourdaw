import { getProofState } from '../../stores/proofStore';

import { bridges } from './helpers';

/** Send all exciter parameters to the engine. */
export function syncExciter(deviceId: string): void {
    const patch = getProofState(deviceId).patch;
    const bridge = bridges.get(deviceId);
    if (!bridge) {
        return;
    }
    for (let i = 0; i < patch.excBands.length; i++) {
        const band = patch.excBands[i]!;
        bridge.setParam(`exc_band${i}_type`, band.type);
        bridge.setParam(`exc_band${i}_drive`, band.drive);
        bridge.setParam(`exc_band${i}_blend`, band.blend);
        bridge.setParam(`exc_band${i}_enabled`, band.enabled ? 1 : 0);
    }
}
