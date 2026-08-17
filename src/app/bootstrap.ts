// registerDependencies owns app singleton construction; bootstrap wires those
// instances into module-owned dependency ports before runtime subscribers start.
import { setRuntimeLogger } from '#/infra/logger/runtimeLogger';
import { flushDeferredStorageNotice } from '#/infra/store/storage/storageFullNotice';
import {
    beginMixAnalysis,
    completeMixAnalysis,
    failMixAnalysis,
    recoverInterruptedAgentRuns,
    setVoiceToggleEventBus,
} from '#/modules/AiRuntime/useCases';
import { persistDeviceParam, resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import {
    clampDeviceParameterValue,
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
    setTrackGain as engineSetTrackGain,
    setTrackPan as engineSetTrackPan,
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
    stopAllScheduled,
} from '#/modules/AudioEngine/useCases';
import {
    getAutomationValueAtBeat,
    prepareAutomationTimeOperation,
    prepareAutomationTimeStateRestore,
    recordAutomationValue,
    setAutomationRecordingDependencies,
    setAutomationParameterRangeResolver,
    setModulationDependencies,
} from '#/modules/Automation/useCases';
import { updateBacteriaMeters } from '#/modules/Bacteria/stores';
import { initBrowserAi, initRaveModels } from '#/modules/BrowserAi/useCases';
import { canExecuteCommandBatch, canMutateBranchMetadata, leaveSession } from '#/modules/Collaboration/useCases';
import {
    commandBatchPreflightPort,
    commandBatchPreviewPort,
    configureCommandBatchIdempotency,
    commandDeviceVersionsPort,
    executeAppAction,
    registerProductionCommandHandlers,
    productionBriefAdmissionPort,
    setActionHistoryMetadataPort,
    commandProjectRevisionPort,
    commandProjectDivergencePort,
    commandTrackDefaultsPort,
    setCommandEventBus,
    syncActionReplayMetadata,
} from '#/modules/Command/useCases';
import { setMidiLearnDependencies } from '#/modules/ControlSurface/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    agentProjectInspectionPort,
    initBranchState,
    captureProjectRevision,
    inspectAgentProjectDivergence,
    createCommandPreviewWorkspace,
    createCommandRecoveryWorkspace,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
    clearActionHistory as clearCrdtActionHistory,
    registerCrdtStorageRuntime,
} from '#/modules/CrdtDocument/useCases';
import { initCrumbsDeviceStatePersistence, prepareCrumbsEngine } from '#/modules/Crumbs/useCases';
import { updateCrustMeters, resetCrustMeters } from '#/modules/Crust/stores';
import { setFermenterTelemetry } from '#/modules/Fermenter/stores';
import { setFermenterMappedParam, setFermenterDependencies } from '#/modules/Fermenter/useCases';
import { updateGlutenMeters, deleteGlutenMeters } from '#/modules/Gluten/stores';
import { setGrandBouleEventBus } from '#/modules/GrandBoule/useCases';
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
    setWebMidiRealtimeProcessor,
    setWebMidiRuntimeEventBus,
} from '#/modules/MIDI/useCases';
import { getExternalPluginContractVersionForCommand } from '#/modules/PluginHost/useCases';
import {
    doesProductionBriefAllowActionBatch,
    initGrooveTemplateDirtyTracking,
    initProjectDirtyTracking,
    migrateLegacyProjectSnapshots,
    setProjectIdentityTransitionDependencies,
} from '#/modules/Project/useCases';
import { updateProofMeters } from '#/modules/Proof/stores';
import { registerProofDevice, unregisterProofDevice, syncFullPatch } from '#/modules/Proof/useCases';
import { setSetlistEventBus } from '#/modules/Setlist/useCases';
import {
    initToasterKitPersistence,
    initToasterSubscribers,
    setToasterEventBus,
    setToasterGrooveAssignmentExecutor,
} from '#/modules/Toaster/useCases';
import {
    getTransportState,
    createMusicalPositionProjector,
    createSamplePositionProjector,
    projectPpqEndpoints,
    prepareTimelineMapTimeOperation,
    prepareTimelineMapStateRestore,
    setStopPlaybackCallback,
    reconcileVcaRuntimeGain,
    stopPlayback,
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

import { captureCommandBatchPreflightState } from './captureCommandBatchPreflightState';
import { getProductionCommandHandlerMaps } from './getProductionCommandHandlerMaps';
import { prepareOfflineDeviceSetup } from './prepareOfflineDeviceSetup';
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
    markReverted: markActionHistoryEntryReverted,
    clear: clearCrdtActionHistory,
});
productionBriefAdmissionPort.setGuard(doesProductionBriefAllowActionBatch);
commandProjectRevisionPort.setProvider(captureProjectRevision);
configureRuntimeGraphProjectRevisionValidator(
    (expectedProjectRevision) => captureProjectRevision() === expectedProjectRevision
);
configureRuntimeGraphTopologyValidator(runtimeGraphTopology.matchesCurrentProject);
commandBatchPreflightPort.setProvider(captureCommandBatchPreflightState);
agentProjectInspectionPort.setProvider(({ projectDocument, targetIds }) =>
    captureCommandBatchPreflightState({ assetReferences: [], projectDocument, targetIds })
);
commandProjectDivergencePort.setProvider(inspectAgentProjectDivergence);
commandBatchPreviewPort.setProvider(createCommandPreviewWorkspace);
commandBatchPreviewPort.setRecoveryProvider(createCommandRecoveryWorkspace);
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
try {
    recoverInterruptedAgentRuns();
} catch (error) {
    logger.error(new Error('Interrupted AI runs could not be recovered during startup', { cause: error }));
}
const createOfflineYeastProcessor = () =>
    createOfflineYeastMidiProcessor({
        resolveMusicalPosition: createMusicalPositionProjector(),
        resolvePpqPosition: createSamplePositionProjector(),
    });
