import type { AppAction, AppActionType } from '#/utils/handlerContract';

export const RUNTIME_ACTION_TYPES = [
    'addTrack',
    'removeTrack',
    'removeAllTracks',
    'renameTrack',
    'selectTrack',
    'muteTrack',
    'soloTrack',
    'toggleSoloSafe',
    'armTrack',
    'freezeTrack',
    'unfreezeTrack',
    'flattenTrack',
    'bounceInPlace',
    'duplicateTrack',
    'reorderTrack',
    'setTrackGain',
    'setTrackPan',
    'setTrackColor',
    'setTempo',
    'setTimeSignature',
    'togglePlayback',
    'stopPlayback',
    'toggleRecording',
    'setMasterGain',
    'toggleLoop',
    'toggleMetronome',
    'setMetronomeVolume',
    'setLoopRegion',
    'addClip',
    'moveClip',
    'duplicateClip',
    'duplicateClipToNextBar',
    'removeClip',
    'splitClip',
    'trimClipStart',
    'trimClipEnd',
    'setClipFade',
    'copyClip',
    'cutClip',
    'pasteClip',
    'addDevice',
    'bypassDevice',
    'removeDevice',
    'setDeviceParameter',
    'createBus',
    'createFolder',
    'setSend',
    'setWorkspaceMode',
    'openPreferencesDialog',
    'openMixer',
    'closeMixer',
    'toggleSidebar',
    'toggleInspector',
    'toggleChatPanel',
    'setEditingTool',
    'setMarqueeSelection',
    'addMarker',
    'removeMarker',
    'setMarkerColor',
    'addSection',
    'removeSection',
    'renameSection',
    'addAutomationLane',
    'addAutomationPoint',
    'quantizeNotes',
    'quantizeNoteLengths',
    'transposeNotes',
    'humanizeNotes',
    'invertNotes',
    'retrogradeNotes',
    'scaleVelocities',
    'scaleAllVelocities',
    'setAllVelocities',
    'importMidiFile',
    'normalizeClip',
    'reverseClip',
    'glueClips',
    'nudgeClip',
    'crossfadeClips',
    'setClipGain',
    'setClipColor',
    'lockClip',
    'renameClip',
    'consolidateSelection',
    'bounceSelection',
    'seekPlayhead',
    'setPunchIn',
    'setPunchOut',
    'togglePunch',
    'toggleCountIn',
    'setCountInBars',
    'togglePreRoll',
    'setPreRollBars',
    'addTimeSignatureChange',
    'removeTimeSignatureChange',
    'setTrackOutput',
    'addSend',
    'removeSend',
    'removeAutomationPoint',
    'setAutomationMode',
    'hideTrack',
    'disableTrack',
    'setTrackHeight',
    'setSnapValue',
    'zoomToFit',
    'zoomToSelection',
    'exportProject',
    'saveProject',
    'newProject',
    'importAudioFile',
    'exportMidi',
    'foldTrack',
    'groupTracks',
    'ungroupTracks',
    'scaleAutomation',
    'stretchAutomation',
    'invertAutomation',
    'reverseAutomation',
    'thinAutomation',
    'quantizeAutomation',
    'loadPreset',
    'savePreset',
    'generateDrumPattern',
    'generateMelody',
    'generateChordProgression',
    'setClipLoop',
    'setClipLoopLength',
    'extractGroove',
    'applyGroove',
    'setClipStretchMode',
    'setClipStretchRatio',
    'fitClipToBeats',
    'analyzeMix',
    'autoFixMix',
    'enableMpe',
    'disableMpe',
    'getLatencyReport',
    'createCollabSession',
    'joinCollabSession',
    'leaveCollabSession',
    'scanPlugins',
    'loadExternalPlugin',
    'audioToMidi',
    'muteClip',
    'clearSolos',
    'setTrackNotes',
    'setTrackInput',
    'zoomTracksVertical',
    'deleteTime',
    'insertTime',
    'duplicateTimeRange',
    'stripSilence',
    'detectTempo',
    'detectKey',
    'consolidateAllTracks',
    'arpeggiate',
    'addSidechainRoute',
    'removeSidechainRoute',
    'bounceToNewTrack',
    'createTrackAlternative',
    'switchTrackAlternative',
    'renameTrackAlternative',
    'deleteTrackAlternative',
    'addChordEvent',
    'addCvOutput',
    'addNotes',
    'assignToVca',
    'autoOrganizeProject',
    'captureScratchPad',
    'clearAllMidiMappings',
    'clearChordTrack',
    'clearMidiOutput',
    'clearScratchPad',
    'commitScratchPad',
    'compareToReference',
    'completeMidi',
    'connectPush',
    'createAdjustmentLayer',
    'createCompGroup',
    'createPatternInstance',
    'createProjectVersion',
    'createVcaGroup',
    'createVersionBranch',
    'deleteMacro',
    'deleteTrackTemplate',
    'detachPatternInstance',
    'detectSongStructure',
    'detectTransients',
    'disconnectPush',
    'enableWarping',
    'exportDawProject',
    'generateAllTransitions',
    'generateAudio',
    'generateBassline',
    'generateFill',
    'getMentorTips',
    'labelUndoBranch',
    'loadRaveModel',
    'loadTrackTemplate',
    'nextSetlistItem',
    'playMacro',
    'previousSetlistItem',
    'quantizeTransients',
    'redo',
    'removeChordEvent',
    'removeFromVca',
    'restoreAutomationLanePoints',
    'restoreClip',
    'restoreDsoSnapshot',
    'restoreProjectVersion',
    'restoreTrack',
    'saveTrackTemplate',
    'searchSamples',
    'setControlSurface',
    'setMidiOutput',
    'setRaveBlend',
    'setVcaGain',
    'setWarpAlgorithm',
    'setWarpPitchShift',
    'startMacroRecording',
    'stemSeparate',
    'stopMacroRecording',
    'switchMonitor',
    'toggleChordTrack',
    'toggleControlRoomDim',
    'toggleControlRoomMono',
    'toggleLoopRecord',
    'toggleNodeView',
    'togglePunchRecording',
    'toggleScratchPad',
    'toggleUndoTree',
    'triggerScene',
    'undo',
    'variationMidi',
] as const satisfies readonly AppActionType[];

