import { type AppAction, type AppActionType } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import {
    GROOVE_TEMPLATE_SCHEMA_VERSION,
    STRAIGHT_GROOVE_TEMPLATE_ID,
    canonicalizeGrooveTemplateId,
    isGrooveTemplate,
} from '../../models/GrooveTemplate';
import {
    type GrooveTemplateAssignment,
    type GrooveTemplateState,
    isGrooveTemplateAssignment,
} from '../../models/GrooveTemplateState';

import { canonicalizeGrooveTemplateAssignment } from './canonicalizeGrooveTemplateAssignment';

function withAssignment(state: GrooveTemplateState, assignment: GrooveTemplateAssignment): GrooveTemplateState {
    const others = state.assignments.filter(
        (candidate) =>
            candidate.consumerType !== assignment.consumerType || candidate.consumerId !== assignment.consumerId
    );
    return { ...state, assignments: [...others, assignment] };
}

function withoutAssignment(
    state: GrooveTemplateState,
    consumerType: GrooveTemplateAssignment['consumerType'],
    consumerId: string
): GrooveTemplateState {
    return {
        ...state,
        assignments: state.assignments.filter(
            (candidate) => candidate.consumerType !== consumerType || candidate.consumerId !== consumerId
        ),
    };
}

function hasTemplate(state: GrooveTemplateState, templateId: string): boolean {
    return state.templates.some((template) => template.id === templateId);
}

function assign(state: GrooveTemplateState, assignment: GrooveTemplateAssignment | null): GrooveTemplateState {
    if (assignment === null || !hasTemplate(state, assignment.templateId)) {
        return state;
    }
    return withAssignment(state, assignment);
}

function findAssignment(
    state: GrooveTemplateState,
    consumerType: GrooveTemplateAssignment['consumerType'],
    consumerId: string
): GrooveTemplateAssignment | null {
    return (
        state.assignments.find(
            (candidate) => candidate.consumerType === consumerType && candidate.consumerId === consumerId
        ) ?? null
    );
}

function deleteTemplate(
    state: GrooveTemplateState,
    action: Extract<AppAction, { type: 'deleteGrooveTemplate' }>
): GrooveTemplateState {
    const { templateId, expectedTemplate } = action.payload;
    const template = state.templates.find((candidate) => candidate.id === templateId);
    if (!template || templateId === STRAIGHT_GROOVE_TEMPLATE_ID || template.provenance.type === 'builtin') {
        return state;
    }
    const guarded = expectedTemplate !== undefined;
    if (
        guarded &&
        (!valuesEqual(template, expectedTemplate) ||
            state.assignments.some((assignment) => assignment.templateId === templateId))
    ) {
        return state;
    }
    return {
        templates: state.templates.filter((candidate) => candidate.id !== templateId),
        assignments: state.assignments.map((assignment) => resetAssignmentOfDeletedTemplate(assignment, templateId)),
    };
}

function resetAssignmentOfDeletedTemplate(
    assignment: GrooveTemplateState['assignments'][number],
    deletedTemplateId: string
): GrooveTemplateState['assignments'][number] {
    if (assignment.templateId !== deletedTemplateId) {
        return assignment;
    }
    return { ...assignment, templateId: STRAIGHT_GROOVE_TEMPLATE_ID };
}

function restoreDeletedTemplate(
    state: GrooveTemplateState,
    action: Extract<AppAction, { type: 'restoreDeletedGrooveTemplate' }>
): GrooveTemplateState {
    const { template, templateIndex, assignments } = action.payload;
    if (!isGrooveTemplate(template) || hasTemplate(state, template.id)) {
        return state;
    }
    const templates = [...state.templates];
    templates.splice(Math.max(0, Math.min(templateIndex, templates.length)), 0, structuredClone(template));
    let restored: GrooveTemplateState = { ...state, templates };
    for (const prior of assignments) {
        const current = findAssignment(restored, prior.assignment.consumerType, prior.assignment.consumerId);
        if (
            isGrooveTemplateAssignment(prior.assignment) &&
            current?.templateId === STRAIGHT_GROOVE_TEMPLATE_ID &&
            current.amount === prior.assignment.amount
        ) {
            restored = withAssignment(restored, prior.assignment);
        }
    }
    return restored;
}

