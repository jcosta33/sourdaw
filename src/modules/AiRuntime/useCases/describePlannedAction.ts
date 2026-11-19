import { markerStore } from '#/modules/Arrangement/stores';
import { describeAction } from '#/modules/Command/useCases';
import { type AppAction, type AppActionType } from '#/utils/handlerContract';
import { resolveMarkerColorName } from '#/utils/markerColorPalette';

import { type ProjectContext } from '../models/ProjectContext';
import { findContextClip } from '../transformers/findContextClip';

import { describeAddedDevice } from './plannedActionDescriptions/describeAddedDevice';
import { describeArpeggio } from './plannedActionDescriptions/describeArpeggio';
import { describeClipLoopLength } from './plannedActionDescriptions/describeClipLoopLength';
import { describeCopiedArticulations } from './plannedActionDescriptions/describeCopiedArticulations';
import { describeDrumPreviewBranches } from './plannedActionDescriptions/describeDrumPreviewBranches';
import { describeGluedClips } from './plannedActionDescriptions/describeGluedClips';
import { describeMidiNoteEdit } from './plannedActionDescriptions/describeMidiNoteEdit';
import { describeMovedClip } from './plannedActionDescriptions/describeMovedClip';
import { describeNormalizedClip } from './plannedActionDescriptions/describeNormalizedClip';
import { describeParameterRange } from './plannedActionDescriptions/describeParameterRange';
import { describePunchEdge } from './plannedActionDescriptions/describePunchEdge';
import { describePunchEnabled } from './plannedActionDescriptions/describePunchEnabled';
import { describeSendRange } from './plannedActionDescriptions/describeSendRange';
import { describeShortOverlapRemoval } from './plannedActionDescriptions/describeShortOverlapRemoval';
import { describeSidechainRoute } from './plannedActionDescriptions/describeSidechainRoute';
import { describeTrackGain } from './plannedActionDescriptions/describeTrackGain';

type DescribePlannedActionInput = {
    action: AppAction;
    context: ProjectContext;
};

type ActionOf<Type extends AppActionType> = Extract<AppAction, { type: Type }>;

type ContextClip = NonNullable<ReturnType<typeof findContextClip>>;

/** What the action registry says about an action no planned-action reading words more exactly. */
function describeFromRegistry(action: AppAction): string {
    return describeAction(action);
}

function describeOnClip(
    action: AppAction,
    clipId: string,
    context: ProjectContext,
    describe: (clip: ContextClip) => string
): string {
    const clip = findContextClip(context, clipId);
    return clip ? describe(clip) : describeAction(action);
}

function describeClipTarget(context: ProjectContext, clipId: string): string {
    const clip = findContextClip(context, clipId);
    return clip ? ` clip "${clip.name}"` : ' clip';
}

function formatSigned(value: number): string {
    if (value > 0) {
        return `+${String(value)}`;
    }
    return String(value);
}

function describeTrackPan(action: ActionOf<'setTrackPan'>, context: ProjectContext): string {
    const track = context.tracks.find((candidate) => candidate.id === action.payload.trackId);
    if (!track) {
        return describeAction(action);
    }
    return `Set track "${track.name}" (${track.id}) pan to ${formatSigned(action.payload.pan)}`;
}

function describeMutedTrack(action: ActionOf<'muteTrack'>, context: ProjectContext): string {
    const track = context.tracks.find((candidate) => candidate.id === action.payload.trackId);
    if (!track) {
        return describeAction(action);
    }
    const verb = action.payload.muted ? 'Mute' : 'Unmute';
    return `${verb} track "${track.name}" (${track.id}) (muted=${String(action.payload.muted)})`;
}

function describeRemovedTrack(action: ActionOf<'removeTrack'>, context: ProjectContext): string {
    const track = context.tracks.find((candidate) => candidate.id === action.payload.trackId);
    return track ? `Remove track "${track.name}"` : describeAction(action);
}