export type RuntimeActionType = (typeof RUNTIME_ACTION_TYPES)[number];

type AppActionOf<ActionType extends AppActionType> = Extract<AppAction, { type: ActionType }>;
type AppActionPayload<ActionType extends AppActionType> =
    AppActionOf<ActionType> extends { payload: infer Payload } ? Payload : never;

export const RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS = {
    createTrackAlternative: ['trackId', 'name', 'duplicateActive'],
    deleteTrackAlternative: ['trackId', 'alternativeId'],
    duplicateClip: ['clipId'],
    duplicateClipToNextBar: ['clipId'],
    addMarker: ['beat', 'name'],
    addSection: ['startBeat', 'endBeat', 'name'],
    addAutomationLane: ['trackId', 'parameterId', 'parameterName'],
    generateDrumPattern: ['style', 'trackId', 'bars', 'density'],
    generateMelody: ['style', 'key', 'scale', 'trackId', 'bars'],
    generateChordProgression: ['style', 'key', 'scale', 'trackId', 'bars', 'voicing'],
    extractGroove: ['clipId'],
    createCollabSession: ['name'],
    joinCollabSession: ['inviteString', 'peerName'],
    createVcaGroup: ['name', 'trackIds'],
    addChordEvent: ['beat', 'root', 'quality', 'duration'],
    createAdjustmentLayer: ['name', 'effectType'],
} as const satisfies Partial<Record<RuntimeActionType, readonly string[]>>;

type RuntimePayloadOverrides = {
    createTrackAlternative: Pick<
        AppActionPayload<'createTrackAlternative'>,
        (typeof RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS.createTrackAlternative)[number]
    >;
    deleteTrackAlternative: Pick<
        AppActionPayload<'deleteTrackAlternative'>,
        (typeof RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS.deleteTrackAlternative)[number]
    >;
    duplicateClip: Pick<
        AppActionPayload<'duplicateClip'>,
        (typeof RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS.duplicateClip)[number]
    >;
    duplicateClipToNextBar: Pick<
        AppActionPayload<'duplicateClipToNextBar'>,
        (typeof RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS.duplicateClipToNextBar)[number]
    >;
    addMarker: Pick<AppActionPayload<'addMarker'>, (typeof RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS.addMarker)[number]>;
    addSection: Pick<AppActionPayload<'addSection'>, (typeof RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS.addSection)[number]>;
    addAutomationLane: Pick<
        AppActionPayload<'addAutomationLane'>,
        (typeof RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS.addAutomationLane)[number]
    >;
    generateDrumPattern: Pick<
        AppActionPayload<'generateDrumPattern'>,
        (typeof RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS.generateDrumPattern)[number]
    >;
    generateMelody: Pick<
        AppActionPayload<'generateMelody'>,
        (typeof RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS.generateMelody)[number]
    >;
    generateChordProgression: Pick<
        AppActionPayload<'generateChordProgression'>,
        (typeof RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS.generateChordProgression)[number]
    >;
    extractGroove: Pick<
        AppActionPayload<'extractGroove'>,
        (typeof RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS.extractGroove)[number]
    >;
    createCollabSession: Required<
        Pick<
            AppActionPayload<'createCollabSession'>,
            (typeof RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS.createCollabSession)[number]
        >
    >;
    joinCollabSession: Required<
        Pick<
            AppActionPayload<'joinCollabSession'>,
            (typeof RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS.joinCollabSession)[number]
        >
    >;
    createVcaGroup: Pick<
        AppActionPayload<'createVcaGroup'>,
        (typeof RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS.createVcaGroup)[number]
    >;
    addChordEvent: Pick<
        AppActionPayload<'addChordEvent'>,
        (typeof RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS.addChordEvent)[number]
    >;
    createAdjustmentLayer: Pick<
        AppActionPayload<'createAdjustmentLayer'>,
        (typeof RUNTIME_ACTION_OVERRIDE_PAYLOAD_KEYS.createAdjustmentLayer)[number]
    >;
};

type RuntimePayloadOverrideType = keyof RuntimePayloadOverrides;
type RuntimeActionWithPayload<ActionType extends RuntimePayloadOverrideType> = Omit<
    AppActionOf<ActionType>,
    'payload'
> & { payload: RuntimePayloadOverrides[ActionType] };

type CanonicalRuntimeAction = Exclude<
    Extract<AppAction, { type: RuntimeActionType }>,
    { type: RuntimePayloadOverrideType }
>;
type RuntimePayloadOverrideAction = {
    [ActionType in RuntimePayloadOverrideType]: RuntimeActionWithPayload<ActionType>;
}[RuntimePayloadOverrideType];

export type RuntimeAction = CanonicalRuntimeAction | RuntimePayloadOverrideAction;
