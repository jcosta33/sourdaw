import { shiftLoopOriginEntry } from '#/utils/clipLoopOrigin';
import { type AppAction, type AppActionType } from '#/utils/handlerContract';
import { isRecord } from '#/utils/structuralEquality';

import { type Clip, type Track } from '../../models/Track';
import { isExactClipSnapshot } from '../../stores/isExactClipSnapshot';
import { sanitizeTrackSnapshot } from '../../stores/trackStore';
import { planRippleDelete } from '../rippleDelete/planRippleDelete';

import { resolveClipRestoreInsertionIndex } from './resolveClipRestoreInsertionIndex';

function restoredTrack(tracks: readonly Track[], action: Extract<AppAction, { type: 'restoreTrack' }>): Track[] | null {
    const snapshot: unknown = action.payload.trackSnapshot;
    if (!isRecord(snapshot) || !Array.isArray(snapshot.clips)) {
        return null;
    }
    const restored = sanitizeTrackSnapshot({ tracks: [snapshot], selectedTrackId: null }).tracks;
    const [track] = restored;
    if (
        !track ||
        restored.length !== 1 ||
        track.id !== action.payload.trackId ||
        track.clips.length !== snapshot.clips.length ||
        tracks.some((item) => item.id === action.payload.trackId)
    ) {
        return null;
    }
    return [...tracks, track];
}

function restoredClip(tracks: readonly Track[], action: Extract<AppAction, { type: 'restoreClip' }>): Track[] | null {
    const { trackId, ripplePlan } = action.payload;
    const track = tracks.find((item) => item.id === trackId);
    const snapshots = ripplePlan?.removedClips ?? [action.payload.clipSnapshot];
    if (!track || !snapshots.every((clip): clip is Clip => isExactClipSnapshot(clip, clip.id, trackId))) {
        return null;
    }
    const liveIds = new Set(tracks.flatMap((item) => item.clips.map((clip) => clip.id)));
    if (snapshots.some((clip) => liveIds.has(clip.id))) {
        return null;
    }
    const index = resolveClipRestoreInsertionIndex(track.clips, action.payload);
    if (index === null) {
        return null;
    }
    const clips = track.clips.map((clip) => {
        const shift = ripplePlan?.shiftedClips.find((item) => item.clipId === clip.id);
        if (!shift) {
            return clip;
        }
        return {
            ...clip,
            startBeat: shift.origStartBeat,
            endBeat: shift.origEndBeat,
            ...shiftLoopOriginEntry(clip, shift.origStartBeat - clip.startBeat),
        };
    });
    clips.splice(index, 0, ...snapshots);
    return tracks.map((item) => (item.id === trackId ? { ...item, clips } : item));
}

function sourceAfterAction(
    clip: Clip,
    trackId: string,
    alternativeId: string | null,
    action: Extract<AppAction, { type: 'relinkClipAudioSources' }>
): Clip {
    const target = action.payload.targets.find(
        (item) => item.trackId === trackId && item.alternativeId === alternativeId && item.clipId === clip.id
    );
    if (!target) {
        return clip;
    }
    if (target.after.audioBufferId !== undefined) {
        return { ...clip, audioBufferId: target.after.audioBufferId };
    }
    const { audioBufferId: _buffer, ...rest } = clip;
    return rest;
}

function sourceTracks(
    tracks: readonly Track[],
    action: Extract<AppAction, { type: 'relinkClipAudioSources' }>
): Track[] {
    return tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => sourceAfterAction(clip, track.id, null, action)),
        alternatives: track.alternatives.map((alternative) => {
            if (alternative.id === track.activeAlternativeId) {
                return alternative;
            }
            return {
                ...alternative,
                clips: alternative.clips.map((clip) => sourceAfterAction(clip, track.id, alternative.id, action)),
            };
        }),
    }));
}

function removeProjectedClip(
    tracks: readonly Track[],
    action: Extract<AppAction, { type: 'removeClip' | 'discardDuplicatedClip' }>
): Track[] | null {
    const track = tracks.find((item) => item.clips.some((clip) => clip.id === action.payload.clipId));
    if (!track) {
        return null;
    }
    const ripple = action.type === 'removeClip' && action.payload.ripple;
    const plan = planRippleDelete({ trackId: track.id, clipIds: [action.payload.clipId], ripple }, { tracks });
    if (!plan) {
        return null;
    }
    return tracks.map((item) => (item.id === track.id ? { ...item, clips: plan.nextClips } : item));
}