function restoreAssignment(
    state: GrooveTemplateState,
    action: Extract<AppAction, { type: 'restoreGrooveAssignment' }>
): GrooveTemplateState {
    const { consumerType, consumerId, assignment, expectedAssignment } = action.payload;
    const current = findAssignment(state, consumerType, consumerId);
    if (expectedAssignment !== undefined && !valuesEqual(current, expectedAssignment)) {
        return state;
    }
    if (assignment === null) {
        return withoutAssignment(state, consumerType, consumerId);
    }
    return isGrooveTemplateAssignment(assignment) ? withAssignment(state, assignment) : state;
}

type ActionOf<Type extends AppActionType> = Extract<AppAction, { type: Type }>;

type GrooveTemplateActionProjector<Type extends AppActionType> = (
    state: GrooveTemplateState,
    action: ActionOf<Type>
) => GrooveTemplateState;

function leaveGrooveTemplateStateUnchanged(state: GrooveTemplateState): GrooveTemplateState {
    return state;
}

// Only a pinned extraction names the template it creates; one that found no groove creates none.
function projectExtractGroove(state: GrooveTemplateState, action: ActionOf<'extractGroove'>): GrooveTemplateState {
    const { proposal } = action.payload;
    if (!isGrooveTemplate(proposal) || hasTemplate(state, proposal.id)) {
        return state;
    }
    return { ...state, templates: [...state.templates, structuredClone(proposal)] };
}

function projectCreateGrooveTemplate(
    state: GrooveTemplateState,
    action: ActionOf<'createGrooveTemplate'>
): GrooveTemplateState {
    const id = canonicalizeGrooveTemplateId(action.payload.id);
    const template = { ...action.payload, id, schemaVersion: GROOVE_TEMPLATE_SCHEMA_VERSION };
    if (id === null || !isGrooveTemplate(template) || hasTemplate(state, id)) {
        return state;
    }
    return { ...state, templates: [...state.templates, structuredClone(template)] };
}

function projectAssignGrooveTemplate(
    state: GrooveTemplateState,
    action: ActionOf<'assignGrooveTemplate'>
): GrooveTemplateState {
    return assign(state, canonicalizeGrooveTemplateAssignment(action.payload));
}

function projectApplyGroove(state: GrooveTemplateState, action: ActionOf<'applyGroove'>): GrooveTemplateState {
    return assign(
        state,
        canonicalizeGrooveTemplateAssignment({
            consumerType: 'clip',
            consumerId: action.payload.clipId,
            templateId: action.payload.grooveId,
            amount: action.payload.amount ?? 1,
        })
    );
}

