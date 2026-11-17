import { type ProjectContext } from '../models/ProjectContext';
import { type RuntimeAction, type RuntimeActionType } from '../models/RuntimeAction';

import { type SectionPlanningSignature } from './llmActionBridgeContracts';
import { normalizeMarkerName } from './llmActionStrategies/bridgeArgumentGuards';
import { normalizeVcaGroupName } from './llmActionStrategies/masterVcaStrategy';

type ActionOf<Type extends RuntimeActionType> = Extract<RuntimeAction, { type: Type }>;
type MutationKeyLookup = {
    readonly [Type in RuntimeActionType]: (
        action: ActionOf<Type>,
        context: ProjectContext,
        sectionSignatures: readonly SectionPlanningSignature[]
    ) => string[];
};

const ALL_CLIP_ASPECTS = [
    'membership',
    'name',
    'geometry',
    'gain',
    'muted',
    'color',
    'fades',
    'lock',
    'loop',
    'stretch',
    'notes',
] as const;

function clipKey(clipId: string, aspect: string): string {
    return `clip:${clipId}:${aspect}`;
}

function allClipKeys(clipId: string): string[] {
    return ALL_CLIP_ASPECTS.map((aspect) => clipKey(clipId, aspect));
}

export function getClipAutomationLaneIds(context: ProjectContext, clipId: string): string[] {
    return (context.automationLanes ?? []).filter((lane) => lane.clipId === clipId).map((lane) => lane.id);
}

function getExistingVcaMembershipCollectionKeys(context: ProjectContext, trackIds: readonly string[]): string[] {
    const affectedTrackIds = new Set(trackIds);
    return (context.vcaGroups ?? [])
        .filter((group) => group.trackIds.some((trackId) => affectedTrackIds.has(trackId)))
        .map((group) => `vca-members:${group.id}`);
}

function noKeys(): string[] {
    return [];
}

function actionTypeKey(action: ActionOf<'setTempo' | 'setTimeSignature' | 'reorderTrack'>): string[] {
    return [action.type];
}

function renameSectionKeys(
    action: ActionOf<'renameSection'>,
    _context: ProjectContext,
    sectionSignatures: readonly SectionPlanningSignature[]
): string[] {
    const section = sectionSignatures.find((candidate) => candidate.sectionId === action.payload.sectionId);
    const keys = [`section:${action.payload.sectionId}:name`];
    if (section) {
        keys.push(
            `section:${String(section.startBeat)}:${String(section.endBeat)}:${normalizeMarkerName(action.payload.name)}`
        );
    }
    return keys;
}

function createVcaGroupKeys(action: ActionOf<'createVcaGroup'>, context: ProjectContext): string[] {
    return [
        'vca-group-rows',
        `vca-name:${normalizeVcaGroupName(action.payload.name)}`,
        ...action.payload.trackIds.map((trackId) => `vca-membership:${trackId}`),
        ...getExistingVcaMembershipCollectionKeys(context, action.payload.trackIds),
    ];
}

function assignToVcaKeys(action: ActionOf<'assignToVca'>, context: ProjectContext): string[] {
    return [
        `vca-membership:${action.payload.trackId}`,
        `vca-members:${action.payload.vcaGroupId}`,
        ...getExistingVcaMembershipCollectionKeys(context, [action.payload.trackId]),
    ];
}

function removeFromVcaKeys(action: ActionOf<'removeFromVca'>, context: ProjectContext): string[] {
    return [
        `vca-membership:${action.payload.trackId}`,
        ...getExistingVcaMembershipCollectionKeys(context, [action.payload.trackId]),
    ];
}

function automationLanePointsKeys(
    action: ActionOf<
        | 'scaleAutomation'
        | 'stretchAutomation'
        | 'invertAutomation'
        | 'reverseAutomation'
        | 'thinAutomation'
        | 'quantizeAutomation'
    >
): string[] {
    return [`automation-lane-points:${action.payload.laneId}`];
}

function sendKeys(action: ActionOf<'setSend' | 'addSend' | 'removeSend'>): string[] {
    return [`send:${action.payload.trackId}:${action.payload.busId}`];
}

function addSidechainRouteKeys(action: ActionOf<'addSidechainRoute'>): string[] {
    const targetDeviceId = action.payload.targetDeviceId ?? action.payload.targetTrackId;
    return [`sidechain:${action.payload.sourceTrackId}:${targetDeviceId}`];
}

function trackScopedKeys(
    action: ActionOf<
        | 'renameTrack'
        | 'muteTrack'
        | 'soloTrack'
        | 'setSoloSafe'
        | 'armTrack'
        | 'setTrackGain'
        | 'setTrackPan'
        | 'setTrackColor'
        | 'setAutomationMode'
    >
): string[] {
    return [`${action.type}:${action.payload.trackId}`];
}

