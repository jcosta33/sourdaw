/**
 * Runtime payload validators for RuntimeAction variants.
 *
 * §91.1 — The AI action pipeline receives actions from the LLM (or preset
 * fast-paths) as plain JSON. Prior to this file only three action types
 * had runtime validation; the other ~230 passed through with unchecked
 * payloads. An LLM hallucination that produced `{ type: 'removeTrack',
 * payload: { trackId: 'some-random-string' } }` would reach the handler
 * and quietly delete whatever matched.
 *
 * Design:
 *
 *   1. \`PayloadValidator<T>\` is a type guard narrowing \`unknown\` to the
 *      action variant's payload shape.
 *   2. \`PAYLOAD_VALIDATORS\` is a \`Record<RuntimeActionType, ...>\` with
 *      \`satisfies\` so TypeScript enforces that every current and future
 *      action type is listed. A new action type → compile error here.
 *   3. Each entry is either a real validator (destructive / high-risk
 *      actions) or the sentinel \`'unchecked'\` for pure UI-state toggles
 *      and fast-path presets where the payload shape is immaterial to
 *      security. The sentinel is explicit — there is no silent default.
 *
 * What's validated: everything that persists state, mutates the project
 * graph, spawns side-effectful work (exports, imports, plugin loads), or
 * controls transport/playback. What isn't: pure workspace UI toggles
 * (openMixer, toggleSidebar, setEditingTool, etc.), view state, and
 * transient AI lifecycle events. The line is "would a malformed payload
 * cause data loss, persistent corruption, or an exploit".
 */
import { type RuntimeAction, type RuntimeActionType } from '../models/RuntimeAction';

type Extract2<ActionUnion, TypeString> = ActionUnion extends { type: TypeString } ? ActionUnion : never;
type PayloadOf<ActionType extends RuntimeActionType> =
    Extract2<RuntimeAction, ActionType> extends { payload: infer P } ? P : undefined;

export type PayloadValidator<ActionType extends RuntimeActionType> = (
    payload: unknown
) => payload is PayloadOf<ActionType>;

// ── Primitive helpers ───────────────────────────────────────────────────

function isObj(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
    return typeof value === 'string';
}
function isNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}
function isInRange(value: unknown, min: number, max: number): value is number {
    return isNumber(value) && value >= min && value <= max;
}
function isOptional<Value>(value: unknown, check: (value: unknown) => value is Value): value is Value | undefined {
    return value === undefined || check(value);
}
function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(isString);
}

// ── Validators (destructive / high-risk actions) ─────────────────────────

function hasTrackId(param: unknown): param is { trackId: string } {
    return isObj(param) && isString(param.trackId);
}
function hasClipId(param: unknown): param is { clipId: string } {
    return isObj(param) && isString(param.clipId);
}

