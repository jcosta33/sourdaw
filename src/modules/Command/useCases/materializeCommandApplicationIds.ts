import { type AppAction, type AppActionType } from '#/utils/handlerContract';

import { COMMAND_APPLICATION_ID_RULES } from '../models/CommandApplicationIdRule';
import {
    type CommandApplicationDefaults,
    type MaterializedCommandApplicationIds,
} from '../models/MaterializedCommandApplicationIds';
import { type CommandApplicationAssignedId } from '../models/VersionedCommandEnvelope';

import { commandTrackDefaultsPort } from './commandTrackDefaultsPort';
import { materializeTrackCreationIds } from './materializeTrackCreationIds';

type ActionOf<Type extends AppActionType> = Extract<AppAction, { type: Type }>;

const RESERVE_APPLICATION_DEFAULTS: CommandApplicationDefaults = { reserveApplicationDefaults: true };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function materializeNestedNoteIds(action: Extract<AppAction, { type: 'addNotes' }>): MaterializedCommandApplicationIds {
    const cloned = structuredClone(action);
    const applicationAssignedIds: CommandApplicationAssignedId[] = [];
    let changed = false;
    for (const [index, note] of cloned.payload.notes.entries()) {
        if (typeof note.id === 'string' && note.id !== '') {
            applicationAssignedIds.push({ argument: `notes[${String(index)}].id`, value: note.id });
            continue;
        }
        const value = `note-command-${crypto.randomUUID()}`;
        note.id = value;
        changed = true;
        applicationAssignedIds.push({ argument: `notes[${String(index)}].id`, value });
    }
    return { action: changed ? cloned : action, applicationAssignedIds };
}

function materializeMidiInputOwnerId(
    action: Extract<AppAction, { type: 'armTrack' }>
): MaterializedCommandApplicationIds {
    if (action.payload.midiInputOwnerId !== undefined) {
        return {
            action,
            applicationAssignedIds:
                typeof action.payload.midiInputOwnerId === 'string'
                    ? [{ argument: 'midiInputOwnerId', value: action.payload.midiInputOwnerId }]
                    : [],
        };
    }
    const cloned = structuredClone(action);
    const value = `arm-command-${crypto.randomUUID()}`;
    cloned.payload.midiInputOwnerId = value;
    return {
        action: cloned,
        applicationAssignedIds: [{ argument: 'midiInputOwnerId', value }],
    };
}

function materializeImportedStemIds(
    action: Extract<AppAction, { type: 'importStemSet' }>
): MaterializedCommandApplicationIds {
    const applicationAssignedIds: CommandApplicationAssignedId[] = [
        { argument: 'folderId', value: action.payload.folderId },
    ];
    if (action.payload.folderAlternativeId) {
        applicationAssignedIds.push({
            argument: 'folderAlternativeId',
            value: action.payload.folderAlternativeId,
        });
    }
    for (const [index, stem] of action.payload.stems.entries()) {
        applicationAssignedIds.push(
            { argument: `stems[${String(index)}].trackId`, value: stem.trackId },
            { argument: `stems[${String(index)}].clipId`, value: stem.clipId }
        );
        if (stem.trackAlternativeId) {
            applicationAssignedIds.push({
                argument: `stems[${String(index)}].trackAlternativeId`,
                value: stem.trackAlternativeId,
            });
        }
    }
    return { action, applicationAssignedIds };
}

function materializeBusCreationIds(
    action: Extract<AppAction, { type: 'createBus' }>,
    defaults: CommandApplicationDefaults
): MaterializedCommandApplicationIds {
    const cloned = structuredClone(action);
    const applicationAssignedIds: CommandApplicationAssignedId[] = [];
    let changed = false;
    if (!cloned.payload.busId) {
        cloned.payload.busId = `bus-command-${crypto.randomUUID()}`;
        changed = true;
        applicationAssignedIds.push({ argument: 'busId', value: cloned.payload.busId });
    }
    if (cloned.payload.busId && !applicationAssignedIds.some((entry) => entry.argument === 'busId')) {
        applicationAssignedIds.push({ argument: 'busId', value: cloned.payload.busId });
    }
    if (!cloned.payload.initialAlternativeId) {
        cloned.payload.initialAlternativeId = `alternative-command-${crypto.randomUUID()}`;
        changed = true;
        applicationAssignedIds.push({
            argument: 'initialAlternativeId',
            value: cloned.payload.initialAlternativeId,
        });
    }
    if (
        cloned.payload.initialAlternativeId &&
        !applicationAssignedIds.some((entry) => entry.argument === 'initialAlternativeId')
    ) {
        applicationAssignedIds.push({
            argument: 'initialAlternativeId',
            value: cloned.payload.initialAlternativeId,
        });
    }
    if (cloned.payload.color === undefined && defaults.reserveApplicationDefaults) {
        const color = commandTrackDefaultsPort.reserveTrackColor();
        if (color !== undefined) {
            cloned.payload.color = color;
            changed = true;
        }
    }
    return { action: changed ? cloned : action, applicationAssignedIds };
}

