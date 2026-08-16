// Elastic-audio editor + audioWarping use cases moved to ElasticAudio (ADR 0011 W4).
export { computeMomentaryLUFS } from './advancedMetering/lufs/computeMomentaryLUFS';
export { ShortTermLUFS } from './advancedMetering/lufs/ShortTermLUFS';
export { IntegratedLUFS } from './advancedMetering/lufs/IntegratedLUFS';
export { VUMeter } from './advancedMetering/vuMeter';

export { PhaseCorrelationMeter } from './advancedMetering/phaseCorrelation';

export { getAudioDevices } from './audioDeviceSelection/getAudioDevices';

export { defaultSynthParams } from './audioEngineQueries/helpers';
export { getDrumKitByIndex } from './audioEngineQueries/getDrumKitByIndex';
export { getFactoryDrumKitByIndex } from './audioEngineQueries/getFactoryDrumKitByIndex';

export { startAudioRecording } from './audioRecorder/startAudioRecording';
export { startInputMonitoring } from './audioRecorder/startInputMonitoring';
export { stopAudioRecording } from './audioRecorder/stopAudioRecording';
export { stopInputMonitoring } from './audioRecorder/stopInputMonitoring';
export { requestMicPermission } from './audioRecorder/requestMicPermission';

export { playAuditionNote } from './audition';
export { cacheAudioBuffer } from './cacheAudioBuffer';
export { cancelPendingAudioBufferImport } from './cancelPendingAudioBufferImport';
export { clearCachedAudioBuffers } from './clearCachedAudioBuffers';
export { clearRuntimeCachedAudioBuffers } from './clearRuntimeCachedAudioBuffers';
export { exportCachedAudioBuffers } from './exportCachedAudioBuffers';
export { garbageCollectCachedAudioBuffersByAge } from './garbageCollectCachedAudioBuffersByAge';
export { garbageCollectCachedAudioBuffersBySize } from './garbageCollectCachedAudioBuffersBySize';
export { garbageCollectFreezeAudioBuffers } from './garbageCollectFreezeAudioBuffers';
export { getCachedAudioBuffer } from './getCachedAudioBuffer';
export { getCachedAudioBufferWaveformPeaks } from './getCachedAudioBufferWaveformPeaks';
export { importCachedAudioBuffers } from './importCachedAudioBuffers';
export { prepareCachedAudioBuffersFromIdb } from './prepareCachedAudioBuffersFromIdb';
export { cachePreviewAudioBuffer } from './cachePreviewAudioBuffer';
export { playCachedAudioBufferPreview } from './playCachedAudioBufferPreview';
export { releasePreviewAudioBuffer } from './releasePreviewAudioBuffer';
export { restoreCachedAudioBuffersFromIdb } from './restoreCachedAudioBuffersFromIdb';

export { scheduleFaustNote } from './faustScheduler/scheduleFaustNote';
export { startFaustNote } from './faustScheduler/startFaustNote';

export { applyNoteExpression } from './noteExpression/applyNoteExpression';
export { getDefaultBendRangeSemitones } from './noteExpression/getDefaultBendRangeSemitones';
export { getNoteExpressionDimensions } from './noteExpression/getNoteExpressionDimensions';

export { buildDeviceChain } from './buildDeviceChain';
export { resolveToasterPadBinding } from './resolveToasterPadBinding';

export { decodeAudioFile } from './decodeAudioFile';
export { decodeAudioFileBuffer } from './decodeAudioFileBuffer';

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
export { getEngineDiagnostics } from './engineAccess/getEngineDiagnostics';
export { getEngineHealth } from './engineAccess/getEngineHealth';
export { isEngineAudioAvailable } from './engineAccess/isEngineAudioAvailable';
export { refreshEngineRtDiagnostics } from './engineAccess/refreshEngineRtDiagnostics';
export { getDeviceReadinessDiagnostics } from './engineAccess/getDeviceReadinessDiagnostics';
export { resetEnginePlaybackLatencyStats } from './engineAccess/resetEnginePlaybackLatencyStats';
export { resumeEngine } from './engineAccess/resumeEngine';
export { waitForDevices } from './engineAccess/waitForDevices';
export { resetAudioGraph } from './engineAccess/resetAudioGraph';
export { getMasterAnalyser } from './engineAccess/getMasterAnalyser';
export { getMasterPeakLevel } from './engineAccess/getMasterPeakLevel';
export { setMasterGainValue } from './engineAccess/setMasterGainValue';
export { getAudioSampleRate } from './engineAccess/getAudioSampleRate';
export { getTrackAnalyser } from './engineAccess/getTrackAnalyser';
export { getTrackStrip } from './engineAccess/getTrackStrip';
export { getToasterDeviceControls } from './engineAccess/getToasterDeviceControls';
export { ensureTrackStrip } from './engineAccess/ensureTrackStrip';
export { removeTrackStrip } from './engineAccess/removeTrackStrip';
export { getAudioTime } from './engineAccess/getAudioTime';
export { ensureBusStrip } from './engineAccess/ensureBusStrip';
export { removeBusStrip } from './engineAccess/removeBusStrip';
export { setBusGain } from './engineAccess/setBusGain';
export { setSend } from './engineAccess/setSend';
export { scheduleSendAutomation } from './engineAccess/scheduleSendAutomation';
export { removeSend } from './engineAccess/removeSend';
export { wireSidechainRoute } from './engineAccess/wireSidechainRoute';
export { unwireSidechainRoute } from './engineAccess/unwireSidechainRoute';
export { refreshSidechainAlignment } from './engineAccess/refreshSidechainAlignment';
export { getFinalFeatureHandlers } from './getFinalFeatureHandlers';

