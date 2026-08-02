/**
 * Registry of async WASM device descriptors.
 *
 * Each descriptor encapsulates the full async load sequence for one plugin
 * (loading bypass, pending-params queue, WASM init, swap-in, side effects).
 * TrackNode.addDevice() resolves the right descriptor and calls create(),
 * eliminating the 10 type-guard branches.
 */

import { logger } from '#/infra/logger/appLogger';
import { isFaustModule } from '#/modules/PluginHost/useCases';

import { type BuiltinDeviceNode } from '../models/AudioEngineState';
import { createFaustDeviceNode } from '../useCases/deviceResolvers/createFaustDeviceNode';
import { clearReportedLatency } from '../useCases/latencyCompensation/compensation/clearReportedLatency';
import { reportLatency } from '../useCases/latencyCompensation/compensation/reportLatency';

import { getAudioDeviceRuntimeSink } from './audioDeviceRuntimeSink';
import { isBacteriaDevice, createBacteriaNode, type BacteriaNodeResult } from './BacteriaNode';
import { isCrumbsDevice, createCrumbsNode, type CrumbsNodeResult } from './CrumbsNode';
import { isFermenterDevice, createFermenterNode, type FermenterNodeResult } from './FermenterNode';
import { isGlutenDevice, createGlutenNode, type GlutenNodeResult } from './GlutenNode';
import { isGrandBouleDevice, createGrandBouleNode, type GrandBouleNodeResult } from './GrandBouleNode';
import { isGrinderDevice, createGrinderNode, type GrinderNodeResult } from './GrinderNode';
import { isKneadDevice, createKneadNode, type KneadNodeResult } from './KneadNode';
import { isLevainDevice, createLevainNode, type LevainNodeResult } from './LevainNode';
import { isProofChamberDevice, createProofChamberNode, type ProofChamberNodeResult } from './ProofChamberNode';
import { isProofDevice, createProofNode, type ProofNodeResult } from './ProofNode';
import { isScoringDevice, createScoringNode, type ScoringNodeResult } from './ScoringNode';
import { isToasterDevice, createToasterNode, type ToasterNodeResult } from './ToasterNode';

// ── Types ────────────────────────────────────────────────────────────────────

export type WasmDeviceCreateDeps = {
    context: AudioContext;
    deviceId: string;
    deviceType: string;
    transportSAB?: SharedArrayBuffer;
    isCurrent?: () => boolean;
    signal?: AbortSignal;
    /** Returns false when the owner rejected and destroyed a stale loaded node. */
    onLoaded: (finalDn: BuiltinDeviceNode) => boolean | void;
    /** Replace a terminally failed loaded node in the owning graph slot. */
    onRuntimeFailure?: (failedDn: BuiltinDeviceNode, replacementDn: BuiltinDeviceNode) => boolean;
};