function moveClipKeys(action: ActionOf<'moveClip'>, context: ProjectContext): string[] {
    return [
        clipKey(action.payload.clipId, 'membership'),
        clipKey(action.payload.clipId, 'geometry'),
        ...getClipAutomationLaneIds(context, action.payload.clipId).map((laneId) => `automation-lane-points:${laneId}`),
    ];
}

function crossfadeClipsKeys(action: ActionOf<'crossfadeClips'>): string[] {
    return [
        clipKey(action.payload.clipAId, 'geometry'),
        clipKey(action.payload.clipAId, 'fades'),
        clipKey(action.payload.clipBId, 'geometry'),
        clipKey(action.payload.clipBId, 'fades'),
    ];
}

const mutationKeysByActionType: MutationKeyLookup = {
    importStemSet: noKeys,
    addTrack: noKeys,
    removeTrack: (action) => [`${action.type}:${action.payload.trackId}`, `vca-membership:${action.payload.trackId}`],
    removeAllTracks: noKeys,
    renameTrack: trackScopedKeys,
    selectTrack: noKeys,
    muteTrack: trackScopedKeys,
    soloTrack: trackScopedKeys,
    selectTake: noKeys,
    setSoloSafe: trackScopedKeys,
    toggleSoloSafe: noKeys,
    armTrack: trackScopedKeys,
    freezeTrack: noKeys,
    unfreezeTrack: noKeys,
    flattenTrack: noKeys,
    bounceInPlace: noKeys,
    duplicateTrack: noKeys,
    reorderTrack: actionTypeKey,
    setTrackGain: trackScopedKeys,
    setTrackPan: trackScopedKeys,
    setTrackColor: trackScopedKeys,
    setTempo: actionTypeKey,
    setTimeSignature: actionTypeKey,
    setProductionBrief: noKeys,
    setPlayback: () => ['transport:runtime'],
    togglePlayback: noKeys,
    stopPlayback: () => ['transport:runtime'],
    toggleRecording: noKeys,
    setMasterGain: () => ['master:gain'],
    toggleLoop: noKeys,
    toggleMetronome: noKeys,
    setMetronomeVolume: () => ['metronome:volume'],
    setLoopRegion: () => ['loop:region'],
    setLoopEnabled: () => ['loop:enabled'],
    setMetronomeEnabled: () => ['metronome:enabled'],
    restoreLoopRegion: noKeys,
    addClip: noKeys,
    drawClip: noKeys,
    duplicateClipAt: noKeys,
    moveClips: (action) => action.payload.moves.map((move) => clipKey(move.clipId, 'geometry')),
    moveClip: moveClipKeys,
    duplicateClip: noKeys,
    duplicateClipToNextBar: noKeys,
    removeClip: (action) => allClipKeys(action.payload.clipId),
    splitClip: (action) => allClipKeys(action.payload.clipId),
    trimClipStart: (action) => [clipKey(action.payload.clipId, 'geometry')],
    trimClipEnd: (action) => [clipKey(action.payload.clipId, 'geometry')],
    setClipFade: (action) => [clipKey(action.payload.clipId, 'fades')],
    copyClip: noKeys,
    cutClip: noKeys,
    pasteClip: noKeys,
    addDevice: noKeys,
    bypassDevice: (action) => [`${action.type}:${action.payload.deviceId}`],
    removeDevice: noKeys,
    setDeviceParameter: (action) => [`${action.type}:${action.payload.deviceId}:${action.payload.paramId}`],
    createBus: noKeys,
    createFolder: noKeys,
    setSend: sendKeys,
    setWorkspaceMode: noKeys,
    openPreferencesDialog: noKeys,
    openMixer: noKeys,
    closeMixer: noKeys,
    toggleSidebar: noKeys,
    toggleInspector: noKeys,
    toggleChatPanel: noKeys,
    setEditingTool: noKeys,
    setMarqueeSelection: noKeys,
    addMarker: (action) => [`marker:${String(action.payload.beat)}:${normalizeMarkerName(action.payload.name)}`],
    removeMarker: (action) => [
        `marker:${action.payload.markerId}:membership`,
        `marker:${action.payload.markerId}:color`,
    ],
    setMarkerColor: (action) => [`marker:${action.payload.markerId}:color`],
    addSection: (action) => [
        `section:${String(action.payload.startBeat)}:${String(action.payload.endBeat)}:${normalizeMarkerName(action.payload.name)}`,
    ],
    removeSection: (action) => [
        `section:${action.payload.sectionId}:membership`,
        `section:${action.payload.sectionId}:name`,
    ],
    renameSection: renameSectionKeys,
    addAutomationLane: (action) => [`automation-target:${action.payload.trackId}:${action.payload.parameterId}`],
    automateSendRange: noKeys,
    automateSendRanges: noKeys,
    automateTrackGainRange: noKeys,
    automateParameterRange: noKeys,
    renderProjectSections: noKeys,
    addAutomationPoint: (action) => [`automation-lane-point:${action.payload.laneId}:${String(action.payload.beat)}`],
    setAutomationLaneEnabled: (action) => [`automation-lane-enabled:${action.payload.laneId}`],
    quantizeNotes: (action) => [clipKey(action.payload.clipId, 'notes')],
    editMidiNotes: noKeys,
    removeShortMidiOverlaps: noKeys,
    createDrumPreviewBranches: noKeys,
    copyMidiArticulations: noKeys,
    quantizeNoteLengths: (action) => [clipKey(action.payload.clipId, 'notes')],
    transposeNotes: (action) => [clipKey(action.payload.clipId, 'notes')],
    humanizeNotes: noKeys,
    invertNotes: (action) => [clipKey(action.payload.clipId, 'notes')],
    retrogradeNotes: (action) => [clipKey(action.payload.clipId, 'notes')],
    scaleVelocities: noKeys,
    scaleAllVelocities: (action) => [clipKey(action.payload.clipId, 'notes')],
    setAllVelocities: (action) => [clipKey(action.payload.clipId, 'notes')],
    importMidiFile: noKeys,
    normalizeClip: (action) => [clipKey(action.payload.clipId, 'gain')],
    reverseClip: noKeys,
    glueClips: (action) => action.payload.clipIds.flatMap((clipId) => allClipKeys(clipId)),
    nudgeClip: (action) => [clipKey(action.payload.clipId, 'geometry')],
    slipClipContent: (action) => [clipKey(action.payload.clipId, 'offset')],
    crossfadeClips: crossfadeClipsKeys,
    setClipGain: (action) => [clipKey(action.payload.clipId, 'gain')],
    setClipColor: (action) => [clipKey(action.payload.clipId, 'color')],
    lockClip: (action) => [clipKey(action.payload.clipId, 'lock')],
    renameClip: (action) => [clipKey(action.payload.clipId, 'name')],
    consolidateSelection: noKeys,
    bounceSelection: noKeys,
    seekPlayhead: noKeys,
    setPunchIn: () => ['punch:region'],
    setPunchOut: () => ['punch:region'],
    setPunchEnabled: () => ['punch:enabled'],
    toggleCountIn: noKeys,
    setCountInBars: noKeys,
    togglePreRoll: noKeys,
    setPreRollBars: noKeys,
    addTimeSignatureChange: noKeys,
    removeTimeSignatureChange: noKeys,
    setTrackOutput: (action) => [`output:${action.payload.trackId}`],
    addSend: sendKeys,
    removeSend: sendKeys,
    removeAutomationPoint: noKeys,
    setAutomationMode: trackScopedKeys,
    hideTrack: noKeys,
    disableTrack: noKeys,
    setTrackHeight: noKeys,
    setSnapValue: noKeys,
    zoomToFit: noKeys,
    zoomToSelection: noKeys,
    exportProject: noKeys,
    saveProject: noKeys,
    newProject: noKeys,
    importAudioFile: noKeys,
    exportMidi: noKeys,
    foldTrack: noKeys,
    groupTracks: noKeys,
    ungroupTracks: noKeys,
    scaleAutomation: automationLanePointsKeys,
    stretchAutomation: automationLanePointsKeys,
    invertAutomation: automationLanePointsKeys,
    reverseAutomation: automationLanePointsKeys,
    thinAutomation: automationLanePointsKeys,
    quantizeAutomation: automationLanePointsKeys,
    loadPreset: noKeys,
    savePreset: noKeys,
    generateDrumPattern: noKeys,
    generateMelody: noKeys,
    generateChordProgression: noKeys,
    setClipLoop: (action) => [clipKey(action.payload.clipId, 'loop')],
    setClipLoopLength: (action) => [
        clipKey(action.payload.clipId, 'loop'),
        clipKey(action.payload.clipId, 'geometry'),
        clipKey(action.payload.clipId, 'stretch'),
    ],
    extractGroove: noKeys,
    applyGroove: noKeys,
    setClipStretchMode: (action) => [
        clipKey(action.payload.clipId, 'geometry'),
        clipKey(action.payload.clipId, 'stretch'),
    ],
    setClipStretchRatio: (action) => [
        clipKey(action.payload.clipId, 'geometry'),
        clipKey(action.payload.clipId, 'stretch'),
    ],
    fitClipToBeats: (action) => [clipKey(action.payload.clipId, 'geometry'), clipKey(action.payload.clipId, 'stretch')],
    analyzeMix: noKeys,
    autoFixMix: noKeys,
    enableMpe: noKeys,
    disableMpe: noKeys,
    getLatencyReport: noKeys,
    createCollabSession: noKeys,
    joinCollabSession: noKeys,
    leaveCollabSession: noKeys,
    scanPlugins: noKeys,
    loadExternalPlugin: noKeys,
    audioToMidi: noKeys,
    muteClip: (action) => [clipKey(action.payload.clipId, 'muted')],
    clearSolos: () => ['solo:all'],
    setTrackNotes: noKeys,
    setTrackInput: noKeys,
    zoomTracksVertical: noKeys,
    deleteTime: noKeys,
    insertTime: noKeys,
    duplicateTimeRange: noKeys,
    stripSilence: noKeys,
    detectTempo: noKeys,
    detectKey: noKeys,
    consolidateAllTracks: noKeys,
    arpeggiate: noKeys,
    addSidechainRoute: addSidechainRouteKeys,
    removeSidechainRoute: (action) => [`sidechain:${action.payload.sourceTrackId}:${action.payload.targetTrackId}`],
    bounceToNewTrack: noKeys,
    createTrackAlternative: noKeys,
    switchTrackAlternative: noKeys,
    renameTrackAlternative: noKeys,
    deleteTrackAlternative: noKeys,
    addChordEvent: noKeys,
    addCvOutput: noKeys,
    addNotes: noKeys,
    addYeastProcessor: noKeys,
    assignToVca: assignToVcaKeys,
    autoOrganizeProject: noKeys,
    captureScratchPad: noKeys,
    clearAllMidiMappings: noKeys,
    clearChordTrack: noKeys,
    clearMidiOutput: noKeys,
    clearScratchPad: noKeys,
    commitScratchPad: noKeys,
    compareToReference: noKeys,
    completeMidi: noKeys,
    connectPush: noKeys,
    createAdjustmentLayer: noKeys,
    addAdjustmentRegion: noKeys,
    createCompGroup: noKeys,
    createPatternInstance: noKeys,
    createProjectVersion: noKeys,
    createVcaGroup: createVcaGroupKeys,
    createVersionBranch: noKeys,
    deleteMacro: noKeys,
    deleteTrackTemplate: noKeys,
    detachPatternInstance: noKeys,
    detectSongStructure: noKeys,
    detectTransients: noKeys,
    disconnectPush: noKeys,
    enableWarping: noKeys,
    exportDawProject: noKeys,
    generateAllTransitions: noKeys,
    generateBassline: noKeys,
    generateFill: noKeys,
    getMentorTips: noKeys,
    labelUndoBranch: noKeys,
    loadRaveModel: noKeys,
    loadTrackTemplate: noKeys,
    nextSetlistItem: noKeys,
    playMacro: noKeys,
    previousSetlistItem: noKeys,
    quantizeTransients: noKeys,
    redo: noKeys,
    removeChordEvent: noKeys,
    removeFromVca: removeFromVcaKeys,
    removeYeastProcessor: noKeys,
    reorderYeastProcessor: noKeys,
    restoreAutomationLanePoints: noKeys,
    restoreClip: noKeys,
    restoreProjectVersion: noKeys,
    restoreTrack: noKeys,
    saveTrackTemplate: noKeys,
    searchSamples: noKeys,
    setControlSurface: noKeys,
    setMidiOutput: noKeys,
    setRaveBlend: noKeys,
    setVcaGain: (action) => [`vca-gain:${action.payload.vcaGroupId}`],
    setWarpAlgorithm: noKeys,
    setWarpPitchShift: noKeys,
    setYeastArpPattern: noKeys,
    setYeastProcessorBypass: noKeys,
    setYeastProcessorParam: noKeys,
    startMacroRecording: noKeys,
    stopMacroRecording: noKeys,
    switchMonitor: noKeys,
    toggleChordTrack: noKeys,
    toggleControlRoomDim: noKeys,
    toggleControlRoomMono: noKeys,
    toggleLoopRecord: noKeys,
    toggleNodeView: noKeys,
    togglePunchRecording: noKeys,
    toggleScratchPad: noKeys,
    toggleUndoTree: noKeys,
    triggerScene: noKeys,
    undo: noKeys,
    variationMidi: noKeys,
};

function lookupMutationKeys<Type extends RuntimeActionType>(
    action: ActionOf<Type>,
    context: ProjectContext,
    sectionSignatures: readonly SectionPlanningSignature[]
): string[] {
    if (!Object.hasOwn(mutationKeysByActionType, action.type)) {
        return noKeys();
    }
    return mutationKeysByActionType[action.type](action, context, sectionSignatures);
}

export function getMutationKeys(
    action: RuntimeAction,
    context: ProjectContext,
    sectionSignatures: readonly SectionPlanningSignature[]
): string[] {
    return lookupMutationKeys(action, context, sectionSignatures);
}
