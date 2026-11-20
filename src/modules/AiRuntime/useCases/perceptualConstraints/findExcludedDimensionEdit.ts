import { getExecutableAppActionEffect, getExecutableAppActionGroundingRules } from '#/modules/Command/useCases';
import { type AppAction, type AppActionType } from '#/utils/handlerContract';
import { isRecord } from '#/utils/structuralEquality';

import { type ExcludingPerceptualConstraint, type PerceptualConstraint } from '../../models/PerceptualConstraint';
import { type ProjectContext } from '../../models/ProjectContext';
import {
    automatedParameterDimensions,
    type AutomatedParameter,
    describeEdit,
    type Edit,
    edits,
    inScope,
    readAddedDeviceEdits,
    readConstraintReach,
    readLane,
    readOutputEdits,
    readParameterEdits,
    readReachedTrackIds,
    readRemovedDeviceEdits,
    readRouting,
    readSendRangeEdits,
    readSendRoutingEdits,
    reachedChainDimensions,
    readSenderIds,
} from '../../transformers/excludedDimensionEdits';
import { proposalCommandShape } from '../agentReference/proposalCommandShape';

type ActionEffect = NonNullable<ReturnType<typeof getExecutableAppActionEffect>>;
type EffectDimension = ActionEffect['dimensions'][number];
type TargetCapability = NonNullable<
    ReturnType<typeof getExecutableAppActionGroundingRules>
>['targetRules'][number]['capability'];
type ActionOf<Type extends AppActionType> = Extract<AppAction, { type: Type }>;

/** The effect dimensions through which a command can change what a track sounds like. */
const SOUND_DIMENSIONS: ReadonlySet<EffectDimension> = new Set(['processing', 'routing', 'automation']);
/**
 * Targets that name a channel strip or a group of them, never a device on one. A processing or
 * automation write reaching only these moves a fader or a pan, which shapes neither space nor spectrum.
 */
const CHANNEL_TARGET_CAPABILITIES: ReadonlySet<TargetCapability> = new Set([
    'track',
    'routable-source',
    'vca-group',
    'vca-member-track',
]);

/** A command's arguments as the registry's target declarations name them. */
function readPayload(action: AppAction): Readonly<Record<string, unknown>> {
    const payload: unknown = 'payload' in action ? action.payload : undefined;
    return isRecord(payload) ? payload : {};
}

/**
 * The parameter an automation write draws: the one it names beside its track, or the one its lane
 * target automates, read from the registry's own target declaration.
 */
function readAutomatedParameter(
    action: AppAction,
    actions: readonly AppAction[],
    context: ProjectContext
): AutomatedParameter | null {
    const payload = readPayload(action);
    if (typeof payload.parameterId === 'string' && typeof payload.trackId === 'string') {
        return { trackId: payload.trackId, parameterId: payload.parameterId };
    }
    const laneRule = getExecutableAppActionGroundingRules(action.type)?.targetRules.find(
        (rule) => rule.capability === 'automation-lane'
    );
    const laneId = laneRule === undefined ? undefined : payload[laneRule.argument];
    return typeof laneId === 'string' ? readLane(laneId, actions, context) : null;
}

function readAutomationEdits(
    action: AppAction,
    effect: ActionEffect,
    actions: readonly AppAction[],
    context: ProjectContext
): Edit[] | null {
    if (!effect.dimensions.includes('automation')) {
        return null;
    }
    const automated = readAutomatedParameter(action, actions, context);
    if (automated === null) {
        return null;
    }
    const dimensions = automatedParameterDimensions(automated.parameterId, actions, context);
    return edits(dimensions, automated.trackId, automated.parameterId);
}

/**
 * Removing a track takes its devices and its sends with it, while every track routed into its output
 * is repointed to the output it had, so what lies past it on an output chain stays heard. The removed
 * track owns that loss. A track sending into it loses the whole parallel copy, its output chain
 * included, so each sender owns that one.
 */
