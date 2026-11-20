import { type AppAction, type AppActionType, type HandlerValidationContext } from '#/utils/handlerContract';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

import { planDevicePatchWrite } from '../../models/DevicePatchWritePlan';
import { readPlannedDeviceOwnerSource } from '../../models/PlannedDeviceOwnerSource';
import { type PlannedDevicePresence, type PlannedDeviceWriteStep } from '../../models/PlannedDeviceWrite';
import { getPlatformPlugins } from '../getPlatformPlugins';
import { getTrackStoreState } from '../getTrackStoreState';

type Input = {
    deviceId: string;
    trackId?: string;
    parameterIds: readonly string[];
    context?: HandlerValidationContext;
};

type ActionOf<Type extends AppActionType> = Extract<AppAction, { type: Type }>;

function commandStep(action: AppAction): PlannedDeviceWriteStep {
    return { kind: 'command', action };
}

function fermenterPatchStep(action: ActionOf<'setFermenterPatch'>): PlannedDeviceWriteStep {
    return {
        kind: 'patch',
        trackId: action.payload.expectedTrackId,
        deviceId: action.payload.deviceId,
        expectedDeviceIds: action.payload.expectedDeviceIds,
        expectedTrackFrozen: action.payload.expectedTrackFrozen,
        expected: action.payload.expectedProject,
        after: action.payload.afterProject,
    };
}

function toasterKitStep(action: ActionOf<'setToasterFactoryKit'>): PlannedDeviceWriteStep {
    const { trackId, deviceId, deviceIds, before, after } = action.payload;
    return {
        kind: 'patch',
        trackId,
        deviceId,
        expectedDeviceIds: deviceIds,
        expectedTrackFrozen: false,
        expectedDeviceType: DEVICE_TYPE_IDS.toaster,
        expected: { deviceState: before, parameterValues: {} },
        after: { deviceState: after, parameterValues: {} },
    };
}

function restoredTrackStep(action: ActionOf<'restoreTrack'>, trackIds: Set<string>): PlannedDeviceWriteStep | null {
    const owner = readPlannedDeviceOwnerSource(action.payload.trackSnapshot);
    if (!owner || owner.id !== action.payload.trackId) {
        return null;
    }
    trackIds.add(owner.id);
    return { kind: 'restore-owner', source: owner };
}

function addedTrackStep(action: ActionOf<'addTrack'>, trackIds: Set<string>): PlannedDeviceWriteStep {
    if (action.payload.id) {
        trackIds.add(action.payload.id);
    }
    return commandStep(action);
}

function createdBusStep(action: ActionOf<'createBus'>, trackIds: Set<string>): PlannedDeviceWriteStep {
    if (action.payload.busId) {
        trackIds.add(action.payload.busId);
    }
    return commandStep(action);
}

