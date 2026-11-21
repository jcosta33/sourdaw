import { CLIP_GAIN_LAW, resolveLevelFields, SEND_LEVEL_LAW, TRACK_FADER_LAW } from '#/utils/audioLevelLaw';
import { type AppAction, type AppActionType } from '#/utils/handlerContract';

import { type Track } from '../stores/trackStore';
import { clampClipGain } from '../transformers/clampClipGain';
import { clampTrackGain } from '../useCases/setTrackGainPan/clampTrackGain';

type ActionOf<Type extends AppActionType> = Extract<AppAction, { type: Type }>;

function keepTrack(): void {
    // An action that leaves no mark on the projected track.
}

function projectDiscardedClip(action: ActionOf<'discardDuplicatedClip'>, projected: Track): void {
    projected.clips = projected.clips.filter((clip) => clip.id !== action.payload.clipId);
}

function projectTrackGain(action: ActionOf<'setTrackGain'>, projected: Track): void {
    // A batch that lowers the same fader twice has to compound: the second
    // action's `deltaDb` is relative to what the first one left behind, not
    // to what the store held before the batch began.
    const resolved = resolveLevelFields(
        {
            linear: action.payload.gain,
            absoluteDb: action.payload.gainDb,
            deltaDb: action.payload.deltaDb,
        },
        projected.gain,
        TRACK_FADER_LAW
    );
    // The writer clamps a resolved gain on write (`clampTrackGain`), so the
    // projection must clamp it too, the same way the clip gain entry clamps
    // its own resolved gain — otherwise a later action in the batch would
    // plan against a gain the store could never actually hold.
    if (resolved.ok) {
        projected.gain = clampTrackGain(resolved.linear);
    }
}

function projectTrackName(action: ActionOf<'renameTrack'>, projected: Track): void {
    projected.name = action.payload.name;
}

function projectTrackColor(action: ActionOf<'setTrackColor'>, projected: Track): void {
    projected.color = action.payload.color;
}

function projectTrackPan(action: ActionOf<'setTrackPan'>, projected: Track): void {
    projected.pan = action.payload.pan;
}

function projectAutomationMode(action: ActionOf<'setAutomationMode'>, projected: Track): void {
    projected.automationMode = action.payload.mode;
}

function projectMute(action: ActionOf<'muteTrack'>, projected: Track): void {
    projected.muted = action.payload.muted;
}

function projectSolo(action: ActionOf<'soloTrack'>, projected: Track): void {
    projected.soloed = action.payload.soloed;
}

function projectFreeze(_action: ActionOf<'freezeTrack'>, projected: Track): void {
    projected.frozen = true;
}

function projectUnfreeze(_action: ActionOf<'unfreezeTrack'>, projected: Track): void {
    projected.frozen = false;
}

function projectTrackOutput(action: ActionOf<'setTrackOutput'>, projected: Track): void {
    projected.outputId = action.payload.outputId;
}

function projectAddedSend(action: ActionOf<'addSend'>, projected: Track): void {
    // The send does not exist yet, so a relative request measures from
    // unity — the same reference `handleAddSend` writes against.
    const resolved = resolveLevelFields(
        {
            linear: action.payload.level,
            absoluteDb: action.payload.levelDb,
            deltaDb: action.payload.deltaDb,
        },
        SEND_LEVEL_LAW.unity,
        SEND_LEVEL_LAW
    );
    if (resolved.ok) {
        projected.sends.push({
            busId: action.payload.busId,
            level: resolved.linear,
            preFader: action.payload.preFader ?? false,
        });
    }
}

function projectSendLevel(action: ActionOf<'setSend'>, projected: Track): void {
    // A batch that adjusts the same send twice has to compound the same
    // way a repeated `setTrackGain` does: the second action's `deltaDb` is
    // relative to what the first one left the send at.
    const send = projected.sends.find((candidate) => candidate.busId === action.payload.busId);
    if (!send) {
        return;
    }
    const resolved = resolveLevelFields(
        {
            linear: action.payload.level,
            absoluteDb: action.payload.levelDb,
            deltaDb: action.payload.deltaDb,
        },
        send.level,
        SEND_LEVEL_LAW
    );
    if (resolved.ok) {
        send.level = resolved.linear;
    }
}

