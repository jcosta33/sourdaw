import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { type Device } from '#/modules/Arrangement/useCases/trackQueries';
import { type OfflineDeviceNode, DEVICE_FACTORIES, applyParams } from '../repositories/deviceNodeFactory';
import { isFaustModule, createFaustDevice } from '../repositories/faustDeviceFactory';
import { isNativeDspDevice, NATIVE_DSP_DEVICE_TYPES, createNativeDspNode } from '../engine/NativeDspNode';
import { isFermenterDevice, createFermenterNode } from '../engine/FermenterNode';
import { isToasterDevice, createToasterNode } from '../engine/ToasterNode';
import { isLevainDevice, createLevainNode } from '../engine/LevainNode';
import { isGlutenDevice, createGlutenNode } from '../engine/GlutenNode';
import { isBacteriaDevice, createBacteriaNode } from '../engine/BacteriaNode';
import { isGrinderDevice, createGrinderNode } from '../engine/GrinderNode';
import { isProofDevice, createProofNode } from '../engine/ProofNode';
import { isScoringDevice, createScoringNode } from '../engine/ScoringNode';
import { isDeviceSupportedOnCurrentPlatform } from '#/modules/Arrangement/useCases/trackQueries';

const logger = Container.getInstance().get(Logger);

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

    // AudioWorklet-based devices (Faust, Native DSP) hang on OfflineAudioContext
    // because addModule() never resolves. Skip them for offline renders — only
    // built-in Web Audio nodes work reliably in the offline path.
    const isOffline = ctx instanceof OfflineAudioContext;

    const entries: DeviceNodeEntry[] = [];
    let prev: AudioNode = inputNode;

    for (const device of activeDevices) {
        // Skip devices not supported on the current platform (e.g. native-only on web)
        if (!isDeviceSupportedOnCurrentPlatform(device.type)) {
            continue;
        }

        let dn: OfflineDeviceNode | null = null;
        let nativeDspControls: DeviceNodeEntry['nativeDsp'] = undefined;

        if (isNativeDspDevice(device.type)) {
            if (isOffline) {
                continue;
            }
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
                } catch (error) {
                    logger.warn(`Native DSP device ${device.type} failed to load: ${error}`);
                }
            }
        } else if (isFermenterDevice(device.type)) {
            if (isOffline || !(ctx instanceof AudioContext)) {
                continue;
            }
            // Fermenter synthesizer — async WASM init + AudioWorkletNode
            try {
                const result = await createFermenterNode(ctx);
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
            } catch (error) {
                logger.warn(`Fermenter device failed to load: ${error}`);
            }
        } else if (isToasterDevice(device.type)) {
            if (isOffline || !(ctx instanceof AudioContext)) {
                continue;
            }
            // Grinder drum machine — async WASM init + AudioWorkletNode
            try {
                const result = await createToasterNode(ctx);
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
            } catch (error) {
                logger.warn(`Grinder device failed to load: ${error}`);
            }
        } else if (isLevainDevice(device.type)) {
            if (isOffline || !(ctx instanceof AudioContext)) {
                continue;
            }
            // Levain suite — async WASM init + AudioWorkletNode
            try {
                const result = await createLevainNode(ctx);
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
            } catch (error) {
                logger.warn(`Levain device failed to load: ${error}`);
            }
        } else if (isGlutenDevice(device.type)) {
            if (isOffline || !(ctx instanceof AudioContext)) {
                continue;
            }
            // Gluten bus compressor — async WASM init + AudioWorkletNode
            try {
                const result = await createGlutenNode(ctx);
                await result.ready;
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
            } catch (error) {
                logger.warn(`Gluten device failed to load: ${error}`);
            }
        } else if (isBacteriaDevice(device.type)) {
            if (isOffline || !(ctx instanceof AudioContext)) {
                continue;
            }
            // Bacteria creative multi-effects — async WASM init + AudioWorkletNode
            try {
                const result = await createBacteriaNode(ctx);
                await result.ready;
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
            } catch (error) {
                logger.warn(`Bacteria device failed to load: ${error}`);
            }
        } else if (isGrinderDevice(device.type)) {
            if (isOffline || !(ctx instanceof AudioContext)) {
                continue;
            }
            // Grinder amp simulator — async WASM init + AudioWorkletNode
            try {
                const result = await createGrinderNode(ctx);
                await result.ready;
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
            } catch (error) {
                logger.warn(`Grinder device failed to load: ${error}`);
            }
        } else if (isProofDevice(device.type)) {
            if (isOffline || !(ctx instanceof AudioContext)) {
                continue;
            }
            // Proof mastering suite — async WASM init + AudioWorkletNode
            try {
                const result = await createProofNode(ctx);
                await result.ready;
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
            } catch (error) {
                logger.warn(`Proof mastering suite failed to load: ${error}`);
            }
        } else if (isScoringDevice(device.type)) {
            if (isOffline || !(ctx instanceof AudioContext)) {
                continue;
            }
            try {
                const result = await createScoringNode(ctx);
                await result.ready;
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
            } catch (error) {
                logger.warn(`Scoring tuner failed to load: ${error}`);
            }
        } else if (isFaustModule(device.type)) {
            if (isOffline) {
                continue;
            }
            // Faust DSP device — compile and instantiate
            dn = await createFaustDevice(ctx, device.type);
        } else {
            // Built-in Web Audio device — works in both real-time and offline contexts
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