function readTrackRemovalEdits(
    action: AppAction,
    effect: ActionEffect,
    actions: readonly AppAction[],
    context: ProjectContext
): Edit[] | null {
    if (!effect.removes?.includes('track')) {
        return null;
    }
    const trackIds = new Set(context.tracks.map((track) => track.id));
    const removedIds = proposalCommandShape
        .touchedObjectIds(action.type, readPayload(action), context)
        .filter((id) => trackIds.has(id));
    return removedIds.flatMap((removedId) => {
        const detail = `removing ${context.tracks.find((track) => track.id === removedId)?.name ?? removedId}`;
        const sendReach = readReachedTrackIds(readRouting(removedId, actions, context).sends, actions, context);
        const ownLoss = reachedChainDimensions(new Set([removedId, ...sendReach]), context);
        const copyLoss = reachedChainDimensions(readReachedTrackIds([removedId], actions, context), context);
        return [
            ...edits(ownLoss, removedId, detail),
            ...readSenderIds(removedId, actions, context).flatMap((senderId) => edits(copyLoss, senderId, detail)),
        ];
    });
}

/** A write that moves only channel strips: processing or automation whose every target is one. */
function isChannelStripWrite(action: AppAction, effect: ActionEffect): boolean {
    const targets = getExecutableAppActionGroundingRules(action.type)?.targetRules ?? [];
    return (
        targets.length > 0 &&
        effect.dimensions.every((dimension) => dimension === 'processing' || dimension === 'automation') &&
        targets.every((rule) => CHANNEL_TARGET_CAPABILITIES.has(rule.capability))
    );
}

/**
 * Every command whose declared effect reaches a track's processing, routing or automation that no
 * reader above places is refused on the tracks it touches. An arrangement edit carries the
 * automation and routing of the content it moves, and the holds measure what it changes.
 */
function readUnclassifiedEdits(action: AppAction, effect: ActionEffect, context: ProjectContext): Edit[] {
    const reachesSound = effect.dimensions.some((dimension) => SOUND_DIMENSIONS.has(dimension));
    if (!reachesSound || effect.dimensions.includes('arrangement') || isChannelStripWrite(action, effect)) {
        return [];
    }
    const trackIds = new Set(context.tracks.map((track) => track.id));
    const owners = proposalCommandShape
        .touchedObjectIds(action.type, readPayload(action), context)
        .filter((id) => trackIds.has(id));
    const reach = effect.dimensions.join(' and ');
    if (owners.length === 0) {
        return edits(['unclassified'], null, reach);
    }
    return owners.flatMap((trackId) => edits(['unclassified'], trackId, reach));
}

type EditReader<Type extends AppActionType> = (
    action: ActionOf<Type>,
    actions: readonly AppAction[],
    context: ProjectContext,
    effect: ActionEffect
) => Edit[];

function readSendAutomationWrite(
    action: ActionOf<'automateSendRange' | 'automateSendRanges'>,
    actions: readonly AppAction[],
    context: ProjectContext,
    effect: ActionEffect
): Edit[] {
    return readTrackRemovalEdits(action, effect, actions, context) ?? readSendRangeEdits(action);
}

/** What the command's declared effect says it edits, failing closed as `unclassified` for a sound edit no reader places. */
function readEffectDeclaredEdits(
    action: AppAction,
    actions: readonly AppAction[],
    context: ProjectContext,
    effect: ActionEffect
): Edit[] {
    return (
        readTrackRemovalEdits(action, effect, actions, context) ??
        readAutomationEdits(action, effect, actions, context) ??
        readUnclassifiedEdits(action, effect, context)
    );
}