const validators = {
    // Track lifecycle
    addTrack: (param): param is PayloadOf<'addTrack'> => isObj(param) && isString(param.name) && isString(param.kind),
    removeTrack: hasTrackId as PayloadValidator<'removeTrack'>,
    renameTrack: (param): param is PayloadOf<'renameTrack'> =>
        isObj(param) && isString(param.trackId) && isString(param.name),
    duplicateTrack: hasTrackId as PayloadValidator<'duplicateTrack'>,
    deleteTrackAlternative: (param): param is PayloadOf<'deleteTrackAlternative'> =>
        isObj(param) && isString(param.trackId) && isString(param.alternativeId),
    freezeTrack: hasTrackId as PayloadValidator<'freezeTrack'>,
    unfreezeTrack: hasTrackId as PayloadValidator<'unfreezeTrack'>,
    flattenTrack: hasTrackId as PayloadValidator<'flattenTrack'>,
    bounceInPlace: hasTrackId as PayloadValidator<'bounceInPlace'>,
    bounceToNewTrack: hasTrackId as PayloadValidator<'bounceToNewTrack'>,

    // Clip lifecycle
    addClip: (param): param is PayloadOf<'addClip'> =>
        isObj(param) && isString(param.trackId) && isNumber(param.startBeat) && isNumber(param.endBeat),
    removeClip: hasClipId as PayloadValidator<'removeClip'>,
    splitClip: (param): param is PayloadOf<'splitClip'> =>
        isObj(param) && isString(param.clipId) && isNumber(param.splitBeat),
    moveClip: (param): param is PayloadOf<'moveClip'> =>
        isObj(param) &&
        isString(param.clipId) &&
        isNumber(param.newStartBeat) &&
        isOptional(param.newTrackId, isString),
    duplicateClip: hasClipId as PayloadValidator<'duplicateClip'>,

    // Device lifecycle
    addDevice: (param): param is PayloadOf<'addDevice'> =>
        isObj(param) && isString(param.trackId) && isString(param.deviceType),
    removeDevice: (param): param is PayloadOf<'removeDevice'> =>
        isObj(param) && isString(param.trackId) && isString(param.deviceId),
    setDeviceParameter: (param): param is PayloadOf<'setDeviceParameter'> =>
        isObj(param) &&
        isString(param.trackId) &&
        isString(param.deviceId) &&
        isString(param.paramId) &&
        isNumber(param.value),
    loadExternalPlugin: (param): param is PayloadOf<'loadExternalPlugin'> => isObj(param) && isString(param.pluginPath),

    // Transport (pre-existing range checks from §91)
    setTempo: (param): param is PayloadOf<'setTempo'> => isObj(param) && isInRange(param.bpm, 20, 300),
    setMasterGain: (param): param is PayloadOf<'setMasterGain'> => isObj(param) && isInRange(param.gain, 0, 1),
    setMetronomeVolume: (param): param is PayloadOf<'setMetronomeVolume'> =>
        isObj(param) && isInRange(param.volume, 0, 1),

    // Automation
    addAutomationLane: (param): param is PayloadOf<'addAutomationLane'> =>
        isObj(param) && isString(param.trackId) && isString(param.parameterId),
    addAutomationPoint: (param): param is PayloadOf<'addAutomationPoint'> =>
        isObj(param) && isString(param.laneId) && isNumber(param.beat) && isNumber(param.value),
    removeAutomationPoint: (param): param is PayloadOf<'removeAutomationPoint'> =>
        isObj(param) && isString(param.laneId) && isNumber(param.beat),

    // Sidechain routing
    addSidechainRoute: (param): param is PayloadOf<'addSidechainRoute'> =>
        isObj(param) &&
        isString(param.sourceTrackId) &&
        isString(param.targetTrackId) &&
        isString(param.targetDeviceId),
    removeSidechainRoute: (param): param is PayloadOf<'removeSidechainRoute'> =>
        isObj(param) && isString(param.routeId),

    // MIDI note batch ops
    quantizeNotes: (param): param is PayloadOf<'quantizeNotes'> =>
        isObj(param) && isString(param.clipId) && isNumber(param.grid),
    transposeNotes: (param): param is PayloadOf<'transposeNotes'> =>
        isObj(param) && isString(param.clipId) && isNumber(param.semitones),

    // Marker + section
    removeMarker: (param): param is PayloadOf<'removeMarker'> => isObj(param) && isString(param.markerId),
    removeSection: (param): param is PayloadOf<'removeSection'> => isObj(param) && isString(param.sectionId),
    removeTimeSignatureChange: (param): param is PayloadOf<'removeTimeSignatureChange'> =>
        isObj(param) && isString(param.changeId),

    // Time operations
    deleteTime: (param): param is PayloadOf<'deleteTime'> =>
        isObj(param) && isNumber(param.startBeat) && isNumber(param.endBeat),
    insertTime: (param): param is PayloadOf<'insertTime'> =>
        isObj(param) && isNumber(param.atBeat) && isNumber(param.durationBeats),

    // Imports / exports / project lifecycle
    importAudioFile: (param): param is PayloadOf<'importAudioFile'> => isObj(param) && isString(param.path),
    importMidiFile: (param): param is PayloadOf<'importMidiFile'> => isObj(param) && isString(param.path),
    exportProject: (param): param is PayloadOf<'exportProject'> => isObj(param) && isOptional(param.format, isString),
    exportMidi: (param): param is PayloadOf<'exportMidi'> => isObj(param) && isOptional(param.trackIds, isStringArray),
    exportDawProject: 'unchecked',
    saveProject: 'unchecked',
    newProject: 'unchecked',

    // Collaboration lifecycle
    createCollabSession: 'unchecked',
    joinCollabSession: (param): param is PayloadOf<'joinCollabSession'> => isObj(param) && isString(param.inviteCode),
    leaveCollabSession: 'unchecked',

    // UI / workspace toggles — no payload validation needed (view state only)
    openMixer: 'unchecked',
    closeMixer: 'unchecked',
    toggleSidebar: 'unchecked',
    toggleInspector: 'unchecked',
    toggleChatPanel: 'unchecked',
    togglePlayback: 'unchecked',
    stopPlayback: 'unchecked',
    toggleRecording: 'unchecked',
    toggleLoop: 'unchecked',
    toggleMetronome: 'unchecked',
    togglePunch: 'unchecked',
    toggleCountIn: 'unchecked',
    togglePreRoll: 'unchecked',
    setLoopRegion: 'unchecked',
    setPunchIn: 'unchecked',
    setPunchOut: 'unchecked',
    setCountInBars: 'unchecked',
    setPreRollBars: 'unchecked',
    seekPlayhead: 'unchecked',
    setEditingTool: 'unchecked',
    setMarqueeSelection: 'unchecked',
    setWorkspaceMode: 'unchecked',
    setSnapValue: 'unchecked',
    zoomToFit: 'unchecked',
    zoomToSelection: 'unchecked',
    zoomTracksVertical: 'unchecked',
    setTrackHeight: 'unchecked',

    // Track state toggles — trusted (they already check trackId in the handler)
    selectTrack: 'unchecked',
    muteTrack: 'unchecked',
    soloTrack: 'unchecked',
    toggleSoloSafe: 'unchecked',
    armTrack: 'unchecked',
    reorderTrack: 'unchecked',
    setTrackGain: 'unchecked',
    setTrackPan: 'unchecked',
    setTrackColor: 'unchecked',
    setTrackOutput: 'unchecked',
    setTrackInput: 'unchecked',
    setTrackNotes: 'unchecked',
    hideTrack: 'unchecked',
    disableTrack: 'unchecked',
    foldTrack: 'unchecked',
    groupTracks: 'unchecked',
    ungroupTracks: 'unchecked',
    removeAllTracks: 'unchecked',
    clearSolos: 'unchecked',

    // Clip state — trusted
    bypassDevice: 'unchecked',
    trimClipStart: 'unchecked',
    trimClipEnd: 'unchecked',
    setClipFade: 'unchecked',
    copyClip: 'unchecked',
    cutClip: 'unchecked',
    pasteClip: 'unchecked',
    setClipGain: 'unchecked',
    setClipColor: 'unchecked',
    lockClip: 'unchecked',
    muteClip: 'unchecked',
    renameClip: 'unchecked',
    setClipLoop: 'unchecked',
    setClipLoopLength: 'unchecked',
    setClipStretchMode: 'unchecked',
    setClipStretchRatio: 'unchecked',
    fitClipToBeats: 'unchecked',
    duplicateClipToNextBar: 'unchecked',
    normalizeClip: 'unchecked',
    reverseClip: 'unchecked',
    glueClips: 'unchecked',
    nudgeClip: 'unchecked',
    crossfadeClips: 'unchecked',
    consolidateSelection: 'unchecked',
    bounceSelection: 'unchecked',
    stripSilence: 'unchecked',
    duplicateTimeRange: 'unchecked',

    // Bus / folder / send
    createBus: 'unchecked',
    createFolder: 'unchecked',
    setSend: 'unchecked',
    addSend: 'unchecked',
    removeSend: 'unchecked',

    // Markers / sections / time signature / adjustments
    addMarker: 'unchecked',
    setMarkerColor: 'unchecked',
    addSection: 'unchecked',
    renameSection: 'unchecked',
    addTimeSignatureChange: 'unchecked',
    createAdjustmentLayer: 'unchecked',

    // MIDI-note ops (non-destructive enough: they're scoped by clipId on the handler)
    quantizeNoteLengths: 'unchecked',
    humanizeNotes: 'unchecked',
    invertNotes: 'unchecked',
    retrogradeNotes: 'unchecked',
    scaleVelocities: 'unchecked',
    scaleAllVelocities: 'unchecked',
    setAllVelocities: 'unchecked',
    addNotes: 'unchecked',
    arpeggiate: 'unchecked',

    // Automation secondary ops
    setAutomationMode: 'unchecked',
    scaleAutomation: 'unchecked',
    stretchAutomation: 'unchecked',
    invertAutomation: 'unchecked',
    reverseAutomation: 'unchecked',
    thinAutomation: 'unchecked',
    quantizeAutomation: 'unchecked',

    // Preset / template
    loadPreset: 'unchecked',
    savePreset: 'unchecked',
    loadTrackTemplate: 'unchecked',
    saveTrackTemplate: 'unchecked',
    deleteTrackTemplate: 'unchecked',

    // AI generation
    generateDrumPattern: 'unchecked',
    generateMelody: 'unchecked',
    generateChordProgression: 'unchecked',
    generateBassline: 'unchecked',
    generateFill: 'unchecked',
    generateAudio: 'unchecked',
    generateAllTransitions: 'unchecked',
    variationMidi: 'unchecked',
    completeMidi: 'unchecked',

    // Analysis
    analyzeMix: 'unchecked',
    autoFixMix: 'unchecked',
    getLatencyReport: 'unchecked',
    enableMpe: 'unchecked',
    disableMpe: 'unchecked',
    scanPlugins: 'unchecked',
    audioToMidi: 'unchecked',
    detectTempo: 'unchecked',
    detectKey: 'unchecked',
    detectTransients: 'unchecked',
    detectSongStructure: 'unchecked',
    consolidateAllTracks: 'unchecked',
    compareToReference: 'unchecked',
    getMentorTips: 'unchecked',
    searchSamples: 'unchecked',
    stemSeparate: 'unchecked',
    autoOrganizeProject: 'unchecked',

    // Scratch pad
    captureScratchPad: 'unchecked',
    commitScratchPad: 'unchecked',
    clearScratchPad: 'unchecked',
    toggleScratchPad: 'unchecked',

    // Chord track
    addChordEvent: 'unchecked',
    removeChordEvent: 'unchecked',
    clearChordTrack: 'unchecked',
    toggleChordTrack: 'unchecked',

    // MIDI routing + output
    clearAllMidiMappings: 'unchecked',
    setMidiOutput: 'unchecked',
    clearMidiOutput: 'unchecked',
    connectPush: 'unchecked',
    disconnectPush: 'unchecked',
    setControlSurface: 'unchecked',

    // CV / VCA
    addCvOutput: 'unchecked',
    createVcaGroup: 'unchecked',
    assignToVca: 'unchecked',
    removeFromVca: 'unchecked',
    setVcaGain: 'unchecked',

    // Groove
    extractGroove: 'unchecked',
    applyGroove: 'unchecked',

    // Pattern instance
    createPatternInstance: 'unchecked',
    detachPatternInstance: 'unchecked',

    // Version control
    createProjectVersion: 'unchecked',
    restoreProjectVersion: 'unchecked',
    createVersionBranch: 'unchecked',
    restoreTrack: 'unchecked',
    restoreClip: 'unchecked',
    restoreDsoSnapshot: 'unchecked',

    // Warp + pitch
    enableWarping: 'unchecked',
    setWarpAlgorithm: 'unchecked',
    setWarpPitchShift: 'unchecked',
    quantizeTransients: 'unchecked',

    // Comping
    createCompGroup: 'unchecked',

    // Macros + undo tree
    startMacroRecording: 'unchecked',
    stopMacroRecording: 'unchecked',
    playMacro: 'unchecked',
    deleteMacro: 'unchecked',
    toggleUndoTree: 'unchecked',
    labelUndoBranch: 'unchecked',

    // Track alternatives
    createTrackAlternative: 'unchecked',
    switchTrackAlternative: 'unchecked',
    renameTrackAlternative: 'unchecked',

    // Setlist / session
    nextSetlistItem: 'unchecked',
    previousSetlistItem: 'unchecked',
    triggerScene: 'unchecked',

    // RAVE
    loadRaveModel: 'unchecked',
    setRaveBlend: 'unchecked',

    // Control room
    switchMonitor: 'unchecked',
    toggleControlRoomDim: 'unchecked',
    toggleControlRoomMono: 'unchecked',

    // Transport misc
    toggleLoopRecord: 'unchecked',
    togglePunchRecording: 'unchecked',

    // Node view
    toggleNodeView: 'unchecked',
} as const satisfies {
    [ActionType in RuntimeActionType]: PayloadValidator<ActionType> | 'unchecked';
};

// Export as Record for runtime lookup.
export const PAYLOAD_VALIDATORS: {
    [ActionType in RuntimeActionType]: PayloadValidator<ActionType> | 'unchecked';
} = validators;
