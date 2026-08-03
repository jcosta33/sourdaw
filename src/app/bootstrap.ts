// registerDependencies owns app singleton construction; bootstrap wires those
// instances into module-owned dependency ports before runtime subscribers start.
import { setRuntimeLogger } from '#/infra/logger/runtimeLogger';
import { getGenerationHandlers, getAiMidiHandlers } from '#/modules/AiGeneration/useCases';
import {
    beginMixAnalysis,
    completeMixAnalysis,
    failMixAnalysis,
    getAiOrganizationHandlers,
    setVoiceToggleEventBus,
} from '#/modules/AiRuntime/useCases';
import { persistDeviceParam, resolveEligibleDeviceWriteTarget, trackStore } from '#/modules/Arrangement/stores';
import {
    clampDeviceParameterValue,
    getAllTracks,
    getPluginById,
    persistDevicePatch,
    cleanupUnusedFreezeFiles,
    setTrackGain as setTrackGainArrangement,
    setTrackPan as setTrackPanArrangement,
    setDeviceParameter,
    getArrangementHandlers,
    initStalenessDetection,
    setArrangementEventBus,
    setOfflineRenderDependencies,
    setTimeOperationDependencies,
    getSongStructureHandlers,
} from '#/modules/Arrangement/useCases';
import { getAnalysisHandlers, setMixAnalysisDisplayLifecycle } from '#/modules/AudioAnalysis/useCases';
import {
    updateDeviceParam,
    updateDevicePatch,
    setTrackGain as engineSetTrackGain,
    setTrackPan as engineSetTrackPan,
    getAudioContext,
    getCompensationDelay,
    getFinalFeatureHandlers,
    commitPitchEdit,
    configureAudioDeviceRuntimeSink,
    configureOfflineMidiEventProjection,
    configureOfflinePpqEndpointProjection,
    configureOfflineYeastMidiProcessing,
    stopAllScheduled,
} from '#/modules/AudioEngine/useCases';
import {
    getAutomationHandlers,
    getAutomationValueAtBeat,
    prepareAutomationTimeOperation,
    prepareAutomationTimeStateRestore,
    recordAutomationValue,
    setAutomationRecordingDependencies,
    setModulationDependencies,
} from '#/modules/Automation/useCases';
import { updateBacteriaMeters } from '#/modules/Bacteria/stores';
import { initBrowserAi, getRaveHandlers } from '#/modules/BrowserAi/useCases';
import { getCollaborationHandlers, leaveSession } from '#/modules/Collaboration/useCases';
import { registerHandlerMap } from '#/modules/Command/stores';
import {
    executeAppAction,
    getMacroHandlers,
    getUndoRedoHandlers,
    getUndoTreeHandlers,
    setActionHistoryMetadataPort,
    setCommandEventBus,
    syncActionReplayMetadata,
} from '#/modules/Command/useCases';
import { getControlRoomHandlers } from '#/modules/ControlRoom/useCases';
import { getControlSurfaceHandlers, setMidiLearnDependencies } from '#/modules/ControlSurface/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    getDsoSnapshotHandlers,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
    clearActionHistory as clearCrdtActionHistory,
    registerCrdtStorageRuntime,
} from '#/modules/CrdtDocument/useCases';
import { initCrumbsDeviceStatePersistence, prepareCrumbsEngine } from '#/modules/Crumbs/useCases';
import { getDawProjectHandlers } from '#/modules/DawInterchange/useCases';
import { setFermenterTelemetry } from '#/modules/Fermenter/stores';
import { setFermenterMappedParam, setFermenterDependencies } from '#/modules/Fermenter/useCases';
import { updateGlutenMeters, deleteGlutenMeters } from '#/modules/Gluten/stores';
import { setGrandBouleEventBus } from '#/modules/GrandBoule/useCases';
import { updateGrinderTelemetry } from '#/modules/Grinder/stores';
import { getPitchHandlers, setPitchEditDependencies } from '#/modules/Knead/useCases';
import { setEngineReady } from '#/modules/Levain/stores';
import {
    initLevainDeviceStatePersistence,
    registerLevainDevice,
    unregisterLevainDevice,
} from '#/modules/Levain/useCases';
import {
    getChordTrackHandlers,
    getMidiGrooveHandlers,
    getMidiNoteTransformHandlers,
    getPatternInstanceHandlers,
    prepareMidiGlobalTimeTransaction,
    prepareMidiTimeStateRestore,
    createChordPitchProjector,
    createGrooveMidiEventProjector,
    shouldPlayMidiEvent,
    setWebMidiRealtimeProcessor,
    setWebMidiRuntimeEventBus,
    getWebMidiInputHandlers,
} from '#/modules/MIDI/useCases';
import { getPluginHostHandlers } from '#/modules/PluginHost/useCases';
import {
    getProjectHandlers,
    initGrooveTemplateDirtyTracking,
    markDirty,
    migrateLegacyProjectSnapshots,
    setProjectIdentityTransitionDependencies,
} from '#/modules/Project/useCases';
import { getVersionControlHandlers } from '#/modules/ProjectVersioning/useCases';
import { updateProofMeters } from '#/modules/Proof/stores';
import { registerProofDevice, unregisterProofDevice, syncFullPatch } from '#/modules/Proof/useCases';
import { getPunchRecordingHandlers } from '#/modules/PunchRecording/useCases';
import { getNodeViewHandlers } from '#/modules/Routing/useCases';
import { getSessionLauncherHandlers } from '#/modules/SessionLauncher/useCases';
import { getSetlistHandlers, setSetlistEventBus } from '#/modules/Setlist/useCases';
import {
    initToasterKitPersistence,
    initToasterSubscribers,
    setToasterEventBus,
    setToasterGrooveAssignmentExecutor,
} from '#/modules/Toaster/useCases';
import {
    getTransportHandlers,
    getTransportState,
    createMusicalPositionProjector,
    createSamplePositionProjector,
    projectPpqEndpoints,
    prepareTimelineMapTimeOperation,
    prepareTimelineMapStateRestore,
    setStopPlaybackCallback,
    stopPlayback,
} from '#/modules/Transport/useCases';
import { updateTunerTelemetry } from '#/modules/Tuner/stores';
import { getWorkspaceHandlers, getScratchPadHandlers, setWorkspaceEventBus } from '#/modules/WorkspaceShell/useCases';
import { setYeastEventBus } from '#/modules/Yeast/stores';
import {
    configureYeastRuntime,
    createOfflineYeastMidiProcessor,
    processRealtimeMidiInput,
    teardownYeastRuntime,
} from '#/modules/Yeast/useCases';
import { logCapabilities } from '#/utils/capabilities';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { prepareOfflineDeviceSetup } from './prepareOfflineDeviceSetup';
import { eventBus, logger } from './registerDependencies';
import { registerGlobalErrorHandlers } from './registerGlobalErrorHandlers';

