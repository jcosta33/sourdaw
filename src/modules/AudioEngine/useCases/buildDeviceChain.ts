import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { isDeviceReleaseAdmitted } from '#/infra/release/deviceReleaseAdmission';
import {
    compileFaustDSP,
    createFaustNode,
    isFaustInstrumentModule,
    isFaustModule,
} from '#/modules/PluginHost/useCases';

import { getAudioDeviceRuntimeSink } from '../engine/audioDeviceRuntimeSink';
import { isPluginRequiresIsolationError } from '../engine/pluginHostingErrors';
import { createExportError } from '../errors/ExportError';
import { type Device } from '../models/TrackViewTypes';
import { type OfflineDeviceNode } from '../repositories/devices/types';
import {
    type DeviceNoteOffRequest,
    type DeviceNoteOnRequest,
} from '../repositories/deviceStrategy/AudioDeviceStrategy';
import { createWithheldDeviceStrategy } from '../repositories/deviceStrategy/createWithheldDeviceStrategy';
import { isNodelessOfflineDeviceType } from '../repositories/deviceStrategy/nodelessOfflineDeviceTypes';
import { createDeviceRegistry, type AudioDeviceStrategy } from '../repositories/deviceStrategy/setupDeviceStrategies';
import { isUnrenderableCatalogDeviceType } from '../repositories/deviceStrategy/unrenderableCatalogDeviceTypes';
import { isUnsupportedDeviceTypeError } from '../repositories/deviceStrategy/unsupportedDeviceTypeError';
import { createFaustDevice } from '../repositories/faustDeviceFactory';

import { isOfflineInstrumentDevice } from './offlineRender/isOfflineInstrumentDevice';

export type DeviceNodeEntry = {
    deviceId: string;
    deviceType: string;
    node: OfflineDeviceNode;
    strategy: AudioDeviceStrategy;
    /**
     * True when release admission refused this device and the entry is the
     * silent stand-in `createWithheldDeviceStrategy` built for it.
     *
     * Read rather than re-derived from `track.devices`, because it states what
     * this render actually put in the graph. A caller that asked admission
     * again would be a second source of truth that agrees today and drifts the
     * day the two questions are asked at different points.
     */
    releaseWithheld?: true;

    // Kept for backwards compatibility with consumers until fully migrated
    nativeDsp?: {
        setParam: (name: string, value: number) => void;
        setBypass: (bypassed: boolean) => void;
    };
    instrumentControls?: {
        noteOn: (request: DeviceNoteOnRequest) => void;
        noteOff: (request: DeviceNoteOffRequest) => void;
    };
};

export type BuildDeviceChainOutput = DeviceNodeEntry[];