// Every action type states how a prior sibling enters the plan: a new action does not compile until it does.
// A null step means the prior action cannot be planned, which abandons the whole plan.
export const plannedDeviceWriteStepByActionType: {
    readonly [Type in AppActionType]: (action: ActionOf<Type>, trackIds: Set<string>) => PlannedDeviceWriteStep | null;
} = {
    importStemSet: commandStep,
    discardImportedStemSet: commandStep,
    addTrack: addedTrackStep,
    removeTrack: commandStep,
    discardCreatedTrack: commandStep,
    restoreTrack: restoredTrackStep,
    restoreClip: commandStep,
    discardDuplicatedClip: commandStep,
    removeAllTracks: commandStep,
    renameTrack: commandStep,
    createTrackAlternative: commandStep,
    switchTrackAlternative: commandStep,
    renameTrackAlternative: commandStep,
    deleteTrackAlternative: commandStep,
    selectTrack: commandStep,
    muteTrack: commandStep,
    soloTrack: commandStep,
    selectTake: commandStep,
    replaceOriginalMidiTakeRow: commandStep,
    replaceOriginalMidiBaseRow: commandStep,
    toggleSoloSafe: commandStep,
    setSoloSafe: commandStep,
    restoreSoloSafe: commandStep,
    armTrack: commandStep,
    freezeTrack: commandStep,
    unfreezeTrack: commandStep,
    restoreFreezeState: commandStep,
    flattenTrack: commandStep,
    bounceInPlace: commandStep,
    reorderTrack: commandStep,
    setTempo: commandStep,
    restoreTempoEdit: commandStep,
    editTempoMap: commandStep,
    restoreTempoMapEdit: commandStep,
    setTimeSignature: commandStep,
    setPlayback: commandStep,
    togglePlayback: commandStep,
    stopPlayback: commandStep,
    toggleRecording: commandStep,
    setMasterGain: commandStep,
    restoreMasterGain: commandStep,
    toggleLoop: commandStep,
    toggleMetronome: commandStep,
    setMetronomeVolume: commandStep,
    setLoopRegion: commandStep,
    setLoopEnabled: commandStep,
    setMetronomeEnabled: commandStep,
    restoreLoopRegion: commandStep,
    addClip: commandStep,
    moveClip: commandStep,
    restoreClipPlacement: commandStep,
    duplicateClip: commandStep,
    duplicateClipToNextBar: commandStep,
    duplicateTrack: commandStep,
    removeClip: commandStep,
    renameClip: commandStep,
    splitClip: commandStep,
    restoreClipSplitState: commandStep,
    trimClipStart: commandStep,
    trimClipEnd: commandStep,
    restoreAudioClipStartTrim: commandStep,
    restoreAudioClipSlip: commandStep,
    slipClipContent: commandStep,
    drawClip: commandStep,
    discardDrawnClip: commandStep,
    restoreDrawnClip: commandStep,
    duplicateClipAt: commandStep,
    moveClips: commandStep,
    restoreClipMoves: commandStep,
    addDevice: commandStep,
    bypassDevice: commandStep,
    removeDevice: commandStep,
    restoreDevice: commandStep,
    reorderDevices: commandStep,
    setDeviceParameter: commandStep,
    setExternalPluginState: commandStep,
    setDeviceState: commandStep,
    setFermenterPatch: fermenterPatchStep,
    setGlutenFactoryPreset: commandStep,
    setGrandBouleDeviceState: commandStep,
    setToasterFactoryKit: toasterKitStep,
    createBus: createdBusStep,
    createFolder: commandStep,
    setSend: commandStep,
    setWorkspaceMode: commandStep,
    openPreferencesDialog: commandStep,
    openMixer: commandStep,
    closeMixer: commandStep,
    toggleSidebar: commandStep,
    toggleInspector: commandStep,
    toggleChatPanel: commandStep,
    setTrackInput: commandStep,
    restoreTrackInput: commandStep,
    setEditingTool: commandStep,
    setMarqueeSelection: commandStep,
    addMarker: commandStep,
    removeMarker: commandStep,
    setMarkerColor: commandStep,
    addSection: commandStep,
    removeSection: commandStep,
    renameSection: commandStep,
    renameMarker: commandStep,
    moveMarker: commandStep,
    moveSection: commandStep,
    resizeSection: commandStep,
    setSectionColor: commandStep,
    reorderSection: commandStep,
    navigateSection: commandStep,
    rehearseSection: commandStep,
    restoreSectionBeats: commandStep,
    setClipGainEnvelope: commandStep,
    toggleClipGainEnvelope: commandStep,
    addGainEnvelopePoint: commandStep,
    removeGainEnvelopePoint: commandStep,
    resetClipGainEnvelope: commandStep,
    addModulator: commandStep,
    removeModulator: commandStep,
    updateModulator: commandStep,
    addMapping: commandStep,
    removeMapping: commandStep,
    addAutomationLane: commandStep,
    automateSendRange: commandStep,
    automateSendRanges: commandStep,
    removeSendAutomationRanges: commandStep,
    renderProjectSections: commandStep,
    removeRenderedProjectSections: commandStep,
    automateTrackGainRange: commandStep,
    automateParameterRange: commandStep,
    removeTrackGainAutomationRange: commandStep,
    removeSendAutomationRange: commandStep,
    removeAutomationLane: commandStep,
    setAutomationLaneEnabled: commandStep,
    addAutomationPoint: commandStep,
    insertAutomationLanePoints: commandStep,
    quantizeNotes: commandStep,
    removeShortMidiOverlaps: commandStep,
    createDrumPreviewBranches: commandStep,
    deleteDrumPreviewBranches: commandStep,
    copyMidiArticulations: commandStep,
    restoreMidiClipNotes: commandStep,
    quantizeNoteLengths: commandStep,
    transposeNotes: commandStep,
    humanizeNotes: commandStep,
    invertNotes: commandStep,
    retrogradeNotes: commandStep,
    scaleVelocities: commandStep,
    scaleAllVelocities: commandStep,
    setAllVelocities: commandStep,
    setTrackGain: commandStep,
    setTrackPan: commandStep,
    setTrackColor: commandStep,
    copyClip: commandStep,
    cutClip: commandStep,
    pasteClip: commandStep,
    setClipFade: commandStep,
    importMidiFile: commandStep,
    normalizeClip: commandStep,
    relinkClipAudioSources: commandStep,
    reverseClip: commandStep,
    restoreReversedClip: commandStep,
    glueClips: commandStep,
    restoreClipGlueState: commandStep,
    setCompRegion: commandStep,
    removeCompRegion: commandStep,
    restoreCompRegionInterval: commandStep,
    nudgeClip: commandStep,
    crossfadeClips: commandStep,
    restoreCrossfadeClips: commandStep,
    setClipGain: commandStep,
    setClipColor: commandStep,
    lockClip: commandStep,
    consolidateSelection: commandStep,
    bounceSelection: commandStep,
    seekPlayhead: commandStep,
    setPunchIn: commandStep,
    setPunchOut: commandStep,
    setPunchEnabled: commandStep,
    restorePunchRegion: commandStep,
    togglePunch: commandStep,
    toggleCountIn: commandStep,
    setCountInBars: commandStep,
    togglePreRoll: commandStep,
    setPreRollBars: commandStep,
    zoomTracksVertical: commandStep,
    addTimeSignatureChange: commandStep,
    removeTimeSignatureChange: commandStep,
    setTrackOutput: commandStep,
    addSend: commandStep,
    removeSend: commandStep,
    removeAutomationPoint: commandStep,
    setAutomationMode: commandStep,
    hideTrack: commandStep,
    disableTrack: commandStep,
    restoreTrackDisabled: commandStep,
    setTrackHeight: commandStep,
    setSnapValue: commandStep,
    zoomToFit: commandStep,
    zoomToSelection: commandStep,
    exportProject: commandStep,
    saveProject: commandStep,
    newProject: commandStep,
    importAudioFile: commandStep,
    exportMidi: commandStep,
    foldTrack: commandStep,
    groupTracks: commandStep,
    ungroupTracks: commandStep,
    scaleAutomation: commandStep,
    stretchAutomation: commandStep,
    invertAutomation: commandStep,
    reverseAutomation: commandStep,
    thinAutomation: commandStep,
    quantizeAutomation: commandStep,
    restoreAutomationLanePoints: commandStep,
    restoreAutomationPointPresence: commandStep,
    loadPreset: commandStep,
    restorePresetDeviceChain: commandStep,
    savePreset: commandStep,
    generateDrumPattern: commandStep,
    generateMelody: commandStep,
    generateChordProgression: commandStep,
    setClipLoop: commandStep,
    restoreClipLoop: commandStep,
    setClipLoopLength: commandStep,
    restoreClipLoopLength: commandStep,
    createGrooveTemplate: commandStep,
    renameGrooveTemplate: commandStep,
    restoreGrooveTemplateName: commandStep,
    deleteGrooveTemplate: commandStep,
    restoreDeletedGrooveTemplate: commandStep,
    assignGrooveTemplate: commandStep,
    restoreGrooveAssignment: commandStep,
    extractGroove: commandStep,
    applyGroove: commandStep,
    setClipStretchMode: commandStep,
    setClipStretchRatio: commandStep,
    restoreClipStretchState: commandStep,
    fitClipToBeats: commandStep,
    analyzeMix: commandStep,
    autoFixMix: commandStep,
    enableMpe: commandStep,
    disableMpe: commandStep,
    getLatencyReport: commandStep,
    createCollabSession: commandStep,
    joinCollabSession: commandStep,
    leaveCollabSession: commandStep,
    scanPlugins: commandStep,
    loadExternalPlugin: commandStep,
    audioToMidi: commandStep,
    commitPitchEdit: commandStep,
    restoreClipFileId: commandStep,
    muteClip: commandStep,
    clearSolos: commandStep,
    restoreTrackSoloStates: commandStep,
    setTrackNotes: commandStep,
    deleteTime: commandStep,
    insertTime: commandStep,
    duplicateTimeRange: commandStep,
    restoreTimeOperationState: commandStep,
    restoreTrackHeights: commandStep,
    restoreTrackGroupMemberships: commandStep,
    restoreTracks: commandStep,
    restoreTrackClipStates: commandStep,
    discardCreatedTracks: commandStep,
    discardCreatedCompGroup: commandStep,
    restoreTrackAlternativeState: commandStep,
    restoreScratchPadState: commandStep,
    stripSilence: commandStep,
    restoreStripSilenceState: commandStep,
    detectTempo: commandStep,
    detectKey: commandStep,
    consolidateAllTracks: commandStep,
    arpeggiate: commandStep,
    addSidechainRoute: commandStep,
    removeSidechainRoute: commandStep,
    bounceToNewTrack: commandStep,
    saveTrackTemplate: commandStep,
    loadTrackTemplate: commandStep,
    deleteTrackTemplate: commandStep,
    createProjectFromTemplate: commandStep,
    setProductionBrief: commandStep,
    repairProjectData: commandStep,
    createVcaGroup: commandStep,
    assignToVca: commandStep,
    removeFromVca: commandStep,
    setVcaGain: commandStep,
    restoreLegacyVcaState: commandStep,
    setMidiOutput: commandStep,
    clearMidiOutput: commandStep,
    restoreMidiOutput: commandStep,
    addNotes: commandStep,
    completeMidi: commandStep,
    variationMidi: commandStep,
    generateBassline: commandStep,
    replayGeneratedMidi: commandStep,
    stemSeparate: commandStep,
    autoOrganizeProject: commandStep,
    addChordEvent: commandStep,
    moveChordEvent: commandStep,
    updateChordEvent: commandStep,
    removeChordEvent: commandStep,
    toggleChordTrack: commandStep,
    clearChordTrack: commandStep,
    restoreChordTrackState: commandStep,
    clearAllMidiMappings: commandStep,
    completeMidiLearn: commandStep,
    removeMidiMapping: commandStep,
    restoreMidiLearnMappings: commandStep,
    toggleScratchPad: commandStep,
    captureScratchPad: commandStep,
    commitScratchPad: commandStep,
    clearScratchPad: commandStep,
    removeScratchPadSection: commandStep,
    renameScratchPadSection: commandStep,
    reorderScratchPadSection: commandStep,
    setScratchPadSectionColor: commandStep,
    createPatternInstance: commandStep,
    detachPatternInstance: commandStep,
    restorePatternInstanceLink: commandStep,
    startMacroRecording: commandStep,
    stopMacroRecording: commandStep,
    playMacro: commandStep,
    deleteMacro: commandStep,
    renameMacro: commandStep,
    undo: commandStep,
    redo: commandStep,
    toggleUndoTree: commandStep,
    labelUndoBranch: commandStep,
    detectSongStructure: commandStep,
    createProjectVersion: commandStep,
    restoreProjectVersion: commandStep,
    createVersionBranch: commandStep,
    generateFill: commandStep,
    generateAllTransitions: commandStep,
    compareToReference: commandStep,
    toggleControlRoomMono: commandStep,
    toggleControlRoomDim: commandStep,
    switchMonitor: commandStep,
    getMentorTips: commandStep,
    searchSamples: commandStep,
    createCompGroup: commandStep,
    togglePunchRecording: commandStep,
    toggleLoopRecord: commandStep,
    triggerScene: commandStep,
    nextSetlistItem: commandStep,
    previousSetlistItem: commandStep,
    createAdjustmentLayer: commandStep,
    removeAdjustmentLayer: commandStep,
    toggleAdjustmentLayer: commandStep,
    setLayerParameter: commandStep,
    setLayerMix: commandStep,
    addAdjustmentRegion: commandStep,
    removeAdjustmentRegion: commandStep,
    moveAdjustmentRegion: commandStep,
    setLayerFades: commandStep,
    setLayerAffectedTracks: commandStep,
    setLayerInsertionIndex: commandStep,
    restoreAdjustmentLayerMutation: commandStep,
    detectTransients: commandStep,
    quantizeTransients: commandStep,
    openElasticEditor: commandStep,
    closeElasticEditor: commandStep,
    elasticSetSensitivity: commandStep,
    elasticAddMarker: commandStep,
    elasticRemoveMarker: commandStep,
    elasticToggleMarkerLock: commandStep,
    elasticSetTool: commandStep,
    toggleNodeView: commandStep,
    setControlSurface: commandStep,
    addCvOutput: commandStep,
    removeCvOutput: commandStep,
    connectPush: commandStep,
    disconnectPush: commandStep,
    exportDawProject: commandStep,
    importDawProject: commandStep,
    loadRaveModel: commandStep,
    setRaveBlend: commandStep,
    enableWarping: commandStep,
    setWarpAlgorithm: commandStep,
    setWarpPitchShift: commandStep,
    setYeastProcessorParam: commandStep,
    setYeastArpPattern: commandStep,
    setYeastProcessorBypass: commandStep,
    addYeastProcessor: commandStep,
    removeYeastProcessor: commandStep,
    reorderYeastProcessor: commandStep,
    commitRecording: commandStep,
    discardRecording: commandStep,
    restoreRecording: commandStep,
    appendOverdubControllers: commandStep,
    removeOverdubControllers: commandStep,
};