export type WasmDeviceDescriptor = {
    matches(deviceType: string): boolean;
    create(deps: WasmDeviceCreateDeps): {
        placeholder: BuiltinDeviceNode;
        loadPromise: Promise<void>;
    };
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadingBypassNode(context: AudioContext, deviceId: string, deviceType: string): BuiltinDeviceNode {
    const node = context.createGain();
    return { deviceId, type: deviceType, nodes: [node], inputNode: node, outputNode: node };
}

type WaitForDeviceReadyInput = {
    deviceType: string;
    result: { destroy: () => void; ready: Promise<Record<string, unknown>> };
    signal?: AbortSignal;
};

async function waitForDeviceReady(input: WaitForDeviceReadyInput): Promise<Record<string, unknown> | null> {
    const { deviceType, result, signal } = input;
    let disposed = false;
    const disposeResult = (): void => {
        if (disposed) {
            return;
        }
        disposed = true;
        try {
            result.destroy();
        } catch (cleanupError) {
            logger.warn(`[WebAudioEngine] ${deviceType} readiness cleanup failed: ${String(cleanupError)}`);
        }
    };

    if (signal?.aborted) {
        disposeResult();
        return null;
    }

    let resolveAbort: () => void = () => {};
    const aborted = new Promise<null>((resolve) => {
        resolveAbort = () => resolve(null);
    });
    const handleAbort = (): void => {
        disposeResult();
        resolveAbort();
    };
    signal?.addEventListener('abort', handleAbort, { once: true });

    try {
        const readyData = await Promise.race([result.ready, aborted]);
        if (signal?.aborted) {
            return null;
        }
        return readyData;
    } catch (error) {
        disposeResult();
        throw error;
    } finally {
        signal?.removeEventListener('abort', handleAbort);
    }
}

// ── Descriptors ──────────────────────────────────────────────────────────────

const fermenterDescriptor: WasmDeviceDescriptor = {
    matches: isFermenterDevice,
    create({ context, deviceId, deviceType, signal, onLoaded }) {
        const pendingParams: Array<[string, number | number[]]> = [];
        let pendingPatch: Record<string, unknown> | null = null;
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        placeholder.fermenterControls = {
            ready: false,
            noteOn: () => {},
            noteOff: () => {},
            noteExpression: () => {},
            allNotesOff: () => {},
            setParam: (name, value) => {
                pendingParams.push([name, value]);
            },
            setPatch: (patch) => {
                pendingPatch = patch;
            },
            setBypass: () => {},
            destroy: () => {},
        };
        const loadPromise = createFermenterNode(context, undefined, signal)
            .then(async (result: FermenterNodeResult) => {
                if ((await waitForDeviceReady({ deviceType, result, signal })) === null) {
                    return;
                }
                for (const [name, value] of pendingParams) {
                    result.setParam(name, value);
                }
                if (pendingPatch) {
                    result.setPatch(pendingPatch);
                }
                result.onTelemetry((data) => {
                    getAudioDeviceRuntimeSink().setFermenterTelemetry(deviceId, data);
                });
                onLoaded({
                    deviceId,
                    type: deviceType,
                    nodes: [result.workletNode],
                    inputNode: result.workletNode,
                    outputNode: result.workletNode,
                    dispose: result.destroy,
                    controller: {
                        ready: true,
                        noteOn: result.noteOn,
                        noteOff: result.noteOff,
                        allNotesOff: result.allNotesOff,
                        setParam: result.setParam,
                        setPatch: result.setPatch,
                        setBypass: result.setBypass,
                        destroy: result.destroy,
                    },
                    fermenterControls: {
                        ready: true,
                        noteOn: result.noteOn,
                        noteOff: result.noteOff,
                        noteExpression: result.noteExpression,
                        allNotesOff: result.allNotesOff,
                        setParam: result.setParam,
                        setPatch: result.setPatch,
                        setBypass: result.setBypass,
                        destroy: result.destroy,
                    },
                });
                return;
            })
            .catch((error) => {
                logger.warn(`[WebAudioEngine] ${deviceType} failed: ${error}`);
                return;
            });
        return { placeholder, loadPromise };
    },
};

const toasterDescriptor: WasmDeviceDescriptor = {
    matches: isToasterDevice,
    create({ context, deviceId, deviceType, signal, onLoaded, onRuntimeFailure: replaceRuntimeFailure }) {
        const pendingParams: Array<[string, number]> = [];
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        let runtimeFailureMessage: string | null = null;
        let publishedNode: BuiltinDeviceNode | null = null;
        let publishedResult: ToasterNodeResult | null = null;
        let runtimeFailureHandled = false;
        const applyRuntimeFailure = (): void => {
            if (
                runtimeFailureHandled ||
                runtimeFailureMessage === null ||
                publishedNode === null ||
                publishedResult === null
            ) {
                return;
            }
            runtimeFailureHandled = true;
            if (publishedNode.controller) {
                publishedNode.controller.ready = false;
            }
            if (publishedNode.toasterControls) {
                publishedNode.toasterControls.ready = false;
            }
            pendingParams.length = 0;
            if (placeholder.toasterControls) {
                placeholder.toasterControls.setParam = () => {};
            }
            const replaced = replaceRuntimeFailure?.(publishedNode, placeholder) === true;
            publishedResult.destroy();
            if (replaced) {
                getAudioDeviceRuntimeSink().emitDeviceRemoved({ deviceId, deviceType });
            }
        };
        const onRuntimeFailure = (message: string): void => {
            if (runtimeFailureMessage !== null) {
                return;
            }
            runtimeFailureMessage = message;
            logger.warn(`[WebAudioEngine] ${deviceType} runtime failure: ${message}`);
            applyRuntimeFailure();
        };
        placeholder.toasterControls = {
            ready: false,
            noteOn: () => {},
            noteOff: () => {},
            scheduleHit: () => {},
            cancelScheduled: () => {},
            allNotesOff: () => {},
            setFillActive: () => {},
            setParam: (name, value) => {
                pendingParams.push([name, value]);
            },
            setPadParam: () => {},
            setPadDryRouted: () => {},
            setBypass: () => {},
            destroy: () => {},
        };
        const loadPromise = createToasterNode(context, undefined, onRuntimeFailure, signal)
            .then(async (result: ToasterNodeResult) => {
                if ((await waitForDeviceReady({ deviceType, result, signal })) === null) {
                    return;
                }
                if (runtimeFailureMessage !== null) {
                    result.destroy();
                    return;
                }
                for (const [name, value] of pendingParams) {
                    result.setParam(name, value);
                }
                const loadedNode: BuiltinDeviceNode = {
                    deviceId,
                    type: deviceType,
                    // Keep the stable output proxy at the graph boundary, while
                    // retaining the worklet for lifecycle sweeps such as the
                    // transport-wide all-notes-off release.
                    nodes: [result.outputNode, result.workletNode],
                    inputNode: result.outputNode,
                    outputNode: result.outputNode,
                    isGenerator: true,
                    processorLifecycle: result.processorLifecycle,
                    dispose: result.destroy,
                    controller: {
                        ready: true,
                        noteOn: result.noteOn,
                        noteOff: result.noteOff,
                        allNotesOff: result.allNotesOff,
                        setParam: result.setParam,
                        setPadParam: result.setPadParam,
                        setBypass: result.setBypass,
                        destroy: () => {
                            result.destroy();
                            // Signal teardown so the Toaster module disposes the device:
                            // stop the sequencer, note-repeat and 16-Levels sessions and
                            // cancel any queued rAF pad-param flush, then delete the store
                            // record. Emitted (not called directly) to keep the boundary
                            // acyclic — AudioEngine must not statically import the Toaster
                            // useCases barrel, whose closure reaches back into AudioEngine
                            // (would be a no-circular error). The Toaster subscriber runs
                            // disposeToasterDevice synchronously on this emit, mirroring the
                            // audioDevice.loaded hydration path. A bare store delete (the
                            // prior behavior) left a running:true sequencer re-arming ghost
                            // hits after the device was gone.
                            getAudioDeviceRuntimeSink().emitDeviceRemoved({ deviceId, deviceType });
                        },
                    },
                    toasterControls: {
                        ready: true,
                        noteOn: result.noteOn,
                        noteOff: result.noteOff,
                        scheduleHit: result.scheduleHit,
                        cancelScheduled: result.cancelScheduled,
                        allNotesOff: result.allNotesOff,
                        setFillActive: result.setFillActive,
                        setParam: result.setParam,
                        setPadParam: result.setPadParam,
                        setPadDryRouted: result.setPadDryRouted,
                        setBypass: result.setBypass,
                        connectPadOutput: result.connectPadOutput,
                        disconnectPadOutput: result.disconnectPadOutput,
                        destroy: result.destroy,
                    },
                };
                const accepted = onLoaded(loadedNode);
                if (accepted === false) {
                    return;
                }
                publishedNode = loadedNode;
                publishedResult = result;
                applyRuntimeFailure();
                if (runtimeFailureHandled) {
                    return;
                }
                getAudioDeviceRuntimeSink().emitDeviceLoaded({ deviceId, deviceType });
                return;
            })
            .catch((error) => {
                logger.warn(`[WebAudioEngine] ${deviceType} failed: ${error}`);
                return;
            });
        return { placeholder, loadPromise };
    },
};

const levainDescriptor: WasmDeviceDescriptor = {
    matches: isLevainDevice,
    create({ context, deviceId, deviceType, signal, onLoaded }) {
        const pendingParams: Array<[string, number]> = [];
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        placeholder.levainControls = {
            ready: false,
            noteOn: () => {},
            noteOff: () => {},
            noteExpression: () => {},
            allNotesOff: () => {},
            handleCc: () => {},
            setParam: (name, value) => {
                pendingParams.push([name, value]);
            },
            setBypass: () => {},
            destroy: () => {},
        };
        const loadPromise = createLevainNode(
            context,
            undefined,
            () => {
                // A post-ready worklet fault (WASM panic) silences the processor while
                // the node stays alive. Reflect it into engineReady so the panel LED
                // stops showing "Ready"; the Levain sink no-ops if the device was
                // already torn down.
                getAudioDeviceRuntimeSink().setLevainEngineReady({ deviceId, isReady: false });
            },
            signal
        )
            .then(async (result: LevainNodeResult) => {
                if ((await waitForDeviceReady({ deviceType, result, signal })) === null) {
                    return;
                }
                for (const [name, value] of pendingParams) {
                    result.setParam(name, value);
                }
                const accepted = onLoaded({
                    deviceId,
                    type: deviceType,
                    nodes: [result.workletNode],
                    inputNode: result.workletNode,
                    outputNode: result.workletNode,
                    dispose: result.destroy,
                    controller: {
                        ready: true,
                        noteOn: result.noteOn,
                        noteOff: result.noteOff,
                        allNotesOff: result.allNotesOff,
                        handleCc: result.handleCc,
                        setParam: result.setParam,
                        setBypass: result.setBypass,
                        destroy: () => {
                            result.destroy();
                            try {
                                getAudioDeviceRuntimeSink().unregisterLevainDevice(deviceId);
                            } catch {
                                // Intentionally empty: the device may already be
                                // unregistered from the Levain store; teardown proceeds.
                            }
                        },
                    },
                    levainControls: {
                        ready: true,
                        noteOn: result.noteOn,
                        noteOff: result.noteOff,
                        noteExpression: result.noteExpression,
                        allNotesOff: result.allNotesOff,
                        handleCc: result.handleCc,
                        setParam: result.setParam,
                        setBypass: result.setBypass,
                        destroy: result.destroy,
                    },
                });
                if (accepted === false) {
                    return;
                }
                getAudioDeviceRuntimeSink().registerLevainDevice({
                    deviceId,
                    device: {
                        setParam: result.setParam,
                        handleCc: result.handleCc,
                        setInstrument: result.setInstrument,
                    },
                    port: result.workletNode.port,
                });
                getAudioDeviceRuntimeSink().setLevainEngineReady({ deviceId, isReady: true });
                return;
            })
            .catch((error) => {
                logger.warn(`[WebAudioEngine] ${deviceType} failed: ${error}`);
                return;
            });
        return { placeholder, loadPromise };
    },
};

const crumbsDescriptor: WasmDeviceDescriptor = {
    matches: isCrumbsDevice,
    create({ context, deviceId, deviceType, signal, onLoaded }) {
        const pendingParams: Array<[string, number]> = [];
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        placeholder.crumbsControls = {
            ready: false,
            noteOn: () => {},
            noteOff: () => {},
            allNotesOff: () => {},
            setParam: (name, value) => {
                pendingParams.push([name, value]);
            },
            setMode: () => {},
            setBypass: () => {},
            destroy: () => {},
        };
        const loadPromise = createCrumbsNode(context, undefined, undefined, signal)
            .then(async (result: CrumbsNodeResult) => {
                if ((await waitForDeviceReady({ deviceType, result, signal })) === null) {
                    return;
                }
                for (const [name, value] of pendingParams) {
                    result.setParam(name, value);
                }
                const accepted = onLoaded({
                    deviceId,
                    type: deviceType,
                    nodes: [result.workletNode],
                    inputNode: result.workletNode,
                    outputNode: result.workletNode,
                    dispose: result.destroy,
                    controller: {
                        ready: true,
                        noteOn: result.noteOn,
                        noteOff: result.noteOff,
                        allNotesOff: result.allNotesOff,
                        setParam: result.setParam,
                        setBypass: result.setBypass,
                        destroy: result.destroy,
                    },
                    crumbsControls: {
                        ready: true,
                        noteOn: result.noteOn,
                        noteOff: result.noteOff,
                        allNotesOff: result.allNotesOff,
                        setParam: result.setParam,
                        setMode: result.setMode,
                        setBypass: result.setBypass,
                        destroy: result.destroy,
                    },
                });
                if (accepted === false) {
                    return;
                }
                // Load the project's sample into the live instance through the
                // same use case the offline chain awaits, so the two registries
                // cannot configure two different engines.
                await getAudioDeviceRuntimeSink().prepareCrumbsDevice({
                    deviceId,
                    port: result.workletNode.port,
                });
                return;
            })
            .catch((error) => {
                logger.warn(`[WebAudioEngine] ${deviceType} failed: ${error}`);
                return;
            });
        return { placeholder, loadPromise };
    },
};

const proofChamberDescriptor: WasmDeviceDescriptor = {
    matches: isProofChamberDevice,
    create({ context, deviceId, deviceType, signal, onLoaded }) {
        const pendingParams: Array<[string, number]> = [];
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        placeholder.nativeDspControls = {
            setParam: (name, value) => {
                pendingParams.push([name, value]);
            },
            setBypass: () => {},
        };
        const loadPromise = createProofChamberNode(context, signal)
            .then(async (result: ProofChamberNodeResult) => {
                const readyData = await waitForDeviceReady({ deviceType, result, signal });
                if (!readyData) {
                    return;
                }
                const initialLatency = typeof readyData.latency === 'number' ? readyData.latency : 0;
                for (const [name, value] of pendingParams) {
                    result.setParam(name, value);
                }
                const accepted = onLoaded({
                    deviceId,
                    type: deviceType,
                    nodes: [result.workletNode],
                    inputNode: result.workletNode,
                    outputNode: result.workletNode,
                    dispose: result.destroy,
                    controller: {
                        setParam: result.setParam,
                        setBypass: result.setBypass,
                        destroy: () => {
                            result.destroy();
                            clearReportedLatency(deviceId);
                        },
                    },
                    nativeDspControls: { setParam: result.setParam, setBypass: result.setBypass },
                });
                if (accepted !== false) {
                    reportLatency(deviceId, (initialLatency / context.sampleRate) * 1000);
                }
                return;
            })
            .catch((error) => {
                logger.warn(`[WebAudioEngine] ${deviceType} failed: ${error}`);
                return;
            });
        return { placeholder, loadPromise };
    },
};

const glutenDescriptor: WasmDeviceDescriptor = {
    matches: isGlutenDevice,
    create({ context, deviceId, deviceType, signal, onLoaded }) {
        const pendingParams: Array<[string, number]> = [];
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        placeholder.nativeDspControls = {
            setParam: (name, value) => {
                pendingParams.push([name, value]);
            },
            setBypass: () => {},
        };
        const loadPromise = createGlutenNode(context, undefined, signal)
            .then(async (result: GlutenNodeResult) => {
                if ((await waitForDeviceReady({ deviceType, result, signal })) === null) {
                    return;
                }
                for (const [name, value] of pendingParams) {
                    result.setParam(name, value);
                }
                result.onMeterData((data) => {
                    getAudioDeviceRuntimeSink().updateGlutenMeters(deviceId, {
                        grDb: data.grDb,
                        inputDb: data.inputDb,
                        outputDb: data.outputDb,
                        crest: data.crest,
                        phaseCorr: data.phaseCorr,
                        latency: data.latency,
                    });
                    reportLatency(deviceId, (data.latency / context.sampleRate) * 1000);
                });
                onLoaded({
                    deviceId,
                    type: deviceType,
                    nodes: [result.workletNode],
                    inputNode: result.workletNode,
                    outputNode: result.workletNode,
                    dispose: result.destroy,
                    controller: {
                        setParam: result.setParam,
                        setBypass: result.setBypass,
                        destroy: () => {
                            result.destroy();
                            clearReportedLatency(deviceId);
                            getAudioDeviceRuntimeSink().deleteGlutenMeters(deviceId);
                        },
                    },
                    nativeDspControls: { setParam: result.setParam, setBypass: result.setBypass },
                });
                return;
            })
            .catch((error) => {
                logger.warn(`[WebAudioEngine] ${deviceType} failed: ${error}`);
                return;
            });
        return { placeholder, loadPromise };
    },
};

const bacteriaDescriptor: WasmDeviceDescriptor = {
    matches: isBacteriaDevice,
    create({ context, deviceId, deviceType, isCurrent, signal, onLoaded }) {
        const pendingParams: Array<[string, number]> = [];
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        placeholder.nativeDspControls = {
            setParam: (name, value) => {
                pendingParams.push([name, value]);
            },
            setBypass: () => {},
        };
        const loadPromise = createBacteriaNode(context, undefined, signal)
            .then(async (result: BacteriaNodeResult) => {
                const readyData = await waitForDeviceReady({ deviceType, result, signal });
                if (!readyData) {
                    return;
                }
                if (isCurrent?.() === false) {
                    result.destroy();
                    return;
                }
                const initialLatency = typeof readyData.latency === 'number' ? readyData.latency : 0;
                reportLatency(deviceId, (initialLatency / context.sampleRate) * 1000);

                for (const [name, value] of pendingParams) {
                    result.setParam(name, value);
                }
                result.onLatencyChanged((latency) => {
                    reportLatency(deviceId, (latency / context.sampleRate) * 1000);
                });
                result.onMeterData((data) => {
                    getAudioDeviceRuntimeSink().updateBacteriaMeters(deviceId, data);
                });
                onLoaded({
                    deviceId,
                    type: deviceType,
                    nodes: [result.workletNode],
                    inputNode: result.workletNode,
                    outputNode: result.workletNode,
                    dispose: result.destroy,
                    controller: {
                        setParam: result.setParam,
                        setBypass: result.setBypass,
                        destroy: () => {
                            result.destroy();
                            clearReportedLatency(deviceId);
                        },
                    },
                    nativeDspControls: { setParam: result.setParam, setBypass: result.setBypass },
                });
                return;
            })
            .catch((error) => {
                logger.warn(`[WebAudioEngine] ${deviceType} failed: ${error}`);
                return;
            });
        return { placeholder, loadPromise };
    },
};

const grinderDescriptor: WasmDeviceDescriptor = {
    matches: isGrinderDevice,
    create({ context, deviceId, deviceType, isCurrent, signal, onLoaded }) {
        const pendingParams: Array<[string, number]> = [];
        let pendingPatch: Record<string, unknown> | null = null;
        let pendingBypass = false;
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        placeholder.nativeDspControls = {
            setParam: (name, value) => {
                pendingParams.push([name, value]);
            },
            setBypass: (bypassed) => {
                pendingBypass = bypassed;
            },
        };
        placeholder.controller = {
            setParam: (name, value) => {
                pendingParams.push([name, value]);
            },
            setPatch: (patch) => {
                pendingPatch = patch;
            },
            setBypass: (bypassed) => {
                pendingBypass = bypassed;
            },
        };
        const loadPromise = createGrinderNode(context, undefined, signal)
            .then(async (result: GrinderNodeResult) => {
                const readyData = await waitForDeviceReady({ deviceType, result, signal });
                if (!readyData) {
                    return;
                }
                if (isCurrent?.() === false) {
                    result.destroy();
                    return;
                }
                const initialLatency = typeof readyData.latency === 'number' ? readyData.latency : 0;
                reportLatency(deviceId, (initialLatency / context.sampleRate) * 1000);

                for (const [name, value] of pendingParams) {
                    result.setParam(name, value);
                }
                if (pendingPatch) {
                    result.setPatch(pendingPatch);
                }
                result.onLatencyChanged((latency) => {
                    reportLatency(deviceId, (latency / context.sampleRate) * 1000);
                });
                result.onMeterData((data) => {
                    getAudioDeviceRuntimeSink().updateGrinderTelemetry(deviceId, {
                        inputDb: data.inputDb,
                        preampDb: data.preampDb,
                        powerAmpDb: data.powerAmpDb,
                        outputDb: data.outputDb,
                        gateOpen: data.gateOpen,
                        gateEnvelopeDb: data.gateEnvelopeDb,
                        sagVoltage: data.sagVoltage,
                        latency: data.latency,
                        neuralCpuPercent: data.neuralCpuPercent,
                        neuralWarmupProgress: data.neuralWarmupProgress,
                    });
                });
                if (pendingBypass) {
                    result.setBypass(true);
                }
                onLoaded({
                    deviceId,
                    type: deviceType,
                    nodes: [result.workletNode],
                    inputNode: result.workletNode,
                    outputNode: result.workletNode,
                    dispose: result.destroy,
                    controller: {
                        setParam: result.setParam,
                        setPatch: result.setPatch,
                        setBypass: result.setBypass,
                        destroy: () => {
                            result.destroy();
                            clearReportedLatency(deviceId);
                        },
                    },
                    nativeDspControls: { setParam: result.setParam, setBypass: result.setBypass },
                });
                return;
            })
            .catch((error) => {
                logger.warn(`[WebAudioEngine] ${deviceType} failed: ${error}`);
                return;
            });
        return { placeholder, loadPromise };
    },
};

const proofDescriptor: WasmDeviceDescriptor = {
    matches: isProofDevice,
    create({ context, deviceId, deviceType, isCurrent, signal, onLoaded }) {
        const pendingParams: Array<[string, number]> = [];
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        const loadingControls: {
            setParam(name: string, value: number): void;
            setBypass(bypassed: boolean): void;
        } = {
            setParam: (name, value) => {
                pendingParams.push([name, value]);
            },
            setBypass: () => {},
        };
        placeholder.nativeDspControls = loadingControls;
        placeholder.controller = loadingControls;
        const loadPromise = createProofNode(context, undefined, signal)
            .then(async (result: ProofNodeResult) => {
                const readyData = await waitForDeviceReady({ deviceType, result, signal });
                if (!readyData) {
                    return;
                }
                if (isCurrent?.() === false) {
                    result.destroy();
                    return;
                }
                const initialLatency = typeof readyData.latency === 'number' ? readyData.latency : 0;
                reportLatency(deviceId, (initialLatency / context.sampleRate) * 1000);
                const runtimeSink = getAudioDeviceRuntimeSink();
                try {
                    runtimeSink.registerProofDevice({
                        deviceId,
                        bridge: {
                            setParam: result.setParam,
                            reorderModules: result.reorderModules,
                            resetIntegrated: result.resetIntegrated,
                        },
                    });
                    for (const [name, value] of pendingParams) {
                        result.setParam(name, value);
                    }
                    // Proof owns restoration and validation. Its complete patch
                    // sync must be the final writer over raw pre-ready values.
                    runtimeSink.syncProofPatch(deviceId);

                    result.onLatencyChanged((latency) => {
                        reportLatency(deviceId, (latency / context.sampleRate) * 1000);
                    });
                    result.onMeterData((data) => {
                        runtimeSink.updateProofMeters(deviceId, data);
                    });
                    onLoaded({
                        deviceId,
                        type: deviceType,
                        nodes: [result.workletNode],
                        inputNode: result.workletNode,
                        outputNode: result.workletNode,
                        dispose: result.destroy,
                        controller: {
                            setParam: result.setParam,
                            setBypass: result.setBypass,
                            destroy: () => {
                                result.destroy();
                                clearReportedLatency(deviceId);
                                try {
                                    getAudioDeviceRuntimeSink().unregisterProofDevice(deviceId);
                                } catch {
                                    // Intentionally empty: the device may already be
                                    // unregistered from the Proof store; teardown proceeds.
                                }
                            },
                        },
                        nativeDspControls: { setParam: result.setParam, setBypass: result.setBypass },
                    });
                } catch (error) {
                    try {
                        runtimeSink.unregisterProofDevice(deviceId);
                    } catch {
                        // Cleanup is best-effort when registration itself failed.
                    }
                    clearReportedLatency(deviceId);
                    try {
                        result.destroy();
                    } catch (cleanupError) {
                        logger.warn(`[WebAudioEngine] ${deviceType} cleanup failed: ${String(cleanupError)}`);
                    }
                    throw error;
                }
                return;
            })
            .catch((error) => {
                logger.warn(`[WebAudioEngine] ${deviceType} failed: ${error}`);
                return;
            });
        return { placeholder, loadPromise };
    },
};

const scoringDescriptor: WasmDeviceDescriptor = {
    matches: isScoringDevice,
    create({ context, deviceId, deviceType, signal, onLoaded }) {
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        placeholder.nativeDspControls = { setParam: () => {}, setBypass: () => {} };
        const loadPromise = createScoringNode(context, signal)
            .then(async (result: ScoringNodeResult) => {
                if ((await waitForDeviceReady({ deviceType, result, signal })) === null) {
                    return;
                }
                result.onTelemetry((data) => {
                    getAudioDeviceRuntimeSink().updateTunerTelemetry(deviceId, {
                        frequency: data.frequency,
                        cents: data.cents,
                        confidence: data.confidence,
                        noteIndex: data.noteIndex,
                        octave: data.octave,
                        midiNote: data.midiNote,
                        noteName: data.noteName,
                        active: data.active,
                    });
                });
                onLoaded({
                    deviceId,
                    type: deviceType,
                    nodes: [result.workletNode],
                    inputNode: result.workletNode,
                    outputNode: result.workletNode,
                    controller: { setParam: result.setParam, setBypass: result.setBypass, destroy: result.destroy },
                    nativeDspControls: { setParam: result.setParam, setBypass: result.setBypass },
                });
                return;
            })
            .catch((error) => {
                logger.warn(`[WebAudioEngine] ${deviceType} failed: ${error}`);
                return;
            });
        return { placeholder, loadPromise };
    },
};

const grandBouleDescriptor: WasmDeviceDescriptor = {
    matches: isGrandBouleDevice,
    create({ context, deviceId, deviceType, signal, onLoaded, onRuntimeFailure: replaceRuntimeFailure }) {
        const pendingParams: Array<[string, number]> = [];
        let runtimeFailureMessage: string | null = null;
        let publishedNode: BuiltinDeviceNode | null = null;
        let publishedResult: GrandBouleNodeResult | null = null;
        let runtimeFailureHandled = false;
        const applyRuntimeFailure = (): void => {
            if (
                runtimeFailureHandled ||
                runtimeFailureMessage === null ||
                publishedNode === null ||
                publishedResult === null
            ) {
                return;
            }

            runtimeFailureHandled = true;
            if (publishedNode.controller) {
                publishedNode.controller.ready = false;
            }
            if (publishedNode.grandBouleControls) {
                publishedNode.grandBouleControls.ready = false;
            }
            publishedNode.workerInstances = 0;
            pendingParams.length = 0;
            if (placeholder.grandBouleControls) {
                placeholder.grandBouleControls.setParam = () => {};
            }
            replaceRuntimeFailure?.(publishedNode, placeholder);
            publishedResult.destroy();
            getAudioDeviceRuntimeSink().emitDeviceRemoved({ deviceId, deviceType });
        };
        const onRuntimeFailure = (message: string): void => {
            if (runtimeFailureMessage !== null) {
                return;
            }
            runtimeFailureMessage = message;
            logger.warn(`[WebAudioEngine] ${deviceType} runtime failure: ${message}`);
            applyRuntimeFailure();
        };
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        placeholder.grandBouleControls = {
            ready: false,
            noteOn: () => {},
            noteOff: () => {},
            noteExpression: () => {},
            setParam: (name, value) => {
                pendingParams.push([name, value]);
            },
            setSustain: () => {},
            setUnaCorda: () => {},
            setSostenuto: () => {},
            noteOnMidi2: () => {},
            setTemperament: () => {},
            loadAttackClip: () => {},
            allNotesOff: () => {},
            setBypass: () => {},
            destroy: () => {},
        };
        const loadPromise = createGrandBouleNode(context, undefined, onRuntimeFailure, signal)
            .then(async (result: GrandBouleNodeResult) => {
                if ((await waitForDeviceReady({ deviceType, result, signal })) === null) {
                    return;
                }
                if (runtimeFailureMessage !== null) {
                    result.destroy();
                    return;
                }
                for (const [name, value] of pendingParams) {
                    result.setParam(name, value);
                }
                const loadedNode: BuiltinDeviceNode = {
                    deviceId,
                    type: deviceType,
                    nodes: [result.workletNode],
                    inputNode: result.workletNode,
                    outputNode: result.workletNode,
                    workerInstances: 1,
                    controller: {
                        ready: true,
                        noteOn: result.noteOn,
                        noteOff: result.noteOff,
                        setParam: result.setParam,
                        setSustain: result.setSustain,
                        setUnaCorda: result.setUnaCorda,
                        setSostenuto: result.setSostenuto,
                        noteOnMidi2: result.noteOnMidi2,
                        setTemperament: result.setTemperament,
                        loadAttackClip: result.loadAttackClip,
                        allNotesOff: result.allNotesOff,
                        setBypass: result.setBypass,
                        destroy: result.destroy,
                    },
                    grandBouleControls: {
                        ready: true,
                        noteOn: result.noteOn,
                        noteOff: result.noteOff,
                        noteExpression: result.noteExpression,
                        setParam: result.setParam,
                        setSustain: result.setSustain,
                        setUnaCorda: result.setUnaCorda,
                        setSostenuto: result.setSostenuto,
                        noteOnMidi2: result.noteOnMidi2,
                        setTemperament: result.setTemperament,
                        loadAttackClip: result.loadAttackClip,
                        allNotesOff: result.allNotesOff,
                        setBypass: result.setBypass,
                        destroy: result.destroy,
                    },
                };
                const accepted = onLoaded(loadedNode);
                if (accepted === false) {
                    return;
                }
                publishedNode = loadedNode;
                publishedResult = result;
                applyRuntimeFailure();
                if (runtimeFailureHandled) {
                    return;
                }
                getAudioDeviceRuntimeSink().emitDeviceLoaded({ deviceId, deviceType });
                return;
            })
            .catch((error) => {
                logger.warn(`[WebAudioEngine] ${deviceType} failed: ${error}`);
                return;
            });
        return { placeholder, loadPromise };
    },
};

const faustDescriptor: WasmDeviceDescriptor = {
    matches: isFaustModule,
    create({ context, deviceId, deviceType, isCurrent, signal, onLoaded }) {
        type PendingParam = { kind: 'param'; name: string; value: number; time?: number };
        type PendingKey = {
            kind: 'keyOn' | 'keyOff';
            channel: number;
            pitch: number;
            velocity: number;
            time?: number;
        };
        const pending: Array<PendingParam | PendingKey> = [];
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        placeholder.controller = {
            setParam: (name, value) => pending.push({ kind: 'param', name, value }),
            scheduleParam: (name, value, time) => pending.push({ kind: 'param', name, value, time }),
            keyOn: (channel, pitch, velocity, time) => pending.push({ kind: 'keyOn', channel, pitch, velocity, time }),
            keyOff: (channel, pitch, velocity, time) =>
                pending.push({ kind: 'keyOff', channel, pitch, velocity, time }),
            destroy: () => {},
        };
        const loadPromise = createFaustDeviceNode(context, deviceType)
            .then((result) => {
                if (!result) {
                    return;
                }
                const controls = result.wamControls;
                if (!controls) {
                    return;
                }
                if (signal?.aborted || isCurrent?.() === false) {
                    controls.destroy?.();
                    return;
                }
                for (const event of pending) {
                    if (event.kind === 'param') {
                        if (event.time !== undefined) {
                            controls.scheduleParam(event.name, event.value, event.time);
                        } else {
                            controls.setParam(event.name, event.value);
                        }
                    } else if (event.kind === 'keyOn') {
                        controls.keyOn?.(event.channel, event.pitch, event.velocity, event.time);
                    } else {
                        controls.keyOff?.(event.channel, event.pitch, event.velocity, event.time);
                    }
                }
                const accepted = onLoaded({
                    deviceId,
                    type: deviceType,
                    nodes: result.nodes,
                    inputNode: result.inputNode,
                    outputNode: result.outputNode,
                    controller: {
                        setParam: controls.setParam,
                        scheduleParam: controls.scheduleParam,
                        keyOn: controls.keyOn,
                        keyOff: controls.keyOff,
                        // A Faust instrument voices through its `gate` param
                        // (see `useCases/faustScheduler/scheduleFaustNote.ts`),
                        // so closing the gate is its all-notes-off. Without it
                        // a Faust instrument was the one device kind the stop /
                        // panic sweep could not silence (audit MD-6).
                        allNotesOff: () => controls.setParam('gate', 0),
                        destroy: controls.destroy,
                    },
                });
                if (accepted === false) {
                    return;
                }
                getAudioDeviceRuntimeSink().emitDeviceLoaded({ deviceId, deviceType });
                return;
            })
            .catch((error) => {
                logger.warn(`[WebAudioEngine] ${deviceType} failed: ${error}`);
                return;
            });
        return { placeholder, loadPromise };
    },
};

const kneadDescriptor: WasmDeviceDescriptor = {
    matches: isKneadDevice,
    create({ context, deviceId, deviceType, transportSAB, signal, onLoaded }) {
        const pendingParams: Array<[string, number | number[]]> = [];
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        placeholder.kneadControls = {
            ready: false,
            updateState: () => {},
            setParam: (name, value) => {
                pendingParams.push([name, value]);
            },
            setBypass: () => {},
            destroy: () => {},
        };
        const loadPromise = createKneadNode(context, transportSAB, signal)
            .then(async (result: KneadNodeResult) => {
                if ((await waitForDeviceReady({ deviceType, result, signal })) === null) {
                    return;
                }
                for (const [name, value] of pendingParams) {
                    result.setParam(name, value);
                }
                onLoaded({
                    deviceId,
                    type: deviceType,
                    nodes: [result.workletNode],
                    inputNode: result.workletNode,
                    outputNode: result.workletNode,
                    dispose: result.destroy,
                    controller: {
                        ready: true,
                        updateState: result.updateState,
                        setParam: result.setParam,
                        setBypass: result.setBypass,
                        destroy: result.destroy,
                    },
                    kneadControls: {
                        ready: true,
                        updateState: result.updateState,
                        setParam: result.setParam,
                        setBypass: result.setBypass,
                        destroy: result.destroy,
                    },
                });
                return;
            })
            .catch((error) => {
                logger.warn(`[WebAudioEngine] ${deviceType} failed: ${error}`);
                return;
            });
        return { placeholder, loadPromise };
    },
};

// ── Registry ─────────────────────────────────────────────────────────────────

const WASM_DEVICE_DESCRIPTORS: WasmDeviceDescriptor[] = [
    faustDescriptor,
    fermenterDescriptor,
    toasterDescriptor,
    levainDescriptor,
    crumbsDescriptor,
    proofChamberDescriptor,
    glutenDescriptor,
    bacteriaDescriptor,
    grinderDescriptor,
    proofDescriptor,
    scoringDescriptor,
    grandBouleDescriptor,
    kneadDescriptor,
];

export function findWasmDescriptor(deviceType: string): WasmDeviceDescriptor | undefined {
    return WASM_DEVICE_DESCRIPTORS.find((data) => data.matches(deviceType));
}