type ActionOf<Type extends AppActionType> = Extract<AppAction, { type: Type }>;

function keepTracks(tracks: readonly Track[], _action: unknown): Track[] {
    return [...tracks];
}

function dropRemovedTrack(tracks: readonly Track[], action: ActionOf<'removeTrack'>): Track[] {
    return tracks.filter((track) => track.id !== action.payload.trackId);
}

// Every action type states how the relink prefix projects it: a new action does not compile until it does.
const relinkPrefixStepByActionType: {
    readonly [Type in AppActionType]: (tracks: readonly Track[], action: ActionOf<Type>) => Track[] | null;
} = {
    importStemSet: keepTracks,
    discardImportedStemSet: keepTracks,
    addTrack: keepTracks,
    removeTrack: dropRemovedTrack,
    discardCreatedTrack: keepTracks,
    restoreTrack: restoredTrack,
    restoreClip: restoredClip,
    discardDuplicatedClip: removeProjectedClip,
    removeAllTracks: keepTracks,
    renameTrack: keepTracks,
    createTrackAlternative: keepTracks,
    switchTrackAlternative: keepTracks,
    renameTrackAlternative: keepTracks,
    deleteTrackAlternative: keepTracks,
    selectTrack: keepTracks,
    muteTrack: keepTracks,
    soloTrack: keepTracks,
    selectTake: keepTracks,
    replaceOriginalMidiTakeRow: keepTracks,
    replaceOriginalMidiBaseRow: keepTracks,
    toggleSoloSafe: keepTracks,
    setSoloSafe: keepTracks,
    restoreSoloSafe: keepTracks,
    armTrack: keepTracks,
    freezeTrack: keepTracks,
    unfreezeTrack: keepTracks,
    restoreFreezeState: keepTracks,
    flattenTrack: keepTracks,
    bounceInPlace: keepTracks,
    reorderTrack: keepTracks,
    setTempo: keepTracks,
    restoreTempoEdit: keepTracks,
    editTempoMap: keepTracks,
    restoreTempoMapEdit: keepTracks,
    setTimeSignature: keepTracks,
    setPlayback: keepTracks,
    togglePlayback: keepTracks,
    stopPlayback: keepTracks,
    toggleRecording: keepTracks,
    setMasterGain: keepTracks,
    restoreMasterGain: keepTracks,
    toggleLoop: keepTracks,
    toggleMetronome: keepTracks,
    setMetronomeVolume: keepTracks,
    setLoopRegion: keepTracks,
    setLoopEnabled: keepTracks,
    setMetronomeEnabled: keepTracks,
    restoreLoopRegion: keepTracks,
    addClip: keepTracks,
    moveClip: keepTracks,
    restoreClipPlacement: keepTracks,
    duplicateClip: keepTracks,
    duplicateClipToNextBar: keepTracks,
    duplicateTrack: keepTracks,
    removeClip: removeProjectedClip,
    renameClip: keepTracks,
    splitClip: keepTracks,
    restoreClipSplitState: keepTracks,
    trimClipStart: keepTracks,
    trimClipEnd: keepTracks,
    restoreAudioClipStartTrim: keepTracks,
    restoreAudioClipSlip: keepTracks,
    slipClipContent: keepTracks,
    drawClip: keepTracks,
    discardDrawnClip: keepTracks,
    restoreDrawnClip: keepTracks,
    duplicateClipAt: keepTracks,
    moveClips: keepTracks,
    restoreClipMoves: keepTracks,
    addDevice: keepTracks,
    bypassDevice: keepTracks,
    removeDevice: keepTracks,
    restoreDevice: keepTracks,
    reorderDevices: keepTracks,
    setDeviceParameter: keepTracks,
    setExternalPluginState: keepTracks,
    setDeviceState: keepTracks,
    setFermenterPatch: keepTracks,
    setLevainIdentity: keepTracks,
    setGrandBouleDeviceState: keepTracks,
    setToasterFactoryKit: keepTracks,
    setBacteriaFactoryPatch: keepTracks,
    setCrustFactoryPreset: keepTracks,
    setGlutenFactoryPreset: keepTracks,
    setProofPatchSelection: keepTracks,
    createBus: keepTracks,
    createFolder: keepTracks,
    setSend: keepTracks,
    setWorkspaceMode: keepTracks,
    openPreferencesDialog: keepTracks,
    openMixer: keepTracks,
    closeMixer: keepTracks,
    toggleSidebar: keepTracks,
    toggleInspector: keepTracks,
    toggleChatPanel: keepTracks,
    setTrackInput: keepTracks,
    restoreTrackInput: keepTracks,
    setEditingTool: keepTracks,
    setMarqueeSelection: keepTracks,
    addMarker: keepTracks,
    removeMarker: keepTracks,
    setMarkerColor: keepTracks,
    addSection: keepTracks,
    removeSection: keepTracks,
    renameSection: keepTracks,
    renameMarker: keepTracks,
    moveMarker: keepTracks,
    moveSection: keepTracks,
    resizeSection: keepTracks,
    setSectionColor: keepTracks,
    reorderSection: keepTracks,
    navigateSection: keepTracks,
    rehearseSection: keepTracks,
    restoreSectionBeats: keepTracks,
    setClipGainEnvelope: keepTracks,
    toggleClipGainEnvelope: keepTracks,
    addGainEnvelopePoint: keepTracks,
    removeGainEnvelopePoint: keepTracks,
    resetClipGainEnvelope: keepTracks,
    addModulator: keepTracks,
    removeModulator: keepTracks,
    updateModulator: keepTracks,
    addMapping: keepTracks,
    removeMapping: keepTracks,
    addAutomationLane: keepTracks,
    automateSendRange: keepTracks,
    automateSendRanges: keepTracks,
    removeSendAutomationRanges: keepTracks,
    renderProjectSections: keepTracks,
    removeRenderedProjectSections: keepTracks,
    automateTrackGainRange: keepTracks,
    automateParameterRange: keepTracks,
    removeTrackGainAutomationRange: keepTracks,
    removeSendAutomationRange: keepTracks,
    removeAutomationLane: keepTracks,
    setAutomationLaneEnabled: keepTracks,
    addAutomationPoint: keepTracks,
    insertAutomationLanePoints: keepTracks,
    quantizeNotes: keepTracks,
    editMidiNotes: keepTracks,
    removeShortMidiOverlaps: keepTracks,
    createDrumPreviewBranches: keepTracks,
    deleteDrumPreviewBranches: keepTracks,
    copyMidiArticulations: keepTracks,
    restoreMidiClipNotes: keepTracks,
    quantizeNoteLengths: keepTracks,
    transposeNotes: keepTracks,
    humanizeNotes: keepTracks,
    invertNotes: keepTracks,
    retrogradeNotes: keepTracks,
    scaleVelocities: keepTracks,
    scaleAllVelocities: keepTracks,
    setAllVelocities: keepTracks,
    setTrackGain: keepTracks,
    setTrackPan: keepTracks,
    setTrackColor: keepTracks,
    copyClip: keepTracks,
    cutClip: keepTracks,
    pasteClip: keepTracks,
    setClipFade: keepTracks,
    importMidiFile: keepTracks,
    normalizeClip: keepTracks,
    reverseClip: keepTracks,
    restoreReversedClip: keepTracks,
    relinkClipAudioSources: sourceTracks,
    glueClips: keepTracks,
    restoreClipGlueState: keepTracks,
    setCompRegion: keepTracks,
    removeCompRegion: keepTracks,
    restoreCompRegionInterval: keepTracks,
    nudgeClip: keepTracks,
    crossfadeClips: keepTracks,
    restoreCrossfadeClips: keepTracks,
    setClipGain: keepTracks,
    setClipColor: keepTracks,
    lockClip: keepTracks,
    consolidateSelection: keepTracks,
    bounceSelection: keepTracks,
    seekPlayhead: keepTracks,
    setPunchIn: keepTracks,
    setPunchOut: keepTracks,
    setPunchEnabled: keepTracks,
    restorePunchRegion: keepTracks,
    togglePunch: keepTracks,
    toggleCountIn: keepTracks,
    setCountInBars: keepTracks,
    togglePreRoll: keepTracks,
    setPreRollBars: keepTracks,
    zoomTracksVertical: keepTracks,
    addTimeSignatureChange: keepTracks,
    removeTimeSignatureChange: keepTracks,
    setTrackOutput: keepTracks,
    addSend: keepTracks,
    removeSend: keepTracks,
    removeAutomationPoint: keepTracks,
    setAutomationMode: keepTracks,
    hideTrack: keepTracks,
    disableTrack: keepTracks,
    restoreTrackDisabled: keepTracks,
    setTrackHeight: keepTracks,
    setSnapValue: keepTracks,
    zoomToFit: keepTracks,
    zoomToSelection: keepTracks,
    exportProject: keepTracks,
    saveProject: keepTracks,
    newProject: keepTracks,
    importAudioFile: keepTracks,
    exportMidi: keepTracks,
    foldTrack: keepTracks,
    groupTracks: keepTracks,
    ungroupTracks: keepTracks,
    scaleAutomation: keepTracks,
    stretchAutomation: keepTracks,
    invertAutomation: keepTracks,
    reverseAutomation: keepTracks,
    thinAutomation: keepTracks,
    quantizeAutomation: keepTracks,
    restoreAutomationLanePoints: keepTracks,
    restoreAutomationPointPresence: keepTracks,
    loadPreset: keepTracks,
    restorePresetDeviceChain: keepTracks,
    savePreset: keepTracks,
    generateDrumPattern: keepTracks,
    generateMelody: keepTracks,
    generateChordProgression: keepTracks,
    setClipLoop: keepTracks,
    restoreClipLoop: keepTracks,
    setClipLoopLength: keepTracks,
    restoreClipLoopLength: keepTracks,
    createGrooveTemplate: keepTracks,
    renameGrooveTemplate: keepTracks,
    restoreGrooveTemplateName: keepTracks,
    deleteGrooveTemplate: keepTracks,
    restoreDeletedGrooveTemplate: keepTracks,
    assignGrooveTemplate: keepTracks,
    restoreGrooveAssignment: keepTracks,
    extractGroove: keepTracks,
    applyGroove: keepTracks,
    setClipStretchMode: keepTracks,
    setClipStretchRatio: keepTracks,
    restoreClipStretchState: keepTracks,
    fitClipToBeats: keepTracks,
    analyzeMix: keepTracks,
    autoFixMix: keepTracks,
    enableMpe: keepTracks,
    disableMpe: keepTracks,
    getLatencyReport: keepTracks,
    createCollabSession: keepTracks,
    joinCollabSession: keepTracks,
    leaveCollabSession: keepTracks,
    scanPlugins: keepTracks,
    loadExternalPlugin: keepTracks,
    audioToMidi: keepTracks,
    commitPitchEdit: keepTracks,
    restoreClipFileId: keepTracks,
    muteClip: keepTracks,
    clearSolos: keepTracks,
    restoreTrackSoloStates: keepTracks,
    setTrackNotes: keepTracks,
    deleteTime: keepTracks,
    insertTime: keepTracks,
    duplicateTimeRange: keepTracks,
    restoreTimeOperationState: keepTracks,
    restoreTrackHeights: keepTracks,
    restoreTrackGroupMemberships: keepTracks,
    restoreTracks: keepTracks,
    restoreTrackClipStates: keepTracks,
    discardCreatedTracks: keepTracks,
    discardCreatedCompGroup: keepTracks,
    restoreTrackAlternativeState: keepTracks,
    restoreScratchPadState: keepTracks,
    stripSilence: keepTracks,
    restoreStripSilenceState: keepTracks,
    detectTempo: keepTracks,
    detectKey: keepTracks,
    consolidateAllTracks: keepTracks,
    arpeggiate: keepTracks,
    addSidechainRoute: keepTracks,
    removeSidechainRoute: keepTracks,
    bounceToNewTrack: keepTracks,
    saveTrackTemplate: keepTracks,
    loadTrackTemplate: keepTracks,
    deleteTrackTemplate: keepTracks,
    createProjectFromTemplate: keepTracks,
    setProductionBrief: keepTracks,
    repairProjectData: keepTracks,
    createVcaGroup: keepTracks,
    assignToVca: keepTracks,
    removeFromVca: keepTracks,
    setVcaGain: keepTracks,
    restoreLegacyVcaState: keepTracks,
    setMidiOutput: keepTracks,
    clearMidiOutput: keepTracks,
    restoreMidiOutput: keepTracks,
    addNotes: keepTracks,
    completeMidi: keepTracks,
    variationMidi: keepTracks,
    generateBassline: keepTracks,
    replayGeneratedMidi: keepTracks,
    stemSeparate: keepTracks,
    autoOrganizeProject: keepTracks,
    addChordEvent: keepTracks,
    moveChordEvent: keepTracks,
    updateChordEvent: keepTracks,
    removeChordEvent: keepTracks,
    toggleChordTrack: keepTracks,
    clearChordTrack: keepTracks,
    restoreChordTrackState: keepTracks,
    clearAllMidiMappings: keepTracks,
    completeMidiLearn: keepTracks,
    removeMidiMapping: keepTracks,
    restoreMidiLearnMappings: keepTracks,
    toggleScratchPad: keepTracks,
    captureScratchPad: keepTracks,
    commitScratchPad: keepTracks,
    clearScratchPad: keepTracks,
    removeScratchPadSection: keepTracks,
    renameScratchPadSection: keepTracks,
    reorderScratchPadSection: keepTracks,
    setScratchPadSectionColor: keepTracks,
    createPatternInstance: keepTracks,
    detachPatternInstance: keepTracks,
    restorePatternInstanceLink: keepTracks,
    startMacroRecording: keepTracks,
    stopMacroRecording: keepTracks,
    playMacro: keepTracks,
    deleteMacro: keepTracks,
    renameMacro: keepTracks,
    undo: keepTracks,
    redo: keepTracks,
    toggleUndoTree: keepTracks,
    labelUndoBranch: keepTracks,
    detectSongStructure: keepTracks,
    createProjectVersion: keepTracks,
    restoreProjectVersion: keepTracks,
    createVersionBranch: keepTracks,
    generateFill: keepTracks,
    generateAllTransitions: keepTracks,
    compareToReference: keepTracks,
    toggleControlRoomMono: keepTracks,
    toggleControlRoomDim: keepTracks,
    switchMonitor: keepTracks,
    getMentorTips: keepTracks,
    searchSamples: keepTracks,
    createCompGroup: keepTracks,
    togglePunchRecording: keepTracks,
    toggleLoopRecord: keepTracks,
    triggerScene: keepTracks,
    nextSetlistItem: keepTracks,
    previousSetlistItem: keepTracks,
    createAdjustmentLayer: keepTracks,
    removeAdjustmentLayer: keepTracks,
    toggleAdjustmentLayer: keepTracks,
    setLayerParameter: keepTracks,
    setLayerMix: keepTracks,
    addAdjustmentRegion: keepTracks,
    removeAdjustmentRegion: keepTracks,
    moveAdjustmentRegion: keepTracks,
    setLayerFades: keepTracks,
    setLayerAffectedTracks: keepTracks,
    setLayerInsertionIndex: keepTracks,
    restoreAdjustmentLayerMutation: keepTracks,
    detectTransients: keepTracks,
    quantizeTransients: keepTracks,
    openElasticEditor: keepTracks,
    closeElasticEditor: keepTracks,
    elasticSetSensitivity: keepTracks,
    elasticAddMarker: keepTracks,
    elasticRemoveMarker: keepTracks,
    elasticToggleMarkerLock: keepTracks,
    elasticSetTool: keepTracks,
    toggleNodeView: keepTracks,
    setControlSurface: keepTracks,
    addCvOutput: keepTracks,
    removeCvOutput: keepTracks,
    connectPush: keepTracks,
    disconnectPush: keepTracks,
    exportDawProject: keepTracks,
    importDawProject: keepTracks,
    loadRaveModel: keepTracks,
    setRaveBlend: keepTracks,
    enableWarping: keepTracks,
    setWarpAlgorithm: keepTracks,
    setWarpPitchShift: keepTracks,
    setYeastProcessorParam: keepTracks,
    setYeastArpPattern: keepTracks,
    setYeastProcessorBypass: keepTracks,
    addYeastProcessor: keepTracks,
    removeYeastProcessor: keepTracks,
    reorderYeastProcessor: keepTracks,
    commitRecording: keepTracks,
    discardRecording: keepTracks,
    restoreRecording: keepTracks,
    appendOverdubControllers: keepTracks,
    removeOverdubControllers: keepTracks,
};

function applyRelinkPrefixAction<Type extends AppActionType>(
    tracks: readonly Track[],
    action: ActionOf<Type>
): Track[] | null {
    if (!Object.hasOwn(relinkPrefixStepByActionType, action.type)) {
        return keepTracks(tracks, action);
    }
    return relinkPrefixStepByActionType[action.type](tracks, action);
}

/** Only planned source and owner changes needed by guarded relink replay; never authorizes execution. */
export function projectRelinkAudioSourceTracks(
    tracks: readonly Track[],
    actions: readonly AppAction[]
): Track[] | null {
    let projected = [...tracks];
    for (const action of actions) {
        const next = applyRelinkPrefixAction(projected, action);
        if (!next) {
            return null;
        }
        projected = next;
    }
    return projected;
}
