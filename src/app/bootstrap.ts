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
import { persistDeviceParam, trackStore } from '#/modules/Arrangement/stores';
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
    setTimeOperationDependencies,
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
    setWebMidiRuntimeEventBus,
    stopAllScheduled,
} from '#/modules/AudioEngine/useCases';
import {
    getAutomationHandlers,
    recordAutomationValue,
    setAutomationRecordingDependencies,
    setModulationDependencies,
} from '#/modules/Automation/useCases';
import { updateBacteriaMeters } from '#/modules/Bacteria/stores';
import { initBrowserAi } from '#/modules/BrowserAi/useCases';
import { getCollaborationHandlers, leaveSession } from '#/modules/Collaboration/useCases';
import { registerHandlerMap } from '#/modules/Command/stores';
import {
    getMacroHandlers,
    getPitchHandlers,
    getUndoRedoHandlers,
    getUndoTreeHandlers,
    setActionHistoryMetadataPort,
    setCommandEventBus,
    setPitchEditDependencies,
    syncActionReplayMetadata,
} from '#/modules/Command/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    getDsoSnapshotHandlers,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
    clearActionHistory as clearCrdtActionHistory,
    registerCrdtStorageRuntime,
} from '#/modules/CrdtDocument/useCases';
import { setFermenterTelemetry } from '#/modules/Fermenter/stores';
import { setFermenterMappedParam, setFermenterDependencies } from '#/modules/Fermenter/useCases';
import { updateGlutenMeters, deleteGlutenMeters } from '#/modules/Gluten/stores';
import { setGrandBouleEventBus } from '#/modules/GrandBoule/useCases';
import { updateGrinderTelemetry } from '#/modules/Grinder/stores';
import { setEngineReady } from '#/modules/Levain/stores';
import { registerLevainDevice, unregisterLevainDevice } from '#/modules/Levain/useCases';
import {
    getChordTrackHandlers,
    getMidiNoteTransformHandlers,
    getMidiLearnHandlers,
    getPatternInstanceHandlers,
    setMidiLearnDependencies,
} from '#/modules/MIDI/useCases';
import { getPluginHostHandlers } from '#/modules/Plugin/useCases';
import {
    markDirty,
    getSongStructureHandlers,
    getDawProjectHandlers,
    setProjectIdentityTransitionDependencies,
} from '#/modules/Project/useCases';
import { getVersionControlHandlers } from '#/modules/ProjectVersioning/useCases';
import { updateProofMeters } from '#/modules/Proof/stores';
import { registerProofDevice, unregisterProofDevice, syncFullPatch } from '#/modules/Proof/useCases';
import { updateTunerTelemetry } from '#/modules/Scoring/stores';
import { initToasterSubscribers, setToasterEventBus } from '#/modules/Toaster/useCases';
import {
    getTransportHandlers,
    getTransportState,
    deleteTimelineMapsTimeRange,
    setSetlistEventBus,
    setStopPlaybackCallback,
    shiftTimelineMapsAfterBeat,
    stopPlayback,
} from '#/modules/Transport/useCases';
import { getWorkspaceHandlers, getScratchPadHandlers, setWorkspaceEventBus } from '#/modules/Workspace/useCases';
import { setYeastEventBus } from '#/modules/Yeast/stores';
import { configureYeastRuntime, teardownYeastRuntime } from '#/modules/Yeast/useCases';
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
setWebMidiRuntimeEventBus({ eventBus });
setNotificationEventBus(eventBus);
setTimeOperationDependencies({ shiftTimelineMapsAfterBeat, deleteTimelineMapsTimeRange });
setProjectIdentityTransitionDependencies({ leaveCollaborationSession: leaveSession });

window.addEventListener('beforeunload', () => {
    teardownYeastRuntime();
    // Attempt GC on window close
    cleanupUnusedFreezeFiles().catch(() => {});
});

// Funnel otherwise-silent fire-and-forget promise rejections into the logger.
// Disposer is wired to HMR so a hot reload does not stack duplicate handlers.
const disposeGlobalErrorHandlers = registerGlobalErrorHandlers({ logger });
import.meta.hot?.dispose(() => {
    disposeGlobalErrorHandlers();
});

setFermenterDependencies({
    getAllTracks,
    persistDeviceParam,
    persistDevicePatch,
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
registerHandlerMap(getMidiLearnHandlers());
registerHandlerMap(getScratchPadHandlers());
registerHandlerMap(getPatternInstanceHandlers());
registerHandlerMap(getMacroHandlers());
registerHandlerMap(getUndoRedoHandlers());
registerHandlerMap(getUndoTreeHandlers());
registerHandlerMap(getPitchHandlers());
registerHandlerMap(getSongStructureHandlers());
registerHandlerMap(getVersionControlHandlers());
registerHandlerMap(getDawProjectHandlers());
registerHandlerMap(getFinalFeatureHandlers());
registerHandlerMap(getDsoSnapshotHandlers());

initToasterSubscribers({ eventBus, logger });
initStalenessDetection();

trackStore.subscribe(() => markDirty());

// Initialize browser AI module asynchronously — non-blocking, non-fatal.
// Detects WebGPU capability and populates model registry from OPFS cache.
initBrowserAi().catch((error: unknown) => {
    logger.warn(`Browser AI initialization failed (non-fatal): ${String(error)}`);
});

export { eventBus, logger };
