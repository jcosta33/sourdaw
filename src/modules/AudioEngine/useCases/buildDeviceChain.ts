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
import { isDesktopExternalPluginRuntime } from '../repositories/deviceStrategy/isDesktopExternalPluginRuntime';
import { isEngineHostedPluginDeviceType } from '../repositories/deviceStrategy/isEngineHostedPluginDeviceType';
import { isNodelessOfflineDeviceType } from '../repositories/deviceStrategy/nodelessOfflineDeviceTypes';
import { createDeviceRegistry, type AudioDeviceStrategy } from '../repositories/deviceStrategy/setupDeviceStrategies';
import { isUnrenderableCatalogDeviceType } from '../repositories/deviceStrategy/unrenderableCatalogDeviceTypes';
import { isUnsupportedDeviceTypeError } from '../repositories/deviceStrategy/unsupportedDeviceTypeError';
import { createFaustDevice } from '../repositories/faustDeviceFactory';

import { readLoadedExternalInstanceIds } from './livePlayback/readLoadedExternalInstanceIds';
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
    /**
     * Whether this device's output can reach the rendered file, copied from the
     * `contributesAudio` this chain build was handed.
     *
     * Required so a future constructor cannot leave it off and have an
     * automation refusal read `undefined` as "this strip prints": the offline
     * scheduler refuses an unrenderable lane only for a strip that prints
     * (#4424), and a silent omission would fail a render over an inaudible one.
     */
    contributesAudio: boolean;

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
    /**
     * The render's cancellation signal, when this chain belongs to a render
     * that owns user cancellation (#4440). `undefined` for callers that do not
     * (the freeze path): they keep the deadline-only backstop.
     */
    signal?: AbortSignal;
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

