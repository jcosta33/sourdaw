import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { updateDevicePatch } from '#/modules/AudioEngine/useCases';

import { bridges } from './helpers';

/**
 * Send a module order to both carriers.
 *
 * The two carriers take it differently, which is why this is not a
 * `sendProofParam` loop. The native body has no `set_param` arm for an order: it
 * reads the five `chain_order_{n}` keys, so they travel as one patch send that
 * the engine drains as five `SetParam` ops in key order and applies once the
 * array is a permutation. The web twin's controller has no `setPatch` at all —
 * `TrackNode.updatePatch` is a no-op for it — so it takes the order through its
 * own bridge message.
 */
export function sendProofChainOrder(deviceId: string, order: [number, number, number, number, number]): void {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }
    updateDevicePatch(target.trackId, deviceId, {
        chain_order_0: order[0],
        chain_order_1: order[1],
        chain_order_2: order[2],
        chain_order_3: order[3],
        chain_order_4: order[4],
    });
    bridges.get(deviceId)?.reorderModules(order);
}