export { configureAudioDeviceRuntimeSink } from './configureAudioDeviceRuntimeSink';
export { initializeAudioEngine } from './initializeAudioEngine';

export { getTrackLatency } from './latencyCompensation/compensation/getTrackLatency';
export { getCompensationDelay } from './latencyCompensation/compensation/getCompensationDelay';
export { getSidechainKeyDelay } from './latencyCompensation/compensation/getSidechainKeyDelay';
export { getLatencyReport } from './latencyCompensation/compensation/getLatencyReport';
export { reportLatency } from './latencyCompensation/compensation/reportLatency';
export { clearReportedLatency } from './latencyCompensation/compensation/clearReportedLatency';

export { cancelExport } from './offlineRender/exportCancellation';
export { isExportActive } from './offlineRender/isExportActive';
export { getAutoDetectedTailSeconds } from './offlineRender/getAutoDetectedTailSeconds';
export { getDeviceChainTailSeconds } from './offlineRender/getDeviceChainTailSeconds';
export { renderOffline } from './renderOffline';
export { exportStems } from './exportStems';
export { configureOfflineDeviceParameterLaw } from './configureOfflineDeviceParameterLaw';
export { configureOfflineMidiEventProjection } from './configureOfflineMidiEventProjection';
export { configureOfflinePpqEndpointProjection } from './configureOfflinePpqEndpointProjection';
export { configureOfflineYeastMidiProcessing } from './configureOfflineYeastMidiProcessing';
export { projectOfflineYeastTrackNotes } from './offlineRender/projectOfflineYeastTrackNotes';
export { renderTrackSubgraphOffline } from './offlineRender/renderTrackSubgraphOffline';
// Audio encoders (audioBufferToWav/Mp3/Flac) moved to AudioRendering (ADR 0011 W4).

export { scheduleAdjustmentLayers } from './adjustmentLayer/scheduleAdjustmentLayers';
export { getSharedAdjustmentLayerApplier } from './adjustmentLayer/sharedAdjustmentLayerApplier';

export { scheduleClick } from './scheduling/scheduleClick';
export { stopAllScheduled } from './scheduling/stopAllScheduled';
export { registerScheduledSource } from './scheduling/registerScheduledSource';
export { getCurrentTime } from './scheduling/getCurrentTime';
export { createBufferSource } from './scheduling/createBufferSource';

export { setMasterGain } from './setMasterGain';

export { setTrackGain } from './trackAudioControls/setTrackGain';
export { setTrackPan } from './trackAudioControls/setTrackPan';
export { scheduleTrackGain } from './trackAudioControls/scheduleTrackGain';
export { scheduleTrackPan } from './trackAudioControls/scheduleTrackPan';
export { cancelTrackAutomationRamps } from './trackAudioControls/cancelTrackAutomationRamps';
export { setTrackMute } from './trackAudioControls/setTrackMute';
export { setTrackSoloGate } from './trackAudioControls/setTrackSoloGate';
export { setTrackOutput } from './trackAudioControls/setTrackOutput';
export { getTrackPeakLevel } from './trackAudioControls/getTrackPeakLevel';

export { analyzePitchForClip } from './audioAnalysis/analyzePitchForClip';
export { commitPitchEdit } from './audioAnalysis/commitPitchEdit';
export { processPitchEditWasm } from './audioAnalysis/processPitchEditWasm';
export { compileAudioGraphTopology } from './compileAudioGraphTopology';
