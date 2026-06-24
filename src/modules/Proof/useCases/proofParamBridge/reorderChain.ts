import { updateProofPatch } from '../../stores/proofStore';

import { bridges } from './helpers';

type ReorderChainInput = {
    deviceId: string;
    order: [number, number, number, number, number];
};

export function reorderChain({ deviceId, order }: ReorderChainInput): void {
    updateProofPatch({ deviceId, patch: { chainOrder: order } });
    bridges.get(deviceId)?.reorderModules(order);
}
