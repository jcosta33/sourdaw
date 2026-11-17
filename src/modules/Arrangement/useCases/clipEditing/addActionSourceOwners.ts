import { type AppAction, type AppActionType } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { CLIP_SOURCE_FIELDS, TAKE_SOURCE_FIELDS } from '../../models/TempoSourceOwnerFields';

import { addPromotionOwners } from './addPromotionOwners';
import { addSourceOwner, type OwnerFields } from './addSourceOwner';
import { preparedClipSplits } from './preparedClipSplit';
import { type ShiftedOwnerState } from './ShiftedOwnerState';

type State = ShiftedOwnerState;
type ActionOf<Type extends AppActionType> = Extract<AppAction, { type: Type }>;
type SplitPair = Pick<NonNullable<ReturnType<typeof preparedClipSplits.get>>, 'previous' | 'next'> | null;

function addSplitGapOwners(
    owners: Map<string, OwnerFields>,
    trackId: string,
    laneId: string,
    oldLane: State['takeLanes'][number] | undefined,
    nextLane: State['takeLanes'][number] | undefined
): void {
    const gaps = (oldLane?.baseGapAudioSources ?? []).concat(nextLane?.baseGapAudioSources ?? []);
    for (const gap of gaps) {
        function matches(row: typeof gap): boolean {
            return row.clipId === gap.clipId && row.startBeat === gap.startBeat && row.endBeat === gap.endBeat;
        }
        if (
            !valuesEqual(
                oldLane?.baseGapAudioSources?.find(matches) ?? null,
                nextLane?.baseGapAudioSources?.find(matches) ?? null
            )
        ) {
            addSourceOwner(
                owners,
                {
                    kind: 'gap',
                    trackId,
                    laneId,
                    clipId: gap.clipId,
                    startBeat: gap.startBeat,
                    endBeat: gap.endBeat,
                },
                ['clipId', 'startBeat', 'endBeat', 'audioSource']
            );
        }
    }
}

function addSplitRegionAndGapOwners(
    owners: Map<string, OwnerFields>,
    trackId: string,
    laneId: string,
    oldLane: State['takeLanes'][number] | undefined,
    nextLane: State['takeLanes'][number] | undefined
): void {
    const regions = (oldLane?.activeCompRegions ?? []).concat(nextLane?.activeCompRegions ?? []);
    for (const region of regions) {
        function matches(row: typeof region): boolean {
            return row.takeId === region.takeId && row.startBeat === region.startBeat && row.endBeat === region.endBeat;
        }
        if (
            !valuesEqual(
                oldLane?.activeCompRegions.find(matches) ?? null,
                nextLane?.activeCompRegions.find(matches) ?? null
            )
        ) {
            addSourceOwner(
                owners,
                {
                    kind: 'region',
                    trackId,
                    laneId,
                    takeId: region.takeId,
                    startBeat: region.startBeat,
                    endBeat: region.endBeat,
                },
                ['takeId', 'startBeat', 'endBeat', 'audioSource']
            );
        }
    }
    addSplitGapOwners(owners, trackId, laneId, oldLane, nextLane);
}

function addSplitLaneOwners(
    owners: Map<string, OwnerFields>,
    trackId: string,
    laneId: string,
    before: State,
    after: State
): void {
    const oldLane = before.takeLanes.find((lane) => lane.id === laneId);
    const nextLane = after.takeLanes.find((lane) => lane.id === laneId);
    const takes = new Map((oldLane?.takes ?? []).concat(nextLane?.takes ?? []).map((take) => [take.id, take]));
    for (const take of takes.values()) {
        const old = oldLane?.takes.find((row) => row.id === take.id);
        const next = nextLane?.takes.find((row) => row.id === take.id);
        if (!valuesEqual(old ? { ...old, selected: false } : null, next ? { ...next, selected: false } : null)) {
            addSourceOwner(owners, { kind: 'take', trackId, laneId, takeId: take.id }, TAKE_SOURCE_FIELDS);
        }
    }
    addSplitRegionAndGapOwners(owners, trackId, laneId, oldLane, nextLane);
}

