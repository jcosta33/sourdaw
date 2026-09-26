// registerDependencies owns app singleton construction; bootstrap wires those
// instances into module-owned dependency ports before runtime subscribers start.
import { setRuntimeLogger } from '#/infra/logger/runtimeLogger';
import { flushDeferredStorageNotice } from '#/infra/store/storage/storageFullNotice';
import { externalClientManifestPort } from '#/modules/AgentAdapters/useCases';
import { MIDI_TRANSFORM_IMPLEMENTATIONS } from '#/modules/AiGeneration/useCases';
import {
    beginMixAnalysis,
    assertCanonicalLlmActionStrategies,
    completeMixAnalysis,
    getAgentCapabilityCatalog,
    failMixAnalysis,
    initializeVoiceInputAvailability,
    recoverInterruptedAgentRuns,
    recoverRetainedSectionRenderEffects,
    setVoiceToggleEventBus,
} from '#/modules/AiRuntime/useCases';
import { persistDeviceParam, resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import {
    acceptsExternalPluginAutomationParameter,
    clampDeviceParameterValue,
    clampExternalPluginAutomationValue,
    getAllTracks,
    getAutomationParameterRange,
    getPluginById,
    isDeviceParameterAutomatable,
    persistDevicePatch,
    quantiseDeviceParameterValue,
    cleanupUnusedFreezeFiles,
    runtimeGraphTopology,
    setTrackGain as setTrackGainArrangement,
    setTrackPan as setTrackPanArrangement,
    setDeviceParameter,
    initStalenessDetection,
    setArrangementEventBus,
    setClipAudioAssetStager,
    setOfflineRenderDependencies,
    setTimeOperationDependencies,
    setVcaRuntimeProjectionDependencies,
    getDeviceContractVersionForCommand,
    getDeviceTypesForCommandDeviceIds,
    reserveNextTrackColorForCommand,
} from '#/modules/Arrangement/useCases';
import { setMixAnalysisDisplayLifecycle } from '#/modules/AudioAnalysis/useCases';
import {
    updateDeviceParam,
    updateDevicePatch,
    getAudioContext,
    getCompensationDelay,
    commitPitchEdit,
    configureAudioDeviceRuntimeSink,
    configureOfflineDeviceParameterLaw,
    configureOfflineMidiEventProjection,
    configureOfflinePpqEndpointProjection,
    configureOfflineYeastMidiProcessing,
    configureRuntimeGraphProjectRevisionValidator,
    configureRuntimeGraphTopologyValidator,
    recordNativeChainReleases,
    configureDurableAudioBufferOwnership,
    isTunerTelemetryNativelyOwned,
    startMainThreadLongTaskObservation,
    stopAllScheduled,
} from '#/modules/AudioEngine/useCases';
import { clearAgentMeasurementArtifacts, stageAudioBufferAsset } from '#/modules/AudioRendering/useCases';
import {
    getAutomationValueAtBeat,
    createOfflineAutomationEvaluator,
    prepareAutomationTimeOperation,
    prepareAutomationTimeStateRestore,
    recordAutomationValue,
    setAutomationRecordingDependencies,
    setAutomationParameterRangeResolver,
    setModulationDependencies,
} from '#/modules/Automation/useCases';
import { updateBacteriaMeters } from '#/modules/Bacteria/stores';
import { initBacteriaModAssignmentsPersistence, initBacteriaSubscribers } from '#/modules/Bacteria/useCases';
import { initBrowserAi, initRaveModels } from '#/modules/BrowserAi/useCases';
import {
    canExecuteCommandBatch,
    canMutateBranchMetadata,
    configureCollaborationAssetOwner,
    configureDurableAssetCommitProof,
    getAssetTransfer,
    leaveSession,
} from '#/modules/Collaboration/useCases';
import { registerMidiTransforms } from '#/modules/Command/stores';
import {
    commandBatchPreflightPort,
    commandBatchPreviewPort,
    configureCommandBatchIdempotency,
    commandDeviceVersionsPort,
    executeUserAppAction,
    getExecutableAppActionGroundingCatalog,
    registerProductionCommandHandlers,
    productionBriefAdmissionPort,
    setActionHistoryMetadataPort,
    commandProjectRevisionPort,
    commandProjectDivergencePort,
    getVersionedCommandBatchCommitDisposition,
    commandTrackDefaultsPort,
    commandRuntimeRepairPort,
    setCommandEventBus,
    syncActionReplayMetadata,
    stampSessionUndoWitness,
} from '#/modules/Command/useCases';
import { setMidiLearnDependencies } from '#/modules/ControlSurface/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    agentProjectInspectionPort,
    initBranchState,
    captureProjectRevision,
    projectRevisionMatchesLiveIgnoringCommandCheckpoint,
    inspectAgentProjectDivergence,
    createCommandPreviewWorkspace,
    createCommandRecoveryWorkspace,
    markActionHistoryEntryReverted,
    recordActionHistoryEntries,
    recordActionHistoryEntry,
    clearActionHistory as clearCrdtActionHistory,
    registerCrdtStorageRuntime,
    sessionUndoWitnessStampPort,
} from '#/modules/CrdtDocument/useCases';
import {
    initCrumbsDeviceStatePersistence,
    prepareCrumbsEngine,
    syncCrumbsNativeInstances,
} from '#/modules/Crumbs/useCases';
import { updateCrustMeters, deleteCrustMeters } from '#/modules/Crust/stores';
import { setFermenterTelemetry } from '#/modules/Fermenter/stores';
import { setFermenterMappedParam, setFermenterDependencies } from '#/modules/Fermenter/useCases';
import { updateGlutenMeters, deleteGlutenMeters } from '#/modules/Gluten/stores';
import { updateGrinderTelemetry } from '#/modules/Grinder/stores';
import { setPitchEditDependencies } from '#/modules/Knead/useCases';
import { setEngineReady } from '#/modules/Levain/stores';
import {
    initLevainDeviceStatePersistence,
    registerLevainDevice,
    unregisterLevainDevice,
} from '#/modules/Levain/useCases';
import {
    prepareMidiGlobalTimeTransaction,
    prepareMidiTimeStateRestore,
    createChordPitchProjector,
    createGrooveMidiEventProjector,
    resolveMidiNoteArticulationId,
    shouldPlayMidiEvent,
    destroyWebMidi,
    setWebMidiRealtimeProcessor,
    setWebMidiRuntimeEventBus,
} from '#/modules/MIDI/useCases';
import { externalPluginParameterStore } from '#/modules/PluginHost/stores';
import {
    getExternalPluginContractVersionForCommand,
    registerReleasedStripReportSink,
} from '#/modules/PluginHost/useCases';
import {
    agentCapabilityDiscoveryPort,
    collectDurableOwnedAudioBufferIds,
    getDurableProjectOwnerId,
    productionBriefActionBatchAdmission,
    initGrooveTemplateDirtyTracking,
    initPluginStateDirtyTracking,
    initProjectDirtyTracking,
    setAgentMeasurementArtifactsClearer,
    setProjectIdentityTransitionDependencies,
} from '#/modules/Project/useCases';
import { clearProofMeters, updateProofMeters } from '#/modules/Proof/stores';
import { registerProofDevice, unregisterProofDevice, syncFullPatch } from '#/modules/Proof/useCases';
import { setSetlistEventBus } from '#/modules/Setlist/useCases';
import {
    initToasterKitPersistence,
    initToasterSubscribers,
    setToasterEventBus,
    setToasterGrooveAssignmentExecutor,
} from '#/modules/Toaster/useCases';
import { setGestureClockSource } from '#/modules/Transport/stores';
import {
    getTransportState,
    createMusicalPositionProjector,
    createSamplePositionProjector,
    projectPpqEndpoints,
    prepareTimelineMapTimeOperation,
    prepareTimelineMapStateRestore,
    readNativeEngineCursorBeats,
    resolveTempoAtBeat,
    setStopPlaybackCallback,
    reconcileVcaRuntimeGain,
    stopPlayback,
    repairRuntimeGraphFromProject,
} from '#/modules/Transport/useCases';
import { updateTunerTelemetry } from '#/modules/Tuner/stores';
import { setWorkspaceEventBus } from '#/modules/WorkspaceShell/useCases';
import { setYeastEventBus } from '#/modules/Yeast/stores';
import {
    configureYeastRuntime,
    createOfflineYeastMidiProcessor,
    processRealtimeMidiInput,
    teardownYeastRuntime,
} from '#/modules/Yeast/useCases';
import { logCapabilities } from '#/utils/capabilities';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import {
    captureAgentProjectInspectionState,
    captureCommandBatchPreflightState,
} from './captureCommandBatchPreflightState';
import { composeGrandBoule } from './composeGrandBoule';
import { getAgentProtocolManifest } from './getAgentProtocolManifest';
import { getProductionCommandHandlerMaps } from './getProductionCommandHandlerMaps';
import { nativeBuiltinParameterName } from './nativeBuiltinParameterNames';
import { nativeModAssignments } from './nativeModAssignments';
import { acquireNativeSampleBank, nativeSampleBankKey } from './nativeSampleBanks';
import { prepareOfflineDeviceSetup, captureOfflineDeviceSetup } from './prepareOfflineDeviceSetup';
import { projectNativeDeviceState } from './projectNativeDeviceState';
import { eventBus, logger } from './registerDependencies';
import { registerGlobalErrorHandlers } from './registerGlobalErrorHandlers';

