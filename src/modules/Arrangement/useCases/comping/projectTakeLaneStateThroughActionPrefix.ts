import { type AppAction, type AppActionType } from '#/utils/handlerContract';

import { decodeExactTakeLaneSnapshots } from '../../stores/takeLaneStore';
import {
    applyTakeLaneCompRegionPatch,
    type TakeLaneCompRegionPatch,
    type TakeLaneStoreValue,
} from '../../stores/takeLaneWriteJournal';
import { liveTempoTimeline } from '../liveTempoTimeline';

import { captureCompAudioSourceAuthorizations } from './captureCompAudioSourceAuthorizations';
import { compRegionPatchFromState } from './captureCompRegionPatchFromState';
import { compRegionIntervalValidation } from './compRegionIntervalValidation';
import { sourceInputsAfterPrefix, type TakeLanePrefixContext } from './compSourcePlan';
import { originalMidiTakeRowReplacement } from './prepareOriginalMidiTakeRowReplacement';
import { takeLaneSelection } from './takeLaneSelection';

const { captureCompRegionIntervalPatchFromState, captureRemovedCompRegionPatchFromState } = compRegionPatchFromState;

const { captureOriginalMidiTakeRowCopies, prepareOriginalMidiTakeRowReplacement } = originalMidiTakeRowReplacement;

const {
    isCompleteSetCompRegionPayload,
    isCompleteRemoveCompRegionPayload,
    isCompleteRestoreCompRegionIntervalPayload,
} = compRegionIntervalValidation;

type ActionOf<Type extends AppActionType> = Extract<AppAction, { type: Type }>;

type PrefixStep = {
    readonly context: TakeLanePrefixContext;
    readonly actionIndex: number;
    readonly mode: 'capture' | 'validate';
};

function canAppendRestoredLanes(state: TakeLaneStoreValue, restoredLanes: TakeLaneStoreValue['lanes']): boolean {
    const laneIds = new Set(state.lanes.map((lane) => lane.id));
    const trackIds = new Set(state.lanes.map((lane) => lane.trackId));
    for (const lane of restoredLanes) {
        if (laneIds.has(lane.id) || trackIds.has(lane.trackId)) {
            return false;
        }
        laneIds.add(lane.id);
        trackIds.add(lane.trackId);
    }
    return true;
}

function keepLanes(_action: unknown, state: TakeLaneStoreValue, _step: PrefixStep): TakeLaneStoreValue {
    return state;
}

function selectTakeStep(action: ActionOf<'selectTake'>, state: TakeLaneStoreValue): TakeLaneStoreValue | null {
    return takeLaneSelection.apply(state, action) ?? null;
}

function replaceOriginalMidiTakeRowStep(
    action: ActionOf<'replaceOriginalMidiTakeRow'>,
    state: TakeLaneStoreValue
): TakeLaneStoreValue | null {
    let copyScope: typeof action.payload.copyScope | null = action.payload.copyScope;
    if (copyScope === 'capture') {
        copyScope = captureOriginalMidiTakeRowCopies(action.payload, state);
    }
    if (!copyScope) {
        return null;
    }
    return prepareOriginalMidiTakeRowReplacement({ ...action.payload, copyScope }, state);
}

function removeTrackLanesStep(action: ActionOf<'removeTrack'>, state: TakeLaneStoreValue): TakeLaneStoreValue {
    return { lanes: state.lanes.filter((lane) => lane.trackId !== action.payload.trackId) };
}

function restoreTrackLanesStep(action: ActionOf<'restoreTrack'>, state: TakeLaneStoreValue): TakeLaneStoreValue | null {
    const restoredLanes = decodeExactTakeLaneSnapshots(action.payload.takeLaneSnapshots);
    if (!restoredLanes || !canAppendRestoredLanes(state, restoredLanes)) {
        return null;
    }
    return { lanes: [...state.lanes, ...restoredLanes] };
}

