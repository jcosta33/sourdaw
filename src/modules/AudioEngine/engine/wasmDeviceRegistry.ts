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
import { type DeviceRuntimeLiveFacts } from '../models/BuiltinDeviceRuntime';
import { createFaustDeviceNode } from '../useCases/deviceResolvers/createFaustDeviceNode';
import { clearReportedLatency } from '../useCases/latencyCompensation/compensation/clearReportedLatency';
import { reportLatency } from '../useCases/latencyCompensation/compensation/reportLatency';

import { getAudioDeviceRuntimeSink } from './audioDeviceRuntimeSink';
import { isBacteriaDevice, createBacteriaNode, type BacteriaNodeResult } from './BacteriaNode';
import { isCrumbsDevice, createCrumbsNode, type CrumbsNodeResult } from './CrumbsNode';
import { isCrustDevice, createCrustNode, type CrustNodeResult } from './CrustNode';
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

import type { DeviceContentLoadOutcome } from './deviceReadinessDiagnostics';

// ── Types ────────────────────────────────────────────────────────────────────

export type WasmDeviceCreateDeps = {
    context: AudioContext;
    trackId?: string;
    deviceId: string;
    deviceType: string;
    parameterIds?: readonly string[];
    transportSAB?: SharedArrayBuffer;
    isCurrent?: () => boolean;
    signal?: AbortSignal;
    /** Returns false when the owner rejected and destroyed a stale loaded node. */
    onLoaded: (finalDn: BuiltinDeviceNode) => boolean | void;
    onContentLoadSettled?: (outcome: DeviceContentLoadOutcome) => void;
    /** Replace a terminally failed loaded node in the owning graph slot. */
    onRuntimeFailure?: (failedDn: BuiltinDeviceNode, replacementDn: BuiltinDeviceNode) => boolean;
    /** Request one fresh generation after the failed runtime has been retired. */
    onRuntimeRecovery?: (replacementDn: BuiltinDeviceNode) => void;
};

export type WasmDeviceDescriptor = {
    requiresContent: boolean;
    matches(deviceType: string): boolean;
    runtime: DeviceRuntimeLiveFacts;
    create(deps: WasmDeviceCreateDeps): {
        placeholder: BuiltinDeviceNode;
        loadPromise: Promise<void>;
    };
};

function effectRuntime(latency: DeviceRuntimeLiveFacts['latency']): DeviceRuntimeLiveFacts {
    return {
        source: 'AudioEngine.wasmDeviceRegistry',
        ports: {
            inputs: 1,
            outputs: 1,
            channelsPerPort: 2,
            externalInputs: 0,
            sidechainRouting: 'not-applicable',
        },
        notes: { availability: 'unavailable' },
        latency,
    };
}

function noteSourceRuntime(outputs: number = 1): DeviceRuntimeLiveFacts {
    return {
        source: 'AudioEngine.wasmDeviceRegistry',
        ports: {
            inputs: 0,
            outputs,
            channelsPerPort: 2,
            externalInputs: 0,
            sidechainRouting: 'not-applicable',
        },
        notes: { availability: 'supported' },
        latency: { kind: 'pdc-default-zero' },
    };
}

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
    requiresContent: false,
    matches: isFermenterDevice,
    runtime: noteSourceRuntime(),
    create({
        context,
        deviceId,
        deviceType,
        signal,
        onLoaded,
        onRuntimeFailure: replaceRuntimeFailure,
        onRuntimeRecovery: requestRuntimeRecovery,
    }) {
        const pendingParams: Array<[string, number | number[]]> = [];
        let pendingPatch: Record<string, unknown> | null = null;
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        let runtimeFailureMessage: string | null = null;
        let publishedNode: BuiltinDeviceNode | null = null;
        let publishedResult: FermenterNodeResult | null = null;
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
            if (publishedNode.fermenterControls) {
                publishedNode.fermenterControls.ready = false;
            }
            pendingParams.length = 0;
            pendingPatch = null;
            if (placeholder.fermenterControls) {
                placeholder.fermenterControls.setParam = () => {};
                placeholder.fermenterControls.setPatch = () => {};
            }
            const replaced = replaceRuntimeFailure?.(publishedNode, placeholder) === true;
            try {
                publishedResult.destroy();
            } catch (error) {
                logger.warn(`[WebAudioEngine] ${deviceType} runtime cleanup failed: ${String(error)}`);
            }
            if (replaced) {
                requestRuntimeRecovery?.(placeholder);
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
        const loadPromise = createFermenterNode(context, undefined, onRuntimeFailure, signal)
            .then(async (result: FermenterNodeResult) => {
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
                if (pendingPatch) {
                    result.setPatch(pendingPatch);
                }
                result.onTelemetry((data) => {
                    getAudioDeviceRuntimeSink().setFermenterTelemetry(deviceId, data);
                });
                const loadedNode: BuiltinDeviceNode = {
                    deviceId,
                    type: deviceType,
                    nodes: [result.workletNode],
                    inputNode: result.workletNode,
                    outputNode: result.workletNode,
                    dispose: result.destroy,
                    processorLifecycle: result.processorLifecycle,
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
                };
                const accepted = onLoaded(loadedNode);
                if (accepted === false) {
                    return;
                }
                publishedNode = loadedNode;
                publishedResult = result;
                applyRuntimeFailure();
                return;
            })
            .catch((error) => {
                logger.warn(`[WebAudioEngine] ${deviceType} failed: ${String(error)}`);
                return;
            });
        return { placeholder, loadPromise };
    },
};