logCapabilities();

// First, and before anything can read a branch id. Recovering the pre-session
// branch state used to be a side effect of evaluating `branchStore.ts`, where a
// refused `localStorage` write threw during module evaluation and stopped the
// app booting outright — no app-level catch runs that early. It is an explicit
// step of the composition root now, so a failure is reported and survivable.
// See #1557.
initBranchState();

registerCrdtStorageRuntime();
configureCommandBatchIdempotency({ canExecute: canExecuteCommandBatch });
setActionHistoryMetadataPort({
    record: recordActionHistoryEntry,
    recordBatch: recordActionHistoryEntries,
    markReverted: markActionHistoryEntryReverted,
    clear: clearCrdtActionHistory,
});
sessionUndoWitnessStampPort.setProvider(stampSessionUndoWitness);
productionBriefAdmissionPort.setGuard(productionBriefActionBatchAdmission.capture);
commandProjectRevisionPort.setProvider(captureProjectRevision);
commandProjectRevisionPort.setLiveMatchIgnoringCommandCheckpoint(projectRevisionMatchesLiveIgnoringCommandCheckpoint);
configureRuntimeGraphProjectRevisionValidator(
    (expectedProjectRevision) => captureProjectRevision() === expectedProjectRevision
);
configureRuntimeGraphTopologyValidator(runtimeGraphTopology.matchesCurrentProject);
commandBatchPreflightPort.setProvider(captureCommandBatchPreflightState);
// AiRuntime publishes the capability catalog and imports Project, so capability
// discovery reaches it through the port the composition root registers.
agentCapabilityDiscoveryPort.setProvider(() => getAgentCapabilityCatalog(getAgentProtocolManifest()));
// The same manifest, so an external client is offered the operations this
// build actually publishes and hears the rest as deferred.
externalClientManifestPort.setProvider(getAgentProtocolManifest);
agentProjectInspectionPort.setProvider(captureAgentProjectInspectionState);
commandProjectDivergencePort.setProvider(inspectAgentProjectDivergence);
commandBatchPreviewPort.setProvider(createCommandPreviewWorkspace);
commandBatchPreviewPort.setRecoveryProvider(createCommandRecoveryWorkspace);
commandRuntimeRepairPort.setProvider(repairRuntimeGraphFromProject);
commandDeviceVersionsPort.setDeviceTypeResolver(getDeviceTypesForCommandDeviceIds);
commandDeviceVersionsPort.setResolver(
    (deviceType) =>
        getDeviceContractVersionForCommand(deviceType) ?? getExternalPluginContractVersionForCommand(deviceType)
);
commandTrackDefaultsPort.setTrackColorProvider(reserveNextTrackColorForCommand);
syncActionReplayMetadata(actionHistoryStore.value?.entries ?? []);
actionHistoryStore.subscribe((state) => {
    syncActionReplayMetadata(state?.entries ?? []);
});
setRuntimeLogger(logger);
configureCollaborationAssetOwner({
    captureOwnerId: getDurableProjectOwnerId,
});
configureDurableAssetCommitProof({
    getDisposition: getVersionedCommandBatchCommitDisposition,
});
void recoverInterruptedAgentRuns()
    .then(() => recoverRetainedSectionRenderEffects())
    .catch((error: unknown) => {
        logger.error(new Error('Interrupted AI runs could not be recovered during startup', { cause: error }));
    });
