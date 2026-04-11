// AudioEngine/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { computeMomentaryLUFS, ShortTermLUFS, IntegratedLUFS } from './advancedMetering/lufs';

export { computePhaseCorrelation, PhaseCorrelationMeter } from './advancedMetering/phaseCorrelation';

export type { AudioDeviceInfo } from './audioDeviceSelection';
export {
    audioDeviceStore,
    getAudioDevices,
    setOutputDevice,
    setInputDevice,
    getSelectedInputId,
} from './audioDeviceSelection';

export type { SynthParams, MpeParams } from './audioEngineQueries';
export {
    defaultSynthParams,
    getDrumKitById,
    getDrumKitByIndex,
} from './audioEngineQueries';

export { startAudioRecording } from './audioRecorder/startAudioRecording';
export { startInputMonitoring } from './audioRecorder/startInputMonitoring';
export { stopAudioRecording } from './audioRecorder/stopAudioRecording';
export { stopInputMonitoring } from './audioRecorder/stopInputMonitoring';

export { playAuditionNote } from './audition';

export type { DeviceNodeEntry, BuildDeviceChainOutput } from './buildDeviceChain';
export { buildDeviceChain } from './buildDeviceChain';

export { switchMonitor } from './controlRoom/switchMonitor';
export { toggleDim } from './controlRoom/toggleDim';
export { toggleMono } from './controlRoom/toggleMono';

export { decodeAudioFile } from './decodeAudioFile';

export { addDeviceToStrip } from './deviceControls/addDeviceToStrip';
export { removeDeviceFromStrip } from './deviceControls/removeDeviceFromStrip';
export { updateDeviceParam } from './deviceControls/updateDeviceParam';
export { scheduleDeviceParam } from './deviceControls/scheduleDeviceParam';
export { updateDeviceBypass } from './deviceControls/updateDeviceBypass';

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
} from './engineAccess';

export { getFinalFeatureHandlers } from './getFinalFeatureHandlers';

export { initializeAudioEngine } from './initializeAudioEngine';

export {
    reportLatency,
    clearReportedLatency,
    getTrackLatency,
    getMaxTrackLatency,
    getCompensationDelay,
    getLatencyReport,
} from './latencyCompensation/compensation';

export type { MidiGenerationResult, MidiGenerationNote, DenoiseResult } from './nativeAiBridge';
export { isTauri, generateMidiAI, denoiseAudio } from './nativeAiBridge';

export type { OfflineRenderOptions } from './offlineRender';
export { cancelExport, isExportActive, renderOffline, exportStems } from './offlineRender';
export { audioBufferToWav } from './audioBufferToWav';
export { audioBufferToMp3 } from './audioBufferToMp3';
export { audioBufferToFlac } from './audioBufferToFlac';

export { scheduleClick, stopAllScheduled, getCurrentTime, createBufferSource } from './scheduling';

export { setMasterGain } from './setMasterGain';

export {
    ensureTrackStrip as ensureTrackStripControls,
    getTrackStrip as getTrackStripControls,
    setTrackGain,
    setTrackPan,
    setTrackMute,
    setTrackOutput,
    getTrackPeakLevel,
} from './trackAudioControls';

export { triggerLiveNoteOff } from './triggerLiveNoteOff';

export { triggerLiveNoteOn } from './triggerLiveNoteOn';

export type { MidiInputInfo } from './webMidiInput';
export {
    subscribe as subscribeMidi,
    getSnapshot as getMidiSnapshot,
    initWebMidi,
    selectMidiInput,
    setMidiInputTrack,
    setMpeEnabled,
    resetMidiState,
    webMidiStore,
} from './webMidiInput';
