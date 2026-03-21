import { type Device } from '#/modules/Track/useCases/trackQueries';
import { type OfflineDeviceNode, DEVICE_FACTORIES, applyParams } from '../repositories/deviceNodeFactory';
import { isFaustModule, createFaustDevice } from '../repositories/faustDeviceFactory';

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

/**
 * Build an audio device chain, connecting devices between input and output nodes.
 *
 * Supports both built-in Web Audio devices (synchronous) and Faust DSP
 * devices (async compilation + AudioWorkletNode creation).
 *
 * Device types starting with 'faust-' are routed through the Faust compiler.
 * Unknown or failed devices are skipped gracefully.
 */
export async function buildDeviceChain(
    ctx: BaseAudioContext,
    devices: Device[],
    inputNode: AudioNode,
    outputNode: AudioNode
): Promise<BuildDeviceChainOutput> {
    const activeDevices = devices.filter((d) => !d.bypassed);
    if (activeDevices.length === 0) {
        inputNode.connect(outputNode);
        return [];
    }

    const entries: DeviceNodeEntry[] = [];
    let prev: AudioNode = inputNode;

    for (const device of activeDevices) {
        let dn: OfflineDeviceNode | null = null;

        if (isFaustModule(device.type)) {
            // Faust DSP device — compile and instantiate
            dn = await createFaustDevice(ctx, device.type);
        } else {
            // Built-in Web Audio device
            const factory = DEVICE_FACTORIES[device.type];
            if (factory) {
                dn = factory(ctx);
                applyParams(dn, device.type, device.parameterValues);
            }
        }

        if (!dn) {
            continue;
        }

        prev.connect(dn.inputNode);
        prev = dn.outputNode;
        entries.push({ deviceId: device.id, deviceType: device.type, node: dn });
    }

    prev.connect(outputNode);
    return entries;
}
