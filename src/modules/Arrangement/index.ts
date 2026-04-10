// ── Views ──────────────────────────────────────────────────────────────────

export { ArrangementBar } from './presentations/views/ArrangementBar';
export { BeatRulerBar } from './presentations/views/BeatRulerBar';
export { MarkerLane } from './presentations/views/MarkerLane';
export { MidiLearnButton } from './presentations/views/MidiLearnButton';
export { TimelineChromeSurface } from './presentations/views/TimelineChromeSurface';
export { TimelineMinimap } from './presentations/views/TimelineMinimap';
export { TimelineSurface } from './presentations/views/TimelineSurface';
export { TrackListView } from './presentations/views/TrackListView';

// ── Stores ─────────────────────────────────────────────────────────────────

export { chordTrackStore } from './stores/chordTrackStore';
export type { ChordTrackState } from './stores/chordTrackStore';

export { markerStore } from './stores/markerStore';
export type { MarkerStoreState } from './stores/markerStore';

export { scratchPadStore } from './stores/scratchPadStore';
export type { ScratchPadStoreState } from './stores/scratchPadStore';

export { takeLaneStore } from './stores/takeLaneStore';
export type { TakeLaneStoreState } from './stores/takeLaneStore';

export {
    timelineViewStore,
    zoomTimeline,
    scrollTimeline,
    setScrollX,
    setAutoScroll,
    toggleAutoScroll,
    setScrollY,
} from './stores/timelineViewStore';
export type { TimelineViewState } from './stores/timelineViewStore';

export { trackStore, defaultTrackState } from './stores/trackStore';
export type { TrackStoreState } from './stores/trackStore';

// ── UseCases: Track ────────────────────────────────────────────────────────

export { addTrack } from './useCases/addTrack';
export { createTrack } from './useCases/createTrack';
export { removeTrack } from './useCases/removeTrack';
export { renameTrack } from './useCases/renameTrack';
export { duplicateTrack } from './useCases/duplicateTrack';
export { updateTrack } from './useCases/updateTrack';
export { getAllTracks } from './useCases/getAllTracks';
export { getTrackById } from './useCases/getTrackById';
export { getTrackStoreState } from './useCases/getTrackStoreState';
export { setTrackState } from './useCases/setTrackState';
export { setTrackStoreState } from './useCases/setTrackStoreState';
export { setTrackInput } from './useCases/setTrackInput';
export { exportMidiClip } from './useCases/exportMidiClip';
export { importMidiFile } from './useCases/importMidiFile';
export { importAudioFile } from './useCases/importAudioFile';

export {
    setTrackGain,
    setTrackPan,
    setTrackColor,
    setTrackNotes,
    setInputMonitoring,
} from './useCases/setTrackGainPan';

// ── UseCases: Clip ─────────────────────────────────────────────────────────

export { addClip } from './useCases/clip/addClip';
export { removeClip } from './useCases/clip/removeClip';
export { moveClip } from './useCases/clip/moveClip';
export { duplicateClip } from './useCases/clip/duplicateClip';
export { duplicateClipToNextBar } from './useCases/clip/duplicateClipToNextBar';
export { acceptGhostClip } from './useCases/clip/acceptGhostClip';
export { dismissGhostClip } from './useCases/clip/dismissGhostClip';
export { updateClip } from './useCases/updateClip';
export { getNextClipId } from './useCases/getNextClipId';
export { replaceClipAudioBuffer } from './useCases/replaceClipAudioBuffer';

// ── UseCases: Clip Editing ─────────────────────────────────────────────────

export { createAlternativeClips } from './useCases/clipEditing/createAlternativeClips';
export { normalizeClip } from './useCases/clipEditing/normalizeClip';
export { renameClip } from './useCases/clipEditing/renameClip';
export { reverseClip } from './useCases/clipEditing/reverseClip';
export { setClipColor } from './useCases/clipEditing/setClipColor';
export { setClipFade } from './useCases/clipEditing/setClipFade';
export { setClipFollowAction } from './useCases/clipEditing/setClipFollowAction';
export { setClipGain } from './useCases/clipEditing/setClipGain';
export { splitClip } from './useCases/clipEditing/splitClip';
export { trimClipEnd } from './useCases/clipEditing/trimClipEnd';
export { trimClipStart } from './useCases/clipEditing/trimClipStart';
export { crossfadeClips } from './useCases/clipEditing/crossfadeClips';
export { glueClips } from './useCases/clipEditing/glueClips';
export { lockClip } from './useCases/clipEditing/lockClip';
export { muteClip } from './useCases/clipEditing/muteClip';
export { nudgeClip } from './useCases/clipEditing/nudgeClip';

