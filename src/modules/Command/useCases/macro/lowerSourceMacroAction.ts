import { resolveAudioUnwrappedOffsetSeconds } from '#/utils/audioSourceTime';
import { type AppAction, type AppActionType } from '#/utils/handlerContract';

import { AppActionConflictError } from '../../errors/AppActionExecutionError';
import { getCommandHandler } from '../getCommandHandler';

import { macroCoreReads } from './macroCoreReads';

type ActionOf<Type extends AppActionType> = Extract<AppAction, { type: Type }>;

type CapturedSourceAction = ActionOf<'restoreAudioClipSlip' | 'restoreAudioClipStartTrim' | 'restoreTempoEdit'>;

function assertCapturedSourceAction(action: CapturedSourceAction): void {
    if (!getCommandHandler(action)?.validateSessionActionArguments?.(action.payload)) {
        throw new AppActionConflictError(action.type, 'Invalid captured macro source action');
    }
}

function lowerRestoreAudioClipStartTrim(action: ActionOf<'restoreAudioClipStartTrim'>): AppAction {
    assertCapturedSourceAction(action);
    const clip = action.payload.direction === 'restore' ? action.payload.before : action.payload.after;
    return { type: 'trimClipStart', payload: { clipId: action.payload.clipId, newStartBeat: clip.startBeat } };
}

function lowerRestoreAudioClipSlip(action: ActionOf<'restoreAudioClipSlip'>): AppAction {
    assertCapturedSourceAction(action);
    const { before, clock, direction } = action.payload;
    const tempo = macroCoreReads.read('lowerSourceMacroAction').readTempoAtBeat({ beat: before.clip.startBeat, clock });
    let offset = action.payload.offset;
    if (direction === 'restore') {
        offset = (resolveAudioUnwrappedOffsetSeconds(before.clip, tempo) * tempo) / 60;
    }
    return { type: 'slipClipContent', payload: { clipId: action.payload.clipId, clipType: 'audio', offset } };
}

function lowerRestoreTempoEdit(action: ActionOf<'restoreTempoEdit'>, tempoIds: ReadonlyMap<string, string>): AppAction {
    assertCapturedSourceAction(action);
    const target = action.payload.tempoChangeId;
    return {
        type: 'setTempo',
        payload: {
            bpm: action.payload.bpm,
            tempoChangeId: target === null ? null : (tempoIds.get(target) ?? target),
        },
    };
}

function cloneSetTempoForReplay(action: ActionOf<'setTempo'>, tempoIds: ReadonlyMap<string, string>): AppAction {
    const replay = structuredClone(action);
    delete replay.payload.expectedBpm;
    delete replay.payload.audioSourcePromotion;
    const target = replay.payload.tempoChangeId;
    if (typeof target === 'string') {
        replay.payload.tempoChangeId = tempoIds.get(target) ?? target;
    }
    return replay;
}

function cloneForReplay(action: AppAction): AppAction {
    return structuredClone(action);
}

// A recorded inverse guards itself against the state it was captured from. A macro replays intent on
// whatever the project holds now, so it keeps the request and drops the guard and the captured beats.
function cloneNudgeClipForReplay(action: ActionOf<'nudgeClip'>): AppAction {
    const replay = structuredClone(action);
    delete replay.payload.expectedStartBeat;
    delete replay.payload.expectedPlacement;
    delete replay.payload.placement;
    return replay;
}

function cloneTrimClipStartForReplay(action: ActionOf<'trimClipStart'>): AppAction {
    const replay = structuredClone(action);
    delete replay.payload.expectedStartBeat;
    delete replay.payload.expectedMidiOffsetBeats;
    return replay;
}

function cloneTrimClipEndForReplay(action: ActionOf<'trimClipEnd'>): AppAction {
    const replay = structuredClone(action);
    delete replay.payload.expectedEndBeat;
    return replay;
}

