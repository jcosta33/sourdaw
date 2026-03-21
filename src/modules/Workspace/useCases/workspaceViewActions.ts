/**
 * Workspace View Actions — re-exports for cross-module use cases
 * used by Workspace presentation views, hooks, and components.
 *
 * The presentations layer cannot import use cases from other modules directly.
 * This module-local use case re-exports each cross-module use case so
 * presentation files only import from within Workspace.
 */

// ── Track: clip editing ───────────────────────────────────────────
export {
    normalizeClip,
    reverseClip,
    trimClipStart,
    trimClipEnd,
    setClipFade,
    setClipColor,
    renameClip,
    setClipGain,
    setClipFollowAction,
} from '#/modules/Track/useCases/clipEditingUseCases';

// ── Track: clip operations ────────────────────────────────────────
export { addClip, removeClip } from '#/modules/Track/useCases/clipUseCases';

// ── Track: clipboard ──────────────────────────────────────────────
export {
    copySelectedClip,
    cutSelectedClip,
    pasteClip,
    copySelectedNotes,
    pasteNotes,
} from '#/modules/Track/useCases/clipboardUseCases';

// ── Track: general ────────────────────────────────────────────────
export {
    selectTrack,
    setTrackOutput,
    muteTrack,
    soloTrack,
    soloTrackExclusive,
    toggleInputMonitoring,
    toggleSoloSafe,
} from '#/modules/Track/useCases/toggleTrackState';
export { addTrack } from '#/modules/Track/useCases/addTrack';
export {
    bypassDevice,
    addDevice,
    removeDevice,
    reorderDevices,
    setDeviceParameter,
    setSend,
    toggleSendPreFader,
    addExternalDevice,
} from '#/modules/Track/useCases/deviceUseCases';
export { renameTrack } from '#/modules/Track/useCases/renameTrack';
export { removeTrack } from '#/modules/Track/useCases/removeTrack';
export { setTrackGain, setTrackPan, setTrackColor, setTrackNotes } from '#/modules/Track/useCases/setTrackGainPan';
export { armTrack } from '#/modules/Track/useCases/recordingUseCases';
export { freezeTrack, unfreezeTrack } from '#/modules/Track/useCases/freezeBounce';
export { importMidiFile } from '#/modules/Track/useCases/importMidiFile';
export { setMidiOutput, clearMidiOutput } from '#/modules/Track/useCases/midiRoutingUseCases';
export { assignToVca, removeFromVca, getVcaGroups, createVcaGroup } from '#/modules/Track/useCases/vcaUseCases';
export { setCompRegion, selectTake, flattenComp } from '#/modules/Track/useCases/compingUseCases';

// ── Track: automation ─────────────────────────────────────────────
export {
    addAutomationLane,
    removeAutomationLane,
    toggleAutomationVisibility,
} from '#/modules/Track/useCases/automationUseCases';

// ── Track: MIDI ───────────────────────────────────────────────────
export {
    addMidiCC,
    removeMidiCC,
    moveMidiCC,
    addPitchBend,
    removePitchBend,
    movePitchBend,
    setNotePressure,
    setNoteSlide,
    setNoteVelocity,
    setNoteProbability,
    addMidiNote,
    removeMidiNote,
    moveMidiNote,
    resizeMidiNote,
    getNotesForClip,
    quantizeNotes,
    transposeNotes,
    humanizeNotes,
} from '#/modules/Track/useCases/midiUseCases';

// ── Track: presets ────────────────────────────────────────────────
export { getFactoryPresets } from '#/modules/Track/useCases/soundPresetLibrary';

// ── Track: warp ───────────────────────────────────────────────────

// ── AiRuntime ─────────────────────────────────────────────────────
export { getProjectContext } from '#/modules/AiRuntime/useCases/getProjectContext';
export {
    isLlmAvailable,
    initEngine,
    resolveBackend,
    unloadEngine,
} from '#/modules/AiRuntime/useCases/llmOrchestration';
export { parsePromptToActions, isComplexPrompt } from '#/modules/AiRuntime/useCases/parsePromptToActions';

// ── AudioEngine ───────────────────────────────────────────────────
export { decodeAudioFile } from '#/modules/AudioEngine/useCases/decodeAudioFile';
export {
    getAudioContext,
    getEngineState,
    getMasterPeakLevel,
    setMasterGainValue,
} from '#/modules/AudioEngine/useCases/engineAccess';
export { initializeAudioEngine } from '#/modules/AudioEngine/useCases/initializeAudioEngine';
export { getTrackPeakLevel, setTrackMute } from '#/modules/AudioEngine/useCases/trackAudioControls';
export {
    parseSFZ,
    loadSFZSamples,
    playNote,
    findRegion,
    getLoadedInstruments,
    createSF2Instrument,
} from '#/modules/AudioEngine/useCases/samplePlayer';
export { initWebMidi } from '#/modules/AudioEngine/useCases/webMidiInput';
export {
    getAllSidechainRoutes,
    addSidechainRoute,
    removeSidechainRoute,
    getSidechainSource,
} from '#/modules/AudioEngine/useCases/sidechainUseCases';

// ── Command ───────────────────────────────────────────────────────
export { pushUndoEntry } from '#/modules/Command/useCases/pushUndoEntry';
export { executeAppAction } from '#/modules/Command/useCases/executeAppAction';
export { undo, redo } from '#/modules/Command/useCases/undoRedo';
export { describeAction } from '#/modules/Command/useCases/actionLabels';

// ── Project ───────────────────────────────────────────────────────
export { loadProject, saveProject, newProject, renameProject } from '#/modules/Project/useCases/projectPersistence';

