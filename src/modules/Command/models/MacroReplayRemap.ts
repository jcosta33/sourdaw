import { type AppAction, type AppActionType } from '#/utils/handlerContract';

import { type MacroReplayIdMappings } from './MacroReplayIdMappings';

type ActionOf<Type extends AppActionType> = Extract<AppAction, { type: Type }>;

type AutomationPointSnapshots = ActionOf<'restoreAutomationLanePoints'>['payload']['points'];

function remapAutomationPointSnapshots(
    points: AutomationPointSnapshots,
    mappings: MacroReplayIdMappings
): AutomationPointSnapshots {
    return points.map((point) =>
        point.id ? { ...point, id: mappings.automationPointIds.get(point.id) ?? point.id } : point
    );
}

export function leaveReferencesUnmapped(): void {
    // The action names no id a replay re-mints.
}

function remapChordEvent(
    action: ActionOf<'moveChordEvent' | 'updateChordEvent' | 'removeChordEvent'>,
    mappings: MacroReplayIdMappings
): void {
    action.payload.eventId = mappings.chordEventIds.get(action.payload.eventId) ?? action.payload.eventId;
}

function remapMarker(action: ActionOf<'removeMarker' | 'setMarkerColor'>, mappings: MacroReplayIdMappings): void {
    action.payload.markerId = mappings.markerIds.get(action.payload.markerId) ?? action.payload.markerId;
}

function remapSection(action: ActionOf<'removeSection' | 'renameSection'>, mappings: MacroReplayIdMappings): void {
    action.payload.sectionId = mappings.sectionIds.get(action.payload.sectionId) ?? action.payload.sectionId;
}

function remapScratchPadSection(
    action: ActionOf<
        'removeScratchPadSection' | 'renameScratchPadSection' | 'reorderScratchPadSection' | 'setScratchPadSectionColor'
    >,
    mappings: MacroReplayIdMappings
): void {
    action.payload.sectionId = mappings.scratchPadSectionIds.get(action.payload.sectionId) ?? action.payload.sectionId;
}

function remapTrackAlternative(
    action: ActionOf<'renameTrackAlternative' | 'switchTrackAlternative'>,
    mappings: MacroReplayIdMappings
): void {
    action.payload.alternativeId =
        mappings.trackAlternativeIds.get(action.payload.alternativeId) ?? action.payload.alternativeId;
}

function remapDeletedTrackAlternative(
    action: ActionOf<'deleteTrackAlternative'>,
    mappings: MacroReplayIdMappings
): void {
    action.payload.alternativeId =
        mappings.trackAlternativeIds.get(action.payload.alternativeId) ?? action.payload.alternativeId;
    // Recorded via revertAction (no skipMacroRecording): a create's undo inverse
    // is a deleteTrackAlternative whose fallbackAlternativeId references another
    // recorded alternative — remap it too or the replayed delete degrades to the
    // first-in-list fallback and restores the wrong active alternative.
    if (action.payload.fallbackAlternativeId) {
        action.payload.fallbackAlternativeId =
            mappings.trackAlternativeIds.get(action.payload.fallbackAlternativeId) ??
            action.payload.fallbackAlternativeId;
    }
}

function remapSidechainRoute(action: ActionOf<'removeSidechainRoute'>, mappings: MacroReplayIdMappings): void {
    if (action.payload.routeId) {
        action.payload.routeId = mappings.sidechainRouteIds.get(action.payload.routeId) ?? action.payload.routeId;
    }
}

function remapVca(action: ActionOf<'assignToVca' | 'setVcaGain'>, mappings: MacroReplayIdMappings): void {
    action.payload.vcaGroupId = mappings.vcaGroupIds.get(action.payload.vcaGroupId) ?? action.payload.vcaGroupId;
}

function remapAutomationLane(
    action: ActionOf<
        | 'removeAutomationLane'
        | 'setAutomationLaneEnabled'
        | 'addAutomationPoint'
        | 'scaleAutomation'
        | 'stretchAutomation'
        | 'invertAutomation'
        | 'reverseAutomation'
        | 'thinAutomation'
        | 'quantizeAutomation'
    >,
    mappings: MacroReplayIdMappings
): void {
    action.payload.laneId = mappings.automationLaneIds.get(action.payload.laneId) ?? action.payload.laneId;
}

