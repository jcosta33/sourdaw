import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { compileFaustDSP, createFaustNode, isFaustModule } from '#/modules/PluginHost/useCases';

import { isPluginRequiresIsolationError } from '../engine/pluginHostingErrors';
import { type Device } from '../models/TrackViewTypes';
import { type OfflineDeviceNode } from '../repositories/devices/types';
import { createDeviceRegistry, type AudioDeviceStrategy } from '../repositories/deviceStrategy/setupDeviceStrategies';
import { createFaustDevice } from '../repositories/faustDeviceFactory';

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
        noteOn: (noteOrPad: number, velocity: number, midiNote?: number, sampleFrame?: number) => void;
        noteOff: (noteOrPad: number, sampleFrame?: number) => void;
    };
};

export type BuildDeviceChainOutput = DeviceNodeEntry[];

const deviceRegistry = createDeviceRegistry({
    faustModuleMatcher: isFaustModule,
    createFaustDevice: ({ ctx, faustModuleId }) =>
        createFaustDevice({
            ctx,
            faustModuleId,
            compileFaustDSP,
            createFaustNode,
        }),
});

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
export const buildDeviceChain = inject({ logger })(
    ({ logger }) =>
        async function buildDeviceChain(
            ctx: BaseAudioContext,
            devices: Device[],
            inputNode: AudioNode,
            outputNode: AudioNode
        ): Promise<BuildDeviceChainOutput> {
            // Yeast is a MIDI processor discovered from track.devices by the schedulers;
            // it deliberately has no audio-node factory and must not enter this chain.
            const activeDevices = devices.filter((device) => !device.bypassed && device.type !== 'yeast');
            if (activeDevices.length === 0) {
                inputNode.connect(outputNode);
                return [];
            }

            const entries: DeviceNodeEntry[] = [];
            let prev: AudioNode = inputNode;

            for (const device of activeDevices) {
                let strategy: AudioDeviceStrategy | null = null;
                try {
                    strategy = await deviceRegistry.createDevice(ctx, device);
                } catch (error) {
                    // When the plugin fails because it requires cross-origin
                    // isolation (SharedArrayBuffer), surface a user-visible message —
                    // otherwise the device chain silently skipping the node is
                    // invisible. Other failures stay at `warn` to avoid noise for
                    // routine issues (missing assets, stale worklets during HMR, etc.).
                    if (isPluginRequiresIsolationError(error)) {
                        logger.error(error);
                    } else {
                        logger.warn(`Device ${device.type} failed to load: ${error}`);
                    }
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
                const isWorklet = typeof AudioWorkletNode !== 'undefined' && dn.inputNode instanceof AudioWorkletNode;
                const isSourceNode = isWorklet && dn.inputNode.numberOfInputs === 0;
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
                        setParam: (name, value) => strategy.setParam(name, value),
                        setBypass: (bypassed) => strategy.setBypass?.(bypassed),
                    },
                    // Only devices that actually voice notes get a note surface.
                    // Attaching it unconditionally made every first device in a
                    // chain look like an instrument to the offline scheduler, so
                    // a MIDI track carrying only effects routed its notes into a
                    // no-op instead of the fallback synth (MD-4).
                    instrumentControls: strategy.noteOn
                        ? {
                              noteOn: (note, vel, midi, sampleFrame) => strategy.noteOn?.(note, vel, midi, sampleFrame),
                              noteOff: (note, sampleFrame) => strategy.noteOff?.(note, sampleFrame),
                          }
                        : undefined,
                });
            }

            prev.connect(outputNode);
            return entries;
        }
);