function describeRemovedClip(action: ActionOf<'removeClip'>, context: ProjectContext): string {
    return describeOnClip(action, action.payload.clipId, context, (clip) => `Remove clip "${clip.name}"`);
}

function describeRemovedMarker(action: ActionOf<'removeMarker'>): string {
    const marker = markerStore.value?.markers.find((candidate) => candidate.id === action.payload.markerId);
    if (!marker) {
        return describeAction(action);
    }
    return `Remove marker "${marker.name}" at beat ${String(marker.beat)} (${marker.id})`;
}

function describeMarkerColor(action: ActionOf<'setMarkerColor'>): string {
    const marker = markerStore.value?.markers.find((candidate) => candidate.id === action.payload.markerId);
    if (!marker) {
        return describeAction(action);
    }
    const color = resolveMarkerColorName(action.payload.color) ?? action.payload.color;
    return `Set marker "${marker.name}" at beat ${String(marker.beat)} (${marker.id}) color to ${color}`;
}

function describeRemovedSection(action: ActionOf<'removeSection'>): string {
    const section = markerStore.value?.sections.find((candidate) => candidate.id === action.payload.sectionId);
    if (!section) {
        return describeAction(action);
    }
    return `Remove section "${section.name}" from beat ${String(section.startBeat)} to beat ${String(section.endBeat)} (${section.id})`;
}

function describeRenamedSection(action: ActionOf<'renameSection'>): string {
    const section = markerStore.value?.sections.find((candidate) => candidate.id === action.payload.sectionId);
    if (!section) {
        return describeAction(action);
    }
    return `Rename section "${section.name}" to "${action.payload.name}" from beat ${String(section.startBeat)} to beat ${String(section.endBeat)} (${section.id})`;
}

type PlannedActionDescriber<Type extends AppActionType> = (action: ActionOf<Type>, context: ProjectContext) => string;

