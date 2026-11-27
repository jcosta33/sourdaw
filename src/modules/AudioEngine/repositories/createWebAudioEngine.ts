import {
    DEFAULT_AUDIO_LATENCY_PROFILE,
    getAudioContextLatencyHint,
    readStoredAudioLatencyProfile,
    type AudioLatencyProfile,
} from '#/infra/audioContext/audioLatencyProfile';
import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { runAllAsyncEffects, runAllEffects } from '#/utils/runEffects';

import { createAdjustmentLayerRuntime, type AdjustmentLayerRuntime } from '../engine/AdjustmentLayerRuntime';
import { BusNode } from '../engine/BusNode';
import { createDeviceReadinessDiagnostics } from '../engine/deviceReadinessDiagnostics';
import { dropoutCounters } from '../engine/dropoutCounter';
import { RuntimeGraphMutationFailure, RuntimeGraphMutationRejected, TrackNode } from '../engine/TrackNode';
import {
    bitcrusherRateProcessorUrl,
    meteringProcessorUrl,
    recordingProcessorUrl,
} from '../engine/workletProcessorUrls';
import { type AudioPreviewIntent } from '../models/AudioPreviewIntent';
import {
    type RuntimeGraphDeltaResult,
    type RuntimeGraphProjectRevisionValidator,
    type RuntimeGraphTopologyValidator,
} from '../models/RuntimeGraphDelta';
import { type RuntimeGrinderPresetInput } from '../models/RuntimeGrinderPreset';

import { applyParams } from './applyParams';
import { stopInputMonitoring } from './audioRecorder/stopInputMonitoring';
import { createOfflineDeviceNode } from './deviceNodeFactory';
import { addCountByType } from './webAudioEngine/addCountByType';
import { addDeviceResources } from './webAudioEngine/addDeviceResources';
import { countDeviceRuntimeResources } from './webAudioEngine/countDeviceRuntimeResources';
import { createAudioPreview, type AudioPreview } from './webAudioEngine/createAudioPreview';
import { createEmptyGraphSlotResourcesByLoadState } from './webAudioEngine/createEmptyGraphSlotResourcesByLoadState';
import { createMasterSection, type MasterMeterNode, type MasterSection } from './webAudioEngine/createMasterSection';
import { createNoopAudioContext } from './webAudioEngine/createNoopAudioContext';
import {
    createRuntimeGraphDeltaApplication,
    type RuntimeGraphDeltaApplication,
} from './webAudioEngine/createRuntimeGraphDeltaApplication';
import {
    createRuntimeGraphRevision,
    type RuntimeGraphMutation,
    type RuntimeGraphRevision,
} from './webAudioEngine/createRuntimeGraphRevision';
import { createScheduledSources, type ScheduledSources } from './webAudioEngine/createScheduledSources';
import { createSendRouting, type SendRouting } from './webAudioEngine/createSendRouting';
import {
    createSidechainRouting,
    type SidechainKeyDelayResolver,
    type SidechainRouting,
} from './webAudioEngine/createSidechainRouting';
import {
    createToasterPadRouting,
    type ToasterPadBinding,
    type ToasterPadRoute,
    type ToasterPadRouting,
} from './webAudioEngine/createToasterPadRouting';
import { createTransportClock, type TransportClock } from './webAudioEngine/createTransportClock';
import { getChromePlaybackStats } from './webAudioEngine/getChromePlaybackStats';
import { readPlaybackStats } from './webAudioEngine/readPlaybackStats';
import { toSortedCountRecord } from './webAudioEngine/toSortedCountRecord';

import type {
    AdjustmentLayerTickInput,
    AudioEngine,
    AudioDeviceWaitResult,
    AudioEngineDiagnostics,
    AudioEngineHealth,
    AudioProcessorLifecycleState,
    AudioEngineState,
    BusStrip,
    BuiltinDeviceNode,
    ControlRoomMonitoring,
    SendNode,
    ToasterDeviceControls,
    TrackChannelStrip,
} from '../models/AudioEngineState';
import type { BuiltinLufsMeterReading } from '../models/BuiltinLufsMeterReader';
import type { EngineDeviceCollaborators, EngineUseCaseCollaborators } from '../models/EngineDeviceCollaborators';

function refuseUnwiredDeviceCollaborator(name: string): Error {
    return new Error(
        `AudioEngine ${name} is not wired: the composition root installs it through initEngineDeviceCollaborators`
    );
}

/**
 * Parameter-write ownership, reported latency and Faust builds are AudioEngine
 * use-case state the live graph cannot import (`engine-no-own-application-layers`).
 * Bootstrap installs them before any project loads, so reaching one unwired is a
 * wiring defect, and it refuses rather than silently dropping the write.
 */
const UNWIRED_USE_CASE_DEVICE_COLLABORATORS: EngineUseCaseCollaborators = {
    captureParameterWriteReceipt: () => {
        throw refuseUnwiredDeviceCollaborator('captureParameterWriteReceipt');
    },
    createFaustDeviceNode: () => Promise.reject(refuseUnwiredDeviceCollaborator('createFaustDeviceNode')),
    reportLatency: () => {
        throw refuseUnwiredDeviceCollaborator('reportLatency');
    },
    clearReportedLatency: () => {
        throw refuseUnwiredDeviceCollaborator('clearReportedLatency');
    },
};

/**
 * Why a strip is torn down. Only a strip whose track left the project takes its
 * devices out of the project. A deactivated strip's track keeps its devices
 * without a live strip (a folder whose last Toaster was removed); a graph reset
 * rebuilds the same project, or one a project load commits later, whose own
 * store reset ends the outgoing devices.
 */
type StripTeardown = 'track-removed' | 'strip-deactivated' | 'graph-reset';

/**
 * Repository-internal view of engine state for repository specs and the
 * topology test harness. Never exported from a contract barrel. Collections are
 * the engine's live objects, so mutating one mutates engine state.
 */
export type WebAudioEngineInternals = {
    readonly trackNodes: Map<string, TrackNode>;
    readonly busNodes: Map<string, BusNode>;
    readonly sendNodes: Map<string, SendNode>;
    readonly toasterPadRoutes: Map<string, ToasterPadRoute>;
    readonly pendingSidechainRoutes: Map<
        string,
        { sourceTrackId: string; targetTrackId: string; targetDeviceId: string }
    >;
    readonly pendingDevicePromises: Set<Promise<unknown>>;
    readonly scheduledNodes: AudioScheduledSourceNode[];
    readonly deviceReadinessDiagnostics: ReturnType<typeof createDeviceReadinessDiagnostics>;
    readonly masterMeterNode: MasterMeterNode | undefined;
    readonly monitorMonoNode: GainNode;
    readonly monitorDimNode: GainNode;
    readonly masterStereoSplitter: ChannelSplitterNode;
    readonly masterStereoTapSink: GainNode;
    addDeviceToStrip(
        trackId: string,
        deviceId: string,
        deviceType: string,
        externalInstanceId?: string,
        precedingDeviceIds?: readonly string[],
        parameterIds?: readonly string[]
    ): void;
    removeDeviceFromStrip(trackId: string, deviceId: string): void;
    reconnectRoutingForTrack(trackId: string): void;
    reconcileToasterParent(toasterParentTrackId: string): void;
    handleDeviceRemoved(trackId: string, device: BuiltinDeviceNode): void;
    crossfadeSendTap(existing: SendNode, busStrip: BusStrip, preFader: boolean, clampedLevel: number): void;
    waitForDevices(timeoutMs?: number): Promise<AudioDeviceWaitResult>;
};

