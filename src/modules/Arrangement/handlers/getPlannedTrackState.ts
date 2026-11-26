import { type AppAction, type AppActionType, type HandlerValidationContext } from '#/utils/handlerContract';

import { type Track } from '../models/Track';
import { decodeTrackSnapshot } from '../stores/trackStore';
import { getTrackStoreState } from '../useCases/getTrackStoreState';

import { planDefaultTrackName } from './planDefaultTrackName';
import { createPlannedDuplicate, createPlannedTrack } from './plannedTrackConstruction';
import { projectTrackThroughPriorBatchActions } from './projectTrackThroughPriorBatchActions';
import { ensureStableCreationInputs, pinCreationIdentity } from './track/pinTrackCreationInputs';

type ActionOf<Type extends AppActionType> = Extract<AppAction, { type: Type }>;

function noPlannedTrack(): null {
    return null;
}

function planAddedTrack(
    action: ActionOf<'addTrack'>,
    context: HandlerValidationContext,
    actionIndex: number,
    trackId: string
): Track | null {
    if (action.payload.id !== trackId || action.payload.kind === 'master') {
        return null;
    }
    ensureStableCreationInputs(action);
    const identity = pinCreationIdentity(action.payload);
    return projectTrackThroughPriorBatchActions(
        createPlannedTrack({
            id: trackId,
            name:
                action.payload.name ??
                planDefaultTrackName(action.payload.kind, { actions: context.actions, actionIndex }),
            kind: action.payload.kind,
            gain: 0.8,
            ...identity,
            initialDeviceId: action.payload.initialDeviceId,
            parentId: action.payload.parentId,
            outputId: action.payload.outputId,
            withoutDefaultDevice: action.payload.withoutDefaultDevice,
        }),
        context,
        actionIndex + 1
    );
}

function planCreatedBus(
    action: ActionOf<'createBus'>,
    context: HandlerValidationContext,
    actionIndex: number,
    trackId: string
): Track | null {
    if (action.payload.busId !== trackId) {
        return null;
    }
    const identity = pinCreationIdentity(action.payload);
    return projectTrackThroughPriorBatchActions(
        createPlannedTrack({
            id: trackId,
            name: action.payload.name,
            kind: 'bus',
            gain: action.payload.initialGain ?? 0.8,
            ...identity,
        }),
        context,
        actionIndex + 1
    );
}

function planCreatedFolder(
    action: ActionOf<'createFolder'>,
    context: HandlerValidationContext,
    actionIndex: number,
    trackId: string
): Track | null {
    if (action.payload.folderTrackId !== trackId) {
        return null;
    }
    return projectTrackThroughPriorBatchActions(
        createPlannedTrack({
            id: trackId,
            name: action.payload.name,
            kind: 'folder',
            gain: 0.8,
            ...pinCreationIdentity(action.payload),
        }),
        context,
        actionIndex + 1
    );
}

function planDuplicatedTrack(
    action: ActionOf<'duplicateTrack'>,
    context: HandlerValidationContext,
    actionIndex: number,
    trackId: string
): Track | null {
    if (action.payload.targetTrackId !== trackId) {
        return null;
    }
    // The copy starts as the source stands when the duplicate runs, so the source is read through the actions before it.
    const source = getPlannedTrackState({ ...context, actionIndex }, action.payload.trackId);
    if (source === null) {
        return null;
    }
    const copy = createPlannedDuplicate(source, trackId);
    return copy === null ? null : projectTrackThroughPriorBatchActions(copy, context, actionIndex + 1);
}

function planRestoredTrack(
    action: ActionOf<'restoreTrack'>,
    context: HandlerValidationContext,
    actionIndex: number,
    trackId: string
): Track | null {
    if (action.payload.trackId !== trackId) {
        return null;
    }
    const restored = decodeTrackSnapshot(action.payload.trackSnapshot);
    return restored === null ? null : projectTrackThroughPriorBatchActions(restored, context, actionIndex + 1);
}

