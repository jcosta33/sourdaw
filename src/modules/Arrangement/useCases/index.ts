// Arrangement/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

// ── Track ────────────────────────────────────────────────────────────────────

export { addTrack } from './addTrack';
export { createTrack } from './createTrack';
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
export { setTrackInput } from './setTrackInput';
export { exportMidiClip } from './exportMidiClip';
export { importMidiFile } from './importMidiFile';
export { importAudioFile } from './importAudioFile';

export {
    setTrackGain,
    setTrackPan,
    setTrackColor,
    setTrackNotes,
    setInputMonitoring,
} from './setTrackGainPan';

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

export { createAlternativeClips } from './clipEditing/createAlternativeClips';
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
export { crossfadeClips } from './clipEditing/crossfadeClips';
export { glueClips } from './clipEditing/glueClips';
export { lockClip } from './clipEditing/lockClip';
export { muteClip } from './clipEditing/muteClip';
export { nudgeClip } from './clipEditing/nudgeClip';

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
export { resolveClipsWithComping } from './resolveComping';
export type { ResolvedClip } from './resolveComping';

export { createCompGroup } from './groupComping/compGroupOperations';

// ── Adjustment Layer ──────────────────────────────────────────────────────────

export { createAdjustmentLayer } from './adjustmentLayer/createAdjustmentLayer';

// ── Device ────────────────────────────────────────────────────────────────────

export { addDevice } from './device/addDevice';
export { addExternalDevice } from './device/addExternalDevice';
export { bypassDevice } from './device/bypassDevice';
export { removeDevice } from './device/removeDevice';
export { reorderDevices } from './device/reorderDevices';
export { setSend, toggleSendPreFader, removeSend } from './device/sendManagement';
export { setDeviceParameter, persistDeviceParam } from './device/setDeviceParameter';

// ── Freeze / Bounce ───────────────────────────────────────────────────────────

export { freezeTrack, unfreezeTrack } from './freezeBounce/freezeTrack';
export { bounceSelection } from './freezeBounce/bounceOperations';

export { deleteTime } from './timeOperations/deleteTime';
export { insertTime, duplicateTimeRange } from './timeOperations/duplicateTimeRange';

// ── Marker ────────────────────────────────────────────────────────────────────

export { addMarker, removeMarker, renameMarker, setMarkerColor, moveMarker } from './marker/markerOperations';
export {
    addSection,
    removeSection,
    renameSection,
    setSectionColor,
    moveSection,
    resizeSection,
    reorderSection,
} from './marker/sectionOperations';

// ── Mixer Snapshot ────────────────────────────────────────────────────────────

export {
    mixerSnapshotStore,
    saveMixerSnapshot,
    recallMixerSnapshot,
    restoreMixerChannels,
    getMixerSnapshots,
    deleteMixerSnapshot,
    renameMixerSnapshot,
} from './mixerSnapshot/operations';

// ── Preset ────────────────────────────────────────────────────────────────────

export { createTrackFromPreset, loadPresetToTrack } from './preset/presetLoading';
export {
    getUserPresets,
    saveUserPreset,
    deleteUserPreset,
    saveCurrentAsPreset,
} from './preset/presetStorage';
export type { SaveCurrentAsPresetInput } from './preset/presetStorage';

// ── Recording ─────────────────────────────────────────────────────────────────

export { armTrack, startRecording, stopRecording } from './recording';

// ── Scratch Pad ───────────────────────────────────────────────────────────────

export { captureArrangementToScratchPad, commitScratchPadToArrangement } from './scratchPad/captureCommit';
export {
    addScratchPadSection,
    removeScratchPadSection,
    renameScratchPadSection,
    setScratchPadSectionColor,
    clearScratchPad,
    reorderScratchPadSection,
} from './scratchPad/scratchPadCrud';
export type { ScratchPadSection } from './scratchPad/scratchPadCrud';

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

// ── Track View / Zoom ─────────────────────────────────────────────────────────

export { zoomTracksVertical } from './trackZoom';

// ── Track Template ────────────────────────────────────────────────────────────

export {
    saveTrackAsTemplate,
    loadTrackTemplate,
    getTrackTemplates,
    deleteTrackTemplate,
} from './trackTemplate';

// ── VCA ───────────────────────────────────────────────────────────────────────

export { assignToVca } from './vca/assignToVca';
export { createAndAssignVcaGroup } from './vca/createAndAssignVcaGroup';
export { createVcaGroup } from './vca/createVcaGroup';
export { getEffectiveGain } from './vca/getEffectiveGain';
export { getVcaGroups } from './vca/getVcaGroups';
export { removeFromVca } from './vca/removeFromVca';
export { setVcaGain } from './vca/setVcaGain';
export { toggleVcaMembership } from './vca/toggleVcaMembership';

export {
    createVCAGroup,
    assignTrackToVCA,
    removeTrackFromVCA,
    getAllVCAGroups,
} from './vcaFader';
export type { VCAGroup } from './vcaFader';

// ── Warp ──────────────────────────────────────────────────────────────────────

export {
    getWarpState,
    enableWarp,
    disableWarp,
    setStretchMode,
    addWarpMarker,
    removeWarpMarker,
    moveWarpMarker,
} from './warp';

// ── Analysis / Queries ────────────────────────────────────────────────────────

export { detectTempo, detectKey, audioToMidi } from './audioAnalysis';
export {
    interpolateAutomationValue,
    rdpSimplify,
    getAutomationRegions,
    generateShapePoints,
    applyVelocityCurve,
} from './automationQueries';
export type { VelocityCurve } from './automationQueries';
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