function remapAutomationPoint(action: ActionOf<'removeAutomationPoint'>, mappings: MacroReplayIdMappings): void {
    action.payload.laneId = mappings.automationLaneIds.get(action.payload.laneId) ?? action.payload.laneId;
    if (action.payload.pointId) {
        action.payload.pointId = mappings.automationPointIds.get(action.payload.pointId) ?? action.payload.pointId;
    }
}

function remapAutomationLanePoints(
    action: ActionOf<'restoreAutomationLanePoints'>,
    mappings: MacroReplayIdMappings
): void {
    action.payload.laneId = mappings.automationLaneIds.get(action.payload.laneId) ?? action.payload.laneId;
    action.payload.points = remapAutomationPointSnapshots(action.payload.points, mappings);
    if (action.payload.expectedPoints) {
        action.payload.expectedPoints = remapAutomationPointSnapshots(action.payload.expectedPoints, mappings);
    }
}

function remapAdjustmentLayer(
    action: ActionOf<
        | 'removeAdjustmentLayer'
        | 'toggleAdjustmentLayer'
        | 'setLayerParameter'
        | 'setLayerMix'
        | 'setLayerAffectedTracks'
        | 'setLayerInsertionIndex'
    >,
    mappings: MacroReplayIdMappings
): void {
    action.payload.layerId = mappings.layerIds.get(action.payload.layerId) ?? action.payload.layerId;
}

function remapAdjustmentRegion(
    action: ActionOf<'moveAdjustmentRegion' | 'setLayerFades'>,
    mappings: MacroReplayIdMappings
): void {
    action.payload.regionId = mappings.regionIds.get(action.payload.regionId) ?? action.payload.regionId;
}

function remapAdjustmentLayerRegion(action: ActionOf<'removeAdjustmentRegion'>, mappings: MacroReplayIdMappings): void {
    action.payload.layerId = mappings.layerIds.get(action.payload.layerId) ?? action.payload.layerId;
    action.payload.regionId = mappings.regionIds.get(action.payload.regionId) ?? action.payload.regionId;
}

