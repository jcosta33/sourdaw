import { type AppAction, type AppActionType } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { type TakeReKeyLaneTransitionSnapshot } from '../../events/arrangementClipAppActions';
import { type RetiredTakeLaneSnapshot } from '../../events/arrangementClipStateSnapshots';
import { type TakeLane } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { replaceBaseGapAudioSources } from '../../stores/takeLaneWriteJournal';
import { preparedClipSplits } from '../clipEditing/preparedClipSplit';

import { reconcileLane } from './reconcileLane';
import { reconcileTransitionBaseGaps } from './reconcileTakeReKeySources';
import { reconcileTransitionRegions } from './reconcileTransitionRegions';

type TakeLaneOwners = TakeLane;

function restoreRetiredOwners(lanes: TakeLaneOwners[], captures: readonly RetiredTakeLaneSnapshot[]): void {
    for (const { lane, retiredTakeIds, retiredBaseGapAudioSources } of captures) {
        const targetIndex = lanes.findIndex((live) => live.id === lane.id || live.trackId === lane.trackId);
        let target: TakeLaneOwners;
        if (targetIndex === -1) {
            target = { id: lane.id, trackId: lane.trackId, takes: [], activeCompRegions: [] };
        } else {
            target = lanes[targetIndex]!;
        }
        const reconciled = reconcileLane(target, lane, retiredTakeIds ?? [], retiredBaseGapAudioSources ?? []);
        if (!reconciled) {
            continue;
        }
        if (targetIndex === -1) {
            lanes.push(reconciled);
        } else {
            lanes[targetIndex] = reconciled;
        }
    }
}

function projectReKeyOwners(
    lanes: TakeLaneOwners[],
    transitions: readonly TakeReKeyLaneTransitionSnapshot[],
    direction: 'apply' | 'restore'
): void {
    for (const transition of transitions) {
        const lane = lanes.find((live) => live.id === transition.laneId || live.trackId === transition.trackId);
        if (!lane) {
            continue;
        }
        const from = direction === 'apply' ? transition.takesBefore : transition.takesAfter;
        const to = direction === 'apply' ? transition.takesAfter : transition.takesBefore;
        const fromById = new Map(from.map((take) => [take.id, take]));
        const toIds = new Set(to.map((take) => take.id));
        const liveById = new Map(lane.takes.map((take) => [take.id, take]));
        const takes: TakeLaneOwners['takes'] = [];
        for (const target of to) {
            const source = fromById.get(target.id);
            const live = liveById.get(target.id);
            // Selection belongs to the later interaction. Only the operation's
            // other facets authorize restoring a missing take from its capture.
            const modified = !source || !valuesEqual({ ...source, selected: false }, { ...target, selected: false });
            if (modified) {
                takes.push({ ...target, selected: live?.selected ?? target.selected });
            } else if (live) {
                takes.push(live);
            }
        }
        takes.push(...lane.takes.filter((take) => !fromById.has(take.id) && !toIds.has(take.id)));
        const removedIds = new Set(
            lane.takes.filter((take) => !takes.some((next) => next.id === take.id)).map((take) => take.id)
        );
        const regionsFrom = direction === 'apply' ? transition.regionsBefore : transition.regionsAfter;
        const regionsTo = direction === 'apply' ? transition.regionsAfter : transition.regionsBefore;
        const regions = reconcileTransitionRegions(lane.activeCompRegions, regionsFrom, regionsTo, takes, removedIds);
        const gaps = reconcileTransitionBaseGaps(lane, transition, direction);
        lane.takes = takes;
        lane.activeCompRegions = [...regions];
        if (gaps) {
            const replacement = replaceBaseGapAudioSources(lane, gaps);
            if (replacement.baseGapAudioSources === undefined) {
                delete lane.baseGapAudioSources;
            } else {
                lane.baseGapAudioSources = replacement.baseGapAudioSources;
            }
        }
    }
}

