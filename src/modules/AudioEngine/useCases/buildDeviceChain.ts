import { type Device } from '#/modules/Track/useCases/trackQueries';
import { type OfflineDeviceNode, DEVICE_FACTORIES, applyParams } from '../repositories/deviceNodeFactory';
import { isFaustModule, createFaustDevice } from '../repositories/faustDeviceFactory';
import { isNativeDspDevice, NATIVE_DSP_DEVICE_TYPES, createNativeDspNode } from '../engine/NativeDspNode';
import { isDeviceSupportedOnCurrentPlatform } from '#/modules/Track/models/DeviceParameter';

// Re-export for consumers
export type { OfflineDeviceNode } from '../repositories/deviceNodeFactory';

export type DeviceNodeEntry = {
    deviceId: string;
    deviceType: string;
    node: OfflineDeviceNode;
    nativeDsp?: {
        setParam: (name: string, value: number) => void;
        setBypass: (bypassed: boolean) => void;
    };
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
 * Supports three device backends:
 * 1. Built-in Web Audio devices (synchronous)
 * 2. Faust DSP devices (async compilation + AudioWorkletNode)
 * 3. Native Rust/WASM DSP devices (async WASM init + AudioWorkletNode)
 *
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
        // Skip devices not supported on the current platform (e.g. native-only on web)
        if (!isDeviceSupportedOnCurrentPlatform(device.type)) {
            console.info(`[buildDeviceChain] Skipping ${device.type} — not supported on this platform`);
            continue;
        }

        let dn: OfflineDeviceNode | null = null;
        let nativeDspControls: DeviceNodeEntry['nativeDsp'] = undefined;

        if (isNativeDspDevice(device.type)) {
            // Native Rust/WASM DSP device
            const pluginType = NATIVE_DSP_DEVICE_TYPES[device.type];
            if (pluginType) {
                try {
                    const result = await createNativeDspNode(ctx, pluginType);
                    await result.ready;
                    // Apply initial params
                    for (const [key, val] of Object.entries(device.parameterValues)) {
                        result.setParam(key, val);
                    }
                    dn = {
                        inputNode: result.workletNode,
                        outputNode: result.workletNode,
                        nodes: [result.workletNode],
                    };
                    nativeDspControls = {
                        setParam: result.setParam,
                        setBypass: result.setBypass,
                    };
                } catch (err) {
                    console.warn(`Native DSP device ${device.type} failed to load:`, err);
                }
            }
        } else if (isFaustModule(device.type)) {
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
        entries.push({ deviceId: device.id, deviceType: device.type, node: dn, nativeDsp: nativeDspControls });
    }

    prev.connect(outputNode);
    return entries;
}