function lookup<Type extends AppActionType>(
    action: ActionOf<Type>,
    trackIds: Set<string>
): PlannedDeviceWriteStep | null {
    if (!Object.hasOwn(plannedDeviceWriteStepByActionType, action.type)) {
        return commandStep(action);
    }
    return plannedDeviceWriteStepByActionType[action.type](action, trackIds);
}

function adaptPriorSiblingActions(
    context: HandlerValidationContext | undefined,
    trackIds: Set<string>
): PlannedDeviceWriteStep[] | null {
    const steps: PlannedDeviceWriteStep[] = [];
    for (const action of context?.actions.slice(0, context.actionIndex) ?? []) {
        const step = lookup(action, trackIds);
        if (!step) {
            return null;
        }
        steps.push(step);
    }
    return steps;
}

/** Plan only prior siblings from the initial projection; execution checks its actual midpoint separately. */
export function getPlannedDevicePatchState(input: Input): Extract<PlannedDevicePresence, { kind: 'device' }> | null {
    const source = (getTrackStoreState()?.tracks ?? []).map(readPlannedDeviceOwnerSource);
    if (source.some((owner) => owner === null)) {
        return null;
    }
    const owners = source.filter((owner) => owner !== null);
    const trackIds = new Set(owners.map((owner) => owner.id));
    const steps = adaptPriorSiblingActions(input.context, trackIds);
    if (!steps) {
        return null;
    }
    const matches: Array<Extract<PlannedDevicePresence, { kind: 'device' }>> = [];
    for (const trackId of input.trackId ? [input.trackId] : trackIds) {
        const planned = planDevicePatchWrite({
            source: owners,
            trackId,
            deviceId: input.deviceId,
            parameterIds: input.parameterIds,
            steps,
            actionIndex: steps.length,
            plugins: getPlatformPlugins(),
        });
        if (planned.status === 'ready' && planned.prefix.kind === 'device') {
            matches.push(planned.prefix);
        }
    }
    return matches.length === 1 ? (matches[0] ?? null) : null;
}
