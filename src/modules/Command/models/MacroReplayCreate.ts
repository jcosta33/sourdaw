import { type AppAction, type AppActionType } from '#/utils/handlerContract';

import { type MacroReplayIdMappings } from './MacroReplayIdMappings';

type ActionOf<Type extends AppActionType> = Extract<AppAction, { type: Type }>;

export type MacroReplayReads = {
    /** The lane a replayed addAutomationLane folded into, or the minted id when none did. */
    resolveMaterializedLaneId: (generatedLaneId: string, target: { trackId: string; parameterId: string }) => string;
};

/**
 * A replayed create whose recorded id was taken off the payload so the kernel mints a fresh one.
 * `remember` maps the recorded id onto the minted one once both exist. A create that mints a list
 * records the list, and each recorded id maps onto the minted id at its position.
 */
export type MacroReplayCreate = {
    recordedId: string | readonly string[] | undefined;
    remember: (recordedId: string, generatedId: string, reads: MacroReplayReads) => void;
};

export function notAGeneratedCreate(): MacroReplayCreate | null {
    return null;
}

function beginSidechainRouteCreate(
    action: ActionOf<'addSidechainRoute'>,
    mappings: MacroReplayIdMappings
): MacroReplayCreate {
    const recordedId = action.payload.routeId;
    delete action.payload.routeId;
    return {
        recordedId,
        remember: (recorded, generated) => {
            mappings.sidechainRouteIds.set(recorded, generated);
        },
    };
}

function beginAutomationLaneCreate(
    action: ActionOf<'addAutomationLane'>,
    mappings: MacroReplayIdMappings
): MacroReplayCreate {
    const recordedId = action.payload.laneId;
    delete action.payload.laneId;
    return {
        recordedId,
        remember: (recorded, generated, reads) => {
            const materializedLaneId = reads.resolveMaterializedLaneId(generated, {
                trackId: action.payload.trackId,
                parameterId: action.payload.parameterId,
            });
            mappings.automationLaneIds.set(recorded, materializedLaneId);
        },
    };
}

function beginAutomationPointCreate(
    action: ActionOf<'addAutomationPoint'>,
    mappings: MacroReplayIdMappings
): MacroReplayCreate {
    action.payload.laneId = mappings.automationLaneIds.get(action.payload.laneId) ?? action.payload.laneId;
    const recordedId = action.payload.pointId;
    delete action.payload.pointId;
    return {
        recordedId,
        remember: (recorded, generated) => {
            mappings.automationPointIds.set(recorded, generated);
        },
    };
}

function beginChordEventCreate(action: ActionOf<'addChordEvent'>, mappings: MacroReplayIdMappings): MacroReplayCreate {
    const recordedId = action.payload.eventId;
    delete action.payload.eventId;
    return {
        recordedId,
        remember: (recorded, generated) => {
            mappings.chordEventIds.set(recorded, generated);
        },
    };
}

function beginAdjustmentLayerCreate(
    action: ActionOf<'createAdjustmentLayer'>,
    mappings: MacroReplayIdMappings
): MacroReplayCreate {
    const recordedId = action.payload.layerId;
    delete action.payload.layerId;
    return {
        recordedId,
        remember: (recorded, generated) => {
            mappings.layerIds.set(recorded, generated);
        },
    };
}

function beginAdjustmentRegionCreate(
    action: ActionOf<'addAdjustmentRegion'>,
    mappings: MacroReplayIdMappings
): MacroReplayCreate {
    action.payload.layerId = mappings.layerIds.get(action.payload.layerId) ?? action.payload.layerId;
    const recordedId = action.payload.regionId;
    delete action.payload.regionId;
    return {
        recordedId,
        remember: (recorded, generated) => {
            mappings.regionIds.set(recorded, generated);
        },
    };
}

