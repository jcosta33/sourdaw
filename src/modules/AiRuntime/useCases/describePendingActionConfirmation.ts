import { getAppActionExecutionPolicy } from '#/modules/Command/useCases';
import { type AppAction, type AppActionType } from '#/utils/handlerContract';

import { type ProjectContext } from '../models/ProjectContext';
import { type ProposalProtectionFacts } from '../models/ProposalGroundingBasis';
import { type WorkflowCapabilityId } from '../models/WorkflowCapability';
import { unionProtectedObjects } from '../transformers/unionProtectedObjects';

import { getApplicationProtectedObjects } from './agentReference/getApplicationProtectedObjects';
import { describePlannedAction } from './describePlannedAction';
import { describeExactAddedDevice } from './exactActionDescriptions/describeExactAddedDevice';
import { describeExactAddedSend } from './exactActionDescriptions/describeExactAddedSend';
import { describeExactAdjustmentRegion } from './exactActionDescriptions/describeExactAdjustmentRegion';
import { describeExactDeviceParameter } from './exactActionDescriptions/describeExactDeviceParameter';
import { describeExactImportStemSet } from './exactActionDescriptions/describeExactImportStemSet';
import { describeExactProductionBrief } from './exactActionDescriptions/describeExactProductionBrief';
import { describeExactRemovedDevice } from './exactActionDescriptions/describeExactRemovedDevice';
import { describeExactSectionRender } from './exactActionDescriptions/describeExactSectionRender';
import { describeExactSendAutomation } from './exactActionDescriptions/describeExactSendAutomation';
import { describeExactTrackGain } from './exactActionDescriptions/describeExactTrackGain';
import { describeExactTrackGainRange } from './exactActionDescriptions/describeExactTrackGainRange';
import { describeExactTrackOutput } from './exactActionDescriptions/describeExactTrackOutput';
import { getPlannedActionAffectedIds } from './getPlannedActionAffectedIds';
import { compilePerceptualConstraints } from './perceptualConstraints/compilePerceptualConstraints';

type DescribePendingActionConfirmationInput = {
    actions: readonly AppAction[];
    context: ProjectContext;
    prompt: string;
    workflowCapabilityId?: WorkflowCapabilityId;
    /** Objects a refinement's chain protects beyond those this request's own text protects. */
    inheritedProtectedUnchanged?: ReadonlyArray<{ id: string; name: string }>;
    /** Complete resolved facts when the same request is replayed by a scheduled batch. */
    requestProtectionFacts?: ProposalProtectionFacts;
    /** Actions whose value kept the refined change's direction; their labels say so. */
    keptDirectionActionIndexes?: readonly number[];
};

const KEPT_DIRECTION_NOTE = 'direction kept from the pending proposal';

const riskRank = {
    'read-only': 0,
    'bounded-reversible': 1,
    'broad-reversible': 2,
    'destructive-reversible': 3,
    'authority-sensitive': 4,
    'external-effect': 5,
    unclassified: 6,
} as const;

type ActionOf<Type extends AppActionType> = Extract<AppAction, { type: Type }>;

type ExactActionDescriber<Type extends AppActionType> = (
    action: ActionOf<Type>,
    context: ProjectContext,
    actions: readonly AppAction[]
) => string;

/** What the planned-action reading says about an action the card has no more exact words for. */
function describeAsPlanned(action: AppAction, context: ProjectContext): string {
    return describePlannedAction({ action, context });
}

function describeExactBus(action: ActionOf<'createBus'>): string | null {
    if (!action.payload.busId) {
        return null;
    }
    const gain = action.payload.initialGain === 1 ? ' at unity gain' : '';
    return `Create bus "${action.payload.name}" (${action.payload.busId})${gain}`;
}

