// Arrangement/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

// ── Track ────────────────────────────────────────────────────────────────────

export { addTrack } from './addTrack';
export { createTrack, normalizeTrack } from './createTrack';
export { removeTrack } from './removeTrack';
export { renameTrack } from './renameTrack';
export { duplicateTrack } from './duplicateTrack';
export { updateTrack } from './updateTrack';
export { getAllTracks } from './getAllTracks';
export { getTrackById } from './getTrackById';
export { getSynthParamsForTrack } from './getSynthParamsForTrack';
export { getTrackStoreState } from './getTrackStoreState';
export { setTrackState } from './setTrackState';
export { setTrackStoreState } from './setTrackStoreState';
export { freezeTrack } from './freezeBounce/freezeTrack';
export { cancelFreezeTrack } from './freezeBounce/cancelFreezeTrack';
export { unfreezeTrack } from './freezeBounce/unfreezeTrack';
export { flattenTrack } from './freezeBounce/flattenTrack';
export { cleanupUnusedFreezeFiles } from './freezeBounce/cleanupUnusedFreezeFiles';
export { bounceInPlace, bounceToNewTrack, bounceSelection } from './freezeBounce/bounceOperations';
export type { BounceOptions } from './freezeBounce/bounceOperations';
export { setTrackInput } from './setTrackInput';
export { exportMidiClip } from './exportMidiClip';
export { importMidiFile } from './importMidiFile';
export { importAudioFile } from './importAudioFile';

export { setTrackGain } from './setTrackGainPan/setTrackGain';
export { setTrackPan } from './setTrackGainPan/setTrackPan';
export { setTrackColor } from './setTrackGainPan/setTrackColor';
export { setTrackNotes } from './setTrackGainPan/setTrackNotes';
export { setInputMonitoring } from './setTrackGainPan/setInputMonitoring';

// ── Clip ─────────────────────────────────────────────────────────────────────

export { addClip } from './clip/addClip';
export { removeClip } from './clip/removeClip';
export { moveClip } from './clip/moveClip';
export { duplicateClip } from './clip/duplicateClip';
export { duplicateClipToNextBar } from './clip/duplicateClipToNextBar';
export { acceptGhostClip } from './clip/acceptGhostClip';
export { dismissGhostClip } from './clip/dismissGhostClip';
export { updateClip } from './updateClip';
export { getNextClipId } from './getNextClipId';
export { replaceClipAudioBuffer } from './replaceClipAudioBuffer';

// ── Clip Editing ──────────────────────────────────────────────────────────────

export { createAlternativeClips, type VariationNote } from './clipEditing/createAlternativeClips';
export { normalizeClip } from './clipEditing/normalizeClip';
export { renameClip } from './clipEditing/renameClip';
export { reverseClip } from './clipEditing/reverseClip';
export { setClipColor } from './clipEditing/setClipColor';
export { setClipFade } from './clipEditing/setClipFade';
export { setClipFollowAction } from './clipEditing/setClipFollowAction';
export { setClipGain } from './clipEditing/setClipGain';
export { splitClip } from './clipEditing/splitClip';
export { trimClipEnd } from './clipEditing/trimClipEnd';
export { trimClipStart } from './clipEditing/trimClipStart';
export { toggleInlineEditing } from './clipEditing/toggleInlineEditing';
export { resetOverride } from './clipEditing/resetOverride';
export { getGrooveOffsetAtBeat } from './groove/applyGrooveTemplate';
export { deleteTimeRange } from './clipEditing/deleteTimeRange';
export { crossfadeClips } from './clipEditing/crossfadeClips';
export { glueClips } from './clipEditing/glueClips';
export { lockClip } from './clipEditing/lockClip';
export { muteClip } from './clipEditing/muteClip';
export { nudgeClip } from './clipEditing/nudgeClip';
export { slipClipContent } from './clipEditing/slipClipContent';

export { setClipLoop } from './clipLoop/setClipLoop';
export { setClipLoopLength } from './clipLoop/setClipLoopLength';

// ── Clip Gain Envelope ────────────────────────────────────────────────────────

export { addGainEnvelopePoint } from './clipGainEnvelope/addGainEnvelopePoint';
export { getClipGainEnvelope } from './clipGainEnvelope/getClipGainEnvelope';
export { getGainAtBeat } from './clipGainEnvelope/getGainAtBeat';
export { removeGainEnvelopePoint } from './clipGainEnvelope/removeGainEnvelopePoint';
export { resetClipGainEnvelope } from './clipGainEnvelope/resetClipGainEnvelope';
export { toggleClipGainEnvelope } from './clipGainEnvelope/toggleClipGainEnvelope';

// ── Clipboard ─────────────────────────────────────────────────────────────────

export { copySelectedClip } from './clipboard/copySelectedClip';
export { copySelectedNotes } from './clipboard/copySelectedNotes';
export { cutSelectedClip } from './clipboard/cutSelectedClip';
export { pasteClip } from './clipboard/pasteClip';
export { pasteNotes } from './clipboard/pasteNotes';

