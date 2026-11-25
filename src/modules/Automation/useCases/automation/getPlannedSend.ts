import { sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';
import { resolveSendLevelFields, SEND_LEVEL_LAW } from '#/utils/audioLevelLaw';
import { type AppAction, type AppActionType } from '#/utils/handlerContract';

type PlannedSend = { busId: string; level: number; preFader: boolean };
type ActionOf<Type extends AppActionType> = Extract<AppAction, { type: Type }>;

function unchangedSend(
    _action: unknown,
    _trackId: string,
    _busId: string,
    send: PlannedSend | undefined
): PlannedSend | undefined {
    return send;
}

function afterAddSend(
    action: ActionOf<'addSend'>,
    trackId: string,
    busId: string,
    send: PlannedSend | undefined
): PlannedSend | undefined {
    if (action.payload.trackId === trackId && action.payload.busId === busId) {
        // A send the batch cannot land leaves the plan as it was: the
        // decibel forms answer to the send law like the handler's do, and a
        // refused request creates nothing to plan against.
        const level = resolveSendLevelFields(action.payload, SEND_LEVEL_LAW.unity);
        if (level.ok) {
            return { busId, level: level.linear, preFader: action.payload.preFader ?? false };
        }
    }
    return send;
}

function afterSetSend(
    action: ActionOf<'setSend'>,
    trackId: string,
    busId: string,
    send: PlannedSend | undefined
): PlannedSend | undefined {
    if (action.payload.trackId === trackId && action.payload.busId === busId && send) {
        const level = resolveSendLevelFields(action.payload, send.level);
        if (level.ok) {
            return { ...send, level: level.linear };
        }
    }
    return send;
}

function afterRemoveSend(
    action: ActionOf<'removeSend'>,
    trackId: string,
    busId: string,
    send: PlannedSend | undefined
): PlannedSend | undefined {
    if (action.payload.trackId === trackId && action.payload.busId === busId) {
        return undefined;
    }
    return send;
}

function afterTrackRemoved(
    action: ActionOf<'removeTrack' | 'discardCreatedTrack'>,
    trackId: string,
    busId: string,
    send: PlannedSend | undefined
): PlannedSend | undefined {
    if (action.payload.trackId === trackId || action.payload.trackId === busId) {
        return undefined;
    }
    return send;
}

function afterTracksDiscarded(
    action: ActionOf<'discardCreatedTracks'>,
    trackId: string,
    busId: string,
    send: PlannedSend | undefined
): PlannedSend | undefined {
    if (action.payload.trackIds.some((id) => id === trackId || id === busId)) {
        return undefined;
    }
    return send;
}

function afterAllTracksRemoved(): undefined {
    return undefined;
}

function afterStemSetDiscarded(
    action: ActionOf<'discardImportedStemSet'>,
    trackId: string,
    busId: string,
    send: PlannedSend | undefined
): PlannedSend | undefined {
    const removedIds = [...action.payload.stemTrackIds, action.payload.folderId];
    if (removedIds.some((id) => id === trackId || id === busId)) {
        return undefined;
    }
    return send;
}

type RestoreTrackPayload = ActionOf<'restoreTrack'>['payload'];

function findPlannedSend(
    sends: readonly { readonly busId: string; readonly level: number; readonly preFader: boolean }[] | undefined,
    busId: string
): PlannedSend | undefined {
    const found = sends?.find((candidate) => candidate.busId === busId);
    return found ? { busId, level: found.level, preFader: found.preFader } : undefined;
}

// Mirrors handleRestoreTrack: the restored row returns with its own sends, and a
// surviving track that is not itself restored in the batch takes its patch's
// replacement sends.
function sendAfterRestore(
    payload: RestoreTrackPayload,
    batchTrackIds: ReadonlySet<string>,
    trackId: string,
    busId: string,
    send: PlannedSend | undefined
): PlannedSend | undefined {
    if (payload.trackId === trackId) {
        const row = sanitizeTrackSnapshot({ tracks: [payload.trackSnapshot], selectedTrackId: null }).tracks[0];
        return row ? findPlannedSend(row.sends, busId) : send;
    }
    const patch = payload.routingPatches.find((candidate) => candidate.trackId === trackId);
    if (patch && !batchTrackIds.has(trackId)) {
        return findPlannedSend(patch.replacement.sends, busId);
    }
    return send;
}

function afterTrackRestored(
    action: ActionOf<'restoreTrack'>,
    trackId: string,
    busId: string,
    send: PlannedSend | undefined
): PlannedSend | undefined {
    const batchTrackIds = new Set((action.payload.batchRestoreTracks ?? []).map((track) => track.trackId));
    return sendAfterRestore(action.payload, batchTrackIds, trackId, busId, send);
}

function afterTracksRestored(
    action: ActionOf<'restoreTracks'>,
    trackId: string,
    busId: string,
    send: PlannedSend | undefined
): PlannedSend | undefined {
    // The handler restores ascending by the index each track held.
    const ordered = [...action.payload.restores].sort((first, second) => first.trackIndex - second.trackIndex);
    const batchTrackIds = new Set(ordered.map((restore) => restore.trackId));
    return ordered.reduce<PlannedSend | undefined>(
        (planned, restore) => sendAfterRestore(restore, batchTrackIds, trackId, busId, planned),
        send
    );
}

// Every action type states how it changes the planned send: a new action does not compile until it does.
const plannedSendByActionType: {
    readonly [Type in AppActionType]: (
        action: ActionOf<Type>,
        trackId: string,
        busId: string,
        send: PlannedSend | undefined
    ) => PlannedSend | undefined;
} = {
    importStemSet: unchangedSend,
    discardImportedStemSet: afterStemSetDiscarded,
    addTrack: unchangedSend,
    removeTrack: afterTrackRemoved,
    discardCreatedTrack: afterTrackRemoved,
    restoreTrack: afterTrackRestored,
    restoreClip: unchangedSend,
    discardDuplicatedClip: unchangedSend,
    removeAllTracks: afterAllTracksRemoved,
    renameTrack: unchangedSend,
    createTrackAlternative: unchangedSend,
    switchTrackAlternative: unchangedSend,
    renameTrackAlternative: unchangedSend,
    deleteTrackAlternative: unchangedSend,
    selectTrack: unchangedSend,
    muteTrack: unchangedSend,
    soloTrack: unchangedSend,
    selectTake: unchangedSend,
    replaceOriginalMidiTakeRow: unchangedSend,
    replaceOriginalMidiBaseRow: unchangedSend,
    toggleSoloSafe: unchangedSend,
    setSoloSafe: unchangedSend,
    restoreSoloSafe: unchangedSend,
    armTrack: unchangedSend,
    freezeTrack: unchangedSend,
    unfreezeTrack: unchangedSend,
    restoreFreezeState: unchangedSend,
    flattenTrack: unchangedSend,
    bounceInPlace: unchangedSend,
    reorderTrack: unchangedSend,
    setTempo: unchangedSend,
    restoreTempoEdit: unchangedSend,
    editTempoMap: unchangedSend,
    restoreTempoMapEdit: unchangedSend,
    setTimeSignature: unchangedSend,
    setPlayback: unchangedSend,
    togglePlayback: unchangedSend,
    stopPlayback: unchangedSend,
    toggleRecording: unchangedSend,
    setMasterGain: unchangedSend,
    restoreMasterGain: unchangedSend,
    toggleLoop: unchangedSend,
    toggleMetronome: unchangedSend,
    setMetronomeVolume: unchangedSend,
    setLoopRegion: unchangedSend,
    setLoopEnabled: unchangedSend,
    setMetronomeEnabled: unchangedSend,
    restoreLoopRegion: unchangedSend,
    addClip: unchangedSend,
    moveClip: unchangedSend,
    restoreClipPlacement: unchangedSend,
    duplicateClip: unchangedSend,
    duplicateClipToNextBar: unchangedSend,
    duplicateTrack: unchangedSend,
    removeClip: unchangedSend,
    renameClip: unchangedSend,
    splitClip: unchangedSend,
    restoreClipSplitState: unchangedSend,
    trimClipStart: unchangedSend,
    trimClipEnd: unchangedSend,
    restoreAudioClipStartTrim: unchangedSend,
    restoreAudioClipSlip: unchangedSend,
    slipClipContent: unchangedSend,
    drawClip: unchangedSend,
    discardDrawnClip: unchangedSend,
    restoreDrawnClip: unchangedSend,
    duplicateClipAt: unchangedSend,
    moveClips: unchangedSend,
    restoreClipMoves: unchangedSend,
    addDevice: unchangedSend,
    bypassDevice: unchangedSend,
    removeDevice: unchangedSend,
    restoreDevice: unchangedSend,
    reorderDevices: unchangedSend,
    setDeviceParameter: unchangedSend,
    setExternalPluginState: unchangedSend,
    setDeviceState: unchangedSend,
    setFermenterPatch: unchangedSend,
    setLevainIdentity: unchangedSend,
    setGrandBouleDeviceState: unchangedSend,
    setToasterFactoryKit: unchangedSend,
    setBacteriaFactoryPatch: unchangedSend,
    setCrustFactoryPreset: unchangedSend,
    setGlutenFactoryPreset: unchangedSend,
    setProofPatchSelection: unchangedSend,
    createBus: unchangedSend,
    createFolder: unchangedSend,
    setSend: afterSetSend,
    setWorkspaceMode: unchangedSend,
    openPreferencesDialog: unchangedSend,
    openMixer: unchangedSend,
    closeMixer: unchangedSend,
    toggleSidebar: unchangedSend,
    toggleInspector: unchangedSend,
    toggleChatPanel: unchangedSend,
    setTrackInput: unchangedSend,
    restoreTrackInput: unchangedSend,
    setEditingTool: unchangedSend,
    setMarqueeSelection: unchangedSend,
    addMarker: unchangedSend,
    removeMarker: unchangedSend,
    setMarkerColor: unchangedSend,
    addSection: unchangedSend,
    removeSection: unchangedSend,
    renameSection: unchangedSend,
    renameMarker: unchangedSend,
    moveMarker: unchangedSend,
    moveSection: unchangedSend,
    resizeSection: unchangedSend,
    setSectionColor: unchangedSend,
    reorderSection: unchangedSend,
    navigateSection: unchangedSend,
    rehearseSection: unchangedSend,
    restoreSectionBeats: unchangedSend,
    setClipGainEnvelope: unchangedSend,
    toggleClipGainEnvelope: unchangedSend,
    addGainEnvelopePoint: unchangedSend,
    removeGainEnvelopePoint: unchangedSend,
    resetClipGainEnvelope: unchangedSend,
    addModulator: unchangedSend,
    removeModulator: unchangedSend,
    updateModulator: unchangedSend,
    addMapping: unchangedSend,
    removeMapping: unchangedSend,
    addAutomationLane: unchangedSend,
    automateSendRange: unchangedSend,
    automateSendRanges: unchangedSend,
    removeSendAutomationRanges: unchangedSend,
    renderProjectSections: unchangedSend,
    removeRenderedProjectSections: unchangedSend,
    automateTrackGainRange: unchangedSend,
    automateParameterRange: unchangedSend,
    removeTrackGainAutomationRange: unchangedSend,
    removeSendAutomationRange: unchangedSend,
    removeAutomationLane: unchangedSend,
    setAutomationLaneEnabled: unchangedSend,
    addAutomationPoint: unchangedSend,
    insertAutomationLanePoints: unchangedSend,
    quantizeNotes: unchangedSend,
    removeShortMidiOverlaps: unchangedSend,
    createDrumPreviewBranches: unchangedSend,
    deleteDrumPreviewBranches: unchangedSend,
    copyMidiArticulations: unchangedSend,
    restoreMidiClipNotes: unchangedSend,
    quantizeNoteLengths: unchangedSend,
    transposeNotes: unchangedSend,
    humanizeNotes: unchangedSend,
    invertNotes: unchangedSend,
    retrogradeNotes: unchangedSend,
    scaleVelocities: unchangedSend,
    scaleAllVelocities: unchangedSend,
    setAllVelocities: unchangedSend,
    setTrackGain: unchangedSend,
    setTrackPan: unchangedSend,
    setTrackColor: unchangedSend,
    copyClip: unchangedSend,
    cutClip: unchangedSend,
    pasteClip: unchangedSend,
    setClipFade: unchangedSend,
    importMidiFile: unchangedSend,
    normalizeClip: unchangedSend,
    relinkClipAudioSources: unchangedSend,
    reverseClip: unchangedSend,
    restoreReversedClip: unchangedSend,
    glueClips: unchangedSend,
    restoreClipGlueState: unchangedSend,
    setCompRegion: unchangedSend,
    removeCompRegion: unchangedSend,
    restoreCompRegionInterval: unchangedSend,
    nudgeClip: unchangedSend,
    crossfadeClips: unchangedSend,
    restoreCrossfadeClips: unchangedSend,
    setClipGain: unchangedSend,
    setClipColor: unchangedSend,
    lockClip: unchangedSend,
    consolidateSelection: unchangedSend,
    bounceSelection: unchangedSend,
    seekPlayhead: unchangedSend,
    setPunchIn: unchangedSend,
    setPunchOut: unchangedSend,
    setPunchEnabled: unchangedSend,
    restorePunchRegion: unchangedSend,
    togglePunch: unchangedSend,
    toggleCountIn: unchangedSend,
    setCountInBars: unchangedSend,
    togglePreRoll: unchangedSend,
    setPreRollBars: unchangedSend,
    zoomTracksVertical: unchangedSend,
    addTimeSignatureChange: unchangedSend,
    removeTimeSignatureChange: unchangedSend,
    setTrackOutput: unchangedSend,
    addSend: afterAddSend,
    removeSend: afterRemoveSend,
    removeAutomationPoint: unchangedSend,
    setAutomationMode: unchangedSend,
    hideTrack: unchangedSend,
    disableTrack: unchangedSend,
    restoreTrackDisabled: unchangedSend,
    setTrackHeight: unchangedSend,
    setSnapValue: unchangedSend,
    zoomToFit: unchangedSend,
    zoomToSelection: unchangedSend,
    exportProject: unchangedSend,
    saveProject: unchangedSend,
    newProject: unchangedSend,
    importAudioFile: unchangedSend,
    exportMidi: unchangedSend,
    foldTrack: unchangedSend,
    groupTracks: unchangedSend,
    ungroupTracks: unchangedSend,
    scaleAutomation: unchangedSend,
    stretchAutomation: unchangedSend,
    invertAutomation: unchangedSend,
    reverseAutomation: unchangedSend,
    thinAutomation: unchangedSend,
    quantizeAutomation: unchangedSend,
    restoreAutomationLanePoints: unchangedSend,
    restoreAutomationPointPresence: unchangedSend,
    loadPreset: unchangedSend,
    restorePresetDeviceChain: unchangedSend,
    savePreset: unchangedSend,
    generateDrumPattern: unchangedSend,
    generateMelody: unchangedSend,
    generateChordProgression: unchangedSend,
    setClipLoop: unchangedSend,
    restoreClipLoop: unchangedSend,
    setClipLoopLength: unchangedSend,
    restoreClipLoopLength: unchangedSend,
    createGrooveTemplate: unchangedSend,
    renameGrooveTemplate: unchangedSend,
    restoreGrooveTemplateName: unchangedSend,
    deleteGrooveTemplate: unchangedSend,
    restoreDeletedGrooveTemplate: unchangedSend,
    assignGrooveTemplate: unchangedSend,
    restoreGrooveAssignment: unchangedSend,
    extractGroove: unchangedSend,
    applyGroove: unchangedSend,
    setClipStretchMode: unchangedSend,
    setClipStretchRatio: unchangedSend,
    restoreClipStretchState: unchangedSend,
    fitClipToBeats: unchangedSend,
    analyzeMix: unchangedSend,
    autoFixMix: unchangedSend,
    enableMpe: unchangedSend,
    disableMpe: unchangedSend,
    getLatencyReport: unchangedSend,
    createCollabSession: unchangedSend,
    joinCollabSession: unchangedSend,
    leaveCollabSession: unchangedSend,
    scanPlugins: unchangedSend,
    loadExternalPlugin: unchangedSend,
    audioToMidi: unchangedSend,
    commitPitchEdit: unchangedSend,
    restoreClipFileId: unchangedSend,
    muteClip: unchangedSend,
    clearSolos: unchangedSend,
    restoreTrackSoloStates: unchangedSend,
    setTrackNotes: unchangedSend,
    deleteTime: unchangedSend,
    insertTime: unchangedSend,
    duplicateTimeRange: unchangedSend,
    restoreTimeOperationState: unchangedSend,
    restoreTrackHeights: unchangedSend,
    restoreTrackGroupMemberships: unchangedSend,
    restoreTracks: afterTracksRestored,
    restoreTrackClipStates: unchangedSend,
    discardCreatedTracks: afterTracksDiscarded,
    discardCreatedCompGroup: unchangedSend,
    restoreTrackAlternativeState: unchangedSend,
    restoreScratchPadState: unchangedSend,
    stripSilence: unchangedSend,
    restoreStripSilenceState: unchangedSend,
    detectTempo: unchangedSend,
    detectKey: unchangedSend,
    consolidateAllTracks: unchangedSend,
    arpeggiate: unchangedSend,
    addSidechainRoute: unchangedSend,
    removeSidechainRoute: unchangedSend,
    bounceToNewTrack: unchangedSend,
    saveTrackTemplate: unchangedSend,
    loadTrackTemplate: unchangedSend,
    deleteTrackTemplate: unchangedSend,
    createProjectFromTemplate: unchangedSend,
    setProductionBrief: unchangedSend,
    repairProjectData: unchangedSend,
    createVcaGroup: unchangedSend,
    assignToVca: unchangedSend,
    removeFromVca: unchangedSend,
    setVcaGain: unchangedSend,
    restoreLegacyVcaState: unchangedSend,
    setMidiOutput: unchangedSend,
    clearMidiOutput: unchangedSend,
    restoreMidiOutput: unchangedSend,
    addNotes: unchangedSend,
    completeMidi: unchangedSend,
    variationMidi: unchangedSend,
    generateBassline: unchangedSend,
    replayGeneratedMidi: unchangedSend,
    stemSeparate: unchangedSend,
    autoOrganizeProject: unchangedSend,
    addChordEvent: unchangedSend,
    moveChordEvent: unchangedSend,
    updateChordEvent: unchangedSend,
    removeChordEvent: unchangedSend,
    toggleChordTrack: unchangedSend,
    clearChordTrack: unchangedSend,
    restoreChordTrackState: unchangedSend,
    clearAllMidiMappings: unchangedSend,
    completeMidiLearn: unchangedSend,
    removeMidiMapping: unchangedSend,
    restoreMidiLearnMappings: unchangedSend,
    toggleScratchPad: unchangedSend,
    captureScratchPad: unchangedSend,
    commitScratchPad: unchangedSend,
    clearScratchPad: unchangedSend,
    removeScratchPadSection: unchangedSend,
    renameScratchPadSection: unchangedSend,
    reorderScratchPadSection: unchangedSend,
    setScratchPadSectionColor: unchangedSend,
    createPatternInstance: unchangedSend,
    detachPatternInstance: unchangedSend,
    restorePatternInstanceLink: unchangedSend,
    startMacroRecording: unchangedSend,
    stopMacroRecording: unchangedSend,
    playMacro: unchangedSend,
    deleteMacro: unchangedSend,
    renameMacro: unchangedSend,
    undo: unchangedSend,
    redo: unchangedSend,
    toggleUndoTree: unchangedSend,
    labelUndoBranch: unchangedSend,
    detectSongStructure: unchangedSend,
    createProjectVersion: unchangedSend,
    restoreProjectVersion: unchangedSend,
    createVersionBranch: unchangedSend,
    generateFill: unchangedSend,
    generateAllTransitions: unchangedSend,
    compareToReference: unchangedSend,
    toggleControlRoomMono: unchangedSend,
    toggleControlRoomDim: unchangedSend,
    switchMonitor: unchangedSend,
    getMentorTips: unchangedSend,
    searchSamples: unchangedSend,
    createCompGroup: unchangedSend,
    togglePunchRecording: unchangedSend,
    toggleLoopRecord: unchangedSend,
    triggerScene: unchangedSend,
    nextSetlistItem: unchangedSend,
    previousSetlistItem: unchangedSend,
    createAdjustmentLayer: unchangedSend,
    removeAdjustmentLayer: unchangedSend,
    toggleAdjustmentLayer: unchangedSend,
    setLayerParameter: unchangedSend,
    setLayerMix: unchangedSend,
    addAdjustmentRegion: unchangedSend,
    removeAdjustmentRegion: unchangedSend,
    moveAdjustmentRegion: unchangedSend,
    setLayerFades: unchangedSend,
    setLayerAffectedTracks: unchangedSend,
    setLayerInsertionIndex: unchangedSend,
    restoreAdjustmentLayerMutation: unchangedSend,
    detectTransients: unchangedSend,
    quantizeTransients: unchangedSend,
    openElasticEditor: unchangedSend,
    closeElasticEditor: unchangedSend,
    elasticSetSensitivity: unchangedSend,
    elasticAddMarker: unchangedSend,
    elasticRemoveMarker: unchangedSend,
    elasticToggleMarkerLock: unchangedSend,
    elasticSetTool: unchangedSend,
    toggleNodeView: unchangedSend,
    setControlSurface: unchangedSend,
    addCvOutput: unchangedSend,
    removeCvOutput: unchangedSend,
    connectPush: unchangedSend,
    disconnectPush: unchangedSend,
    exportDawProject: unchangedSend,
    importDawProject: unchangedSend,
    loadRaveModel: unchangedSend,
    setRaveBlend: unchangedSend,
    enableWarping: unchangedSend,
    setWarpAlgorithm: unchangedSend,
    setWarpPitchShift: unchangedSend,
    setYeastProcessorParam: unchangedSend,
    setYeastArpPattern: unchangedSend,
    setYeastProcessorBypass: unchangedSend,
    addYeastProcessor: unchangedSend,
    removeYeastProcessor: unchangedSend,
    reorderYeastProcessor: unchangedSend,
    commitRecording: unchangedSend,
    discardRecording: unchangedSend,
    restoreRecording: unchangedSend,
    appendOverdubControllers: unchangedSend,
    removeOverdubControllers: unchangedSend,
};

function lookup<Type extends AppActionType>(
    action: ActionOf<Type>,
    trackId: string,
    busId: string,
    send: PlannedSend | undefined
): PlannedSend | undefined {
    return plannedSendByActionType[action.type](action, trackId, busId, send);
}

/**
 * The send from a track to a bus as it will stand once the earlier members of a batch have run:
 * an earlier `addSend` lands it, `setSend` moves its level and `removeSend` takes it away.
 */
export function getPlannedSend(
    trackId: string,
    busId: string,
    priorActions: readonly AppAction[]
): PlannedSend | undefined {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    let send: PlannedSend | undefined = track?.sends.find((candidate) => candidate.busId === busId);
    for (const action of priorActions) {
        send = lookup(action, trackId, busId, send);
    }
    return send;
}