/** Points a replayed action's recorded ids at the ids the replay minted for the creates it re-ran. */
export const macroReplayRemapByActionType: {
    readonly [Type in AppActionType]: (action: ActionOf<Type>, mappings: MacroReplayIdMappings) => void;
} = {
    importStemSet: leaveReferencesUnmapped,
    discardImportedStemSet: leaveReferencesUnmapped,
    addTrack: leaveReferencesUnmapped,
    removeTrack: leaveReferencesUnmapped,
    discardCreatedTrack: leaveReferencesUnmapped,
    restoreTrack: leaveReferencesUnmapped,
    restoreClip: leaveReferencesUnmapped,
    discardDuplicatedClip: leaveReferencesUnmapped,
    removeAllTracks: leaveReferencesUnmapped,
    renameTrack: leaveReferencesUnmapped,
    createTrackAlternative: leaveReferencesUnmapped,
    switchTrackAlternative: remapTrackAlternative,
    renameTrackAlternative: remapTrackAlternative,
    deleteTrackAlternative: remapDeletedTrackAlternative,
    selectTrack: leaveReferencesUnmapped,
    muteTrack: leaveReferencesUnmapped,
    soloTrack: leaveReferencesUnmapped,
    selectTake: leaveReferencesUnmapped,
    replaceOriginalMidiTakeRow: leaveReferencesUnmapped,
    replaceOriginalMidiBaseRow: leaveReferencesUnmapped,
    toggleSoloSafe: leaveReferencesUnmapped,
    setSoloSafe: leaveReferencesUnmapped,
    restoreSoloSafe: leaveReferencesUnmapped,
    armTrack: leaveReferencesUnmapped,
    freezeTrack: leaveReferencesUnmapped,
    unfreezeTrack: leaveReferencesUnmapped,
    restoreFreezeState: leaveReferencesUnmapped,
    flattenTrack: leaveReferencesUnmapped,
    bounceInPlace: leaveReferencesUnmapped,
    reorderTrack: leaveReferencesUnmapped,
    setTempo: leaveReferencesUnmapped,
    restoreTempoEdit: leaveReferencesUnmapped,
    editTempoMap: leaveReferencesUnmapped,
    restoreTempoMapEdit: leaveReferencesUnmapped,
    setTimeSignature: leaveReferencesUnmapped,
    setPlayback: leaveReferencesUnmapped,
    togglePlayback: leaveReferencesUnmapped,
    stopPlayback: leaveReferencesUnmapped,
    toggleRecording: leaveReferencesUnmapped,
    setMasterGain: leaveReferencesUnmapped,
    restoreMasterGain: leaveReferencesUnmapped,
    toggleLoop: leaveReferencesUnmapped,
    toggleMetronome: leaveReferencesUnmapped,
    setMetronomeVolume: leaveReferencesUnmapped,
    setLoopRegion: leaveReferencesUnmapped,
    setLoopEnabled: leaveReferencesUnmapped,
    setMetronomeEnabled: leaveReferencesUnmapped,
    restoreLoopRegion: leaveReferencesUnmapped,
    addClip: leaveReferencesUnmapped,
    moveClip: leaveReferencesUnmapped,
    restoreClipPlacement: leaveReferencesUnmapped,
    duplicateClip: leaveReferencesUnmapped,
    duplicateClipToNextBar: leaveReferencesUnmapped,
    duplicateTrack: leaveReferencesUnmapped,
    removeClip: leaveReferencesUnmapped,
    renameClip: leaveReferencesUnmapped,
    splitClip: leaveReferencesUnmapped,
    restoreClipSplitState: leaveReferencesUnmapped,
    trimClipStart: leaveReferencesUnmapped,
    trimClipEnd: leaveReferencesUnmapped,
    restoreAudioClipStartTrim: leaveReferencesUnmapped,
    restoreAudioClipSlip: leaveReferencesUnmapped,
    slipClipContent: leaveReferencesUnmapped,
    drawClip: leaveReferencesUnmapped,
    discardDrawnClip: leaveReferencesUnmapped,
    restoreDrawnClip: leaveReferencesUnmapped,
    duplicateClipAt: leaveReferencesUnmapped,
    moveClips: leaveReferencesUnmapped,
    restoreClipMoves: leaveReferencesUnmapped,
    addDevice: leaveReferencesUnmapped,
    bypassDevice: leaveReferencesUnmapped,
    removeDevice: leaveReferencesUnmapped,
    restoreDevice: leaveReferencesUnmapped,
    reorderDevices: leaveReferencesUnmapped,
    setDeviceParameter: leaveReferencesUnmapped,
    setExternalPluginState: leaveReferencesUnmapped,
    setDeviceState: leaveReferencesUnmapped,
    setFermenterPatch: leaveReferencesUnmapped,
    setLevainIdentity: leaveReferencesUnmapped,
    setGrandBouleDeviceState: leaveReferencesUnmapped,
    setToasterFactoryKit: leaveReferencesUnmapped,
    setBacteriaFactoryPatch: leaveReferencesUnmapped,
    setGlutenFactoryPreset: leaveReferencesUnmapped,
    setProofPatchSelection: leaveReferencesUnmapped,
    createBus: leaveReferencesUnmapped,
    createFolder: leaveReferencesUnmapped,
    setSend: leaveReferencesUnmapped,
    setWorkspaceMode: leaveReferencesUnmapped,
    openPreferencesDialog: leaveReferencesUnmapped,
    openMixer: leaveReferencesUnmapped,
    closeMixer: leaveReferencesUnmapped,
    toggleSidebar: leaveReferencesUnmapped,
    toggleInspector: leaveReferencesUnmapped,
    toggleChatPanel: leaveReferencesUnmapped,
    setTrackInput: leaveReferencesUnmapped,
    restoreTrackInput: leaveReferencesUnmapped,
    setEditingTool: leaveReferencesUnmapped,
    setMarqueeSelection: leaveReferencesUnmapped,
    addMarker: leaveReferencesUnmapped,
    removeMarker: remapMarker,
    setMarkerColor: remapMarker,
    addSection: leaveReferencesUnmapped,
    removeSection: remapSection,
    renameSection: remapSection,
    renameMarker: leaveReferencesUnmapped,
    moveMarker: leaveReferencesUnmapped,
    moveSection: leaveReferencesUnmapped,
    resizeSection: leaveReferencesUnmapped,
    setSectionColor: leaveReferencesUnmapped,
    reorderSection: leaveReferencesUnmapped,
    navigateSection: leaveReferencesUnmapped,
    rehearseSection: leaveReferencesUnmapped,
    restoreSectionBeats: leaveReferencesUnmapped,
    setClipGainEnvelope: leaveReferencesUnmapped,
    toggleClipGainEnvelope: leaveReferencesUnmapped,
    addGainEnvelopePoint: leaveReferencesUnmapped,
    removeGainEnvelopePoint: leaveReferencesUnmapped,
    resetClipGainEnvelope: leaveReferencesUnmapped,
    addModulator: leaveReferencesUnmapped,
    removeModulator: leaveReferencesUnmapped,
    updateModulator: leaveReferencesUnmapped,
    addMapping: leaveReferencesUnmapped,
    removeMapping: leaveReferencesUnmapped,
    addAutomationLane: leaveReferencesUnmapped,
    automateSendRange: leaveReferencesUnmapped,
    automateSendRanges: leaveReferencesUnmapped,
    removeSendAutomationRanges: leaveReferencesUnmapped,
    renderProjectSections: leaveReferencesUnmapped,
    removeRenderedProjectSections: leaveReferencesUnmapped,
    automateTrackGainRange: leaveReferencesUnmapped,
    automateParameterRange: leaveReferencesUnmapped,
    removeTrackGainAutomationRange: leaveReferencesUnmapped,
    removeSendAutomationRange: leaveReferencesUnmapped,
    removeAutomationLane: remapAutomationLane,
    setAutomationLaneEnabled: remapAutomationLane,
    addAutomationPoint: remapAutomationLane,
    insertAutomationLanePoints: leaveReferencesUnmapped,
    quantizeNotes: leaveReferencesUnmapped,
    removeShortMidiOverlaps: leaveReferencesUnmapped,
    createDrumPreviewBranches: leaveReferencesUnmapped,
    deleteDrumPreviewBranches: leaveReferencesUnmapped,
    copyMidiArticulations: leaveReferencesUnmapped,
    restoreMidiClipNotes: leaveReferencesUnmapped,
    quantizeNoteLengths: leaveReferencesUnmapped,
    transposeNotes: leaveReferencesUnmapped,
    humanizeNotes: leaveReferencesUnmapped,
    invertNotes: leaveReferencesUnmapped,
    retrogradeNotes: leaveReferencesUnmapped,
    scaleVelocities: leaveReferencesUnmapped,
    scaleAllVelocities: leaveReferencesUnmapped,
    setAllVelocities: leaveReferencesUnmapped,
    setTrackGain: leaveReferencesUnmapped,
    setTrackPan: leaveReferencesUnmapped,
    setTrackColor: leaveReferencesUnmapped,
    copyClip: leaveReferencesUnmapped,
    cutClip: leaveReferencesUnmapped,
    pasteClip: leaveReferencesUnmapped,
    setClipFade: leaveReferencesUnmapped,
    importMidiFile: leaveReferencesUnmapped,
    normalizeClip: leaveReferencesUnmapped,
    relinkClipAudioSources: leaveReferencesUnmapped,
    reverseClip: leaveReferencesUnmapped,
    restoreReversedClip: leaveReferencesUnmapped,
    glueClips: leaveReferencesUnmapped,
    restoreClipGlueState: leaveReferencesUnmapped,
    setCompRegion: leaveReferencesUnmapped,
    removeCompRegion: leaveReferencesUnmapped,
    restoreCompRegionInterval: leaveReferencesUnmapped,
    nudgeClip: leaveReferencesUnmapped,
    crossfadeClips: leaveReferencesUnmapped,
    restoreCrossfadeClips: leaveReferencesUnmapped,
    setClipGain: leaveReferencesUnmapped,
    setClipColor: leaveReferencesUnmapped,
    lockClip: leaveReferencesUnmapped,
    consolidateSelection: leaveReferencesUnmapped,
    bounceSelection: leaveReferencesUnmapped,
    seekPlayhead: leaveReferencesUnmapped,
    setPunchIn: leaveReferencesUnmapped,
    setPunchOut: leaveReferencesUnmapped,
    setPunchEnabled: leaveReferencesUnmapped,
    restorePunchRegion: leaveReferencesUnmapped,
    togglePunch: leaveReferencesUnmapped,
    toggleCountIn: leaveReferencesUnmapped,
    setCountInBars: leaveReferencesUnmapped,
    togglePreRoll: leaveReferencesUnmapped,
    setPreRollBars: leaveReferencesUnmapped,
    zoomTracksVertical: leaveReferencesUnmapped,
    addTimeSignatureChange: leaveReferencesUnmapped,
    removeTimeSignatureChange: leaveReferencesUnmapped,
    setTrackOutput: leaveReferencesUnmapped,
    addSend: leaveReferencesUnmapped,
    removeSend: leaveReferencesUnmapped,
    removeAutomationPoint: remapAutomationPoint,
    setAutomationMode: leaveReferencesUnmapped,
    hideTrack: leaveReferencesUnmapped,
    disableTrack: leaveReferencesUnmapped,
    restoreTrackDisabled: leaveReferencesUnmapped,
    setTrackHeight: leaveReferencesUnmapped,
    setSnapValue: leaveReferencesUnmapped,
    zoomToFit: leaveReferencesUnmapped,
    zoomToSelection: leaveReferencesUnmapped,
    exportProject: leaveReferencesUnmapped,
    saveProject: leaveReferencesUnmapped,
    newProject: leaveReferencesUnmapped,
    importAudioFile: leaveReferencesUnmapped,
    exportMidi: leaveReferencesUnmapped,
    foldTrack: leaveReferencesUnmapped,
    groupTracks: leaveReferencesUnmapped,
    ungroupTracks: leaveReferencesUnmapped,
    scaleAutomation: remapAutomationLane,
    stretchAutomation: remapAutomationLane,
    invertAutomation: remapAutomationLane,
    reverseAutomation: remapAutomationLane,
    thinAutomation: remapAutomationLane,
    quantizeAutomation: remapAutomationLane,
    restoreAutomationLanePoints: remapAutomationLanePoints,
    restoreAutomationPointPresence: leaveReferencesUnmapped,
    loadPreset: leaveReferencesUnmapped,
    restorePresetDeviceChain: leaveReferencesUnmapped,
    savePreset: leaveReferencesUnmapped,
    generateDrumPattern: leaveReferencesUnmapped,
    generateMelody: leaveReferencesUnmapped,
    generateChordProgression: leaveReferencesUnmapped,
    setClipLoop: leaveReferencesUnmapped,
    restoreClipLoop: leaveReferencesUnmapped,
    setClipLoopLength: leaveReferencesUnmapped,
    restoreClipLoopLength: leaveReferencesUnmapped,
    createGrooveTemplate: leaveReferencesUnmapped,
    renameGrooveTemplate: leaveReferencesUnmapped,
    restoreGrooveTemplateName: leaveReferencesUnmapped,
    deleteGrooveTemplate: leaveReferencesUnmapped,
    restoreDeletedGrooveTemplate: leaveReferencesUnmapped,
    assignGrooveTemplate: leaveReferencesUnmapped,
    restoreGrooveAssignment: leaveReferencesUnmapped,
    extractGroove: leaveReferencesUnmapped,
    applyGroove: leaveReferencesUnmapped,
    setClipStretchMode: leaveReferencesUnmapped,
    setClipStretchRatio: leaveReferencesUnmapped,
    restoreClipStretchState: leaveReferencesUnmapped,
    fitClipToBeats: leaveReferencesUnmapped,
    analyzeMix: leaveReferencesUnmapped,
    autoFixMix: leaveReferencesUnmapped,
    enableMpe: leaveReferencesUnmapped,
    disableMpe: leaveReferencesUnmapped,
    getLatencyReport: leaveReferencesUnmapped,
    createCollabSession: leaveReferencesUnmapped,
    joinCollabSession: leaveReferencesUnmapped,
    leaveCollabSession: leaveReferencesUnmapped,
    scanPlugins: leaveReferencesUnmapped,
    loadExternalPlugin: leaveReferencesUnmapped,
    audioToMidi: leaveReferencesUnmapped,
    commitPitchEdit: leaveReferencesUnmapped,
    restoreClipFileId: leaveReferencesUnmapped,
    muteClip: leaveReferencesUnmapped,
    clearSolos: leaveReferencesUnmapped,
    restoreTrackSoloStates: leaveReferencesUnmapped,
    setTrackNotes: leaveReferencesUnmapped,
    deleteTime: leaveReferencesUnmapped,
    insertTime: leaveReferencesUnmapped,
    duplicateTimeRange: leaveReferencesUnmapped,
    restoreTimeOperationState: leaveReferencesUnmapped,
    restoreTrackHeights: leaveReferencesUnmapped,
    restoreTrackGroupMemberships: leaveReferencesUnmapped,
    restoreTracks: leaveReferencesUnmapped,
    restoreTrackClipStates: leaveReferencesUnmapped,
    discardCreatedTracks: leaveReferencesUnmapped,
    discardCreatedCompGroup: leaveReferencesUnmapped,
    restoreTrackAlternativeState: leaveReferencesUnmapped,
    restoreScratchPadState: leaveReferencesUnmapped,
    stripSilence: leaveReferencesUnmapped,
    restoreStripSilenceState: leaveReferencesUnmapped,
    detectTempo: leaveReferencesUnmapped,
    detectKey: leaveReferencesUnmapped,
    consolidateAllTracks: leaveReferencesUnmapped,
    arpeggiate: leaveReferencesUnmapped,
    addSidechainRoute: leaveReferencesUnmapped,
    removeSidechainRoute: remapSidechainRoute,
    bounceToNewTrack: leaveReferencesUnmapped,
    saveTrackTemplate: leaveReferencesUnmapped,
    loadTrackTemplate: leaveReferencesUnmapped,
    deleteTrackTemplate: leaveReferencesUnmapped,
    createProjectFromTemplate: leaveReferencesUnmapped,
    setProductionBrief: leaveReferencesUnmapped,
    repairProjectData: leaveReferencesUnmapped,
    createVcaGroup: leaveReferencesUnmapped,
    assignToVca: remapVca,
    removeFromVca: leaveReferencesUnmapped,
    setVcaGain: remapVca,
    restoreLegacyVcaState: leaveReferencesUnmapped,
    setMidiOutput: leaveReferencesUnmapped,
    clearMidiOutput: leaveReferencesUnmapped,
    restoreMidiOutput: leaveReferencesUnmapped,
    addNotes: leaveReferencesUnmapped,
    completeMidi: leaveReferencesUnmapped,
    variationMidi: leaveReferencesUnmapped,
    generateBassline: leaveReferencesUnmapped,
    replayGeneratedMidi: leaveReferencesUnmapped,
    stemSeparate: leaveReferencesUnmapped,
    autoOrganizeProject: leaveReferencesUnmapped,
    addChordEvent: leaveReferencesUnmapped,
    moveChordEvent: remapChordEvent,
    updateChordEvent: remapChordEvent,
    removeChordEvent: remapChordEvent,
    toggleChordTrack: leaveReferencesUnmapped,
    clearChordTrack: leaveReferencesUnmapped,
    restoreChordTrackState: leaveReferencesUnmapped,
    clearAllMidiMappings: leaveReferencesUnmapped,
    completeMidiLearn: leaveReferencesUnmapped,
    removeMidiMapping: leaveReferencesUnmapped,
    restoreMidiLearnMappings: leaveReferencesUnmapped,
    toggleScratchPad: leaveReferencesUnmapped,
    captureScratchPad: leaveReferencesUnmapped,
    commitScratchPad: leaveReferencesUnmapped,
    clearScratchPad: leaveReferencesUnmapped,
    removeScratchPadSection: remapScratchPadSection,
    renameScratchPadSection: remapScratchPadSection,
    reorderScratchPadSection: remapScratchPadSection,
    setScratchPadSectionColor: remapScratchPadSection,
    createPatternInstance: leaveReferencesUnmapped,
    detachPatternInstance: leaveReferencesUnmapped,
    restorePatternInstanceLink: leaveReferencesUnmapped,
    startMacroRecording: leaveReferencesUnmapped,
    stopMacroRecording: leaveReferencesUnmapped,
    playMacro: leaveReferencesUnmapped,
    deleteMacro: leaveReferencesUnmapped,
    renameMacro: leaveReferencesUnmapped,
    undo: leaveReferencesUnmapped,
    redo: leaveReferencesUnmapped,
    toggleUndoTree: leaveReferencesUnmapped,
    labelUndoBranch: leaveReferencesUnmapped,
    detectSongStructure: leaveReferencesUnmapped,
    createProjectVersion: leaveReferencesUnmapped,
    restoreProjectVersion: leaveReferencesUnmapped,
    createVersionBranch: leaveReferencesUnmapped,
    generateFill: leaveReferencesUnmapped,
    generateAllTransitions: leaveReferencesUnmapped,
    compareToReference: leaveReferencesUnmapped,
    toggleControlRoomMono: leaveReferencesUnmapped,
    toggleControlRoomDim: leaveReferencesUnmapped,
    switchMonitor: leaveReferencesUnmapped,
    getMentorTips: leaveReferencesUnmapped,
    searchSamples: leaveReferencesUnmapped,
    createCompGroup: leaveReferencesUnmapped,
    togglePunchRecording: leaveReferencesUnmapped,
    toggleLoopRecord: leaveReferencesUnmapped,
    triggerScene: leaveReferencesUnmapped,
    nextSetlistItem: leaveReferencesUnmapped,
    previousSetlistItem: leaveReferencesUnmapped,
    createAdjustmentLayer: leaveReferencesUnmapped,
    removeAdjustmentLayer: remapAdjustmentLayer,
    toggleAdjustmentLayer: remapAdjustmentLayer,
    setLayerParameter: remapAdjustmentLayer,
    setLayerMix: remapAdjustmentLayer,
    addAdjustmentRegion: leaveReferencesUnmapped,
    removeAdjustmentRegion: remapAdjustmentLayerRegion,
    moveAdjustmentRegion: remapAdjustmentRegion,
    setLayerFades: remapAdjustmentRegion,
    setLayerAffectedTracks: remapAdjustmentLayer,
    setLayerInsertionIndex: remapAdjustmentLayer,
    restoreAdjustmentLayerMutation: leaveReferencesUnmapped,
    detectTransients: leaveReferencesUnmapped,
    quantizeTransients: leaveReferencesUnmapped,
    openElasticEditor: leaveReferencesUnmapped,
    closeElasticEditor: leaveReferencesUnmapped,
    elasticSetSensitivity: leaveReferencesUnmapped,
    elasticAddMarker: leaveReferencesUnmapped,
    elasticRemoveMarker: leaveReferencesUnmapped,
    elasticToggleMarkerLock: leaveReferencesUnmapped,
    elasticSetTool: leaveReferencesUnmapped,
    toggleNodeView: leaveReferencesUnmapped,
    setControlSurface: leaveReferencesUnmapped,
    addCvOutput: leaveReferencesUnmapped,
    removeCvOutput: leaveReferencesUnmapped,
    connectPush: leaveReferencesUnmapped,
    disconnectPush: leaveReferencesUnmapped,
    exportDawProject: leaveReferencesUnmapped,
    importDawProject: leaveReferencesUnmapped,
    loadRaveModel: leaveReferencesUnmapped,
    setRaveBlend: leaveReferencesUnmapped,
    enableWarping: leaveReferencesUnmapped,
    setClipWarpState: leaveReferencesUnmapped,
    setWarpAlgorithm: leaveReferencesUnmapped,
    setWarpPitchShift: leaveReferencesUnmapped,
    setYeastProcessorParam: leaveReferencesUnmapped,
    setYeastArpPattern: leaveReferencesUnmapped,
    setYeastProcessorBypass: leaveReferencesUnmapped,
    addYeastProcessor: leaveReferencesUnmapped,
    removeYeastProcessor: leaveReferencesUnmapped,
    reorderYeastProcessor: leaveReferencesUnmapped,
    commitRecording: leaveReferencesUnmapped,
    discardRecording: leaveReferencesUnmapped,
    restoreRecording: leaveReferencesUnmapped,
    appendOverdubControllers: leaveReferencesUnmapped,
    removeOverdubControllers: leaveReferencesUnmapped,
};