class AudioEngineImpl implements AudioEngine {
    /**
     * Builds the internals view of one engine. Fields are read through getters
     * because initialize() and dispose() reassign several of them. Methods are
     * bound here, at composition, so a harness that installs them as own
     * properties of the engine cannot make them call themselves.
     */
    static internalsOf(engine: AudioEngineImpl): WebAudioEngineInternals {
        return {
            get trackNodes() {
                return engine.trackNodes;
            },
            get busNodes() {
                return engine.busNodes;
            },
            get sendNodes() {
                return engine.sends.sendNodes;
            },
            get toasterPadRoutes() {
                return engine.toasterPads.routes;
            },
            get pendingSidechainRoutes() {
                return engine.sidechains.pendingRoutes;
            },
            get pendingDevicePromises() {
                return engine.pendingDevicePromises;
            },
            get scheduledNodes() {
                return engine.scheduledSources.nodes();
            },
            get deviceReadinessDiagnostics() {
                return engine.deviceReadinessDiagnostics;
            },
            get masterMeterNode() {
                return engine.master.meterNode();
            },
            get monitorMonoNode() {
                return engine.master.monitorMonoNode;
            },
            get monitorDimNode() {
                return engine.master.monitorDimNode;
            },
            get masterStereoSplitter() {
                return engine.master.stereoSplitter;
            },
            get masterStereoTapSink() {
                return engine.master.stereoTapSink;
            },
            addDeviceToStrip: engine.addDeviceToStrip.bind(engine),
            removeDeviceFromStrip: engine.removeDeviceFromStrip.bind(engine),
            reconnectRoutingForTrack: engine.reconnectRoutingForTrack.bind(engine),
            reconcileToasterParent: engine.toasterPads.reconcileParent,
            handleDeviceRemoved: engine.toasterPads.handleDeviceRemoved,
            crossfadeSendTap: engine.sends.crossfadeSendTap,
            waitForDevices: engine.waitForDevices.bind(engine),
        };
    }

    public context!: AudioContext;
    /** The master chain, its meter tap and the control-room listening insert. */
    private master!: MasterSection;

    public get masterGainNode(): GainNode {
        return this.master.gainNode;
    }

    public get masterAnalyser(): AnalyserNode {
        return this.master.analyser;
    }

    public get masterAnalyserLeft(): AnalyserNode {
        return this.master.analyserLeft;
    }

    public get masterAnalyserRight(): AnalyserNode {
        return this.master.analyserRight;
    }

    private trackNodes = new Map<string, TrackNode>();
    /** Tracks the native engine currently carries audibly; see
     *  {@link setNativeCarriedTracks}. Strips created later read it too. */
    private nativeCarriedTrackIds: ReadonlySet<string> = new Set();
    private busNodes = new Map<string, BusNode>();
    private readonly sends: SendRouting;
    private readonly sidechains: SidechainRouting;
    private readonly toasterPads: ToasterPadRouting;
    private readonly scheduledSources: ScheduledSources;
    private pendingDevicePromises = new Set<Promise<unknown>>();
    private workletReady = false;
    private fallbackMode = false;
    private readonly transportClock: TransportClock;
    /** The runtime-graph revision and the validators a compiled delta is admitted against. */
    private readonly runtimeGraph: RuntimeGraphRevision = createRuntimeGraphRevision();
    private readonly runtimeGraphDeltas: RuntimeGraphDeltaApplication;
    private useCaseDeviceCollaborators: EngineUseCaseCollaborators = UNWIRED_USE_CASE_DEVICE_COLLABORATORS;
    /** Built-ins come straight from this repository; the rest resolve through the installed use cases per call. */
    private readonly deviceCollaborators: EngineDeviceCollaborators = {
        createBuiltinDeviceNode: createOfflineDeviceNode,
        applyParams,
        captureParameterWriteReceipt: (trackId, deviceId, paramId) =>
            this.useCaseDeviceCollaborators.captureParameterWriteReceipt(trackId, deviceId, paramId),
        createFaustDeviceNode: (context, pluginId) =>
            this.useCaseDeviceCollaborators.createFaustDeviceNode(context, pluginId),
        reportLatency: (deviceId, latencyMs) => this.useCaseDeviceCollaborators.reportLatency(deviceId, latencyMs),
        clearReportedLatency: (deviceId) => this.useCaseDeviceCollaborators.clearReportedLatency(deviceId),
    };
    private initPromise: Promise<void> | null = null;
    private initializationCancellation: PromiseWithResolvers<never> | null = null;
    private initializationGeneration = 0;
    private disposed = false;
    private readonly preview: AudioPreview;
    private disposalPromise: Promise<void> | null = null;
    private lastInitError: Error | null = null;
    private lastResumeError: Error | null = null;
    private adjustmentRuntime: AdjustmentLayerRuntime;
    private readonly deviceReadinessDiagnostics = createDeviceReadinessDiagnostics();
    private readonly latencyProfile: AudioLatencyProfile | null;
    private readonly latencyHint: 'interactive' | 'playback' | null;

    constructor(providedContext?: AudioContext) {
        this.transportClock = createTransportClock({ readSampleRate: () => this.context.sampleRate });

        if (providedContext) {
            this.latencyProfile = null;
            this.latencyHint = null;
        } else {
            this.latencyProfile = readStoredAudioLatencyProfile();
            this.latencyHint = getAudioContextLatencyHint(this.latencyProfile);
        }

        try {
            this.context =
                providedContext ??
                new AudioContext({
                    latencyHint: this.latencyHint ?? getAudioContextLatencyHint(DEFAULT_AUDIO_LATENCY_PROFILE),
                    sampleRate: 48_000,
                });
            this.master = createMasterSection({ context: this.context, mode: 'live' });
        } catch (error) {
            logger.warn(`Failed to create AudioContext: ${error}`);
            notifyUser(
                'Audio engine failed to initialize — audio playback is disabled. Try reloading the page.',
                'error'
            );
            this.fallbackMode = true;
            this.setupNoopContext();
        }

        this.scheduledSources = createScheduledSources({
            readContext: () => this.context,
            readMasterGain: () => this.master.gainNode,
            assertActive: () => this.assertActive(),
            isFallback: () => this.fallbackMode,
        });

        this.preview = createAudioPreview({
            readContext: () => this.context,
            readProgrammeGate: () => this.master.previewProgrammeGate,
            readMonitorMono: () => this.master.monitorMonoNode,
            isDisposed: () => this.disposed,
            isFallback: () => this.fallbackMode,
        });

        this.sends = createSendRouting({
            readContext: () => this.context,
            isFallback: () => this.fallbackMode,
            readTrackStrip: (trackId) => this.trackNodes.get(trackId)?.strip,
            ensureBusStrip: (busId) => this.ensureBusStripInGraph(busId),
            scheduleTrackSendAutomation: (sourceTrackId, busId, level, time) =>
                this.trackNodes.get(sourceTrackId)?.scheduleSendAutomation(busId, level, time),
            mutateRuntimeGraph: (mutation) => {
                this.runtimeGraph.mutate(() => ({ value: undefined, changed: mutation() }));
            },
        });

        this.toasterPads = createToasterPadRouting({
            readTrackStrip: (trackId) => this.trackNodes.get(trackId)?.strip,
        });

        this.sidechains = createSidechainRouting({
            readContext: () => this.context,
            isFallback: () => this.fallbackMode,
            readTrackStrip: (trackId) => this.trackNodes.get(trackId)?.strip,
            mutateRuntimeGraph: (mutation) => {
                this.runtimeGraph.mutate(() => ({ value: undefined, changed: mutation() }));
            },
        });

        this.runtimeGraphDeltas = createRuntimeGraphDeltaApplication({
            readRevision: () => this.runtimeGraph.current(),
            readProjectRevisionValidator: () => this.runtimeGraph.projectRevisionValidator(),
            readTopologyValidator: () => this.runtimeGraph.topologyValidator(),
            mutateRuntimeGraph: this.runtimeGraph.mutate,
            isFallback: () => this.fallbackMode,
            readTrackNode: (trackId) => this.trackNodes.get(trackId),
            readToasterPadBinding: (trackId) => this.toasterPads.routes.get(trackId),
            hasOutputDestination: (outputId) => this.hasRuntimeOutputDestination(outputId),
            ensureTrackStripInGraph: (trackId) => {
                this.ensureTrackStripInGraph(trackId);
            },
            createTrackNode: (trackId) => this.createTrackNode(trackId),
            registerTrackNode: (trackId, node) => {
                this.trackNodes.set(trackId, node);
            },
            unregisterTrackNode: (trackId) => {
                this.trackNodes.delete(trackId);
            },
            setTrackOutputTransaction: (node, outputId, padBinding) =>
                this.setTrackOutputTransaction(node, outputId, padBinding),
        });

        this.adjustmentRuntime = createAdjustmentLayerRuntime({
            getContext: () => this.context ?? null,
            getTrackDefaultDestination: (trackId) => this.trackNodes.get(trackId)?.getDefaultDestination() ?? null,
            rerouteTrack: (trackId) => this.trackNodes.get(trackId)?.routeOutput(),
            builtinDevices: this.deviceCollaborators,
        });
    }