logCapabilities();

registerCrdtStorageRuntime();
setActionHistoryMetadataPort({
    record: recordActionHistoryEntry,
    markReverted: markActionHistoryEntryReverted,
    clear: clearCrdtActionHistory,
});
syncActionReplayMetadata(actionHistoryStore.value?.entries ?? []);
actionHistoryStore.subscribe((state) => {
    syncActionReplayMetadata(state?.entries ?? []);
});
setRuntimeLogger(logger);
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
    // Attempt GC on window close
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
        registerLevainDevice(deviceId, device, port);
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
    prepareCrumbsDevice: ({ deviceId, port }) => prepareCrumbsEngine({ deviceId, port }),
    setFermenterTelemetry: (deviceId, telemetry) => {
        setFermenterTelemetry(deviceId, telemetry.peakL, telemetry.peakR, telemetry.scopeBuffer);
    },
    updateGlutenMeters,
    deleteGlutenMeters,
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

registerHandlerMap(getArrangementHandlers());
registerHandlerMap(getTransportHandlers());
registerHandlerMap(getSessionLauncherHandlers());
registerHandlerMap(getSetlistHandlers());
registerHandlerMap(getPunchRecordingHandlers());
registerHandlerMap(getWorkspaceHandlers());
registerHandlerMap(getAutomationHandlers());
registerHandlerMap(getGenerationHandlers());
registerHandlerMap(getAnalysisHandlers());
registerHandlerMap(getCollaborationHandlers());
registerHandlerMap(getPluginHostHandlers());
registerHandlerMap(getAiMidiHandlers());
registerHandlerMap(getAiOrganizationHandlers());
registerHandlerMap(getChordTrackHandlers());
registerHandlerMap(getMidiNoteTransformHandlers());
registerHandlerMap(getMidiGrooveHandlers());
registerHandlerMap(getControlSurfaceHandlers());
registerHandlerMap(getScratchPadHandlers());
registerHandlerMap(getPatternInstanceHandlers());
registerHandlerMap(getMacroHandlers());
registerHandlerMap(getUndoRedoHandlers());
registerHandlerMap(getUndoTreeHandlers());
registerHandlerMap(getPitchHandlers());
registerHandlerMap(getSongStructureHandlers());
registerHandlerMap(getProjectHandlers());
registerHandlerMap(getVersionControlHandlers());
registerHandlerMap(getDawProjectHandlers());
registerHandlerMap(getFinalFeatureHandlers());
registerHandlerMap(getNodeViewHandlers());
registerHandlerMap(getWebMidiInputHandlers());
registerHandlerMap(getRaveHandlers());
registerHandlerMap(getControlRoomHandlers());
registerHandlerMap(getDsoSnapshotHandlers());

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

trackStore.subscribe(() => markDirty());
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

export { eventBus, logger };
