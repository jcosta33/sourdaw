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
} from '#/modules/Clip/useCases/clipEditingUseCases';

// ── Track: clip operations ────────────────────────────────────────
export { addClip, removeClip } from '#/modules/Clip/useCases/clipUseCases';

// ── Track: clipboard ──────────────────────────────────────────────
export {
    copySelectedClip,
    cutSelectedClip,
    pasteClip,
    copySelectedNotes,
    pasteNotes,
} from '#/modules/Clip/useCases/clipboardUseCases';

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
export { importMidiFile } from '#/modules/Midi/useCases/importMidiFile';
export { setMidiOutput, clearMidiOutput } from '#/modules/Midi/useCases/midiRoutingUseCases';
export { assignToVca, removeFromVca, getVcaGroups, createVcaGroup } from '#/modules/Track/useCases/vcaUseCases';
export { setCompRegion, selectTake, flattenComp } from '#/modules/Clip/useCases/compingUseCases';

// ── Track: automation ─────────────────────────────────────────────
export {
    addAutomationLane,
    removeAutomationLane,
    toggleAutomationVisibility,
} from '#/modules/Automation/useCases/automationUseCases';

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
} from '#/modules/Midi/useCases/midiUseCases';

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
export { BUILTIN_PLUGINS, getPlatformPlugins } from '#/modules/Track/useCases/trackQueries';
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
export { polyphonicAudioToMidi } from '#/modules/AudioAnalysis/useCases/polyphonicAudioToMidi';
export { detectDominantPitch } from '#/modules/AudioAnalysis/useCases/pitchDetection';
export { summarizeFeatures } from '#/modules/AudioAnalysis/useCases/audioFeatures';
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
} from '#/modules/Clip/useCases/warpUseCases';

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
} from '#/modules/Plugin/useCases/pluginScanUseCases';
export {
    scanPlugins,
    getDefaultPluginPaths,
    loadPlugin,
    unloadPlugin,
    setPluginParameter,
    getPluginParameters,
    isTauriAvailable,
} from '#/modules/Plugin/useCases/pluginBridge';

// ── AudioEngine: WAM & Faust ─────────────────────────────────────
export {
    getRegisteredPlugins,
    getPluginsByCategory,
    registerWAMPlugin,
} from '#/modules/Plugin/useCases/wamPluginHost';
export { getFaustModules, getFaustModule, compileFaustDSP } from '#/modules/Plugin/useCases/faustEngine';

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
} from '#/modules/Plugin/useCases/modulationSystem';

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

// ── Command: action classification ───────────────────────────────
export { DESTRUCTIVE_ACTIONS, REQUIRES_CONFIRMATION } from '#/modules/Command/models/AppAction';

// ── Transport: bar/beat mapping ───────────────────────────────────
export { getBarBeatAtPosition } from '#/modules/Transport/models/TimeSignatureMap';
export { getTimeSignatureChanges } from '#/modules/Transport/useCases/timeSignatureChanges';

// ── Workspace: editing mode queries ──────────────────────────────
export { isRippleEditing } from '#/modules/Workspace/useCases/rippleEditing';

// ── Track: automation UI helpers ─────────────────────────────────
export { isDrawSessionActive } from '#/modules/Automation/useCases/automationDrawMode';
export { resetYZoom, adjustYZoom, zoomToUsedRange } from '#/modules/Automation/useCases/automationZoom';
export { transformSelectedPoints } from '#/modules/Automation/useCases/automationSelection';
export { createAutomationObject } from '#/modules/Automation/models/Automation';

// ── AudioEngine: drum kit registry ───────────────────────────────
export { getFactoryDrumKits } from '#/modules/AudioEngine/helpers/factoryDrumKits';

// ── Track: batch clip ops ─────────────────────────────────────────
export { updateClipsOnAllTracks } from '#/modules/Track/repositories/trackRepository';

// ── Track: plugin device registry ────────────────────────────────
export { getPluginById } from '#/modules/Track/models/DeviceParameter';

// ── AudioEngine: audio file info ─────────────────────────────────
export { getAudioFileInfo } from '#/modules/AudioEngine/repositories/audioDecodingRepository';
