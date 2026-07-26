import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { compileFaustDSP, createFaustNode, isFaustModule } from '#/modules/PluginHost/useCases';

import { getAudioDeviceRuntimeSink } from '../engine/audioDeviceRuntimeSink';
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

/** How long one device's offline setup may run before it is abandoned. */
const OFFLINE_INSTRUMENT_SETUP_TIMEOUT_MS = 30_000;

type RunOfflineInstrumentSetupInput = {
    device: Device;
    port: MessagePort;
    /** The chain's injected logger, so a swallowed failure is still reported. */
    logger: { warn: (message: string) => void };
};

/**
 * The worklet port a module needs to talk to its own engine, or `null` for a
 * device that is not worklet-backed (built-in Web Audio graphs, and any
 * environment without `AudioWorkletNode` at all).
 */
function resolveWorkletPort(node: AudioNode): MessagePort | null {
    if (typeof AudioWorkletNode === 'undefined') {
        return null;
    }
    if (!(node instanceof AudioWorkletNode)) {
        return null;
    }
    return node.port;
}

/**
 * Run a device's offline setup under a deadline, and never let its failure remove
 * the device from the chain.
 *
 * Both halves are load-bearing.
 *
 * The deadline exists because nothing below here was cancellable: the sample fetch
 * is a bare `await`, `renderWithTimeout` only guards `startRendering` much later,
 * and `renderOffline` releases the render lock in a `finally`. A response that
 * never settles therefore never released the lock, and every subsequent export —
 * mixdown or stems, both take the same lock — failed with "an export is already in
 * progress" until the app was reloaded. A stalled network now ends the load
 * instead of bricking exporting. It is a backstop, not cancellation: pressing
 * Cancel during a load still does nothing, because the cancel flag is read between
 * tracks and aborts no in-flight fetch. Wiring that up means threading the
 * export's own `AbortSignal` from `renderOffline` into this call, which is a
 * separate change.
 *
 * The catch exists because throwing here is worse than failing. The call site is
 * inside the chain's device-creation `try`, so an exception is caught there,
 * logged, and the device is skipped with a `continue`. Its entry — and with it
 * `instrumentControls` — never reaches the caller, and `scheduleTrackClips` reads
 * that absence as "this track has no instrument" and falls through to
 * `getSynthParamsFromDevices`, whose builtin default is a sawtooth at 0.3 gain.
 * An orchestral part then bounces as a synth lead while the export reports
 * success. Degrading to an unconfigured-but-present node means the track renders
 * silent instead, which is a symptom a user reports rather than one they ship.
 * Silence is recoverable; a plausible wrong instrument is not.
 *
 * Do not read that catch as Levain's live failure path — it is not, and assuming
 * so will mislead you. `prepareOfflineLevain` delegates to `autoLoadLevainSamples`,
 * which catches its own load failures, records them on the device's panel and
 * resolves normally; a broken Levain manifest therefore never reaches here. This
 * catch is defence in depth for the seam itself: the next device type wired onto
 * `prepareOfflineInstrument` gets the guarantee without having to rediscover why
 * it is needed. `buildDeviceChainOfflineInstrumentSetup.spec.ts` pins it with a
 * sink that rejects outright.
 */
async function runOfflineInstrumentSetup({ device, port, logger }: RunOfflineInstrumentSetupInput): Promise<void> {
    const controller = new AbortController();
    const deadline = setTimeout(() => {
        controller.abort();
    }, OFFLINE_INSTRUMENT_SETUP_TIMEOUT_MS);
    try {
        await getAudioDeviceRuntimeSink().prepareOfflineInstrument({
            deviceId: device.id,
            deviceType: device.type,
            port,
            signal: controller.signal,
        });
    } catch (error) {
        // Deliberately swallowed: see why above. The node stays in the chain.
        logger.warn(
            `Offline setup failed for ${device.type} (${device.id}); it will render silent rather than be replaced: ${String(error)}`
        );
    } finally {
        clearTimeout(deadline);
    }
}

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

                    // A device's `parameterValues` are only the numeric half of
                    // its state. Everything an instrument needs beyond plain
                    // params — for Levain its instrument identity and its sample
                    // zones — is done by the live descriptors in
                    // `wasmDeviceRegistry`, which this path never touches:
                    // offline construction and live construction are two
                    // registries, not one builder with a flag. Levain therefore
                    // exported digital silence, playing an unconfigured engine
                    // with no zones. This is where the offline chain asks the
                    // owning module for that setup, and — unlike live
                    // registration, which is deliberately fire-and-forget —
                    // waits for it, because an `OfflineAudioContext` renders
                    // faster than real time and a load that is merely started
                    // never lands.
                    //
                    // It sits inside this `try` deliberately, so the failure
                    // domain of "this device could not be set up" is the same as
                    // "this device could not be built". `runOfflineInstrumentSetup`
                    // is what keeps that domain from being entered.
                    const workletPort = resolveWorkletPort(strategy.node.inputNode);
                    if (workletPort) {
                        await runOfflineInstrumentSetup({ device, port: workletPort, logger });
                    }
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