configureOfflineMidiEventProjection({
    createProjector: createGrooveMidiEventProjector,
    selectProbability: shouldPlayMidiEvent,
    createChordPitchProjector,
    evaluateAutomationValue: getAutomationValueAtBeat,
    resolveArticulationId: resolveMidiNoteArticulationId,
});
// The offline render enforces the same device-parameter law the live apply path
// does; only the composition root sees both Arrangement and the audio engine.
configureOfflineDeviceParameterLaw({
    isAutomatable: isDeviceParameterAutomatable,
    clampValue: clampDeviceParameterValue,
    quantiseValue: quantiseDeviceParameterValue,
});
configureOfflinePpqEndpointProjection({ project: projectPpqEndpoints });
configureOfflineYeastMidiProcessing({ createProcessor: createOfflineYeastProcessor });
setOfflineRenderDependencies({
    projectPpqEndpoints,
    createMidiEventProjector: createGrooveMidiEventProjector,
    createYeastMidiProcessor: createOfflineYeastProcessor,
    selectMidiEventProbability: shouldPlayMidiEvent,
    createChordPitchProjector,
});
setVcaRuntimeProjectionDependencies({ reconcileVcaRuntimeGain });
setToasterGrooveAssignmentExecutor({ execute: executeAppAction });
setArrangementEventBus(eventBus);
setWorkspaceEventBus(eventBus);
setCommandEventBus(eventBus);
setSetlistEventBus(eventBus);
setVoiceToggleEventBus(eventBus);
setMixAnalysisDisplayLifecycle({
    begin: beginMixAnalysis,
    complete: completeMixAnalysis,
    fail: failMixAnalysis,
});
setGrandBouleEventBus(eventBus);
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
setProjectIdentityTransitionDependencies({ leaveCollaborationSession: leaveSession });

function disposeYeastRealtimeBridge(): void {
    disposeWebMidiRealtimeProcessor();
    teardownYeastRuntime();
}

function handleBeforeUnload(): void {
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
    engineSetTrackGain,
    engineSetTrackPan,
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
    // Crust's meter store is a single slot rather than a per-device map, which
    // is the shape its panel was built against: one loudness desk on screen at
    // a time. The device id is therefore dropped here, and a second Crust
    // instance would tick the same readout.
    updateCrustMeters: (_deviceId, meters) => {
        updateCrustMeters({
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
    deleteCrustMeters: () => {
        resetCrustMeters();
    },
    updateBacteriaMeters: (deviceId, meters) => {
        updateBacteriaMeters(deviceId, meters.inputDb, meters.outputDb, meters.bandLevels, meters.latency);
    },
    updateGrinderTelemetry,
    registerProofDevice,
    unregisterProofDevice,
    syncProofPatch: syncFullPatch,
    updateProofMeters,
    updateTunerTelemetry,
});

registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata }));

initToasterSubscribers({ eventBus, logger });
// Registered after the lifecycle subscriber so a device's first appearance is
// already carrying the kit read back from the document by the time this observes it.
initToasterKitPersistence();
// Same shape and the same reason: `Device.parameterValues` holds numbers, and
// neither Levain's instrument id nor Crumbs' sample reference is one. Registered
// here so a device's first appearance is already carrying whatever the document
// held for it, and only a genuine edit afterwards writes back.
initLevainDeviceStatePersistence();
initCrumbsDeviceStatePersistence();
initStalenessDetection();

initProjectDirtyTracking();
initGrooveTemplateDirtyTracking();

// Drain pre-ADR-0013 project content out of localStorage into IndexedDB. A
// mirror is removed only once its own rewrite has been observed to commit, or
// once a copy is confirmed equal or newer; anything it cannot account for is
// left in place. Safe to race a concurrent *load* — reads resolve by recency —
// but not audited against a concurrent *save* to the same key, which startup
// timing makes unreachable today. The report is logged as instrumentation for
// ADR 0013's stop condition, which ADR 0016 settles rather than leaves open.
migrateLegacyProjectSnapshots()
    .then((report) => {
        if (report.inspected === 0) {
            return;
        }
        logger.info(
            `Legacy project snapshot migration: inspected=${report.inspected} recovered=${report.recovered} ` +
                `supersededByPrimary=${report.supersededByPrimary} ` +
                `mirrorsWithoutPrimary=${report.mirrorsWithoutPrimary} failed=${report.failed}`
        );
    })
    .catch((error: unknown) => {
        logger.warn(`Legacy project snapshot migration failed (non-fatal): ${String(error)}`);
    });

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