function materializeByIdRule(action: AppAction): MaterializedCommandApplicationIds {
    const rule = Object.hasOwn(COMMAND_APPLICATION_ID_RULES, action.type)
        ? COMMAND_APPLICATION_ID_RULES[action.type]
        : undefined;
    const payload: unknown = 'payload' in action ? action.payload : undefined;
    if (!rule || !isRecord(payload)) {
        return { action, applicationAssignedIds: [] };
    }
    const existingValue = payload[rule.argument];
    if (typeof existingValue === 'string' && existingValue !== '') {
        return {
            action,
            applicationAssignedIds: [{ argument: rule.argument, value: existingValue }],
        };
    }

    const cloned = structuredClone(action);
    const clonedPayload: unknown = 'payload' in cloned ? cloned.payload : undefined;
    if (!isRecord(clonedPayload)) {
        return { action, applicationAssignedIds: [] };
    }
    const value = `${rule.prefix}${crypto.randomUUID()}`;
    clonedPayload[rule.argument] = value;
    return {
        action: cloned,
        applicationAssignedIds: [{ argument: rule.argument, value }],
    };
}

const applicationIdMaterializerByActionType: {
    readonly [Type in AppActionType]: (
        action: ActionOf<Type>,
        defaults: CommandApplicationDefaults
    ) => MaterializedCommandApplicationIds;
} = {
    importStemSet: materializeImportedStemIds,
    discardImportedStemSet: materializeByIdRule,
    addTrack: materializeTrackCreationIds,
    removeTrack: materializeByIdRule,
    discardCreatedTrack: materializeByIdRule,
    restoreTrack: materializeByIdRule,
    restoreClip: materializeByIdRule,
    discardDuplicatedClip: materializeByIdRule,
    removeAllTracks: materializeByIdRule,
    renameTrack: materializeByIdRule,
    createTrackAlternative: materializeByIdRule,
    switchTrackAlternative: materializeByIdRule,
    renameTrackAlternative: materializeByIdRule,
    deleteTrackAlternative: materializeByIdRule,
    selectTrack: materializeByIdRule,
    muteTrack: materializeByIdRule,
    soloTrack: materializeByIdRule,
    selectTake: materializeByIdRule,
    replaceOriginalMidiTakeRow: materializeByIdRule,
    replaceOriginalMidiBaseRow: materializeByIdRule,
    toggleSoloSafe: materializeByIdRule,
    setSoloSafe: materializeByIdRule,
    restoreSoloSafe: materializeByIdRule,
    armTrack: materializeMidiInputOwnerId,
    freezeTrack: materializeByIdRule,
    unfreezeTrack: materializeByIdRule,
    restoreFreezeState: materializeByIdRule,
    flattenTrack: materializeByIdRule,
    bounceInPlace: materializeByIdRule,
    reorderTrack: materializeByIdRule,
    setTempo: materializeByIdRule,
    restoreTempoEdit: materializeByIdRule,
    editTempoMap: materializeByIdRule,
    restoreTempoMapEdit: materializeByIdRule,
    setTimeSignature: materializeByIdRule,
    setPlayback: materializeByIdRule,
    togglePlayback: materializeByIdRule,
    stopPlayback: materializeByIdRule,
    toggleRecording: materializeByIdRule,
    setMasterGain: materializeByIdRule,
    restoreMasterGain: materializeByIdRule,
    toggleLoop: materializeByIdRule,
    toggleMetronome: materializeByIdRule,
    setMetronomeVolume: materializeByIdRule,
    setLoopRegion: materializeByIdRule,
    setLoopEnabled: materializeByIdRule,
    setMetronomeEnabled: materializeByIdRule,
    restoreLoopRegion: materializeByIdRule,
    addClip: materializeByIdRule,
    moveClip: materializeByIdRule,
    restoreClipPlacement: materializeByIdRule,
    duplicateClip: materializeByIdRule,
    duplicateClipToNextBar: materializeByIdRule,
    duplicateTrack: materializeByIdRule,
    removeClip: materializeByIdRule,
    renameClip: materializeByIdRule,
    splitClip: materializeByIdRule,
    restoreClipSplitState: materializeByIdRule,
    trimClipStart: materializeByIdRule,
    trimClipEnd: materializeByIdRule,
    restoreAudioClipStartTrim: materializeByIdRule,
    restoreAudioClipSlip: materializeByIdRule,
    slipClipContent: materializeByIdRule,
    drawClip: materializeByIdRule,
    discardDrawnClip: materializeByIdRule,
    restoreDrawnClip: materializeByIdRule,
    duplicateClipAt: materializeByIdRule,
    moveClips: materializeByIdRule,
    restoreClipMoves: materializeByIdRule,
    addDevice: materializeByIdRule,
    bypassDevice: materializeByIdRule,
    removeDevice: materializeByIdRule,
    restoreDevice: materializeByIdRule,
    reorderDevices: materializeByIdRule,
    setDeviceParameter: materializeByIdRule,
    setExternalPluginState: materializeByIdRule,
    setDeviceState: materializeByIdRule,
    setFermenterPatch: materializeByIdRule,
    setLevainIdentity: materializeByIdRule,
    setGrandBouleDeviceState: materializeByIdRule,
    setToasterFactoryKit: materializeByIdRule,
    setBacteriaFactoryPatch: materializeByIdRule,
    setGlutenFactoryPreset: materializeByIdRule,
    createBus: materializeBusCreationIds,
    createFolder: materializeByIdRule,
    setSend: materializeByIdRule,
    setWorkspaceMode: materializeByIdRule,
    openPreferencesDialog: materializeByIdRule,
    openMixer: materializeByIdRule,
    closeMixer: materializeByIdRule,
    toggleSidebar: materializeByIdRule,
    toggleInspector: materializeByIdRule,
    toggleChatPanel: materializeByIdRule,
    setTrackInput: materializeByIdRule,
    restoreTrackInput: materializeByIdRule,
    setEditingTool: materializeByIdRule,
    setMarqueeSelection: materializeByIdRule,
    addMarker: materializeByIdRule,
    removeMarker: materializeByIdRule,
    setMarkerColor: materializeByIdRule,
    addSection: materializeByIdRule,
    removeSection: materializeByIdRule,
    renameSection: materializeByIdRule,
    renameMarker: materializeByIdRule,
    moveMarker: materializeByIdRule,
    moveSection: materializeByIdRule,
    resizeSection: materializeByIdRule,
    setSectionColor: materializeByIdRule,
    reorderSection: materializeByIdRule,
    navigateSection: materializeByIdRule,
    rehearseSection: materializeByIdRule,
    restoreSectionBeats: materializeByIdRule,
    setClipGainEnvelope: materializeByIdRule,
    toggleClipGainEnvelope: materializeByIdRule,
    addGainEnvelopePoint: materializeByIdRule,
    removeGainEnvelopePoint: materializeByIdRule,
    resetClipGainEnvelope: materializeByIdRule,
    addModulator: materializeByIdRule,
    removeModulator: materializeByIdRule,
    updateModulator: materializeByIdRule,
    addMapping: materializeByIdRule,
    removeMapping: materializeByIdRule,
    addAutomationLane: materializeByIdRule,
    automateSendRange: materializeByIdRule,
    automateSendRanges: materializeByIdRule,
    removeSendAutomationRanges: materializeByIdRule,
    renderProjectSections: materializeByIdRule,
    removeRenderedProjectSections: materializeByIdRule,
    automateTrackGainRange: materializeByIdRule,
    automateParameterRange: materializeByIdRule,
    removeTrackGainAutomationRange: materializeByIdRule,
    removeSendAutomationRange: materializeByIdRule,
    removeAutomationLane: materializeByIdRule,
    setAutomationLaneEnabled: materializeByIdRule,
    addAutomationPoint: materializeByIdRule,
    insertAutomationLanePoints: materializeByIdRule,
    quantizeNotes: materializeByIdRule,
    removeShortMidiOverlaps: materializeByIdRule,
    createDrumPreviewBranches: materializeByIdRule,
    deleteDrumPreviewBranches: materializeByIdRule,
    copyMidiArticulations: materializeByIdRule,
    restoreMidiClipNotes: materializeByIdRule,
    quantizeNoteLengths: materializeByIdRule,
    transposeNotes: materializeByIdRule,
    humanizeNotes: materializeByIdRule,
    invertNotes: materializeByIdRule,
    retrogradeNotes: materializeByIdRule,
    scaleVelocities: materializeByIdRule,
    scaleAllVelocities: materializeByIdRule,
    setAllVelocities: materializeByIdRule,
    setTrackGain: materializeByIdRule,
    setTrackPan: materializeByIdRule,
    setTrackColor: materializeByIdRule,
    copyClip: materializeByIdRule,
    cutClip: materializeByIdRule,
    pasteClip: materializeByIdRule,
    setClipFade: materializeByIdRule,
    importMidiFile: materializeByIdRule,
    normalizeClip: materializeByIdRule,
    relinkClipAudioSources: materializeByIdRule,
    reverseClip: materializeByIdRule,
    restoreReversedClip: materializeByIdRule,
    glueClips: materializeByIdRule,
    restoreClipGlueState: materializeByIdRule,
    setCompRegion: materializeByIdRule,
    removeCompRegion: materializeByIdRule,
    restoreCompRegionInterval: materializeByIdRule,
    nudgeClip: materializeByIdRule,
    crossfadeClips: materializeByIdRule,
    restoreCrossfadeClips: materializeByIdRule,
    setClipGain: materializeByIdRule,
    setClipColor: materializeByIdRule,
    lockClip: materializeByIdRule,
    consolidateSelection: materializeByIdRule,
    bounceSelection: materializeByIdRule,
    seekPlayhead: materializeByIdRule,
    setPunchIn: materializeByIdRule,
    setPunchOut: materializeByIdRule,
    setPunchEnabled: materializeByIdRule,
    restorePunchRegion: materializeByIdRule,
    togglePunch: materializeByIdRule,
    toggleCountIn: materializeByIdRule,
    setCountInBars: materializeByIdRule,
    togglePreRoll: materializeByIdRule,
    setPreRollBars: materializeByIdRule,
    zoomTracksVertical: materializeByIdRule,
    addTimeSignatureChange: materializeByIdRule,
    removeTimeSignatureChange: materializeByIdRule,
    setTrackOutput: materializeByIdRule,
    addSend: materializeByIdRule,
    removeSend: materializeByIdRule,
    removeAutomationPoint: materializeByIdRule,
    setAutomationMode: materializeByIdRule,
    hideTrack: materializeByIdRule,
    disableTrack: materializeByIdRule,
    restoreTrackDisabled: materializeByIdRule,
    setTrackHeight: materializeByIdRule,
    setSnapValue: materializeByIdRule,
    zoomToFit: materializeByIdRule,
    zoomToSelection: materializeByIdRule,
    exportProject: materializeByIdRule,
    saveProject: materializeByIdRule,
    newProject: materializeByIdRule,
    importAudioFile: materializeByIdRule,
    exportMidi: materializeByIdRule,
    foldTrack: materializeByIdRule,
    groupTracks: materializeByIdRule,
    ungroupTracks: materializeByIdRule,
    scaleAutomation: materializeByIdRule,
    stretchAutomation: materializeByIdRule,
    invertAutomation: materializeByIdRule,
    reverseAutomation: materializeByIdRule,
    thinAutomation: materializeByIdRule,
    quantizeAutomation: materializeByIdRule,
    restoreAutomationLanePoints: materializeByIdRule,
    restoreAutomationPointPresence: materializeByIdRule,
    loadPreset: materializeByIdRule,
    restorePresetDeviceChain: materializeByIdRule,
    savePreset: materializeByIdRule,
    generateDrumPattern: materializeByIdRule,
    generateMelody: materializeByIdRule,
    generateChordProgression: materializeByIdRule,
    setClipLoop: materializeByIdRule,
    restoreClipLoop: materializeByIdRule,
    setClipLoopLength: materializeByIdRule,
    restoreClipLoopLength: materializeByIdRule,
    createGrooveTemplate: materializeByIdRule,
    renameGrooveTemplate: materializeByIdRule,
    restoreGrooveTemplateName: materializeByIdRule,
    deleteGrooveTemplate: materializeByIdRule,
    restoreDeletedGrooveTemplate: materializeByIdRule,
    assignGrooveTemplate: materializeByIdRule,
    restoreGrooveAssignment: materializeByIdRule,
    extractGroove: materializeByIdRule,
    applyGroove: materializeByIdRule,
    setClipStretchMode: materializeByIdRule,
    setClipStretchRatio: materializeByIdRule,
    restoreClipStretchState: materializeByIdRule,
    fitClipToBeats: materializeByIdRule,
    analyzeMix: materializeByIdRule,
    autoFixMix: materializeByIdRule,
    enableMpe: materializeByIdRule,
    disableMpe: materializeByIdRule,
    getLatencyReport: materializeByIdRule,
    createCollabSession: materializeByIdRule,
    joinCollabSession: materializeByIdRule,
    leaveCollabSession: materializeByIdRule,
    scanPlugins: materializeByIdRule,
    loadExternalPlugin: materializeByIdRule,
    audioToMidi: materializeByIdRule,
    commitPitchEdit: materializeByIdRule,
    restoreClipFileId: materializeByIdRule,
    muteClip: materializeByIdRule,
    clearSolos: materializeByIdRule,
    restoreTrackSoloStates: materializeByIdRule,
    setTrackNotes: materializeByIdRule,
    deleteTime: materializeByIdRule,
    insertTime: materializeByIdRule,
    duplicateTimeRange: materializeByIdRule,
    restoreTimeOperationState: materializeByIdRule,
    restoreTrackHeights: materializeByIdRule,
    restoreTrackGroupMemberships: materializeByIdRule,
    restoreTracks: materializeByIdRule,
    restoreTrackClipStates: materializeByIdRule,
    discardCreatedTracks: materializeByIdRule,
    discardCreatedCompGroup: materializeByIdRule,
    restoreTrackAlternativeState: materializeByIdRule,
    restoreScratchPadState: materializeByIdRule,
    stripSilence: materializeByIdRule,
    restoreStripSilenceState: materializeByIdRule,
    detectTempo: materializeByIdRule,
    detectKey: materializeByIdRule,
    consolidateAllTracks: materializeByIdRule,
    arpeggiate: materializeByIdRule,
    addSidechainRoute: materializeByIdRule,
    removeSidechainRoute: materializeByIdRule,
    bounceToNewTrack: materializeByIdRule,
    saveTrackTemplate: materializeByIdRule,
    loadTrackTemplate: materializeByIdRule,
    deleteTrackTemplate: materializeByIdRule,
    createProjectFromTemplate: materializeByIdRule,
    setProductionBrief: materializeByIdRule,
    repairProjectData: materializeByIdRule,
    createVcaGroup: materializeByIdRule,
    assignToVca: materializeByIdRule,
    removeFromVca: materializeByIdRule,
    setVcaGain: materializeByIdRule,
    restoreLegacyVcaState: materializeByIdRule,
    setMidiOutput: materializeByIdRule,
    clearMidiOutput: materializeByIdRule,
    restoreMidiOutput: materializeByIdRule,
    addNotes: materializeNestedNoteIds,
    completeMidi: materializeByIdRule,
    variationMidi: materializeByIdRule,
    generateBassline: materializeByIdRule,
    replayGeneratedMidi: materializeByIdRule,
    stemSeparate: materializeByIdRule,
    autoOrganizeProject: materializeByIdRule,
    addChordEvent: materializeByIdRule,
    moveChordEvent: materializeByIdRule,
    updateChordEvent: materializeByIdRule,
    removeChordEvent: materializeByIdRule,
    toggleChordTrack: materializeByIdRule,
    clearChordTrack: materializeByIdRule,
    restoreChordTrackState: materializeByIdRule,
    clearAllMidiMappings: materializeByIdRule,
    completeMidiLearn: materializeByIdRule,
    removeMidiMapping: materializeByIdRule,
    restoreMidiLearnMappings: materializeByIdRule,
    toggleScratchPad: materializeByIdRule,
    captureScratchPad: materializeByIdRule,
    commitScratchPad: materializeByIdRule,
    clearScratchPad: materializeByIdRule,
    removeScratchPadSection: materializeByIdRule,
    renameScratchPadSection: materializeByIdRule,
    reorderScratchPadSection: materializeByIdRule,
    setScratchPadSectionColor: materializeByIdRule,
    createPatternInstance: materializeByIdRule,
    detachPatternInstance: materializeByIdRule,
    restorePatternInstanceLink: materializeByIdRule,
    startMacroRecording: materializeByIdRule,
    stopMacroRecording: materializeByIdRule,
    playMacro: materializeByIdRule,
    deleteMacro: materializeByIdRule,
    renameMacro: materializeByIdRule,
    undo: materializeByIdRule,
    redo: materializeByIdRule,
    toggleUndoTree: materializeByIdRule,
    labelUndoBranch: materializeByIdRule,
    detectSongStructure: materializeByIdRule,
    createProjectVersion: materializeByIdRule,
    restoreProjectVersion: materializeByIdRule,
    createVersionBranch: materializeByIdRule,
    generateFill: materializeByIdRule,
    generateAllTransitions: materializeByIdRule,
    compareToReference: materializeByIdRule,
    toggleControlRoomMono: materializeByIdRule,
    toggleControlRoomDim: materializeByIdRule,
    switchMonitor: materializeByIdRule,
    getMentorTips: materializeByIdRule,
    searchSamples: materializeByIdRule,
    createCompGroup: materializeByIdRule,
    togglePunchRecording: materializeByIdRule,
    toggleLoopRecord: materializeByIdRule,
    triggerScene: materializeByIdRule,
    nextSetlistItem: materializeByIdRule,
    previousSetlistItem: materializeByIdRule,
    createAdjustmentLayer: materializeByIdRule,
    removeAdjustmentLayer: materializeByIdRule,
    toggleAdjustmentLayer: materializeByIdRule,
    setLayerParameter: materializeByIdRule,
    setLayerMix: materializeByIdRule,
    addAdjustmentRegion: materializeByIdRule,
    removeAdjustmentRegion: materializeByIdRule,
    moveAdjustmentRegion: materializeByIdRule,
    setLayerFades: materializeByIdRule,
    setLayerAffectedTracks: materializeByIdRule,
    setLayerInsertionIndex: materializeByIdRule,
    restoreAdjustmentLayerMutation: materializeByIdRule,
    detectTransients: materializeByIdRule,
    quantizeTransients: materializeByIdRule,
    openElasticEditor: materializeByIdRule,
    closeElasticEditor: materializeByIdRule,
    elasticSetSensitivity: materializeByIdRule,
    elasticAddMarker: materializeByIdRule,
    elasticRemoveMarker: materializeByIdRule,
    elasticToggleMarkerLock: materializeByIdRule,
    elasticSetTool: materializeByIdRule,
    toggleNodeView: materializeByIdRule,
    setControlSurface: materializeByIdRule,
    addCvOutput: materializeByIdRule,
    removeCvOutput: materializeByIdRule,
    connectPush: materializeByIdRule,
    disconnectPush: materializeByIdRule,
    exportDawProject: materializeByIdRule,
    importDawProject: materializeByIdRule,
    loadRaveModel: materializeByIdRule,
    setRaveBlend: materializeByIdRule,
    enableWarping: materializeByIdRule,
    setWarpAlgorithm: materializeByIdRule,
    setWarpPitchShift: materializeByIdRule,
    setYeastProcessorParam: materializeByIdRule,
    setYeastArpPattern: materializeByIdRule,
    setYeastProcessorBypass: materializeByIdRule,
    addYeastProcessor: materializeByIdRule,
    removeYeastProcessor: materializeByIdRule,
    reorderYeastProcessor: materializeByIdRule,
    commitRecording: materializeByIdRule,
    discardRecording: materializeByIdRule,
    restoreRecording: materializeByIdRule,
    appendOverdubControllers: materializeByIdRule,
    removeOverdubControllers: materializeByIdRule,
};

function materializeForActionType<Type extends AppActionType>(
    action: ActionOf<Type>,
    defaults: CommandApplicationDefaults
): MaterializedCommandApplicationIds {
    if (!Object.hasOwn(applicationIdMaterializerByActionType, action.type)) {
        return { action, applicationAssignedIds: [] };
    }
    return applicationIdMaterializerByActionType[action.type](action, defaults);
}

export function materializeCommandApplicationIds(
    action: AppAction,
    defaults: CommandApplicationDefaults = RESERVE_APPLICATION_DEFAULTS
): MaterializedCommandApplicationIds {
    return materializeForActionType(action, defaults);
}