// ── Comping ───────────────────────────────────────────────────────────────────

export { addTake } from './comping/addTake';
export { addTakeLane } from './comping/addTakeLane';
export { flattenComp } from './comping/flattenComp';
export { selectTake } from './comping/selectTake';
export { setCompRegion } from './comping/setCompRegion';
export { removeCompRegion } from './comping/removeCompRegion';
export { resolveClipsWithComping } from './resolveComping';
export type { ResolvedClip } from './resolveComping';

export { createCompGroup } from './groupComping/compGroupOperations/createCompGroup';

// ── Adjustment Layer ──────────────────────────────────────────────────────────

export { createAdjustmentLayer } from './adjustmentLayer/createAdjustmentLayer';
export { removeAdjustmentLayer } from './adjustmentLayer/removeAdjustmentLayer';
export { toggleAdjustmentLayer } from './adjustmentLayer/toggleAdjustmentLayer';
export { setLayerParameter } from './adjustmentLayer/setLayerParameter';
export { setLayerMix } from './adjustmentLayer/setLayerMix';
export { addAdjustmentRegion } from './adjustmentLayer/addAdjustmentRegion';
export { removeAdjustmentRegion } from './adjustmentLayer/removeAdjustmentRegion';
export { moveAdjustmentRegion } from './adjustmentLayer/moveAdjustmentRegion';
export { setLayerFades } from './adjustmentLayer/setLayerFades';
export { setLayerAffectedTracks } from './adjustmentLayer/setLayerAffectedTracks';
export { setLayerInsertionIndex } from './adjustmentLayer/setLayerInsertionIndex';
export { getActiveLayersAtBeat } from './adjustmentLayer/getActiveLayersAtBeat';
export { getLayerCount } from './adjustmentLayer/getLayerCount';

// ── Device ────────────────────────────────────────────────────────────────────

export { addDevice } from './device/addDevice';
export { addMidiFx } from './device/addMidiFx';
export { removeMidiFx } from './device/removeMidiFx';
export { bypassMidiFx } from './device/bypassMidiFx';
export { updateMidiFxParam } from './device/updateMidiFxParam';
export { addExternalDevice } from './device/addExternalDevice';
export { bypassDevice } from './device/bypassDevice';
export { removeDevice } from './device/removeDevice';
export { reorderDevices } from './device/reorderDevices';
export { setSend } from './device/sendManagement/setSend';
export { toggleSendPreFader } from './device/sendManagement/toggleSendPreFader';
export { removeSend } from './device/sendManagement/removeSend';
export { setDeviceParameter } from './device/setDeviceParameter/setDeviceParameter';
export { persistDeviceParam } from './device/setDeviceParameter/persistDeviceParam';
export { persistDevicePatch } from './device/setDeviceParameter/persistDevicePatch';

export { deleteTime } from './timeOperations/deleteTime';
export { insertTime, duplicateTimeRange } from './timeOperations/duplicateTimeRange';

export { addMarker } from './marker/markerOperations/addMarker';
export { removeMarker } from './marker/markerOperations/removeMarker';
export { renameMarker } from './marker/markerOperations/renameMarker';
export { setMarkerColor } from './marker/markerOperations/setMarkerColor';
export { moveMarker } from './marker/markerOperations/moveMarker';
export { addSection } from './marker/sectionOperations/addSection';
export { removeSection } from './marker/sectionOperations/removeSection';
export { renameSection } from './marker/sectionOperations/renameSection';
export { setSectionColor } from './marker/sectionOperations/setSectionColor';
export { moveSection } from './marker/sectionOperations/moveSection';
export { resizeSection } from './marker/sectionOperations/resizeSection';
export { reorderSection } from './marker/sectionOperations/reorderSection';

export { mixerSnapshotStore } from './mixerSnapshot/operations/helpers';
export { saveMixerSnapshot } from './mixerSnapshot/operations/saveMixerSnapshot';
export { recallMixerSnapshot } from './mixerSnapshot/operations/recallMixerSnapshot';
export { restoreMixerChannels } from './mixerSnapshot/operations/restoreMixerChannels';
export { getMixerSnapshots } from './mixerSnapshot/operations/getMixerSnapshots';
export { deleteMixerSnapshot } from './mixerSnapshot/operations/deleteMixerSnapshot';
export { renameMixerSnapshot } from './mixerSnapshot/operations/renameMixerSnapshot';

// ── Preset ────────────────────────────────────────────────────────────────────

export { createTrackFromPreset, loadPresetToTrack } from './preset/presetLoading';
export { getUserPresets } from './preset/presetStorage/getUserPresets';
export { saveUserPreset, saveCurrentAsPreset } from './preset/presetStorage/saveCurrentAsPreset';
export { deleteUserPreset } from './preset/presetStorage/deleteUserPreset';
export type { SaveCurrentAsPresetInput } from './preset/presetStorage/saveCurrentAsPreset';

export { armTrack } from './recording/armTrack';
export { startRecording } from './recording/startRecording';
export { stopRecording } from './recording/stopRecording';

