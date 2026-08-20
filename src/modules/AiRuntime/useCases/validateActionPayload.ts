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
import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';
import { MIN_CLIP_LOOP_LENGTH_BEATS } from '#/utils/clipLoopProjection';
import { resolveMarkerColorName } from '#/utils/markerColorPalette';

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
function isNonEmptyStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(isNonEmptyString);
}
function isSafeTrackColor(value: unknown): value is string {
    return isString(value) && /^#[\dA-Fa-f]{6}$/.test(value);
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

function isOptionalOwn<Value>(
    object: Record<string, unknown>,
    key: string,
    check: (value: unknown) => value is Value
): boolean {
    if (!Object.hasOwn(object, key)) {
        return !(key in object);
    }

    return isOptional(object[key], check);
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

function hasValidPunchInBeat(param: unknown): param is PayloadOf<'setPunchIn'> {
    return (
        isObj(param) &&
        hasExactKeys(param, ['beat']) &&
        isNumber(param.beat) &&
        param.beat >= 0 &&
        param.beat < Number.MAX_VALUE
    );
}

function hasValidPunchOutBeat(param: unknown): param is PayloadOf<'setPunchOut'> {
    return (
        isObj(param) &&
        hasExactKeys(param, ['beat']) &&
        isNumber(param.beat) &&
        param.beat > 0 &&
        param.beat <= Number.MAX_VALUE
    );
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

const STEM_IMPORT_ROLES = new Set([
    'kick',
    'snare',
    'hi-hat',
    'tom',
    'percussion',
    'bass',
    'guitar-left',
    'guitar-right',
    'keys',
    'synth',
    'lead-vocal',
    'backing-vocal',
    'fx',
    'other',
]);

function isStemImportAssignment(value: unknown): boolean {
    return (
        isObj(value) &&
        hasExactKeys(value, ['stemId', 'role']) &&
        isNonEmptyString(value.stemId) &&
        isNonEmptyString(value.role) &&
        STEM_IMPORT_ROLES.has(value.role)
    );
}

const validators = {
    // Track lifecycle
    importStemSet: (param): param is PayloadOf<'importStemSet'> =>
        isObj(param) &&
        hasExactKeys(param, ['selectionId', 'groupName', 'stems']) &&
        isNonEmptyString(param.selectionId) &&
        isNonEmptyString(param.groupName) &&
        param.groupName.length <= 80 &&
        Array.isArray(param.stems) &&
        param.stems.length >= 2 &&
        param.stems.length <= 32 &&
        param.stems.every(isStemImportAssignment),
    addTrack: (param): param is PayloadOf<'addTrack'> => isObj(param) && isString(param.name) && isString(param.kind),
    removeTrack: (param): param is PayloadOf<'removeTrack'> =>
        isObj(param) &&
        hasOnlyKeys(param, [
            'trackId',
            'expectedKind',
            'expectedMuted',
            'expectedClipIds',
            'expectedAlternativeClipIds',
            'expectedVcaGroupId',
            'expectedVcaMembershipGroupIds',
        ]) &&
        Object.hasOwn(param, 'trackId') &&
        isNonEmptyString(param.trackId) &&
        isOptional(
            param.expectedKind,
            (value): value is NonNullable<PayloadOf<'removeTrack'>['expectedKind']> =>
                value === 'audio' || value === 'midi' || value === 'bus' || value === 'master' || value === 'folder'
        ) &&
        isOptional(param.expectedMuted, (value): value is boolean => typeof value === 'boolean') &&
        isOptional(
            param.expectedClipIds,
            (value): value is readonly string[] => Array.isArray(value) && value.every(isNonEmptyString)
        ) &&
        isOptional(
            param.expectedAlternativeClipIds,
            (value): value is readonly string[] => Array.isArray(value) && value.every(isNonEmptyString)
        ) &&
        isOptional(
            param.expectedVcaGroupId,
            (value): value is string | null => value === null || isNonEmptyString(value)
        ) &&
        isOptional(
            param.expectedVcaMembershipGroupIds,
            (value): value is readonly string[] => Array.isArray(value) && value.every(isNonEmptyString)
        ),
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
        hasOnlyKeys(param, ['trackId', 'startBeat', 'endBeat', 'name', 'type']) &&
        isNonEmptyString(param.trackId) &&
        isNonNegativeNumber(param.startBeat) &&
        isNumber(param.endBeat) &&
        param.endBeat > param.startBeat &&
        normalizeSafeProjectName(param.name) !== null &&
        isOptional(param.type, (value): value is 'midi' => value === 'midi'),
    removeClip: hasClipId,
    splitClip: (param): param is PayloadOf<'splitClip'> =>
        isObj(param) &&
        hasExactKeys(param, ['clipId', 'beat']) &&
        isNonEmptyString(param.clipId) &&
        isNonNegativeNumber(param.beat),
    moveClip: (param): param is PayloadOf<'moveClip'> =>
        isObj(param) &&
        hasExactKeys(param, ['clipId', 'trackId', 'startBeat']) &&
        isNonEmptyString(param.clipId) &&
        isNonEmptyString(param.trackId) &&
        isNonNegativeNumber(param.startBeat),
    duplicateClip: hasClipId,

    // Device lifecycle
    addDevice: (param): param is PayloadOf<'addDevice'> =>
        isObj(param) &&
        hasOnlyKeys(param, ['trackId', 'deviceType', 'afterDeviceId']) &&
        isNonEmptyString(param.trackId) &&
        isNonEmptyString(param.deviceType) &&
        isOptional(param.afterDeviceId, isNonEmptyString),
    removeDevice: (param): param is PayloadOf<'removeDevice'> =>
        isObj(param) &&
        hasOnlyKeys(param, ['deviceId', 'expectedTrackId', 'expectedDeviceIds']) &&
        isNonEmptyString(param.deviceId) &&
        isOptional(param.expectedTrackId, isNonEmptyString) &&
        isOptional(param.expectedDeviceIds, isNonEmptyStringArray),
    setDeviceParameter: (param): param is PayloadOf<'setDeviceParameter'> =>
        isObj(param) &&
        hasOnlyKeys(param, [
            'deviceId',
            'paramId',
            'value',
            'expectedTrackId',
            'expectedDeviceType',
            'expectedDeviceIds',
            'expectedValue',
            'expectedTrackFrozen',
        ]) &&
        isNonEmptyString(param.deviceId) &&
        isNonEmptyString(param.paramId) &&
        isNumber(param.value) &&
        isOptional(param.expectedTrackId, isNonEmptyString) &&
        isOptional(param.expectedDeviceType, isNonEmptyString) &&
        isOptional(param.expectedDeviceIds, isUniqueNonEmptyStringArray) &&
        isOptional(param.expectedValue, isNumber) &&
        isOptional(param.expectedTrackFrozen, (value): value is boolean => typeof value === 'boolean'),
    loadExternalPlugin: (param): param is PayloadOf<'loadExternalPlugin'> => isObj(param) && isString(param.pluginPath),

    // Transport (pre-existing range checks from §91)
    // `tempoChangeId` is internal undo/redo routing: it pins a tempo write to one
    // tempo-map event. An AI-supplied id would let a prompt edit an arbitrary
    // tempo event without naming a position, so the exact-keys check rejects it.
    setTempo: (param): param is PayloadOf<'setTempo'> =>
        isObj(param) && hasExactKeys(param, ['bpm']) && isInRange(param.bpm, 20, 300),
    setTimeSignature: (param): param is PayloadOf<'setTimeSignature'> =>
        isObj(param) &&
        isInRange(param.numerator, 1, 32) &&
        (param.denominator === 2 || param.denominator === 4 || param.denominator === 8 || param.denominator === 16),
    setPlayback: (param): param is PayloadOf<'setPlayback'> =>
        isObj(param) && hasExactKeys(param, ['playing']) && typeof param.playing === 'boolean',
    // `setMasterGain`'s `gain` is the same linear-amplitude fraction as
    // `setTrackGain`'s, not the transport store's 0–100 `masterGain` percent
    // field — `handleSetMasterGain` multiplies it by 100 before writing that
    // field, and its own `isNoop` check divides back down to compare against
    // this same fraction. The ceiling here is therefore `FADER_MAX_GAIN`
    // (≈1.9953), the fraction that maps to the percent field's own
    // `MAX_MASTER_GAIN` ceiling, not `MAX_MASTER_GAIN` itself.
    setMasterGain: (param): param is PayloadOf<'setMasterGain'> =>
        isObj(param) && hasExactKeys(param, ['gain']) && isInRange(param.gain, 0, FADER_MAX_GAIN),
    setMetronomeVolume: (param): param is PayloadOf<'setMetronomeVolume'> =>
        isObj(param) && hasExactKeys(param, ['volume']) && isInRange(param.volume, 0, 1),
    setLoopEnabled: (param): param is PayloadOf<'setLoopEnabled'> =>
        isObj(param) && hasExactKeys(param, ['enabled']) && typeof param.enabled === 'boolean',
    setMetronomeEnabled: (param): param is PayloadOf<'setMetronomeEnabled'> =>
        isObj(param) && hasExactKeys(param, ['enabled']) && typeof param.enabled === 'boolean',
    setPunchEnabled: (param): param is PayloadOf<'setPunchEnabled'> =>
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
    automateSendRange: (param): param is PayloadOf<'automateSendRange'> =>
        isObj(param) &&
        hasExactKeys(param, ['trackIds', 'busId', 'sectionName', 'reductionDb']) &&
        Array.isArray(param.trackIds) &&
        param.trackIds.length > 0 &&
        param.trackIds.every(isNonEmptyString) &&
        new Set(param.trackIds).size === param.trackIds.length &&
        isNonEmptyString(param.busId) &&
        isNonEmptyString(param.sectionName) &&
        isInRange(param.reductionDb, Number.MIN_VALUE, 60),
    automateSendRanges: (param): param is PayloadOf<'automateSendRanges'> =>
        isObj(param) &&
        hasExactKeys(param, ['trackIds', 'busId', 'sectionIds', 'tailBars', 'targetLevelDb']) &&
        isUniqueNonEmptyStringArray(param.trackIds) &&
        isNonEmptyString(param.busId) &&
        isUniqueNonEmptyStringArray(param.sectionIds) &&
        isInRange(param.tailBars, 1, 16) &&
        Number.isInteger(param.tailBars) &&
        isInRange(param.targetLevelDb, -60, 0),
    automateTrackGainRange: (param): param is PayloadOf<'automateTrackGainRange'> =>
        isObj(param) &&
        hasExactKeys(param, ['trackIds', 'sectionName', 'gainDb']) &&
        Array.isArray(param.trackIds) &&
        param.trackIds.length > 0 &&
        param.trackIds.every(isNonEmptyString) &&
        new Set(param.trackIds).size === param.trackIds.length &&
        isNonEmptyString(param.sectionName) &&
        isInRange(param.gainDb, Number.MIN_VALUE, 6),
    renderProjectSections: (param): param is PayloadOf<'renderProjectSections'> =>
        isObj(param) &&
        hasExactKeys(param, ['sectionIds']) &&
        isUniqueNonEmptyStringArray(param.sectionIds) &&
        param.sectionIds.length <= 16,
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
        (hasExactKeys(param, ['sourceTrackId', 'targetTrackId']) ||
            hasExactKeys(param, ['sourceTrackId', 'targetTrackId', 'targetDeviceId'])) &&
        isNonEmptyString(param.sourceTrackId) &&
        isNonEmptyString(param.targetTrackId) &&
        isOptional(param.targetDeviceId, isNonEmptyString) &&
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
    removeShortMidiOverlaps: (param): param is PayloadOf<'removeShortMidiOverlaps'> =>
        isObj(param) &&
        hasExactKeys(param, ['clipId', 'maximumOverlapMs']) &&
        isNonEmptyString(param.clipId) &&
        isPositiveNumber(param.maximumOverlapMs) &&
        param.maximumOverlapMs <= 1_000,
    createDrumPreviewBranches: (param): param is PayloadOf<'createDrumPreviewBranches'> =>
        isObj(param) &&
        hasExactKeys(param, ['sectionId', 'candidateCount', 'varyingRoles']) &&
        isNonEmptyString(param.sectionId) &&
        param.candidateCount === 3 &&
        Array.isArray(param.varyingRoles) &&
        param.varyingRoles.length === 2 &&
        param.varyingRoles[0] === 'snare' &&
        param.varyingRoles[1] === 'hi-hat',
    copyMidiArticulations: (param): param is PayloadOf<'copyMidiArticulations'> =>
        isObj(param) &&
        hasExactKeys(param, ['sourceClipId', 'targetClipId']) &&
        isNonEmptyString(param.sourceClipId) &&
        isNonEmptyString(param.targetClipId) &&
        param.sourceClipId !== param.targetClipId,
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
    removeMarker: (param): param is PayloadOf<'removeMarker'> =>
        isObj(param) && hasExactKeys(param, ['markerId']) && isNonEmptyString(param.markerId),
    removeSection: (param): param is PayloadOf<'removeSection'> =>
        isObj(param) && hasExactKeys(param, ['sectionId']) && isNonEmptyString(param.sectionId),
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
    stopPlayback: hasNoPayload,
    toggleRecording: 'unchecked',
    toggleLoop: 'unchecked',
    toggleMetronome: 'unchecked',
    toggleCountIn: 'unchecked',
    togglePreRoll: 'unchecked',
    setPunchIn: hasValidPunchInBeat,
    setPunchOut: hasValidPunchOutBeat,
    setCountInBars: 'unchecked',
    setPreRollBars: 'unchecked',
    seekPlayhead: (param): param is PayloadOf<'seekPlayhead'> =>
        isObj(param) && hasExactKeys(param, ['beat']) && isNonNegativeNumber(param.beat),
    setEditingTool: 'unchecked',
    setMarqueeSelection: 'unchecked',
    setWorkspaceMode: 'unchecked',
    setSnapValue: 'unchecked',
    zoomToFit: 'unchecked',
    zoomToSelection: 'unchecked',
    zoomTracksVertical: 'unchecked',
    setTrackHeight: 'unchecked',

    // Track state
    selectTrack: 'unchecked',
    muteTrack: (param): param is PayloadOf<'muteTrack'> =>
        isObj(param) &&
        hasExactKeys(param, ['trackId', 'muted']) &&
        isNonEmptyString(param.trackId) &&
        typeof param.muted === 'boolean',
    soloTrack: (param): param is PayloadOf<'soloTrack'> =>
        isObj(param) &&
        hasExactKeys(param, ['trackId', 'soloed']) &&
        isNonEmptyString(param.trackId) &&
        typeof param.soloed === 'boolean',
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
    reorderTrack: (param): param is PayloadOf<'reorderTrack'> =>
        isObj(param) &&
        hasExactKeys(param, ['trackId', 'newIndex']) &&
        isNonEmptyString(param.trackId) &&
        isNonNegativeNumber(param.newIndex) &&
        Number.isInteger(param.newIndex),
    setTrackGain: (param): param is PayloadOf<'setTrackGain'> =>
        isObj(param) &&
        hasExactKeys(param, ['trackId', 'gain']) &&
        isNonEmptyString(param.trackId) &&
        isInRange(param.gain, 0, FADER_MAX_GAIN),
    setTrackPan: (param): param is PayloadOf<'setTrackPan'> =>
        isObj(param) &&
        hasExactKeys(param, ['trackId', 'pan']) &&
        isNonEmptyString(param.trackId) &&
        isInRange(param.pan, -50, 50),
    setTrackColor: (param): param is PayloadOf<'setTrackColor'> =>
        isObj(param) &&
        hasExactKeys(param, ['trackId', 'color']) &&
        isNonEmptyString(param.trackId) &&
        isSafeTrackColor(param.color),
    setTrackOutput: (param): param is PayloadOf<'setTrackOutput'> =>
        isObj(param) &&
        hasOnlyKeys(param, ['trackId', 'outputId', 'expectedOutputId']) &&
        Object.hasOwn(param, 'trackId') &&
        Object.hasOwn(param, 'outputId') &&
        isNonEmptyString(param.trackId) &&
        isNonEmptyString(param.outputId) &&
        param.trackId !== param.outputId &&
        isOptionalOwn(param, 'expectedOutputId', isNonEmptyString),
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
    bypassDevice: (param): param is PayloadOf<'bypassDevice'> =>
        isObj(param) &&
        hasExactKeys(param, ['deviceId', 'bypassed']) &&
        isNonEmptyString(param.deviceId) &&
        typeof param.bypassed === 'boolean',
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
    setClipLoopLength: (param): param is PayloadOf<'setClipLoopLength'> =>
        isObj(param) &&
        hasExactKeys(param, ['clipId', 'loopLength']) &&
        isNonEmptyString(param.clipId) &&
        isNumber(param.loopLength) &&
        param.loopLength >= MIN_CLIP_LOOP_LENGTH_BEATS,
    setClipStretchMode: (param): param is PayloadOf<'setClipStretchMode'> =>
        isObj(param) &&
        hasExactKeys(param, ['clipId', 'mode']) &&
        isNonEmptyString(param.clipId) &&
        (param.mode === 'off' || param.mode === 'repitch' || param.mode === 'timestretch'),
    setClipStretchRatio: (param): param is PayloadOf<'setClipStretchRatio'> =>
        isObj(param) &&
        hasExactKeys(param, ['clipId', 'ratio']) &&
        isNonEmptyString(param.clipId) &&
        isInRange(param.ratio, 0.25, 4),
    fitClipToBeats: (param): param is PayloadOf<'fitClipToBeats'> =>
        isObj(param) &&
        hasExactKeys(param, ['clipId', 'targetBeats']) &&
        isNonEmptyString(param.clipId) &&
        isPositiveNumber(param.targetBeats),
    duplicateClipToNextBar: hasClipId,
    normalizeClip: (param): param is PayloadOf<'normalizeClip'> => {
        if (
            !isObj(param) ||
            !hasOnlyKeys(param, ['clipId', 'mode', 'targetDb']) ||
            !Object.hasOwn(param, 'clipId') ||
            !isNonEmptyString(param.clipId)
        ) {
            return false;
        }
        const hasMode = Object.hasOwn(param, 'mode');
        const mode = hasMode ? param.mode : 'peak';
        if (mode !== 'peak' && mode !== 'rms' && mode !== 'lufs') {
            return false;
        }
        const hasTargetDb = Object.hasOwn(param, 'targetDb');
        if (mode === 'peak') {
            return !hasTargetDb;
        }
        return !hasTargetDb || isInRange(param.targetDb, -60, 0);
    },
    reverseClip: 'unchecked',
    glueClips: (param): param is PayloadOf<'glueClips'> =>
        isObj(param) &&
        hasExactKeys(param, ['clipIds']) &&
        isUniqueNonEmptyStringArray(param.clipIds) &&
        param.clipIds.length === 2,
    nudgeClip: (param): param is PayloadOf<'nudgeClip'> =>
        isObj(param) &&
        hasExactKeys(param, ['clipId', 'beats']) &&
        isNonEmptyString(param.clipId) &&
        isNumber(param.beats) &&
        param.beats !== 0,
    crossfadeClips: (param): param is PayloadOf<'crossfadeClips'> =>
        isObj(param) &&
        hasOnlyKeys(param, ['clipAId', 'clipBId', 'durationBeats']) &&
        isNonEmptyString(param.clipAId) &&
        isNonEmptyString(param.clipBId) &&
        param.clipAId !== param.clipBId &&
        isOptional(param.durationBeats, isNonNegativeNumber),
    consolidateSelection: 'unchecked',
    bounceSelection: 'unchecked',
    stripSilence: 'unchecked',
    duplicateTimeRange: 'unchecked',

    // Bus / folder / send
    createBus: (param): param is PayloadOf<'createBus'> =>
        isObj(param) && hasExactKeys(param, ['name']) && normalizeSafeProjectName(param.name) !== null,
    createFolder: 'unchecked',
    setSend: (param): param is PayloadOf<'setSend'> =>
        isObj(param) &&
        hasOnlyKeys(param, ['trackId', 'busId', 'level', 'expectedLevel', 'expectedPreFader']) &&
        Object.hasOwn(param, 'trackId') &&
        Object.hasOwn(param, 'busId') &&
        Object.hasOwn(param, 'level') &&
        isNonEmptyString(param.trackId) &&
        isNonEmptyString(param.busId) &&
        param.trackId !== param.busId &&
        isInRange(param.level, 0, 1) &&
        isOptionalOwn(param, 'expectedLevel', (value): value is number => isInRange(value, 0, 1)) &&
        isOptionalOwn(param, 'expectedPreFader', (value): value is boolean => typeof value === 'boolean'),
    addSend: (param): param is PayloadOf<'addSend'> =>
        isObj(param) &&
        hasOnlyKeys(param, ['trackId', 'busId', 'level', 'preFader', 'expectedAbsent']) &&
        Object.hasOwn(param, 'trackId') &&
        Object.hasOwn(param, 'busId') &&
        Object.hasOwn(param, 'level') &&
        isNonEmptyString(param.trackId) &&
        isNonEmptyString(param.busId) &&
        param.trackId !== param.busId &&
        isInRange(param.level, 0, 1) &&
        isOptionalOwn(param, 'preFader', (value): value is boolean => typeof value === 'boolean') &&
        isOptionalOwn(param, 'expectedAbsent', (value): value is true => value === true),
    removeSend: (param): param is PayloadOf<'removeSend'> =>
        isObj(param) &&
        hasOnlyKeys(param, ['trackId', 'busId', 'expectedLevel', 'expectedPreFader']) &&
        Object.hasOwn(param, 'trackId') &&
        Object.hasOwn(param, 'busId') &&
        isNonEmptyString(param.trackId) &&
        isNonEmptyString(param.busId) &&
        param.trackId !== param.busId &&
        isOptionalOwn(param, 'expectedLevel', (value): value is number => isInRange(value, 0, 1)) &&
        isOptionalOwn(param, 'expectedPreFader', (value): value is boolean => typeof value === 'boolean'),

    // Markers / sections / time signature / adjustments
    addMarker: (param): param is PayloadOf<'addMarker'> =>
        isObj(param) &&
        hasExactKeys(param, ['beat', 'name']) &&
        isNonNegativeNumber(param.beat) &&
        normalizeSafeProjectName(param.name) !== null,
    setMarkerColor: (param): param is PayloadOf<'setMarkerColor'> =>
        isObj(param) &&
        hasExactKeys(param, ['markerId', 'color']) &&
        isNonEmptyString(param.markerId) &&
        isNonEmptyString(param.color) &&
        resolveMarkerColorName(param.color) !== null,
    addSection: (param): param is PayloadOf<'addSection'> =>
        isObj(param) &&
        hasExactKeys(param, ['startBeat', 'endBeat', 'name']) &&
        isNonNegativeNumber(param.startBeat) &&
        isNumber(param.endBeat) &&
        param.endBeat > param.startBeat &&
        normalizeSafeProjectName(param.name) !== null,
    renameSection: (param): param is PayloadOf<'renameSection'> =>
        isObj(param) &&
        hasExactKeys(param, ['sectionId', 'name']) &&
        isNonEmptyString(param.sectionId) &&
        normalizeSafeProjectName(param.name) !== null,
    addTimeSignatureChange: 'unchecked',
    createAdjustmentLayer: 'unchecked',
    addAdjustmentRegion: (param): param is PayloadOf<'addAdjustmentRegion'> =>
        isObj(param) &&
        hasExactKeys(param, ['layerId', 'startBeat', 'endBeat', 'blend', 'fadeInBeats', 'fadeOutBeats']) &&
        isNonEmptyString(param.layerId) &&
        isNonNegativeNumber(param.startBeat) &&
        isNumber(param.endBeat) &&
        param.endBeat > param.startBeat &&
        isInRange(param.blend, 0, 1) &&
        isNonNegativeNumber(param.fadeInBeats) &&
        isNonNegativeNumber(param.fadeOutBeats) &&
        param.fadeInBeats + param.fadeOutBeats <= param.endBeat - param.startBeat,

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
    arpeggiate: (param): param is PayloadOf<'arpeggiate'> =>
        isObj(param) &&
        hasOnlyKeys(param, ['clipId', 'pattern', 'rate', 'octaves', 'gate']) &&
        isNonEmptyString(param.clipId) &&
        (param.pattern === undefined ||
            param.pattern === 'up' ||
            param.pattern === 'down' ||
            param.pattern === 'updown' ||
            param.pattern === 'downup' ||
            param.pattern === 'random') &&
        (param.rate === undefined || param.rate === 4 || param.rate === 8 || param.rate === 16 || param.rate === 32) &&
        (param.octaves === undefined || (Number.isInteger(param.octaves) && isInRange(param.octaves, 1, 4))) &&
        (param.gate === undefined || isInRange(param.gate, 1, 100)),

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