    private setupNoopContext() {
        this.context = createNoopAudioContext();
        this.master = createMasterSection({ context: this.context, mode: 'fallback' });
    }

    private assertActive(): void {
        if (this.disposed) {
            throw new Error('Audio engine has been disposed.');
        }
    }

    private hasRuntimeOutputDestination(outputId: string): boolean {
        return outputId === 'master' || outputId === 'hw_out' || this.trackNodes.has(outputId);
    }

    public initialize(): Promise<void> {
        if (this.disposed) {
            return Promise.reject(new Error('Audio engine has been disposed.'));
        }
        if (this.fallbackMode) {
            return Promise.resolve();
        }
        if (this.initPromise) {
            return this.initPromise;
        }
        // Cache the in-flight/successful load so concurrent callers share it, but
        // do NOT cache a rejection: a failed worklet load (e.g. one addModule
        // 404s) must not poison the engine forever. On rejection we clear the
        // cached promise so the next initialize() retries the load.
        const generation = this.initializationGeneration;
        this.initializationCancellation = Promise.withResolvers<never>();
        this.initPromise = Promise.race([this.loadWorklets(generation), this.initializationCancellation.promise]).catch(
            (error: unknown) => {
                const initError = error instanceof Error ? error : new Error(String(error));
                if (generation === this.initializationGeneration) {
                    this.initPromise = null;
                    this.initializationCancellation = null;
                    this.lastInitError = initError;
                }
                throw initError;
            }
        );
        return this.initPromise;
    }

    private async loadWorklets(generation: number): Promise<void> {
        await Promise.all([
            this.context.audioWorklet.addModule('/audio/worklets/sidechain-compressor-processor.js'),
            this.context.audioWorklet.addModule(recordingProcessorUrl),
            this.context.audioWorklet.addModule(meteringProcessorUrl),
            this.context.audioWorklet.addModule(bitcrusherRateProcessorUrl),
        ]);
        if (generation !== this.initializationGeneration) {
            throw new Error('Audio engine was disposed during initialization.');
        }
        this.initializationCancellation = null;
        // The metering-processor module is now registered, so the master meter
        // can be inserted into the master chain. This cannot happen in the
        // constructor — the master nodes are built before any worklet module is
        // loaded (initialize() runs later), exactly like the per-track meter
        // which is built once metering-processor is available.
        this.master.wireMeter();
        this.workletReady = true;
        this.lastInitError = null;
    }

    public getHealth(): AudioEngineHealth {
        return {
            workletReady: this.workletReady,
            lastInitError: this.lastInitError,
            lastResumeError: this.lastResumeError,
            // Read straight out of the shared counters (audit RT-10) — no message
            // round-trip, no polling of the audio thread. See dropoutCounter.ts
            // for exactly which dropouts this does and does not capture.
            dropouts: dropoutCounters.read(),
        };
    }

    public getDeviceReadinessDiagnostics() {
        return this.deviceReadinessDiagnostics.snapshot();
    }

    public isAudioAvailable(): boolean {
        return !this.fallbackMode;
    }