const createOfflineYeastProcessor: Parameters<typeof configureOfflineYeastMidiProcessing>[0]['createProcessor'] = (
    input
) => {
    const source = input?.source;
    return createOfflineYeastMidiProcessor({
        tracks: input?.tracks,
        processorsByDevice: source?.yeastProcessorsByDevice,
        grooveState: source?.grooveTemplates,
        resolveMusicalPosition: createMusicalPositionProjector(source),
        resolvePpqPosition: createSamplePositionProjector(source),
    });
};
configureOfflineMidiEventProjection({
    createProjector: createGrooveMidiEventProjector,
    selectProbability: shouldPlayMidiEvent,
    createChordPitchProjector,
    evaluateAutomationValue: getAutomationValueAtBeat,
    createAutomationValueEvaluator: createOfflineAutomationEvaluator,
    resolveArticulationId: resolveMidiNoteArticulationId,
});
// The offline render and the native live automation producer enforce the same
// device-parameter law the live apply path does; only the composition root sees
// both Arrangement and the audio engine.
configureOfflineDeviceParameterLaw({
    captureExternalPluginLaw: (source = externalPluginParameterStore.value) => {
        const state = structuredClone(source);
        return {
            acceptsExternalPluginParameter: (instanceId, parameterId) =>
                acceptsExternalPluginAutomationParameter(instanceId, parameterId, state),
            clampExternalPluginValue: (input) => clampExternalPluginAutomationValue(input, state),
        };
    },
    isAutomatable: isDeviceParameterAutomatable,
    clampValue: clampDeviceParameterValue,
    quantiseValue: quantiseDeviceParameterValue,
    acceptsExternalPluginParameter: acceptsExternalPluginAutomationParameter,
    clampExternalPluginValue: clampExternalPluginAutomationValue,
});
configureOfflinePpqEndpointProjection({ project: projectPpqEndpoints, resolveTempoAtBeat });
configureOfflineYeastMidiProcessing({ createProcessor: createOfflineYeastProcessor });
setOfflineRenderDependencies({
    projectPpqEndpoints,
    createMidiEventProjector: createGrooveMidiEventProjector,
    createYeastMidiProcessor: createOfflineYeastProcessor,
    selectMidiEventProbability: shouldPlayMidiEvent,
    createChordPitchProjector,
});
setVcaRuntimeProjectionDependencies({ reconcileVcaRuntimeGain });
setToasterGrooveAssignmentExecutor({ execute: executeUserAppAction });
setArrangementEventBus(eventBus);
setWorkspaceEventBus(eventBus);
// Timeline drops of cached samples and generated AI renders must register
// shareable bytes for their clips (#3759). The WAV encoder lives behind
// AudioRendering's barrel, which Arrangement cannot import without a module
// cycle, so the composition root supplies the stager.
setClipAudioAssetStager(stageAudioBufferAsset);
// Same seam shape as the stager above: AudioRendering's WAV export path
// imports Project's use cases, so Project cannot import AudioRendering's
// barrel directly without a cycle. See agentMeasurementArtifactClearingState.ts.
setAgentMeasurementArtifactsClearer(clearAgentMeasurementArtifacts);
// An unload changes native strip state with no batch of its own to report it,
// so PluginHost forwards the strips its own release touched here, the one
// place that may cross from PluginHost's contract into AudioEngine's.
// The queued write returns a promise the sink contract does not carry; ordering is
// the queue's job, not the caller's, so the registration discards it explicitly.
registerReleasedStripReportSink((reports) => {
    void recordNativeChainReleases(reports);
});
setCommandEventBus(eventBus);
setSetlistEventBus(eventBus);
setVoiceToggleEventBus(eventBus);
void initializeVoiceInputAvailability();
setMixAnalysisDisplayLifecycle({
    begin: beginMixAnalysis,
    complete: completeMixAnalysis,
    fail: failMixAnalysis,
});
setToasterEventBus(eventBus);
setYeastEventBus(eventBus);
configureYeastRuntime({ panicOutputNotes: stopAllScheduled });
const disposeWebMidiRealtimeProcessor = setWebMidiRealtimeProcessor({ processor: processRealtimeMidiInput });
setWebMidiRuntimeEventBus({ eventBus });
setNotificationEventBus(eventBus);
// Storage adapters cannot resolve `notifyUser` before this line: `inject`
// caches the closure it builds on first call, and an unregistered token
// resolves to the abstract class rather than throwing — so one pre-bootstrap
// call would cache a bus with no `emit` and break every `notifyUser` site for
// the life of the page. A store's constructor seed is exactly such a caller on
// a sealed origin. Anything they had to hold is delivered here. See #1557.
flushDeferredStorageNotice();
setTimeOperationDependencies({
    prepareAutomationTimeOperation,
    prepareAutomationTimeStateRestore,
    prepareMidiGlobalTimeTransaction,
    prepareMidiTimeStateRestore,
    prepareTimelineMapTimeOperation,
    prepareTimelineMapStateRestore,
});
setProjectIdentityTransitionDependencies({
    leaveCollaborationSession: leaveSession,
    resumeDurableAssetOwnerHandoffsAfterProjectLoad: async (authority) => {
        const isCurrentOwner = () =>
            !authority.signal.aborted && authority.isCurrent() && getDurableProjectOwnerId() === authority.ownerId;
        if (!isCurrentOwner()) {
            return;
        }
        const assetTransfer = getAssetTransfer();
        if (!assetTransfer) {
            throw new Error('Durable asset owner recovery is unavailable after project load');
        }
        if (!isCurrentOwner()) {
            return;
        }
        await assetTransfer.resumeDurableOwnerRebindsAfterProjectLoad({
            ownerId: authority.ownerId,
            isCurrent: isCurrentOwner,
            signal: authority.signal,
        });
    },
});

