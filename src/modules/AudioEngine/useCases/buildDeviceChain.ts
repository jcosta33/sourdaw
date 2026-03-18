import { type Device } from '#/modules/Track/models/Track';
import { type OfflineDeviceNode, DEVICE_FACTORIES, applyParams } from '../repositories/deviceNodeFactory';

// Re-export for consumers
export type { OfflineDeviceNode } from '../repositories/deviceNodeFactory';

export type DeviceNodeEntry = {
    deviceId: string;
    deviceType: string;
    node: OfflineDeviceNode;
};

export type BuildDeviceChainInput = {
    ctx: BaseAudioContext;
    devices: Device[];
    inputNode: AudioNode;
    outputNode: AudioNode;
};

export type BuildDeviceChainOutput = DeviceNodeEntry[];

export function buildDeviceChain(
    ctx: BaseAudioContext,
    devices: Device[],
    inputNode: AudioNode,
    outputNode: AudioNode
): BuildDeviceChainOutput {
    const activeDevices = devices.filter((d) => !d.bypassed);
    if (activeDevices.length === 0) {
        inputNode.connect(outputNode);
        return [];
    }

    const entries: DeviceNodeEntry[] = [];
    let prev: AudioNode = inputNode;
    for (const device of activeDevices) {
        const factory = DEVICE_FACTORIES[device.type];
        if (!factory) {
            continue;
        }
        const dn = factory(ctx);
        applyParams(dn, device.type, device.parameterValues);
        prev.connect(dn.inputNode);
        prev = dn.outputNode;
        entries.push({ deviceId: device.id, deviceType: device.type, node: dn });
    }
    prev.connect(outputNode);
    return entries;
}