    public getDiagnostics(): AudioEngineDiagnostics {
        const engineState = this.getState();
        const context = {
            state: engineState.state,
            sampleRate: engineState.sampleRate,
            baseLatency: engineState.baseLatency,
            outputLatency: engineState.outputLatency,
            latencyProfile: this.latencyProfile,
            latencyHint: this.latencyHint,
        };
        if (this.fallbackMode) {
            return {
                context,
                playback: null,
                graph: {
                    trackStrips: 0,
                    busStrips: 0,
                    sends: 0,
                    sidechains: 0,
                    deviceInstances: 0,
                    pendingDeviceInstances: 0,
                    failedDeviceInstances: 0,
                    deviceInstancesByType: {},
                    deviceAudioNodes: 0,
                    graphSlotResourcesByLoadState: createEmptyGraphSlotResourcesByLoadState(),
                    deviceAudioWorkletProcessors: 0,
                    deviceAudioWorkletProcessorsByType: {},
                    stripMeterWorklets: 0,
                    masterMeterWorklets: 0,
                    graphAudioWorkletProcessors: 0,
                    workerInstances: 0,
                    workerInstancesByType: {},
                    adjustmentLayerBuses: 0,
                    adjustmentLayerBusesByEffectType: {},
                    adjustmentLayerAudioNodes: 0,
                    adjustmentLayerAudioWorkletProcessors: 0,
                },
                runtime: {
                    trackedAudioScheduledSources: 0,
                    processorLifecycle: { unmanaged: 0, continue: 0, continueIfNotQuiet: 0, tail: 0, sleep: 0 },
                },
            };
        }
        const deviceInstancesByType = new Map<string, number>();
        const deviceAudioWorkletProcessorsByType = new Map<string, number>();
        const workerInstancesByType = new Map<string, number>();
        const graphSlotResourcesByLoadState = createEmptyGraphSlotResourcesByLoadState();
        let deviceInstances = 0;
        let pendingDeviceInstances = 0;
        let failedDeviceInstances = 0;
        let deviceAudioNodes = 0;
        let deviceAudioWorkletProcessors = 0;
        let workerInstances = 0;
        let stripMeterWorklets = 0;
        const processorLifecycle: { unmanaged: number } & Record<AudioProcessorLifecycleState, number> = {
            unmanaged: 0,
            continue: 0,
            continueIfNotQuiet: 0,
            tail: 0,
            sleep: 0,
        };

        for (const trackNode of this.trackNodes.values()) {
            if (trackNode.strip.meterNode) {
                stripMeterWorklets++;
            }
            for (const device of trackNode.strip.deviceNodes) {
                const resources = countDeviceRuntimeResources(device);
                deviceAudioNodes += resources.audioNodes;
                deviceAudioWorkletProcessors += resources.audioWorkletProcessors;
                const lifecycleState = device.processorLifecycle?.() ?? null;
                if (lifecycleState && resources.audioWorkletProcessors > 0) {
                    processorLifecycle[lifecycleState]++;
                    processorLifecycle.unmanaged += resources.audioWorkletProcessors - 1;
                } else {
                    processorLifecycle.unmanaged += resources.audioWorkletProcessors;
                }
                addCountByType(deviceAudioWorkletProcessorsByType, device.type, resources.audioWorkletProcessors);
                workerInstances += resources.workers;
                addCountByType(workerInstancesByType, device.type, resources.workers);
                const loadState = trackNode.getDeviceLoadState(device.deviceId);
                addDeviceResources(graphSlotResourcesByLoadState[loadState], resources);
                if (loadState === 'pending') {
                    pendingDeviceInstances++;
                    continue;
                }
                if (loadState === 'failed') {
                    failedDeviceInstances++;
                    continue;
                }
                deviceInstances++;
                addCountByType(deviceInstancesByType, device.type, 1);
            }
        }

        const masterMeterWorklets = this.master.meterNode() instanceof AudioWorkletNode ? 1 : 0;
        const adjustmentDiagnostics = this.adjustmentRuntime.getDiagnostics();
        processorLifecycle.unmanaged += adjustmentDiagnostics.audioWorkletProcessors;
        const graphAudioWorkletProcessors =
            deviceAudioWorkletProcessors +
            adjustmentDiagnostics.audioWorkletProcessors +
            stripMeterWorklets +
            masterMeterWorklets;
        const playback = readPlaybackStats(this.context);

        return {
            context,
            playback,
            graph: {
                // A bus owns a backing TrackNode; keep the public counters disjoint.
                trackStrips: this.trackNodes.size - this.busNodes.size,
                busStrips: this.busNodes.size,
                sends: this.sends.sendNodes.size,
                sidechains: this.sidechains.connectionCount(),
                deviceInstances,
                pendingDeviceInstances,
                failedDeviceInstances,
                deviceInstancesByType: toSortedCountRecord(deviceInstancesByType),
                deviceAudioNodes,
                graphSlotResourcesByLoadState,
                deviceAudioWorkletProcessors,
                deviceAudioWorkletProcessorsByType: toSortedCountRecord(deviceAudioWorkletProcessorsByType),
                stripMeterWorklets,
                masterMeterWorklets,
                graphAudioWorkletProcessors,
                workerInstances,
                workerInstancesByType: toSortedCountRecord(workerInstancesByType),
                adjustmentLayerBuses: adjustmentDiagnostics.buses,
                adjustmentLayerBusesByEffectType: adjustmentDiagnostics.busesByEffectType,
                adjustmentLayerAudioNodes: adjustmentDiagnostics.audioNodes,
                adjustmentLayerAudioWorkletProcessors: adjustmentDiagnostics.audioWorkletProcessors,
            },
            runtime: {
                trackedAudioScheduledSources: this.scheduledSources.nodes().length,
                processorLifecycle,
            },
        };
    }

    public resetPlaybackLatencyStats(): void {
        if (this.fallbackMode) {
            return;
        }
        getChromePlaybackStats(this.context).resetLatency();
    }

    public async resume(): Promise<void> {
        if (this.fallbackMode) {
            return;
        }
        try {
            if (this.context.state === 'suspended') {
                await this.context.resume();
            }
            this.lastResumeError = null;
        } catch (error) {
            // Surface the failure instead of swallowing it: a gesture handler can
            // read getHealth().lastResumeError to re-arm / warn the user, and the
            // rejection now propagates so a `void resume()` caller no longer
            // silently leaves the context suspended (no audio).
            this.lastResumeError = error instanceof Error ? error : new Error(String(error));
            logger.warn(`AudioContext resume failed: ${error}`);
            throw this.lastResumeError;
        }
    }

    public async suspend(): Promise<void> {
        if (this.fallbackMode) {
            return;
        }
        try {
            if (this.context.state === 'running') {
                await this.context.suspend();
            }
        } catch (error) {
            logger.warn(`AudioContext suspend failed: ${error}`);
        }
    }

    public setMasterGain(value: number): void {
        if (this.fallbackMode) {
            return;
        }
        this.master.setGain(value);
    }

    public getMasterGain(): number {
        if (this.fallbackMode) {
            return 0;
        }
        return this.master.getGain();
    }

    public setControlRoomMonitoring(monitoring: ControlRoomMonitoring): void {
        if (this.fallbackMode) {
            return;
        }
        this.master.setControlRoomMonitoring(monitoring);
    }

    public getState(): AudioEngineState {
        if (this.fallbackMode) {
            return {
                isReady: false,
                sampleRate: 44100,
                state: 'closed',
                masterGain: 0,
                currentTime: 0,
                baseLatency: 0,
                outputLatency: 0,
            };
        }
        return {
            isReady: this.context.state === 'running' || this.workletReady,
            sampleRate: this.context.sampleRate,
            state: this.context.state,
            masterGain: this.master.gainNode.gain.value,
            currentTime: this.context.currentTime,
            baseLatency: this.context.baseLatency ?? 0,
            outputLatency: this.context.outputLatency ?? 0,
        };
    }

    public getRuntimeGraphRevision(): number {
        return this.runtimeGraph.current();
    }

    public setRuntimeGraphProjectRevisionValidator(validator: RuntimeGraphProjectRevisionValidator | null): void {
        this.runtimeGraph.setProjectRevisionValidator(validator);
    }

    public setRuntimeGraphTopologyValidator(validator: RuntimeGraphTopologyValidator | null): void {
        this.runtimeGraph.setTopologyValidator(validator);
    }

    // null unwires the collaborators: every later use refuses instead of writing nothing.
    public setUseCaseDeviceCollaborators(collaborators: EngineUseCaseCollaborators | null): void {
        this.useCaseDeviceCollaborators = collaborators ?? UNWIRED_USE_CASE_DEVICE_COLLABORATORS;
    }

    public applyRuntimeGraphDelta(input: unknown): RuntimeGraphDeltaResult {
        return this.runtimeGraphDeltas.apply(input);
    }

    public initializeTrackStripFromSnapshot(input: unknown): RuntimeGraphDeltaResult {
        return this.runtimeGraphDeltas.initializeTrackStripFromSnapshot(input);
    }

    private reconnectRoutingForTrack(trackId: string): void {
        const strip = this.trackNodes.get(trackId)?.strip;
        if (!strip) {
            return;
        }
        this.sends.reconnectTrack(trackId, strip);
        this.sidechains.reconnectTrack(trackId, strip);
    }

    private restoreTrackOutput(trackNode: TrackNode, previousOutputId: string | undefined): void {
        trackNode.setOutput(previousOutputId ?? 'hw_out');
        if (previousOutputId === undefined) {
            trackNode.strip.outputId = undefined;
        }
    }

