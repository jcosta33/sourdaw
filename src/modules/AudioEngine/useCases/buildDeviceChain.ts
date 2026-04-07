import { logger } from '#/infra/logger/appLogger';
import { type Device } from '../models/TrackViewTypes';
import { type OfflineDeviceNode } from '../repositories/devices/types';
import { isDeviceSupportedOnCurrentPlatform } from '#/modules/Arrangement/useCases/isDeviceSupportedOnCurrentPlatform';
import { deviceRegistry, type AudioDeviceStrategy } from '../repositories/deviceStrategy/setupDeviceStrategies';

export type DeviceNodeEntry = {
    deviceId: string;
    deviceType: string;
    node: OfflineDeviceNode;
    strategy: AudioDeviceStrategy;

    // Kept for backwards compatibility with consumers until fully migrated
    nativeDsp?: {
        setParam: (name: string, value: number) => void;
        setBypass: (bypassed: boolean) => void;
    };
    instrumentControls?: {
        noteOn: (noteOrPad: number, velocity: number, midiNote?: number) => void;
        noteOff: (noteOrPad: number) => void;
    };
};

export type BuildDeviceChainOutput = DeviceNodeEntry[];

/**
 * Build an audio device chain, connecting devices between input and output nodes.
 *
 * Supports three device backends via the unified DeviceFactoryRegistry:
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
            continue;
        }

        let strategy: AudioDeviceStrategy | null = null;
        try {
            strategy = await deviceRegistry.createDevice(ctx, device);
        } catch (error) {
            logger.warn(`Device ${device.type} failed to load: ${error}`);
            continue;
        }

        if (!strategy) {
            continue;
        }

        const dn = strategy.node;

        // Instrument devices (Fermenter, Toaster, Levain) have 0 inputs — they
        // are audio sources, not pass-through effects. Route their output INTO
        // the current chain position (trackGain) so:
        //   Instrument.output → trackGain → [effects] → trackPan → destination
        // This preserves gain/pan automation on the instrument's output.
        const isSourceNode = dn.inputNode instanceof AudioWorkletNode && dn.inputNode.numberOfInputs === 0;
        if (isSourceNode) {
            dn.outputNode.connect(prev);
            // Don't advance `prev` — subsequent effects chain from trackGain forward
        } else {
            prev.connect(dn.inputNode);
            prev = dn.outputNode;
        }

        entries.push({
            deviceId: device.id,
            deviceType: device.type,
            node: dn,
            strategy,
            // Proxies for legacy support (to be phased out completely soon)
            nativeDsp: {
                setParam: (name, value) => strategy!.setParam(name, value),
                setBypass: (bypassed) => strategy!.setBypass?.(bypassed),
            },
            instrumentControls: {
                noteOn: (note, vel, midi) => strategy!.noteOn?.(note, vel, midi),
                noteOff: (note) => strategy!.noteOff?.(note),
            },
        });
    }

    prev.connect(outputNode);
    return entries;
}