export { captureArrangementToScratchPad } from './scratchPad/captureCommit/captureArrangementToScratchPad';
export { commitScratchPadToArrangement } from './scratchPad/captureCommit/commitScratchPadToArrangement';
export { addScratchPadSection } from './scratchPad/scratchPadCrud/addScratchPadSection';
export { removeScratchPadSection } from './scratchPad/scratchPadCrud/removeScratchPadSection';
export { renameScratchPadSection } from './scratchPad/scratchPadCrud/renameScratchPadSection';
export { setScratchPadSectionColor } from './scratchPad/scratchPadCrud/setScratchPadSectionColor';
export { clearScratchPad } from './scratchPad/scratchPadCrud/clearScratchPad';
export { reorderScratchPadSection } from './scratchPad/scratchPadCrud/reorderScratchPadSection';
export type { ScratchPadSection } from './scratchPad/scratchPadCrud/helpers';

// ── Toggle Track State ────────────────────────────────────────────────────────

export { clearSolos } from './toggleTrackState/clearSolos';
export { groupTracks } from './toggleTrackState/groupTracks';
export { muteTrack } from './toggleTrackState/muteTrack';
export { selectTrack } from './toggleTrackState/selectTrack';
export { setAutomationMode } from './toggleTrackState/setAutomationMode';
export { setTrackOutput } from './toggleTrackState/setTrackOutput';
export { soloTrack } from './toggleTrackState/soloTrack';
export { soloTrackExclusive } from './toggleTrackState/soloTrackExclusive';
export { toggleChordTrackFollow } from './toggleTrackState/toggleChordTrackFollow';
export { toggleInputMonitoring } from './toggleTrackState/toggleInputMonitoring';
export { toggleSoloSafe } from './toggleTrackState/toggleSoloSafe';
export { toggleVariationLanes } from './toggleTrackState/toggleVariationLanes';

// ── Track View / Zoom ─────────────────────────────────────────────────────────

export { zoomTracksVertical } from './trackZoom';

// ── Track Template ────────────────────────────────────────────────────────────

export { saveTrackAsTemplate, loadTrackTemplate, getTrackTemplates, deleteTrackTemplate } from './trackTemplate';

// ── VCA ───────────────────────────────────────────────────────────────────────

export { assignToVca } from './vca/assignToVca';
export { createAndAssignVcaGroup } from './vca/createAndAssignVcaGroup';
export { createVcaGroup } from './vca/createVcaGroup';
export { getEffectiveGain } from './vca/getEffectiveGain';
export { getVcaGroups } from './vca/getVcaGroups';
export { removeFromVca } from './vca/removeFromVca';
export { setVcaGain } from './vca/setVcaGain';
export { toggleVcaMembership } from './vca/toggleVcaMembership';

export { createVCAGroup } from './vcaFader/createVCAGroup';
export { assignTrackToVCA } from './vcaFader/assignTrackToVCA';
export { removeTrackFromVCA } from './vcaFader/removeTrackFromVCA';
export { getAllVCAGroups } from './vcaFader/getAllVCAGroups';
export type { VCAGroup } from './vcaFader/helpers';

export { getWarpState } from './warp/helpers';
export { enableWarp } from './warp/enableWarp';
export { disableWarp } from './warp/disableWarp';
export { setStretchMode } from './warp/setStretchMode';
export { addWarpMarker } from './warp/addWarpMarker';
export { removeWarpMarker } from './warp/removeWarpMarker';
export { moveWarpMarker } from './warp/moveWarpMarker';

export { detectTempo } from './audioAnalysis/detectTempo';
export { detectKey } from './audioAnalysis/detectKey';
export { audioToMidi } from './audioAnalysis/audioToMidi';
export { getBufferForClip } from './audioAnalysis/helpers';
export { interpolateAutomationValue } from './automationQueries/interpolateAutomationValue';
export { rdpSimplify } from './automationQueries/rdpSimplify';
export { getAutomationRegions } from './automationQueries/getAutomationRegions';
export { generateShapePoints } from './automationQueries/generateShapePoints';
export { applyVelocityCurve } from './automationQueries/applyVelocityCurve';
export type { VelocityCurve } from './automationQueries/helpers';
export { getMarkerState } from './timelineQueries';
export type { MarkerStoreState as TimelineMarkerStoreState } from './timelineQueries';
export { detectSongStructure, detectAndApplySongStructure } from './songStructureDetection';
export { getFactoryPresets } from './soundPresetLibrary';
export type { GetFactoryPresetsOutput } from './soundPresetLibrary';
export { stripSilence } from './stripSilence';
export { getBuiltinPlugins } from './getBuiltinPlugins';
export { getPlatformPlugins } from './getPlatformPlugins';
export { getPluginById } from './getPluginById';
export { isDeviceSupportedOnCurrentPlatform } from './isDeviceSupportedOnCurrentPlatform';

// ── Command handler access ────────────────────────────────────────────────────

export { getArrangementHandlers } from './getArrangementHandlers';
export { initStalenessDetection } from './freezeBounce/initStalenessDetection';