// Every action type states how it is described: a new action does not compile until it does.
const describerByActionType: { readonly [Type in AppActionType]: PlannedActionDescriber<Type> } = {
    importStemSet: describeFromRegistry,
    discardImportedStemSet: describeFromRegistry,
    addTrack: describeFromRegistry,
    removeTrack: describeRemovedTrack,
    discardCreatedTrack: describeFromRegistry,
    restoreTrack: describeFromRegistry,
    restoreClip: describeFromRegistry,
    discardDuplicatedClip: describeFromRegistry,
    removeAllTracks: describeFromRegistry,
    renameTrack: describeFromRegistry,
    createTrackAlternative: describeFromRegistry,
    switchTrackAlternative: describeFromRegistry,
    renameTrackAlternative: describeFromRegistry,
    deleteTrackAlternative: describeFromRegistry,
    selectTrack: describeFromRegistry,
    muteTrack: describeMutedTrack,
    soloTrack: describeFromRegistry,
    selectTake: describeFromRegistry,
    replaceOriginalMidiTakeRow: describeFromRegistry,
    replaceOriginalMidiBaseRow: describeFromRegistry,
    toggleSoloSafe: describeFromRegistry,
    setSoloSafe: describeFromRegistry,
    restoreSoloSafe: describeFromRegistry,
    armTrack: describeFromRegistry,
    freezeTrack: describeFromRegistry,
    unfreezeTrack: describeFromRegistry,
    restoreFreezeState: describeFromRegistry,
    flattenTrack: describeFromRegistry,
    bounceInPlace: describeFromRegistry,
    reorderTrack: describeFromRegistry,
    setTempo: describeFromRegistry,
    restoreTempoEdit: describeFromRegistry,
    editTempoMap: describeFromRegistry,
    restoreTempoMapEdit: describeFromRegistry,
    setTimeSignature: describeFromRegistry,
    setPlayback: describeFromRegistry,
    togglePlayback: describeFromRegistry,
    stopPlayback: describeFromRegistry,
    toggleRecording: describeFromRegistry,
    setMasterGain: describeFromRegistry,
    restoreMasterGain: describeFromRegistry,
    toggleLoop: describeFromRegistry,
    toggleMetronome: describeFromRegistry,
    setMetronomeVolume: describeFromRegistry,
    setLoopRegion: describeFromRegistry,
    setLoopEnabled: describeFromRegistry,
    setMetronomeEnabled: describeFromRegistry,
    restoreLoopRegion: describeFromRegistry,
    addClip: describeFromRegistry,
    moveClip: describeMovedClip,
    restoreClipPlacement: describeFromRegistry,
    duplicateClip: describeFromRegistry,
    duplicateClipToNextBar: describeFromRegistry,
    duplicateTrack: describeFromRegistry,
    removeClip: describeRemovedClip,
    renameClip: describeFromRegistry,
    splitClip: describeFromRegistry,
    restoreClipSplitState: describeFromRegistry,
    trimClipStart: describeFromRegistry,
    trimClipEnd: describeFromRegistry,
    restoreAudioClipStartTrim: describeFromRegistry,
    restoreAudioClipSlip: describeFromRegistry,
    slipClipContent: describeFromRegistry,
    drawClip: describeFromRegistry,
    discardDrawnClip: describeFromRegistry,
    restoreDrawnClip: describeFromRegistry,
    duplicateClipAt: describeFromRegistry,
    moveClips: describeFromRegistry,
    restoreClipMoves: describeFromRegistry,
    addDevice: (action, context) => describeAddedDevice(action, context) ?? describeAction(action),
    bypassDevice: describeFromRegistry,
    removeDevice: describeFromRegistry,
    restoreDevice: describeFromRegistry,
    reorderDevices: describeFromRegistry,
    setDeviceParameter: describeFromRegistry,
    setExternalPluginState: describeFromRegistry,
    setDeviceState: describeFromRegistry,
    setFermenterPatch: describeFromRegistry,
    setGrandBouleDeviceState: describeFromRegistry,
    createBus: describeFromRegistry,
    createFolder: describeFromRegistry,
    setSend: describeFromRegistry,
    setWorkspaceMode: describeFromRegistry,
    openPreferencesDialog: describeFromRegistry,
    openMixer: describeFromRegistry,
    closeMixer: describeFromRegistry,
    toggleSidebar: describeFromRegistry,
    toggleInspector: describeFromRegistry,
    toggleChatPanel: describeFromRegistry,
    setTrackInput: describeFromRegistry,
    restoreTrackInput: describeFromRegistry,
    setEditingTool: describeFromRegistry,
    setMarqueeSelection: describeFromRegistry,
    addMarker: describeFromRegistry,
    removeMarker: describeRemovedMarker,
    setMarkerColor: describeMarkerColor,
    addSection: (action) =>
        `Add section "${action.payload.name}" from beat ${String(action.payload.startBeat)} to beat ${String(action.payload.endBeat)}`,
    removeSection: describeRemovedSection,
    renameSection: describeRenamedSection,
    renameMarker: describeFromRegistry,
    moveMarker: describeFromRegistry,
    moveSection: describeFromRegistry,
    resizeSection: describeFromRegistry,
    setSectionColor: describeFromRegistry,
    reorderSection: describeFromRegistry,
    navigateSection: describeFromRegistry,
    rehearseSection: describeFromRegistry,
    restoreSectionBeats: describeFromRegistry,
    setClipGainEnvelope: describeFromRegistry,
    toggleClipGainEnvelope: describeFromRegistry,
    addGainEnvelopePoint: describeFromRegistry,
    removeGainEnvelopePoint: describeFromRegistry,
    resetClipGainEnvelope: describeFromRegistry,
    addModulator: describeFromRegistry,
    removeModulator: describeFromRegistry,
    updateModulator: describeFromRegistry,
    addMapping: describeFromRegistry,
    removeMapping: describeFromRegistry,
    addAutomationLane: describeFromRegistry,
    automateSendRange: describeSendRange,
    automateSendRanges: describeFromRegistry,
    removeSendAutomationRanges: describeFromRegistry,
    renderProjectSections: describeFromRegistry,
    removeRenderedProjectSections: describeFromRegistry,
    automateTrackGainRange: describeFromRegistry,
    automateParameterRange: describeParameterRange,
    removeTrackGainAutomationRange: describeFromRegistry,
    removeSendAutomationRange: describeFromRegistry,
    removeAutomationLane: describeFromRegistry,
    setAutomationLaneEnabled: describeFromRegistry,
    addAutomationPoint: describeFromRegistry,
    insertAutomationLanePoints: describeFromRegistry,
    quantizeNotes: (action, context) =>
        describeOnClip(
            action,
            action.payload.clipId,
            context,
            (clip) => `Quantize notes in "${clip.name}" (${clip.id}) to a ${String(action.payload.gridSize)}-beat grid`
        ),
    editMidiNotes: describeMidiNoteEdit,
    removeShortMidiOverlaps: (action) => describeShortOverlapRemoval(action) ?? describeAction(action),
    createDrumPreviewBranches: describeDrumPreviewBranches,
    deleteDrumPreviewBranches: describeFromRegistry,
    copyMidiArticulations: (action, context) => describeCopiedArticulations(action, context) ?? describeAction(action),
    restoreMidiClipNotes: describeFromRegistry,
    quantizeNoteLengths: (action, context) =>
        describeOnClip(
            action,
            action.payload.clipId,
            context,
            (clip) =>
                `Quantize note lengths in "${clip.name}" (${clip.id}) to a ${String(action.payload.gridSize)}-beat grid`
        ),
    transposeNotes: (action, context) =>
        describeOnClip(
            action,
            action.payload.clipId,
            context,
            (clip) =>
                `Transpose notes in "${clip.name}" (${clip.id}) by ${formatSigned(action.payload.semitones)} semitones`
        ),
    humanizeNotes: describeFromRegistry,
    invertNotes: (action, context) =>
        describeOnClip(action, action.payload.clipId, context, (clip) => `Invert notes in "${clip.name}" (${clip.id})`),
    retrogradeNotes: (action, context) =>
        describeOnClip(
            action,
            action.payload.clipId,
            context,
            (clip) => `Retrograde notes in "${clip.name}" (${clip.id})`
        ),
    scaleVelocities: describeFromRegistry,
    scaleAllVelocities: (action, context) =>
        describeOnClip(
            action,
            action.payload.clipId,
            context,
            (clip) => `Scale note velocities in "${clip.name}" (${clip.id}) by ×${String(action.payload.factor)}`
        ),
    setAllVelocities: (action, context) =>
        describeOnClip(
            action,
            action.payload.clipId,
            context,
            (clip) => `Set note velocities in "${clip.name}" (${clip.id}) to ${String(action.payload.velocity)}`
        ),
    setTrackGain: (action, context) => describeTrackGain(action, context) ?? describeAction(action),
    setTrackPan: describeTrackPan,
    setTrackColor: describeFromRegistry,
    copyClip: describeFromRegistry,
    cutClip: describeFromRegistry,
    pasteClip: describeFromRegistry,
    setClipFade: describeFromRegistry,
    importMidiFile: describeFromRegistry,
    normalizeClip: describeNormalizedClip,
    reverseClip: describeFromRegistry,
    restoreReversedClip: describeFromRegistry,
    glueClips: describeGluedClips,
    restoreClipGlueState: describeFromRegistry,
    setCompRegion: describeFromRegistry,
    removeCompRegion: describeFromRegistry,
    restoreCompRegionInterval: describeFromRegistry,
    nudgeClip: describeFromRegistry,
    crossfadeClips: describeFromRegistry,
    restoreCrossfadeClips: describeFromRegistry,
    setClipGain: describeFromRegistry,
    setClipColor: describeFromRegistry,
    lockClip: describeFromRegistry,
    consolidateSelection: describeFromRegistry,
    bounceSelection: describeFromRegistry,
    seekPlayhead: describeFromRegistry,
    setPunchIn: (action, context) => describePunchEdge(action, context, 'in') ?? describeAction(action),
    setPunchOut: (action, context) => describePunchEdge(action, context, 'out') ?? describeAction(action),
    setPunchEnabled: describePunchEnabled,
    restorePunchRegion: describeFromRegistry,
    togglePunch: describeFromRegistry,
    toggleCountIn: describeFromRegistry,
    setCountInBars: describeFromRegistry,
    togglePreRoll: describeFromRegistry,
    setPreRollBars: describeFromRegistry,
    zoomTracksVertical: describeFromRegistry,
    addTimeSignatureChange: describeFromRegistry,
    removeTimeSignatureChange: describeFromRegistry,
    setTrackOutput: describeFromRegistry,
    addSend: describeFromRegistry,
    removeSend: describeFromRegistry,
    removeAutomationPoint: describeFromRegistry,
    setAutomationMode: describeFromRegistry,
    hideTrack: describeFromRegistry,
    disableTrack: describeFromRegistry,
    restoreTrackDisabled: describeFromRegistry,
    setTrackHeight: describeFromRegistry,
    setSnapValue: describeFromRegistry,
    zoomToFit: describeFromRegistry,
    zoomToSelection: describeFromRegistry,
    exportProject: describeFromRegistry,
    saveProject: describeFromRegistry,
    newProject: describeFromRegistry,
    importAudioFile: describeFromRegistry,
    exportMidi: describeFromRegistry,
    foldTrack: describeFromRegistry,
    groupTracks: describeFromRegistry,
    ungroupTracks: describeFromRegistry,
    scaleAutomation: describeFromRegistry,
    stretchAutomation: describeFromRegistry,
    invertAutomation: describeFromRegistry,
    reverseAutomation: describeFromRegistry,
    thinAutomation: describeFromRegistry,
    quantizeAutomation: describeFromRegistry,
    restoreAutomationLanePoints: describeFromRegistry,
    restoreAutomationPointPresence: describeFromRegistry,
    loadPreset: describeFromRegistry,
    restorePresetDeviceChain: describeFromRegistry,
    savePreset: describeFromRegistry,
    generateDrumPattern: describeFromRegistry,
    generateMelody: describeFromRegistry,
    generateChordProgression: describeFromRegistry,
    setClipLoop: describeFromRegistry,
    restoreClipLoop: describeFromRegistry,
    setClipLoopLength: (action, context) => describeClipLoopLength(action, context) ?? describeAction(action),
    restoreClipLoopLength: describeFromRegistry,
    createGrooveTemplate: describeFromRegistry,
    renameGrooveTemplate: describeFromRegistry,
    restoreGrooveTemplateName: describeFromRegistry,
    deleteGrooveTemplate: describeFromRegistry,
    restoreDeletedGrooveTemplate: describeFromRegistry,
    assignGrooveTemplate: describeFromRegistry,
    restoreGrooveAssignment: describeFromRegistry,
    extractGroove: describeFromRegistry,
    applyGroove: describeFromRegistry,
    setClipStretchMode: (action, context) =>
        `Set${describeClipTarget(context, action.payload.clipId)} stretch mode to ${action.payload.mode}`,
    setClipStretchRatio: (action, context) =>
        `Set${describeClipTarget(context, action.payload.clipId)} stretch ratio to ${String(action.payload.ratio)}×`,
    restoreClipStretchState: describeFromRegistry,
    fitClipToBeats: (action, context) =>
        `Fit${describeClipTarget(context, action.payload.clipId)} to ${String(action.payload.targetBeats)} beats`,
    analyzeMix: describeFromRegistry,
    autoFixMix: describeFromRegistry,
    enableMpe: describeFromRegistry,
    disableMpe: describeFromRegistry,
    getLatencyReport: describeFromRegistry,
    createCollabSession: describeFromRegistry,
    joinCollabSession: describeFromRegistry,
    leaveCollabSession: describeFromRegistry,
    scanPlugins: describeFromRegistry,
    loadExternalPlugin: describeFromRegistry,
    audioToMidi: describeFromRegistry,
    commitPitchEdit: describeFromRegistry,
    restoreClipFileId: describeFromRegistry,
    muteClip: describeFromRegistry,
    clearSolos: describeFromRegistry,
    restoreTrackSoloStates: describeFromRegistry,
    setTrackNotes: describeFromRegistry,
    deleteTime: describeFromRegistry,
    insertTime: describeFromRegistry,
    duplicateTimeRange: describeFromRegistry,
    restoreTimeOperationState: describeFromRegistry,
    restoreTrackHeights: describeFromRegistry,
    restoreTrackGroupMemberships: describeFromRegistry,
    restoreTracks: describeFromRegistry,
    restoreTrackClipStates: describeFromRegistry,
    discardCreatedTracks: describeFromRegistry,
    discardCreatedCompGroup: describeFromRegistry,
    restoreTrackAlternativeState: describeFromRegistry,
    restoreScratchPadState: describeFromRegistry,
    stripSilence: describeFromRegistry,
    restoreStripSilenceState: describeFromRegistry,
    detectTempo: describeFromRegistry,
    detectKey: describeFromRegistry,
    consolidateAllTracks: describeFromRegistry,
    arpeggiate: (action) => describeArpeggio(action) ?? describeAction(action),
    addSidechainRoute: (action, context) => describeSidechainRoute(action, context, 'Add') ?? describeAction(action),
    removeSidechainRoute: (action, context) =>
        describeSidechainRoute(action, context, 'Remove') ?? describeAction(action),
    bounceToNewTrack: describeFromRegistry,
    saveTrackTemplate: describeFromRegistry,
    loadTrackTemplate: describeFromRegistry,
    deleteTrackTemplate: describeFromRegistry,
    createProjectFromTemplate: describeFromRegistry,
    setProductionBrief: describeFromRegistry,
    repairProjectData: describeFromRegistry,
    createVcaGroup: describeFromRegistry,
    assignToVca: describeFromRegistry,
    removeFromVca: describeFromRegistry,
    setVcaGain: describeFromRegistry,
    restoreLegacyVcaState: describeFromRegistry,
    setMidiOutput: describeFromRegistry,
    clearMidiOutput: describeFromRegistry,
    restoreMidiOutput: describeFromRegistry,
    addNotes: describeFromRegistry,
    completeMidi: describeFromRegistry,
    variationMidi: describeFromRegistry,
    generateBassline: describeFromRegistry,
    replayGeneratedMidi: describeFromRegistry,
    stemSeparate: describeFromRegistry,
    autoOrganizeProject: describeFromRegistry,
    addChordEvent: describeFromRegistry,
    moveChordEvent: describeFromRegistry,
    updateChordEvent: describeFromRegistry,
    removeChordEvent: describeFromRegistry,
    toggleChordTrack: describeFromRegistry,
    clearChordTrack: describeFromRegistry,
    restoreChordTrackState: describeFromRegistry,
    clearAllMidiMappings: describeFromRegistry,
    completeMidiLearn: describeFromRegistry,
    removeMidiMapping: describeFromRegistry,
    restoreMidiLearnMappings: describeFromRegistry,
    toggleScratchPad: describeFromRegistry,
    captureScratchPad: describeFromRegistry,
    commitScratchPad: describeFromRegistry,
    clearScratchPad: describeFromRegistry,
    removeScratchPadSection: describeFromRegistry,
    renameScratchPadSection: describeFromRegistry,
    reorderScratchPadSection: describeFromRegistry,
    setScratchPadSectionColor: describeFromRegistry,
    createPatternInstance: describeFromRegistry,
    detachPatternInstance: describeFromRegistry,
    restorePatternInstanceLink: describeFromRegistry,
    startMacroRecording: describeFromRegistry,
    stopMacroRecording: describeFromRegistry,
    playMacro: describeFromRegistry,
    deleteMacro: describeFromRegistry,
    renameMacro: describeFromRegistry,
    undo: describeFromRegistry,
    redo: describeFromRegistry,
    toggleUndoTree: describeFromRegistry,
    labelUndoBranch: describeFromRegistry,
    detectSongStructure: describeFromRegistry,
    createProjectVersion: describeFromRegistry,
    restoreProjectVersion: describeFromRegistry,
    createVersionBranch: describeFromRegistry,
    generateFill: describeFromRegistry,
    generateAllTransitions: describeFromRegistry,
    compareToReference: describeFromRegistry,
    toggleControlRoomMono: describeFromRegistry,
    toggleControlRoomDim: describeFromRegistry,
    switchMonitor: describeFromRegistry,
    getMentorTips: describeFromRegistry,
    searchSamples: describeFromRegistry,
    createCompGroup: describeFromRegistry,
    togglePunchRecording: describeFromRegistry,
    toggleLoopRecord: describeFromRegistry,
    triggerScene: describeFromRegistry,
    nextSetlistItem: describeFromRegistry,
    previousSetlistItem: describeFromRegistry,
    createAdjustmentLayer: describeFromRegistry,
    removeAdjustmentLayer: describeFromRegistry,
    toggleAdjustmentLayer: describeFromRegistry,
    setLayerParameter: describeFromRegistry,
    setLayerMix: describeFromRegistry,
    addAdjustmentRegion: describeFromRegistry,
    removeAdjustmentRegion: describeFromRegistry,
    moveAdjustmentRegion: describeFromRegistry,
    setLayerFades: describeFromRegistry,
    setLayerAffectedTracks: describeFromRegistry,
    setLayerInsertionIndex: describeFromRegistry,
    restoreAdjustmentLayerMutation: describeFromRegistry,
    detectTransients: describeFromRegistry,
    quantizeTransients: describeFromRegistry,
    openElasticEditor: describeFromRegistry,
    closeElasticEditor: describeFromRegistry,
    elasticSetSensitivity: describeFromRegistry,
    elasticAddMarker: describeFromRegistry,
    elasticRemoveMarker: describeFromRegistry,
    elasticToggleMarkerLock: describeFromRegistry,
    elasticSetTool: describeFromRegistry,
    toggleNodeView: describeFromRegistry,
    setControlSurface: describeFromRegistry,
    addCvOutput: describeFromRegistry,
    removeCvOutput: describeFromRegistry,
    connectPush: describeFromRegistry,
    disconnectPush: describeFromRegistry,
    exportDawProject: describeFromRegistry,
    importDawProject: describeFromRegistry,
    loadRaveModel: describeFromRegistry,
    setRaveBlend: describeFromRegistry,
    enableWarping: describeFromRegistry,
    setWarpAlgorithm: describeFromRegistry,
    setWarpPitchShift: describeFromRegistry,
    setYeastProcessorParam: describeFromRegistry,
    setYeastArpPattern: describeFromRegistry,
    setYeastProcessorBypass: describeFromRegistry,
    addYeastProcessor: describeFromRegistry,
    removeYeastProcessor: describeFromRegistry,
    reorderYeastProcessor: describeFromRegistry,
    commitRecording: describeFromRegistry,
    discardRecording: describeFromRegistry,
    restoreRecording: describeFromRegistry,
    appendOverdubControllers: describeFromRegistry,
    removeOverdubControllers: describeFromRegistry,
};

function lookup<Type extends AppActionType>(action: ActionOf<Type>, context: ProjectContext): string {
    return describerByActionType[action.type](action, context);
}

export function describePlannedAction({ action, context }: DescribePlannedActionInput): string {
    return lookup(action, context);
}