// Every action type states how its card line is worded: a new action does not compile until it does.
const exactDescriberByActionType: { readonly [Type in AppActionType]: ExactActionDescriber<Type> } = {
    importStemSet: describeExactImportStemSet,
    discardImportedStemSet: describeAsPlanned,
    addTrack: describeAsPlanned,
    removeTrack: describeAsPlanned,
    discardCreatedTrack: describeAsPlanned,
    restoreTrack: describeAsPlanned,
    restoreClip: describeAsPlanned,
    discardDuplicatedClip: describeAsPlanned,
    removeAllTracks: describeAsPlanned,
    renameTrack: describeAsPlanned,
    createTrackAlternative: describeAsPlanned,
    switchTrackAlternative: describeAsPlanned,
    renameTrackAlternative: describeAsPlanned,
    deleteTrackAlternative: describeAsPlanned,
    selectTrack: describeAsPlanned,
    muteTrack: describeAsPlanned,
    soloTrack: describeAsPlanned,
    selectTake: describeAsPlanned,
    replaceOriginalMidiTakeRow: describeAsPlanned,
    replaceOriginalMidiBaseRow: describeAsPlanned,
    toggleSoloSafe: describeAsPlanned,
    setSoloSafe: describeAsPlanned,
    restoreSoloSafe: describeAsPlanned,
    armTrack: describeAsPlanned,
    freezeTrack: describeAsPlanned,
    unfreezeTrack: describeAsPlanned,
    restoreFreezeState: describeAsPlanned,
    flattenTrack: describeAsPlanned,
    bounceInPlace: describeAsPlanned,
    reorderTrack: describeAsPlanned,
    setTempo: describeAsPlanned,
    restoreTempoEdit: describeAsPlanned,
    editTempoMap: describeAsPlanned,
    restoreTempoMapEdit: describeAsPlanned,
    setTimeSignature: describeAsPlanned,
    setPlayback: describeAsPlanned,
    togglePlayback: describeAsPlanned,
    stopPlayback: describeAsPlanned,
    toggleRecording: describeAsPlanned,
    setMasterGain: describeAsPlanned,
    restoreMasterGain: describeAsPlanned,
    toggleLoop: describeAsPlanned,
    toggleMetronome: describeAsPlanned,
    setMetronomeVolume: describeAsPlanned,
    setLoopRegion: describeAsPlanned,
    setLoopEnabled: describeAsPlanned,
    setMetronomeEnabled: describeAsPlanned,
    restoreLoopRegion: describeAsPlanned,
    addClip: describeAsPlanned,
    moveClip: describeAsPlanned,
    restoreClipPlacement: describeAsPlanned,
    duplicateClip: describeAsPlanned,
    duplicateClipToNextBar: describeAsPlanned,
    duplicateTrack: describeAsPlanned,
    removeClip: describeAsPlanned,
    renameClip: describeAsPlanned,
    splitClip: describeAsPlanned,
    restoreClipSplitState: describeAsPlanned,
    trimClipStart: describeAsPlanned,
    trimClipEnd: describeAsPlanned,
    restoreAudioClipStartTrim: describeAsPlanned,
    restoreAudioClipSlip: describeAsPlanned,
    slipClipContent: describeAsPlanned,
    drawClip: describeAsPlanned,
    discardDrawnClip: describeAsPlanned,
    restoreDrawnClip: describeAsPlanned,
    duplicateClipAt: describeAsPlanned,
    moveClips: describeAsPlanned,
    restoreClipMoves: describeAsPlanned,
    addDevice: (action, context, actions) =>
        describeExactAddedDevice(action, context, actions) ?? describeAsPlanned(action, context),
    bypassDevice: describeAsPlanned,
    removeDevice: (action, context) =>
        describeExactRemovedDevice(action, context) ?? describeAsPlanned(action, context),
    restoreDevice: describeAsPlanned,
    reorderDevices: describeAsPlanned,
    setDeviceParameter: (action, context, actions) =>
        describeExactDeviceParameter(action, context, actions) ?? describeAsPlanned(action, context),
    setExternalPluginState: describeAsPlanned,
    setDeviceState: describeAsPlanned,
    setFermenterPatch: describeAsPlanned,
    setLevainIdentity: describeAsPlanned,
    setGrandBouleDeviceState: describeAsPlanned,
    setToasterFactoryKit: describeAsPlanned,
    setGlutenFactoryPreset: describeAsPlanned,
    createBus: (action, context) => describeExactBus(action) ?? describeAsPlanned(action, context),
    createFolder: describeAsPlanned,
    setSend: describeAsPlanned,
    setWorkspaceMode: describeAsPlanned,
    openPreferencesDialog: describeAsPlanned,
    openMixer: describeAsPlanned,
    closeMixer: describeAsPlanned,
    toggleSidebar: describeAsPlanned,
    toggleInspector: describeAsPlanned,
    toggleChatPanel: describeAsPlanned,
    setTrackInput: describeAsPlanned,
    restoreTrackInput: describeAsPlanned,
    setEditingTool: describeAsPlanned,
    setMarqueeSelection: describeAsPlanned,
    addMarker: describeAsPlanned,
    removeMarker: describeAsPlanned,
    setMarkerColor: describeAsPlanned,
    addSection: describeAsPlanned,
    removeSection: describeAsPlanned,
    renameSection: describeAsPlanned,
    renameMarker: describeAsPlanned,
    moveMarker: describeAsPlanned,
    moveSection: describeAsPlanned,
    resizeSection: describeAsPlanned,
    setSectionColor: describeAsPlanned,
    reorderSection: describeAsPlanned,
    navigateSection: describeAsPlanned,
    rehearseSection: describeAsPlanned,
    restoreSectionBeats: describeAsPlanned,
    setClipGainEnvelope: describeAsPlanned,
    toggleClipGainEnvelope: describeAsPlanned,
    addGainEnvelopePoint: describeAsPlanned,
    removeGainEnvelopePoint: describeAsPlanned,
    resetClipGainEnvelope: describeAsPlanned,
    addModulator: describeAsPlanned,
    removeModulator: describeAsPlanned,
    updateModulator: describeAsPlanned,
    addMapping: describeAsPlanned,
    removeMapping: describeAsPlanned,
    addAutomationLane: describeAsPlanned,
    automateSendRange: describeAsPlanned,
    automateSendRanges: (action, context) => describeExactSendAutomation(action) ?? describeAsPlanned(action, context),
    removeSendAutomationRanges: describeAsPlanned,
    renderProjectSections: (action, context) =>
        describeExactSectionRender(action) ?? describeAsPlanned(action, context),
    removeRenderedProjectSections: describeAsPlanned,
    automateTrackGainRange: (action, context) =>
        describeExactTrackGainRange(action) ?? describeAsPlanned(action, context),
    automateParameterRange: describeAsPlanned,
    removeTrackGainAutomationRange: describeAsPlanned,
    removeSendAutomationRange: describeAsPlanned,
    removeAutomationLane: describeAsPlanned,
    setAutomationLaneEnabled: describeAsPlanned,
    addAutomationPoint: describeAsPlanned,
    insertAutomationLanePoints: describeAsPlanned,
    quantizeNotes: describeAsPlanned,
    removeShortMidiOverlaps: describeAsPlanned,
    createDrumPreviewBranches: describeAsPlanned,
    deleteDrumPreviewBranches: describeAsPlanned,
    copyMidiArticulations: describeAsPlanned,
    restoreMidiClipNotes: describeAsPlanned,
    quantizeNoteLengths: describeAsPlanned,
    transposeNotes: describeAsPlanned,
    humanizeNotes: describeAsPlanned,
    invertNotes: describeAsPlanned,
    retrogradeNotes: describeAsPlanned,
    scaleVelocities: describeAsPlanned,
    scaleAllVelocities: describeAsPlanned,
    setAllVelocities: describeAsPlanned,
    setTrackGain: (action, context, actions) =>
        describeExactTrackGain(action, actions) ?? describeAsPlanned(action, context),
    setTrackPan: describeAsPlanned,
    setTrackColor: describeAsPlanned,
    copyClip: describeAsPlanned,
    cutClip: describeAsPlanned,
    pasteClip: describeAsPlanned,
    setClipFade: describeAsPlanned,
    importMidiFile: describeAsPlanned,
    normalizeClip: describeAsPlanned,
    relinkClipAudioSources: describeAsPlanned,
    reverseClip: describeAsPlanned,
    restoreReversedClip: describeAsPlanned,
    glueClips: describeAsPlanned,
    restoreClipGlueState: describeAsPlanned,
    setCompRegion: describeAsPlanned,
    removeCompRegion: describeAsPlanned,
    restoreCompRegionInterval: describeAsPlanned,
    nudgeClip: describeAsPlanned,
    crossfadeClips: describeAsPlanned,
    restoreCrossfadeClips: describeAsPlanned,
    setClipGain: describeAsPlanned,
    setClipColor: describeAsPlanned,
    lockClip: describeAsPlanned,
    consolidateSelection: describeAsPlanned,
    bounceSelection: describeAsPlanned,
    seekPlayhead: describeAsPlanned,
    setPunchIn: describeAsPlanned,
    setPunchOut: describeAsPlanned,
    setPunchEnabled: describeAsPlanned,
    restorePunchRegion: describeAsPlanned,
    togglePunch: describeAsPlanned,
    toggleCountIn: describeAsPlanned,
    setCountInBars: describeAsPlanned,
    togglePreRoll: describeAsPlanned,
    setPreRollBars: describeAsPlanned,
    zoomTracksVertical: describeAsPlanned,
    addTimeSignatureChange: describeAsPlanned,
    removeTimeSignatureChange: describeAsPlanned,
    setTrackOutput: (action, context, actions) =>
        describeExactTrackOutput(action, context, actions) ?? describeAsPlanned(action, context),
    addSend: describeExactAddedSend,
    removeSend: describeAsPlanned,
    removeAutomationPoint: describeAsPlanned,
    setAutomationMode: describeAsPlanned,
    hideTrack: describeAsPlanned,
    disableTrack: describeAsPlanned,
    restoreTrackDisabled: describeAsPlanned,
    setTrackHeight: describeAsPlanned,
    setSnapValue: describeAsPlanned,
    zoomToFit: describeAsPlanned,
    zoomToSelection: describeAsPlanned,
    exportProject: describeAsPlanned,
    saveProject: describeAsPlanned,
    newProject: describeAsPlanned,
    importAudioFile: describeAsPlanned,
    exportMidi: describeAsPlanned,
    foldTrack: describeAsPlanned,
    groupTracks: describeAsPlanned,
    ungroupTracks: describeAsPlanned,
    scaleAutomation: describeAsPlanned,
    stretchAutomation: describeAsPlanned,
    invertAutomation: describeAsPlanned,
    reverseAutomation: describeAsPlanned,
    thinAutomation: describeAsPlanned,
    quantizeAutomation: describeAsPlanned,
    restoreAutomationLanePoints: describeAsPlanned,
    restoreAutomationPointPresence: describeAsPlanned,
    loadPreset: describeAsPlanned,
    restorePresetDeviceChain: describeAsPlanned,
    savePreset: describeAsPlanned,
    generateDrumPattern: describeAsPlanned,
    generateMelody: describeAsPlanned,
    generateChordProgression: describeAsPlanned,
    setClipLoop: describeAsPlanned,
    restoreClipLoop: describeAsPlanned,
    setClipLoopLength: describeAsPlanned,
    restoreClipLoopLength: describeAsPlanned,
    createGrooveTemplate: describeAsPlanned,
    renameGrooveTemplate: describeAsPlanned,
    restoreGrooveTemplateName: describeAsPlanned,
    deleteGrooveTemplate: describeAsPlanned,
    restoreDeletedGrooveTemplate: describeAsPlanned,
    assignGrooveTemplate: describeAsPlanned,
    restoreGrooveAssignment: describeAsPlanned,
    extractGroove: describeAsPlanned,
    applyGroove: describeAsPlanned,
    setClipStretchMode: describeAsPlanned,
    setClipStretchRatio: describeAsPlanned,
    restoreClipStretchState: describeAsPlanned,
    fitClipToBeats: describeAsPlanned,
    analyzeMix: describeAsPlanned,
    autoFixMix: describeAsPlanned,
    enableMpe: describeAsPlanned,
    disableMpe: describeAsPlanned,
    getLatencyReport: describeAsPlanned,
    createCollabSession: describeAsPlanned,
    joinCollabSession: describeAsPlanned,
    leaveCollabSession: describeAsPlanned,
    scanPlugins: describeAsPlanned,
    loadExternalPlugin: describeAsPlanned,
    audioToMidi: describeAsPlanned,
    commitPitchEdit: describeAsPlanned,
    restoreClipFileId: describeAsPlanned,
    muteClip: describeAsPlanned,
    clearSolos: describeAsPlanned,
    restoreTrackSoloStates: describeAsPlanned,
    setTrackNotes: describeAsPlanned,
    deleteTime: describeAsPlanned,
    insertTime: describeAsPlanned,
    duplicateTimeRange: describeAsPlanned,
    restoreTimeOperationState: describeAsPlanned,
    restoreTrackHeights: describeAsPlanned,
    restoreTrackGroupMemberships: describeAsPlanned,
    restoreTracks: describeAsPlanned,
    restoreTrackClipStates: describeAsPlanned,
    discardCreatedTracks: describeAsPlanned,
    discardCreatedCompGroup: describeAsPlanned,
    restoreTrackAlternativeState: describeAsPlanned,
    restoreScratchPadState: describeAsPlanned,
    stripSilence: describeAsPlanned,
    restoreStripSilenceState: describeAsPlanned,
    detectTempo: describeAsPlanned,
    detectKey: describeAsPlanned,
    consolidateAllTracks: describeAsPlanned,
    arpeggiate: describeAsPlanned,
    addSidechainRoute: describeAsPlanned,
    removeSidechainRoute: describeAsPlanned,
    bounceToNewTrack: describeAsPlanned,
    saveTrackTemplate: describeAsPlanned,
    loadTrackTemplate: describeAsPlanned,
    deleteTrackTemplate: describeAsPlanned,
    createProjectFromTemplate: describeAsPlanned,
    setProductionBrief: describeExactProductionBrief,
    repairProjectData: describeAsPlanned,
    createVcaGroup: describeAsPlanned,
    assignToVca: describeAsPlanned,
    removeFromVca: describeAsPlanned,
    setVcaGain: describeAsPlanned,
    restoreLegacyVcaState: describeAsPlanned,
    setMidiOutput: describeAsPlanned,
    clearMidiOutput: describeAsPlanned,
    restoreMidiOutput: describeAsPlanned,
    addNotes: describeAsPlanned,
    completeMidi: describeAsPlanned,
    variationMidi: describeAsPlanned,
    generateBassline: describeAsPlanned,
    replayGeneratedMidi: describeAsPlanned,
    stemSeparate: describeAsPlanned,
    autoOrganizeProject: describeAsPlanned,
    addChordEvent: describeAsPlanned,
    moveChordEvent: describeAsPlanned,
    updateChordEvent: describeAsPlanned,
    removeChordEvent: describeAsPlanned,
    toggleChordTrack: describeAsPlanned,
    clearChordTrack: describeAsPlanned,
    restoreChordTrackState: describeAsPlanned,
    clearAllMidiMappings: describeAsPlanned,
    completeMidiLearn: describeAsPlanned,
    removeMidiMapping: describeAsPlanned,
    restoreMidiLearnMappings: describeAsPlanned,
    toggleScratchPad: describeAsPlanned,
    captureScratchPad: describeAsPlanned,
    commitScratchPad: describeAsPlanned,
    clearScratchPad: describeAsPlanned,
    removeScratchPadSection: describeAsPlanned,
    renameScratchPadSection: describeAsPlanned,
    reorderScratchPadSection: describeAsPlanned,
    setScratchPadSectionColor: describeAsPlanned,
    createPatternInstance: describeAsPlanned,
    detachPatternInstance: describeAsPlanned,
    restorePatternInstanceLink: describeAsPlanned,
    startMacroRecording: describeAsPlanned,
    stopMacroRecording: describeAsPlanned,
    playMacro: describeAsPlanned,
    deleteMacro: describeAsPlanned,
    renameMacro: describeAsPlanned,
    undo: describeAsPlanned,
    redo: describeAsPlanned,
    toggleUndoTree: describeAsPlanned,
    labelUndoBranch: describeAsPlanned,
    detectSongStructure: describeAsPlanned,
    createProjectVersion: describeAsPlanned,
    restoreProjectVersion: describeAsPlanned,
    createVersionBranch: describeAsPlanned,
    generateFill: describeAsPlanned,
    generateAllTransitions: describeAsPlanned,
    compareToReference: describeAsPlanned,
    toggleControlRoomMono: describeAsPlanned,
    toggleControlRoomDim: describeAsPlanned,
    switchMonitor: describeAsPlanned,
    getMentorTips: describeAsPlanned,
    searchSamples: describeAsPlanned,
    createCompGroup: describeAsPlanned,
    togglePunchRecording: describeAsPlanned,
    toggleLoopRecord: describeAsPlanned,
    triggerScene: describeAsPlanned,
    nextSetlistItem: describeAsPlanned,
    previousSetlistItem: describeAsPlanned,
    createAdjustmentLayer: describeAsPlanned,
    removeAdjustmentLayer: describeAsPlanned,
    toggleAdjustmentLayer: describeAsPlanned,
    setLayerParameter: describeAsPlanned,
    setLayerMix: describeAsPlanned,
    addAdjustmentRegion: (action, context) =>
        describeExactAdjustmentRegion(action) ?? describeAsPlanned(action, context),
    removeAdjustmentRegion: describeAsPlanned,
    moveAdjustmentRegion: describeAsPlanned,
    setLayerFades: describeAsPlanned,
    setLayerAffectedTracks: describeAsPlanned,
    setLayerInsertionIndex: describeAsPlanned,
    restoreAdjustmentLayerMutation: describeAsPlanned,
    detectTransients: describeAsPlanned,
    quantizeTransients: describeAsPlanned,
    openElasticEditor: describeAsPlanned,
    closeElasticEditor: describeAsPlanned,
    elasticSetSensitivity: describeAsPlanned,
    elasticAddMarker: describeAsPlanned,
    elasticRemoveMarker: describeAsPlanned,
    elasticToggleMarkerLock: describeAsPlanned,
    elasticSetTool: describeAsPlanned,
    toggleNodeView: describeAsPlanned,
    setControlSurface: describeAsPlanned,
    addCvOutput: describeAsPlanned,
    removeCvOutput: describeAsPlanned,
    connectPush: describeAsPlanned,
    disconnectPush: describeAsPlanned,
    exportDawProject: describeAsPlanned,
    importDawProject: describeAsPlanned,
    loadRaveModel: describeAsPlanned,
    setRaveBlend: describeAsPlanned,
    enableWarping: describeAsPlanned,
    setWarpAlgorithm: describeAsPlanned,
    setWarpPitchShift: describeAsPlanned,
    setYeastProcessorParam: describeAsPlanned,
    setYeastArpPattern: describeAsPlanned,
    setYeastProcessorBypass: describeAsPlanned,
    addYeastProcessor: describeAsPlanned,
    removeYeastProcessor: describeAsPlanned,
    reorderYeastProcessor: describeAsPlanned,
    commitRecording: describeAsPlanned,
    discardRecording: describeAsPlanned,
    restoreRecording: describeAsPlanned,
    appendOverdubControllers: describeAsPlanned,
    removeOverdubControllers: describeAsPlanned,
};