function beginVcaGroupCreate(action: ActionOf<'createVcaGroup'>, mappings: MacroReplayIdMappings): MacroReplayCreate {
    const recordedId = action.payload.vcaGroupId;
    delete action.payload.vcaGroupId;
    return {
        recordedId,
        remember: (recorded, generated) => {
            mappings.vcaGroupIds.set(recorded, generated);
        },
    };
}

function beginMarkerCreate(action: ActionOf<'addMarker'>, mappings: MacroReplayIdMappings): MacroReplayCreate {
    const recordedId = action.payload.markerId;
    delete action.payload.markerId;
    return {
        recordedId,
        remember: (recorded, generated) => {
            mappings.markerIds.set(recorded, generated);
        },
    };
}

function beginSectionCreate(action: ActionOf<'addSection'>, mappings: MacroReplayIdMappings): MacroReplayCreate {
    const recordedId = action.payload.sectionId;
    delete action.payload.sectionId;
    return {
        recordedId,
        remember: (recorded, generated) => {
            mappings.sectionIds.set(recorded, generated);
        },
    };
}

function beginTrackAlternativeCreate(
    action: ActionOf<'createTrackAlternative'>,
    mappings: MacroReplayIdMappings
): MacroReplayCreate {
    const recordedId = action.payload.alternativeId;
    delete action.payload.alternativeId;
    return {
        recordedId,
        remember: (recorded, generated) => {
            mappings.trackAlternativeIds.set(recorded, generated);
        },
    };
}

function isStringList(value: unknown): value is readonly string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function beginScratchPadCapture(
    action: ActionOf<'captureScratchPad'>,
    mappings: MacroReplayIdMappings
): MacroReplayCreate {
    const recorded: unknown = action.payload?.sectionIds;
    delete action.payload?.sectionIds;
    return {
        // A stored macro is persisted data: a recorded value that is not a list of ids maps nothing.
        recordedId: isStringList(recorded) ? recorded : undefined,
        remember: (recorded, generated) => {
            mappings.scratchPadSectionIds.set(recorded, generated);
        },
    };
}

/**
 * Prepares a replayed create: remaps the ids it names, takes its recorded id off the payload and
 * returns how to map that id onto the minted one. `null` means the action is not a create.
 */