function cloneSlipClipContentForReplay(action: ActionOf<'slipClipContent'>): AppAction {
    const replay = structuredClone(action);
    delete replay.payload.expectedOffset;
    return replay;
}

function cloneRenameClipForReplay(action: ActionOf<'renameClip'>): AppAction {
    const replay = structuredClone(action);
    delete replay.payload.expectedName;
    return replay;
}

const lowerByActionType: {
    readonly [Type in AppActionType]: (action: ActionOf<Type>, tempoIds: ReadonlyMap<string, string>) => AppAction;
} = {
    importStemSet: cloneForReplay,
    discardImportedStemSet: cloneForReplay,
    addTrack: cloneForReplay,
    removeTrack: cloneForReplay,
    discardCreatedTrack: cloneForReplay,
    restoreTrack: cloneForReplay,
    restoreClip: cloneForReplay,
    discardDuplicatedClip: cloneForReplay,
    removeAllTracks: cloneForReplay,
    renameTrack: cloneForReplay,
    createTrackAlternative: cloneForReplay,
    switchTrackAlternative: cloneForReplay,
    renameTrackAlternative: cloneForReplay,
    deleteTrackAlternative: cloneForReplay,
    selectTrack: cloneForReplay,
    muteTrack: cloneForReplay,
    soloTrack: cloneForReplay,
    selectTake: cloneForReplay,
    replaceOriginalMidiTakeRow: cloneForReplay,
    replaceOriginalMidiBaseRow: cloneForReplay,
    toggleSoloSafe: cloneForReplay,
    setSoloSafe: cloneForReplay,
    restoreSoloSafe: cloneForReplay,
    armTrack: cloneForReplay,
    freezeTrack: cloneForReplay,
    unfreezeTrack: cloneForReplay,
    restoreFreezeState: cloneForReplay,
    flattenTrack: cloneForReplay,
    bounceInPlace: cloneForReplay,
    reorderTrack: cloneForReplay,
    setTempo: cloneSetTempoForReplay,
    restoreTempoEdit: lowerRestoreTempoEdit,
    editTempoMap: cloneForReplay,
    restoreTempoMapEdit: cloneForReplay,
    setTimeSignature: cloneForReplay,
    setPlayback: cloneForReplay,
    togglePlayback: cloneForReplay,
    stopPlayback: cloneForReplay,
    toggleRecording: cloneForReplay,
    setMasterGain: cloneForReplay,
    restoreMasterGain: cloneForReplay,
    toggleLoop: cloneForReplay,
    toggleMetronome: cloneForReplay,
    setMetronomeVolume: cloneForReplay,
    setLoopRegion: cloneForReplay,
    setLoopEnabled: cloneForReplay,
    setMetronomeEnabled: cloneForReplay,
    restoreLoopRegion: cloneForReplay,
    addClip: cloneForReplay,
    moveClip: cloneForReplay,
    restoreClipPlacement: cloneForReplay,
    duplicateClip: cloneForReplay,
    duplicateClipToNextBar: cloneForReplay,
    duplicateTrack: cloneForReplay,
    removeClip: cloneForReplay,
    renameClip: cloneRenameClipForReplay,
    splitClip: cloneForReplay,
    restoreClipSplitState: cloneForReplay,
    trimClipStart: cloneTrimClipStartForReplay,
    trimClipEnd: cloneTrimClipEndForReplay,
    restoreAudioClipStartTrim: lowerRestoreAudioClipStartTrim,
    restoreAudioClipSlip: lowerRestoreAudioClipSlip,
    slipClipContent: cloneSlipClipContentForReplay,
    drawClip: cloneForReplay,
    discardDrawnClip: cloneForReplay,
    restoreDrawnClip: cloneForReplay,
    duplicateClipAt: cloneForReplay,
    moveClips: cloneForReplay,
    restoreClipMoves: cloneForReplay,
    addDevice: cloneForReplay,
    bypassDevice: cloneForReplay,
    removeDevice: cloneForReplay,
    restoreDevice: cloneForReplay,
    reorderDevices: cloneForReplay,
    setDeviceParameter: cloneForReplay,
    setExternalPluginState: cloneForReplay,
    setDeviceState: cloneForReplay,
    setFermenterPatch: cloneForReplay,
    setLevainIdentity: cloneForReplay,
    setGrandBouleDeviceState: cloneForReplay,
    setToasterFactoryKit: cloneForReplay,
    setBacteriaFactoryPatch: cloneForReplay,
    setCrustFactoryPreset: cloneForReplay,
    setGlutenFactoryPreset: cloneForReplay,
    setProofPatchSelection: cloneForReplay,
    createBus: cloneForReplay,
    createFolder: cloneForReplay,
    setSend: cloneForReplay,
    setWorkspaceMode: cloneForReplay,
    openPreferencesDialog: cloneForReplay,
    openMixer: cloneForReplay,
    closeMixer: cloneForReplay,
    toggleSidebar: cloneForReplay,
    toggleInspector: cloneForReplay,
    toggleChatPanel: cloneForReplay,
    setTrackInput: cloneForReplay,
    restoreTrackInput: cloneForReplay,
    setEditingTool: cloneForReplay,
    setMarqueeSelection: cloneForReplay,
    addMarker: cloneForReplay,
    removeMarker: cloneForReplay,
    setMarkerColor: cloneForReplay,
    addSection: cloneForReplay,
    removeSection: cloneForReplay,
    renameSection: cloneForReplay,
    renameMarker: cloneForReplay,
    moveMarker: cloneForReplay,
    moveSection: cloneForReplay,
    resizeSection: cloneForReplay,
    setSectionColor: cloneForReplay,
    reorderSection: cloneForReplay,
    navigateSection: cloneForReplay,
    rehearseSection: cloneForReplay,
    restoreSectionBeats: cloneForReplay,
    setClipGainEnvelope: cloneForReplay,
    toggleClipGainEnvelope: cloneForReplay,
    addGainEnvelopePoint: cloneForReplay,
    removeGainEnvelopePoint: cloneForReplay,
    resetClipGainEnvelope: cloneForReplay,
    addModulator: cloneForReplay,
    removeModulator: cloneForReplay,
    updateModulator: cloneForReplay,
    addMapping: cloneForReplay,
    removeMapping: cloneForReplay,
    addAutomationLane: cloneForReplay,
    automateSendRange: cloneForReplay,
    automateSendRanges: cloneForReplay,
    removeSendAutomationRanges: cloneForReplay,
    renderProjectSections: cloneForReplay,
    removeRenderedProjectSections: cloneForReplay,
    automateTrackGainRange: cloneForReplay,
    automateParameterRange: cloneForReplay,
    removeTrackGainAutomationRange: cloneForReplay,
    removeSendAutomationRange: cloneForReplay,
    removeAutomationLane: cloneForReplay,
    setAutomationLaneEnabled: cloneForReplay,
    addAutomationPoint: cloneForReplay,
    insertAutomationLanePoints: cloneForReplay,
    quantizeNotes: cloneForReplay,
    removeShortMidiOverlaps: cloneForReplay,
    createDrumPreviewBranches: cloneForReplay,
    deleteDrumPreviewBranches: cloneForReplay,
    copyMidiArticulations: cloneForReplay,
    restoreMidiClipNotes: cloneForReplay,
    quantizeNoteLengths: cloneForReplay,
    transposeNotes: cloneForReplay,
    humanizeNotes: cloneForReplay,
    invertNotes: cloneForReplay,
    retrogradeNotes: cloneForReplay,
    scaleVelocities: cloneForReplay,
    scaleAllVelocities: cloneForReplay,
    setAllVelocities: cloneForReplay,
    setTrackGain: cloneForReplay,
    setTrackPan: cloneForReplay,
    setTrackColor: cloneForReplay,
    copyClip: cloneForReplay,
    cutClip: cloneForReplay,
    pasteClip: cloneForReplay,
    setClipFade: cloneForReplay,
    importMidiFile: cloneForReplay,
    normalizeClip: cloneForReplay,
    relinkClipAudioSources: cloneForReplay,
    reverseClip: cloneForReplay,
    restoreReversedClip: cloneForReplay,
    glueClips: cloneForReplay,
    restoreClipGlueState: cloneForReplay,
    setCompRegion: cloneForReplay,
    removeCompRegion: cloneForReplay,
    restoreCompRegionInterval: cloneForReplay,
    nudgeClip: cloneNudgeClipForReplay,
    crossfadeClips: cloneForReplay,
    restoreCrossfadeClips: cloneForReplay,
    setClipGain: cloneForReplay,
    setClipColor: cloneForReplay,
    lockClip: cloneForReplay,
    consolidateSelection: cloneForReplay,
    bounceSelection: cloneForReplay,
    seekPlayhead: cloneForReplay,
    setPunchIn: cloneForReplay,
    setPunchOut: cloneForReplay,
    setPunchEnabled: cloneForReplay,
    restorePunchRegion: cloneForReplay,
    togglePunch: cloneForReplay,
    toggleCountIn: cloneForReplay,
    setCountInBars: cloneForReplay,
    togglePreRoll: cloneForReplay,
    setPreRollBars: cloneForReplay,
    zoomTracksVertical: cloneForReplay,
    addTimeSignatureChange: cloneForReplay,
    removeTimeSignatureChange: cloneForReplay,
    setTrackOutput: cloneForReplay,
    addSend: cloneForReplay,
    removeSend: cloneForReplay,
    removeAutomationPoint: cloneForReplay,
    setAutomationMode: cloneForReplay,
    hideTrack: cloneForReplay,
    disableTrack: cloneForReplay,
    restoreTrackDisabled: cloneForReplay,
    setTrackHeight: cloneForReplay,
    setSnapValue: cloneForReplay,
    zoomToFit: cloneForReplay,
    zoomToSelection: cloneForReplay,
    exportProject: cloneForReplay,
    saveProject: cloneForReplay,
    newProject: cloneForReplay,
    importAudioFile: cloneForReplay,
    exportMidi: cloneForReplay,
    foldTrack: cloneForReplay,
    groupTracks: cloneForReplay,
    ungroupTracks: cloneForReplay,
    scaleAutomation: cloneForReplay,
    stretchAutomation: cloneForReplay,
    invertAutomation: cloneForReplay,
    reverseAutomation: cloneForReplay,
    thinAutomation: cloneForReplay,
    quantizeAutomation: cloneForReplay,
    restoreAutomationLanePoints: cloneForReplay,
    restoreAutomationPointPresence: cloneForReplay,
    loadPreset: cloneForReplay,
    restorePresetDeviceChain: cloneForReplay,
    savePreset: cloneForReplay,
    generateDrumPattern: cloneForReplay,
    generateMelody: cloneForReplay,
    generateChordProgression: cloneForReplay,
    setClipLoop: cloneForReplay,
    restoreClipLoop: cloneForReplay,
    setClipLoopLength: cloneForReplay,
    restoreClipLoopLength: cloneForReplay,
    createGrooveTemplate: cloneForReplay,
    renameGrooveTemplate: cloneForReplay,
    restoreGrooveTemplateName: cloneForReplay,
    deleteGrooveTemplate: cloneForReplay,
    restoreDeletedGrooveTemplate: cloneForReplay,
    assignGrooveTemplate: cloneForReplay,
    restoreGrooveAssignment: cloneForReplay,
    extractGroove: cloneForReplay,
    applyGroove: cloneForReplay,
    setClipStretchMode: cloneForReplay,
    setClipStretchRatio: cloneForReplay,
    restoreClipStretchState: cloneForReplay,
    fitClipToBeats: cloneForReplay,
    analyzeMix: cloneForReplay,
    autoFixMix: cloneForReplay,
    enableMpe: cloneForReplay,
    disableMpe: cloneForReplay,
    getLatencyReport: cloneForReplay,
    createCollabSession: cloneForReplay,
    joinCollabSession: cloneForReplay,
    leaveCollabSession: cloneForReplay,
    scanPlugins: cloneForReplay,
    loadExternalPlugin: cloneForReplay,
    audioToMidi: cloneForReplay,
    commitPitchEdit: cloneForReplay,
    restoreClipFileId: cloneForReplay,
    muteClip: cloneForReplay,
    clearSolos: cloneForReplay,
    restoreTrackSoloStates: cloneForReplay,
    setTrackNotes: cloneForReplay,
    deleteTime: cloneForReplay,
    insertTime: cloneForReplay,
    duplicateTimeRange: cloneForReplay,
    restoreTimeOperationState: cloneForReplay,
    restoreTrackHeights: cloneForReplay,
    restoreTrackGroupMemberships: cloneForReplay,
    restoreTracks: cloneForReplay,
    restoreTrackClipStates: cloneForReplay,
    discardCreatedTracks: cloneForReplay,
    discardCreatedCompGroup: cloneForReplay,
    restoreTrackAlternativeState: cloneForReplay,
    restoreScratchPadState: cloneForReplay,
    stripSilence: cloneForReplay,
    restoreStripSilenceState: cloneForReplay,
    detectTempo: cloneForReplay,
    detectKey: cloneForReplay,
    consolidateAllTracks: cloneForReplay,
    arpeggiate: cloneForReplay,
    addSidechainRoute: cloneForReplay,
    removeSidechainRoute: cloneForReplay,
    bounceToNewTrack: cloneForReplay,
    saveTrackTemplate: cloneForReplay,
    loadTrackTemplate: cloneForReplay,
    deleteTrackTemplate: cloneForReplay,
    createProjectFromTemplate: cloneForReplay,
    setProductionBrief: cloneForReplay,
    repairProjectData: cloneForReplay,
    createVcaGroup: cloneForReplay,
    assignToVca: cloneForReplay,
    removeFromVca: cloneForReplay,
    setVcaGain: cloneForReplay,
    restoreLegacyVcaState: cloneForReplay,
    setMidiOutput: cloneForReplay,
    clearMidiOutput: cloneForReplay,
    restoreMidiOutput: cloneForReplay,
    addNotes: cloneForReplay,
    completeMidi: cloneForReplay,
    variationMidi: cloneForReplay,
    generateBassline: cloneForReplay,
    replayGeneratedMidi: cloneForReplay,
    autoOrganizeProject: cloneForReplay,
    addChordEvent: cloneForReplay,
    moveChordEvent: cloneForReplay,
    updateChordEvent: cloneForReplay,
    removeChordEvent: cloneForReplay,
    toggleChordTrack: cloneForReplay,
    clearChordTrack: cloneForReplay,
    restoreChordTrackState: cloneForReplay,
    clearAllMidiMappings: cloneForReplay,
    completeMidiLearn: cloneForReplay,
    removeMidiMapping: cloneForReplay,
    restoreMidiLearnMappings: cloneForReplay,
    toggleScratchPad: cloneForReplay,
    captureScratchPad: cloneForReplay,
    commitScratchPad: cloneForReplay,
    clearScratchPad: cloneForReplay,
    removeScratchPadSection: cloneForReplay,
    renameScratchPadSection: cloneForReplay,
    reorderScratchPadSection: cloneForReplay,
    setScratchPadSectionColor: cloneForReplay,
    createPatternInstance: cloneForReplay,
    detachPatternInstance: cloneForReplay,
    restorePatternInstanceLink: cloneForReplay,
    startMacroRecording: cloneForReplay,
    stopMacroRecording: cloneForReplay,
    playMacro: cloneForReplay,
    deleteMacro: cloneForReplay,
    renameMacro: cloneForReplay,
    undo: cloneForReplay,
    redo: cloneForReplay,
    toggleUndoTree: cloneForReplay,
    labelUndoBranch: cloneForReplay,
    detectSongStructure: cloneForReplay,
    createProjectVersion: cloneForReplay,
    restoreProjectVersion: cloneForReplay,
    createVersionBranch: cloneForReplay,
    generateFill: cloneForReplay,
    generateAllTransitions: cloneForReplay,
    compareToReference: cloneForReplay,
    toggleControlRoomMono: cloneForReplay,
    toggleControlRoomDim: cloneForReplay,
    switchMonitor: cloneForReplay,
    getMentorTips: cloneForReplay,
    searchSamples: cloneForReplay,
    createCompGroup: cloneForReplay,
    togglePunchRecording: cloneForReplay,
    toggleLoopRecord: cloneForReplay,
    triggerScene: cloneForReplay,
    nextSetlistItem: cloneForReplay,
    previousSetlistItem: cloneForReplay,
    createAdjustmentLayer: cloneForReplay,
    removeAdjustmentLayer: cloneForReplay,
    toggleAdjustmentLayer: cloneForReplay,
    setLayerParameter: cloneForReplay,
    setLayerMix: cloneForReplay,
    addAdjustmentRegion: cloneForReplay,
    removeAdjustmentRegion: cloneForReplay,
    moveAdjustmentRegion: cloneForReplay,
    setLayerFades: cloneForReplay,
    setLayerAffectedTracks: cloneForReplay,
    setLayerInsertionIndex: cloneForReplay,
    restoreAdjustmentLayerMutation: cloneForReplay,
    detectTransients: cloneForReplay,
    quantizeTransients: cloneForReplay,
    openElasticEditor: cloneForReplay,
    closeElasticEditor: cloneForReplay,
    elasticSetSensitivity: cloneForReplay,
    elasticAddMarker: cloneForReplay,
    elasticRemoveMarker: cloneForReplay,
    elasticToggleMarkerLock: cloneForReplay,
    elasticSetTool: cloneForReplay,
    toggleNodeView: cloneForReplay,
    setControlSurface: cloneForReplay,
    addCvOutput: cloneForReplay,
    removeCvOutput: cloneForReplay,
    connectPush: cloneForReplay,
    disconnectPush: cloneForReplay,
    exportDawProject: cloneForReplay,
    importDawProject: cloneForReplay,
    loadRaveModel: cloneForReplay,
    setRaveBlend: cloneForReplay,
    enableWarping: cloneForReplay,
    setWarpAlgorithm: cloneForReplay,
    setWarpPitchShift: cloneForReplay,
    setYeastProcessorParam: cloneForReplay,
    setYeastArpPattern: cloneForReplay,
    setYeastProcessorBypass: cloneForReplay,
    addYeastProcessor: cloneForReplay,
    removeYeastProcessor: cloneForReplay,
    reorderYeastProcessor: cloneForReplay,
    commitRecording: cloneForReplay,
    discardRecording: cloneForReplay,
    restoreRecording: cloneForReplay,
    appendOverdubControllers: cloneForReplay,
    removeOverdubControllers: cloneForReplay,
};

function lowerAction<Type extends AppActionType>(
    action: ActionOf<Type>,
    tempoIds: ReadonlyMap<string, string>
): AppAction {
    if (!Object.hasOwn(lowerByActionType, action.type)) {
        return cloneForReplay(action);
    }
    return lowerByActionType[action.type](action, tempoIds);
}

/** Exact history captures supply intent to macros, never authority over today's source owners. */
export function lowerSourceMacroAction(action: AppAction, tempoIds: ReadonlyMap<string, string>): AppAction {
    return lowerAction(action, tempoIds);
}