const deviceRegistry = createDeviceRegistry({
    faustModuleMatcher: isFaustModule,
    faustInstrumentMatcher: isFaustInstrumentModule,
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
            deviceState: device.deviceState,
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

export type BuildDeviceChainContext = {
    /** Track name, used only to make a failure message locatable by the user. */
    trackName?: string;
    /** The export's user-visible warning channel, for degraded devices. */
    onWarning?: (message: string) => void;
    /**
     * Whether anything this chain produces can reach the rendered file.
     *
     * A mixdown builds a strip for every non-disabled track so the routing
     * graph matches live, but only schedules the tracks that are audible or
     * feed a pre-fader cue send. A strip that is built and never scheduled
     * contributes silence by construction, so an unrenderable device on it
     * cannot make the file differ from the session — there is nothing to
     * refuse over. Pass `false` for those and the failure degrades to a
     * warning. Defaults to `true`: a caller that says nothing is assumed to be
     * rendering the track.
     */
    contributesAudio?: boolean;
};

/**
 * Build an audio device chain, connecting devices between input and output nodes.
 *
 * Supports three device backends via the unified DeviceFactoryRegistry:
 * 1. Built-in Web Audio devices (synchronous)
 * 2. Faust DSP devices (async compilation + AudioWorkletNode)
 * 3. Native Rust/WASM DSP devices (async WASM init + AudioWorkletNode)
 *
 * Device failures split three ways, and the split is about what the user loses,
 * not about which line threw:
 *
 * - Release admission refuses the device (ADR 0032). This is decided *before*
 *   construction and never reaches the catch below, because a withheld device
 *   is not a device that failed: withholding is permanent, and the projects
 *   that carry the device are the ordinary case rather than an edge. The device
 *   stays in the chain as a silent stand-in, so the offline scheduler still
 *   sees an instrument and does not substitute the fallback synth for it. See
 *   `createWithheldDeviceStrategy`.
 * - The product claims this device and we cannot render it offline
 *   (`UnsupportedDeviceTypeError` on a type listed in
 *   `unrenderableCatalogDeviceTypes`). The export fails. It used to warn and
 *   continue, which produced a file that did not contain what the session
 *   plays: the device was dropped, and because `scheduleTrackClips` then found
 *   no `instrumentControls`, an unrenderable *instrument* came back as the
 *   builtin fallback synth (sawtooth at 0.3) — wrong in a way that sounds
 *   deliberate. A render must contain what playback contains.
 * - Everything else degrades and reaches the user through the export warning
 *   channel instead of only the log: a real implementation that failed at
 *   runtime (missing WASM asset, unavailable worklet, Faust compile error), and
 *   a device type the product does not claim at all. The latter is silent in
 *   live playback too — `TrackNode` returns without a node when no descriptor
 *   matches — so dropping it offline matches playback rather than diverging
 *   from it. Refusing there would make a project unexportable over a device it
 *   never sounded.
 *
 * Device types rendered by another offline path never reach either branch; see
 * `isNodelessOfflineDeviceType`.
 */
export const buildDeviceChain = inject({ logger })(
    ({ logger }) =>
        async function buildDeviceChain(
            ctx: BaseAudioContext,
            devices: Device[],
            inputNode: AudioNode,
            outputNode: AudioNode,
            context: BuildDeviceChainContext = {}
        ): Promise<BuildDeviceChainOutput> {
            const trackLabel = context.trackName ?? 'unknown track';
            const contributesAudio = context.contributesAudio ?? true;
            // Some devices render offline through the note or kit scheduler and
            // deliberately have no audio-node factory. They are named and
            // justified individually — an unlisted type that cannot be built is
            // a defect, not something to route around.
            const activeDevices = devices.filter(
                (device) => !device.bypassed && !isNodelessOfflineDeviceType(device.type)
            );
            if (activeDevices.length === 0) {
                inputNode.connect(outputNode);
                return [];
            }

            const entries: DeviceNodeEntry[] = [];
            let prev: AudioNode = inputNode;

            for (const device of activeDevices) {
                let strategy: AudioDeviceStrategy;
                let releaseWithheld = false;
                // Asked before construction, and deliberately not folded into
                // the catch below. `findReleasedNativeDspDeviceFactory` returns
                // nothing for a withheld type, so the registry would throw a
                // plain `Error` here and the degrade branch could not tell
                // "withheld by policy" from "failed to load" — which is exactly
                // how a withheld instrument came back as the fallback synth.
                if (!isDeviceReleaseAdmitted(device.type)) {
                    strategy = createWithheldDeviceStrategy(ctx, {
                        acceptsNotes: isOfflineInstrumentDevice(device.type),
                    });
                    releaseWithheld = true;
                    // Named as withholding rather than as a load failure: the
                    // user can act on the first (the device is gone from this
                    // build) and cannot act on the second.
                    context.onWarning?.(
                        `Device "${device.type}" on track "${trackLabel}" is withheld from this build. Its project ` +
                            `data is preserved, but it renders silent and the export does not contain it.`
                    );
                } else {
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
                        // Refuse only when the product claims this device and we
                        // cannot render it — that is the case where dropping it
                        // hands back a file the session does not play. A type the
                        // catalog does not know (a stale preset string, a
                        // third-party plugin an OfflineAudioContext cannot host) is
                        // already silent in live playback, so dropping it offline
                        // reproduces playback exactly and degrades instead.
                        //
                        // A track whose audio cannot reach the file at all is never
                        // worth refusing over; see `contributesAudio`.
                        if (
                            isUnsupportedDeviceTypeError(error) &&
                            contributesAudio &&
                            isUnrenderableCatalogDeviceType(device.type)
                        ) {
                            // Name it both ways: the rack chip the user has to find
                            // is labelled with the display name, while the type is
                            // what a bug report or a project file will show.
                            throw createExportError(
                                `Track "${trackLabel}" uses the device "${device.name}" (${device.type}), which this ` +
                                    `build cannot render offline. Export stopped rather than producing a file without ` +
                                    `it. Remove the device from the track to export.`,
                                error
                            );
                        }
                        // When the plugin fails because it requires cross-origin
                        // isolation (SharedArrayBuffer), surface a user-visible message —
                        // otherwise the device chain silently skipping the node is
                        // invisible. Other failures stay at `warn` to avoid noise for
                        // routine issues (missing assets, stale worklets during HMR, etc.).
                        let detail = String(error);
                        if (error instanceof Error) {
                            detail = error.message;
                        }
                        if (isPluginRequiresIsolationError(error)) {
                            logger.error(error);
                        } else {
                            logger.warn(`Device ${device.type} failed to load: ${detail}`);
                        }
                        // A degraded device is still missing from the render, so the
                        // user has to hear about it from the export, not the console.
                        context.onWarning?.(
                            `Device "${device.type}" on track "${trackLabel}" could not be loaded and is missing from ` +
                                `the export: ${detail}`
                        );
                        continue;
                    }
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
                    ...(releaseWithheld ? { releaseWithheld: true as const } : {}),
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
                    //
                    // The gate is the strategy's own `acceptsNotes` declaration,
                    // not `strategy.noteOn`. Reading the method back only looked
                    // like the same question: `NativeDspDeviceStrategy` declares
                    // `noteOn` on its prototype and forwards to an optional one
                    // on the DSP node, so the check passed for every native
                    // effect — Gluten, Proof, Bacteria — and the first of them
                    // in a rack took the track's notes into a no-op while the
                    // real instrument behind it rendered silent.
                    instrumentControls: strategy.acceptsNotes
                        ? {
                              noteOn: (request) => strategy.noteOn?.(request),
                              noteOff: (request) => strategy.noteOff?.(request),
                          }
                        : undefined,
                });
            }

            prev.connect(outputNode);
            return entries;
        }
);
