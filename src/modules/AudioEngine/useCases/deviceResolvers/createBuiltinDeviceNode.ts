import { type OfflineDeviceNode, createOfflineDeviceNode } from '../../repositories/deviceNodeFactory';

type CreateBuiltinDeviceNodeInput = {
    context: BaseAudioContext;
    deviceType: string;
};

type CreateBuiltinDeviceNodeOutput = OfflineDeviceNode | null;

export function createBuiltinDeviceNode({
    context,
    deviceType,
}: CreateBuiltinDeviceNodeInput): CreateBuiltinDeviceNodeOutput {
    return createOfflineDeviceNode({ context, deviceType });
}
