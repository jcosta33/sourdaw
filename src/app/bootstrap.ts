// registerDependencies MUST be the first import — it populates the DI Container
// before any downstream module (like toasterSubscriber → toasterStore) resolves
// Logger/EventBus at module scope.
import { getGenerationHandlers, getAiMidiHandlers } from '#/modules/AiGeneration/useCases';
import { getAiOrganizationHandlers } from '#/modules/AiRuntime/useCases';
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
} from '#/modules/AudioEngine/useCases';
import {
    getAutomationHandlers,
    recordAutomationValue,
    setAutomationRecordingDependencies,
    setModulationDependencies,
} from '#/modules/Automation/useCases';
import { initBrowserAi } from '#/modules/BrowserAi/useCases';
import { getCollaborationHandlers } from '#/modules/Collaboration/useCases';
import { registerHandlerMap } from '#/modules/Command/stores';
import { getMacroHandlers, getUndoTreeHandlers } from '#/modules/Command/useCases';
import { getDsoSnapshotHandlers } from '#/modules/CrdtDocument/useCases';
import { setFermenterMappedParam, setFermenterDependencies } from '#/modules/Fermenter/useCases';
import {
    getChordTrackHandlers,
    getMidiNoteTransformHandlers,
    getMidiLearnHandlers,
    getPatternInstanceHandlers,
    setMidiLearnDependencies,
} from '#/modules/MIDI/useCases';
import { getPluginHostHandlers } from '#/modules/Plugin/useCases';
import { getSongStructureHandlers, getVersionControlHandlers, getDawProjectHandlers } from '#/modules/Project/useCases';
import { initToasterSubscribers } from '#/modules/Toaster/useCases';
import {
    getTransportHandlers,
    getTransportState,
    setStopPlaybackCallback,
    stopPlayback,
} from '#/modules/Transport/useCases';
import { getWorkspaceHandlers, getScratchPadHandlers } from '#/modules/Workspace/useCases';
import { logCapabilities } from '#/utils/capabilities';

import { eventBus, logger } from './registerDependencies';

logCapabilities();

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

initToasterSubscribers();
initStalenessDetection();

// Initialize browser AI module asynchronously — non-blocking, non-fatal.
// Detects WebGPU capability and populates model registry from OPFS cache.
initBrowserAi().catch((error: unknown) => {
    logger.warn(`Browser AI initialization failed (non-fatal): ${String(error)}`);
});

export { eventBus, logger };
