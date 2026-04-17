import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { hasSharedArrayBuffer } from '#/utils/capabilities';
import { type Device } from '../models/TrackViewTypes';
import { type OfflineDeviceNode } from '../repositories/devices/types';
import { deviceRegistry, type AudioDeviceStrategy } from '../repositories/deviceStrategy/setupDeviceStrategies';
import { isPluginRequiresIsolationError } from '../engine/pluginHostingErrors';

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
            const activeDevices = devices.filter((d) => !d.bypassed);
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
                        // When SharedArrayBuffer is globally unavailable, the
                        // `CapabilityBanner` at the top of AppShell already
                        // tells the user — all SAB-backed plugins will fail
                        // equally, so per-plugin toasts would just spam. The
                        // per-insert toast remains useful in the rare case
                        // where SAB is present but some other isolation
                        // prerequisite is missing.
                        if (hasSharedArrayBuffer()) {
                            notifyUser(
                                `${error.pluginName} could not load: this plugin needs cross-origin isolation. ` +
                                    'If you hit this in dev, restart the dev server after editing vite.config.ts; ' +
                                    'otherwise check COOP/COEP headers on the host.',
                                'error'
                            );
                        }
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
                        noteOn: (note, vel, midi, sampleFrame) => strategy!.noteOn?.(note, vel, midi, sampleFrame),
                        noteOff: (note, sampleFrame) => strategy!.noteOff?.(note, sampleFrame),
                    },
                });
            }

            prev.connect(outputNode);
            return entries;
        }
);
