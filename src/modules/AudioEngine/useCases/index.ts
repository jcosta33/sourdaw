export { detectTransients, type TransientHit } from './elasticAudio/detectTransients';
export { detectTransientsForClip, type DetectTransientsResult } from './elasticAudio/detectTransientsForClip';
export { markElasticDetectionComplete } from './elasticAudio/markElasticDetectionComplete';
export { selectElasticMarkers } from './elasticAudio/selectElasticMarkers';
export { openElasticEditor } from './elasticAudio/openElasticEditor';
export { closeElasticEditor } from './elasticAudio/closeElasticEditor';
export { setElasticTool } from './elasticAudio/setElasticTool';
export { setElasticSensitivity } from './elasticAudio/setElasticSensitivity';

export { computeMomentaryLUFS } from './advancedMetering/lufs/computeMomentaryLUFS';
export { ShortTermLUFS } from './advancedMetering/lufs/ShortTermLUFS';
export { IntegratedLUFS } from './advancedMetering/lufs/IntegratedLUFS';
export { VUMeter } from './advancedMetering/vuMeter';

export { PhaseCorrelationMeter } from './advancedMetering/phaseCorrelation';

export type { AudioDeviceInfo } from './audioDeviceSelection/getAudioDevices';
export { getAudioDevices } from './audioDeviceSelection/getAudioDevices';

export type { SynthParams, MpeParams } from './audioEngineQueries/helpers';
export { defaultSynthParams } from './audioEngineQueries/helpers';
export { getDrumKitByIndex } from './audioEngineQueries/getDrumKitByIndex';

export { startAudioRecording } from './audioRecorder/startAudioRecording';
export { startInputMonitoring } from './audioRecorder/startInputMonitoring';
export { stopAudioRecording } from './audioRecorder/stopAudioRecording';
export { stopInputMonitoring } from './audioRecorder/stopInputMonitoring';
export { requestMicPermission } from './audioRecorder/requestMicPermission';

export { playAuditionNote } from './audition';
export { cacheAudioBuffer } from './cacheAudioBuffer';
export { clearCachedAudioBuffers } from './clearCachedAudioBuffers';
export { exportCachedAudioBuffers } from './exportCachedAudioBuffers';
export { garbageCollectCachedAudioBuffersByAge } from './garbageCollectCachedAudioBuffersByAge';
export { garbageCollectCachedAudioBuffersBySize } from './garbageCollectCachedAudioBuffersBySize';
export { garbageCollectFreezeAudioBuffers } from './garbageCollectFreezeAudioBuffers';
export { getCachedAudioBuffer } from './getCachedAudioBuffer';
export { cachePreviewAudioBuffer } from './cachePreviewAudioBuffer';
export { playCachedAudioBufferPreview } from './playCachedAudioBufferPreview';
export { releasePreviewAudioBuffer } from './releasePreviewAudioBuffer';
export { restoreCachedAudioBuffersFromIdb } from './restoreCachedAudioBuffersFromIdb';

export { scheduleFaustNote } from './faustScheduler/scheduleFaustNote';
export { startFaustNote } from './faustScheduler/startFaustNote';

export { buildDeviceChain } from './buildDeviceChain';
export type { DeviceNodeEntry } from './buildDeviceChain';

export { switchMonitor } from './controlRoom/switchMonitor';
export { toggleDim } from './controlRoom/toggleDim';
export { toggleMono } from './controlRoom/toggleMono';

export { decodeAudioFile } from './decodeAudioFile';

export { addDeviceToStrip } from './deviceControls/addDeviceToStrip';
export { removeDeviceFromStrip } from './deviceControls/removeDeviceFromStrip';
export { updateDeviceParam } from './deviceControls/updateDeviceParam';
export { updateDevicePatch } from './deviceControls/updateDevicePatch';
export { scheduleDeviceParam } from './deviceControls/scheduleDeviceParam';
export { scheduleDeviceKeyOn } from './deviceControls/scheduleDeviceKeyOn';
export { scheduleDeviceKeyOff } from './deviceControls/scheduleDeviceKeyOff';
export { updateDeviceBypass } from './deviceControls/updateDeviceBypass';
export { registerTuningTable } from './deviceControls/tuningControls';
export { addMidiFxToStrip } from './deviceControls/addMidiFxToStrip';
export { removeMidiFxFromStrip } from './deviceControls/removeMidiFxFromStrip';
export { updateMidiFxBypass } from './deviceControls/updateMidiFxBypass';
export { updateMidiFxParam } from './deviceControls/updateMidiFxParam';

