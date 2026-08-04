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
import { normalizeSafeProjectName } from '../validators/normalizeSafeProjectName';

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
function isNonEmptyString(value: unknown): value is string {
    return isString(value) && value.trim().length > 0;
}
function isNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}
function isInRange(value: unknown, min: number, max: number): value is number {
    return isNumber(value) && value >= min && value <= max;
}
function isPositiveNumber(value: unknown): value is number {
    return isNumber(value) && value > 0;
}
function isNonNegativeNumber(value: unknown): value is number {
    return isNumber(value) && value >= 0;
}
function isOptional<Value>(value: unknown, check: (value: unknown) => value is Value): value is Value | undefined {
    return value === undefined || check(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.includes(key));
}

function isAutomationCurve(
    value: unknown
): value is 'linear' | 'step' | 'exponential' | 's-curve' | 'stairs' | 'smooth' | 'bezier' {
    return (
        value === 'linear' ||
        value === 'step' ||
        value === 'exponential' ||
        value === 's-curve' ||
        value === 'stairs' ||
        value === 'smooth' ||
        value === 'bezier'
    );
}

function isAutomationControlPoint(value: unknown): value is { x: number; y: number } {
    return isObj(value) && hasExactKeys(value, ['x', 'y']) && isInRange(value.x, 0, 1) && isInRange(value.y, 0, 1);
}

function isUniqueNonEmptyStringArray(value: unknown): value is string[] {
    if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
        return false;
    }

    return new Set(value).size === value.length;
}

function hasFinitePunchBeat(param: unknown): param is PayloadOf<'setPunchIn'> {
    return isObj(param) && hasExactKeys(param, ['beat']) && isNumber(param.beat);
}

function hasNoPayload(value: unknown): value is undefined {
    return value === undefined;
}

// ── Validators (destructive / high-risk actions) ─────────────────────────

function hasTrackId(param: unknown): param is { trackId: string } {
    return isObj(param) && isString(param.trackId);
}
function hasClipId(param: unknown): param is { clipId: string } {
    return isObj(param) && hasExactKeys(param, ['clipId']) && isNonEmptyString(param.clipId);
}
function isAddNotesNote(param: unknown): param is PayloadOf<'addNotes'>['notes'][number] {
    return (
        isObj(param) &&
        hasOnlyKeys(param, ['pitch', 'startBeat', 'duration', 'velocity']) &&
        Object.hasOwn(param, 'pitch') &&
        Object.hasOwn(param, 'startBeat') &&
        Object.hasOwn(param, 'duration') &&
        isInRange(param.pitch, 0, 127) &&
        isNonNegativeNumber(param.startBeat) &&
        isPositiveNumber(param.duration) &&
        isOptional(param.velocity, (value): value is number => isInRange(value, 1, 127))
    );
}

