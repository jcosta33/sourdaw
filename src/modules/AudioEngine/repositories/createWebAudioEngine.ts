import { runAllEffects } from '#/utils/runEffects';

import { createAdjustmentLayerRuntime } from '../engine/AdjustmentLayerRuntime';
import { createDeviceReadinessDiagnostics } from '../engine/deviceReadinessDiagnostics';

import { stopInputMonitoring } from './audioRecorder/stopInputMonitoring';
import { createAudioPreview } from './webAudioEngine/createAudioPreview';
import { createEngineDeviceCollaborators } from './webAudioEngine/createEngineDeviceCollaborators';
import { createEngineDiagnostics } from './webAudioEngine/createEngineDiagnostics';
import { createEngineLifecycle } from './webAudioEngine/createEngineLifecycle';
import { type MasterMeterNode } from './webAudioEngine/createMasterSection';
import { createRuntimeGraphDeltaApplication } from './webAudioEngine/createRuntimeGraphDeltaApplication';
import { createRuntimeGraphRevision } from './webAudioEngine/createRuntimeGraphRevision';
import { createScheduledSources } from './webAudioEngine/createScheduledSources';
import { createSendRouting } from './webAudioEngine/createSendRouting';
import { createSidechainRouting } from './webAudioEngine/createSidechainRouting';
import { createStripDeviceOperations } from './webAudioEngine/createStripDeviceOperations';
import { createToasterPadRouting, type ToasterPadRoute } from './webAudioEngine/createToasterPadRouting';
import { createTrackStrips } from './webAudioEngine/createTrackStrips';
import { createTransportClock } from './webAudioEngine/createTransportClock';

import type { BusNode } from '../engine/BusNode';
import type { TrackNode } from '../engine/TrackNode';
import type {
    AudioDeviceWaitResult,
    AudioEngine,
    BuiltinDeviceNode,
    BusStrip,
    SendNode,
} from '../models/AudioEngineState';

/**
 * Repository-internal view of engine state for repository specs, the
 * topology test harness and browser specs. Never exported from a contract
 * barrel. Collections are the engine's live objects, so mutating one mutates
 * engine state.
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
    /** The edge that carries programme to the listening output; exclusive preview cuts it. */
    readonly previewProgrammeGate: GainNode;
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

/**
 * Builds the engine from its concern units. Units reach each other only
 * through the ports wired here; a port that names a unit created further down
 * is read only after composition returns. The AudioContext opens inside the
 * lifecycle unit, before any other unit builds a node.
 */