// The audio-cache collectors pull the durable owned-id set at collection time
// (issue #3777), so ordinary PCM a saved project still references survives the
// age/budget sweeps while it is inactive. Enumeration stays a pull from the
// persisted snapshots — no second ownership table to drift.
configureDurableAudioBufferOwnership(collectDurableOwnedAudioBufferIds);

function disposeYeastRealtimeBridge(): void {
    disposeWebMidiRealtimeProcessor();
    teardownYeastRuntime();
}

function handleBeforeUnload(): void {
    // Before the Yeast teardown: the release events destroyWebMidi emits route
    // through runtimes the bridge disposal is about to retire.
    destroyWebMidi();
    disposeYeastRealtimeBridge();
    // Attempt GC on window close. `cleanupUnusedFreezeFiles` stands down on its
    // own when the track store is not authoritative — see the guard there.
    cleanupUnusedFreezeFiles().catch(() => {});
}

window.addEventListener('beforeunload', handleBeforeUnload);

// Funnel otherwise-silent fire-and-forget promise rejections into the logger.
// Disposer is wired to HMR so a hot reload does not stack duplicate handlers.
const disposeGlobalErrorHandlers = registerGlobalErrorHandlers({ logger });
import.meta.hot?.dispose(() => {
    disposeGlobalErrorHandlers();
    window.removeEventListener('beforeunload', handleBeforeUnload);
    disposeYeastRealtimeBridge();
});