function addSplitPairOwners(owners: Map<string, OwnerFields>, pair: SplitPair, before: State, after: State): void {
    if (!pair || pair.previous.leftClip.type !== 'audio') {
        return;
    }
    const track = before.tracks?.find((row) => row.id === pair.previous.trackId);
    if (!track) {
        return;
    }
    const clipIds = [pair.previous.leftClip.id, pair.next.rightClip?.id ?? pair.previous.rightClip?.id];
    for (const clipId of clipIds) {
        if (clipId) {
            addSourceOwner(
                owners,
                {
                    kind: 'clip',
                    trackId: track.id,
                    collection: 'active',
                    alternativeId: track.activeAlternativeId,
                    clipId,
                },
                CLIP_SOURCE_FIELDS
            );
        }
    }
    const laneIds = new Set(
        [...before.takeLanes, ...after.takeLanes].filter((lane) => lane.trackId === track.id).map((lane) => lane.id)
    );
    for (const laneId of laneIds) {
        addSplitLaneOwners(owners, track.id, laneId, before, after);
    }
}

function addPreparedSplitOwners(
    action: ActionOf<'splitClip'>,
    owners: Map<string, OwnerFields>,
    before: State,
    after: State
): void {
    addSplitPairOwners(owners, preparedClipSplits.get(action) ?? null, before, after);
}

function addSplitRestoreOwners(
    action: ActionOf<'restoreClipSplitState'>,
    owners: Map<string, OwnerFields>,
    before: State,
    after: State
): void {
    addSplitPairOwners(owners, { previous: action.payload.expected, next: action.payload.replacement }, before, after);
}

function addTempoOwners(
    action: Extract<AppAction, { type: 'setTempo' | 'restoreTempoEdit' }>,
    owners: Map<string, OwnerFields>
): void {
    if (action.type === 'setTempo' && action.payload.bpm === action.payload.expectedBpm) {
        return;
    }
    const plan = action.payload.audioSourcePromotion;
    if (!plan) {
        return;
    }
    addPromotionOwners(owners, plan);
}

function addNoOwners(): void {
    return undefined;
}