function describeExactAction(action: AppAction, actions: readonly AppAction[], context: ProjectContext): string {
    return lookupExact(action, context, actions);
}

function lookupExact<Type extends AppActionType>(
    action: ActionOf<Type>,
    context: ProjectContext,
    actions: readonly AppAction[]
): string {
    return exactDescriberByActionType[action.type](action, context, actions);
}

/**
 * A brief batch changes no sound, so no goal carries its request's unmeasured clauses onto the card;
 * the card states each one itself. A brief is never a refinement, so its own request is the whole
 * reading, taken when the card is made.
 */
function describeUnmeasuredBriefClauses(
    actions: readonly AppAction[],
    prompt: string,
    context: ProjectContext
): string {
    if (!actions.some((action) => action.type === 'setProductionBrief')) {
        return '';
    }
    return compilePerceptualConstraints(prompt, context)
        .unsupported.map(
            ({ clause }) => `\n\nNot measured: “${clause}” — nothing the application measures shows that it holds.`
        )
        .join('');
}

export function describePendingActionConfirmation({
    actions,
    context,
    prompt,
    workflowCapabilityId,
    inheritedProtectedUnchanged = [],
    requestProtectionFacts,
    keptDirectionActionIndexes = [],
}: DescribePendingActionConfirmationInput) {
    const actionLabels = actions.map((action, index) => {
        const label = describeExactAction(action, actions, context);
        return keptDirectionActionIndexes.includes(index) ? `${label} (${KEPT_DIRECTION_NOTE})` : label;
    });
    const affectedIds = [...new Set(actions.flatMap((action) => getPlannedActionAffectedIds(action)))];
    const policies = actions.map((action) => getAppActionExecutionPolicy(action.type));
    const riskPolicy = policies.reduce((highest, policy) =>
        riskRank[policy.risk] > riskRank[highest.risk] ? policy : highest
    );
    let risk = {
        level: riskPolicy.risk,
        reason: riskPolicy.reason,
    };
    if (
        actions.length > 1 &&
        (actions.every((action) => action.type === 'addDevice') ||
            actions.every((action) => action.type === 'addAdjustmentRegion')) &&
        riskPolicy.risk === 'bounded-reversible'
    ) {
        risk = {
            level: 'broad-reversible',
            reason: 'This applies the same change to multiple project targets.',
        };
    }
    const protectedUnchanged = unionProtectedObjects(
        requestProtectionFacts?.protectedUnchanged ??
            getApplicationProtectedObjects({
                actions,
                context,
                prompt,
                workflowCapabilityId,
            }),
        inheritedProtectedUnchanged
    );
    const intendedChanges = actions
        .map((action, index) => `- **${action.type}**: ${actionLabels[index] ?? action.type}`)
        .join('\n');
    const protectedSummary = protectedUnchanged.map((target) => `"${target.name}" (${target.id})`).join(', ');
    const affectedSummary = affectedIds.join(', ');
    const riskReason = risk.reason ? ` — ${risk.reason}` : '';
    const protectedLine = protectedSummary ? `\n\nProtected unchanged: ${protectedSummary}` : '';
    const unmeasuredLines = describeUnmeasuredBriefClauses(actions, prompt, context);
    const content = `This prompt requires confirmation before execution.\n\nRisk: ${risk.level}${riskReason}\n\nIntended changes:\n${intendedChanges}\n\nAffected IDs: ${affectedSummary}${protectedLine}${unmeasuredLines}`;
    return { actionLabels, affectedIds, risk, protectedUnchanged, content };
}