// ── Transport ─────────────────────────────────────────────────────
export { setTempo } from '#/modules/Transport/useCases/setTempo';
export { addTempoChange, removeTempoChange, updateTempoChange } from '#/modules/Transport/useCases/tempoMapUseCases';

// ── Re-export types from private models via queries ───────────────
export { type DeviceParameter } from '#/modules/Track/useCases/trackQueries';
export { type Clip, type Track } from '#/modules/Track/useCases/trackQueries';
export { type MidiNote } from '#/modules/Track/useCases/trackQueries';
export { type SoundPresetCategory } from '#/modules/Track/useCases/trackQueries';
export { type TransportState } from '#/modules/Transport/useCases/transportQueries';
export { defaultTransportState } from '#/modules/Transport/useCases/transportQueries';

// ── Re-exports from query layers ──────────────────────────────────
export { BUILTIN_PLUGINS } from '#/modules/Track/useCases/trackQueries';
export {
    NATIVE_MODEL_INFO,
    WEBLLM_MODEL_INFO,
    CLOUD_MODEL_INFO,
    searchPresets,
    getAvailablePresets,
    type FuzzyResult,
    type IntentResult,
    type PresetCategory,
    type PresetContext,
} from '#/modules/AiRuntime/useCases/aiRuntimeQueries';
export { generateGroupId, type AppAction } from '#/modules/Command/useCases/commandQueries';

// ── AiRuntime: Cloud API management ──────────────────────────────
export {
    configureCloudApi,
    removeCloudApi,
    isCloudAvailable as isCloudApiAvailable,
} from '#/modules/AiRuntime/useCases/cloudApiManagement';

// ── AiRuntime: Audio analysis ────────────────────────────────────
export { polyphonicAudioToMidi } from '#/modules/AiRuntime/useCases/polyphonicAudioToMidi';
export { detectDominantPitch } from '#/modules/AiRuntime/useCases/pitchDetection';
export { summarizeFeatures } from '#/modules/AiRuntime/useCases/audioFeatures';
export {
    type SoundPreset,
    type MidiCC,
    type MidiPitchBend,
    type Device,
    type WarpState,
} from '#/modules/Track/useCases/trackQueries';
export { type SidechainRoute } from '#/modules/AudioEngine/useCases/sidechainUseCases';

// Track presets
export {
    getUserPresets,
    deleteUserPreset,
    createTrackFromPreset,
    loadPresetToTrack,
    saveCurrentAsPreset,
} from '#/modules/Track/useCases/presetUseCases';
export {
    getWarpState,
    enableWarp,
    disableWarp,
    setStretchMode,
    addWarpMarker,
    removeWarpMarker,
    moveWarpMarker,
} from '#/modules/Track/useCases/warpUseCases';

// Transport
export {
    togglePlayback,
    stopPlayback,
    toggleLoop,
    toggleOverdub,
    toggleMetronome,
    setMetronomeVolume,
    togglePunchEnabled,
    toggleCountIn,
    togglePreRoll,
    toggleRecording,
} from '#/modules/Transport/useCases/transportControls';

// Command: track alternatives
export {
    handleCreateTrackAlternative,
    handleSwitchTrackAlternative,
    handleDeleteTrackAlternative,
} from '#/modules/Command/useCases/trackAlternativeHandlers';

// ── AudioEngine: plugin management ───────────────────────────────
export {
    startPluginScan,
    scanCustomPaths,
    getScannedPlugins,
    getScannedPluginsByFormat,
    findPluginByName,
    addScanPath,
    removeScanPath,
} from '#/modules/AudioEngine/useCases/pluginScanUseCases';
export {
    scanPlugins,
    getDefaultPluginPaths,
    loadPlugin,
    unloadPlugin,
    setPluginParameter,
    getPluginParameters,
    isTauriAvailable,
} from '#/modules/AudioEngine/useCases/pluginBridge';

// ── AudioEngine: WAM & Faust ─────────────────────────────────────
export {
    getRegisteredPlugins,
    getPluginsByCategory,
    registerWAMPlugin,
} from '#/modules/AudioEngine/useCases/wamPluginHost';
export { getFaustModules, getFaustModule, compileFaustDSP } from '#/modules/AudioEngine/useCases/faustEngine';

// ── AudioEngine: modulation ──────────────────────────────────────
export {
    createModulationSource,
    updateModulationSourceParam,
    deleteModulationSource,
    getAllModulationSources,
    createModulationRoute,
    setModulationAmount,
    deleteModulationRoute,
    getAllModulationRoutes,
    getModulationRoutesForParam,
    getModulatedValue,
} from '#/modules/AudioEngine/useCases/modulationSystem';

// ── AudioEngine: latency compensation ────────────────────────────
export {
    reportLatency,
    clearReportedLatency,
    getTrackLatency,
    getMaxTrackLatency,
    getCompensationDelay,
    getLatencyReport,
} from '#/modules/AudioEngine/useCases/latencyCompensation';

// ── AudioEngine: native AI bridge ────────────────────────────────
export {
    loadNativeModel,
    nativeInference,
    unloadNativeModel,
    executeToolCalling,
    generateMidiAI,
    denoiseAudio,
} from '#/modules/AudioEngine/useCases/nativeAIBridge';

// ── AudioEngine: MIDI device management ──────────────────────────
export {
    getAvailableMidiInputs,
    selectMidiInput,
    setMidiInputTrack,
    startMidiLearnLegacy,
    stopMidiLearnLegacy,
    resetMidiState,
    setMpeEnabled,
    getMpeEnabled,
} from '#/modules/AudioEngine/repositories/webMidiRepository';