function applyCompPatchStep(
    state: TakeLaneStoreValue,
    patch: TakeLaneCompRegionPatch | null,
    step: PrefixStep
): TakeLaneStoreValue | null {
    if (!patch) {
        return null;
    }
    const sourcePlan = sourceInputsAfterPrefix(patch.trackId, step.context, step.actionIndex);
    if (!sourcePlan) {
        return null;
    }
    const authorizations = captureCompAudioSourceAuthorizations(
        state,
        patch,
        sourcePlan.clips,
        liveTempoTimeline,
        sourcePlan.inputs
    );
    if (!authorizations) {
        return null;
    }
    return applyTakeLaneCompRegionPatch(state, patch, sourcePlan.inputs, authorizations);
}

function setCompRegionStep(
    action: ActionOf<'setCompRegion'>,
    state: TakeLaneStoreValue,
    step: PrefixStep
): TakeLaneStoreValue | null {
    if (step.mode === 'capture') {
        const sourcePlan = sourceInputsAfterPrefix(action.payload.trackId, step.context, step.actionIndex);
        return applyCompPatchStep(
            state,
            captureCompRegionIntervalPatchFromState(state, action.payload, sourcePlan),
            step
        );
    }
    return applyCompPatchStep(state, isCompleteSetCompRegionPayload(action.payload) ? action.payload : null, step);
}

function removeCompRegionStep(
    action: ActionOf<'removeCompRegion'>,
    state: TakeLaneStoreValue,
    step: PrefixStep
): TakeLaneStoreValue | null {
    if (step.mode === 'capture') {
        const sourcePlan = sourceInputsAfterPrefix(action.payload.trackId, step.context, step.actionIndex);
        return applyCompPatchStep(
            state,
            captureRemovedCompRegionPatchFromState(state, action.payload, sourcePlan),
            step
        );
    }
    return applyCompPatchStep(state, isCompleteRemoveCompRegionPayload(action.payload) ? action.payload : null, step);
}

function restoreCompRegionIntervalStep(
    action: ActionOf<'restoreCompRegionInterval'>,
    state: TakeLaneStoreValue,
    step: PrefixStep
): TakeLaneStoreValue | null {
    return applyCompPatchStep(
        state,
        isCompleteRestoreCompRegionIntervalPayload(action.payload) ? action.payload : null,
        step
    );
}