// Every action type states whether it creates the planned track: a new action does not compile until it does.
export const plannedTrackByActionType: {
    readonly [Type in AppActionType]: (
        action: ActionOf<Type>,
        context: HandlerValidationContext,
        actionIndex: number,
        trackId: string
    ) => Track | null;
} = {
    importStemSet: noPlannedTrack,
    discardImportedStemSet: noPlannedTrack,
    addTrack: planAddedTrack,
    removeTrack: noPlannedTrack,
    discardCreatedTrack: noPlannedTrack,
    restoreTrack: planRestoredTrack,
    restoreClip: noPlannedTrack,
    discardDuplicatedClip: noPlannedTrack,
    removeAllTracks: noPlannedTrack,
    renameTrack: noPlannedTrack,
    createTrackAlternative: noPlannedTrack,
    switchTrackAlternative: noPlannedTrack,
    renameTrackAlternative: noPlannedTrack,
    deleteTrackAlternative: noPlannedTrack,
    selectTrack: noPlannedTrack,
    muteTrack: noPlannedTrack,
    soloTrack: noPlannedTrack,
    selectTake: noPlannedTrack,
    replaceOriginalMidiTakeRow: noPlannedTrack,
    replaceOriginalMidiBaseRow: noPlannedTrack,
    toggleSoloSafe: noPlannedTrack,
    setSoloSafe: noPlannedTrack,
    restoreSoloSafe: noPlannedTrack,
    armTrack: noPlannedTrack,
    freezeTrack: noPlannedTrack,
    unfreezeTrack: noPlannedTrack,
    restoreFreezeState: noPlannedTrack,
    flattenTrack: noPlannedTrack,
    bounceInPlace: noPlannedTrack,
    reorderTrack: noPlannedTrack,
    setTempo: noPlannedTrack,
    restoreTempoEdit: noPlannedTrack,
    editTempoMap: noPlannedTrack,
    restoreTempoMapEdit: noPlannedTrack,
    setTimeSignature: noPlannedTrack,
    setPlayback: noPlannedTrack,
    togglePlayback: noPlannedTrack,
    stopPlayback: noPlannedTrack,
    toggleRecording: noPlannedTrack,
    setMasterGain: noPlannedTrack,
    restoreMasterGain: noPlannedTrack,
    toggleLoop: noPlannedTrack,
    toggleMetronome: noPlannedTrack,
    setMetronomeVolume: noPlannedTrack,
    setLoopRegion: noPlannedTrack,
    setLoopEnabled: noPlannedTrack,
    setMetronomeEnabled: noPlannedTrack,
    restoreLoopRegion: noPlannedTrack,
    addClip: noPlannedTrack,
    moveClip: noPlannedTrack,
    restoreClipPlacement: noPlannedTrack,
    duplicateClip: noPlannedTrack,
    duplicateClipToNextBar: noPlannedTrack,
    duplicateTrack: planDuplicatedTrack,
    removeClip: noPlannedTrack,
    renameClip: noPlannedTrack,
    splitClip: noPlannedTrack,
    restoreClipSplitState: noPlannedTrack,
    trimClipStart: noPlannedTrack,
    trimClipEnd: noPlannedTrack,
    restoreAudioClipStartTrim: noPlannedTrack,
    restoreAudioClipSlip: noPlannedTrack,
    slipClipContent: noPlannedTrack,
    drawClip: noPlannedTrack,
    discardDrawnClip: noPlannedTrack,
    restoreDrawnClip: noPlannedTrack,
    duplicateClipAt: noPlannedTrack,
    moveClips: noPlannedTrack,
    restoreClipMoves: noPlannedTrack,
    addDevice: noPlannedTrack,
    bypassDevice: noPlannedTrack,
    removeDevice: noPlannedTrack,
    restoreDevice: noPlannedTrack,
    reorderDevices: noPlannedTrack,
    setDeviceParameter: noPlannedTrack,
    setExternalPluginState: noPlannedTrack,
    setDeviceState: noPlannedTrack,
    setFermenterPatch: noPlannedTrack,
    setLevainIdentity: noPlannedTrack,
    setGrandBouleDeviceState: noPlannedTrack,
    setToasterFactoryKit: noPlannedTrack,
    setBacteriaFactoryPatch: noPlannedTrack,
    setCrustFactoryPreset: noPlannedTrack,
    setGlutenFactoryPreset: noPlannedTrack,
    setProofPatchSelection: noPlannedTrack,
    createBus: planCreatedBus,
    createFolder: planCreatedFolder,
    setSend: noPlannedTrack,
    setWorkspaceMode: noPlannedTrack,
    openPreferencesDialog: noPlannedTrack,
    openMixer: noPlannedTrack,
    closeMixer: noPlannedTrack,
    toggleSidebar: noPlannedTrack,
    toggleInspector: noPlannedTrack,
    toggleChatPanel: noPlannedTrack,
    setTrackInput: noPlannedTrack,
    restoreTrackInput: noPlannedTrack,
    setEditingTool: noPlannedTrack,
    setMarqueeSelection: noPlannedTrack,
    addMarker: noPlannedTrack,
    removeMarker: noPlannedTrack,
    setMarkerColor: noPlannedTrack,
    addSection: noPlannedTrack,
    removeSection: noPlannedTrack,
    renameSection: noPlannedTrack,
    renameMarker: noPlannedTrack,
    moveMarker: noPlannedTrack,
    moveSection: noPlannedTrack,
    resizeSection: noPlannedTrack,
    setSectionColor: noPlannedTrack,
    reorderSection: noPlannedTrack,
    navigateSection: noPlannedTrack,
    rehearseSection: noPlannedTrack,
    restoreSectionBeats: noPlannedTrack,
    setClipGainEnvelope: noPlannedTrack,
    toggleClipGainEnvelope: noPlannedTrack,
    addGainEnvelopePoint: noPlannedTrack,
    removeGainEnvelopePoint: noPlannedTrack,
    resetClipGainEnvelope: noPlannedTrack,
    addModulator: noPlannedTrack,
    removeModulator: noPlannedTrack,
    updateModulator: noPlannedTrack,
    addMapping: noPlannedTrack,
    removeMapping: noPlannedTrack,
    addAutomationLane: noPlannedTrack,
    automateSendRange: noPlannedTrack,
    automateSendRanges: noPlannedTrack,
    removeSendAutomationRanges: noPlannedTrack,
    renderProjectSections: noPlannedTrack,
    removeRenderedProjectSections: noPlannedTrack,
    automateTrackGainRange: noPlannedTrack,
    automateParameterRange: noPlannedTrack,
    removeTrackGainAutomationRange: noPlannedTrack,
    removeSendAutomationRange: noPlannedTrack,
    removeAutomationLane: noPlannedTrack,
    setAutomationLaneEnabled: noPlannedTrack,
    addAutomationPoint: noPlannedTrack,
    insertAutomationLanePoints: noPlannedTrack,
    quantizeNotes: noPlannedTrack,
    removeShortMidiOverlaps: noPlannedTrack,
    createDrumPreviewBranches: noPlannedTrack,
    deleteDrumPreviewBranches: noPlannedTrack,
    copyMidiArticulations: noPlannedTrack,
    restoreMidiClipNotes: noPlannedTrack,
    quantizeNoteLengths: noPlannedTrack,
    transposeNotes: noPlannedTrack,
    humanizeNotes: noPlannedTrack,
    invertNotes: noPlannedTrack,
    retrogradeNotes: noPlannedTrack,
    scaleVelocities: noPlannedTrack,
    scaleAllVelocities: noPlannedTrack,
    setAllVelocities: noPlannedTrack,
    setTrackGain: noPlannedTrack,
    setTrackPan: noPlannedTrack,
    setTrackColor: noPlannedTrack,
    copyClip: noPlannedTrack,
    cutClip: noPlannedTrack,
    pasteClip: noPlannedTrack,
    setClipFade: noPlannedTrack,
    importMidiFile: noPlannedTrack,
    normalizeClip: noPlannedTrack,
    relinkClipAudioSources: noPlannedTrack,
    reverseClip: noPlannedTrack,
    restoreReversedClip: noPlannedTrack,
    glueClips: noPlannedTrack,
    restoreClipGlueState: noPlannedTrack,
    setCompRegion: noPlannedTrack,
    removeCompRegion: noPlannedTrack,
    restoreCompRegionInterval: noPlannedTrack,
    nudgeClip: noPlannedTrack,
    crossfadeClips: noPlannedTrack,
    restoreCrossfadeClips: noPlannedTrack,
    setClipGain: noPlannedTrack,
    setClipColor: noPlannedTrack,
    lockClip: noPlannedTrack,
    consolidateSelection: noPlannedTrack,
    bounceSelection: noPlannedTrack,
    seekPlayhead: noPlannedTrack,
    setPunchIn: noPlannedTrack,
    setPunchOut: noPlannedTrack,
    setPunchEnabled: noPlannedTrack,
    restorePunchRegion: noPlannedTrack,
    togglePunch: noPlannedTrack,
    toggleCountIn: noPlannedTrack,
    setCountInBars: noPlannedTrack,
    togglePreRoll: noPlannedTrack,
    setPreRollBars: noPlannedTrack,
    zoomTracksVertical: noPlannedTrack,
    addTimeSignatureChange: noPlannedTrack,
    removeTimeSignatureChange: noPlannedTrack,
    setTrackOutput: noPlannedTrack,
    addSend: noPlannedTrack,
    removeSend: noPlannedTrack,
    removeAutomationPoint: noPlannedTrack,
    setAutomationMode: noPlannedTrack,
    hideTrack: noPlannedTrack,
    disableTrack: noPlannedTrack,
    restoreTrackDisabled: noPlannedTrack,
    setTrackHeight: noPlannedTrack,
    setSnapValue: noPlannedTrack,
    zoomToFit: noPlannedTrack,
    zoomToSelection: noPlannedTrack,
    exportProject: noPlannedTrack,
    saveProject: noPlannedTrack,
    newProject: noPlannedTrack,
    importAudioFile: noPlannedTrack,
    exportMidi: noPlannedTrack,
    foldTrack: noPlannedTrack,
    groupTracks: noPlannedTrack,
    ungroupTracks: noPlannedTrack,
    scaleAutomation: noPlannedTrack,
    stretchAutomation: noPlannedTrack,
    invertAutomation: noPlannedTrack,
    reverseAutomation: noPlannedTrack,
    thinAutomation: noPlannedTrack,
    quantizeAutomation: noPlannedTrack,
    restoreAutomationLanePoints: noPlannedTrack,
    restoreAutomationPointPresence: noPlannedTrack,
    loadPreset: noPlannedTrack,
    restorePresetDeviceChain: noPlannedTrack,
    savePreset: noPlannedTrack,
    generateDrumPattern: noPlannedTrack,
    generateMelody: noPlannedTrack,
    generateChordProgression: noPlannedTrack,
    setClipLoop: noPlannedTrack,
    restoreClipLoop: noPlannedTrack,
    setClipLoopLength: noPlannedTrack,
    restoreClipLoopLength: noPlannedTrack,
    createGrooveTemplate: noPlannedTrack,
    renameGrooveTemplate: noPlannedTrack,
    restoreGrooveTemplateName: noPlannedTrack,
    deleteGrooveTemplate: noPlannedTrack,
    restoreDeletedGrooveTemplate: noPlannedTrack,
    assignGrooveTemplate: noPlannedTrack,
    restoreGrooveAssignment: noPlannedTrack,
    extractGroove: noPlannedTrack,
    applyGroove: noPlannedTrack,
    setClipStretchMode: noPlannedTrack,
    setClipStretchRatio: noPlannedTrack,
    restoreClipStretchState: noPlannedTrack,
    fitClipToBeats: noPlannedTrack,
    analyzeMix: noPlannedTrack,
    autoFixMix: noPlannedTrack,
    enableMpe: noPlannedTrack,
    disableMpe: noPlannedTrack,
    getLatencyReport: noPlannedTrack,
    createCollabSession: noPlannedTrack,
    joinCollabSession: noPlannedTrack,
    leaveCollabSession: noPlannedTrack,
    scanPlugins: noPlannedTrack,
    loadExternalPlugin: noPlannedTrack,
    audioToMidi: noPlannedTrack,
    commitPitchEdit: noPlannedTrack,
    restoreClipFileId: noPlannedTrack,
    muteClip: noPlannedTrack,
    clearSolos: noPlannedTrack,
    restoreTrackSoloStates: noPlannedTrack,
    setTrackNotes: noPlannedTrack,
    deleteTime: noPlannedTrack,
    insertTime: noPlannedTrack,
    duplicateTimeRange: noPlannedTrack,
    restoreTimeOperationState: noPlannedTrack,
    restoreTrackHeights: noPlannedTrack,
    restoreTrackGroupMemberships: noPlannedTrack,
    restoreTracks: noPlannedTrack,
    restoreTrackClipStates: noPlannedTrack,
    discardCreatedTracks: noPlannedTrack,
    discardCreatedCompGroup: noPlannedTrack,
    restoreTrackAlternativeState: noPlannedTrack,
    restoreScratchPadState: noPlannedTrack,
    stripSilence: noPlannedTrack,
    restoreStripSilenceState: noPlannedTrack,
    detectTempo: noPlannedTrack,
    detectKey: noPlannedTrack,
    consolidateAllTracks: noPlannedTrack,
    arpeggiate: noPlannedTrack,
    addSidechainRoute: noPlannedTrack,
    removeSidechainRoute: noPlannedTrack,
    bounceToNewTrack: noPlannedTrack,
    saveTrackTemplate: noPlannedTrack,
    loadTrackTemplate: noPlannedTrack,
    deleteTrackTemplate: noPlannedTrack,
    createProjectFromTemplate: noPlannedTrack,
    setProductionBrief: noPlannedTrack,
    repairProjectData: noPlannedTrack,
    createVcaGroup: noPlannedTrack,
    assignToVca: noPlannedTrack,
    removeFromVca: noPlannedTrack,
    setVcaGain: noPlannedTrack,
    restoreLegacyVcaState: noPlannedTrack,
    setMidiOutput: noPlannedTrack,
    clearMidiOutput: noPlannedTrack,
    restoreMidiOutput: noPlannedTrack,
    addNotes: noPlannedTrack,
    completeMidi: noPlannedTrack,
    variationMidi: noPlannedTrack,
    generateBassline: noPlannedTrack,
    replayGeneratedMidi: noPlannedTrack,
    stemSeparate: noPlannedTrack,
    autoOrganizeProject: noPlannedTrack,
    addChordEvent: noPlannedTrack,
    moveChordEvent: noPlannedTrack,
    updateChordEvent: noPlannedTrack,
    removeChordEvent: noPlannedTrack,
    toggleChordTrack: noPlannedTrack,
    clearChordTrack: noPlannedTrack,
    restoreChordTrackState: noPlannedTrack,
    clearAllMidiMappings: noPlannedTrack,
    completeMidiLearn: noPlannedTrack,
    removeMidiMapping: noPlannedTrack,
    restoreMidiLearnMappings: noPlannedTrack,
    toggleScratchPad: noPlannedTrack,
    captureScratchPad: noPlannedTrack,
    commitScratchPad: noPlannedTrack,
    clearScratchPad: noPlannedTrack,
    removeScratchPadSection: noPlannedTrack,
    renameScratchPadSection: noPlannedTrack,
    reorderScratchPadSection: noPlannedTrack,
    setScratchPadSectionColor: noPlannedTrack,
    createPatternInstance: noPlannedTrack,
    detachPatternInstance: noPlannedTrack,
    restorePatternInstanceLink: noPlannedTrack,
    startMacroRecording: noPlannedTrack,
    stopMacroRecording: noPlannedTrack,
    playMacro: noPlannedTrack,
    deleteMacro: noPlannedTrack,
    renameMacro: noPlannedTrack,
    undo: noPlannedTrack,
    redo: noPlannedTrack,
    toggleUndoTree: noPlannedTrack,
    labelUndoBranch: noPlannedTrack,
    detectSongStructure: noPlannedTrack,
    createProjectVersion: noPlannedTrack,
    restoreProjectVersion: noPlannedTrack,
    createVersionBranch: noPlannedTrack,
    generateFill: noPlannedTrack,
    generateAllTransitions: noPlannedTrack,
    compareToReference: noPlannedTrack,
    toggleControlRoomMono: noPlannedTrack,
    toggleControlRoomDim: noPlannedTrack,
    switchMonitor: noPlannedTrack,
    getMentorTips: noPlannedTrack,
    searchSamples: noPlannedTrack,
    createCompGroup: noPlannedTrack,
    togglePunchRecording: noPlannedTrack,
    toggleLoopRecord: noPlannedTrack,
    triggerScene: noPlannedTrack,
    nextSetlistItem: noPlannedTrack,
    previousSetlistItem: noPlannedTrack,
    createAdjustmentLayer: noPlannedTrack,
    removeAdjustmentLayer: noPlannedTrack,
    toggleAdjustmentLayer: noPlannedTrack,
    setLayerParameter: noPlannedTrack,
    setLayerMix: noPlannedTrack,
    addAdjustmentRegion: noPlannedTrack,
    removeAdjustmentRegion: noPlannedTrack,
    moveAdjustmentRegion: noPlannedTrack,
    setLayerFades: noPlannedTrack,
    setLayerAffectedTracks: noPlannedTrack,
    setLayerInsertionIndex: noPlannedTrack,
    restoreAdjustmentLayerMutation: noPlannedTrack,
    detectTransients: noPlannedTrack,
    quantizeTransients: noPlannedTrack,
    openElasticEditor: noPlannedTrack,
    closeElasticEditor: noPlannedTrack,
    elasticSetSensitivity: noPlannedTrack,
    elasticAddMarker: noPlannedTrack,
    elasticRemoveMarker: noPlannedTrack,
    elasticToggleMarkerLock: noPlannedTrack,
    elasticSetTool: noPlannedTrack,
    toggleNodeView: noPlannedTrack,
    setControlSurface: noPlannedTrack,
    addCvOutput: noPlannedTrack,
    removeCvOutput: noPlannedTrack,
    connectPush: noPlannedTrack,
    disconnectPush: noPlannedTrack,
    exportDawProject: noPlannedTrack,
    importDawProject: noPlannedTrack,
    loadRaveModel: noPlannedTrack,
    setRaveBlend: noPlannedTrack,
    enableWarping: noPlannedTrack,
    setWarpAlgorithm: noPlannedTrack,
    setWarpPitchShift: noPlannedTrack,
    setYeastProcessorParam: noPlannedTrack,
    setYeastArpPattern: noPlannedTrack,
    setYeastProcessorBypass: noPlannedTrack,
    addYeastProcessor: noPlannedTrack,
    removeYeastProcessor: noPlannedTrack,
    reorderYeastProcessor: noPlannedTrack,
    commitRecording: noPlannedTrack,
    discardRecording: noPlannedTrack,
    restoreRecording: noPlannedTrack,
    appendOverdubControllers: noPlannedTrack,
    removeOverdubControllers: noPlannedTrack,
};