function retireClipOwners(lanes: TakeLaneOwners[], clipId: string): void {
    for (let index = lanes.length - 1; index >= 0; index -= 1) {
        const lane = lanes[index]!;
        const removedTakeIds = new Set(lane.takes.filter((take) => take.clipId === clipId).map((take) => take.id));
        const takes = lane.takes.filter((take) => take.clipId !== clipId);
        const gaps = lane.baseGapAudioSources?.filter((tile) => tile.clipId !== clipId);
        if (takes.length === lane.takes.length && gaps?.length === lane.baseGapAudioSources?.length) {
            continue;
        }
        if (takes.length === 0 && !gaps?.length) {
            lanes.splice(index, 1);
        } else {
            lane.activeCompRegions = lane.activeCompRegions.filter((region) => !removedTakeIds.has(region.takeId));
            lane.takes = takes;
            const ids = new Set(takes.map((take) => take.id));
            lane.activeCompRegions = lane.activeCompRegions.filter((region) => ids.has(region.takeId));
            if (gaps !== undefined) {
                lane.baseGapAudioSources = gaps;
            }
        }
    }
}

type ActionOf<Type extends AppActionType> = Extract<AppAction, { type: Type }>;

function keepOwners(_lanes: TakeLaneOwners[], _action: unknown): void {
    // The action leaves take-lane owners as they are.
}

function projectSplitOwners(lanes: TakeLaneOwners[], action: ActionOf<'splitClip'>): void {
    const prepared = preparedClipSplits.get(action);
    if (prepared?.takeReKeyTransitions) {
        projectReKeyOwners(lanes, prepared.takeReKeyTransitions, 'apply');
    }
}

function retireRemovedClipOwners(
    lanes: TakeLaneOwners[],
    action: ActionOf<'discardDuplicatedClip' | 'removeClip'>
): void {
    retireClipOwners(lanes, action.payload.clipId);
}

function restoreClipOwners(lanes: TakeLaneOwners[], action: ActionOf<'restoreClip'>): void {
    restoreRetiredOwners(lanes, action.payload.retiredTakeLanes ?? []);
}

function restoreSplitStateOwners(lanes: TakeLaneOwners[], action: ActionOf<'restoreClipSplitState'>): void {
    const { replacement, rightClipId, retiredTakeLanes, reKeyedTakeLanes } = action.payload;
    if (replacement.rightClip) {
        restoreRetiredOwners(lanes, retiredTakeLanes ?? []);
        projectReKeyOwners(lanes, reKeyedTakeLanes ?? [], 'apply');
    } else {
        projectReKeyOwners(lanes, reKeyedTakeLanes ?? [], 'restore');
        retireClipOwners(lanes, rightClipId);
    }
}

