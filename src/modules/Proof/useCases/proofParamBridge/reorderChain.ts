import { setProofParamWithPatch } from './setProofParamWithPatch';

type ReorderChainInput = {
    deviceId: string;
    order: [number, number, number, number, number];
};

export function reorderChain({ deviceId, order }: ReorderChainInput): void {
    setProofParamWithPatch({ deviceId, key: 'chainOrder', value: order });
}
