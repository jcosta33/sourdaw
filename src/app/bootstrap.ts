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
import { getDawProjectHandlers } from '#/modules/DawInterchange/useCases';
import { setFermenterTelemetry } from '#/modules/Fermenter/stores';
import { setFermenterMappedParam, setFermenterDependencies } from '#/modules/Fermenter/useCases';
import { updateGlutenMeters, deleteGlutenMeters } from '#/modules/Gluten/stores';
import { setGrandBouleEventBus } from '#/modules/GrandBoule/useCases';
import { updateGrinderTelemetry } from '#/modules/Grinder/stores';
import { getPitchHandlers, setPitchEditDependencies } from '#/modules/Knead/useCases';
import { setEngineReady } from '#/modules/Levain/stores';
import { prepareOfflineLevain, registerLevainDevice, unregisterLevainDevice } from '#/modules/Levain/useCases';
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
        return { min: paramDef.minValue, max: paramDef.maxValue, defaultValue: paramDef.defaultValue };
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
    // OE-21: the offline render builds instrument nodes through a different
    // registry than live playback, so nothing here ran for an export and Levain
    // bounced silence. Dispatch stays in the composition root; each module owns
    // what its own instrument needs.
    prepareOfflineInstrument: async ({ deviceId, deviceType, port }) => {
        if (deviceType === 'levain') {
            await prepareOfflineLevain({ deviceId, port });
        }
    },
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
initStalenessDetection();

trackStore.subscribe(() => markDirty());
initGrooveTemplateDirtyTracking();

// Initialize browser AI module asynchronously — non-blocking, non-fatal.
// Detects WebGPU capability and populates model registry from OPFS cache.
initBrowserAi().catch((error: unknown) => {
    logger.warn(`Browser AI initialization failed (non-fatal): ${String(error)}`);
});

export { eventBus, logger };