// Every action type states how the prefix projects take-lane owners: a new action does not compile until it does.
const projectTakeLaneOwnersByActionType: {
    readonly [Type in AppActionType]: (lanes: TakeLaneOwners[], action: ActionOf<Type>) => void;
} = {
    importStemSet: keepOwners,
    discardImportedStemSet: keepOwners,
    addTrack: keepOwners,
    removeTrack: keepOwners,
    discardCreatedTrack: keepOwners,
    restoreTrack: keepOwners,
    restoreClip: restoreClipOwners,
    discardDuplicatedClip: retireRemovedClipOwners,
    removeAllTracks: keepOwners,
    renameTrack: keepOwners,
    createTrackAlternative: keepOwners,
    switchTrackAlternative: keepOwners,
    renameTrackAlternative: keepOwners,
    deleteTrackAlternative: keepOwners,
    selectTrack: keepOwners,
    muteTrack: keepOwners,
    soloTrack: keepOwners,
    selectTake: keepOwners,
    replaceOriginalMidiTakeRow: keepOwners,
    replaceOriginalMidiBaseRow: keepOwners,
    toggleSoloSafe: keepOwners,
    setSoloSafe: keepOwners,
    restoreSoloSafe: keepOwners,
    armTrack: keepOwners,
    freezeTrack: keepOwners,
    unfreezeTrack: keepOwners,
    restoreFreezeState: keepOwners,
    flattenTrack: keepOwners,
    bounceInPlace: keepOwners,
    reorderTrack: keepOwners,
    setTempo: keepOwners,
    restoreTempoEdit: keepOwners,
    editTempoMap: keepOwners,
    restoreTempoMapEdit: keepOwners,
    setTimeSignature: keepOwners,
    setPlayback: keepOwners,
    togglePlayback: keepOwners,
    stopPlayback: keepOwners,
    toggleRecording: keepOwners,
    setMasterGain: keepOwners,
    restoreMasterGain: keepOwners,
    toggleLoop: keepOwners,
    toggleMetronome: keepOwners,
    setMetronomeVolume: keepOwners,
    setLoopRegion: keepOwners,
    setLoopEnabled: keepOwners,
    setMetronomeEnabled: keepOwners,
    restoreLoopRegion: keepOwners,
    addClip: keepOwners,
    moveClip: keepOwners,
    restoreClipPlacement: keepOwners,
    duplicateClip: keepOwners,
    duplicateClipToNextBar: keepOwners,
    duplicateTrack: keepOwners,
    removeClip: retireRemovedClipOwners,
    renameClip: keepOwners,
    splitClip: projectSplitOwners,
    restoreClipSplitState: restoreSplitStateOwners,
    trimClipStart: keepOwners,
    trimClipEnd: keepOwners,
    restoreAudioClipStartTrim: keepOwners,
    restoreAudioClipSlip: keepOwners,
    slipClipContent: keepOwners,
    drawClip: keepOwners,
    discardDrawnClip: keepOwners,
    restoreDrawnClip: keepOwners,
    duplicateClipAt: keepOwners,
    moveClips: keepOwners,
    restoreClipMoves: keepOwners,
    addDevice: keepOwners,
    bypassDevice: keepOwners,
    removeDevice: keepOwners,
    restoreDevice: keepOwners,
    reorderDevices: keepOwners,
    setDeviceParameter: keepOwners,
    setExternalPluginState: keepOwners,
    setDeviceState: keepOwners,
    setFermenterPatch: keepOwners,
    setLevainIdentity: keepOwners,
    setGrandBouleDeviceState: keepOwners,
    setToasterFactoryKit: keepOwners,
    setBacteriaFactoryPatch: keepOwners,
    setGlutenFactoryPreset: keepOwners,
    createBus: keepOwners,
    createFolder: keepOwners,
    setSend: keepOwners,
    setWorkspaceMode: keepOwners,
    openPreferencesDialog: keepOwners,
    openMixer: keepOwners,
    closeMixer: keepOwners,
    toggleSidebar: keepOwners,
    toggleInspector: keepOwners,
    toggleChatPanel: keepOwners,
    setTrackInput: keepOwners,
    restoreTrackInput: keepOwners,
    setEditingTool: keepOwners,
    setMarqueeSelection: keepOwners,
    addMarker: keepOwners,
    removeMarker: keepOwners,
    setMarkerColor: keepOwners,
    addSection: keepOwners,
    removeSection: keepOwners,
    renameSection: keepOwners,
    renameMarker: keepOwners,
    moveMarker: keepOwners,
    moveSection: keepOwners,
    resizeSection: keepOwners,
    setSectionColor: keepOwners,
    reorderSection: keepOwners,
    navigateSection: keepOwners,
    rehearseSection: keepOwners,
    restoreSectionBeats: keepOwners,
    setClipGainEnvelope: keepOwners,
    toggleClipGainEnvelope: keepOwners,
    addGainEnvelopePoint: keepOwners,
    removeGainEnvelopePoint: keepOwners,
    resetClipGainEnvelope: keepOwners,
    addModulator: keepOwners,
    removeModulator: keepOwners,
    updateModulator: keepOwners,
    addMapping: keepOwners,
    removeMapping: keepOwners,
    addAutomationLane: keepOwners,
    automateSendRange: keepOwners,
    automateSendRanges: keepOwners,
    removeSendAutomationRanges: keepOwners,
    renderProjectSections: keepOwners,
    removeRenderedProjectSections: keepOwners,
    automateTrackGainRange: keepOwners,
    automateParameterRange: keepOwners,
    removeTrackGainAutomationRange: keepOwners,
    removeSendAutomationRange: keepOwners,
    removeAutomationLane: keepOwners,
    setAutomationLaneEnabled: keepOwners,
    addAutomationPoint: keepOwners,
    insertAutomationLanePoints: keepOwners,
    quantizeNotes: keepOwners,
    removeShortMidiOverlaps: keepOwners,
    createDrumPreviewBranches: keepOwners,
    deleteDrumPreviewBranches: keepOwners,
    copyMidiArticulations: keepOwners,
    restoreMidiClipNotes: keepOwners,
    quantizeNoteLengths: keepOwners,
    transposeNotes: keepOwners,
    humanizeNotes: keepOwners,
    invertNotes: keepOwners,
    retrogradeNotes: keepOwners,
    scaleVelocities: keepOwners,
    scaleAllVelocities: keepOwners,
    setAllVelocities: keepOwners,
    setTrackGain: keepOwners,
    setTrackPan: keepOwners,
    setTrackColor: keepOwners,
    copyClip: keepOwners,
    cutClip: keepOwners,
    pasteClip: keepOwners,
    setClipFade: keepOwners,
    importMidiFile: keepOwners,
    normalizeClip: keepOwners,
    reverseClip: keepOwners,
    restoreReversedClip: keepOwners,
    relinkClipAudioSources: keepOwners,
    glueClips: keepOwners,
    restoreClipGlueState: keepOwners,
    setCompRegion: keepOwners,
    removeCompRegion: keepOwners,
    restoreCompRegionInterval: keepOwners,
    nudgeClip: keepOwners,
    crossfadeClips: keepOwners,
    restoreCrossfadeClips: keepOwners,
    setClipGain: keepOwners,
    setClipColor: keepOwners,
    lockClip: keepOwners,
    consolidateSelection: keepOwners,
    bounceSelection: keepOwners,
    seekPlayhead: keepOwners,
    setPunchIn: keepOwners,
    setPunchOut: keepOwners,
    setPunchEnabled: keepOwners,
    restorePunchRegion: keepOwners,
    togglePunch: keepOwners,
    toggleCountIn: keepOwners,
    setCountInBars: keepOwners,
    togglePreRoll: keepOwners,
    setPreRollBars: keepOwners,
    zoomTracksVertical: keepOwners,
    addTimeSignatureChange: keepOwners,
    removeTimeSignatureChange: keepOwners,
    setTrackOutput: keepOwners,
    addSend: keepOwners,
    removeSend: keepOwners,
    removeAutomationPoint: keepOwners,
    setAutomationMode: keepOwners,
    hideTrack: keepOwners,
    disableTrack: keepOwners,
    restoreTrackDisabled: keepOwners,
    setTrackHeight: keepOwners,
    setSnapValue: keepOwners,
    zoomToFit: keepOwners,
    zoomToSelection: keepOwners,
    exportProject: keepOwners,
    saveProject: keepOwners,
    newProject: keepOwners,
    importAudioFile: keepOwners,
    exportMidi: keepOwners,
    foldTrack: keepOwners,
    groupTracks: keepOwners,
    ungroupTracks: keepOwners,
    scaleAutomation: keepOwners,
    stretchAutomation: keepOwners,
    invertAutomation: keepOwners,
    reverseAutomation: keepOwners,
    thinAutomation: keepOwners,
    quantizeAutomation: keepOwners,
    restoreAutomationLanePoints: keepOwners,
    restoreAutomationPointPresence: keepOwners,
    loadPreset: keepOwners,
    restorePresetDeviceChain: keepOwners,
    savePreset: keepOwners,
    generateDrumPattern: keepOwners,
    generateMelody: keepOwners,
    generateChordProgression: keepOwners,
    setClipLoop: keepOwners,
    restoreClipLoop: keepOwners,
    setClipLoopLength: keepOwners,
    restoreClipLoopLength: keepOwners,
    createGrooveTemplate: keepOwners,
    renameGrooveTemplate: keepOwners,
    restoreGrooveTemplateName: keepOwners,
    deleteGrooveTemplate: keepOwners,
    restoreDeletedGrooveTemplate: keepOwners,
    assignGrooveTemplate: keepOwners,
    restoreGrooveAssignment: keepOwners,
    extractGroove: keepOwners,
    applyGroove: keepOwners,
    setClipStretchMode: keepOwners,
    setClipStretchRatio: keepOwners,
    restoreClipStretchState: keepOwners,
    fitClipToBeats: keepOwners,
    analyzeMix: keepOwners,
    autoFixMix: keepOwners,
    enableMpe: keepOwners,
    disableMpe: keepOwners,
    getLatencyReport: keepOwners,
    createCollabSession: keepOwners,
    joinCollabSession: keepOwners,
    leaveCollabSession: keepOwners,
    scanPlugins: keepOwners,
    loadExternalPlugin: keepOwners,
    audioToMidi: keepOwners,
    commitPitchEdit: keepOwners,
    restoreClipFileId: keepOwners,
    muteClip: keepOwners,
    clearSolos: keepOwners,
    restoreTrackSoloStates: keepOwners,
    setTrackNotes: keepOwners,
    deleteTime: keepOwners,
    insertTime: keepOwners,
    duplicateTimeRange: keepOwners,
    restoreTimeOperationState: keepOwners,
    restoreTrackHeights: keepOwners,
    restoreTrackGroupMemberships: keepOwners,
    restoreTracks: keepOwners,
    restoreTrackClipStates: keepOwners,
    discardCreatedTracks: keepOwners,
    discardCreatedCompGroup: keepOwners,
    restoreTrackAlternativeState: keepOwners,
    restoreScratchPadState: keepOwners,
    stripSilence: keepOwners,
    restoreStripSilenceState: keepOwners,
    detectTempo: keepOwners,
    detectKey: keepOwners,
    consolidateAllTracks: keepOwners,
    arpeggiate: keepOwners,
    addSidechainRoute: keepOwners,
    removeSidechainRoute: keepOwners,
    bounceToNewTrack: keepOwners,
    saveTrackTemplate: keepOwners,
    loadTrackTemplate: keepOwners,
    deleteTrackTemplate: keepOwners,
    createProjectFromTemplate: keepOwners,
    setProductionBrief: keepOwners,
    repairProjectData: keepOwners,
    createVcaGroup: keepOwners,
    assignToVca: keepOwners,
    removeFromVca: keepOwners,
    setVcaGain: keepOwners,
    restoreLegacyVcaState: keepOwners,
    setMidiOutput: keepOwners,
    clearMidiOutput: keepOwners,
    restoreMidiOutput: keepOwners,
    addNotes: keepOwners,
    completeMidi: keepOwners,
    variationMidi: keepOwners,
    generateBassline: keepOwners,
    replayGeneratedMidi: keepOwners,
    stemSeparate: keepOwners,
    autoOrganizeProject: keepOwners,
    addChordEvent: keepOwners,
    moveChordEvent: keepOwners,
    updateChordEvent: keepOwners,
    removeChordEvent: keepOwners,
    toggleChordTrack: keepOwners,
    clearChordTrack: keepOwners,
    restoreChordTrackState: keepOwners,
    clearAllMidiMappings: keepOwners,
    completeMidiLearn: keepOwners,
    removeMidiMapping: keepOwners,
    restoreMidiLearnMappings: keepOwners,
    toggleScratchPad: keepOwners,
    captureScratchPad: keepOwners,
    commitScratchPad: keepOwners,
    clearScratchPad: keepOwners,
    removeScratchPadSection: keepOwners,
    renameScratchPadSection: keepOwners,
    reorderScratchPadSection: keepOwners,
    setScratchPadSectionColor: keepOwners,
    createPatternInstance: keepOwners,
    detachPatternInstance: keepOwners,
    restorePatternInstanceLink: keepOwners,
    startMacroRecording: keepOwners,
    stopMacroRecording: keepOwners,
    playMacro: keepOwners,
    deleteMacro: keepOwners,
    renameMacro: keepOwners,
    undo: keepOwners,
    redo: keepOwners,
    toggleUndoTree: keepOwners,
    labelUndoBranch: keepOwners,
    detectSongStructure: keepOwners,
    createProjectVersion: keepOwners,
    restoreProjectVersion: keepOwners,
    createVersionBranch: keepOwners,
    generateFill: keepOwners,
    generateAllTransitions: keepOwners,
    compareToReference: keepOwners,
    toggleControlRoomMono: keepOwners,
    toggleControlRoomDim: keepOwners,
    switchMonitor: keepOwners,
    getMentorTips: keepOwners,
    searchSamples: keepOwners,
    createCompGroup: keepOwners,
    togglePunchRecording: keepOwners,
    toggleLoopRecord: keepOwners,
    triggerScene: keepOwners,
    nextSetlistItem: keepOwners,
    previousSetlistItem: keepOwners,
    createAdjustmentLayer: keepOwners,
    removeAdjustmentLayer: keepOwners,
    toggleAdjustmentLayer: keepOwners,
    setLayerParameter: keepOwners,
    setLayerMix: keepOwners,
    addAdjustmentRegion: keepOwners,
    removeAdjustmentRegion: keepOwners,
    moveAdjustmentRegion: keepOwners,
    setLayerFades: keepOwners,
    setLayerAffectedTracks: keepOwners,
    setLayerInsertionIndex: keepOwners,
    restoreAdjustmentLayerMutation: keepOwners,
    detectTransients: keepOwners,
    quantizeTransients: keepOwners,
    openElasticEditor: keepOwners,
    closeElasticEditor: keepOwners,
    elasticSetSensitivity: keepOwners,
    elasticAddMarker: keepOwners,
    elasticRemoveMarker: keepOwners,
    elasticToggleMarkerLock: keepOwners,
    elasticSetTool: keepOwners,
    toggleNodeView: keepOwners,
    setControlSurface: keepOwners,
    addCvOutput: keepOwners,
    removeCvOutput: keepOwners,
    connectPush: keepOwners,
    disconnectPush: keepOwners,
    exportDawProject: keepOwners,
    importDawProject: keepOwners,
    loadRaveModel: keepOwners,
    setRaveBlend: keepOwners,
    enableWarping: keepOwners,
    setWarpAlgorithm: keepOwners,
    setWarpPitchShift: keepOwners,
    setYeastProcessorParam: keepOwners,
    setYeastArpPattern: keepOwners,
    setYeastProcessorBypass: keepOwners,
    addYeastProcessor: keepOwners,
    removeYeastProcessor: keepOwners,
    reorderYeastProcessor: keepOwners,
    commitRecording: keepOwners,
    discardRecording: keepOwners,
    restoreRecording: keepOwners,
    appendOverdubControllers: keepOwners,
    removeOverdubControllers: keepOwners,
};

function projectActionOwners<Type extends AppActionType>(lanes: TakeLaneOwners[], action: ActionOf<Type>): void {
    if (!Object.hasOwn(projectTakeLaneOwnersByActionType, action.type)) {
        return;
    }
    projectTakeLaneOwnersByActionType[action.type](lanes, action);
}

/** Reserve only owners produced by preceding replay members, without publishing any state. */
export function projectedTakeLaneOwners(
    priorActions: readonly AppAction[],
    initial: readonly TakeLaneOwners[] = takeLaneStore.value?.lanes ?? []
): TakeLaneOwners[] {
    const lanes = initial.map((lane) => structuredClone(lane));
    for (const action of priorActions) {
        projectActionOwners(lanes, action);
    }
    return lanes;
}