export const macroReplayCreateByActionType: {
    readonly [Type in AppActionType]: (
        action: ActionOf<Type>,
        mappings: MacroReplayIdMappings
    ) => MacroReplayCreate | null;
} = {
    importStemSet: notAGeneratedCreate,
    discardImportedStemSet: notAGeneratedCreate,
    addTrack: notAGeneratedCreate,
    removeTrack: notAGeneratedCreate,
    discardCreatedTrack: notAGeneratedCreate,
    restoreTrack: notAGeneratedCreate,
    restoreClip: notAGeneratedCreate,
    discardDuplicatedClip: notAGeneratedCreate,
    removeAllTracks: notAGeneratedCreate,
    renameTrack: notAGeneratedCreate,
    createTrackAlternative: beginTrackAlternativeCreate,
    switchTrackAlternative: notAGeneratedCreate,
    renameTrackAlternative: notAGeneratedCreate,
    deleteTrackAlternative: notAGeneratedCreate,
    selectTrack: notAGeneratedCreate,
    muteTrack: notAGeneratedCreate,
    soloTrack: notAGeneratedCreate,
    selectTake: notAGeneratedCreate,
    replaceOriginalMidiTakeRow: notAGeneratedCreate,
    replaceOriginalMidiBaseRow: notAGeneratedCreate,
    toggleSoloSafe: notAGeneratedCreate,
    setSoloSafe: notAGeneratedCreate,
    restoreSoloSafe: notAGeneratedCreate,
    armTrack: notAGeneratedCreate,
    freezeTrack: notAGeneratedCreate,
    unfreezeTrack: notAGeneratedCreate,
    restoreFreezeState: notAGeneratedCreate,
    flattenTrack: notAGeneratedCreate,
    bounceInPlace: notAGeneratedCreate,
    reorderTrack: notAGeneratedCreate,
    setTempo: notAGeneratedCreate,
    restoreTempoEdit: notAGeneratedCreate,
    editTempoMap: notAGeneratedCreate,
    restoreTempoMapEdit: notAGeneratedCreate,
    setTimeSignature: notAGeneratedCreate,
    setPlayback: notAGeneratedCreate,
    togglePlayback: notAGeneratedCreate,
    stopPlayback: notAGeneratedCreate,
    toggleRecording: notAGeneratedCreate,
    setMasterGain: notAGeneratedCreate,
    restoreMasterGain: notAGeneratedCreate,
    toggleLoop: notAGeneratedCreate,
    toggleMetronome: notAGeneratedCreate,
    setMetronomeVolume: notAGeneratedCreate,
    setLoopRegion: notAGeneratedCreate,
    setLoopEnabled: notAGeneratedCreate,
    setMetronomeEnabled: notAGeneratedCreate,
    restoreLoopRegion: notAGeneratedCreate,
    addClip: notAGeneratedCreate,
    moveClip: notAGeneratedCreate,
    restoreClipPlacement: notAGeneratedCreate,
    duplicateClip: notAGeneratedCreate,
    duplicateClipToNextBar: notAGeneratedCreate,
    duplicateTrack: notAGeneratedCreate,
    removeClip: notAGeneratedCreate,
    renameClip: notAGeneratedCreate,
    splitClip: notAGeneratedCreate,
    restoreClipSplitState: notAGeneratedCreate,
    trimClipStart: notAGeneratedCreate,
    trimClipEnd: notAGeneratedCreate,
    restoreAudioClipStartTrim: notAGeneratedCreate,
    restoreAudioClipSlip: notAGeneratedCreate,
    slipClipContent: notAGeneratedCreate,
    drawClip: notAGeneratedCreate,
    discardDrawnClip: notAGeneratedCreate,
    restoreDrawnClip: notAGeneratedCreate,
    duplicateClipAt: notAGeneratedCreate,
    moveClips: notAGeneratedCreate,
    restoreClipMoves: notAGeneratedCreate,
    addDevice: notAGeneratedCreate,
    bypassDevice: notAGeneratedCreate,
    removeDevice: notAGeneratedCreate,
    restoreDevice: notAGeneratedCreate,
    reorderDevices: notAGeneratedCreate,
    setDeviceParameter: notAGeneratedCreate,
    setExternalPluginState: notAGeneratedCreate,
    setDeviceState: notAGeneratedCreate,
    setFermenterPatch: notAGeneratedCreate,
    setLevainIdentity: notAGeneratedCreate,
    setGrandBouleDeviceState: notAGeneratedCreate,
    setToasterFactoryKit: notAGeneratedCreate,
    setBacteriaFactoryPatch: notAGeneratedCreate,
    setGlutenFactoryPreset: notAGeneratedCreate,
    createBus: notAGeneratedCreate,
    createFolder: notAGeneratedCreate,
    setSend: notAGeneratedCreate,
    setWorkspaceMode: notAGeneratedCreate,
    openPreferencesDialog: notAGeneratedCreate,
    openMixer: notAGeneratedCreate,
    closeMixer: notAGeneratedCreate,
    toggleSidebar: notAGeneratedCreate,
    toggleInspector: notAGeneratedCreate,
    toggleChatPanel: notAGeneratedCreate,
    setTrackInput: notAGeneratedCreate,
    restoreTrackInput: notAGeneratedCreate,
    setEditingTool: notAGeneratedCreate,
    setMarqueeSelection: notAGeneratedCreate,
    addMarker: beginMarkerCreate,
    removeMarker: notAGeneratedCreate,
    setMarkerColor: notAGeneratedCreate,
    addSection: beginSectionCreate,
    removeSection: notAGeneratedCreate,
    renameSection: notAGeneratedCreate,
    renameMarker: notAGeneratedCreate,
    moveMarker: notAGeneratedCreate,
    moveSection: notAGeneratedCreate,
    resizeSection: notAGeneratedCreate,
    setSectionColor: notAGeneratedCreate,
    reorderSection: notAGeneratedCreate,
    navigateSection: notAGeneratedCreate,
    rehearseSection: notAGeneratedCreate,
    restoreSectionBeats: notAGeneratedCreate,
    setClipGainEnvelope: notAGeneratedCreate,
    toggleClipGainEnvelope: notAGeneratedCreate,
    addGainEnvelopePoint: notAGeneratedCreate,
    removeGainEnvelopePoint: notAGeneratedCreate,
    resetClipGainEnvelope: notAGeneratedCreate,
    addModulator: notAGeneratedCreate,
    removeModulator: notAGeneratedCreate,
    updateModulator: notAGeneratedCreate,
    addMapping: notAGeneratedCreate,
    removeMapping: notAGeneratedCreate,
    addAutomationLane: beginAutomationLaneCreate,
    automateSendRange: notAGeneratedCreate,
    automateSendRanges: notAGeneratedCreate,
    removeSendAutomationRanges: notAGeneratedCreate,
    renderProjectSections: notAGeneratedCreate,
    removeRenderedProjectSections: notAGeneratedCreate,
    automateTrackGainRange: notAGeneratedCreate,
    automateParameterRange: notAGeneratedCreate,
    removeTrackGainAutomationRange: notAGeneratedCreate,
    removeSendAutomationRange: notAGeneratedCreate,
    removeAutomationLane: notAGeneratedCreate,
    setAutomationLaneEnabled: notAGeneratedCreate,
    addAutomationPoint: beginAutomationPointCreate,
    insertAutomationLanePoints: notAGeneratedCreate,
    quantizeNotes: notAGeneratedCreate,
    removeShortMidiOverlaps: notAGeneratedCreate,
    createDrumPreviewBranches: notAGeneratedCreate,
    deleteDrumPreviewBranches: notAGeneratedCreate,
    copyMidiArticulations: notAGeneratedCreate,
    restoreMidiClipNotes: notAGeneratedCreate,
    quantizeNoteLengths: notAGeneratedCreate,
    transposeNotes: notAGeneratedCreate,
    humanizeNotes: notAGeneratedCreate,
    invertNotes: notAGeneratedCreate,
    retrogradeNotes: notAGeneratedCreate,
    scaleVelocities: notAGeneratedCreate,
    scaleAllVelocities: notAGeneratedCreate,
    setAllVelocities: notAGeneratedCreate,
    setTrackGain: notAGeneratedCreate,
    setTrackPan: notAGeneratedCreate,
    setTrackColor: notAGeneratedCreate,
    copyClip: notAGeneratedCreate,
    cutClip: notAGeneratedCreate,
    pasteClip: notAGeneratedCreate,
    setClipFade: notAGeneratedCreate,
    importMidiFile: notAGeneratedCreate,
    normalizeClip: notAGeneratedCreate,
    relinkClipAudioSources: notAGeneratedCreate,
    reverseClip: notAGeneratedCreate,
    restoreReversedClip: notAGeneratedCreate,
    glueClips: notAGeneratedCreate,
    restoreClipGlueState: notAGeneratedCreate,
    setCompRegion: notAGeneratedCreate,
    removeCompRegion: notAGeneratedCreate,
    restoreCompRegionInterval: notAGeneratedCreate,
    nudgeClip: notAGeneratedCreate,
    crossfadeClips: notAGeneratedCreate,
    restoreCrossfadeClips: notAGeneratedCreate,
    setClipGain: notAGeneratedCreate,
    setClipColor: notAGeneratedCreate,
    lockClip: notAGeneratedCreate,
    consolidateSelection: notAGeneratedCreate,
    bounceSelection: notAGeneratedCreate,
    seekPlayhead: notAGeneratedCreate,
    setPunchIn: notAGeneratedCreate,
    setPunchOut: notAGeneratedCreate,
    setPunchEnabled: notAGeneratedCreate,
    restorePunchRegion: notAGeneratedCreate,
    togglePunch: notAGeneratedCreate,
    toggleCountIn: notAGeneratedCreate,
    setCountInBars: notAGeneratedCreate,
    togglePreRoll: notAGeneratedCreate,
    setPreRollBars: notAGeneratedCreate,
    zoomTracksVertical: notAGeneratedCreate,
    addTimeSignatureChange: notAGeneratedCreate,
    removeTimeSignatureChange: notAGeneratedCreate,
    setTrackOutput: notAGeneratedCreate,
    addSend: notAGeneratedCreate,
    removeSend: notAGeneratedCreate,
    removeAutomationPoint: notAGeneratedCreate,
    setAutomationMode: notAGeneratedCreate,
    hideTrack: notAGeneratedCreate,
    disableTrack: notAGeneratedCreate,
    restoreTrackDisabled: notAGeneratedCreate,
    setTrackHeight: notAGeneratedCreate,
    setSnapValue: notAGeneratedCreate,
    zoomToFit: notAGeneratedCreate,
    zoomToSelection: notAGeneratedCreate,
    exportProject: notAGeneratedCreate,
    saveProject: notAGeneratedCreate,
    newProject: notAGeneratedCreate,
    importAudioFile: notAGeneratedCreate,
    exportMidi: notAGeneratedCreate,
    foldTrack: notAGeneratedCreate,
    groupTracks: notAGeneratedCreate,
    ungroupTracks: notAGeneratedCreate,
    scaleAutomation: notAGeneratedCreate,
    stretchAutomation: notAGeneratedCreate,
    invertAutomation: notAGeneratedCreate,
    reverseAutomation: notAGeneratedCreate,
    thinAutomation: notAGeneratedCreate,
    quantizeAutomation: notAGeneratedCreate,
    restoreAutomationLanePoints: notAGeneratedCreate,
    restoreAutomationPointPresence: notAGeneratedCreate,
    loadPreset: notAGeneratedCreate,
    restorePresetDeviceChain: notAGeneratedCreate,
    savePreset: notAGeneratedCreate,
    generateDrumPattern: notAGeneratedCreate,
    generateMelody: notAGeneratedCreate,
    generateChordProgression: notAGeneratedCreate,
    setClipLoop: notAGeneratedCreate,
    restoreClipLoop: notAGeneratedCreate,
    setClipLoopLength: notAGeneratedCreate,
    restoreClipLoopLength: notAGeneratedCreate,
    createGrooveTemplate: notAGeneratedCreate,
    renameGrooveTemplate: notAGeneratedCreate,
    restoreGrooveTemplateName: notAGeneratedCreate,
    deleteGrooveTemplate: notAGeneratedCreate,
    restoreDeletedGrooveTemplate: notAGeneratedCreate,
    assignGrooveTemplate: notAGeneratedCreate,
    restoreGrooveAssignment: notAGeneratedCreate,
    extractGroove: notAGeneratedCreate,
    applyGroove: notAGeneratedCreate,
    setClipStretchMode: notAGeneratedCreate,
    setClipStretchRatio: notAGeneratedCreate,
    restoreClipStretchState: notAGeneratedCreate,
    fitClipToBeats: notAGeneratedCreate,
    analyzeMix: notAGeneratedCreate,
    autoFixMix: notAGeneratedCreate,
    enableMpe: notAGeneratedCreate,
    disableMpe: notAGeneratedCreate,
    getLatencyReport: notAGeneratedCreate,
    createCollabSession: notAGeneratedCreate,
    joinCollabSession: notAGeneratedCreate,
    leaveCollabSession: notAGeneratedCreate,
    scanPlugins: notAGeneratedCreate,
    loadExternalPlugin: notAGeneratedCreate,
    audioToMidi: notAGeneratedCreate,
    commitPitchEdit: notAGeneratedCreate,
    restoreClipFileId: notAGeneratedCreate,
    muteClip: notAGeneratedCreate,
    clearSolos: notAGeneratedCreate,
    restoreTrackSoloStates: notAGeneratedCreate,
    setTrackNotes: notAGeneratedCreate,
    deleteTime: notAGeneratedCreate,
    insertTime: notAGeneratedCreate,
    duplicateTimeRange: notAGeneratedCreate,
    restoreTimeOperationState: notAGeneratedCreate,
    restoreTrackHeights: notAGeneratedCreate,
    restoreTrackGroupMemberships: notAGeneratedCreate,
    restoreTracks: notAGeneratedCreate,
    restoreTrackClipStates: notAGeneratedCreate,
    discardCreatedTracks: notAGeneratedCreate,
    discardCreatedCompGroup: notAGeneratedCreate,
    restoreTrackAlternativeState: notAGeneratedCreate,
    restoreScratchPadState: notAGeneratedCreate,
    stripSilence: notAGeneratedCreate,
    restoreStripSilenceState: notAGeneratedCreate,
    detectTempo: notAGeneratedCreate,
    detectKey: notAGeneratedCreate,
    consolidateAllTracks: notAGeneratedCreate,
    arpeggiate: notAGeneratedCreate,
    addSidechainRoute: beginSidechainRouteCreate,
    removeSidechainRoute: notAGeneratedCreate,
    bounceToNewTrack: notAGeneratedCreate,
    saveTrackTemplate: notAGeneratedCreate,
    loadTrackTemplate: notAGeneratedCreate,
    deleteTrackTemplate: notAGeneratedCreate,
    createProjectFromTemplate: notAGeneratedCreate,
    setProductionBrief: notAGeneratedCreate,
    repairProjectData: notAGeneratedCreate,
    createVcaGroup: beginVcaGroupCreate,
    assignToVca: notAGeneratedCreate,
    removeFromVca: notAGeneratedCreate,
    setVcaGain: notAGeneratedCreate,
    restoreLegacyVcaState: notAGeneratedCreate,
    setMidiOutput: notAGeneratedCreate,
    clearMidiOutput: notAGeneratedCreate,
    restoreMidiOutput: notAGeneratedCreate,
    addNotes: notAGeneratedCreate,
    completeMidi: notAGeneratedCreate,
    variationMidi: notAGeneratedCreate,
    generateBassline: notAGeneratedCreate,
    replayGeneratedMidi: notAGeneratedCreate,
    stemSeparate: notAGeneratedCreate,
    autoOrganizeProject: notAGeneratedCreate,
    addChordEvent: beginChordEventCreate,
    moveChordEvent: notAGeneratedCreate,
    updateChordEvent: notAGeneratedCreate,
    removeChordEvent: notAGeneratedCreate,
    toggleChordTrack: notAGeneratedCreate,
    clearChordTrack: notAGeneratedCreate,
    restoreChordTrackState: notAGeneratedCreate,
    clearAllMidiMappings: notAGeneratedCreate,
    completeMidiLearn: notAGeneratedCreate,
    removeMidiMapping: notAGeneratedCreate,
    restoreMidiLearnMappings: notAGeneratedCreate,
    toggleScratchPad: notAGeneratedCreate,
    captureScratchPad: beginScratchPadCapture,
    commitScratchPad: notAGeneratedCreate,
    clearScratchPad: notAGeneratedCreate,
    removeScratchPadSection: notAGeneratedCreate,
    renameScratchPadSection: notAGeneratedCreate,
    reorderScratchPadSection: notAGeneratedCreate,
    setScratchPadSectionColor: notAGeneratedCreate,
    createPatternInstance: notAGeneratedCreate,
    detachPatternInstance: notAGeneratedCreate,
    restorePatternInstanceLink: notAGeneratedCreate,
    startMacroRecording: notAGeneratedCreate,
    stopMacroRecording: notAGeneratedCreate,
    playMacro: notAGeneratedCreate,
    deleteMacro: notAGeneratedCreate,
    renameMacro: notAGeneratedCreate,
    undo: notAGeneratedCreate,
    redo: notAGeneratedCreate,
    toggleUndoTree: notAGeneratedCreate,
    labelUndoBranch: notAGeneratedCreate,
    detectSongStructure: notAGeneratedCreate,
    createProjectVersion: notAGeneratedCreate,
    restoreProjectVersion: notAGeneratedCreate,
    createVersionBranch: notAGeneratedCreate,
    generateFill: notAGeneratedCreate,
    generateAllTransitions: notAGeneratedCreate,
    compareToReference: notAGeneratedCreate,
    toggleControlRoomMono: notAGeneratedCreate,
    toggleControlRoomDim: notAGeneratedCreate,
    switchMonitor: notAGeneratedCreate,
    getMentorTips: notAGeneratedCreate,
    searchSamples: notAGeneratedCreate,
    createCompGroup: notAGeneratedCreate,
    togglePunchRecording: notAGeneratedCreate,
    toggleLoopRecord: notAGeneratedCreate,
    triggerScene: notAGeneratedCreate,
    nextSetlistItem: notAGeneratedCreate,
    previousSetlistItem: notAGeneratedCreate,
    createAdjustmentLayer: beginAdjustmentLayerCreate,
    removeAdjustmentLayer: notAGeneratedCreate,
    toggleAdjustmentLayer: notAGeneratedCreate,
    setLayerParameter: notAGeneratedCreate,
    setLayerMix: notAGeneratedCreate,
    addAdjustmentRegion: beginAdjustmentRegionCreate,
    removeAdjustmentRegion: notAGeneratedCreate,
    moveAdjustmentRegion: notAGeneratedCreate,
    setLayerFades: notAGeneratedCreate,
    setLayerAffectedTracks: notAGeneratedCreate,
    setLayerInsertionIndex: notAGeneratedCreate,
    restoreAdjustmentLayerMutation: notAGeneratedCreate,
    detectTransients: notAGeneratedCreate,
    quantizeTransients: notAGeneratedCreate,
    openElasticEditor: notAGeneratedCreate,
    closeElasticEditor: notAGeneratedCreate,
    elasticSetSensitivity: notAGeneratedCreate,
    elasticAddMarker: notAGeneratedCreate,
    elasticRemoveMarker: notAGeneratedCreate,
    elasticToggleMarkerLock: notAGeneratedCreate,
    elasticSetTool: notAGeneratedCreate,
    toggleNodeView: notAGeneratedCreate,
    setControlSurface: notAGeneratedCreate,
    addCvOutput: notAGeneratedCreate,
    removeCvOutput: notAGeneratedCreate,
    connectPush: notAGeneratedCreate,
    disconnectPush: notAGeneratedCreate,
    exportDawProject: notAGeneratedCreate,
    importDawProject: notAGeneratedCreate,
    loadRaveModel: notAGeneratedCreate,
    setRaveBlend: notAGeneratedCreate,
    enableWarping: notAGeneratedCreate,
    setWarpAlgorithm: notAGeneratedCreate,
    setWarpPitchShift: notAGeneratedCreate,
    setYeastProcessorParam: notAGeneratedCreate,
    setYeastArpPattern: notAGeneratedCreate,
    setYeastProcessorBypass: notAGeneratedCreate,
    addYeastProcessor: notAGeneratedCreate,
    removeYeastProcessor: notAGeneratedCreate,
    reorderYeastProcessor: notAGeneratedCreate,
    commitRecording: notAGeneratedCreate,
    discardRecording: notAGeneratedCreate,
    restoreRecording: notAGeneratedCreate,
    appendOverdubControllers: notAGeneratedCreate,
    removeOverdubControllers: notAGeneratedCreate,
};
