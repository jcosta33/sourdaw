// registerDependencies owns app singleton construction; bootstrap wires those
// instances into module-owned dependency ports before runtime subscribers start.
import { setRuntimeLogger } from '#/infra/logger/runtimeLogger';
import { getGenerationHandlers, getAiMidiHandlers } from '#/modules/AiGeneration/useCases';
import { getAiOrganizationHandlers, setVoiceToggleEventBus } from '#/modules/AiRuntime/useCases';
import { persistDeviceParam } from '#/modules/Arrangement/stores';
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
} from '#/modules/Arrangement/useCases';
import { getAnalysisHandlers } from '#/modules/AudioAnalysis/useCases';
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
} from '#/modules/AudioEngine/useCases';
import {
    getAutomationHandlers,
    recordAutomationValue,
    setAutomationRecordingDependencies,
    setModulationDependencies,
} from '#/modules/Automation/useCases';
import { updateBacteriaMeters } from '#/modules/Bacteria/stores';
import { initBrowserAi } from '#/modules/BrowserAi/useCases';
import { getCollaborationHandlers } from '#/modules/Collaboration/useCases';
import { registerHandlerMap } from '#/modules/Command/stores';
import {
    getMacroHandlers,
    getUndoTreeHandlers,
    setCommandEventBus,
    setPitchEditDependencies,
} from '#/modules/Command/useCases';
import { getDsoSnapshotHandlers, registerCrdtStorageRuntime } from '#/modules/CrdtDocument/useCases';
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
import { getSongStructureHandlers, getVersionControlHandlers, getDawProjectHandlers } from '#/modules/Project/useCases';
import { updateProofMeters } from '#/modules/Proof/stores';
import { registerProofDevice, unregisterProofDevice, syncFullPatch } from '#/modules/Proof/useCases';
import { updateTunerTelemetry } from '#/modules/Scoring/stores';
import { initToasterSubscribers, setToasterEventBus } from '#/modules/Toaster/useCases';
import {
    getTransportHandlers,
    getTransportState,
    setSetlistEventBus,
    setStopPlaybackCallback,
    stopPlayback,
} from '#/modules/Transport/useCases';
import { getWorkspaceHandlers, getScratchPadHandlers, setWorkspaceEventBus } from '#/modules/Workspace/useCases';
import { setYeastEventBus } from '#/modules/Yeast/stores';
import { logCapabilities } from '#/utils/capabilities';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { eventBus, logger } from './registerDependencies';

logCapabilities();

registerCrdtStorageRuntime();
setRuntimeLogger(logger);
setArrangementEventBus(eventBus);
setWorkspaceEventBus(eventBus);
setCommandEventBus(eventBus);
setSetlistEventBus(eventBus);
setVoiceToggleEventBus(eventBus);
setGrandBouleEventBus(eventBus);
setToasterEventBus(eventBus);
setYeastEventBus(eventBus);
setWebMidiRuntimeEventBus({ eventBus });
setNotificationEventBus(eventBus);

window.addEventListener('beforeunload', () => {
    // Attempt GC on window close
    cleanupUnusedFreezeFiles().catch(() => {});
});

setFermenterDependencies({
    getAllTracks,
    persistDeviceParam,
    persistDevicePatch,
    updateDeviceParam,
    updateDevicePatch,
});

setStopPlaybackCallback(stopPlayback);

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
registerHandlerMap(getUndoTreeHandlers());
registerHandlerMap(getSongStructureHandlers());
registerHandlerMap(getVersionControlHandlers());
registerHandlerMap(getDawProjectHandlers());
registerHandlerMap(getFinalFeatureHandlers());
registerHandlerMap(getDsoSnapshotHandlers());

initToasterSubscribers({ eventBus, logger });
initStalenessDetection();

// Initialize browser AI module asynchronously — non-blocking, non-fatal.
// Detects WebGPU capability and populates model registry from OPFS cache.
initBrowserAi().catch((error: unknown) => {
    logger.warn(`Browser AI initialization failed (non-fatal): ${String(error)}`);
});

export { eventBus, logger };
