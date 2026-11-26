import { getAppActionStaticAuthority } from '#/modules/Command/useCases';
import { projectShortMidiOverlapRemoval } from '#/modules/MIDI/useCases';
import { type AppAction, type AppActionType } from '#/utils/handlerContract';

import { getMidiArticulationSemanticChanges } from '../transformers/getMidiArticulationSemanticChanges';

type ActionOf<Type extends AppActionType> = Extract<AppAction, { type: Type }>;

type AffectedIdReaders<Type extends AppActionType> = {
    /** Ids the command names ahead of its static authority. */
    before: (action: ActionOf<Type>) => readonly string[];
    /** Ids the command names after its static authority. */
    after: (action: ActionOf<Type>) => readonly string[];
};

function noIds(): readonly string[] {
    return [];
}

const unaffected = { before: noIds, after: noIds };

function readImportStemSetIds(action: ActionOf<'importStemSet'>): readonly string[] {
    const ids = [action.payload.folderId];
    for (const stem of action.payload.stems) {
        ids.push(stem.trackId, stem.clipId);
    }
    return ids;
}

function readCopyMidiArticulationsTrackIds(action: ActionOf<'copyMidiArticulations'>): readonly string[] {
    return [action.payload.trackId];
}

function readCopyMidiArticulationsNoteIds(action: ActionOf<'copyMidiArticulations'>): readonly string[] {
    const changes = getMidiArticulationSemanticChanges({
        notePairs: action.payload.notePairs,
        sourceNotes: action.payload.expectedSourceNotes,
        targetNotes: action.payload.expectedTargetNotes,
    });
    return (changes ?? []).map((change) => change.targetNoteId);
}

function readRemoveShortMidiOverlapsIds(action: ActionOf<'removeShortMidiOverlaps'>): readonly string[] {
    const ids = [action.payload.expectedTrackId, action.payload.clipId];
    const projected = projectShortMidiOverlapRemoval({
        notes: action.payload.expectedNotes,
        tempo: action.payload.expectedTempo,
        maximumOverlapMs: action.payload.maximumOverlapMs,
    });
    for (const shortened of projected?.shortenedNotes ?? []) {
        ids.push(shortened.noteId);
    }
    return ids;
}

function readArpeggiateIds(action: ActionOf<'arpeggiate'>): readonly string[] {
    if (!action.payload.expectedTrackId || !action.payload.addedNotes) {
        return [];
    }
    return [action.payload.expectedTrackId, action.payload.clipId, ...action.payload.addedNotes.map((note) => note.id)];
}

function readCreateDrumPreviewBranchesIds(action: ActionOf<'createDrumPreviewBranches'>): readonly string[] {
    const ids: string[] = [];
    for (const candidate of action.payload.candidates) {
        ids.push(
            candidate.branchId,
            candidate.rootDocId,
            `${candidate.branchId}:${action.payload.snare.clipId}`,
            `${candidate.branchId}:${action.payload.hiHat.clipId}`
        );
    }
    return ids;
}

function readSetDeviceParameterIds(action: ActionOf<'setDeviceParameter'>): readonly string[] {
    return action.payload.expectedTrackId ? [action.payload.expectedTrackId] : [];
}

// A send level names its bus and a device parameter its device, the
// objects `setSend` and `setDeviceParameter` would name for the same edit.
function readAutomateParameterRangeIds(action: ActionOf<'automateParameterRange'>): readonly string[] {
    const { parameterId } = action.payload;
    const separatorIndex = parameterId.indexOf(':');
    if (separatorIndex <= 0) {
        return [];
    }
    const ownerId = parameterId.slice(0, separatorIndex);
    return [ownerId === 'send' ? parameterId.slice(separatorIndex + 1) : ownerId];
}

function readCreateBusIds(action: ActionOf<'createBus'>): readonly string[] {
    return action.payload.busId ? [action.payload.busId] : [];
}

function readAddDeviceIds(action: ActionOf<'addDevice'>): readonly string[] {
    return action.payload.deviceId ? [action.payload.deviceId] : [];
}

function readAddSidechainRouteIds(action: ActionOf<'addSidechainRoute'>): readonly string[] {
    const ids: string[] = [];
    if (action.payload.targetDeviceId) {
        ids.push(action.payload.targetDeviceId);
    }
    if (action.payload.routeId) {
        ids.push(action.payload.routeId);
    }
    return ids;
}