setFermenterDependencies({
    clampDeviceParameterValue,
    getAllTracks,
    persistDeviceParam,
    persistDevicePatch,
    resolveEligibleDeviceWriteTarget,
    updateDeviceParam,
    updateDevicePatch,
});

setStopPlaybackCallback(() => {
    stopPlayback().catch((error: unknown) => {
        logger.error(new Error('Scheduler stop request failed', { cause: error }));
    });
});

setAutomationParameterRangeResolver(getAutomationParameterRange);

setAutomationRecordingDependencies({
    getAudioContext,
    getCompensationDelay,
});

// Gesture timestamping reads the audio clock at the event's own instant and
// follows the native engine's cursor while that engine is the audible
// transport; Transport's stores stay leaf modules, so the reads are injected
// here (see `gestureClockSource.ts`).
setGestureClockSource({
    getAudioTimeSeconds: () => getAudioContext().currentTime,
    readNativeCursorBeats: () => readNativeEngineCursorBeats(),
});

setPitchEditDependencies({
    commitPitchEdit,
});

setModulationDependencies({
    updateDeviceParam,
    getPluginParamRange: (deviceType, paramId) => {
        const descriptor = getPluginById(deviceType);
        const paramDef = descriptor?.parameters.find((param) => param.id === paramId);
        if (!paramDef) {
            return null;
        }
        return {
            min: paramDef.minValue,
            max: paramDef.maxValue,
            defaultValue: paramDef.defaultValue,
            automatable: paramDef.automatable,
        };
    },
    quantiseValue: quantiseDeviceParameterValue,
});

