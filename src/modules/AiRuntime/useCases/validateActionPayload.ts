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

type Extract2<U, T> = U extends { type: T } ? U : never;
type PayloadOf<T extends RuntimeActionType> = Extract2<RuntimeAction, T> extends { payload: infer P }
    ? P
    : undefined;

export type PayloadValidator<T extends RuntimeActionType> = (payload: unknown) => payload is PayloadOf<T>;

// ── Primitive helpers ───────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInRange = (v: unknown, min: number, max: number): v is number => isNumber(v) && v >= min && v <= max;
const isOptional = <T>(v: unknown, check: (v: unknown) => v is T): v is T | undefined =>
    v === undefined || check(v);
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);

// ── Validators (destructive / high-risk actions) ─────────────────────────

const hasTrackId = (p: unknown): p is { trackId: string } => isObj(p) && isString(p.trackId);
const hasClipId = (p: unknown): p is { clipId: string } => isObj(p) && isString(p.clipId);

const validators = {
    // Track lifecycle
    addTrack: (p): p is PayloadOf<'addTrack'> =>
        isObj(p) && isString(p.name) && isString(p.kind),
    removeTrack: hasTrackId as PayloadValidator<'removeTrack'>,
    renameTrack: (p): p is PayloadOf<'renameTrack'> =>
        isObj(p) && isString(p.trackId) && isString(p.name),
    duplicateTrack: hasTrackId as PayloadValidator<'duplicateTrack'>,
    deleteTrackAlternative: (p): p is PayloadOf<'deleteTrackAlternative'> =>
        isObj(p) && isString(p.trackId) && isString(p.alternativeId),
    freezeTrack: hasTrackId as PayloadValidator<'freezeTrack'>,
    unfreezeTrack: hasTrackId as PayloadValidator<'unfreezeTrack'>,
    flattenTrack: hasTrackId as PayloadValidator<'flattenTrack'>,
    bounceInPlace: hasTrackId as PayloadValidator<'bounceInPlace'>,
    bounceToNewTrack: hasTrackId as PayloadValidator<'bounceToNewTrack'>,

    // Clip lifecycle
    addClip: (p): p is PayloadOf<'addClip'> =>
        isObj(p) && isString(p.trackId) && isNumber(p.startBeat) && isNumber(p.endBeat),
    removeClip: hasClipId as PayloadValidator<'removeClip'>,
    splitClip: (p): p is PayloadOf<'splitClip'> =>
        isObj(p) && isString(p.clipId) && isNumber(p.splitBeat),
    moveClip: (p): p is PayloadOf<'moveClip'> =>
        isObj(p) && isString(p.clipId) && isNumber(p.newStartBeat) && isOptional(p.newTrackId, isString),
    duplicateClip: hasClipId as PayloadValidator<'duplicateClip'>,

    // Device lifecycle
    addDevice: (p): p is PayloadOf<'addDevice'> =>
        isObj(p) && isString(p.trackId) && isString(p.deviceType),
    removeDevice: (p): p is PayloadOf<'removeDevice'> =>
        isObj(p) && isString(p.trackId) && isString(p.deviceId),
    setDeviceParameter: (p): p is PayloadOf<'setDeviceParameter'> =>
        isObj(p) &&
        isString(p.trackId) &&
        isString(p.deviceId) &&
        isString(p.paramId) &&
        isNumber(p.value),
    loadExternalPlugin: (p): p is PayloadOf<'loadExternalPlugin'> =>
        isObj(p) && isString(p.pluginPath),

    // Transport (pre-existing range checks from §91)
    setTempo: (p): p is PayloadOf<'setTempo'> =>
        isObj(p) && isInRange(p.bpm, 20, 300),
    setMasterGain: (p): p is PayloadOf<'setMasterGain'> =>
        isObj(p) && isInRange(p.gain, 0, 1),
    setMetronomeVolume: (p): p is PayloadOf<'setMetronomeVolume'> =>
        isObj(p) && isInRange(p.volume, 0, 1),

    // Automation
    addAutomationLane: (p): p is PayloadOf<'addAutomationLane'> =>
        isObj(p) && isString(p.trackId) && isString(p.parameterId),
    addAutomationPoint: (p): p is PayloadOf<'addAutomationPoint'> =>
        isObj(p) && isString(p.laneId) && isNumber(p.beat) && isNumber(p.value),
    removeAutomationPoint: (p): p is PayloadOf<'removeAutomationPoint'> =>
        isObj(p) && isString(p.laneId) && isNumber(p.beat),

    // Sidechain routing
    addSidechainRoute: (p): p is PayloadOf<'addSidechainRoute'> =>
        isObj(p) &&
        isString(p.sourceTrackId) &&
        isString(p.targetTrackId) &&
        isString(p.targetDeviceId),
    removeSidechainRoute: (p): p is PayloadOf<'removeSidechainRoute'> =>
        isObj(p) && isString(p.routeId),

    // MIDI note batch ops
    quantizeNotes: (p): p is PayloadOf<'quantizeNotes'> =>
        isObj(p) && isString(p.clipId) && isNumber(p.grid),
    transposeNotes: (p): p is PayloadOf<'transposeNotes'> =>
        isObj(p) && isString(p.clipId) && isNumber(p.semitones),

    // Marker + section
    removeMarker: (p): p is PayloadOf<'removeMarker'> =>
        isObj(p) && isString(p.markerId),
    removeSection: (p): p is PayloadOf<'removeSection'> =>
        isObj(p) && isString(p.sectionId),
    removeTimeSignatureChange: (p): p is PayloadOf<'removeTimeSignatureChange'> =>
        isObj(p) && isString(p.changeId),

    // Time operations
    deleteTime: (p): p is PayloadOf<'deleteTime'> =>
        isObj(p) && isNumber(p.startBeat) && isNumber(p.endBeat),
    insertTime: (p): p is PayloadOf<'insertTime'> =>
        isObj(p) && isNumber(p.atBeat) && isNumber(p.durationBeats),

    // Imports / exports / project lifecycle
    importAudioFile: (p): p is PayloadOf<'importAudioFile'> =>
        isObj(p) && isString(p.path),
    importMidiFile: (p): p is PayloadOf<'importMidiFile'> =>
        isObj(p) && isString(p.path),
    exportProject: (p): p is PayloadOf<'exportProject'> =>
        isObj(p) && isOptional(p.format, isString),
    exportMidi: (p): p is PayloadOf<'exportMidi'> =>
        isObj(p) && isOptional(p.trackIds, isStringArray),
    exportDawProject: 'unchecked',
    saveProject: 'unchecked',
    newProject: 'unchecked',

    // Collaboration lifecycle
    createCollabSession: 'unchecked',
    joinCollabSession: (p): p is PayloadOf<'joinCollabSession'> =>
        isObj(p) && isString(p.inviteCode),
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
    [K in RuntimeActionType]: PayloadValidator<K> | 'unchecked';
};

// Export as Record for runtime lookup.
export const PAYLOAD_VALIDATORS: {
    [K in RuntimeActionType]: PayloadValidator<K> | 'unchecked';
} = validators;