function readAddAdjustmentRegionIds(action: ActionOf<'addAdjustmentRegion'>): readonly string[] {
    const ids = [action.payload.layerId];
    if (action.payload.regionId) {
        ids.push(action.payload.regionId);
    }
    if (action.payload.targetSection) {
        ids.push(action.payload.targetSection.id);
    }
    for (const track of action.payload.expectedTracks ?? []) {
        ids.push(track.trackId);
    }
    return ids;
}

function readAutomateSendRangeIds(action: ActionOf<'automateSendRange'>): readonly string[] {
    return action.payload.sectionId ? [action.payload.sectionId] : [];
}

function readAutomateTrackGainRangeIds(action: ActionOf<'automateTrackGainRange'>): readonly string[] {
    if (!action.payload.sectionId) {
        return [];
    }
    return [...action.payload.trackIds, action.payload.sectionId];
}

function readSendAutomationRangesIds(
    action: ActionOf<'automateSendRanges'> | ActionOf<'removeSendAutomationRanges'>
): readonly string[] {
    const ids = [action.payload.busId];
    for (const trackId of action.payload.trackIds) {
        ids.push(trackId, `auto-send-${encodeURIComponent(trackId)}-${encodeURIComponent(action.payload.busId)}`);
    }
    ids.push(...action.payload.sectionIds);
    return ids;
}

function readRenderedSectionIds(
    action: ActionOf<'renderProjectSections'> | ActionOf<'removeRenderedProjectSections'>
): readonly string[] {
    const ids = [...action.payload.sectionIds];
    for (const job of action.payload.jobs ?? []) {
        ids.push(job.jobId);
    }
    return ids;
}

