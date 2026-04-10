// AudioEngine module public API

// presentations/views
export { AudioDevicePicker } from './presentations/views/AudioDevicePicker';
export { MidiDevicePicker } from './presentations/views/MidiDevicePicker';
export { PluginBrowser } from './presentations/views/PluginBrowser';
export { PluginScanSettings } from './presentations/views/PluginScanSettings';

// stores
export type { ExportedAudioBuffer } from './stores/audioBufferCache';
export { audioBufferCache } from './stores/audioBufferCache';

export type { AudioGraphState } from './stores/audioGraphStore';
export { audioGraphStore, defaultAudioGraphState } from './stores/audioGraphStore';

export type { AudioRecordingState } from './stores/audioRecordingStore';
export { audioRecordingStore } from './stores/audioRecordingStore';

export type { LinkStatus } from './stores/linkStatusStore';
export {
    linkStatusStore,
    defaultLinkStatus,
    subscribeToLinkStatus,
    getLinkStatusSnapshot,
} from './stores/linkStatusStore';

// advancedMetering/lufs
export { computeMomentaryLUFS, ShortTermLUFS, IntegratedLUFS } from './useCases/advancedMetering/lufs';

// advancedMetering/phaseCorrelation
export { computePhaseCorrelation, PhaseCorrelationMeter } from './useCases/advancedMetering/phaseCorrelation';

// audioDeviceSelection
export type { AudioDeviceInfo } from './useCases/audioDeviceSelection';
export {
    audioDeviceStore,
    getAudioDevices,
    setOutputDevice,
    setInputDevice,
    getSelectedInputId,
} from './useCases/audioDeviceSelection';

// audioEngineQueries
export type { SynthParams, MpeParams, DrumKit, DrumKitVoice } from './useCases/audioEngineQueries';
export {
    defaultSynthParams,
    getDrumKitById,
    getDrumKitByIndex,
} from './useCases/audioEngineQueries';

// audioRecorder
export { startAudioRecording } from './useCases/audioRecorder/startAudioRecording';
export { startInputMonitoring } from './useCases/audioRecorder/startInputMonitoring';
export { stopAudioRecording } from './useCases/audioRecorder/stopAudioRecording';
export { stopInputMonitoring } from './useCases/audioRecorder/stopInputMonitoring';

// audition
export { playAuditionNote } from './useCases/audition';

// buildDeviceChain
export type { DeviceNodeEntry, BuildDeviceChainOutput } from './useCases/buildDeviceChain';
export { buildDeviceChain } from './useCases/buildDeviceChain';

// controlRoom
export { switchMonitor } from './useCases/controlRoom/switchMonitor';
export { toggleDim } from './useCases/controlRoom/toggleDim';
export { toggleMono } from './useCases/controlRoom/toggleMono';

// decodeAudioFile
export { decodeAudioFile } from './useCases/decodeAudioFile';

// deviceControls
export {
    addDeviceToStrip,
    removeDeviceFromStrip,
    updateDeviceParam,
    scheduleDeviceParam,
    updateDeviceBypass,
} from './useCases/deviceControls';

// engineAccess
export {
    getAudioContext,
    getEngineState,
    resumeEngine,
    waitForDevices,
    resetAudioGraph,
    getMasterAnalyser,
    getMasterPeakLevel,
    setMasterGainValue,
    getAudioSampleRate,
    getTrackAnalyser,
    getTrackStrip,
    ensureTrackStrip,
    getAudioTime,
    ensureBusStrip,
    setBusGain,
    setSend,
    wireSidechainRoute,
    unwireSidechainRoute,
    enableLink,
    disableLink,
    getLinkStatus,
} from './useCases/engineAccess';

// finalFeatureHandlers
export { finalFeatureHandlers } from './useCases/finalFeatureHandlers';

// initializeAudioEngine
export { initializeAudioEngine } from './useCases/initializeAudioEngine';

// latencyCompensation/compensation
export {
    reportLatency,
    clearReportedLatency,
    getTrackLatency,
    getMaxTrackLatency,
    getCompensationDelay,
    getLatencyReport,
} from './useCases/latencyCompensation/compensation';

// nativeAiBridge
export type { MidiGenerationResult, MidiGenerationNote, DenoiseResult } from './useCases/nativeAiBridge';
export { isTauri, generateMidiAI, denoiseAudio } from './useCases/nativeAiBridge';

// offlineRender
export type { OfflineRenderOptions } from './useCases/offlineRender';
export {
    cancelExport,
    isExportActive,
    renderOffline,
    exportStems,
    audioBufferToWav,
    audioBufferToMp3,
    audioBufferToFlac,
} from './useCases/offlineRender';

// scheduling
export { scheduleClick, stopAllScheduled, getCurrentTime, createBufferSource } from './useCases/scheduling';

// setMasterGain
export { setMasterGain } from './useCases/setMasterGain';

// trackAudioControls
export {
    ensureTrackStrip as ensureTrackStripControls,
    getTrackStrip as getTrackStripControls,
    setTrackGain,
    setTrackPan,
    setTrackMute,
    setTrackOutput,
    getTrackPeakLevel,
} from './useCases/trackAudioControls';

// triggerLiveNoteOff
export { triggerLiveNoteOff } from './useCases/triggerLiveNoteOff';

// triggerLiveNoteOn
export { triggerLiveNoteOn } from './useCases/triggerLiveNoteOn';

// webMidiInput
export type { MidiInputInfo } from './useCases/webMidiInput';
export {
    subscribe as subscribeMidi,
    getSnapshot as getMidiSnapshot,
    initWebMidi,
    selectMidiInput,
    setMidiInputTrack,
    setMpeEnabled,
    resetMidiState,
    webMidiStore,
} from './useCases/webMidiInput';