// Every action type states how the take-lane prefix projects it: a new action does not compile until it does.
const projectTakeLaneActionByActionType: {
    readonly [Type in AppActionType]: (
        action: ActionOf<Type>,
        state: TakeLaneStoreValue,
        step: PrefixStep
    ) => TakeLaneStoreValue | null;
} = {
    importStemSet: keepLanes,
    discardImportedStemSet: keepLanes,
    addTrack: keepLanes,
    removeTrack: removeTrackLanesStep,
    discardCreatedTrack: keepLanes,
    restoreTrack: restoreTrackLanesStep,
    restoreClip: keepLanes,
    discardDuplicatedClip: keepLanes,
    removeAllTracks: keepLanes,
    renameTrack: keepLanes,
    createTrackAlternative: keepLanes,
    switchTrackAlternative: keepLanes,
    renameTrackAlternative: keepLanes,
    deleteTrackAlternative: keepLanes,
    selectTrack: keepLanes,
    muteTrack: keepLanes,
    soloTrack: keepLanes,
    selectTake: selectTakeStep,
    replaceOriginalMidiTakeRow: replaceOriginalMidiTakeRowStep,
    replaceOriginalMidiBaseRow: keepLanes,
    toggleSoloSafe: keepLanes,
    setSoloSafe: keepLanes,
    restoreSoloSafe: keepLanes,
    armTrack: keepLanes,
    freezeTrack: keepLanes,
    unfreezeTrack: keepLanes,
    restoreFreezeState: keepLanes,
    flattenTrack: keepLanes,
    bounceInPlace: keepLanes,
    reorderTrack: keepLanes,
    setTempo: keepLanes,
    restoreTempoEdit: keepLanes,
    editTempoMap: keepLanes,
    restoreTempoMapEdit: keepLanes,
    setTimeSignature: keepLanes,
    setPlayback: keepLanes,
    togglePlayback: keepLanes,
    stopPlayback: keepLanes,
    toggleRecording: keepLanes,
    setMasterGain: keepLanes,
    restoreMasterGain: keepLanes,
    toggleLoop: keepLanes,
    toggleMetronome: keepLanes,
    setMetronomeVolume: keepLanes,
    setLoopRegion: keepLanes,
    setLoopEnabled: keepLanes,
    setMetronomeEnabled: keepLanes,
    restoreLoopRegion: keepLanes,
    addClip: keepLanes,
    moveClip: keepLanes,
    restoreClipPlacement: keepLanes,
    duplicateClip: keepLanes,
    duplicateClipToNextBar: keepLanes,
    duplicateTrack: keepLanes,
    removeClip: keepLanes,
    renameClip: keepLanes,
    splitClip: keepLanes,
    restoreClipSplitState: keepLanes,
    trimClipStart: keepLanes,
    trimClipEnd: keepLanes,
    restoreAudioClipStartTrim: keepLanes,
    restoreAudioClipSlip: keepLanes,
    slipClipContent: keepLanes,
    drawClip: keepLanes,
    discardDrawnClip: keepLanes,
    restoreDrawnClip: keepLanes,
    duplicateClipAt: keepLanes,
    moveClips: keepLanes,
    restoreClipMoves: keepLanes,
    addDevice: keepLanes,
    bypassDevice: keepLanes,
    removeDevice: keepLanes,
    restoreDevice: keepLanes,
    reorderDevices: keepLanes,
    setDeviceParameter: keepLanes,
    setExternalPluginState: keepLanes,
    setDeviceState: keepLanes,
    setFermenterPatch: keepLanes,
    setLevainIdentity: keepLanes,
    setGrandBouleDeviceState: keepLanes,
    setToasterFactoryKit: keepLanes,
    setBacteriaFactoryPatch: keepLanes,
    setGlutenFactoryPreset: keepLanes,
    setProofPatchSelection: keepLanes,
    createBus: keepLanes,
    createFolder: keepLanes,
    setSend: keepLanes,
    setWorkspaceMode: keepLanes,
    openPreferencesDialog: keepLanes,
    openMixer: keepLanes,
    closeMixer: keepLanes,
    toggleSidebar: keepLanes,
    toggleInspector: keepLanes,
    toggleChatPanel: keepLanes,
    setTrackInput: keepLanes,
    restoreTrackInput: keepLanes,
    setEditingTool: keepLanes,
    setMarqueeSelection: keepLanes,
    addMarker: keepLanes,
    removeMarker: keepLanes,
    setMarkerColor: keepLanes,
    addSection: keepLanes,
    removeSection: keepLanes,
    renameSection: keepLanes,
    renameMarker: keepLanes,
    moveMarker: keepLanes,
    moveSection: keepLanes,
    resizeSection: keepLanes,
    setSectionColor: keepLanes,
    reorderSection: keepLanes,
    navigateSection: keepLanes,
    rehearseSection: keepLanes,
    restoreSectionBeats: keepLanes,
    setClipGainEnvelope: keepLanes,
    toggleClipGainEnvelope: keepLanes,
    addGainEnvelopePoint: keepLanes,
    removeGainEnvelopePoint: keepLanes,
    resetClipGainEnvelope: keepLanes,
    addModulator: keepLanes,
    removeModulator: keepLanes,
    updateModulator: keepLanes,
    addMapping: keepLanes,
    removeMapping: keepLanes,
    addAutomationLane: keepLanes,
    automateSendRange: keepLanes,
    automateSendRanges: keepLanes,
    removeSendAutomationRanges: keepLanes,
    renderProjectSections: keepLanes,
    removeRenderedProjectSections: keepLanes,
    automateTrackGainRange: keepLanes,
    automateParameterRange: keepLanes,
    removeTrackGainAutomationRange: keepLanes,
    removeSendAutomationRange: keepLanes,
    removeAutomationLane: keepLanes,
    setAutomationLaneEnabled: keepLanes,
    addAutomationPoint: keepLanes,
    insertAutomationLanePoints: keepLanes,
    quantizeNotes: keepLanes,
    removeShortMidiOverlaps: keepLanes,
    createDrumPreviewBranches: keepLanes,
    deleteDrumPreviewBranches: keepLanes,
    copyMidiArticulations: keepLanes,
    restoreMidiClipNotes: keepLanes,
    quantizeNoteLengths: keepLanes,
    transposeNotes: keepLanes,
    humanizeNotes: keepLanes,
    invertNotes: keepLanes,
    retrogradeNotes: keepLanes,
    scaleVelocities: keepLanes,
    scaleAllVelocities: keepLanes,
    setAllVelocities: keepLanes,
    setTrackGain: keepLanes,
    setTrackPan: keepLanes,
    setTrackColor: keepLanes,
    copyClip: keepLanes,
    cutClip: keepLanes,
    pasteClip: keepLanes,
    setClipFade: keepLanes,
    importMidiFile: keepLanes,
    normalizeClip: keepLanes,
    reverseClip: keepLanes,
    restoreReversedClip: keepLanes,
    relinkClipAudioSources: keepLanes,
    glueClips: keepLanes,
    restoreClipGlueState: keepLanes,
    setCompRegion: setCompRegionStep,
    removeCompRegion: removeCompRegionStep,
    restoreCompRegionInterval: restoreCompRegionIntervalStep,
    nudgeClip: keepLanes,
    crossfadeClips: keepLanes,
    restoreCrossfadeClips: keepLanes,
    setClipGain: keepLanes,
    setClipColor: keepLanes,
    lockClip: keepLanes,
    consolidateSelection: keepLanes,
    bounceSelection: keepLanes,
    seekPlayhead: keepLanes,
    setPunchIn: keepLanes,
    setPunchOut: keepLanes,
    setPunchEnabled: keepLanes,
    restorePunchRegion: keepLanes,
    togglePunch: keepLanes,
    toggleCountIn: keepLanes,
    setCountInBars: keepLanes,
    togglePreRoll: keepLanes,
    setPreRollBars: keepLanes,
    zoomTracksVertical: keepLanes,
    addTimeSignatureChange: keepLanes,
    removeTimeSignatureChange: keepLanes,
    setTrackOutput: keepLanes,
    addSend: keepLanes,
    removeSend: keepLanes,
    removeAutomationPoint: keepLanes,
    setAutomationMode: keepLanes,
    hideTrack: keepLanes,
    disableTrack: keepLanes,
    restoreTrackDisabled: keepLanes,
    setTrackHeight: keepLanes,
    setSnapValue: keepLanes,
    zoomToFit: keepLanes,
    zoomToSelection: keepLanes,
    exportProject: keepLanes,
    saveProject: keepLanes,
    newProject: keepLanes,
    importAudioFile: keepLanes,
    exportMidi: keepLanes,
    foldTrack: keepLanes,
    groupTracks: keepLanes,
    ungroupTracks: keepLanes,
    scaleAutomation: keepLanes,
    stretchAutomation: keepLanes,
    invertAutomation: keepLanes,
    reverseAutomation: keepLanes,
    thinAutomation: keepLanes,
    quantizeAutomation: keepLanes,
    restoreAutomationLanePoints: keepLanes,
    restoreAutomationPointPresence: keepLanes,
    loadPreset: keepLanes,
    restorePresetDeviceChain: keepLanes,
    savePreset: keepLanes,
    generateDrumPattern: keepLanes,
    generateMelody: keepLanes,
    generateChordProgression: keepLanes,
    setClipLoop: keepLanes,
    restoreClipLoop: keepLanes,
    setClipLoopLength: keepLanes,
    restoreClipLoopLength: keepLanes,
    createGrooveTemplate: keepLanes,
    renameGrooveTemplate: keepLanes,
    restoreGrooveTemplateName: keepLanes,
    deleteGrooveTemplate: keepLanes,
    restoreDeletedGrooveTemplate: keepLanes,
    assignGrooveTemplate: keepLanes,
    restoreGrooveAssignment: keepLanes,
    extractGroove: keepLanes,
    applyGroove: keepLanes,
    setClipStretchMode: keepLanes,
    setClipStretchRatio: keepLanes,
    restoreClipStretchState: keepLanes,
    fitClipToBeats: keepLanes,
    analyzeMix: keepLanes,
    autoFixMix: keepLanes,
    enableMpe: keepLanes,
    disableMpe: keepLanes,
    getLatencyReport: keepLanes,
    createCollabSession: keepLanes,
    joinCollabSession: keepLanes,
    leaveCollabSession: keepLanes,
    scanPlugins: keepLanes,
    loadExternalPlugin: keepLanes,
    audioToMidi: keepLanes,
    commitPitchEdit: keepLanes,
    restoreClipFileId: keepLanes,
    muteClip: keepLanes,
    clearSolos: keepLanes,
    restoreTrackSoloStates: keepLanes,
    setTrackNotes: keepLanes,
    deleteTime: keepLanes,
    insertTime: keepLanes,
    duplicateTimeRange: keepLanes,
    restoreTimeOperationState: keepLanes,
    restoreTrackHeights: keepLanes,
    restoreTrackGroupMemberships: keepLanes,
    restoreTracks: keepLanes,
    restoreTrackClipStates: keepLanes,
    discardCreatedTracks: keepLanes,
    discardCreatedCompGroup: keepLanes,
    restoreTrackAlternativeState: keepLanes,
    restoreScratchPadState: keepLanes,
    stripSilence: keepLanes,
    restoreStripSilenceState: keepLanes,
    detectTempo: keepLanes,
    detectKey: keepLanes,
    consolidateAllTracks: keepLanes,
    arpeggiate: keepLanes,
    addSidechainRoute: keepLanes,
    removeSidechainRoute: keepLanes,
    bounceToNewTrack: keepLanes,
    saveTrackTemplate: keepLanes,
    loadTrackTemplate: keepLanes,
    deleteTrackTemplate: keepLanes,
    createProjectFromTemplate: keepLanes,
    setProductionBrief: keepLanes,
    repairProjectData: keepLanes,
    createVcaGroup: keepLanes,
    assignToVca: keepLanes,
    removeFromVca: keepLanes,
    setVcaGain: keepLanes,
    restoreLegacyVcaState: keepLanes,
    setMidiOutput: keepLanes,
    clearMidiOutput: keepLanes,
    restoreMidiOutput: keepLanes,
    addNotes: keepLanes,
    completeMidi: keepLanes,
    variationMidi: keepLanes,
    generateBassline: keepLanes,
    replayGeneratedMidi: keepLanes,
    stemSeparate: keepLanes,
    autoOrganizeProject: keepLanes,
    addChordEvent: keepLanes,
    moveChordEvent: keepLanes,
    updateChordEvent: keepLanes,
    removeChordEvent: keepLanes,
    toggleChordTrack: keepLanes,
    clearChordTrack: keepLanes,
    restoreChordTrackState: keepLanes,
    clearAllMidiMappings: keepLanes,
    completeMidiLearn: keepLanes,
    removeMidiMapping: keepLanes,
    restoreMidiLearnMappings: keepLanes,
    toggleScratchPad: keepLanes,
    captureScratchPad: keepLanes,
    commitScratchPad: keepLanes,
    clearScratchPad: keepLanes,
    removeScratchPadSection: keepLanes,
    renameScratchPadSection: keepLanes,
    reorderScratchPadSection: keepLanes,
    setScratchPadSectionColor: keepLanes,
    createPatternInstance: keepLanes,
    detachPatternInstance: keepLanes,
    restorePatternInstanceLink: keepLanes,
    startMacroRecording: keepLanes,
    stopMacroRecording: keepLanes,
    playMacro: keepLanes,
    deleteMacro: keepLanes,
    renameMacro: keepLanes,
    undo: keepLanes,
    redo: keepLanes,
    toggleUndoTree: keepLanes,
    labelUndoBranch: keepLanes,
    detectSongStructure: keepLanes,
    createProjectVersion: keepLanes,
    restoreProjectVersion: keepLanes,
    createVersionBranch: keepLanes,
    generateFill: keepLanes,
    generateAllTransitions: keepLanes,
    compareToReference: keepLanes,
    toggleControlRoomMono: keepLanes,
    toggleControlRoomDim: keepLanes,
    switchMonitor: keepLanes,
    getMentorTips: keepLanes,
    searchSamples: keepLanes,
    createCompGroup: keepLanes,
    togglePunchRecording: keepLanes,
    toggleLoopRecord: keepLanes,
    triggerScene: keepLanes,
    nextSetlistItem: keepLanes,
    previousSetlistItem: keepLanes,
    createAdjustmentLayer: keepLanes,
    removeAdjustmentLayer: keepLanes,
    toggleAdjustmentLayer: keepLanes,
    setLayerParameter: keepLanes,
    setLayerMix: keepLanes,
    addAdjustmentRegion: keepLanes,
    removeAdjustmentRegion: keepLanes,
    moveAdjustmentRegion: keepLanes,
    setLayerFades: keepLanes,
    setLayerAffectedTracks: keepLanes,
    setLayerInsertionIndex: keepLanes,
    restoreAdjustmentLayerMutation: keepLanes,
    detectTransients: keepLanes,
    quantizeTransients: keepLanes,
    openElasticEditor: keepLanes,
    closeElasticEditor: keepLanes,
    elasticSetSensitivity: keepLanes,
    elasticAddMarker: keepLanes,
    elasticRemoveMarker: keepLanes,
    elasticToggleMarkerLock: keepLanes,
    elasticSetTool: keepLanes,
    toggleNodeView: keepLanes,
    setControlSurface: keepLanes,
    addCvOutput: keepLanes,
    removeCvOutput: keepLanes,
    connectPush: keepLanes,
    disconnectPush: keepLanes,
    exportDawProject: keepLanes,
    importDawProject: keepLanes,
    loadRaveModel: keepLanes,
    setRaveBlend: keepLanes,
    enableWarping: keepLanes,
    setWarpAlgorithm: keepLanes,
    setWarpPitchShift: keepLanes,
    setYeastProcessorParam: keepLanes,
    setYeastArpPattern: keepLanes,
    setYeastProcessorBypass: keepLanes,
    addYeastProcessor: keepLanes,
    removeYeastProcessor: keepLanes,
    reorderYeastProcessor: keepLanes,
    commitRecording: keepLanes,
    discardRecording: keepLanes,
    restoreRecording: keepLanes,
    appendOverdubControllers: keepLanes,
    removeOverdubControllers: keepLanes,
};

function projectAction<Type extends AppActionType>(
    action: ActionOf<Type>,
    state: TakeLaneStoreValue,
    step: PrefixStep
): TakeLaneStoreValue | null {
    if (!Object.hasOwn(projectTakeLaneActionByActionType, action.type)) {
        return keepLanes(action, state, step);
    }
    return projectTakeLaneActionByActionType[action.type](action, state, step);
}

export function projectTakeLaneStateThroughActionPrefix(
    initialState: TakeLaneStoreValue,
    context: TakeLanePrefixContext | undefined,
    mode: 'capture' | 'validate'
): TakeLaneStoreValue | null {
    if (!context) {
        return initialState;
    }
    let state = structuredClone(initialState);
    const prefix = (context.preparedPrefix ?? context.actions).slice(0, context.actionIndex);
    for (const [actionIndex, action] of prefix.entries()) {
        const next = projectAction(action, state, { context, actionIndex, mode });
        if (!next) {
            return null;
        }
        state = next;
    }
    return state;
}