// Every action type states which ids it names: a new action does not compile until it does.
const affectedIdsByActionType: { readonly [Type in AppActionType]: AffectedIdReaders<Type> } = {
    importStemSet: { before: readImportStemSetIds, after: noIds },
    discardImportedStemSet: unaffected,
    addTrack: unaffected,
    removeTrack: unaffected,
    discardCreatedTrack: unaffected,
    restoreTrack: unaffected,
    restoreClip: unaffected,
    discardDuplicatedClip: unaffected,
    removeAllTracks: unaffected,
    renameTrack: unaffected,
    createTrackAlternative: unaffected,
    switchTrackAlternative: unaffected,
    renameTrackAlternative: unaffected,
    deleteTrackAlternative: unaffected,
    selectTrack: unaffected,
    muteTrack: unaffected,
    soloTrack: unaffected,
    selectTake: unaffected,
    replaceOriginalMidiTakeRow: unaffected,
    replaceOriginalMidiBaseRow: unaffected,
    toggleSoloSafe: unaffected,
    setSoloSafe: unaffected,
    restoreSoloSafe: unaffected,
    armTrack: unaffected,
    freezeTrack: unaffected,
    unfreezeTrack: unaffected,
    restoreFreezeState: unaffected,
    flattenTrack: unaffected,
    bounceInPlace: unaffected,
    reorderTrack: unaffected,
    setTempo: unaffected,
    restoreTempoEdit: unaffected,
    editTempoMap: unaffected,
    restoreTempoMapEdit: unaffected,
    setTimeSignature: unaffected,
    setPlayback: unaffected,
    togglePlayback: unaffected,
    stopPlayback: unaffected,
    toggleRecording: unaffected,
    setMasterGain: unaffected,
    restoreMasterGain: unaffected,
    toggleLoop: unaffected,
    toggleMetronome: unaffected,
    setMetronomeVolume: unaffected,
    setLoopRegion: unaffected,
    setLoopEnabled: unaffected,
    setMetronomeEnabled: unaffected,
    restoreLoopRegion: unaffected,
    addClip: unaffected,
    moveClip: unaffected,
    restoreClipPlacement: unaffected,
    duplicateClip: unaffected,
    duplicateClipToNextBar: unaffected,
    duplicateTrack: unaffected,
    removeClip: unaffected,
    renameClip: unaffected,
    splitClip: unaffected,
    restoreClipSplitState: unaffected,
    trimClipStart: unaffected,
    trimClipEnd: unaffected,
    restoreAudioClipStartTrim: unaffected,
    restoreAudioClipSlip: unaffected,
    slipClipContent: unaffected,
    drawClip: unaffected,
    discardDrawnClip: unaffected,
    restoreDrawnClip: unaffected,
    duplicateClipAt: unaffected,
    moveClips: unaffected,
    restoreClipMoves: unaffected,
    addDevice: { before: noIds, after: readAddDeviceIds },
    bypassDevice: unaffected,
    removeDevice: unaffected,
    restoreDevice: unaffected,
    reorderDevices: unaffected,
    setDeviceParameter: { before: readSetDeviceParameterIds, after: noIds },
    setExternalPluginState: unaffected,
    setDeviceState: unaffected,
    setFermenterPatch: unaffected,
    setLevainIdentity: unaffected,
    setGrandBouleDeviceState: unaffected,
    setToasterFactoryKit: unaffected,
    setToasterMasterGain: unaffected,
    setBacteriaFactoryPatch: unaffected,
    setCrustFactoryPreset: unaffected,
    setGlutenFactoryPreset: unaffected,
    setProofPatchSelection: unaffected,
    createBus: { before: noIds, after: readCreateBusIds },
    createFolder: unaffected,
    setSend: unaffected,
    setWorkspaceMode: unaffected,
    openPreferencesDialog: unaffected,
    openMixer: unaffected,
    closeMixer: unaffected,
    toggleSidebar: unaffected,
    toggleInspector: unaffected,
    toggleChatPanel: unaffected,
    setTrackInput: unaffected,
    restoreTrackInput: unaffected,
    setEditingTool: unaffected,
    setMarqueeSelection: unaffected,
    addMarker: unaffected,
    removeMarker: unaffected,
    setMarkerColor: unaffected,
    addSection: unaffected,
    removeSection: unaffected,
    renameSection: unaffected,
    renameMarker: unaffected,
    moveMarker: unaffected,
    moveSection: unaffected,
    resizeSection: unaffected,
    setSectionColor: unaffected,
    reorderSection: unaffected,
    navigateSection: unaffected,
    rehearseSection: unaffected,
    restoreSectionBeats: unaffected,
    setClipGainEnvelope: unaffected,
    toggleClipGainEnvelope: unaffected,
    addGainEnvelopePoint: unaffected,
    removeGainEnvelopePoint: unaffected,
    resetClipGainEnvelope: unaffected,
    addModulator: unaffected,
    removeModulator: unaffected,
    updateModulator: unaffected,
    addMapping: unaffected,
    removeMapping: unaffected,
    addAutomationLane: unaffected,
    automateSendRange: { before: noIds, after: readAutomateSendRangeIds },
    automateSendRanges: { before: noIds, after: readSendAutomationRangesIds },
    removeSendAutomationRanges: { before: noIds, after: readSendAutomationRangesIds },
    renderProjectSections: { before: noIds, after: readRenderedSectionIds },
    removeRenderedProjectSections: { before: noIds, after: readRenderedSectionIds },
    automateTrackGainRange: { before: noIds, after: readAutomateTrackGainRangeIds },
    automateParameterRange: { before: readAutomateParameterRangeIds, after: noIds },
    removeTrackGainAutomationRange: unaffected,
    removeSendAutomationRange: unaffected,
    removeAutomationLane: unaffected,
    setAutomationLaneEnabled: unaffected,
    addAutomationPoint: unaffected,
    insertAutomationLanePoints: unaffected,
    quantizeNotes: unaffected,
    removeShortMidiOverlaps: { before: readRemoveShortMidiOverlapsIds, after: noIds },
    createDrumPreviewBranches: { before: readCreateDrumPreviewBranchesIds, after: noIds },
    deleteDrumPreviewBranches: unaffected,
    copyMidiArticulations: { before: readCopyMidiArticulationsTrackIds, after: readCopyMidiArticulationsNoteIds },
    restoreMidiClipNotes: unaffected,
    quantizeNoteLengths: unaffected,
    transposeNotes: unaffected,
    humanizeNotes: unaffected,
    invertNotes: unaffected,
    retrogradeNotes: unaffected,
    scaleVelocities: unaffected,
    scaleAllVelocities: unaffected,
    setAllVelocities: unaffected,
    setTrackGain: unaffected,
    setTrackPan: unaffected,
    setTrackColor: unaffected,
    copyClip: unaffected,
    cutClip: unaffected,
    pasteClip: unaffected,
    setClipFade: unaffected,
    importMidiFile: unaffected,
    normalizeClip: unaffected,
    relinkClipAudioSources: unaffected,
    reverseClip: unaffected,
    restoreReversedClip: unaffected,
    glueClips: unaffected,
    restoreClipGlueState: unaffected,
    setCompRegion: unaffected,
    removeCompRegion: unaffected,
    restoreCompRegionInterval: unaffected,
    nudgeClip: unaffected,
    crossfadeClips: unaffected,
    restoreCrossfadeClips: unaffected,
    setClipGain: unaffected,
    setClipColor: unaffected,
    lockClip: unaffected,
    consolidateSelection: unaffected,
    bounceSelection: unaffected,
    seekPlayhead: unaffected,
    setPunchIn: unaffected,
    setPunchOut: unaffected,
    setPunchEnabled: unaffected,
    restorePunchRegion: unaffected,
    togglePunch: unaffected,
    toggleCountIn: unaffected,
    setCountInBars: unaffected,
    togglePreRoll: unaffected,
    setPreRollBars: unaffected,
    zoomTracksVertical: unaffected,
    addTimeSignatureChange: unaffected,
    removeTimeSignatureChange: unaffected,
    setTrackOutput: unaffected,
    addSend: unaffected,
    removeSend: unaffected,
    removeAutomationPoint: unaffected,
    setAutomationMode: unaffected,
    hideTrack: unaffected,
    disableTrack: unaffected,
    restoreTrackDisabled: unaffected,
    setTrackHeight: unaffected,
    setSnapValue: unaffected,
    zoomToFit: unaffected,
    zoomToSelection: unaffected,
    exportProject: unaffected,
    saveProject: unaffected,
    newProject: unaffected,
    importAudioFile: unaffected,
    exportMidi: unaffected,
    foldTrack: unaffected,
    groupTracks: unaffected,
    ungroupTracks: unaffected,
    scaleAutomation: unaffected,
    stretchAutomation: unaffected,
    invertAutomation: unaffected,
    reverseAutomation: unaffected,
    thinAutomation: unaffected,
    quantizeAutomation: unaffected,
    restoreAutomationLanePoints: unaffected,
    restoreAutomationPointPresence: unaffected,
    loadPreset: unaffected,
    restorePresetDeviceChain: unaffected,
    savePreset: unaffected,
    generateDrumPattern: unaffected,
    generateMelody: unaffected,
    generateChordProgression: unaffected,
    setClipLoop: unaffected,
    restoreClipLoop: unaffected,
    setClipLoopLength: unaffected,
    restoreClipLoopLength: unaffected,
    createGrooveTemplate: unaffected,
    renameGrooveTemplate: unaffected,
    restoreGrooveTemplateName: unaffected,
    deleteGrooveTemplate: unaffected,
    restoreDeletedGrooveTemplate: unaffected,
    assignGrooveTemplate: unaffected,
    restoreGrooveAssignment: unaffected,
    extractGroove: unaffected,
    applyGroove: unaffected,
    setClipStretchMode: unaffected,
    setClipStretchRatio: unaffected,
    restoreClipStretchState: unaffected,
    fitClipToBeats: unaffected,
    analyzeMix: unaffected,
    autoFixMix: unaffected,
    enableMpe: unaffected,
    disableMpe: unaffected,
    getLatencyReport: unaffected,
    createCollabSession: unaffected,
    joinCollabSession: unaffected,
    leaveCollabSession: unaffected,
    scanPlugins: unaffected,
    loadExternalPlugin: unaffected,
    audioToMidi: unaffected,
    commitPitchEdit: unaffected,
    restoreClipFileId: unaffected,
    muteClip: unaffected,
    clearSolos: unaffected,
    restoreTrackSoloStates: unaffected,
    setTrackNotes: unaffected,
    deleteTime: unaffected,
    insertTime: unaffected,
    duplicateTimeRange: unaffected,
    restoreTimeOperationState: unaffected,
    restoreTrackHeights: unaffected,
    restoreTrackGroupMemberships: unaffected,
    restoreTracks: unaffected,
    restoreTrackClipStates: unaffected,
    discardCreatedTracks: unaffected,
    discardCreatedCompGroup: unaffected,
    restoreTrackAlternativeState: unaffected,
    restoreScratchPadState: unaffected,
    stripSilence: unaffected,
    restoreStripSilenceState: unaffected,
    detectTempo: unaffected,
    detectKey: unaffected,
    consolidateAllTracks: unaffected,
    arpeggiate: { before: readArpeggiateIds, after: noIds },
    addSidechainRoute: { before: noIds, after: readAddSidechainRouteIds },
    removeSidechainRoute: unaffected,
    bounceToNewTrack: unaffected,
    saveTrackTemplate: unaffected,
    loadTrackTemplate: unaffected,
    deleteTrackTemplate: unaffected,
    createProjectFromTemplate: unaffected,
    setProductionBrief: unaffected,
    repairProjectData: unaffected,
    createVcaGroup: unaffected,
    assignToVca: unaffected,
    removeFromVca: unaffected,
    setVcaGain: unaffected,
    restoreLegacyVcaState: unaffected,
    setMidiOutput: unaffected,
    clearMidiOutput: unaffected,
    restoreMidiOutput: unaffected,
    addNotes: unaffected,
    completeMidi: unaffected,
    variationMidi: unaffected,
    generateBassline: unaffected,
    replayGeneratedMidi: unaffected,
    stemSeparate: unaffected,
    autoOrganizeProject: unaffected,
    addChordEvent: unaffected,
    moveChordEvent: unaffected,
    updateChordEvent: unaffected,
    removeChordEvent: unaffected,
    toggleChordTrack: unaffected,
    clearChordTrack: unaffected,
    restoreChordTrackState: unaffected,
    clearAllMidiMappings: unaffected,
    completeMidiLearn: unaffected,
    removeMidiMapping: unaffected,
    restoreMidiLearnMappings: unaffected,
    toggleScratchPad: unaffected,
    captureScratchPad: unaffected,
    commitScratchPad: unaffected,
    clearScratchPad: unaffected,
    removeScratchPadSection: unaffected,
    renameScratchPadSection: unaffected,
    reorderScratchPadSection: unaffected,
    setScratchPadSectionColor: unaffected,
    createPatternInstance: unaffected,
    detachPatternInstance: unaffected,
    restorePatternInstanceLink: unaffected,
    startMacroRecording: unaffected,
    stopMacroRecording: unaffected,
    playMacro: unaffected,
    deleteMacro: unaffected,
    renameMacro: unaffected,
    undo: unaffected,
    redo: unaffected,
    toggleUndoTree: unaffected,
    labelUndoBranch: unaffected,
    detectSongStructure: unaffected,
    createProjectVersion: unaffected,
    restoreProjectVersion: unaffected,
    createVersionBranch: unaffected,
    generateFill: unaffected,
    generateAllTransitions: unaffected,
    compareToReference: unaffected,
    toggleControlRoomMono: unaffected,
    toggleControlRoomDim: unaffected,
    switchMonitor: unaffected,
    getMentorTips: unaffected,
    searchSamples: unaffected,
    createCompGroup: unaffected,
    togglePunchRecording: unaffected,
    toggleLoopRecord: unaffected,
    triggerScene: unaffected,
    nextSetlistItem: unaffected,
    previousSetlistItem: unaffected,
    createAdjustmentLayer: unaffected,
    removeAdjustmentLayer: unaffected,
    toggleAdjustmentLayer: unaffected,
    setLayerParameter: unaffected,
    setLayerMix: unaffected,
    addAdjustmentRegion: { before: noIds, after: readAddAdjustmentRegionIds },
    removeAdjustmentRegion: unaffected,
    moveAdjustmentRegion: unaffected,
    setLayerFades: unaffected,
    setLayerAffectedTracks: unaffected,
    setLayerInsertionIndex: unaffected,
    restoreAdjustmentLayerMutation: unaffected,
    detectTransients: unaffected,
    quantizeTransients: unaffected,
    openElasticEditor: unaffected,
    closeElasticEditor: unaffected,
    elasticSetSensitivity: unaffected,
    elasticAddMarker: unaffected,
    elasticRemoveMarker: unaffected,
    elasticToggleMarkerLock: unaffected,
    elasticSetTool: unaffected,
    toggleNodeView: unaffected,
    setControlSurface: unaffected,
    addCvOutput: unaffected,
    removeCvOutput: unaffected,
    connectPush: unaffected,
    disconnectPush: unaffected,
    exportDawProject: unaffected,
    importDawProject: unaffected,
    loadRaveModel: unaffected,
    setRaveBlend: unaffected,
    enableWarping: unaffected,
    setWarpAlgorithm: unaffected,
    setWarpPitchShift: unaffected,
    setYeastProcessorParam: unaffected,
    setYeastArpPattern: unaffected,
    setYeastProcessorBypass: unaffected,
    addYeastProcessor: unaffected,
    removeYeastProcessor: unaffected,
    reorderYeastProcessor: unaffected,
    commitRecording: unaffected,
    discardRecording: unaffected,
    restoreRecording: unaffected,
    appendOverdubControllers: unaffected,
    removeOverdubControllers: unaffected,
};

function readBefore<Type extends AppActionType>(action: ActionOf<Type>): readonly string[] {
    return affectedIdsByActionType[action.type].before(action);
}

function readAfter<Type extends AppActionType>(action: ActionOf<Type>): readonly string[] {
    return affectedIdsByActionType[action.type].after(action);
}

export function getPlannedActionAffectedIds(action: AppAction): string[] {
    const affectedIds = new Set<string>(readBefore(action));
    for (const targetId of getAppActionStaticAuthority(action)) {
        affectedIds.add(targetId);
    }
    for (const targetId of readAfter(action)) {
        affectedIds.add(targetId);
    }
    return [...affectedIds];
}