// Every action type states how its edits are read: a new action does not compile until it does.
const editsByActionType: { readonly [Type in AppActionType]: EditReader<Type> } = {
    importStemSet: readEffectDeclaredEdits,
    discardImportedStemSet: readEffectDeclaredEdits,
    addTrack: readEffectDeclaredEdits,
    removeTrack: readEffectDeclaredEdits,
    discardCreatedTrack: readEffectDeclaredEdits,
    restoreTrack: readEffectDeclaredEdits,
    restoreClip: readEffectDeclaredEdits,
    discardDuplicatedClip: readEffectDeclaredEdits,
    removeAllTracks: readEffectDeclaredEdits,
    renameTrack: readEffectDeclaredEdits,
    createTrackAlternative: readEffectDeclaredEdits,
    switchTrackAlternative: readEffectDeclaredEdits,
    renameTrackAlternative: readEffectDeclaredEdits,
    deleteTrackAlternative: readEffectDeclaredEdits,
    selectTrack: readEffectDeclaredEdits,
    muteTrack: readEffectDeclaredEdits,
    soloTrack: readEffectDeclaredEdits,
    selectTake: readEffectDeclaredEdits,
    replaceOriginalMidiTakeRow: readEffectDeclaredEdits,
    replaceOriginalMidiBaseRow: readEffectDeclaredEdits,
    toggleSoloSafe: readEffectDeclaredEdits,
    setSoloSafe: readEffectDeclaredEdits,
    restoreSoloSafe: readEffectDeclaredEdits,
    armTrack: readEffectDeclaredEdits,
    freezeTrack: readEffectDeclaredEdits,
    unfreezeTrack: readEffectDeclaredEdits,
    restoreFreezeState: readEffectDeclaredEdits,
    flattenTrack: readEffectDeclaredEdits,
    bounceInPlace: readEffectDeclaredEdits,
    reorderTrack: readEffectDeclaredEdits,
    setTempo: readEffectDeclaredEdits,
    restoreTempoEdit: readEffectDeclaredEdits,
    editTempoMap: readEffectDeclaredEdits,
    restoreTempoMapEdit: readEffectDeclaredEdits,
    setTimeSignature: readEffectDeclaredEdits,
    setPlayback: readEffectDeclaredEdits,
    togglePlayback: readEffectDeclaredEdits,
    stopPlayback: readEffectDeclaredEdits,
    toggleRecording: readEffectDeclaredEdits,
    setMasterGain: readEffectDeclaredEdits,
    restoreMasterGain: readEffectDeclaredEdits,
    toggleLoop: readEffectDeclaredEdits,
    toggleMetronome: readEffectDeclaredEdits,
    setMetronomeVolume: readEffectDeclaredEdits,
    setLoopRegion: readEffectDeclaredEdits,
    setLoopEnabled: readEffectDeclaredEdits,
    setMetronomeEnabled: readEffectDeclaredEdits,
    restoreLoopRegion: readEffectDeclaredEdits,
    addClip: readEffectDeclaredEdits,
    moveClip: readEffectDeclaredEdits,
    restoreClipPlacement: readEffectDeclaredEdits,
    duplicateClip: readEffectDeclaredEdits,
    duplicateClipToNextBar: readEffectDeclaredEdits,
    duplicateTrack: readEffectDeclaredEdits,
    removeClip: readEffectDeclaredEdits,
    renameClip: readEffectDeclaredEdits,
    splitClip: readEffectDeclaredEdits,
    restoreClipSplitState: readEffectDeclaredEdits,
    trimClipStart: readEffectDeclaredEdits,
    trimClipEnd: readEffectDeclaredEdits,
    restoreAudioClipStartTrim: readEffectDeclaredEdits,
    restoreAudioClipSlip: readEffectDeclaredEdits,
    slipClipContent: readEffectDeclaredEdits,
    drawClip: readEffectDeclaredEdits,
    discardDrawnClip: readEffectDeclaredEdits,
    restoreDrawnClip: readEffectDeclaredEdits,
    duplicateClipAt: readEffectDeclaredEdits,
    moveClips: readEffectDeclaredEdits,
    restoreClipMoves: readEffectDeclaredEdits,
    addDevice: readAddedDeviceEdits,
    bypassDevice: readRemovedDeviceEdits,
    removeDevice: readRemovedDeviceEdits,
    restoreDevice: readEffectDeclaredEdits,
    reorderDevices: readEffectDeclaredEdits,
    setDeviceParameter: readParameterEdits,
    setExternalPluginState: readEffectDeclaredEdits,
    setDeviceState: readEffectDeclaredEdits,
    setFermenterPatch: readEffectDeclaredEdits,
    setLevainIdentity: readEffectDeclaredEdits,
    setGrandBouleDeviceState: readEffectDeclaredEdits,
    setToasterFactoryKit: readEffectDeclaredEdits,
    setBacteriaFactoryPatch: readEffectDeclaredEdits,
    setGlutenFactoryPreset: readEffectDeclaredEdits,
    createBus: readEffectDeclaredEdits,
    createFolder: readEffectDeclaredEdits,
    setSend: readSendRoutingEdits,
    setWorkspaceMode: readEffectDeclaredEdits,
    openPreferencesDialog: readEffectDeclaredEdits,
    openMixer: readEffectDeclaredEdits,
    closeMixer: readEffectDeclaredEdits,
    toggleSidebar: readEffectDeclaredEdits,
    toggleInspector: readEffectDeclaredEdits,
    toggleChatPanel: readEffectDeclaredEdits,
    setTrackInput: readEffectDeclaredEdits,
    restoreTrackInput: readEffectDeclaredEdits,
    setEditingTool: readEffectDeclaredEdits,
    setMarqueeSelection: readEffectDeclaredEdits,
    addMarker: readEffectDeclaredEdits,
    removeMarker: readEffectDeclaredEdits,
    setMarkerColor: readEffectDeclaredEdits,
    addSection: readEffectDeclaredEdits,
    removeSection: readEffectDeclaredEdits,
    renameSection: readEffectDeclaredEdits,
    renameMarker: readEffectDeclaredEdits,
    moveMarker: readEffectDeclaredEdits,
    moveSection: readEffectDeclaredEdits,
    resizeSection: readEffectDeclaredEdits,
    setSectionColor: readEffectDeclaredEdits,
    reorderSection: readEffectDeclaredEdits,
    navigateSection: readEffectDeclaredEdits,
    rehearseSection: readEffectDeclaredEdits,
    restoreSectionBeats: readEffectDeclaredEdits,
    setClipGainEnvelope: readEffectDeclaredEdits,
    toggleClipGainEnvelope: readEffectDeclaredEdits,
    addGainEnvelopePoint: readEffectDeclaredEdits,
    removeGainEnvelopePoint: readEffectDeclaredEdits,
    resetClipGainEnvelope: readEffectDeclaredEdits,
    addModulator: readEffectDeclaredEdits,
    removeModulator: readEffectDeclaredEdits,
    updateModulator: readEffectDeclaredEdits,
    addMapping: readEffectDeclaredEdits,
    removeMapping: readEffectDeclaredEdits,
    addAutomationLane: readEffectDeclaredEdits,
    automateSendRange: readSendAutomationWrite,
    automateSendRanges: readSendAutomationWrite,
    removeSendAutomationRanges: readEffectDeclaredEdits,
    renderProjectSections: readEffectDeclaredEdits,
    removeRenderedProjectSections: readEffectDeclaredEdits,
    automateTrackGainRange: readEffectDeclaredEdits,
    automateParameterRange: readEffectDeclaredEdits,
    removeTrackGainAutomationRange: readEffectDeclaredEdits,
    removeSendAutomationRange: readEffectDeclaredEdits,
    removeAutomationLane: readEffectDeclaredEdits,
    setAutomationLaneEnabled: readEffectDeclaredEdits,
    addAutomationPoint: readEffectDeclaredEdits,
    insertAutomationLanePoints: readEffectDeclaredEdits,
    quantizeNotes: readEffectDeclaredEdits,
    removeShortMidiOverlaps: readEffectDeclaredEdits,
    createDrumPreviewBranches: readEffectDeclaredEdits,
    deleteDrumPreviewBranches: readEffectDeclaredEdits,
    copyMidiArticulations: readEffectDeclaredEdits,
    restoreMidiClipNotes: readEffectDeclaredEdits,
    quantizeNoteLengths: readEffectDeclaredEdits,
    transposeNotes: readEffectDeclaredEdits,
    humanizeNotes: readEffectDeclaredEdits,
    invertNotes: readEffectDeclaredEdits,
    retrogradeNotes: readEffectDeclaredEdits,
    scaleVelocities: readEffectDeclaredEdits,
    scaleAllVelocities: readEffectDeclaredEdits,
    setAllVelocities: readEffectDeclaredEdits,
    setTrackGain: readEffectDeclaredEdits,
    setTrackPan: readEffectDeclaredEdits,
    setTrackColor: readEffectDeclaredEdits,
    copyClip: readEffectDeclaredEdits,
    cutClip: readEffectDeclaredEdits,
    pasteClip: readEffectDeclaredEdits,
    setClipFade: readEffectDeclaredEdits,
    importMidiFile: readEffectDeclaredEdits,
    normalizeClip: readEffectDeclaredEdits,
    relinkClipAudioSources: readEffectDeclaredEdits,
    reverseClip: readEffectDeclaredEdits,
    restoreReversedClip: readEffectDeclaredEdits,
    glueClips: readEffectDeclaredEdits,
    restoreClipGlueState: readEffectDeclaredEdits,
    setCompRegion: readEffectDeclaredEdits,
    removeCompRegion: readEffectDeclaredEdits,
    restoreCompRegionInterval: readEffectDeclaredEdits,
    nudgeClip: readEffectDeclaredEdits,
    crossfadeClips: readEffectDeclaredEdits,
    restoreCrossfadeClips: readEffectDeclaredEdits,
    setClipGain: readEffectDeclaredEdits,
    setClipColor: readEffectDeclaredEdits,
    lockClip: readEffectDeclaredEdits,
    consolidateSelection: readEffectDeclaredEdits,
    bounceSelection: readEffectDeclaredEdits,
    seekPlayhead: readEffectDeclaredEdits,
    setPunchIn: readEffectDeclaredEdits,
    setPunchOut: readEffectDeclaredEdits,
    setPunchEnabled: readEffectDeclaredEdits,
    restorePunchRegion: readEffectDeclaredEdits,
    togglePunch: readEffectDeclaredEdits,
    toggleCountIn: readEffectDeclaredEdits,
    setCountInBars: readEffectDeclaredEdits,
    togglePreRoll: readEffectDeclaredEdits,
    setPreRollBars: readEffectDeclaredEdits,
    zoomTracksVertical: readEffectDeclaredEdits,
    addTimeSignatureChange: readEffectDeclaredEdits,
    removeTimeSignatureChange: readEffectDeclaredEdits,
    setTrackOutput: readOutputEdits,
    addSend: readSendRoutingEdits,
    removeSend: readSendRoutingEdits,
    removeAutomationPoint: readEffectDeclaredEdits,
    setAutomationMode: readEffectDeclaredEdits,
    hideTrack: readEffectDeclaredEdits,
    disableTrack: readEffectDeclaredEdits,
    restoreTrackDisabled: readEffectDeclaredEdits,
    setTrackHeight: readEffectDeclaredEdits,
    setSnapValue: readEffectDeclaredEdits,
    zoomToFit: readEffectDeclaredEdits,
    zoomToSelection: readEffectDeclaredEdits,
    exportProject: readEffectDeclaredEdits,
    saveProject: readEffectDeclaredEdits,
    newProject: readEffectDeclaredEdits,
    importAudioFile: readEffectDeclaredEdits,
    exportMidi: readEffectDeclaredEdits,
    foldTrack: readEffectDeclaredEdits,
    groupTracks: readEffectDeclaredEdits,
    ungroupTracks: readEffectDeclaredEdits,
    scaleAutomation: readEffectDeclaredEdits,
    stretchAutomation: readEffectDeclaredEdits,
    invertAutomation: readEffectDeclaredEdits,
    reverseAutomation: readEffectDeclaredEdits,
    thinAutomation: readEffectDeclaredEdits,
    quantizeAutomation: readEffectDeclaredEdits,
    restoreAutomationLanePoints: readEffectDeclaredEdits,
    restoreAutomationPointPresence: readEffectDeclaredEdits,
    loadPreset: readEffectDeclaredEdits,
    restorePresetDeviceChain: readEffectDeclaredEdits,
    savePreset: readEffectDeclaredEdits,
    generateDrumPattern: readEffectDeclaredEdits,
    generateMelody: readEffectDeclaredEdits,
    generateChordProgression: readEffectDeclaredEdits,
    setClipLoop: readEffectDeclaredEdits,
    restoreClipLoop: readEffectDeclaredEdits,
    setClipLoopLength: readEffectDeclaredEdits,
    restoreClipLoopLength: readEffectDeclaredEdits,
    createGrooveTemplate: readEffectDeclaredEdits,
    renameGrooveTemplate: readEffectDeclaredEdits,
    restoreGrooveTemplateName: readEffectDeclaredEdits,
    deleteGrooveTemplate: readEffectDeclaredEdits,
    restoreDeletedGrooveTemplate: readEffectDeclaredEdits,
    assignGrooveTemplate: readEffectDeclaredEdits,
    restoreGrooveAssignment: readEffectDeclaredEdits,
    extractGroove: readEffectDeclaredEdits,
    applyGroove: readEffectDeclaredEdits,
    setClipStretchMode: readEffectDeclaredEdits,
    setClipStretchRatio: readEffectDeclaredEdits,
    restoreClipStretchState: readEffectDeclaredEdits,
    fitClipToBeats: readEffectDeclaredEdits,
    analyzeMix: readEffectDeclaredEdits,
    autoFixMix: readEffectDeclaredEdits,
    enableMpe: readEffectDeclaredEdits,
    disableMpe: readEffectDeclaredEdits,
    getLatencyReport: readEffectDeclaredEdits,
    createCollabSession: readEffectDeclaredEdits,
    joinCollabSession: readEffectDeclaredEdits,
    leaveCollabSession: readEffectDeclaredEdits,
    scanPlugins: readEffectDeclaredEdits,
    loadExternalPlugin: readEffectDeclaredEdits,
    audioToMidi: readEffectDeclaredEdits,
    commitPitchEdit: readEffectDeclaredEdits,
    restoreClipFileId: readEffectDeclaredEdits,
    muteClip: readEffectDeclaredEdits,
    clearSolos: readEffectDeclaredEdits,
    restoreTrackSoloStates: readEffectDeclaredEdits,
    setTrackNotes: readEffectDeclaredEdits,
    deleteTime: readEffectDeclaredEdits,
    insertTime: readEffectDeclaredEdits,
    duplicateTimeRange: readEffectDeclaredEdits,
    restoreTimeOperationState: readEffectDeclaredEdits,
    restoreTrackHeights: readEffectDeclaredEdits,
    restoreTrackGroupMemberships: readEffectDeclaredEdits,
    restoreTracks: readEffectDeclaredEdits,
    restoreTrackClipStates: readEffectDeclaredEdits,
    discardCreatedTracks: readEffectDeclaredEdits,
    discardCreatedCompGroup: readEffectDeclaredEdits,
    restoreTrackAlternativeState: readEffectDeclaredEdits,
    restoreScratchPadState: readEffectDeclaredEdits,
    stripSilence: readEffectDeclaredEdits,
    restoreStripSilenceState: readEffectDeclaredEdits,
    detectTempo: readEffectDeclaredEdits,
    detectKey: readEffectDeclaredEdits,
    consolidateAllTracks: readEffectDeclaredEdits,
    arpeggiate: readEffectDeclaredEdits,
    addSidechainRoute: readEffectDeclaredEdits,
    removeSidechainRoute: readEffectDeclaredEdits,
    bounceToNewTrack: readEffectDeclaredEdits,
    saveTrackTemplate: readEffectDeclaredEdits,
    loadTrackTemplate: readEffectDeclaredEdits,
    deleteTrackTemplate: readEffectDeclaredEdits,
    createProjectFromTemplate: readEffectDeclaredEdits,
    setProductionBrief: readEffectDeclaredEdits,
    repairProjectData: readEffectDeclaredEdits,
    createVcaGroup: readEffectDeclaredEdits,
    assignToVca: readEffectDeclaredEdits,
    removeFromVca: readEffectDeclaredEdits,
    setVcaGain: readEffectDeclaredEdits,
    restoreLegacyVcaState: readEffectDeclaredEdits,
    setMidiOutput: readEffectDeclaredEdits,
    clearMidiOutput: readEffectDeclaredEdits,
    restoreMidiOutput: readEffectDeclaredEdits,
    addNotes: readEffectDeclaredEdits,
    completeMidi: readEffectDeclaredEdits,
    variationMidi: readEffectDeclaredEdits,
    generateBassline: readEffectDeclaredEdits,
    replayGeneratedMidi: readEffectDeclaredEdits,
    stemSeparate: readEffectDeclaredEdits,
    autoOrganizeProject: readEffectDeclaredEdits,
    addChordEvent: readEffectDeclaredEdits,
    moveChordEvent: readEffectDeclaredEdits,
    updateChordEvent: readEffectDeclaredEdits,
    removeChordEvent: readEffectDeclaredEdits,
    toggleChordTrack: readEffectDeclaredEdits,
    clearChordTrack: readEffectDeclaredEdits,
    restoreChordTrackState: readEffectDeclaredEdits,
    clearAllMidiMappings: readEffectDeclaredEdits,
    completeMidiLearn: readEffectDeclaredEdits,
    removeMidiMapping: readEffectDeclaredEdits,
    restoreMidiLearnMappings: readEffectDeclaredEdits,
    toggleScratchPad: readEffectDeclaredEdits,
    captureScratchPad: readEffectDeclaredEdits,
    commitScratchPad: readEffectDeclaredEdits,
    clearScratchPad: readEffectDeclaredEdits,
    removeScratchPadSection: readEffectDeclaredEdits,
    renameScratchPadSection: readEffectDeclaredEdits,
    reorderScratchPadSection: readEffectDeclaredEdits,
    setScratchPadSectionColor: readEffectDeclaredEdits,
    createPatternInstance: readEffectDeclaredEdits,
    detachPatternInstance: readEffectDeclaredEdits,
    restorePatternInstanceLink: readEffectDeclaredEdits,
    startMacroRecording: readEffectDeclaredEdits,
    stopMacroRecording: readEffectDeclaredEdits,
    playMacro: readEffectDeclaredEdits,
    deleteMacro: readEffectDeclaredEdits,
    renameMacro: readEffectDeclaredEdits,
    undo: readEffectDeclaredEdits,
    redo: readEffectDeclaredEdits,
    toggleUndoTree: readEffectDeclaredEdits,
    labelUndoBranch: readEffectDeclaredEdits,
    detectSongStructure: readEffectDeclaredEdits,
    createProjectVersion: readEffectDeclaredEdits,
    restoreProjectVersion: readEffectDeclaredEdits,
    createVersionBranch: readEffectDeclaredEdits,
    generateFill: readEffectDeclaredEdits,
    generateAllTransitions: readEffectDeclaredEdits,
    compareToReference: readEffectDeclaredEdits,
    toggleControlRoomMono: readEffectDeclaredEdits,
    toggleControlRoomDim: readEffectDeclaredEdits,
    switchMonitor: readEffectDeclaredEdits,
    getMentorTips: readEffectDeclaredEdits,
    searchSamples: readEffectDeclaredEdits,
    createCompGroup: readEffectDeclaredEdits,
    togglePunchRecording: readEffectDeclaredEdits,
    toggleLoopRecord: readEffectDeclaredEdits,
    triggerScene: readEffectDeclaredEdits,
    nextSetlistItem: readEffectDeclaredEdits,
    previousSetlistItem: readEffectDeclaredEdits,
    createAdjustmentLayer: readEffectDeclaredEdits,
    removeAdjustmentLayer: readEffectDeclaredEdits,
    toggleAdjustmentLayer: readEffectDeclaredEdits,
    setLayerParameter: readEffectDeclaredEdits,
    setLayerMix: readEffectDeclaredEdits,
    addAdjustmentRegion: readEffectDeclaredEdits,
    removeAdjustmentRegion: readEffectDeclaredEdits,
    moveAdjustmentRegion: readEffectDeclaredEdits,
    setLayerFades: readEffectDeclaredEdits,
    setLayerAffectedTracks: readEffectDeclaredEdits,
    setLayerInsertionIndex: readEffectDeclaredEdits,
    restoreAdjustmentLayerMutation: readEffectDeclaredEdits,
    detectTransients: readEffectDeclaredEdits,
    quantizeTransients: readEffectDeclaredEdits,
    openElasticEditor: readEffectDeclaredEdits,
    closeElasticEditor: readEffectDeclaredEdits,
    elasticSetSensitivity: readEffectDeclaredEdits,
    elasticAddMarker: readEffectDeclaredEdits,
    elasticRemoveMarker: readEffectDeclaredEdits,
    elasticToggleMarkerLock: readEffectDeclaredEdits,
    elasticSetTool: readEffectDeclaredEdits,
    toggleNodeView: readEffectDeclaredEdits,
    setControlSurface: readEffectDeclaredEdits,
    addCvOutput: readEffectDeclaredEdits,
    removeCvOutput: readEffectDeclaredEdits,
    connectPush: readEffectDeclaredEdits,
    disconnectPush: readEffectDeclaredEdits,
    exportDawProject: readEffectDeclaredEdits,
    importDawProject: readEffectDeclaredEdits,
    loadRaveModel: readEffectDeclaredEdits,
    setRaveBlend: readEffectDeclaredEdits,
    enableWarping: readEffectDeclaredEdits,
    setWarpAlgorithm: readEffectDeclaredEdits,
    setWarpPitchShift: readEffectDeclaredEdits,
    setYeastProcessorParam: readEffectDeclaredEdits,
    setYeastArpPattern: readEffectDeclaredEdits,
    setYeastProcessorBypass: readEffectDeclaredEdits,
    addYeastProcessor: readEffectDeclaredEdits,
    removeYeastProcessor: readEffectDeclaredEdits,
    reorderYeastProcessor: readEffectDeclaredEdits,
    commitRecording: readEffectDeclaredEdits,
    discardRecording: readEffectDeclaredEdits,
    restoreRecording: readEffectDeclaredEdits,
    appendOverdubControllers: readEffectDeclaredEdits,
    removeOverdubControllers: readEffectDeclaredEdits,
};