function projectClipGain(action: ActionOf<'setClipGain'>, projected: Track): void {
    // A clip payload carries no `trackId`, so the foreign-track skip in
    // `projectTrackThroughPriorBatchActions` never fires for it; match the clip by id across whichever track holds it.
    const clip = projected.clips.find((candidate) => candidate.id === action.payload.clipId);
    if (!clip) {
        return;
    }
    const resolved = resolveLevelFields(
        {
            linear: action.payload.gain,
            absoluteDb: action.payload.gainDb,
            deltaDb: action.payload.deltaDb,
        },
        clip.gain,
        CLIP_GAIN_LAW
    );
    // The writer clamps a resolved gain on write, so the projection must
    // clamp it too or a later action in the batch would plan against a
    // gain the store could never actually hold.
    if (resolved.ok) {
        clip.gain = clampClipGain(resolved.linear);
    }
}

function projectRemovedSend(action: ActionOf<'removeSend'>, projected: Track): void {
    projected.sends = projected.sends.filter((send) => send.busId !== action.payload.busId);
}

// Every action type states how it changes the projected track: a new action does not compile until it does.
export const trackProjectionByActionType: {
    readonly [Type in AppActionType]: (action: ActionOf<Type>, projected: Track) => void;
} = {
    importStemSet: keepTrack,
    discardImportedStemSet: keepTrack,
    addTrack: keepTrack,
    removeTrack: keepTrack,
    discardCreatedTrack: keepTrack,
    restoreTrack: keepTrack,
    restoreClip: keepTrack,
    discardDuplicatedClip: projectDiscardedClip,
    removeAllTracks: keepTrack,
    renameTrack: projectTrackName,
    createTrackAlternative: keepTrack,
    switchTrackAlternative: keepTrack,
    renameTrackAlternative: keepTrack,
    deleteTrackAlternative: keepTrack,
    selectTrack: keepTrack,
    muteTrack: projectMute,
    soloTrack: projectSolo,
    selectTake: keepTrack,
    replaceOriginalMidiTakeRow: keepTrack,
    replaceOriginalMidiBaseRow: keepTrack,
    toggleSoloSafe: keepTrack,
    setSoloSafe: keepTrack,
    restoreSoloSafe: keepTrack,
    armTrack: keepTrack,
    freezeTrack: projectFreeze,
    unfreezeTrack: projectUnfreeze,
    restoreFreezeState: keepTrack,
    flattenTrack: keepTrack,
    bounceInPlace: keepTrack,
    reorderTrack: keepTrack,
    setTempo: keepTrack,
    restoreTempoEdit: keepTrack,
    editTempoMap: keepTrack,
    restoreTempoMapEdit: keepTrack,
    setTimeSignature: keepTrack,
    setPlayback: keepTrack,
    togglePlayback: keepTrack,
    stopPlayback: keepTrack,
    toggleRecording: keepTrack,
    setMasterGain: keepTrack,
    restoreMasterGain: keepTrack,
    toggleLoop: keepTrack,
    toggleMetronome: keepTrack,
    setMetronomeVolume: keepTrack,
    setLoopRegion: keepTrack,
    setLoopEnabled: keepTrack,
    setMetronomeEnabled: keepTrack,
    restoreLoopRegion: keepTrack,
    addClip: keepTrack,
    moveClip: keepTrack,
    restoreClipPlacement: keepTrack,
    duplicateClip: keepTrack,
    duplicateClipToNextBar: keepTrack,
    duplicateTrack: keepTrack,
    removeClip: keepTrack,
    renameClip: keepTrack,
    splitClip: keepTrack,
    restoreClipSplitState: keepTrack,
    trimClipStart: keepTrack,
    trimClipEnd: keepTrack,
    restoreAudioClipStartTrim: keepTrack,
    restoreAudioClipSlip: keepTrack,
    slipClipContent: keepTrack,
    drawClip: keepTrack,
    discardDrawnClip: keepTrack,
    restoreDrawnClip: keepTrack,
    duplicateClipAt: keepTrack,
    moveClips: keepTrack,
    restoreClipMoves: keepTrack,
    addDevice: keepTrack,
    bypassDevice: keepTrack,
    removeDevice: keepTrack,
    restoreDevice: keepTrack,
    reorderDevices: keepTrack,
    setDeviceParameter: keepTrack,
    setExternalPluginState: keepTrack,
    setDeviceState: keepTrack,
    setFermenterPatch: keepTrack,
    setLevainIdentity: keepTrack,
    setGrandBouleDeviceState: keepTrack,
    setToasterFactoryKit: keepTrack,
    setBacteriaFactoryPatch: keepTrack,
    setGlutenFactoryPreset: keepTrack,
    createBus: keepTrack,
    createFolder: keepTrack,
    setSend: projectSendLevel,
    setWorkspaceMode: keepTrack,
    openPreferencesDialog: keepTrack,
    openMixer: keepTrack,
    closeMixer: keepTrack,
    toggleSidebar: keepTrack,
    toggleInspector: keepTrack,
    toggleChatPanel: keepTrack,
    setTrackInput: keepTrack,
    restoreTrackInput: keepTrack,
    setEditingTool: keepTrack,
    setMarqueeSelection: keepTrack,
    addMarker: keepTrack,
    removeMarker: keepTrack,
    setMarkerColor: keepTrack,
    addSection: keepTrack,
    removeSection: keepTrack,
    renameSection: keepTrack,
    renameMarker: keepTrack,
    moveMarker: keepTrack,
    moveSection: keepTrack,
    resizeSection: keepTrack,
    setSectionColor: keepTrack,
    reorderSection: keepTrack,
    navigateSection: keepTrack,
    rehearseSection: keepTrack,
    restoreSectionBeats: keepTrack,
    setClipGainEnvelope: keepTrack,
    toggleClipGainEnvelope: keepTrack,
    addGainEnvelopePoint: keepTrack,
    removeGainEnvelopePoint: keepTrack,
    resetClipGainEnvelope: keepTrack,
    addModulator: keepTrack,
    removeModulator: keepTrack,
    updateModulator: keepTrack,
    addMapping: keepTrack,
    removeMapping: keepTrack,
    addAutomationLane: keepTrack,
    automateSendRange: keepTrack,
    automateSendRanges: keepTrack,
    removeSendAutomationRanges: keepTrack,
    renderProjectSections: keepTrack,
    removeRenderedProjectSections: keepTrack,
    automateTrackGainRange: keepTrack,
    automateParameterRange: keepTrack,
    removeTrackGainAutomationRange: keepTrack,
    removeSendAutomationRange: keepTrack,
    removeAutomationLane: keepTrack,
    setAutomationLaneEnabled: keepTrack,
    addAutomationPoint: keepTrack,
    insertAutomationLanePoints: keepTrack,
    quantizeNotes: keepTrack,
    removeShortMidiOverlaps: keepTrack,
    createDrumPreviewBranches: keepTrack,
    deleteDrumPreviewBranches: keepTrack,
    copyMidiArticulations: keepTrack,
    restoreMidiClipNotes: keepTrack,
    quantizeNoteLengths: keepTrack,
    transposeNotes: keepTrack,
    humanizeNotes: keepTrack,
    invertNotes: keepTrack,
    retrogradeNotes: keepTrack,
    scaleVelocities: keepTrack,
    scaleAllVelocities: keepTrack,
    setAllVelocities: keepTrack,
    setTrackGain: projectTrackGain,
    setTrackPan: projectTrackPan,
    setTrackColor: projectTrackColor,
    copyClip: keepTrack,
    cutClip: keepTrack,
    pasteClip: keepTrack,
    setClipFade: keepTrack,
    importMidiFile: keepTrack,
    normalizeClip: keepTrack,
    relinkClipAudioSources: keepTrack,
    reverseClip: keepTrack,
    restoreReversedClip: keepTrack,
    glueClips: keepTrack,
    restoreClipGlueState: keepTrack,
    setCompRegion: keepTrack,
    removeCompRegion: keepTrack,
    restoreCompRegionInterval: keepTrack,
    nudgeClip: keepTrack,
    crossfadeClips: keepTrack,
    restoreCrossfadeClips: keepTrack,
    setClipGain: projectClipGain,
    setClipColor: keepTrack,
    lockClip: keepTrack,
    consolidateSelection: keepTrack,
    bounceSelection: keepTrack,
    seekPlayhead: keepTrack,
    setPunchIn: keepTrack,
    setPunchOut: keepTrack,
    setPunchEnabled: keepTrack,
    restorePunchRegion: keepTrack,
    togglePunch: keepTrack,
    toggleCountIn: keepTrack,
    setCountInBars: keepTrack,
    togglePreRoll: keepTrack,
    setPreRollBars: keepTrack,
    zoomTracksVertical: keepTrack,
    addTimeSignatureChange: keepTrack,
    removeTimeSignatureChange: keepTrack,
    setTrackOutput: projectTrackOutput,
    addSend: projectAddedSend,
    removeSend: projectRemovedSend,
    removeAutomationPoint: keepTrack,
    setAutomationMode: projectAutomationMode,
    hideTrack: keepTrack,
    disableTrack: keepTrack,
    restoreTrackDisabled: keepTrack,
    setTrackHeight: keepTrack,
    setSnapValue: keepTrack,
    zoomToFit: keepTrack,
    zoomToSelection: keepTrack,
    exportProject: keepTrack,
    saveProject: keepTrack,
    newProject: keepTrack,
    importAudioFile: keepTrack,
    exportMidi: keepTrack,
    foldTrack: keepTrack,
    groupTracks: keepTrack,
    ungroupTracks: keepTrack,
    scaleAutomation: keepTrack,
    stretchAutomation: keepTrack,
    invertAutomation: keepTrack,
    reverseAutomation: keepTrack,
    thinAutomation: keepTrack,
    quantizeAutomation: keepTrack,
    restoreAutomationLanePoints: keepTrack,
    restoreAutomationPointPresence: keepTrack,
    loadPreset: keepTrack,
    restorePresetDeviceChain: keepTrack,
    savePreset: keepTrack,
    generateDrumPattern: keepTrack,
    generateMelody: keepTrack,
    generateChordProgression: keepTrack,
    setClipLoop: keepTrack,
    restoreClipLoop: keepTrack,
    setClipLoopLength: keepTrack,
    restoreClipLoopLength: keepTrack,
    createGrooveTemplate: keepTrack,
    renameGrooveTemplate: keepTrack,
    restoreGrooveTemplateName: keepTrack,
    deleteGrooveTemplate: keepTrack,
    restoreDeletedGrooveTemplate: keepTrack,
    assignGrooveTemplate: keepTrack,
    restoreGrooveAssignment: keepTrack,
    extractGroove: keepTrack,
    applyGroove: keepTrack,
    setClipStretchMode: keepTrack,
    setClipStretchRatio: keepTrack,
    restoreClipStretchState: keepTrack,
    fitClipToBeats: keepTrack,
    analyzeMix: keepTrack,
    autoFixMix: keepTrack,
    enableMpe: keepTrack,
    disableMpe: keepTrack,
    getLatencyReport: keepTrack,
    createCollabSession: keepTrack,
    joinCollabSession: keepTrack,
    leaveCollabSession: keepTrack,
    scanPlugins: keepTrack,
    loadExternalPlugin: keepTrack,
    audioToMidi: keepTrack,
    commitPitchEdit: keepTrack,
    restoreClipFileId: keepTrack,
    muteClip: keepTrack,
    clearSolos: keepTrack,
    restoreTrackSoloStates: keepTrack,
    setTrackNotes: keepTrack,
    deleteTime: keepTrack,
    insertTime: keepTrack,
    duplicateTimeRange: keepTrack,
    restoreTimeOperationState: keepTrack,
    restoreTrackHeights: keepTrack,
    restoreTrackGroupMemberships: keepTrack,
    restoreTracks: keepTrack,
    restoreTrackClipStates: keepTrack,
    discardCreatedTracks: keepTrack,
    discardCreatedCompGroup: keepTrack,
    restoreTrackAlternativeState: keepTrack,
    restoreScratchPadState: keepTrack,
    stripSilence: keepTrack,
    restoreStripSilenceState: keepTrack,
    detectTempo: keepTrack,
    detectKey: keepTrack,
    consolidateAllTracks: keepTrack,
    arpeggiate: keepTrack,
    addSidechainRoute: keepTrack,
    removeSidechainRoute: keepTrack,
    bounceToNewTrack: keepTrack,
    saveTrackTemplate: keepTrack,
    loadTrackTemplate: keepTrack,
    deleteTrackTemplate: keepTrack,
    createProjectFromTemplate: keepTrack,
    setProductionBrief: keepTrack,
    repairProjectData: keepTrack,
    createVcaGroup: keepTrack,
    assignToVca: keepTrack,
    removeFromVca: keepTrack,
    setVcaGain: keepTrack,
    restoreLegacyVcaState: keepTrack,
    setMidiOutput: keepTrack,
    clearMidiOutput: keepTrack,
    restoreMidiOutput: keepTrack,
    addNotes: keepTrack,
    completeMidi: keepTrack,
    variationMidi: keepTrack,
    generateBassline: keepTrack,
    replayGeneratedMidi: keepTrack,
    stemSeparate: keepTrack,
    autoOrganizeProject: keepTrack,
    addChordEvent: keepTrack,
    moveChordEvent: keepTrack,
    updateChordEvent: keepTrack,
    removeChordEvent: keepTrack,
    toggleChordTrack: keepTrack,
    clearChordTrack: keepTrack,
    restoreChordTrackState: keepTrack,
    clearAllMidiMappings: keepTrack,
    completeMidiLearn: keepTrack,
    removeMidiMapping: keepTrack,
    restoreMidiLearnMappings: keepTrack,
    toggleScratchPad: keepTrack,
    captureScratchPad: keepTrack,
    commitScratchPad: keepTrack,
    clearScratchPad: keepTrack,
    removeScratchPadSection: keepTrack,
    renameScratchPadSection: keepTrack,
    reorderScratchPadSection: keepTrack,
    setScratchPadSectionColor: keepTrack,
    createPatternInstance: keepTrack,
    detachPatternInstance: keepTrack,
    restorePatternInstanceLink: keepTrack,
    startMacroRecording: keepTrack,
    stopMacroRecording: keepTrack,
    playMacro: keepTrack,
    deleteMacro: keepTrack,
    renameMacro: keepTrack,
    undo: keepTrack,
    redo: keepTrack,
    toggleUndoTree: keepTrack,
    labelUndoBranch: keepTrack,
    detectSongStructure: keepTrack,
    createProjectVersion: keepTrack,
    restoreProjectVersion: keepTrack,
    createVersionBranch: keepTrack,
    generateFill: keepTrack,
    generateAllTransitions: keepTrack,
    compareToReference: keepTrack,
    toggleControlRoomMono: keepTrack,
    toggleControlRoomDim: keepTrack,
    switchMonitor: keepTrack,
    getMentorTips: keepTrack,
    searchSamples: keepTrack,
    createCompGroup: keepTrack,
    togglePunchRecording: keepTrack,
    toggleLoopRecord: keepTrack,
    triggerScene: keepTrack,
    nextSetlistItem: keepTrack,
    previousSetlistItem: keepTrack,
    createAdjustmentLayer: keepTrack,
    removeAdjustmentLayer: keepTrack,
    toggleAdjustmentLayer: keepTrack,
    setLayerParameter: keepTrack,
    setLayerMix: keepTrack,
    addAdjustmentRegion: keepTrack,
    removeAdjustmentRegion: keepTrack,
    moveAdjustmentRegion: keepTrack,
    setLayerFades: keepTrack,
    setLayerAffectedTracks: keepTrack,
    setLayerInsertionIndex: keepTrack,
    restoreAdjustmentLayerMutation: keepTrack,
    detectTransients: keepTrack,
    quantizeTransients: keepTrack,
    openElasticEditor: keepTrack,
    closeElasticEditor: keepTrack,
    elasticSetSensitivity: keepTrack,
    elasticAddMarker: keepTrack,
    elasticRemoveMarker: keepTrack,
    elasticToggleMarkerLock: keepTrack,
    elasticSetTool: keepTrack,
    toggleNodeView: keepTrack,
    setControlSurface: keepTrack,
    addCvOutput: keepTrack,
    removeCvOutput: keepTrack,
    connectPush: keepTrack,
    disconnectPush: keepTrack,
    exportDawProject: keepTrack,
    importDawProject: keepTrack,
    loadRaveModel: keepTrack,
    setRaveBlend: keepTrack,
    enableWarping: keepTrack,
    setWarpAlgorithm: keepTrack,
    setWarpPitchShift: keepTrack,
    setYeastProcessorParam: keepTrack,
    setYeastArpPattern: keepTrack,
    setYeastProcessorBypass: keepTrack,
    addYeastProcessor: keepTrack,
    removeYeastProcessor: keepTrack,
    reorderYeastProcessor: keepTrack,
    commitRecording: keepTrack,
    discardRecording: keepTrack,
    restoreRecording: keepTrack,
    appendOverdubControllers: keepTrack,
    removeOverdubControllers: keepTrack,
};

function lookup<Type extends AppActionType>(action: ActionOf<Type>, projected: Track): void {
    if (!Object.hasOwn(trackProjectionByActionType, action.type)) {
        return;
    }
    trackProjectionByActionType[action.type](action, projected);
}

export function projectTrackAction(projected: Track, action: AppAction): void {
    lookup(action, projected);
}