setMidiLearnDependencies({
    setTrackGainArrangement,
    setTrackPanArrangement,
    setDeviceParameter,
    setFermenterMappedParam,
    recordAutomationValue,
    getTransportIsPlaying: () => getTransportState()?.isPlaying ?? false,
    getTransportPlayheadPosition: () => getTransportState()?.playheadPosition ?? 0,
    getAllTracks,
});

configureAudioDeviceRuntimeSink({
    emitDeviceLoaded: (payload) => {
        void eventBus.emit('audioDevice.loaded', payload);
    },
    emitDeviceRemoved: (payload) => {
        void eventBus.emit('audioDevice.removed', payload);
    },
    registerLevainDevice: ({ deviceId, device, port }) => {
        return registerLevainDevice(deviceId, device, port);
    },
    unregisterLevainDevice,
    setLevainEngineReady: ({ deviceId, isReady }) => {
        setEngineReady(deviceId, isReady);
    },
    // The offline render builds device nodes through a different registry than
    // live playback, so nothing here ran for an export and Levain bounced
    // silence. Dispatch stays in the composition root; each module owns what its
    // own device needs. See `prepareOfflineDeviceSetup`.
    prepareOfflineInstrument: prepareOfflineDeviceSetup,
    captureOfflineInstrument: (device, source) => {
        const captured = captureOfflineDeviceSetup(device, source);
        const deviceId = device.id;
        const deviceType = device.type;
        return ({ port, signal }) => prepareOfflineDeviceSetup({ deviceId, deviceType, captured, port, signal });
    },
    // The live/offline-via-native mirror of the row above: a device's
    // `deviceState` never crosses the wire to the native engine, so this is
    // where its kit (or any state a `parameterValues` table cannot carry)
    // gets folded into the record `projectDeviceForNativeBody` sends. See
    // `projectNativeDeviceState`.
    projectNativeDeviceState,
    // The modulation-assignment mirror of the row above: Bacteria's routing
    // table also never crosses the wire on its own, so this is where it gets
    // folded into the record `projectDeviceForNativeBody` sends, at build and
    // on every edit alike. See `nativeModAssignments`.
    nativeModAssignments,
    // The bank door beside the row above. One body is built from staged
    // material rather than from its record, so the same opaque state that is
    // projected into `parameterValues` also names the bank the engine must
    // already hold; the graph backends stage it before the batch that maps the
    // device. See `nativeSampleBanks`.
    nativeSampleBankKey,
    acquireNativeSampleBank,
    // And the vocabulary that staged body answers to. A module writing to the
    // engine directly imports AudioEngine, so AudioEngine asks here for its
    // parameter names rather than importing it back. See
    // `nativeBuiltinParameterNames`.
    nativeBuiltinParameterName,
    // The live registry's Crumbs descriptor calls this, and the offline chain
    // reaches the same use case through the `builtin-crumbs` row of
    // `OFFLINE_DEVICE_HYDRATION`. One shared call is what stops the two
    // registries from configuring two differently loaded engines.
    prepareCrumbsDevice: ({ deviceId, port, signal }) => prepareCrumbsEngine({ deviceId, port, signal }),
    setFermenterTelemetry: (deviceId, telemetry) => {
        setFermenterTelemetry(deviceId, telemetry.peakL, telemetry.peakR, telemetry.scopeBuffer);
    },
    updateGlutenMeters,
    deleteGlutenMeters,
    // Crust's patch and meter stores are per-device maps (#3672): the engine
    // registry emits each frame with its device id, and a second Crust instance
    // ticking must not move the first one's readout. The device id travels
    // through; the store scopes every write to that slice.
    updateCrustMeters: (deviceId, meters) => {
        updateCrustMeters(deviceId, {
            grDb: meters.grDb,
            inputDb: meters.inputDb,
            outputDb: meters.outputDb,
            lufsIntegrated: meters.lufsIntegrated,
            lufsShortTerm: meters.lufsShortTerm,
            lufsMomentary: meters.lufsMomentary,
            lra: meters.lra,
            truepeakMax: meters.truepeakMax,
            truepeakExceeded: meters.truepeakExceeded,
        });
    },
    deleteCrustMeters: (deviceId) => {
        deleteCrustMeters(deviceId);
    },
    updateBacteriaMeters: (deviceId, meters) => {
        updateBacteriaMeters(deviceId, meters.inputDb, meters.outputDb, meters.bandLevels, meters.latency);
    },
    updateGrinderTelemetry,
    registerProofDevice,
    unregisterProofDevice,
    syncProofPatch: syncFullPatch,
    updateProofMeters,
    clearProofMeters,
    // The Tuner is the one device two analysers can report for at once: the
    // native body publishes on the transport poll and the Web Audio twin's
    // worklet posts from a graph that goes on running behind a shadowed
    // carrier. Both reach one store, so the arbitration belongs here, where
    // both producers are visible — neither can see the other.
    //
    // The native reading wins for a device the session is carrying and
    // sounding, and only there: everywhere else the web twin is what the
    // musician hears, so its reading is the true one and the native map's
    // entry for that device is stale or silent.
    updateTunerTelemetry: (deviceId, telemetry) => {
        if (isTunerTelemetryNativelyOwned(deviceId)) {
            return;
        }
        updateTunerTelemetry(deviceId, telemetry);
    },
    // No predicate on this side: `publishNativeTunerTelemetry` already
    // filtered the poll's map by that same answer, so a reading reaching here
    // is one this session owns.
    updateNativeTunerTelemetry: updateTunerTelemetry,
});