// ── UseCases: Clip loop ─────────────────────────────────────────────────────

export { setClipLoop, setClipLoopLength } from './useCases/clipLoop';

// ── UseCases: Clip Gain Envelope ───────────────────────────────────────────

export { addGainEnvelopePoint } from './useCases/clipGainEnvelope/addGainEnvelopePoint';
export { getClipGainEnvelope } from './useCases/clipGainEnvelope/getClipGainEnvelope';
export { getGainAtBeat } from './useCases/clipGainEnvelope/getGainAtBeat';
export { removeGainEnvelopePoint } from './useCases/clipGainEnvelope/removeGainEnvelopePoint';
export { resetClipGainEnvelope } from './useCases/clipGainEnvelope/resetClipGainEnvelope';
export { toggleClipGainEnvelope } from './useCases/clipGainEnvelope/toggleClipGainEnvelope';

// ── UseCases: Clipboard ────────────────────────────────────────────────────

export { copySelectedClip } from './useCases/clipboard/copySelectedClip';
export { copySelectedNotes } from './useCases/clipboard/copySelectedNotes';
export { cutSelectedClip } from './useCases/clipboard/cutSelectedClip';
export { pasteClip } from './useCases/clipboard/pasteClip';
export { pasteNotes } from './useCases/clipboard/pasteNotes';

// ── UseCases: Comping ──────────────────────────────────────────────────────

export { addTake } from './useCases/comping/addTake';
export { addTakeLane } from './useCases/comping/addTakeLane';
export { flattenComp } from './useCases/comping/flattenComp';
export { selectTake } from './useCases/comping/selectTake';
export { setCompRegion } from './useCases/comping/setCompRegion';
export { resolveClipsWithComping } from './useCases/resolveComping';
export type { ResolvedClip } from './useCases/resolveComping';

export { createCompGroup } from './useCases/groupComping/compGroupOperations';

// ── UseCases: Adjustment layer ─────────────────────────────────────────────

export { createAdjustmentLayer } from './useCases/adjustmentLayer/createAdjustmentLayer';
export type { AdjustmentEffectType } from './stores/adjustmentLayer';

// ── UseCases: Device ───────────────────────────────────────────────────────

export { addDevice } from './useCases/device/addDevice';
export { addExternalDevice } from './useCases/device/addExternalDevice';
export { bypassDevice } from './useCases/device/bypassDevice';
export { removeDevice } from './useCases/device/removeDevice';
export { reorderDevices } from './useCases/device/reorderDevices';
export { setSend, toggleSendPreFader, removeSend } from './useCases/device/sendManagement';
export { setDeviceParameter, persistDeviceParam } from './useCases/device/setDeviceParameter';

// ── UseCases: Freeze / Bounce ──────────────────────────────────────────────

export { freezeTrack, unfreezeTrack } from './useCases/freezeBounce/freezeTrack';
export { bounceSelection } from './useCases/freezeBounce/bounceOperations';

// ── UseCases: Time operations ──────────────────────────────────────────────

export { deleteTime, insertTime, duplicateTimeRange } from './useCases/timeOperations';

// ── UseCases: Marker ───────────────────────────────────────────────────────

export { addMarker, removeMarker, renameMarker, setMarkerColor, moveMarker } from './useCases/marker/markerOperations';
export {
    addSection,
    removeSection,
    renameSection,
    setSectionColor,
    moveSection,
    resizeSection,
    reorderSection,
} from './useCases/marker/sectionOperations';

// ── UseCases: Mixer Snapshot ───────────────────────────────────────────────

export {
    mixerSnapshotStore,
    saveMixerSnapshot,
    recallMixerSnapshot,
    restoreMixerChannels,
    getMixerSnapshots,
    deleteMixerSnapshot,
    renameMixerSnapshot,
} from './useCases/mixerSnapshot/operations';

// ── UseCases: Preset ───────────────────────────────────────────────────────

export { createTrackFromPreset, loadPresetToTrack } from './useCases/preset/presetLoading';
export {
    getUserPresets,
    saveUserPreset,
    deleteUserPreset,
    saveCurrentAsPreset,
} from './useCases/preset/presetStorage';
export type { SaveCurrentAsPresetInput } from './useCases/preset/presetStorage';

// ── UseCases: Recording ────────────────────────────────────────────────────