const toasterDescriptor: WasmDeviceDescriptor = {
    requiresContent: false,
    matches: isToasterDevice,
    runtime: noteSourceRuntime(17),
    create({
        context,
        deviceId,
        deviceType,
        signal,
        onLoaded,
        onRuntimeFailure: replaceRuntimeFailure,
        onRuntimeRecovery: requestRuntimeRecovery,
    }) {
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
            try {
                publishedResult.destroy();
            } catch (error) {
                logger.warn(`[WebAudioEngine] ${deviceType} runtime cleanup failed: ${String(error)}`);
            }
            if (replaced) {
                requestRuntimeRecovery?.(placeholder);
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
    requiresContent: true,
    matches: isLevainDevice,
    runtime: noteSourceRuntime(),
    create({
        context,
        deviceId,
        deviceType,
        signal,
        onLoaded,
        onContentLoadSettled,
        onRuntimeFailure: replaceRuntimeFailure,
        onRuntimeRecovery: requestRuntimeRecovery,
    }) {
        const pendingParams: Array<[string, number]> = [];
        let runtimeFailureMessage: string | null = null;
        let publishedNode: BuiltinDeviceNode | null = null;
        let publishedResult: LevainNodeResult | null = null;
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
            if (publishedNode.levainControls) {
                publishedNode.levainControls.ready = false;
            }
            const replaced = replaceRuntimeFailure?.(publishedNode, placeholder);
            if (replaced === false) {
                return;
            }
            getAudioDeviceRuntimeSink().setLevainEngineReady({ deviceId, isReady: false });
            publishedNode.controller?.destroy?.();
            if (replaced === true) {
                requestRuntimeRecovery?.(placeholder);
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
        const loadPromise = createLevainNode(context, undefined, onRuntimeFailure, signal)
            .then(async (result: LevainNodeResult) => {
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
                const contentOutcome = await getAudioDeviceRuntimeSink().registerLevainDevice({
                    deviceId,
                    device: {
                        setParam: result.setParam,
                        handleCc: result.handleCc,
                    },
                    port: result.workletNode.port,
                });
                onContentLoadSettled?.(contentOutcome);
                getAudioDeviceRuntimeSink().setLevainEngineReady({ deviceId, isReady: contentOutcome === 'ready' });
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
    requiresContent: true,
    matches: isCrumbsDevice,
    runtime: noteSourceRuntime(),
    create({
        context,
        deviceId,
        deviceType,
        signal,
        onLoaded,
        onContentLoadSettled,
        onRuntimeFailure: replaceRuntimeFailure,
        onRuntimeRecovery: requestRuntimeRecovery,
    }) {
        const pendingParams: Array<[string, number]> = [];
        let runtimeFailureMessage: string | null = null;
        let publishedNode: BuiltinDeviceNode | null = null;
        let publishedResult: CrumbsNodeResult | null = null;
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
            if (publishedNode.crumbsControls) {
                publishedNode.crumbsControls.ready = false;
            }
            const replaced = replaceRuntimeFailure?.(publishedNode, placeholder);
            if (replaced === false) {
                return;
            }
            publishedNode.controller?.destroy?.();
            if (replaced === true) {
                requestRuntimeRecovery?.(placeholder);
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
        const loadPromise = createCrumbsNode(context, undefined, onRuntimeFailure, signal)
            .then(async (result: CrumbsNodeResult) => {
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
                };
                const accepted = onLoaded(loadedNode);
                if (accepted === false) {
                    onContentLoadSettled?.('cancelled');
                    return;
                }
                publishedNode = loadedNode;
                publishedResult = result;
                applyRuntimeFailure();
                if (runtimeFailureHandled) {
                    onContentLoadSettled?.('failed');
                    return;
                }
                // Load the project's sample into the live instance through the
                // same use case the offline chain awaits, so the two registries
                // cannot configure two different engines.
                try {
                    const outcome = await getAudioDeviceRuntimeSink().prepareCrumbsDevice({
                        deviceId,
                        port: result.workletNode.port,
                        signal,
                    });
                    onContentLoadSettled?.(outcome);
                } catch (error) {
                    onContentLoadSettled?.('failed');
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

const proofChamberDescriptor: WasmDeviceDescriptor = {
    requiresContent: false,
    matches: isProofChamberDevice,
    runtime: effectRuntime({ kind: 'reported-when-ready' }),
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
    requiresContent: false,
    matches: isGlutenDevice,
    runtime: {
        source: 'AudioEngine.wasmDeviceRegistry',
        ports: {
            inputs: 2,
            outputs: 1,
            channelsPerPort: 2,
            externalInputs: 1,
            sidechainRouting: 'unavailable',
        },
        notes: { availability: 'unavailable' },
        latency: { kind: 'reported-dynamically' },
    },
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

const crustDescriptor: WasmDeviceDescriptor = {
    requiresContent: false,
    matches: isCrustDevice,
    runtime: effectRuntime({ kind: 'reported-dynamically' }),
    create({ context, deviceId, deviceType, isCurrent, signal, onLoaded }) {
        const pendingParams: Array<[string, number]> = [];
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        placeholder.nativeDspControls = {
            setParam: (name, value) => {
                pendingParams.push([name, value]);
            },
            setBypass: () => {},
        };
        const loadPromise = createCrustNode(context, undefined, signal)
            .then(async (result: CrustNodeResult) => {
                const readyData = await waitForDeviceReady({ deviceType, result, signal });
                if (!readyData) {
                    return;
                }
                if (isCurrent?.() === false) {
                    result.destroy();
                    return;
                }
                // Crust's look-ahead is latency, and an unreported look-ahead
                // delay slides this device's track against every other one.
                // Report the delay the engine starts with before any parameter
                // lands, then again whenever a parameter moves it.
                const initialLatency = typeof readyData.latency === 'number' ? readyData.latency : 0;
                reportLatency(deviceId, (initialLatency / context.sampleRate) * 1000);

                for (const [name, value] of pendingParams) {
                    result.setParam(name, value);
                }
                result.onLatencyChanged((latency) => {
                    reportLatency(deviceId, (latency / context.sampleRate) * 1000);
                });
                result.onMeterData((data) => {
                    getAudioDeviceRuntimeSink().updateCrustMeters(deviceId, data);
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
                            getAudioDeviceRuntimeSink().deleteCrustMeters(deviceId);
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
    requiresContent: false,
    matches: isBacteriaDevice,
    runtime: effectRuntime({ kind: 'reported-dynamically' }),
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
    requiresContent: false,
    matches: isGrinderDevice,
    runtime: effectRuntime({ kind: 'reported-dynamically' }),
    create({ context, trackId, deviceId, deviceType, parameterIds, isCurrent, signal, onLoaded }) {
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
        const controlTarget = trackId && parameterIds ? { trackId, deviceId, deviceType, parameterIds } : undefined;
        const loadPromise = createGrinderNode(context, undefined, signal, controlTarget)
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
    requiresContent: false,
    matches: isProofDevice,
    runtime: effectRuntime({ kind: 'reported-dynamically' }),
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
    requiresContent: false,
    matches: isScoringDevice,
    runtime: effectRuntime({ kind: 'pdc-default-zero' }),
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
    requiresContent: false,
    matches: isGrandBouleDevice,
    runtime: noteSourceRuntime(),
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
    requiresContent: false,
    matches: isFaustModule,
    runtime: {
        source: 'AudioEngine.wasmDeviceRegistry',
        ports: { availability: 'runtime-dependent' },
        notes: { availability: 'runtime-dependent' },
        latency: { kind: 'runtime-dependent' },
    },
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
    requiresContent: false,
    matches: isKneadDevice,
    runtime: effectRuntime({ kind: 'pdc-default-zero' }),
    create({ context, deviceId, deviceType, transportSAB, signal, onLoaded }) {
        const pendingParams: Array<[string, number | number[]]> = [];
        // `AudioEngine.syncKneadState` fans out to every device node on the
        // strip with no readiness gate, so a loading Knead is a reachable
        // target — and the only push a freshly added one gets is the trackStore
        // mutation that added it, which lands while this load is still in
        // flight. Nothing re-pushes on load, so an unlatched write leaves the
        // clip playing unshifted until some unrelated edit happens to sync
        // again. One slot, not a queue: the payload is a whole-track clip
        // snapshot rebuilt per call, so the newest one supersedes every earlier
        // one and replaying an older one would undo later edits.
        let pendingState: Record<string, unknown> | null = null;
        const placeholder = loadingBypassNode(context, deviceId, deviceType);
        const loadingControls: NonNullable<BuiltinDeviceNode['kneadControls']> = {
            ready: false,
            updateState: (clips) => {
                pendingState = clips;
            },
            setParam: (name, value) => {
                pendingParams.push([name, value]);
            },
            setBypass: () => {},
            destroy: () => {},
        };
        placeholder.kneadControls = loadingControls;
        // This placeholder outlives the load on every outcome, not just the bad
        // ones: an abort or a failure leaves it on the strip because TrackNode
        // only marks the device failed, and even a *successful* promotion can
        // put it straight back — `rollbackPromotedDevice` reinstates this exact
        // object when the post-promotion rebuild throws. Either way its
        // `updateState` keeps being called for the lifetime of the track, with
        // the load promise settled and nothing left to drain the slot, so a
        // still-capturing latch pins the last clip snapshot — note blobs and
        // their per-blob pitch curves included — until the track is removed.
        const abandonPendingState = (): void => {
            pendingState = null;
            loadingControls.updateState = () => {};
        };
        const loadPromise = createKneadNode(context, transportSAB, signal)
            .then(async (result: KneadNodeResult) => {
                const readyData = await waitForDeviceReady({ deviceType, result, signal });
                if (readyData === null) {
                    abandonPendingState();
                    return;
                }
                // Knead delays its track by a whole analysis frame even at zero
                // shift. Report it so PDC offsets the track; without this the vocal
                // sat ~43 ms behind the mix on three shipped templates.
                const initialLatency = typeof readyData.latency === 'number' ? readyData.latency : 0;
                reportLatency(deviceId, (initialLatency / context.sampleRate) * 1000);

                for (const [name, value] of pendingParams) {
                    result.setParam(name, value);
                }
                // Strictly after the readiness gate: an aborted load has already
                // destroyed `result`, and pushing a snapshot into it would post
                // to a closed worklet port.
                if (pendingState) {
                    result.updateState(pendingState);
                }
                // Removing the device must retract its PDC entry; a stale entry
                // keeps compensating a delay that is no longer in the graph.
                // TrackNode.removeDevice prefers controller.destroy over dispose,
                // so this is the reachable teardown path.
                const destroy = (): void => {
                    result.destroy();
                    clearReportedLatency(deviceId);
                };
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
                        destroy,
                    },
                    kneadControls: {
                        ready: true,
                        updateState: result.updateState,
                        setParam: result.setParam,
                        setBypass: result.setBypass,
                        destroy,
                    },
                });
                // The replay has happened (or the promotion was rejected and
                // there is nothing left to replay into), so the loading latch
                // must go inert whatever promotion did with the node. The
                // sibling descriptors capture `onLoaded`'s return to gate the
                // work that follows it; here the only work that follows is this
                // abandon, and it is right on both outcomes — gating it would
                // leave a rejected promotion capturing forever, which is the
                // one case that most needs it.
                abandonPendingState();
                return;
            })
            .catch((error) => {
                abandonPendingState();
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
    crustDescriptor,
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