assertCanonicalLlmActionStrategies(getExecutableAppActionGroundingCatalog());
registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata }));
registerMidiTransforms(MIDI_TRANSFORM_IMPLEMENTATIONS);

initToasterSubscribers({ eventBus, logger });
// Registered after the lifecycle subscriber so a device's first appearance is
// already carrying the kit read back from the document by the time this observes it.
initToasterKitPersistence();
// Same shape and the same reason: `Device.parameterValues` holds numbers, and
// neither Levain's instrument id nor Crumbs' sample reference is one. Registered
// here so a device's first appearance is already carrying whatever the document
// held for it, and only a genuine edit afterwards writes back.
initLevainDeviceStatePersistence();
initBacteriaSubscribers({ eventBus, logger });
// Same shape and the same reason, subscriber first so the device's first
// appearance already carries the routing table read back from the document:
// `modAssignments` is a routing table, not a number `parameterValues` can hold.
initBacteriaModAssignmentsPersistence();
composeGrandBoule({ eventBus, logger });
initCrumbsDeviceStatePersistence();
// The native Crumbs instance follows the device's presence on the project, not
// the panel's mount: the mapper splices a Crumbs device onto its strip by the
// instance the engine holds, so a sampler whose window is shut would otherwise
// leave its strip with no native body. Registered after the persistence
// subscriber so a device's first appearance already carries the saved sample
// this restores.
syncCrumbsNativeInstances();
initStalenessDetection();

// Registered for the life of the process, so deadline-evidence reading has
// main-thread long-task coverage from startup regardless of what is mounted.
startMainThreadLongTaskObservation();
initProjectDirtyTracking();
initGrooveTemplateDirtyTracking();
// Edits made inside a hosted plugin's own editor never pass through this app,
// so no store changes and neither subscription above sees them.
initPluginStateDirtyTracking();

// Initialize browser AI module asynchronously — non-blocking, non-fatal.
// Detects WebGPU capability and populates model registry from OPFS cache.
initBrowserAi().catch((error: unknown) => {
    logger.warn(`Browser AI initialization failed (non-fatal): ${String(error)}`);
});

// Probe OPFS for RAVE model weights. Registers only what is actually there, so
// the RAVE command-palette entries stay withheld until a model exists.
initRaveModels().catch((error: unknown) => {
    logger.warn(`RAVE model presence probe failed (non-fatal): ${String(error)}`);
});

export { eventBus, logger };