function exportCancelled(): Error {
    return createExportError('Export cancelled');
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
 * instead of bricking exporting.
 *
 * The deadline remains a backstop; cancellation is the `signal` (#4440). A render
 * that owns user cancellation — mixdown or stems, via
 * `beginExportCancellationScope` — threads its scope's signal in here, and
 * Cancel aborts an in-flight fetch at the moment it fires: before the setup
 * starts (no new work), while it pends (the fetch's own signal aborts), or after
 * it resolves (the late result is discarded). Cancellation then propagates as
 * `Export cancelled` rather than degrading the device, so the render never
 * reports success over work the user stopped. Callers without a signal — the
 * freeze path — keep the deadline-only behaviour this function always had.
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
async function runOfflineInstrumentSetup({
    device,
    port,
    logger,
    signal,
}: RunOfflineInstrumentSetupInput): Promise<void> {
    // An already-cancelled render starts no new work — not even a setup that
    // would resolve instantly, because the render's answer is already decided.
    if (signal?.aborted) {
        throw exportCancelled();
    }
    const controller = new AbortController();
    const deadline = setTimeout(() => {
        controller.abort();
    }, OFFLINE_INSTRUMENT_SETUP_TIMEOUT_MS);
    // The caller's cancellation aborts the same controller the deadline uses,
    // keeping the deadline independent: whichever fires first wins, and a
    // caller signal that never fires leaves the deadline exactly as it was.
    const callerAborts = () => {
        controller.abort();
    };
    signal?.addEventListener('abort', callerAborts);
    try {
        await getAudioDeviceRuntimeSink().prepareOfflineInstrument({
            deviceId: device.id,
            deviceType: device.type,
            deviceState: device.deviceState,
            port,
            signal: controller.signal,
        });
        // A setup that raced the cancellation button across its last await
        // must not count: its result belongs to a render that no longer wants
        // one, and letting it through would schedule and render a stem the
        // user watched stop.
        if (signal?.aborted) {
            throw exportCancelled();
        }
    } catch (error) {
        // Cancellation is not a setup failure. It propagates so the render
        // unwinds, the lock releases, and the dialog reports the cancel —
        // degrading the device to silence here would let the render continue
        // to a success it should never report.
        if (signal?.aborted) {
            throw exportCancelled();
        }
        // Deliberately swallowed: see why above. The node stays in the chain.
        logger.warn(
            `Offline setup failed for ${device.type} (${device.id}); it will render silent rather than be replaced: ${String(error)}`
        );
    } finally {
        signal?.removeEventListener('abort', callerAborts);
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
    /**
     * The owning render's cancellation signal (#4440), threaded from
     * `renderOffline`/`exportStems` through the strip build. Present only for
     * renders that own user cancellation; its effect is that an instrument
     * setup interrupted by Cancel unwinds the build with `Export cancelled`
     * instead of degrading the device and reporting success. Callers that pass
     * nothing keep the degrade-to-silent contract unchanged.
     */
    cancellationSignal?: AbortSignal;
};

/**
 * The user-visible reason this render cannot contain `device`, or `undefined`
 * when leaving the device out reproduces what the session plays.
 *
 * `loaded` is whether the device names an instance loaded on the desktop
 * runtime — a parameter snapshot exists for it in
 * `externalPluginParameterStore`, whether or not the native engine has
 * attached it yet. It decides the plugin arm, because a loaded instance
 * sounds live the moment the engine attaches it, which can happen after this
 * render already ran: a plugin loaded while the transport is parked has not
 * attached yet but sounds on the very next Play, so keying the refusal on the
 * narrower attach state would let that instance's offline render go dry. A
 * duplicated track, a track template, a never-loaded device and a
 * browser-build project (whose `loadPlugin` stub writes a snapshot but never
 * sounds, so the desktop-runtime gate excludes it) all carry an
 * `external-plugin` device with nothing loaded behind it, and
 * `TrackNode` then builds a unity pass-through that is silent in playback
 * too. Refusing over one of those would make a project unrenderable over a
 * device it never sounded.
 *
 * The wording names the *render* rather than one command: the same refusal
 * reaches the user through Export, Freeze, Bounce and the stems warning
 * channel, so "Export stopped" read as a lie on three of the four.
 */
function unrenderableDeviceRefusal(device: Device, trackLabel: string, loaded: boolean): string | undefined {
    if (isEngineHostedPluginDeviceType(device.type)) {
        if (!loaded) {
            return undefined;
        }
        return (
            `Track "${trackLabel}" hosts the plugin "${device.name}" (${device.type}), which only the native ` +
            `engine can render, so this render cannot include it. Bypass or remove the plugin to render without it.`
        );
    }
    if (isUnrenderableCatalogDeviceType(device.type)) {
        // Name it both ways: the rack chip the user has to find is labelled
        // with the display name, while the type is what a bug report or a
        // project file will show.
        return (
            `Track "${trackLabel}" uses the device "${device.name}" (${device.type}), which this build cannot ` +
            `render offline, so this render cannot include it. Remove the device from the track to render without it.`
        );
    }
    return undefined;
}

/**
 * Release the strategies this chain already built, before a refusal throws
 * past them.
 *
 * Every metered native device takes one of the shared 64 telemetry slots at
 * construction, and only its `destroy()` gives the slot back — the same reason
 * `destroyOfflineDeviceStrategies` exists for the success and failure paths of
 * a whole render. A refusal thrown out of the middle of a rack is the one exit
 * that helper cannot cover: the entries never reach the caller, so nothing
 * else can tear them down and the slots leak for the page session.
 *
 * A device that throws on the way out must not replace the refusal the user
 * needs to read, so each teardown is guarded and the loop carries on.
 */
function releaseBuiltStrategies(
    entries: readonly DeviceNodeEntry[],
    logger: { warn: (message: string) => void }
): void {
    for (const entry of entries) {
        try {
            entry.strategy.destroy?.();
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            logger.warn(
                `Device ${entry.deviceType} (${entry.deviceId}) threw while a refused render tore it down: ${reason}`
            );
        }
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
 * Device failures split three ways, and the split is about what the user loses,
 * not about which line threw:
 *
 * - Release admission refuses the device before construction. A withheld device
 *   is not a device that failed. The device
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
 * - An `external-plugin` device whose instance is loaded on the desktop
 *   runtime (`isEngineHostedPluginDeviceType` and
 *   `readLoadedExternalInstanceIds`) is the same refusal for a different
 *   reason: it is not a coverage hole, it is a device family this render path
 *   cannot reach at all. A loaded instance is *not* silent in live playback —
 *   once the engine attaches it, the native engine hosts and sounds it inline
 *   on its own audio callback, with the Web Audio graph carrying only a unity
 *   pass-through — so dropping it here would diverge from what the session
 *   actually plays, worst of all on freeze, where the resulting dry render
 *   replaces the audible track. A plugin loaded while the transport is parked
 *   has not attached yet but sounds on the very next Play, so the refusal
 *   keys on the load, not the narrower attach state. The native offline path
 *   cannot host a plugin instance either (it maps against an empty instance
 *   table by design), so there is no render to build toward yet; refusing
 *   until a bounce through the live engine exists is the honest behaviour.
 *
 *   The load state is the whole test, not the device type: a duplicated
 *   track, a track template and a browser-build project (whose `loadPlugin`
 *   stub writes a snapshot but never sounds, so the desktop-runtime gate
 *   excludes it) all carry the device with nothing loaded, and `TrackNode`
 *   gives it a unity pass-through that sounds nothing live either. Those
 *   degrade with the warning, exactly like the never-claimed types below.
 * - Everything else degrades and reaches the user through the export warning
 *   channel instead of only the log: a real implementation that failed at
 *   runtime (missing WASM asset, unavailable worklet, Faust compile error), and
 *   a device type the product does not claim at all. The latter is silent in
 *   live playback too — `TrackNode` returns without a node when no descriptor
 *   matches — so dropping it offline matches playback rather than diverging
 *   from it. Refusing there would make a project unexportable over a device it
 *   never sounded. (A stale factory-preset display name, e.g. `Drum Comp`, is
 *   this case, not the plugin case above.)
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

            // One snapshot for the whole chain, so every device in a rack is
            // judged against the same engine state. Taken here rather than per
            // device: the set is rebuilt from the store on each read, and a
            // rack that straddled two reads could refuse over one device and
            // degrade over another for reasons the user cannot see.
            const loadedInstanceIds = readLoadedExternalInstanceIds();
            // Static for the whole chain build too — the browser build's
            // `loadPlugin` stub writes a snapshot that never sounds, so a
            // loaded instance only means something live on the desktop runtime.
            const onDesktopRuntime = isDesktopExternalPluginRuntime();

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
                            await runOfflineInstrumentSetup({
                                device,
                                port: workletPort,
                                logger,
                                signal: context.cancellationSignal,
                            });
                        }
                    } catch (error) {
                        // Cancellation unwinds the build (#4440): the catch below
                        // degrades and continues, which is exactly wrong for a
                        // render the user stopped — it would hand back a chain
                        // missing a device and let the export report success.
                        // The signal, not the error's shape, decides: only a
                        // render that threaded one can take this exit, so the
                        // freeze path's degrade contract is untouched.
                        if (context.cancellationSignal?.aborted) {
                            releaseBuiltStrategies(entries, logger);
                            throw exportCancelled();
                        }
                        // Refuse only for a device the session is actually
                        // sounding — dropping one of those hands back a file the
                        // session does not play. A type the catalog does not know
                        // (a stale factory-preset display name), and a hosted
                        // plugin with nothing loaded, are both silent in live
                        // playback already, so dropping them offline reproduces
                        // playback exactly and degrades instead;
                        // `unrenderableDeviceRefusal` draws that line.
                        //
                        // A track whose audio cannot reach the file at all is never
                        // worth refusing over; see `contributesAudio`.
                        const loaded =
                            onDesktopRuntime &&
                            device.externalInstanceId !== undefined &&
                            loadedInstanceIds.has(device.externalInstanceId);
                        const refusal = unrenderableDeviceRefusal(device, trackLabel, loaded);
                        if (isUnsupportedDeviceTypeError(error) && contributesAudio && refusal !== undefined) {
                            releaseBuiltStrategies(entries, logger);
                            throw createExportError(refusal, error);
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
                    contributesAudio,
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
