import { updateProofPatch } from '../../stores/proofStore';
import { bridges } from './helpers';

export function reorderChain(deviceId: string, order: [number, number, number, number, number]): void {
    updateProofPatch(deviceId, { chainOrder: order });
    bridges.get(deviceId)?.reorderModules(order);
}