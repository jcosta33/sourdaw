import type { BuiltinDeviceNode } from '../../models/AudioEngineState';

export type DeviceRuntimeResources = {
    audioNodes: number;
    audioWorkletProcessors: number;
    workers: number;
};

export function countDeviceRuntimeResources(device: BuiltinDeviceNode): DeviceRuntimeResources {
    const ownedAudioNodes = new Set([device.inputNode, device.outputNode, ...device.nodes]);
    let audioWorkletProcessors = 0;
    for (const node of ownedAudioNodes) {
        if (node instanceof AudioWorkletNode) {
            audioWorkletProcessors++;
        }
    }
    return { audioNodes: ownedAudioNodes.size, audioWorkletProcessors, workers: device.workerInstances ?? 0 };
}