const validators = {
    // Track lifecycle
    addTrack: (param): param is PayloadOf<'addTrack'> => isObj(param) && isString(param.name) && isString(param.kind),
    removeTrack: (param): param is PayloadOf<'removeTrack'> =>
        isObj(param) && hasExactKeys(param, ['trackId']) && isNonEmptyString(param.trackId),
    renameTrack: (param): param is PayloadOf<'renameTrack'> =>
        isObj(param) && isString(param.trackId) && isString(param.name),
    duplicateTrack: hasTrackId,
    deleteTrackAlternative: (param): param is PayloadOf<'deleteTrackAlternative'> =>
        isObj(param) && isString(param.trackId) && isString(param.alternativeId),
    freezeTrack: hasTrackId,
    unfreezeTrack: hasTrackId,
    flattenTrack: hasTrackId,
    bounceInPlace: hasTrackId,
    bounceToNewTrack: hasTrackId,

    // Clip lifecycle
    addClip: (param): param is PayloadOf<'addClip'> =>
        isObj(param) &&
        hasOnlyKeys(param, ['trackId', 'startBeat', 'endBeat', 'name', 'type', 'audioBufferId']) &&
        isNonEmptyString(param.trackId) &&
        isNumber(param.startBeat) &&
        isNumber(param.endBeat) &&
        isString(param.name) &&
        isOptional(param.type, (value): value is 'audio' | 'midi' => value === 'audio' || value === 'midi') &&
        isOptional(param.audioBufferId, isString),
    removeClip: hasClipId,
    splitClip: (param): param is PayloadOf<'splitClip'> =>
        isObj(param) && isString(param.clipId) && isNumber(param.beat),
    moveClip: (param): param is PayloadOf<'moveClip'> =>
        isObj(param) && isString(param.clipId) && isString(param.trackId) && isNumber(param.startBeat),
    duplicateClip: hasClipId,

    // Device lifecycle
    addDevice: (param): param is PayloadOf<'addDevice'> =>
        isObj(param) &&
        hasExactKeys(param, ['trackId', 'deviceType']) &&
        isNonEmptyString(param.trackId) &&
        isNonEmptyString(param.deviceType),
    removeDevice: (param): param is PayloadOf<'removeDevice'> =>
        isObj(param) && hasExactKeys(param, ['deviceId']) && isNonEmptyString(param.deviceId),
    setDeviceParameter: (param): param is PayloadOf<'setDeviceParameter'> =>
        isObj(param) && isString(param.deviceId) && isString(param.paramId) && isNumber(param.value),
    loadExternalPlugin: (param): param is PayloadOf<'loadExternalPlugin'> => isObj(param) && isString(param.pluginPath),

    // Transport (pre-existing range checks from §91)
    setTempo: (param): param is PayloadOf<'setTempo'> => isObj(param) && isInRange(param.bpm, 20, 300),
    setTimeSignature: (param): param is PayloadOf<'setTimeSignature'> =>
        isObj(param) &&
        isInRange(param.numerator, 1, 32) &&
        (param.denominator === 2 || param.denominator === 4 || param.denominator === 8 || param.denominator === 16),
    setMasterGain: (param): param is PayloadOf<'setMasterGain'> => isObj(param) && isInRange(param.gain, 0, 1),
    setMetronomeVolume: (param): param is PayloadOf<'setMetronomeVolume'> =>
        isObj(param) && hasExactKeys(param, ['volume']) && isInRange(param.volume, 0, 1),
    setLoopEnabled: (param): param is PayloadOf<'setLoopEnabled'> =>
        isObj(param) && hasExactKeys(param, ['enabled']) && typeof param.enabled === 'boolean',
    setMetronomeEnabled: (param): param is PayloadOf<'setMetronomeEnabled'> =>
        isObj(param) && hasExactKeys(param, ['enabled']) && typeof param.enabled === 'boolean',
    setLoopRegion: (param): param is PayloadOf<'setLoopRegion'> =>
        isObj(param) &&
        hasExactKeys(param, ['startBeat', 'endBeat']) &&
        isNonNegativeNumber(param.startBeat) &&
        isPositiveNumber(param.endBeat) &&
        param.endBeat > param.startBeat,
    restoreLoopRegion: (param): param is PayloadOf<'restoreLoopRegion'> =>
        isObj(param) &&
        hasExactKeys(param, ['loopStart', 'loopEnd', 'isLooping']) &&
        isNonNegativeNumber(param.loopStart) &&
        isNonNegativeNumber(param.loopEnd) &&
        param.loopEnd >= param.loopStart &&
        typeof param.isLooping === 'boolean' &&
        (!param.isLooping || param.loopEnd > param.loopStart),

    // Automation
    addAutomationLane: (param): param is PayloadOf<'addAutomationLane'> =>
        isObj(param) &&
        hasExactKeys(param, ['trackId', 'parameterId', 'parameterName']) &&
        isNonEmptyString(param.trackId) &&
        isNonEmptyString(param.parameterId) &&
        isNonEmptyString(param.parameterName),
    addAutomationPoint: (param): param is PayloadOf<'addAutomationPoint'> =>
        isObj(param) &&
        hasOnlyKeys(param, ['laneId', 'beat', 'value', 'curve', 'tension', 'stairSteps', 'cp1', 'cp2']) &&
        Object.hasOwn(param, 'laneId') &&
        Object.hasOwn(param, 'beat') &&
        Object.hasOwn(param, 'value') &&
        isNonEmptyString(param.laneId) &&
        isNonNegativeNumber(param.beat) &&
        isNumber(param.value) &&
        isOptional(param.curve, isAutomationCurve) &&
        isOptional(param.tension, (value): value is number => isInRange(value, -1, 1)) &&
        isOptional(param.stairSteps, (value): value is number => isInRange(value, 2, 32) && Number.isInteger(value)) &&
        isOptional(param.cp1, isAutomationControlPoint) &&
        isOptional(param.cp2, isAutomationControlPoint),
    setAutomationLaneEnabled: (param): param is PayloadOf<'setAutomationLaneEnabled'> =>
        isObj(param) &&
        hasExactKeys(param, ['laneId', 'enabled']) &&
        isNonEmptyString(param.laneId) &&
        typeof param.enabled === 'boolean',
    removeAutomationPoint: (param): param is PayloadOf<'removeAutomationPoint'> =>
        isObj(param) &&
        hasExactKeys(param, ['laneId', 'pointIndex']) &&
        isNonEmptyString(param.laneId) &&
        isNonNegativeNumber(param.pointIndex) &&
        Number.isInteger(param.pointIndex),

    // Sidechain routing
    addSidechainRoute: (param): param is PayloadOf<'addSidechainRoute'> =>
        isObj(param) &&
        hasExactKeys(param, ['sourceTrackId', 'targetTrackId']) &&
        isNonEmptyString(param.sourceTrackId) &&
        isNonEmptyString(param.targetTrackId) &&
        param.sourceTrackId !== param.targetTrackId,
    removeSidechainRoute: (param): param is PayloadOf<'removeSidechainRoute'> =>
        isObj(param) &&
        hasExactKeys(param, ['sourceTrackId', 'targetTrackId']) &&
        isNonEmptyString(param.sourceTrackId) &&
        isNonEmptyString(param.targetTrackId) &&
        param.sourceTrackId !== param.targetTrackId,

    // MIDI note batch ops
    quantizeNotes: (param): param is PayloadOf<'quantizeNotes'> =>
        isObj(param) &&
        hasExactKeys(param, ['clipId', 'gridSize']) &&
        isNonEmptyString(param.clipId) &&
        isPositiveNumber(param.gridSize) &&
        param.gridSize <= 64,
    transposeNotes: (param): param is PayloadOf<'transposeNotes'> =>
        isObj(param) &&
        hasExactKeys(param, ['clipId', 'semitones']) &&
        isNonEmptyString(param.clipId) &&
        isInRange(param.semitones, -127, 127) &&
        Number.isInteger(param.semitones) &&
        param.semitones !== 0,
    invertNotes: (param): param is PayloadOf<'invertNotes'> =>
        isObj(param) && hasExactKeys(param, ['clipId']) && isNonEmptyString(param.clipId),
    retrogradeNotes: (param): param is PayloadOf<'retrogradeNotes'> =>
        isObj(param) && hasExactKeys(param, ['clipId']) && isNonEmptyString(param.clipId),
    quantizeNoteLengths: (param): param is PayloadOf<'quantizeNoteLengths'> =>
        isObj(param) &&
        hasExactKeys(param, ['clipId', 'gridSize']) &&
        isNonEmptyString(param.clipId) &&
        isInRange(param.gridSize, 0.03125, 64),
    scaleAllVelocities: (param): param is PayloadOf<'scaleAllVelocities'> =>
        isObj(param) &&
        hasExactKeys(param, ['clipId', 'factor']) &&
        isNonEmptyString(param.clipId) &&
        isPositiveNumber(param.factor) &&
        param.factor <= 16 &&
        param.factor !== 1,
    setAllVelocities: (param): param is PayloadOf<'setAllVelocities'> =>
        isObj(param) &&
        hasExactKeys(param, ['clipId', 'velocity']) &&
        isNonEmptyString(param.clipId) &&
        isInRange(param.velocity, 1, 127) &&
        Number.isInteger(param.velocity),

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
    // importAudioFile / importMidiFile carry no payload (`payload?: undefined`):
    // the file is chosen via a native picker in the handler, so there is no
    // LLM-controlled field to validate. Marked 'unchecked' rather than running
    // a guard that rejects every legitimate (undefined) payload.
    importAudioFile: 'unchecked',
    importMidiFile: 'unchecked',
    exportProject: (param): param is PayloadOf<'exportProject'> => isObj(param) && isOptional(param.format, isString),
    exportMidi: (param): param is PayloadOf<'exportMidi'> => isObj(param) && isString(param.clipId),
    exportDawProject: 'unchecked',
    saveProject: 'unchecked',
    newProject: 'unchecked',

    // Collaboration lifecycle
    createCollabSession: 'unchecked',
    joinCollabSession: (param): param is PayloadOf<'joinCollabSession'> =>
        isObj(param) && isString(param.inviteString) && isString(param.peerName),
    leaveCollabSession: 'unchecked',

    // UI / workspace toggles — no payload validation needed for legacy view
    // state only actions. New payloadless AI-reachable meta actions still get
    // an explicit undefined guard so malformed model output is rejected.
    openPreferencesDialog: hasNoPayload,
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
    setPunchIn: hasFinitePunchBeat,
    setPunchOut: hasFinitePunchBeat,
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
    setSoloSafe: (param): param is PayloadOf<'setSoloSafe'> =>
        isObj(param) &&
        hasExactKeys(param, ['trackId', 'soloSafe']) &&
        isNonEmptyString(param.trackId) &&
        typeof param.soloSafe === 'boolean',
    toggleSoloSafe: 'unchecked',
    armTrack: (param): param is PayloadOf<'armTrack'> =>
        isObj(param) &&
        hasExactKeys(param, ['trackId', 'armed']) &&
        isNonEmptyString(param.trackId) &&
        typeof param.armed === 'boolean',
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
    clearSolos: hasNoPayload,

    // Clip state
    bypassDevice: 'unchecked',
    trimClipStart: (param): param is PayloadOf<'trimClipStart'> =>
        isObj(param) &&
        hasExactKeys(param, ['clipId', 'newStartBeat']) &&
        isNonEmptyString(param.clipId) &&
        isNonNegativeNumber(param.newStartBeat),
    trimClipEnd: (param): param is PayloadOf<'trimClipEnd'> =>
        isObj(param) &&
        hasExactKeys(param, ['clipId', 'newEndBeat']) &&
        isNonEmptyString(param.clipId) &&
        isPositiveNumber(param.newEndBeat),
    setClipFade: (param): param is PayloadOf<'setClipFade'> =>
        isObj(param) &&
        hasExactKeys(param, ['clipId', 'fadeInBeats', 'fadeOutBeats']) &&
        isNonEmptyString(param.clipId) &&
        isNonNegativeNumber(param.fadeInBeats) &&
        isNonNegativeNumber(param.fadeOutBeats),
    copyClip: 'unchecked',
    cutClip: 'unchecked',
    pasteClip: 'unchecked',
    setClipGain: (param): param is PayloadOf<'setClipGain'> =>
        isObj(param) &&
        hasExactKeys(param, ['clipId', 'gain']) &&
        isNonEmptyString(param.clipId) &&
        isInRange(param.gain, 0, 2),
    setClipColor: (param): param is PayloadOf<'setClipColor'> =>
        isObj(param) &&
        hasExactKeys(param, ['clipId', 'color']) &&
        isNonEmptyString(param.clipId) &&
        isString(param.color) &&
        /^#[\dA-Fa-f]{6}$/.test(param.color),
    lockClip: (param): param is PayloadOf<'lockClip'> =>
        isObj(param) &&
        hasExactKeys(param, ['clipId', 'locked']) &&
        isNonEmptyString(param.clipId) &&
        typeof param.locked === 'boolean',
    muteClip: (param): param is PayloadOf<'muteClip'> =>
        isObj(param) &&
        hasExactKeys(param, ['clipId', 'muted']) &&
        isNonEmptyString(param.clipId) &&
        typeof param.muted === 'boolean',
    renameClip: (param): param is PayloadOf<'renameClip'> =>
        isObj(param) &&
        hasExactKeys(param, ['clipId', 'name']) &&
        isNonEmptyString(param.clipId) &&
        normalizeSafeProjectName(param.name) !== null,
    setClipLoop: (param): param is PayloadOf<'setClipLoop'> =>
        isObj(param) &&
        hasExactKeys(param, ['clipId', 'enabled']) &&
        isNonEmptyString(param.clipId) &&
        typeof param.enabled === 'boolean',
    setClipLoopLength: 'unchecked',
    setClipStretchMode: 'unchecked',
    setClipStretchRatio: 'unchecked',
    fitClipToBeats: 'unchecked',
    duplicateClipToNextBar: hasClipId,
    normalizeClip: 'unchecked',
    reverseClip: 'unchecked',
    glueClips: 'unchecked',
    nudgeClip: (param): param is PayloadOf<'nudgeClip'> =>
        isObj(param) &&
        hasExactKeys(param, ['clipId', 'beats']) &&
        isNonEmptyString(param.clipId) &&
        isNumber(param.beats) &&
        param.beats !== 0,
    crossfadeClips: 'unchecked',
    consolidateSelection: 'unchecked',
    bounceSelection: 'unchecked',
    stripSilence: 'unchecked',
    duplicateTimeRange: 'unchecked',

    // Bus / folder / send
    createBus: (param): param is PayloadOf<'createBus'> =>
        isObj(param) && hasExactKeys(param, ['name']) && normalizeSafeProjectName(param.name) !== null,
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
    humanizeNotes: 'unchecked',
    scaleVelocities: 'unchecked',
    addNotes: (param): param is PayloadOf<'addNotes'> =>
        isObj(param) &&
        hasExactKeys(param, ['clipId', 'notes']) &&
        isNonEmptyString(param.clipId) &&
        Array.isArray(param.notes) &&
        param.notes.length > 0 &&
        param.notes.every(isAddNotesNote),
    arpeggiate: 'unchecked',

    // Automation secondary ops
    setAutomationMode: (param): param is PayloadOf<'setAutomationMode'> =>
        isObj(param) &&
        hasExactKeys(param, ['trackId', 'mode']) &&
        isNonEmptyString(param.trackId) &&
        (param.mode === 'read' ||
            param.mode === 'write' ||
            param.mode === 'touch' ||
            param.mode === 'latch' ||
            param.mode === 'off'),
    scaleAutomation: (param): param is PayloadOf<'scaleAutomation'> =>
        isObj(param) &&
        hasExactKeys(param, ['laneId', 'factor']) &&
        isNonEmptyString(param.laneId) &&
        isInRange(param.factor, Number.MIN_VALUE, 16),
    stretchAutomation: (param): param is PayloadOf<'stretchAutomation'> =>
        isObj(param) &&
        hasExactKeys(param, ['laneId', 'factor']) &&
        isNonEmptyString(param.laneId) &&
        isInRange(param.factor, Number.MIN_VALUE, 16),
    invertAutomation: (param): param is PayloadOf<'invertAutomation'> =>
        isObj(param) && hasExactKeys(param, ['laneId']) && isNonEmptyString(param.laneId),
    reverseAutomation: (param): param is PayloadOf<'reverseAutomation'> =>
        isObj(param) && hasExactKeys(param, ['laneId']) && isNonEmptyString(param.laneId),
    thinAutomation: (param): param is PayloadOf<'thinAutomation'> =>
        isObj(param) &&
        hasOnlyKeys(param, ['laneId', 'tolerance']) &&
        Object.hasOwn(param, 'laneId') &&
        isNonEmptyString(param.laneId) &&
        isOptional(param.tolerance, isPositiveNumber),
    quantizeAutomation: (param): param is PayloadOf<'quantizeAutomation'> =>
        isObj(param) &&
        hasExactKeys(param, ['laneId', 'gridSize']) &&
        isNonEmptyString(param.laneId) &&
        isInRange(param.gridSize, Number.MIN_VALUE, 64),
    // Internal inverse-only actions (emitted by handlers' describe(), never by the AI).
    restoreAutomationLanePoints: 'unchecked',

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
    createVcaGroup: (param): param is PayloadOf<'createVcaGroup'> =>
        isObj(param) &&
        hasExactKeys(param, ['name', 'trackIds']) &&
        isNonEmptyString(param.name) &&
        isUniqueNonEmptyStringArray(param.trackIds),
    assignToVca: (param): param is PayloadOf<'assignToVca'> =>
        isObj(param) &&
        hasExactKeys(param, ['trackId', 'vcaGroupId']) &&
        isNonEmptyString(param.trackId) &&
        isNonEmptyString(param.vcaGroupId),
    removeFromVca: (param): param is PayloadOf<'removeFromVca'> =>
        isObj(param) && hasExactKeys(param, ['trackId']) && isNonEmptyString(param.trackId),
    setVcaGain: (param): param is PayloadOf<'setVcaGain'> =>
        isObj(param) &&
        hasExactKeys(param, ['vcaGroupId', 'gain']) &&
        isNonEmptyString(param.vcaGroupId) &&
        isInRange(param.gain, 0, 2),

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
    undo: hasNoPayload,
    redo: hasNoPayload,
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