function lookup<Type extends AppActionType>(
    action: ActionOf<Type>,
    context: HandlerValidationContext,
    actionIndex: number,
    trackId: string
): Track | null {
    if (!Object.hasOwn(plannedTrackByActionType, action.type)) {
        return null;
    }
    return plannedTrackByActionType[action.type](action, context, actionIndex, trackId);
}

/**
 * The track as the earlier actions of the batch leave it. The earlier actions are read in order: a
 * removal makes the track no track, and a later creator or restore plans it again.
 */
export function getPlannedTrackState(context: HandlerValidationContext, trackId: string): Track | null {
    let present = getTrackStoreState()?.tracks.some((track) => track.id === trackId) ?? false;
    let planned: Track | null = null;
    for (const [actionIndex, action] of context.actions.slice(0, context.actionIndex).entries()) {
        if (action.type === 'removeTrack' && action.payload.trackId === trackId) {
            present = false;
            planned = null;
            continue;
        }
        const created = lookup(action, context, actionIndex, trackId);
        if (created) {
            present = true;
            planned = created;
        }
    }
    if (planned) {
        return planned;
    }
    const current = present ? getTrackStoreState()?.tracks.find((track) => track.id === trackId) : undefined;
    return current ? projectTrackThroughPriorBatchActions(current, context) : null;
}