function readEdits<Type extends AppActionType>(
    action: ActionOf<Type>,
    actions: readonly AppAction[],
    context: ProjectContext,
    effect: ActionEffect
): Edit[] {
    return editsByActionType[action.type](action, actions, context, effect);
}

function readActionEdits(action: AppAction, actions: readonly AppAction[], context: ProjectContext): Edit[] {
    const effect = getExecutableAppActionEffect(action.type);
    if (effect === null) {
        return [];
    }
    return readEdits(action, actions, context, effect);
}

/**
 * The first command that edits a dimension a constraint excludes on its scope, as the refusal the
 * user sees, or `null`. It reads the batch before any preview renders it, so a batch that would
 * break a constraint by construction is never measured, shown or approved.
 */
export function findExcludedDimensionEdit(input: {
    constraints: readonly PerceptualConstraint[];
    actions: readonly AppAction[];
    context: ProjectContext;
}): { reason: string } | null {
    // A measured hold takes no dimension away: whatever reaches its scope, the preview shows whether
    // the held metric kept within its tolerance, so only an exclusion refuses an edit here.
    const exclusions = input.constraints.filter(
        (constraint): constraint is ExcludingPerceptualConstraint => constraint.protection.kind === 'exclude-dimension'
    );
    if (exclusions.length === 0) {
        return null;
    }
    const reach = new Map(
        exclusions.map((constraint) => [constraint, readConstraintReach(constraint, input.actions, input.context)])
    );
    for (const [index, action] of input.actions.entries()) {
        for (const edit of readActionEdits(action, input.actions, input.context)) {
            const constraint = exclusions.find(
                (candidate) =>
                    (edit.dimension === 'unclassified' || candidate.protection.dimension === edit.dimension) &&
                    inScope(reach.get(candidate) ?? null, edit.trackId)
            );
            if (constraint !== undefined) {
                const command = `command ${String(index + 1)} (${action.type} ${edit.detail})`;
                return { reason: describeEdit(constraint, edit, command, input.context) };
            }
        }
    }
    return null;
}