export { armTrack, startRecording, stopRecording } from './useCases/recording';

// ── UseCases: Scratch Pad ──────────────────────────────────────────────────

export { captureArrangementToScratchPad, commitScratchPadToArrangement } from './useCases/scratchPad/captureCommit';
export {
    addScratchPadSection,
    removeScratchPadSection,
    renameScratchPadSection,
    setScratchPadSectionColor,
    clearScratchPad,
    reorderScratchPadSection,
} from './useCases/scratchPad/scratchPadCrud';
export type { ScratchPadSection } from './useCases/scratchPad/scratchPadCrud';

// ── UseCases: Toggle Track State ───────────────────────────────────────────

export { clearSolos } from './useCases/toggleTrackState/clearSolos';
export { groupTracks } from './useCases/toggleTrackState/groupTracks';
export { muteTrack } from './useCases/toggleTrackState/muteTrack';
export { selectTrack } from './useCases/toggleTrackState/selectTrack';
export { setAutomationMode } from './useCases/toggleTrackState/setAutomationMode';
export { setTrackOutput } from './useCases/toggleTrackState/setTrackOutput';
export { soloTrack } from './useCases/toggleTrackState/soloTrack';
export { soloTrackExclusive } from './useCases/toggleTrackState/soloTrackExclusive';
export { toggleChordTrackFollow } from './useCases/toggleTrackState/toggleChordTrackFollow';
export { toggleInputMonitoring } from './useCases/toggleTrackState/toggleInputMonitoring';
export { toggleSoloSafe } from './useCases/toggleTrackState/toggleSoloSafe';

// ── UseCases: Track View / Zoom ────────────────────────────────────────────

export { zoomTracksVertical } from './useCases/trackZoom';

// ── UseCases: Track Template ───────────────────────────────────────────────

export {
    saveTrackAsTemplate,
    loadTrackTemplate,
    getTrackTemplates,
    deleteTrackTemplate,
} from './useCases/trackTemplate';

// ── UseCases: VCA ──────────────────────────────────────────────────────────

export { assignToVca } from './useCases/vca/assignToVca';
export { createAndAssignVcaGroup } from './useCases/vca/createAndAssignVcaGroup';
export { createVcaGroup } from './useCases/vca/createVcaGroup';
export { getEffectiveGain } from './useCases/vca/getEffectiveGain';
export { getVcaGroups } from './useCases/vca/getVcaGroups';
export { removeFromVca } from './useCases/vca/removeFromVca';
export { setVcaGain } from './useCases/vca/setVcaGain';
export { toggleVcaMembership } from './useCases/vca/toggleVcaMembership';

export {
    createVCAGroup,
    assignTrackToVCA,
    removeTrackFromVCA,
    getAllVCAGroups,
} from './useCases/vcaFader';
export type { VCAGroup } from './useCases/vcaFader';

// ── UseCases: Warp ─────────────────────────────────────────────────────────

export {
    getWarpState,
    enableWarp,
    disableWarp,
    setStretchMode,
    addWarpMarker,
    removeWarpMarker,
    moveWarpMarker,
} from './useCases/warp';

// ── UseCases: Analysis / Queries ───────────────────────────────────────────

export { detectTempo, detectKey, audioToMidi } from './useCases/audioAnalysis';
export {
    interpolateAutomationValue,
    rdpSimplify,
    getAutomationRegions,
    generateShapePoints,
    applyVelocityCurve,
} from './useCases/automationQueries';
export type { VelocityCurve } from './useCases/automationQueries';
export { getMarkerState } from './useCases/timelineQueries';
export type { MarkerStoreState as TimelineMarkerStoreState } from './useCases/timelineQueries';
export { detectSongStructure, detectAndApplySongStructure } from './useCases/songStructureDetection';
export { getFactoryPresets } from './useCases/soundPresetLibrary';
export type { GetFactoryPresetsOutput } from './useCases/soundPresetLibrary';
export { stripSilence } from './useCases/stripSilence';
export { getBuiltinPlugins } from './useCases/getBuiltinPlugins';
export { getPlatformPlugins } from './useCases/getPlatformPlugins';
export { getPluginById } from './useCases/getPluginById';
export { isDeviceSupportedOnCurrentPlatform } from './useCases/isDeviceSupportedOnCurrentPlatform';

// ── UseCases: Command handler access (handler maps are non-contract — see AGENTS.md) ─

export { getArrangementHandlers } from './useCases/getArrangementHandlers';