// Every action type states which source owners it touches: a new action does not compile until it does.
const addActionSourceOwnersByActionType: {
    readonly [Type in AppActionType]: (
        action: ActionOf<Type>,
        owners: Map<string, OwnerFields>,
        before: State,
        after: State
    ) => void;
} = {
    importStemSet: addNoOwners,
    discardImportedStemSet: addNoOwners,
    addTrack: addNoOwners,
    removeTrack: addNoOwners,
    discardCreatedTrack: addNoOwners,
    restoreTrack: addNoOwners,
    restoreClip: addNoOwners,
    discardDuplicatedClip: addNoOwners,
    removeAllTracks: addNoOwners,
    renameTrack: addNoOwners,
    createTrackAlternative: addNoOwners,
    switchTrackAlternative: addNoOwners,
    renameTrackAlternative: addNoOwners,
    deleteTrackAlternative: addNoOwners,
    selectTrack: addNoOwners,
    muteTrack: addNoOwners,
    soloTrack: addNoOwners,
    selectTake: addNoOwners,
    replaceOriginalMidiTakeRow: addNoOwners,
    replaceOriginalMidiBaseRow: addNoOwners,
    toggleSoloSafe: addNoOwners,
    setSoloSafe: addNoOwners,
    restoreSoloSafe: addNoOwners,
    armTrack: addNoOwners,
    freezeTrack: addNoOwners,
    unfreezeTrack: addNoOwners,
    restoreFreezeState: addNoOwners,
    flattenTrack: addNoOwners,
    bounceInPlace: addNoOwners,
    reorderTrack: addNoOwners,
    setTempo: addTempoOwners,
    restoreTempoEdit: addTempoOwners,
    editTempoMap: addNoOwners,
    restoreTempoMapEdit: addNoOwners,
    setTimeSignature: addNoOwners,
    setPlayback: addNoOwners,
    togglePlayback: addNoOwners,
    stopPlayback: addNoOwners,
    toggleRecording: addNoOwners,
    setMasterGain: addNoOwners,
    restoreMasterGain: addNoOwners,
    toggleLoop: addNoOwners,
    toggleMetronome: addNoOwners,
    setMetronomeVolume: addNoOwners,
    setLoopRegion: addNoOwners,
    setLoopEnabled: addNoOwners,
    setMetronomeEnabled: addNoOwners,
    restoreLoopRegion: addNoOwners,
    addClip: addNoOwners,
    moveClip: addNoOwners,
    restoreClipPlacement: addNoOwners,
    duplicateClip: addNoOwners,
    duplicateClipToNextBar: addNoOwners,
    duplicateTrack: addNoOwners,
    removeClip: addNoOwners,
    renameClip: addNoOwners,
    splitClip: addPreparedSplitOwners,
    restoreClipSplitState: addSplitRestoreOwners,
    trimClipStart: addNoOwners,
    trimClipEnd: addNoOwners,
    restoreAudioClipStartTrim: addNoOwners,
    restoreAudioClipSlip: addNoOwners,
    slipClipContent: addNoOwners,
    drawClip: addNoOwners,
    discardDrawnClip: addNoOwners,
    restoreDrawnClip: addNoOwners,
    duplicateClipAt: addNoOwners,
    moveClips: addNoOwners,
    restoreClipMoves: addNoOwners,
    addDevice: addNoOwners,
    bypassDevice: addNoOwners,
    removeDevice: addNoOwners,
    restoreDevice: addNoOwners,
    reorderDevices: addNoOwners,
    setDeviceParameter: addNoOwners,
    setExternalPluginState: addNoOwners,
    setDeviceState: addNoOwners,
    setFermenterPatch: addNoOwners,
    setGrandBouleDeviceState: addNoOwners,
    createBus: addNoOwners,
    createFolder: addNoOwners,
    setSend: addNoOwners,
    setWorkspaceMode: addNoOwners,
    openPreferencesDialog: addNoOwners,
    openMixer: addNoOwners,
    closeMixer: addNoOwners,
    toggleSidebar: addNoOwners,
    toggleInspector: addNoOwners,
    toggleChatPanel: addNoOwners,
    setTrackInput: addNoOwners,
    restoreTrackInput: addNoOwners,
    setEditingTool: addNoOwners,
    setMarqueeSelection: addNoOwners,
    addMarker: addNoOwners,
    removeMarker: addNoOwners,
    setMarkerColor: addNoOwners,
    addSection: addNoOwners,
    removeSection: addNoOwners,
    renameSection: addNoOwners,
    renameMarker: addNoOwners,
    moveMarker: addNoOwners,
    moveSection: addNoOwners,
    resizeSection: addNoOwners,
    setSectionColor: addNoOwners,
    reorderSection: addNoOwners,
    navigateSection: addNoOwners,
    rehearseSection: addNoOwners,
    restoreSectionBeats: addNoOwners,
    setClipGainEnvelope: addNoOwners,
    toggleClipGainEnvelope: addNoOwners,
    addGainEnvelopePoint: addNoOwners,
    removeGainEnvelopePoint: addNoOwners,
    resetClipGainEnvelope: addNoOwners,
    addModulator: addNoOwners,
    removeModulator: addNoOwners,
    updateModulator: addNoOwners,
    addMapping: addNoOwners,
    removeMapping: addNoOwners,
    addAutomationLane: addNoOwners,
    automateSendRange: addNoOwners,
    automateSendRanges: addNoOwners,
    removeSendAutomationRanges: addNoOwners,
    renderProjectSections: addNoOwners,
    removeRenderedProjectSections: addNoOwners,
    automateTrackGainRange: addNoOwners,
    automateParameterRange: addNoOwners,
    removeTrackGainAutomationRange: addNoOwners,
    removeSendAutomationRange: addNoOwners,
    removeAutomationLane: addNoOwners,
    setAutomationLaneEnabled: addNoOwners,
    addAutomationPoint: addNoOwners,
    quantizeNotes: addNoOwners,
    editMidiNotes: addNoOwners,
    removeShortMidiOverlaps: addNoOwners,
    createDrumPreviewBranches: addNoOwners,
    deleteDrumPreviewBranches: addNoOwners,
    copyMidiArticulations: addNoOwners,
    restoreMidiClipNotes: addNoOwners,
    quantizeNoteLengths: addNoOwners,
    transposeNotes: addNoOwners,
    humanizeNotes: addNoOwners,
    invertNotes: addNoOwners,
    retrogradeNotes: addNoOwners,
    scaleVelocities: addNoOwners,
    scaleAllVelocities: addNoOwners,
    setAllVelocities: addNoOwners,
    setTrackGain: addNoOwners,
    setTrackPan: addNoOwners,
    setTrackColor: addNoOwners,
    copyClip: addNoOwners,
    cutClip: addNoOwners,
    pasteClip: addNoOwners,
    setClipFade: addNoOwners,
    importMidiFile: addNoOwners,
    normalizeClip: addNoOwners,
    reverseClip: addNoOwners,
    restoreReversedClip: addNoOwners,
    glueClips: addNoOwners,
    restoreClipGlueState: addNoOwners,
    setCompRegion: addNoOwners,
    removeCompRegion: addNoOwners,
    restoreCompRegionInterval: addNoOwners,
    nudgeClip: addNoOwners,
    crossfadeClips: addNoOwners,
    restoreCrossfadeClips: addNoOwners,
    setClipGain: addNoOwners,
    setClipColor: addNoOwners,
    lockClip: addNoOwners,
    consolidateSelection: addNoOwners,
    bounceSelection: addNoOwners,
    seekPlayhead: addNoOwners,
    setPunchIn: addNoOwners,
    setPunchOut: addNoOwners,
    setPunchEnabled: addNoOwners,
    restorePunchRegion: addNoOwners,
    togglePunch: addNoOwners,
    toggleCountIn: addNoOwners,
    setCountInBars: addNoOwners,
    togglePreRoll: addNoOwners,
    setPreRollBars: addNoOwners,
    zoomTracksVertical: addNoOwners,
    addTimeSignatureChange: addNoOwners,
    removeTimeSignatureChange: addNoOwners,
    setTrackOutput: addNoOwners,
    addSend: addNoOwners,
    removeSend: addNoOwners,
    removeAutomationPoint: addNoOwners,
    setAutomationMode: addNoOwners,
    hideTrack: addNoOwners,
    disableTrack: addNoOwners,
    restoreTrackDisabled: addNoOwners,
    setTrackHeight: addNoOwners,
    setSnapValue: addNoOwners,
    zoomToFit: addNoOwners,
    zoomToSelection: addNoOwners,
    exportProject: addNoOwners,
    saveProject: addNoOwners,
    newProject: addNoOwners,
    importAudioFile: addNoOwners,
    exportMidi: addNoOwners,
    foldTrack: addNoOwners,
    groupTracks: addNoOwners,
    ungroupTracks: addNoOwners,
    scaleAutomation: addNoOwners,
    stretchAutomation: addNoOwners,
    invertAutomation: addNoOwners,
    reverseAutomation: addNoOwners,
    thinAutomation: addNoOwners,
    quantizeAutomation: addNoOwners,
    restoreAutomationLanePoints: addNoOwners,
    restoreAutomationPointPresence: addNoOwners,
    loadPreset: addNoOwners,
    restorePresetDeviceChain: addNoOwners,
    savePreset: addNoOwners,
    generateDrumPattern: addNoOwners,
    generateMelody: addNoOwners,
    generateChordProgression: addNoOwners,
    setClipLoop: addNoOwners,
    restoreClipLoop: addNoOwners,
    setClipLoopLength: addNoOwners,
    restoreClipLoopLength: addNoOwners,
    createGrooveTemplate: addNoOwners,
    renameGrooveTemplate: addNoOwners,
    restoreGrooveTemplateName: addNoOwners,
    deleteGrooveTemplate: addNoOwners,
    restoreDeletedGrooveTemplate: addNoOwners,
    assignGrooveTemplate: addNoOwners,
    restoreGrooveAssignment: addNoOwners,
    extractGroove: addNoOwners,
    applyGroove: addNoOwners,
    setClipStretchMode: addNoOwners,
    setClipStretchRatio: addNoOwners,
    restoreClipStretchState: addNoOwners,
    fitClipToBeats: addNoOwners,
    analyzeMix: addNoOwners,
    autoFixMix: addNoOwners,
    enableMpe: addNoOwners,
    disableMpe: addNoOwners,
    getLatencyReport: addNoOwners,
    createCollabSession: addNoOwners,
    joinCollabSession: addNoOwners,
    leaveCollabSession: addNoOwners,
    scanPlugins: addNoOwners,
    loadExternalPlugin: addNoOwners,
    audioToMidi: addNoOwners,
    commitPitchEdit: addNoOwners,
    restoreClipFileId: addNoOwners,
    muteClip: addNoOwners,
    clearSolos: addNoOwners,
    restoreTrackSoloStates: addNoOwners,
    setTrackNotes: addNoOwners,
    deleteTime: addNoOwners,
    insertTime: addNoOwners,
    duplicateTimeRange: addNoOwners,
    restoreTimeOperationState: addNoOwners,
    restoreTrackHeights: addNoOwners,
    restoreTrackGroupMemberships: addNoOwners,
    restoreTracks: addNoOwners,
    restoreTrackClipStates: addNoOwners,
    discardCreatedTracks: addNoOwners,
    discardCreatedCompGroup: addNoOwners,
    restoreTrackAlternativeState: addNoOwners,
    restoreScratchPadState: addNoOwners,
    stripSilence: addNoOwners,
    restoreStripSilenceState: addNoOwners,
    detectTempo: addNoOwners,
    detectKey: addNoOwners,
    consolidateAllTracks: addNoOwners,
    arpeggiate: addNoOwners,
    addSidechainRoute: addNoOwners,
    removeSidechainRoute: addNoOwners,
    bounceToNewTrack: addNoOwners,
    saveTrackTemplate: addNoOwners,
    loadTrackTemplate: addNoOwners,
    deleteTrackTemplate: addNoOwners,
    createProjectFromTemplate: addNoOwners,
    setProductionBrief: addNoOwners,
    repairProjectData: addNoOwners,
    createVcaGroup: addNoOwners,
    assignToVca: addNoOwners,
    removeFromVca: addNoOwners,
    setVcaGain: addNoOwners,
    restoreLegacyVcaState: addNoOwners,
    setMidiOutput: addNoOwners,
    clearMidiOutput: addNoOwners,
    restoreMidiOutput: addNoOwners,
    addNotes: addNoOwners,
    completeMidi: addNoOwners,
    variationMidi: addNoOwners,
    generateBassline: addNoOwners,
    replayGeneratedMidi: addNoOwners,
    stemSeparate: addNoOwners,
    autoOrganizeProject: addNoOwners,
    addChordEvent: addNoOwners,
    moveChordEvent: addNoOwners,
    updateChordEvent: addNoOwners,
    removeChordEvent: addNoOwners,
    toggleChordTrack: addNoOwners,
    clearChordTrack: addNoOwners,
    restoreChordTrackState: addNoOwners,
    clearAllMidiMappings: addNoOwners,
    completeMidiLearn: addNoOwners,
    removeMidiMapping: addNoOwners,
    restoreMidiLearnMappings: addNoOwners,
    toggleScratchPad: addNoOwners,
    captureScratchPad: addNoOwners,
    commitScratchPad: addNoOwners,
    clearScratchPad: addNoOwners,
    removeScratchPadSection: addNoOwners,
    renameScratchPadSection: addNoOwners,
    reorderScratchPadSection: addNoOwners,
    setScratchPadSectionColor: addNoOwners,
    createPatternInstance: addNoOwners,
    detachPatternInstance: addNoOwners,
    restorePatternInstanceLink: addNoOwners,
    startMacroRecording: addNoOwners,
    stopMacroRecording: addNoOwners,
    playMacro: addNoOwners,
    deleteMacro: addNoOwners,
    renameMacro: addNoOwners,
    undo: addNoOwners,
    redo: addNoOwners,
    toggleUndoTree: addNoOwners,
    labelUndoBranch: addNoOwners,
    detectSongStructure: addNoOwners,
    createProjectVersion: addNoOwners,
    restoreProjectVersion: addNoOwners,
    createVersionBranch: addNoOwners,
    generateFill: addNoOwners,
    generateAllTransitions: addNoOwners,
    compareToReference: addNoOwners,
    toggleControlRoomMono: addNoOwners,
    toggleControlRoomDim: addNoOwners,
    switchMonitor: addNoOwners,
    getMentorTips: addNoOwners,
    searchSamples: addNoOwners,
    createCompGroup: addNoOwners,
    togglePunchRecording: addNoOwners,
    toggleLoopRecord: addNoOwners,
    triggerScene: addNoOwners,
    nextSetlistItem: addNoOwners,
    previousSetlistItem: addNoOwners,
    createAdjustmentLayer: addNoOwners,
    removeAdjustmentLayer: addNoOwners,
    toggleAdjustmentLayer: addNoOwners,
    setLayerParameter: addNoOwners,
    setLayerMix: addNoOwners,
    addAdjustmentRegion: addNoOwners,
    removeAdjustmentRegion: addNoOwners,
    moveAdjustmentRegion: addNoOwners,
    setLayerFades: addNoOwners,
    setLayerAffectedTracks: addNoOwners,
    setLayerInsertionIndex: addNoOwners,
    restoreAdjustmentLayerMutation: addNoOwners,
    detectTransients: addNoOwners,
    quantizeTransients: addNoOwners,
    openElasticEditor: addNoOwners,
    closeElasticEditor: addNoOwners,
    elasticSetSensitivity: addNoOwners,
    elasticAddMarker: addNoOwners,
    elasticRemoveMarker: addNoOwners,
    elasticToggleMarkerLock: addNoOwners,
    elasticSetTool: addNoOwners,
    toggleNodeView: addNoOwners,
    setControlSurface: addNoOwners,
    addCvOutput: addNoOwners,
    removeCvOutput: addNoOwners,
    connectPush: addNoOwners,
    disconnectPush: addNoOwners,
    exportDawProject: addNoOwners,
    importDawProject: addNoOwners,
    loadRaveModel: addNoOwners,
    setRaveBlend: addNoOwners,
    enableWarping: addNoOwners,
    setWarpAlgorithm: addNoOwners,
    setWarpPitchShift: addNoOwners,
    setYeastProcessorParam: addNoOwners,
    setYeastArpPattern: addNoOwners,
    setYeastProcessorBypass: addNoOwners,
    addYeastProcessor: addNoOwners,
    removeYeastProcessor: addNoOwners,
    reorderYeastProcessor: addNoOwners,
    commitRecording: addNoOwners,
    discardRecording: addNoOwners,
    restoreRecording: addNoOwners,
    appendOverdubControllers: addNoOwners,
    removeOverdubControllers: addNoOwners,
};

function lookup<Type extends AppActionType>(
    action: ActionOf<Type>,
    owners: Map<string, OwnerFields>,
    before: State,
    after: State
): void {
    addActionSourceOwnersByActionType[action.type](action, owners, before, after);
}

/** Adds the source owners an earlier batch action rewrites, read off the state before and after it. */
export function addActionSourceOwners(
    owners: Map<string, OwnerFields>,
    action: AppAction,
    before: State,
    after: State
): void {
    lookup(action, owners, before, after);
}