export function composeWebAudioEngine(providedContext?: AudioContext): {
    engine: AudioEngine;
    internals: WebAudioEngineInternals;
} {
    const runtimeGraph = createRuntimeGraphRevision();
    const deviceReadinessDiagnostics = createDeviceReadinessDiagnostics();
    const deviceCollaborators = createEngineDeviceCollaborators();
    const transportClock = createTransportClock({ readSampleRate: () => lifecycle.context().sampleRate });
    const lifecycle = createEngineLifecycle({
        providedContext,
        openLiveContext: (latencyHint) => new AudioContext({ latencyHint, sampleRate: 48_000 }),
        readTrackNodes: () => strips.trackNodes,
        // Teardown order is audible: worklets stop before the graph they feed is
        // reset, and the master chain outlives every strip that sums into it.
        readDisposalEffects: () => [
            () => lifecycle.postShutdownToWorklets(),
            () => resetGraph(),
            ...lifecycle.master().disposeEffects(),
            () => transportClock.release(),
        ],
    });
    const readContext = lifecycle.context;
    const isFallback = lifecycle.isFallback;

    const scheduledSources = createScheduledSources({
        readContext,
        readMasterGain: () => lifecycle.master().gainNode,
        assertActive: lifecycle.assertActive,
        isFallback,
    });
    const preview = createAudioPreview({
        readContext,
        readProgrammeGate: () => lifecycle.master().previewProgrammeGate,
        readMonitorMono: () => lifecycle.master().monitorMonoNode,
        isDisposed: lifecycle.isDisposed,
        isFallback,
    });

    function readTrackStrip(trackId: string) {
        return strips.trackNodes.get(trackId)?.strip;
    }
    function mutateRuntimeGraph(mutation: () => boolean): void {
        runtimeGraph.mutate(() => ({ value: undefined, changed: mutation() }));
    }
    const sends = createSendRouting({
        readContext,
        isFallback,
        readTrackStrip,
        ensureBusStrip: (busId) => strips.ensureBusStripInGraph(busId),
        scheduleTrackSendAutomation: (sourceTrackId, busId, level, time) =>
            strips.trackNodes.get(sourceTrackId)?.scheduleSendAutomation(busId, level, time),
        mutateRuntimeGraph,
    });
    const toasterPads = createToasterPadRouting({ readTrackStrip });
    const sidechains = createSidechainRouting({ readContext, isFallback, readTrackStrip, mutateRuntimeGraph });

    const strips = createTrackStrips({
        lifecycle,
        runtimeGraph,
        sends,
        sidechains,
        toasterPads,
        deviceReadinessDiagnostics,
        deviceCollaborators: deviceCollaborators.collaborators,
        readTransportBuffer: transportClock.sharedBuffer,
        getAdjustmentBusForTrack: (trackId) => adjustmentRuntime.getBusInputForTrack(trackId),
        ensureTrackStripThroughEngine: (trackId) => {
            engine.ensureTrackStrip(trackId);
        },
    });
    const { trackNodes, busNodes } = strips;

    const runtimeGraphDeltas = createRuntimeGraphDeltaApplication({
        readRevision: () => runtimeGraph.current(),
        readProjectRevisionValidator: () => runtimeGraph.projectRevisionValidator(),
        readTopologyValidator: () => runtimeGraph.topologyValidator(),
        mutateRuntimeGraph: runtimeGraph.mutate,
        isFallback,
        readTrackNode: (trackId) => trackNodes.get(trackId),
        readToasterPadBinding: (trackId) => toasterPads.routes.get(trackId),
        hasOutputDestination: strips.hasRuntimeOutputDestination,
        ensureTrackStripInGraph: (trackId) => {
            strips.ensureTrackStripInGraph(trackId);
        },
        createTrackNode: strips.createTrackNode,
        registerTrackNode: (trackId, node) => {
            trackNodes.set(trackId, node);
        },
        unregisterTrackNode: (trackId) => {
            trackNodes.delete(trackId);
        },
        setTrackOutputTransaction: strips.setTrackOutputTransaction,
    });

    const adjustmentRuntime = createAdjustmentLayerRuntime({
        getContext: () => lifecycle.context() ?? null,
        getTrackDefaultDestination: (trackId) => trackNodes.get(trackId)?.getDefaultDestination() ?? null,
        rerouteTrack: (trackId) => trackNodes.get(trackId)?.routeOutput(),
        builtinDevices: deviceCollaborators.collaborators,
    });

    const devices = createStripDeviceOperations({
        isFallback,
        runtimeGraph,
        trackNodes,
        ensureTrackStripInGraph: strips.ensureTrackStripInGraph,
        pendingDevicePromises: strips.pendingDevicePromises,
        deviceReadinessDiagnostics,
    });
    const diagnostics = createEngineDiagnostics({
        lifecycle,
        trackNodes,
        busNodes,
        readSendCount: () => sends.sendNodes.size,
        readSidechainCount: () => sidechains.connectionCount(),
        readAdjustmentDiagnostics: () => adjustmentRuntime.getDiagnostics(),
        readScheduledSourceCount: () => scheduledSources.nodes().length,
        deviceReadinessDiagnostics,
    });

    function stopAllScheduled(): void {
        if (isFallback()) {
            return;
        }
        scheduledSources.stopAll();
        devices.releaseHeldNotes();
    }

    function resetProjectGraph(): void {
        runtimeGraphDeltas.forgetWithheldDeviceNotices();
        // The carried set names tracks of the project being torn down; a strip
        // ensured for the next one must not inherit a closed gate from it.
        strips.forgetNativeCarriedTracks();
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
                    !isFallback() &&
                    (trackNodes.size > 0 ||
                        busNodes.size > 0 ||
                        sends.sendNodes.size > 0 ||
                        sidechains.connectionCount() > 0 ||
                        adjustmentRuntime.listLiveBusKeys().length > 0 ||
                        toasterPads.hasLiveRoute());
                // Reset retires the whole graph, so it must not reroute doomed
                // peers through ordinary transactional strip removal. Snapshot
                // each owner once and keep retiring after an independent fault.
                // Sends and sidechain edges disconnect before any strip disposes.
                runAllEffects([
                    () => stopAllScheduled(),
                    () => adjustmentRuntime.reset(),
                    ...sidechains.resetEffects(),
                    ...sends.resetEffects(),
                    ...toasterPads.resetEffects(),
                    ...Array.from(busNodes.values(), (node) => () => node.dispose()),
                    ...Array.from(trackNodes.values(), (node) => () => node.dispose()),
                    () => {
                        // Retired ownership must not replay into the next project,
                        // even when a physical disconnect or disposal reported a fault.
                        sidechains.clear();
                        sends.clear();
                        busNodes.clear();
                        trackNodes.clear();
                        toasterPads.clear();
                        strips.pendingDevicePromises.clear();
                    },
                    () => deviceReadinessDiagnostics.reset(),
                    // Publish the changed generation before any retirement fault
                    // escapes; empty resets still publish no topology mutation.
                    () => runtimeGraph.mutate(() => ({ value: undefined, changed: hadLiveGraph })),
                ]);
            },
        ]);
    }

    function resetGraph(): void {
        preview.beginReset();
        try {
            runAllEffects([() => preview.disposeIntents(), () => resetProjectGraph()]);
        } finally {
            preview.endReset();
        }
    }

    const engine: AudioEngine = {
        get context() {
            return lifecycle.context();
        },
        set context(context: AudioContext) {
            lifecycle.replaceContext(context);
        },
        get masterGainNode() {
            return lifecycle.master().gainNode;
        },
        get masterAnalyser() {
            return lifecycle.master().analyser;
        },
        get masterAnalyserLeft() {
            return lifecycle.master().analyserLeft;
        },
        get masterAnalyserRight() {
            return lifecycle.master().analyserRight;
        },
        get audioPreviewOutput() {
            return lifecycle.master().monitorMonoNode;
        },

        initialize: lifecycle.initialize,
        resume: lifecycle.resume,
        suspend: lifecycle.suspend,
        dispose: lifecycle.dispose,
        resetGraph,

        getHealth: diagnostics.getHealth,
        getDeviceReadinessDiagnostics: diagnostics.getDeviceReadinessDiagnostics,
        isAudioAvailable: diagnostics.isAudioAvailable,
        getDiagnostics: diagnostics.getDiagnostics,
        getState: diagnostics.getState,
        resetPlaybackLatencyStats: diagnostics.resetPlaybackLatencyStats,

        setMasterGain: (value) => {
            if (isFallback()) {
                return;
            }
            lifecycle.master().setGain(value);
        },
        getMasterGain: () => (isFallback() ? 0 : lifecycle.master().getGain()),
        setControlRoomMonitoring: (monitoring) => {
            if (isFallback()) {
                return;
            }
            lifecycle.master().setControlRoomMonitoring(monitoring);
        },
        /**
         * The master output peak in linear amplitude, or `null` when no meter tap is
         * wired and the engine therefore has no measurement to report.
         *
         * `null` and `0` are different claims and callers must render them
         * differently: `0` says the worklet measured this block and it was silent,
         * `null` says nobody measured anything. Collapsing the two is what let a
         * status bar show "-∞ dB" over a mix that was audibly playing.
         */
        getMasterPeakLevel: () => lifecycle.master().readPeak(),

        getRuntimeGraphRevision: () => runtimeGraph.current(),
        setRuntimeGraphProjectRevisionValidator: (validator) => runtimeGraph.setProjectRevisionValidator(validator),
        setRuntimeGraphTopologyValidator: (validator) => runtimeGraph.setTopologyValidator(validator),
        setUseCaseDeviceCollaborators: deviceCollaborators.setUseCaseCollaborators,
        applyRuntimeGraphDelta: (input) => runtimeGraphDeltas.apply(input),
        initializeTrackStripFromSnapshot: (input) => runtimeGraphDeltas.initializeTrackStripFromSnapshot(input),

        ensureTrackStrip: strips.ensureTrackStrip,
        removeTrackStrip: strips.removeTrackStrip,
        deactivateTrackStrip: strips.deactivateTrackStrip,
        getTrackStrip: strips.getTrackStrip,
        setTrackGain: strips.setTrackGain,
        setTrackPan: strips.setTrackPan,
        scheduleTrackGain: strips.scheduleTrackGain,
        scheduleTrackPan: strips.scheduleTrackPan,
        cancelTrackAutomationRamps: strips.cancelTrackAutomationRamps,
        setTrackMute: strips.setTrackMute,
        setNativeCarriedTracks: strips.setNativeCarriedTracks,
        setTrackSoloGate: strips.setTrackSoloGate,
        getTrackPeakLevel: strips.getTrackPeakLevel,
        ensureBusStrip: strips.ensureBusStrip,
        removeBusStrip: strips.removeBusStrip,
        setBusGain: strips.setBusGain,
        getBusPeakLevel: strips.getBusPeakLevel,
        setTrackOutput: strips.setTrackOutput,

        findToasterControls: devices.findToasterControls,
        findLufsMeterReading: devices.findLufsMeterReading,
        findDeviceOutputNode: devices.findDeviceOutputNode,
        updateDeviceParam: devices.updateDeviceParam,
        updateDevicePatch: devices.updateDevicePatch,
        scheduleDeviceParam: devices.scheduleDeviceParam,
        scheduleDeviceKeyOn: devices.scheduleDeviceKeyOn,
        scheduleDeviceKeyOff: devices.scheduleDeviceKeyOff,
        updateDeviceBypass: devices.updateDeviceBypass,
        addMidiFxToStrip: devices.addMidiFxToStrip,
        removeMidiFxFromStrip: devices.removeMidiFxFromStrip,
        updateMidiFxParam: devices.updateMidiFxParam,
        updateMidiFxBypass: devices.updateMidiFxBypass,
        syncKneadState: devices.syncKneadState,
        waitForDevices: devices.waitForDevices,

        setTransportInfo: (beat, positionSeconds, tempo, isPlaying, loopStart = 0, loopEnd = 0, isLooping = false) =>
            transportClock.write({ beat, positionSeconds, tempo, isPlaying, loopStart, loopEnd, isLooping }),

        setSend: (sourceTrackId, busId, level, preFader = false) =>
            sends.setSend(sourceTrackId, busId, level, preFader),
        scheduleSendAutomation: sends.scheduleSendAutomation,
        removeSend: sends.removeSend,
        wireSidechainRoute: sidechains.wireRoute,
        refreshSidechainAlignment: sidechains.refreshAlignment,
        unwireSidechainRoute: sidechains.unwireRoute,

        scheduleOscillator: (frequency, startTime, duration, gain = 0.3) =>
            scheduledSources.scheduleOscillator(frequency, startTime, duration, gain),
        scheduleClick: (time, accent, volume = 1) => scheduledSources.scheduleClick(time, accent, volume),
        stopAllScheduled,
        registerScheduledSource: scheduledSources.register,

        beginAudioPreviewIntent: preview.beginOrdinaryIntent,
        beginExclusiveAudioPreviewIntent: preview.beginExclusiveIntent,
        setAudioPreviewProgrammeSuppressed: preview.setProgrammeSuppressed,
        holdAudioPreviewRestoration: preview.holdRestoration,
        playAudioPreviewTone: preview.playTone,

        applyAdjustmentLayerTick: (records) => {
            lifecycle.assertActive();
            adjustmentRuntime.applyTick(records);
        },
        resetAdjustmentLayers: () => adjustmentRuntime.reset(),
        listLiveAdjustmentBusKeys: () => adjustmentRuntime.listLiveBusKeys(),
    };

    /**
     * Fields are read through getters because reset, disposal and the
     * fallback path replace or clear what they name. Methods are the units' own
     * closures, so a harness that installs them as own properties of the engine
     * cannot make them call themselves.
     */
    const internals: WebAudioEngineInternals = {
        get trackNodes() {
            return trackNodes;
        },
        get busNodes() {
            return busNodes;
        },
        get sendNodes() {
            return sends.sendNodes;
        },
        get toasterPadRoutes() {
            return toasterPads.routes;
        },
        get pendingSidechainRoutes() {
            return sidechains.pendingRoutes;
        },
        get pendingDevicePromises() {
            return strips.pendingDevicePromises;
        },
        get scheduledNodes() {
            return scheduledSources.nodes();
        },
        get deviceReadinessDiagnostics() {
            return deviceReadinessDiagnostics;
        },
        get masterMeterNode() {
            return lifecycle.master().meterNode();
        },
        get monitorMonoNode() {
            return lifecycle.master().monitorMonoNode;
        },
        get monitorDimNode() {
            return lifecycle.master().monitorDimNode;
        },
        get masterStereoSplitter() {
            return lifecycle.master().stereoSplitter;
        },
        get masterStereoTapSink() {
            return lifecycle.master().stereoTapSink;
        },
        get previewProgrammeGate() {
            return lifecycle.master().previewProgrammeGate;
        },
        addDeviceToStrip: devices.addDeviceToStrip,
        removeDeviceFromStrip: devices.removeDeviceFromStrip,
        reconnectRoutingForTrack: strips.reconnectRoutingForTrack,
        reconcileToasterParent: toasterPads.reconcileParent,
        handleDeviceRemoved: toasterPads.handleDeviceRemoved,
        crossfadeSendTap: sends.crossfadeSendTap,
        waitForDevices: devices.waitForDevices,
    };

    return { engine, internals };
}

const importTimeEngine = composeWebAudioEngine();

export const audioEngine = importTimeEngine.engine;
/** The import-time engine's internals, for browser specs that drive it; never re-exported from a barrel. */
export const audioEngineInternals = importTimeEngine.internals;