export { getAudioContext, audioEngine } from './engineAccess/getAudioContext';
export { getEngineState } from './engineAccess/getEngineState';
export { resumeEngine } from './engineAccess/resumeEngine';
export { waitForDevices } from './engineAccess/waitForDevices';
export { resetAudioGraph } from './engineAccess/resetAudioGraph';
export { getMasterAnalyser } from './engineAccess/getMasterAnalyser';
export { getMasterPeakLevel } from './engineAccess/getMasterPeakLevel';
export { setMasterGainValue } from './engineAccess/setMasterGainValue';
export { getAudioSampleRate } from './engineAccess/getAudioSampleRate';
export { getTrackAnalyser } from './engineAccess/getTrackAnalyser';
export { getTrackStrip } from './engineAccess/getTrackStrip';
export { ensureTrackStrip } from './engineAccess/ensureTrackStrip';
export { getAudioTime } from './engineAccess/getAudioTime';
export { ensureBusStrip } from './engineAccess/ensureBusStrip';
export { setBusGain } from './engineAccess/setBusGain';
export { setSend } from './engineAccess/setSend';
export { removeSend } from './engineAccess/removeSend';
export { wireSidechainRoute } from './engineAccess/wireSidechainRoute';
export { unwireSidechainRoute } from './engineAccess/unwireSidechainRoute';
export { enableLink } from './engineAccess/enableLink';
export { disableLink } from './engineAccess/disableLink';

export { getFinalFeatureHandlers } from './getFinalFeatureHandlers';

export { configureAudioDeviceRuntimeSink } from './configureAudioDeviceRuntimeSink';
export { initializeAudioEngine } from './initializeAudioEngine';

export { getTrackLatency } from './latencyCompensation/compensation/helpers';
export { getCompensationDelay } from './latencyCompensation/compensation/getCompensationDelay';
export { getLatencyReport } from './latencyCompensation/compensation/getLatencyReport';

export type { MidiGenerationNote } from './nativeAiBridge/generateMidiAI';
export { isTauri } from './nativeAiBridge/isTauri';
export { generateMidiAI } from './nativeAiBridge/generateMidiAI';
export { denoiseAudio } from './nativeAiBridge/denoiseAudio';

export type { OfflineRenderOptions } from './offlineRender/types';
export { cancelExport } from './offlineRender/exportCancellation';
export { isExportActive } from './offlineRender/isExportActive';
export { getAutoDetectedTailSeconds } from './offlineRender/getAutoDetectedTailSeconds';
export { renderOffline } from './renderOffline';
export { exportStems } from './exportStems';
export { audioBufferToWav } from './audioBufferToWav';
export { audioBufferToMp3 } from './audioBufferToMp3';
export { audioBufferToFlac } from './audioBufferToFlac';

export { scheduleAdjustmentLayers } from './adjustmentLayer/scheduleAdjustmentLayers';
export { getSharedAdjustmentLayerApplier } from './adjustmentLayer/sharedAdjustmentLayerApplier';

export { scheduleClick } from './scheduling/scheduleClick';
export { stopAllScheduled } from './scheduling/stopAllScheduled';
export { getCurrentTime } from './scheduling/getCurrentTime';
export { createBufferSource } from './scheduling/createBufferSource';

export { setMasterGain } from './setMasterGain';

export { setTrackGain } from './trackAudioControls/setTrackGain';
export { setTrackPan } from './trackAudioControls/setTrackPan';
export { setTrackMute } from './trackAudioControls/setTrackMute';
export { setTrackOutput } from './trackAudioControls/setTrackOutput';
export { getTrackPeakLevel } from './trackAudioControls/getTrackPeakLevel';

export { triggerLiveNoteOff } from './triggerLiveNoteOff';

export { analyzePitchForClip } from './audioAnalysis/analyzePitchForClip';
export { commitPitchEdit } from './audioAnalysis/commitPitchEdit';
export { processPitchEditWasm } from './audioAnalysis/processPitchEditWasm';
export { triggerLiveNoteOn } from './triggerLiveNoteOn';

export { initWebMidi } from './webMidiInput/initWebMidi';
export { setWebMidiRuntimeEventBus } from './webMidiInput/setWebMidiRuntimeEventBus';
export { setMidiInputTrack } from './webMidiInput/setMidiInputTrack';
export { setMpeEnabled } from './webMidiInput/setMpeEnabled';
export { resetMidiState } from './webMidiInput/resetMidiState';
export { webMidiStore } from './webMidiInput/helpers';
export type { MidiInputInfo } from './webMidiInput/helpers';