    private setTrackOutputTransaction(
        trackNode: TrackNode,
        outputId: string,
        padBinding: ToasterPadBinding | undefined
    ): RuntimeGraphMutation<void> {
        const previousOutputId = trackNode.strip.outputId;
        const padSnapshot = this.toasterPads.snapshotRoute(trackNode.trackId);
        const outputChanged = trackNode.setOutput(outputId);
        try {
            const padBindingChanged = this.toasterPads.updateBinding(trackNode.trackId, padBinding);
            return { value: undefined, changed: outputChanged || padBindingChanged };
        } catch (error) {
            const rollbackErrors: unknown[] = [];
            try {
                this.toasterPads.restoreBinding(trackNode.trackId, trackNode.strip.gainNode, padSnapshot, padBinding);
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
            if (outputChanged) {
                try {
                    this.restoreTrackOutput(trackNode, previousOutputId);
                } catch (rollbackError) {
                    rollbackErrors.push(rollbackError);
                }
            }
            if (rollbackErrors.length === 0) {
                throw new RuntimeGraphMutationRejected(
                    `Track ${trackNode.trackId} output and Toaster pad binding were restored after a live failure`,
                    error
                );
            }
            throw new RuntimeGraphMutationFailure(
                Object.freeze({
                    application: 'needs-reconcile',
                    reason: `Track ${trackNode.trackId} output and Toaster pad binding changed before transaction restoration failed`,
                }),
                error,
                rollbackErrors.length === 1
                    ? rollbackErrors[0]
                    : new AggregateError(rollbackErrors, 'Toaster output transaction restoration failed')
            );
        }
    }

    private createTrackNode(trackId: string): TrackNode {
        this.assertActive();
        if (this.fallbackMode) {
            const sG = this.context.createGain();
            return new TrackNode(trackId, {
                context: this.context,
                masterGainNode: sG,
                getBusGainNode: () => undefined,
                getTrackGainNode: () => undefined,
                getSendsForTrack: () => [],
                pendingDevicePromises: new Set(),
                readinessDiagnostics: this.deviceReadinessDiagnostics,
                collaborators: this.deviceCollaborators,
                getAdjustmentBusForTrack: (id) => this.adjustmentRuntime.getBusInputForTrack(id),
            });
        }
        return new TrackNode(trackId, {
            context: this.context,
            masterGainNode: this.master.gainNode,
            getBusGainNode: (id) => this.busNodes.get(id)?.strip.gainNode,
            getTrackGainNode: (id) => this.trackNodes.get(id)?.strip.gainNode,
            getSendsForTrack: (tId) => this.sends.sendsForTrack(tId),
            pendingDevicePromises: this.pendingDevicePromises,
            readinessDiagnostics: this.deviceReadinessDiagnostics,
            collaborators: this.deviceCollaborators,
            transportSAB: this.transportClock.sharedBuffer() ?? undefined,
            getAdjustmentBusForTrack: (id) => this.adjustmentRuntime.getBusInputForTrack(id),
            reconnectRoutingForTrack: (id) => this.reconnectRoutingForTrack(id),
            onDeviceLoaded: (id) => this.toasterPads.reconcileParent(id),
            onDeviceRemoved: (id, device) => this.toasterPads.handleDeviceRemoved(id, device),
            onAsyncRuntimeGraphMutation: (mutation) => this.runtimeGraph.recordMutation(mutation),
        });
    }

    private ensureTrackStripInGraph(trackId: string): RuntimeGraphMutation<TrackChannelStrip> {
        let node = this.trackNodes.get(trackId);
        let created = false;
        if (!node) {
            node = this.createTrackNode(trackId);
            // A graph rebuild mid-play re-creates the strip with its gates open;
            // carrying is a property of the track, not of this node instance.
            node.setNativeCarried(this.nativeCarriedTrackIds.has(trackId));
            this.trackNodes.set(trackId, node);
            created = true;
        }
        return { value: node.strip, changed: created && !this.fallbackMode };
    }

    public ensureTrackStrip(trackId: string): TrackChannelStrip {
        return this.runtimeGraph.mutate(() => this.ensureTrackStripInGraph(trackId)).value;
    }

    private removeTrackStripFromGraph(trackId: string, teardown: StripTeardown): boolean {
        const node = this.trackNodes.get(trackId);
        // TrackNode.dispose() clears deviceNodes. Capture the ids first so all
        // live and pending sidechains targeting this strip can be identified.
        const removedDeviceIds = new Set(node?.strip.deviceNodes.map((device) => device.deviceId) ?? []);

        // Fallback-mode wiring can queue routes without ever materializing a
        // source or target strip. Purge endpoint ownership before the node guard
        // so removing either absent endpoint cannot leave a replayable route.
        this.sidechains.forgetPendingRoutesOf(trackId, removedDeviceIds);
        this.toasterPads.forgetRoutesOfRemovedStrip(trackId);
        if (!node) {
            return false;
        }

        // Sweep dependent routing keyed on this track as the source, mirroring
        // removeBusStrip's busId sweep. Without this, the send/sidechain GainNodes
        // for the removed track survive in the maps — still wired into their bus /
        // target device, leaking nodes and (for sends) re-summing a ghost tap.
        this.sends.removeSendsFromTrack(trackId);
        this.sidechains.removeConnectionsOf(trackId, removedDeviceIds);
        // A track-to-track output is a live edge into the target strip. Preserve
        // the remaining source strips and make the fallback explicit: `hw_out`
        // routes through TrackNode's masterGainNode destination.
        for (const [sourceTrackId, sourceNode] of this.trackNodes) {
            if (sourceTrackId !== trackId && sourceNode.strip.outputId === trackId) {
                sourceNode.setOutput('hw_out');
            }
        }
        if (teardown === 'track-removed') {
            node.disposeLeavingProject();
        } else {
            node.dispose();
        }
        this.trackNodes.delete(trackId);
        return !this.fallbackMode;
    }

    public removeTrackStrip(trackId: string): void {
        this.runtimeGraph.mutate(() => ({
            value: undefined,
            changed: this.removeTrackStripFromGraph(trackId, 'track-removed'),
        }));
    }

    public deactivateTrackStrip(trackId: string): void {
        this.runtimeGraph.mutate(() => ({
            value: undefined,
            changed: this.removeTrackStripFromGraph(trackId, 'strip-deactivated'),
        }));
    }

    public getTrackStrip(trackId: string): TrackChannelStrip | undefined {
        return this.trackNodes.get(trackId)?.strip;
    }

    public findToasterControls(deviceId: string): ToasterDeviceControls | undefined {
        // Owns the strip/device-node traversal so foreign modules (Toaster) do not
        // reach into strip internals to reach a loaded device's control surface.
        for (const [, trackNode] of this.trackNodes) {
            const deviceNode = trackNode.strip.deviceNodes.find((dn) => dn.deviceId === deviceId);
            if (deviceNode?.toasterControls) {
                return deviceNode.toasterControls;
            }
        }
        return undefined;
    }

    /**
     * The loaded builtin LUFS meter's current reading, wherever its strip sits.
     * `null` says the device has no loaded node yet, or is not a meter.
     */
    public findLufsMeterReading(deviceId: string): BuiltinLufsMeterReading | null {
        for (const [, trackNode] of this.trackNodes) {
            const deviceNode = trackNode.strip.deviceNodes.find((dn) => dn.deviceId === deviceId);
            if (deviceNode?.lufsMeter) {
                return deviceNode.lufsMeter.read();
            }
        }
        return null;
    }

    /**
     * The loaded device's own graph output, wherever it sits (track or bus —
     * bus devices live on the paired TrackNode). `null` says the device has no
     * loaded node in the graph yet: WASM worklets load asynchronously, so a
     * just-inserted device is legitimately absent until its load resolves.
     *
     * Owns the strip/device-node traversal (same contract as
     * `findToasterControls`) so foreign modules tap a device's signal without
     * reaching into strip internals.
     */
    public findDeviceOutputNode(deviceId: string): AudioNode | null {
        for (const [, trackNode] of this.trackNodes) {
            const deviceNode = trackNode.strip.deviceNodes.find((dn) => dn.deviceId === deviceId);
            if (deviceNode) {
                return deviceNode.outputNode;
            }
        }
        return null;
    }

    public setTrackGain(trackId: string, gain: number): void {
        this.trackNodes.get(trackId)?.setGain(gain);
    }

    public setTrackPan(trackId: string, pan: number): void {
        this.trackNodes.get(trackId)?.setPan(pan);
    }

    public scheduleTrackGain(trackId: string, gain: number, time: number): void {
        this.trackNodes.get(trackId)?.scheduleGainAutomation(gain, time);
    }

    public scheduleTrackPan(trackId: string, pan: number, time: number): void {
        this.trackNodes.get(trackId)?.schedulePanAutomation(pan, time);
    }

    public cancelTrackAutomationRamps(): void {
        if (this.fallbackMode) {
            return;
        }
        for (const trackNode of this.trackNodes.values()) {
            trackNode.cancelAutomationRamps();
        }
    }

    public setTrackMute(trackId: string, muted: boolean): void {
        this.ensureTrackStrip(trackId);
        this.trackNodes.get(trackId)?.setMute(muted);
    }

    /**
     * The set is the whole answer, not a delta: every live strip is driven to
     * its membership on each call, so a track that has just left the set is
     * reopened in the same pass that closes a track that has just joined.
     */
    public setNativeCarriedTracks(trackIds: ReadonlySet<string>): void {
        this.nativeCarriedTrackIds = new Set(trackIds);
        for (const [trackId, trackNode] of this.trackNodes) {
            trackNode.setNativeCarried(this.nativeCarriedTrackIds.has(trackId));
        }
    }

    public setTrackSoloGate(trackId: string, gated: boolean): void {
        this.ensureTrackStrip(trackId);
        this.trackNodes.get(trackId)?.setSoloGate(gated);
    }

    public getTrackPeakLevel(trackId: string): number {
        return this.trackNodes.get(trackId)?.getPeakLevel() ?? 0;
    }

    /**
     * The master output peak in linear amplitude, or `null` when no meter tap is
     * wired and the engine therefore has no measurement to report.
     *
     * `null` and `0` are different claims and callers must render them
     * differently: `0` says the worklet measured this block and it was silent,
     * `null` says nobody measured anything. Collapsing the two is what let a
     * status bar show "-∞ dB" over a mix that was audibly playing.
     */
    public getMasterPeakLevel(): number | null {
        return this.master.readPeak();
    }

    private ensureBusStripInGraph(busId: string): RuntimeGraphMutation<BusStrip> {
        let node = this.busNodes.get(busId);
        let created = false;
        if (!node) {
            this.ensureTrackStripInGraph(busId);
            const trackNode = this.trackNodes.get(busId);
            if (!trackNode) {
                throw new Error(`Failed to create track strip for bus ${busId}`);
            }
            node = new BusNode(busId, trackNode);
            this.busNodes.set(busId, node);
            created = !this.fallbackMode;
        }
        return { value: node.strip, changed: created };
    }

    public ensureBusStrip(busId: string): BusStrip {
        return this.runtimeGraph.mutate(() => this.ensureBusStripInGraph(busId)).value;
    }

    private removeBusStripFromGraph(busId: string, teardown: StripTeardown): boolean {
        const node = this.busNodes.get(busId);
        if (!node) {
            return false;
        }
        this.sends.removeSendsToBus(busId);
        const removedTrack = this.removeTrackStripFromGraph(busId, teardown);
        node.dispose();
        this.busNodes.delete(busId);
        // BusNode is a facade over its paired TrackNode and owns no AudioNodes.
        // If an enclosing track-removal already disposed that strip, deleting the
        // facade changes no live topology and must not publish a second revision.
        return removedTrack;
    }

    public removeBusStrip(busId: string): void {
        this.runtimeGraph.mutate(() => ({
            value: undefined,
            changed: this.removeBusStripFromGraph(busId, 'track-removed'),
        }));
    }

    public setBusGain(busId: string, gain: number): void {
        this.busNodes.get(busId)?.setGain(gain);
    }

    public getBusPeakLevel(busId: string): number {
        return this.busNodes.get(busId)?.getPeakLevel() ?? 0;
    }

    /** Internal primitive reached only through {@link WebAudioEngineInternals}. */
    public addDeviceToStrip(
        trackId: string,
        deviceId: string,
        deviceType: string,
        externalInstanceId?: string,
        precedingDeviceIds?: readonly string[],
        parameterIds?: readonly string[]
    ): void {
        if (this.fallbackMode) {
            return;
        }
        let stripChanged = false;
        try {
            this.runtimeGraph.mutate(() => {
                const stripMutation = this.ensureTrackStripInGraph(trackId);
                stripChanged = stripMutation.changed;
                const deviceAdded =
                    this.trackNodes
                        .get(trackId)
                        ?.addDevice(deviceId, deviceType, externalInstanceId, precedingDeviceIds, parameterIds) ??
                    false;
                return { value: undefined, changed: stripChanged || deviceAdded };
            });
        } catch (error) {
            if (error instanceof RuntimeGraphMutationFailure) {
                this.runtimeGraph.recordMutation(error.mutation);
            } else if (stripChanged) {
                this.runtimeGraph.mutate(() => ({ value: undefined, changed: true }));
            }
            throw error;
        }
    }

    /** Internal primitive reached only through {@link WebAudioEngineInternals}. */
    public removeDeviceFromStrip(trackId: string, deviceId: string): void {
        if (this.fallbackMode) {
            return;
        }
        try {
            this.runtimeGraph.mutate(() => ({
                value: undefined,
                changed: this.trackNodes.get(trackId)?.removeDevice(deviceId) ?? false,
            }));
        } catch (error) {
            if (error instanceof RuntimeGraphMutationFailure) {
                this.runtimeGraph.recordMutation(error.mutation);
            }
            throw error;
        }
    }

    public updateDeviceParam(trackId: string, deviceId: string, paramId: string, value: number): void {
        if (this.fallbackMode) {
            return;
        }
        this.trackNodes.get(trackId)?.updateParam(deviceId, paramId, value);
    }

    public updateDevicePatch(trackId: string, deviceId: string, patch: Record<string, unknown>): void {
        if (this.fallbackMode) {
            return;
        }
        this.trackNodes.get(trackId)?.updatePatch(deviceId, patch);
    }

    public async applyGrinderPreset(
        trackId: string,
        deviceId: string,
        input: RuntimeGrinderPresetInput
    ): Promise<void> {
        if (this.fallbackMode) {
            return;
        }
        const strip = this.trackNodes.get(trackId);
        if (strip) {
            await strip.applyGrinderPreset(deviceId, input);
        }
    }

    public scheduleDeviceParam(trackId: string, deviceId: string, paramId: string, value: number, time: number): void {
        if (this.fallbackMode) {
            return;
        }
        this.trackNodes.get(trackId)?.scheduleParam(deviceId, paramId, value, time);
    }

    public scheduleDeviceKeyOn(
        trackId: string,
        deviceId: string,
        pitch: number,
        velocity: number,
        time?: number
    ): void {
        if (this.fallbackMode) {
            return;
        }
        this.trackNodes.get(trackId)?.scheduleDeviceKeyOn(deviceId, pitch, velocity, time);
    }

    public scheduleDeviceKeyOff(
        trackId: string,
        deviceId: string,
        pitch: number,
        velocity: number,
        time?: number
    ): void {
        if (this.fallbackMode) {
            return;
        }
        this.trackNodes.get(trackId)?.scheduleDeviceKeyOff(deviceId, pitch, velocity, time);
    }

    public updateDeviceBypass(trackId: string, deviceId: string, bypassed: boolean): void {
        if (this.fallbackMode) {
            return;
        }
        this.runtimeGraph.mutate(() => ({
            value: undefined,
            changed: this.trackNodes.get(trackId)?.updateBypass(deviceId, bypassed) ?? false,
        }));
    }

    public addMidiFxToStrip(trackId: string, fxId: string, fxType: 'arp' | 'velocity' | 'probability'): void {
        if (this.fallbackMode) {
            return;
        }
        this.trackNodes.get(trackId)?.addMidiFx(fxId, fxType);
    }

    public removeMidiFxFromStrip(trackId: string, fxId: string): void {
        if (this.fallbackMode) {
            return;
        }
        this.trackNodes.get(trackId)?.removeMidiFx(fxId);
    }

    public updateMidiFxParam(trackId: string, fxId: string, paramId: string, value: number): void {
        if (this.fallbackMode) {
            return;
        }
        this.trackNodes.get(trackId)?.updateMidiFxParam(fxId, paramId, value);
    }

    public updateMidiFxBypass(trackId: string, fxId: string, bypassed: boolean): void {
        if (this.fallbackMode) {
            return;
        }
        this.trackNodes.get(trackId)?.updateMidiFxBypass(fxId, bypassed);
    }

    public syncKneadState(trackId: string, clips: Record<string, unknown>): void {
        const trackNode = this.trackNodes.get(trackId);
        if (trackNode) {
            for (const dn of trackNode.strip.deviceNodes) {
                if (dn.kneadControls) {
                    dn.kneadControls.updateState(clips);
                }
            }
        }
    }

    public setTransportInfo(
        beat: number,
        positionSeconds: number,
        tempo: number,
        isPlaying: boolean,
        loopStart = 0,
        loopEnd = 0,
        isLooping = false
    ): void {
        this.transportClock.write({ beat, positionSeconds, tempo, isPlaying, loopStart, loopEnd, isLooping });
    }

    public setSend(sourceTrackId: string, busId: string, level: number, preFader = false): void {
        this.sends.setSend(sourceTrackId, busId, level, preFader);
    }

    public scheduleSendAutomation(sourceTrackId: string, busId: string, level: number, time: number): void {
        this.sends.scheduleSendAutomation(sourceTrackId, busId, level, time);
    }

    public removeSend(sourceTrackId: string, busId: string): void {
        this.sends.removeSend(sourceTrackId, busId);
    }

    public setTrackOutput(trackId: string, outputId: string, padBinding?: ToasterPadBinding): void {
        try {
            this.runtimeGraph.mutate(() => {
                const trackNode = this.trackNodes.get(trackId);
                if (!trackNode) {
                    return { value: undefined, changed: false };
                }
                if (!this.hasRuntimeOutputDestination(outputId)) {
                    logger.warn(
                        `[AudioEngine] Rejected output route to absent live destination: ${trackId} -> ${outputId}`
                    );
                    return { value: undefined, changed: false };
                }
                return this.setTrackOutputTransaction(trackNode, outputId, padBinding);
            });
        } catch (error) {
            if (error instanceof RuntimeGraphMutationFailure) {
                this.runtimeGraph.recordMutation(error.mutation);
            }
            throw error;
        }
    }

    public async waitForDevices(timeoutMs = 10000): Promise<AudioDeviceWaitResult> {
        const capturedPromises = new Set(this.pendingDevicePromises);
        if (capturedPromises.size === 0) {
            return { status: 'ready', devices: [] };
        }

        const pendingLoads = [...this.trackNodes.values()].flatMap((trackNode) =>
            trackNode.capturePendingDeviceLoads()
        );
        const capturedLoads = pendingLoads
            .filter(({ promise }) => capturedPromises.has(promise))
            .map((load) => ({ ...load, observation: this.deviceReadinessDiagnostics.captureWaitState(load.token) }));
        try {
            const lastKnownStage = new Map(
                capturedLoads.map(({ token, observation }) => [token.tokenId, observation.read().stage])
            );
            const waitStartedAtMs = Date.now();
            const allSettled = Promise.allSettled(capturedPromises).then(() => true);

            while (true) {
                const pending = capturedLoads.filter(({ promise }) => this.pendingDevicePromises.has(promise));
                if (pending.length === 0) {
                    break;
                }

                const now = Date.now();
                const expired = new Set<Promise<unknown>>();
                let nextDeadline = Number.POSITIVE_INFINITY;
                for (const load of pending) {
                    const state = load.observation.read();
                    if (state.stage !== null) {
                        lastKnownStage.set(load.token.tokenId, state.stage);
                    }
                    const deadline = Math.max(waitStartedAtMs, state.lastActivityAtMs) + timeoutMs;
                    if (deadline <= now) {
                        expired.add(load.promise);
                    } else {
                        nextDeadline = Math.min(nextDeadline, deadline);
                    }
                }
                if (expired.size > 0) {
                    logger.warn(`[AudioEngine] Device loading timed out (${expired.size} pending)`);
                    for (const trackNode of this.trackNodes.values()) {
                        trackNode.timeoutPendingDeviceLoads(expired);
                    }
                    continue;
                }

                let timeoutId: ReturnType<typeof setTimeout> | undefined;
                const settled = await Promise.race([
                    allSettled,
                    new Promise<false>((resolve) => {
                        timeoutId = setTimeout(() => resolve(false), Math.max(0, nextDeadline - now));
                    }),
                ]);
                if (timeoutId !== undefined) {
                    clearTimeout(timeoutId);
                }
                if (settled) {
                    break;
                }
            }
            for (const promise of capturedPromises) {
                this.pendingDevicePromises.delete(promise);
            }

            const devices = capturedLoads.map(({ token, observation }) => {
                const state = observation.read();
                return {
                    deviceId: token.deviceId,
                    status: state.status === 'pending' ? ('cancelled' as const) : state.status,
                    stage: state.status === 'ready' ? null : (state.stage ?? lastKnownStage.get(token.tokenId) ?? null),
                };
            });
            let status: AudioDeviceWaitResult['status'] = 'ready';
            if (devices.some((device) => device.status === 'failed')) {
                status = 'failed';
            } else if (devices.some((device) => device.status === 'cancelled')) {
                status = 'cancelled';
            }
            return { status, devices };
        } finally {
            for (const load of capturedLoads) {
                load.observation.release();
            }
        }
    }

    public wireSidechainRoute(sourceTrackId: string, targetTrackId: string, targetDeviceId: string): void {
        this.sidechains.wireRoute(sourceTrackId, targetTrackId, targetDeviceId);
    }

    public refreshSidechainAlignment(keyDelayFor: SidechainKeyDelayResolver): void {
        this.sidechains.refreshAlignment(keyDelayFor);
    }

    public unwireSidechainRoute(sourceTrackId: string, targetDeviceId: string): void {
        this.sidechains.unwireRoute(sourceTrackId, targetDeviceId);
    }

    public scheduleOscillator(frequency: number, startTime: number, duration: number, gain = 0.3): void {
        this.scheduledSources.scheduleOscillator(frequency, startTime, duration, gain);
    }

    public scheduleClick(time: number, accent: boolean, volume = 1): void {
        this.scheduledSources.scheduleClick(time, accent, volume);
    }

    public stopAllScheduled(): void {
        if (this.fallbackMode) {
            return;
        }
        this.scheduledSources.stopAll();

        // Release held notes on every device that can hold one, through the
        // generic `controller.allNotesOff` every instrument descriptor already
        // publishes (`engine/wasmDeviceRegistry.ts`). This used to be a
        // hand-kept branch per device kind — a raw worklet postMessage for
        // Fermenter/Toaster plus explicit Grand Boule and Levain calls — which
        // meant every new instrument had to remember to add itself here or its
        // voices would keep sounding through a stop (audit MD-6). Reading the
        // registry's own surface instead means it cannot drift.
        //
        // One message per device, not a 128-note fan-out: each engine's
        // `allNotesOff` releases every voice internally. Levain in particular
        // uses it to skip the per-note realism release burst that 128 note-offs
        // would turn into an audible "ksshh".
        for (const [, trackNode] of this.trackNodes) {
            for (const dn of trackNode.strip.deviceNodes) {
                dn.controller?.allNotesOff?.();
                dn.controller?.reset?.();
            }
        }
    }

    public registerScheduledSource(node: AudioScheduledSourceNode): void {
        this.scheduledSources.register(node);
    }

    public beginAudioPreviewIntent() {
        return this.preview.beginOrdinaryIntent();
    }

    public beginExclusiveAudioPreviewIntent() {
        return this.preview.beginExclusiveIntent();
    }

    public get audioPreviewOutput(): AudioNode {
        return this.master.monitorMonoNode;
    }

    public setAudioPreviewProgrammeSuppressed(suppressed: boolean): void {
        this.preview.setProgrammeSuppressed(suppressed);
    }

    public holdAudioPreviewRestoration(restoration: Promise<void>): void {
        this.preview.holdRestoration(restoration);
    }

    public playAudioPreviewTone(frequency: number, durationSeconds: number, intent: AudioPreviewIntent) {
        return this.preview.playTone(frequency, durationSeconds, intent);
    }

    public resetGraph(): void {
        this.preview.beginReset();
        try {
            runAllEffects([() => this.preview.disposeIntents(), () => this.resetProjectGraph()]);
        } finally {
            this.preview.endReset();
        }
    }

    private resetProjectGraph(): void {
        this.runtimeGraphDeltas.forgetWithheldDeviceNotices();
        // The carried set names tracks of the project being torn down; a strip
        // ensured for the next one must not inherit a closed gate from it.
        this.nativeCarriedTrackIds = new Set();
        // A monitor edge feeds a strip gain node, so it cannot outlive the graph
        // it feeds. Release the microphone before the strips below are torn down,
        // on every teardown path — project switch and disposal alike.
        runAllEffects([
            stopInputMonitoring,
            // Tear down all per-project audio graph state (tracks, buses, sends,
            // sidechain routes) without closing the AudioContext, master nodes,
            // or already-loaded worklet modules. Used when switching projects.
            () => {
                const hadLiveGraph =
                    !this.fallbackMode &&
                    (this.trackNodes.size > 0 ||
                        this.busNodes.size > 0 ||
                        this.sends.sendNodes.size > 0 ||
                        this.sidechains.connectionCount() > 0 ||
                        this.adjustmentRuntime.listLiveBusKeys().length > 0 ||
                        this.toasterPads.hasLiveRoute());
                // Reset retires the whole graph, so it must not reroute doomed
                // peers through ordinary transactional strip removal. Snapshot
                // each owner once and keep retiring after an independent fault.
                runAllEffects([
                    () => this.stopAllScheduled(),
                    () => this.adjustmentRuntime.reset(),
                    ...this.sidechains.resetEffects(),
                    ...this.sends.resetEffects(),
                    ...this.toasterPads.resetEffects(),
                    ...Array.from(this.busNodes.values(), (node) => () => node.dispose()),
                    ...Array.from(this.trackNodes.values(), (node) => () => node.dispose()),
                    () => {
                        // Retired ownership must not replay into the next project,
                        // even when a physical disconnect or disposal reported a fault.
                        this.sidechains.clear();
                        this.sends.clear();
                        this.busNodes.clear();
                        this.trackNodes.clear();
                        this.toasterPads.clear();
                        this.pendingDevicePromises.clear();
                    },
                    () => this.deviceReadinessDiagnostics.reset(),
                    // Publish the changed generation before any retirement fault
                    // escapes; empty resets still publish no topology mutation.
                    () => this.runtimeGraph.mutate(() => ({ value: undefined, changed: hadLiveGraph })),
                ]);
            },
        ]);
    }

    public applyAdjustmentLayerTick(records: AdjustmentLayerTickInput[]): void {
        this.assertActive();
        this.adjustmentRuntime.applyTick(records);
    }

    public resetAdjustmentLayers(): void {
        this.adjustmentRuntime.reset();
    }

    public listLiveAdjustmentBusKeys(): string[] {
        return this.adjustmentRuntime.listLiveBusKeys();
    }

    public dispose(): Promise<void> {
        this.disposalPromise ??= this.disposeOnce();
        return this.disposalPromise;
    }

    private async disposeOnce(): Promise<void> {
        // Invalidate loadWorklets before a stale continuation can rebuild the disposed graph.
        this.disposed = true;
        this.initializationGeneration++;
        this.initializationCancellation?.reject(new Error('Audio engine was disposed during initialization.'));
        this.initializationCancellation = null;
        this.initPromise = null;
        this.workletReady = false;

        // Keep the synchronous shutdown order, but attempt every independent
        // resource before reporting a fault. Context closure must still settle
        // before the one cached disposal result is returned to any caller.
        await runAllAsyncEffects([
            () =>
                runAllEffects([
                    () => this.postShutdownToWorklets(),
                    () => this.resetGraph(),
                    ...this.master.disposeEffects(),
                    () => this.transportClock.release(),
                ]),
            () => this.context.close(),
        ]);
    }

    private postShutdownToWorklets(): void {
        const shutdown = { type: 'shutdown' as const };
        const hasWorkletNode = typeof AudioWorkletNode !== 'undefined';
        this.master.postShutdown(shutdown);
        for (const [, trackNode] of this.trackNodes) {
            trackNode.strip.meterNode?.port.postMessage(shutdown);
            for (const dn of trackNode.strip.deviceNodes) {
                for (const node of dn.nodes) {
                    if (hasWorkletNode && node instanceof AudioWorkletNode) {
                        node.port.postMessage(shutdown);
                    }
                }
            }
        }
    }
}

export function composeWebAudioEngine(providedContext?: AudioContext): {
    engine: AudioEngine;
    internals: WebAudioEngineInternals;
} {
    const engine = new AudioEngineImpl(providedContext);
    return { engine, internals: AudioEngineImpl.internalsOf(engine) };
}

export const audioEngine = composeWebAudioEngine().engine;