/** How each action changes the groove pool and assignments; every action outside the groove family leaves them as they are. */
export const grooveTemplateProjectorByActionType: {
    readonly [Type in AppActionType]: GrooveTemplateActionProjector<Type>;
} = {
    importStemSet: leaveGrooveTemplateStateUnchanged,
    discardImportedStemSet: leaveGrooveTemplateStateUnchanged,
    addTrack: leaveGrooveTemplateStateUnchanged,
    removeTrack: leaveGrooveTemplateStateUnchanged,
    discardCreatedTrack: leaveGrooveTemplateStateUnchanged,
    restoreTrack: leaveGrooveTemplateStateUnchanged,
    restoreClip: leaveGrooveTemplateStateUnchanged,
    discardDuplicatedClip: leaveGrooveTemplateStateUnchanged,
    removeAllTracks: leaveGrooveTemplateStateUnchanged,
    renameTrack: leaveGrooveTemplateStateUnchanged,
    createTrackAlternative: leaveGrooveTemplateStateUnchanged,
    switchTrackAlternative: leaveGrooveTemplateStateUnchanged,
    renameTrackAlternative: leaveGrooveTemplateStateUnchanged,
    deleteTrackAlternative: leaveGrooveTemplateStateUnchanged,
    selectTrack: leaveGrooveTemplateStateUnchanged,
    muteTrack: leaveGrooveTemplateStateUnchanged,
    soloTrack: leaveGrooveTemplateStateUnchanged,
    selectTake: leaveGrooveTemplateStateUnchanged,
    replaceOriginalMidiTakeRow: leaveGrooveTemplateStateUnchanged,
    replaceOriginalMidiBaseRow: leaveGrooveTemplateStateUnchanged,
    toggleSoloSafe: leaveGrooveTemplateStateUnchanged,
    setSoloSafe: leaveGrooveTemplateStateUnchanged,
    restoreSoloSafe: leaveGrooveTemplateStateUnchanged,
    armTrack: leaveGrooveTemplateStateUnchanged,
    freezeTrack: leaveGrooveTemplateStateUnchanged,
    unfreezeTrack: leaveGrooveTemplateStateUnchanged,
    restoreFreezeState: leaveGrooveTemplateStateUnchanged,
    flattenTrack: leaveGrooveTemplateStateUnchanged,
    bounceInPlace: leaveGrooveTemplateStateUnchanged,
    reorderTrack: leaveGrooveTemplateStateUnchanged,
    setTempo: leaveGrooveTemplateStateUnchanged,
    restoreTempoEdit: leaveGrooveTemplateStateUnchanged,
    editTempoMap: leaveGrooveTemplateStateUnchanged,
    restoreTempoMapEdit: leaveGrooveTemplateStateUnchanged,
    setTimeSignature: leaveGrooveTemplateStateUnchanged,
    setPlayback: leaveGrooveTemplateStateUnchanged,
    togglePlayback: leaveGrooveTemplateStateUnchanged,
    stopPlayback: leaveGrooveTemplateStateUnchanged,
    toggleRecording: leaveGrooveTemplateStateUnchanged,
    setMasterGain: leaveGrooveTemplateStateUnchanged,
    restoreMasterGain: leaveGrooveTemplateStateUnchanged,
    toggleLoop: leaveGrooveTemplateStateUnchanged,
    toggleMetronome: leaveGrooveTemplateStateUnchanged,
    setMetronomeVolume: leaveGrooveTemplateStateUnchanged,
    setLoopRegion: leaveGrooveTemplateStateUnchanged,
    setLoopEnabled: leaveGrooveTemplateStateUnchanged,
    setMetronomeEnabled: leaveGrooveTemplateStateUnchanged,
    restoreLoopRegion: leaveGrooveTemplateStateUnchanged,
    addClip: leaveGrooveTemplateStateUnchanged,
    moveClip: leaveGrooveTemplateStateUnchanged,
    restoreClipPlacement: leaveGrooveTemplateStateUnchanged,
    duplicateClip: leaveGrooveTemplateStateUnchanged,
    duplicateClipToNextBar: leaveGrooveTemplateStateUnchanged,
    duplicateTrack: leaveGrooveTemplateStateUnchanged,
    removeClip: leaveGrooveTemplateStateUnchanged,
    renameClip: leaveGrooveTemplateStateUnchanged,
    splitClip: leaveGrooveTemplateStateUnchanged,
    restoreClipSplitState: leaveGrooveTemplateStateUnchanged,
    trimClipStart: leaveGrooveTemplateStateUnchanged,
    trimClipEnd: leaveGrooveTemplateStateUnchanged,
    restoreAudioClipStartTrim: leaveGrooveTemplateStateUnchanged,
    restoreAudioClipSlip: leaveGrooveTemplateStateUnchanged,
    slipClipContent: leaveGrooveTemplateStateUnchanged,
    drawClip: leaveGrooveTemplateStateUnchanged,
    discardDrawnClip: leaveGrooveTemplateStateUnchanged,
    restoreDrawnClip: leaveGrooveTemplateStateUnchanged,
    duplicateClipAt: leaveGrooveTemplateStateUnchanged,
    moveClips: leaveGrooveTemplateStateUnchanged,
    restoreClipMoves: leaveGrooveTemplateStateUnchanged,
    addDevice: leaveGrooveTemplateStateUnchanged,
    bypassDevice: leaveGrooveTemplateStateUnchanged,
    removeDevice: leaveGrooveTemplateStateUnchanged,
    restoreDevice: leaveGrooveTemplateStateUnchanged,
    reorderDevices: leaveGrooveTemplateStateUnchanged,
    setDeviceParameter: leaveGrooveTemplateStateUnchanged,
    setExternalPluginState: leaveGrooveTemplateStateUnchanged,
    setDeviceState: leaveGrooveTemplateStateUnchanged,
    setFermenterPatch: leaveGrooveTemplateStateUnchanged,
    setLevainIdentity: leaveGrooveTemplateStateUnchanged,
    setGrandBouleDeviceState: leaveGrooveTemplateStateUnchanged,
    setToasterFactoryKit: leaveGrooveTemplateStateUnchanged,
    setBacteriaFactoryPatch: leaveGrooveTemplateStateUnchanged,
    setCrustFactoryPreset: leaveGrooveTemplateStateUnchanged,
    setGlutenFactoryPreset: leaveGrooveTemplateStateUnchanged,
    setProofPatchSelection: leaveGrooveTemplateStateUnchanged,
    createBus: leaveGrooveTemplateStateUnchanged,
    createFolder: leaveGrooveTemplateStateUnchanged,
    setSend: leaveGrooveTemplateStateUnchanged,
    setWorkspaceMode: leaveGrooveTemplateStateUnchanged,
    openPreferencesDialog: leaveGrooveTemplateStateUnchanged,
    openMixer: leaveGrooveTemplateStateUnchanged,
    closeMixer: leaveGrooveTemplateStateUnchanged,
    toggleSidebar: leaveGrooveTemplateStateUnchanged,
    toggleInspector: leaveGrooveTemplateStateUnchanged,
    toggleChatPanel: leaveGrooveTemplateStateUnchanged,
    setTrackInput: leaveGrooveTemplateStateUnchanged,
    restoreTrackInput: leaveGrooveTemplateStateUnchanged,
    setEditingTool: leaveGrooveTemplateStateUnchanged,
    setMarqueeSelection: leaveGrooveTemplateStateUnchanged,
    addMarker: leaveGrooveTemplateStateUnchanged,
    removeMarker: leaveGrooveTemplateStateUnchanged,
    setMarkerColor: leaveGrooveTemplateStateUnchanged,
    addSection: leaveGrooveTemplateStateUnchanged,
    removeSection: leaveGrooveTemplateStateUnchanged,
    renameSection: leaveGrooveTemplateStateUnchanged,
    renameMarker: leaveGrooveTemplateStateUnchanged,
    moveMarker: leaveGrooveTemplateStateUnchanged,
    moveSection: leaveGrooveTemplateStateUnchanged,
    resizeSection: leaveGrooveTemplateStateUnchanged,
    setSectionColor: leaveGrooveTemplateStateUnchanged,
    reorderSection: leaveGrooveTemplateStateUnchanged,
    navigateSection: leaveGrooveTemplateStateUnchanged,
    rehearseSection: leaveGrooveTemplateStateUnchanged,
    restoreSectionBeats: leaveGrooveTemplateStateUnchanged,
    setClipGainEnvelope: leaveGrooveTemplateStateUnchanged,
    toggleClipGainEnvelope: leaveGrooveTemplateStateUnchanged,
    addGainEnvelopePoint: leaveGrooveTemplateStateUnchanged,
    removeGainEnvelopePoint: leaveGrooveTemplateStateUnchanged,
    resetClipGainEnvelope: leaveGrooveTemplateStateUnchanged,
    addModulator: leaveGrooveTemplateStateUnchanged,
    removeModulator: leaveGrooveTemplateStateUnchanged,
    updateModulator: leaveGrooveTemplateStateUnchanged,
    addMapping: leaveGrooveTemplateStateUnchanged,
    removeMapping: leaveGrooveTemplateStateUnchanged,
    addAutomationLane: leaveGrooveTemplateStateUnchanged,
    automateSendRange: leaveGrooveTemplateStateUnchanged,
    automateSendRanges: leaveGrooveTemplateStateUnchanged,
    removeSendAutomationRanges: leaveGrooveTemplateStateUnchanged,
    renderProjectSections: leaveGrooveTemplateStateUnchanged,
    removeRenderedProjectSections: leaveGrooveTemplateStateUnchanged,
    automateTrackGainRange: leaveGrooveTemplateStateUnchanged,
    automateParameterRange: leaveGrooveTemplateStateUnchanged,
    removeTrackGainAutomationRange: leaveGrooveTemplateStateUnchanged,
    removeSendAutomationRange: leaveGrooveTemplateStateUnchanged,
    removeAutomationLane: leaveGrooveTemplateStateUnchanged,
    setAutomationLaneEnabled: leaveGrooveTemplateStateUnchanged,
    addAutomationPoint: leaveGrooveTemplateStateUnchanged,
    insertAutomationLanePoints: leaveGrooveTemplateStateUnchanged,
    quantizeNotes: leaveGrooveTemplateStateUnchanged,
    removeShortMidiOverlaps: leaveGrooveTemplateStateUnchanged,
    createDrumPreviewBranches: leaveGrooveTemplateStateUnchanged,
    deleteDrumPreviewBranches: leaveGrooveTemplateStateUnchanged,
    copyMidiArticulations: leaveGrooveTemplateStateUnchanged,
    restoreMidiClipNotes: leaveGrooveTemplateStateUnchanged,
    quantizeNoteLengths: leaveGrooveTemplateStateUnchanged,
    transposeNotes: leaveGrooveTemplateStateUnchanged,
    humanizeNotes: leaveGrooveTemplateStateUnchanged,
    invertNotes: leaveGrooveTemplateStateUnchanged,
    retrogradeNotes: leaveGrooveTemplateStateUnchanged,
    scaleVelocities: leaveGrooveTemplateStateUnchanged,
    scaleAllVelocities: leaveGrooveTemplateStateUnchanged,
    setAllVelocities: leaveGrooveTemplateStateUnchanged,
    setTrackGain: leaveGrooveTemplateStateUnchanged,
    setTrackPan: leaveGrooveTemplateStateUnchanged,
    setTrackColor: leaveGrooveTemplateStateUnchanged,
    copyClip: leaveGrooveTemplateStateUnchanged,
    cutClip: leaveGrooveTemplateStateUnchanged,
    pasteClip: leaveGrooveTemplateStateUnchanged,
    setClipFade: leaveGrooveTemplateStateUnchanged,
    importMidiFile: leaveGrooveTemplateStateUnchanged,
    normalizeClip: leaveGrooveTemplateStateUnchanged,
    relinkClipAudioSources: leaveGrooveTemplateStateUnchanged,
    reverseClip: leaveGrooveTemplateStateUnchanged,
    restoreReversedClip: leaveGrooveTemplateStateUnchanged,
    glueClips: leaveGrooveTemplateStateUnchanged,
    restoreClipGlueState: leaveGrooveTemplateStateUnchanged,
    setCompRegion: leaveGrooveTemplateStateUnchanged,
    removeCompRegion: leaveGrooveTemplateStateUnchanged,
    restoreCompRegionInterval: leaveGrooveTemplateStateUnchanged,
    nudgeClip: leaveGrooveTemplateStateUnchanged,
    crossfadeClips: leaveGrooveTemplateStateUnchanged,
    restoreCrossfadeClips: leaveGrooveTemplateStateUnchanged,
    setClipGain: leaveGrooveTemplateStateUnchanged,
    setClipColor: leaveGrooveTemplateStateUnchanged,
    lockClip: leaveGrooveTemplateStateUnchanged,
    consolidateSelection: leaveGrooveTemplateStateUnchanged,
    bounceSelection: leaveGrooveTemplateStateUnchanged,
    seekPlayhead: leaveGrooveTemplateStateUnchanged,
    setPunchIn: leaveGrooveTemplateStateUnchanged,
    setPunchOut: leaveGrooveTemplateStateUnchanged,
    setPunchEnabled: leaveGrooveTemplateStateUnchanged,
    restorePunchRegion: leaveGrooveTemplateStateUnchanged,
    togglePunch: leaveGrooveTemplateStateUnchanged,
    toggleCountIn: leaveGrooveTemplateStateUnchanged,
    setCountInBars: leaveGrooveTemplateStateUnchanged,
    togglePreRoll: leaveGrooveTemplateStateUnchanged,
    setPreRollBars: leaveGrooveTemplateStateUnchanged,
    zoomTracksVertical: leaveGrooveTemplateStateUnchanged,
    addTimeSignatureChange: leaveGrooveTemplateStateUnchanged,
    removeTimeSignatureChange: leaveGrooveTemplateStateUnchanged,
    setTrackOutput: leaveGrooveTemplateStateUnchanged,
    addSend: leaveGrooveTemplateStateUnchanged,
    removeSend: leaveGrooveTemplateStateUnchanged,
    removeAutomationPoint: leaveGrooveTemplateStateUnchanged,
    setAutomationMode: leaveGrooveTemplateStateUnchanged,
    hideTrack: leaveGrooveTemplateStateUnchanged,
    disableTrack: leaveGrooveTemplateStateUnchanged,
    restoreTrackDisabled: leaveGrooveTemplateStateUnchanged,
    setTrackHeight: leaveGrooveTemplateStateUnchanged,
    setSnapValue: leaveGrooveTemplateStateUnchanged,
    zoomToFit: leaveGrooveTemplateStateUnchanged,
    zoomToSelection: leaveGrooveTemplateStateUnchanged,
    exportProject: leaveGrooveTemplateStateUnchanged,
    saveProject: leaveGrooveTemplateStateUnchanged,
    newProject: leaveGrooveTemplateStateUnchanged,
    importAudioFile: leaveGrooveTemplateStateUnchanged,
    exportMidi: leaveGrooveTemplateStateUnchanged,
    foldTrack: leaveGrooveTemplateStateUnchanged,
    groupTracks: leaveGrooveTemplateStateUnchanged,
    ungroupTracks: leaveGrooveTemplateStateUnchanged,
    scaleAutomation: leaveGrooveTemplateStateUnchanged,
    stretchAutomation: leaveGrooveTemplateStateUnchanged,
    invertAutomation: leaveGrooveTemplateStateUnchanged,
    reverseAutomation: leaveGrooveTemplateStateUnchanged,
    thinAutomation: leaveGrooveTemplateStateUnchanged,
    quantizeAutomation: leaveGrooveTemplateStateUnchanged,
    restoreAutomationLanePoints: leaveGrooveTemplateStateUnchanged,
    restoreAutomationPointPresence: leaveGrooveTemplateStateUnchanged,
    loadPreset: leaveGrooveTemplateStateUnchanged,
    restorePresetDeviceChain: leaveGrooveTemplateStateUnchanged,
    savePreset: leaveGrooveTemplateStateUnchanged,
    generateDrumPattern: leaveGrooveTemplateStateUnchanged,
    generateMelody: leaveGrooveTemplateStateUnchanged,
    generateChordProgression: leaveGrooveTemplateStateUnchanged,
    setClipLoop: leaveGrooveTemplateStateUnchanged,
    restoreClipLoop: leaveGrooveTemplateStateUnchanged,
    setClipLoopLength: leaveGrooveTemplateStateUnchanged,
    restoreClipLoopLength: leaveGrooveTemplateStateUnchanged,
    createGrooveTemplate: projectCreateGrooveTemplate,
    renameGrooveTemplate: leaveGrooveTemplateStateUnchanged,
    restoreGrooveTemplateName: leaveGrooveTemplateStateUnchanged,
    deleteGrooveTemplate: deleteTemplate,
    restoreDeletedGrooveTemplate: restoreDeletedTemplate,
    assignGrooveTemplate: projectAssignGrooveTemplate,
    restoreGrooveAssignment: restoreAssignment,
    extractGroove: projectExtractGroove,
    applyGroove: projectApplyGroove,
    setClipStretchMode: leaveGrooveTemplateStateUnchanged,
    setClipStretchRatio: leaveGrooveTemplateStateUnchanged,
    restoreClipStretchState: leaveGrooveTemplateStateUnchanged,
    fitClipToBeats: leaveGrooveTemplateStateUnchanged,
    analyzeMix: leaveGrooveTemplateStateUnchanged,
    autoFixMix: leaveGrooveTemplateStateUnchanged,
    enableMpe: leaveGrooveTemplateStateUnchanged,
    disableMpe: leaveGrooveTemplateStateUnchanged,
    getLatencyReport: leaveGrooveTemplateStateUnchanged,
    createCollabSession: leaveGrooveTemplateStateUnchanged,
    joinCollabSession: leaveGrooveTemplateStateUnchanged,
    leaveCollabSession: leaveGrooveTemplateStateUnchanged,
    scanPlugins: leaveGrooveTemplateStateUnchanged,
    loadExternalPlugin: leaveGrooveTemplateStateUnchanged,
    audioToMidi: leaveGrooveTemplateStateUnchanged,
    commitPitchEdit: leaveGrooveTemplateStateUnchanged,
    restoreClipFileId: leaveGrooveTemplateStateUnchanged,
    muteClip: leaveGrooveTemplateStateUnchanged,
    clearSolos: leaveGrooveTemplateStateUnchanged,
    restoreTrackSoloStates: leaveGrooveTemplateStateUnchanged,
    setTrackNotes: leaveGrooveTemplateStateUnchanged,
    deleteTime: leaveGrooveTemplateStateUnchanged,
    insertTime: leaveGrooveTemplateStateUnchanged,
    duplicateTimeRange: leaveGrooveTemplateStateUnchanged,
    restoreTimeOperationState: leaveGrooveTemplateStateUnchanged,
    restoreTrackHeights: leaveGrooveTemplateStateUnchanged,
    restoreTrackGroupMemberships: leaveGrooveTemplateStateUnchanged,
    restoreTracks: leaveGrooveTemplateStateUnchanged,
    restoreTrackClipStates: leaveGrooveTemplateStateUnchanged,
    discardCreatedTracks: leaveGrooveTemplateStateUnchanged,
    discardCreatedCompGroup: leaveGrooveTemplateStateUnchanged,
    restoreTrackAlternativeState: leaveGrooveTemplateStateUnchanged,
    restoreScratchPadState: leaveGrooveTemplateStateUnchanged,
    stripSilence: leaveGrooveTemplateStateUnchanged,
    restoreStripSilenceState: leaveGrooveTemplateStateUnchanged,
    detectTempo: leaveGrooveTemplateStateUnchanged,
    detectKey: leaveGrooveTemplateStateUnchanged,
    consolidateAllTracks: leaveGrooveTemplateStateUnchanged,
    arpeggiate: leaveGrooveTemplateStateUnchanged,
    addSidechainRoute: leaveGrooveTemplateStateUnchanged,
    removeSidechainRoute: leaveGrooveTemplateStateUnchanged,
    bounceToNewTrack: leaveGrooveTemplateStateUnchanged,
    saveTrackTemplate: leaveGrooveTemplateStateUnchanged,
    loadTrackTemplate: leaveGrooveTemplateStateUnchanged,
    deleteTrackTemplate: leaveGrooveTemplateStateUnchanged,
    createProjectFromTemplate: leaveGrooveTemplateStateUnchanged,
    setProductionBrief: leaveGrooveTemplateStateUnchanged,
    repairProjectData: leaveGrooveTemplateStateUnchanged,
    createVcaGroup: leaveGrooveTemplateStateUnchanged,
    assignToVca: leaveGrooveTemplateStateUnchanged,
    removeFromVca: leaveGrooveTemplateStateUnchanged,
    setVcaGain: leaveGrooveTemplateStateUnchanged,
    restoreLegacyVcaState: leaveGrooveTemplateStateUnchanged,
    setMidiOutput: leaveGrooveTemplateStateUnchanged,
    clearMidiOutput: leaveGrooveTemplateStateUnchanged,
    restoreMidiOutput: leaveGrooveTemplateStateUnchanged,
    addNotes: leaveGrooveTemplateStateUnchanged,
    completeMidi: leaveGrooveTemplateStateUnchanged,
    variationMidi: leaveGrooveTemplateStateUnchanged,
    generateBassline: leaveGrooveTemplateStateUnchanged,
    replayGeneratedMidi: leaveGrooveTemplateStateUnchanged,
    stemSeparate: leaveGrooveTemplateStateUnchanged,
    autoOrganizeProject: leaveGrooveTemplateStateUnchanged,
    addChordEvent: leaveGrooveTemplateStateUnchanged,
    moveChordEvent: leaveGrooveTemplateStateUnchanged,
    updateChordEvent: leaveGrooveTemplateStateUnchanged,
    removeChordEvent: leaveGrooveTemplateStateUnchanged,
    toggleChordTrack: leaveGrooveTemplateStateUnchanged,
    clearChordTrack: leaveGrooveTemplateStateUnchanged,
    restoreChordTrackState: leaveGrooveTemplateStateUnchanged,
    clearAllMidiMappings: leaveGrooveTemplateStateUnchanged,
    completeMidiLearn: leaveGrooveTemplateStateUnchanged,
    removeMidiMapping: leaveGrooveTemplateStateUnchanged,
    restoreMidiLearnMappings: leaveGrooveTemplateStateUnchanged,
    toggleScratchPad: leaveGrooveTemplateStateUnchanged,
    captureScratchPad: leaveGrooveTemplateStateUnchanged,
    commitScratchPad: leaveGrooveTemplateStateUnchanged,
    clearScratchPad: leaveGrooveTemplateStateUnchanged,
    removeScratchPadSection: leaveGrooveTemplateStateUnchanged,
    renameScratchPadSection: leaveGrooveTemplateStateUnchanged,
    reorderScratchPadSection: leaveGrooveTemplateStateUnchanged,
    setScratchPadSectionColor: leaveGrooveTemplateStateUnchanged,
    createPatternInstance: leaveGrooveTemplateStateUnchanged,
    detachPatternInstance: leaveGrooveTemplateStateUnchanged,
    restorePatternInstanceLink: leaveGrooveTemplateStateUnchanged,
    startMacroRecording: leaveGrooveTemplateStateUnchanged,
    stopMacroRecording: leaveGrooveTemplateStateUnchanged,
    playMacro: leaveGrooveTemplateStateUnchanged,
    deleteMacro: leaveGrooveTemplateStateUnchanged,
    renameMacro: leaveGrooveTemplateStateUnchanged,
    undo: leaveGrooveTemplateStateUnchanged,
    redo: leaveGrooveTemplateStateUnchanged,
    toggleUndoTree: leaveGrooveTemplateStateUnchanged,
    labelUndoBranch: leaveGrooveTemplateStateUnchanged,
    detectSongStructure: leaveGrooveTemplateStateUnchanged,
    createProjectVersion: leaveGrooveTemplateStateUnchanged,
    restoreProjectVersion: leaveGrooveTemplateStateUnchanged,
    createVersionBranch: leaveGrooveTemplateStateUnchanged,
    generateFill: leaveGrooveTemplateStateUnchanged,
    generateAllTransitions: leaveGrooveTemplateStateUnchanged,
    compareToReference: leaveGrooveTemplateStateUnchanged,
    toggleControlRoomMono: leaveGrooveTemplateStateUnchanged,
    toggleControlRoomDim: leaveGrooveTemplateStateUnchanged,
    switchMonitor: leaveGrooveTemplateStateUnchanged,
    getMentorTips: leaveGrooveTemplateStateUnchanged,
    searchSamples: leaveGrooveTemplateStateUnchanged,
    createCompGroup: leaveGrooveTemplateStateUnchanged,
    togglePunchRecording: leaveGrooveTemplateStateUnchanged,
    toggleLoopRecord: leaveGrooveTemplateStateUnchanged,
    triggerScene: leaveGrooveTemplateStateUnchanged,
    nextSetlistItem: leaveGrooveTemplateStateUnchanged,
    previousSetlistItem: leaveGrooveTemplateStateUnchanged,
    createAdjustmentLayer: leaveGrooveTemplateStateUnchanged,
    removeAdjustmentLayer: leaveGrooveTemplateStateUnchanged,
    toggleAdjustmentLayer: leaveGrooveTemplateStateUnchanged,
    setLayerParameter: leaveGrooveTemplateStateUnchanged,
    setLayerMix: leaveGrooveTemplateStateUnchanged,
    addAdjustmentRegion: leaveGrooveTemplateStateUnchanged,
    removeAdjustmentRegion: leaveGrooveTemplateStateUnchanged,
    moveAdjustmentRegion: leaveGrooveTemplateStateUnchanged,
    setLayerFades: leaveGrooveTemplateStateUnchanged,
    setLayerAffectedTracks: leaveGrooveTemplateStateUnchanged,
    setLayerInsertionIndex: leaveGrooveTemplateStateUnchanged,
    restoreAdjustmentLayerMutation: leaveGrooveTemplateStateUnchanged,
    detectTransients: leaveGrooveTemplateStateUnchanged,
    quantizeTransients: leaveGrooveTemplateStateUnchanged,
    openElasticEditor: leaveGrooveTemplateStateUnchanged,
    closeElasticEditor: leaveGrooveTemplateStateUnchanged,
    elasticSetSensitivity: leaveGrooveTemplateStateUnchanged,
    elasticAddMarker: leaveGrooveTemplateStateUnchanged,
    elasticRemoveMarker: leaveGrooveTemplateStateUnchanged,
    elasticToggleMarkerLock: leaveGrooveTemplateStateUnchanged,
    elasticSetTool: leaveGrooveTemplateStateUnchanged,
    toggleNodeView: leaveGrooveTemplateStateUnchanged,
    setControlSurface: leaveGrooveTemplateStateUnchanged,
    addCvOutput: leaveGrooveTemplateStateUnchanged,
    removeCvOutput: leaveGrooveTemplateStateUnchanged,
    connectPush: leaveGrooveTemplateStateUnchanged,
    disconnectPush: leaveGrooveTemplateStateUnchanged,
    exportDawProject: leaveGrooveTemplateStateUnchanged,
    importDawProject: leaveGrooveTemplateStateUnchanged,
    loadRaveModel: leaveGrooveTemplateStateUnchanged,
    setRaveBlend: leaveGrooveTemplateStateUnchanged,
    enableWarping: leaveGrooveTemplateStateUnchanged,
    setWarpAlgorithm: leaveGrooveTemplateStateUnchanged,
    setWarpPitchShift: leaveGrooveTemplateStateUnchanged,
    setYeastProcessorParam: leaveGrooveTemplateStateUnchanged,
    setYeastArpPattern: leaveGrooveTemplateStateUnchanged,
    setYeastProcessorBypass: leaveGrooveTemplateStateUnchanged,
    addYeastProcessor: leaveGrooveTemplateStateUnchanged,
    removeYeastProcessor: leaveGrooveTemplateStateUnchanged,
    reorderYeastProcessor: leaveGrooveTemplateStateUnchanged,
    commitRecording: leaveGrooveTemplateStateUnchanged,
    discardRecording: leaveGrooveTemplateStateUnchanged,
    restoreRecording: leaveGrooveTemplateStateUnchanged,
    appendOverdubControllers: leaveGrooveTemplateStateUnchanged,
    removeOverdubControllers: leaveGrooveTemplateStateUnchanged,
};
