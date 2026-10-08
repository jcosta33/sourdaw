import { isExactAutomationLaneSnapshots } from '#/modules/Automation/useCases';
import { type AppAction, type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { decodeExactTakeLaneSnapshots } from '../../stores/takeLaneStore';
import { clipSatelliteStateCodec } from '../../useCases/timeOperations/clipSatelliteStateCodec';
import { timeOperationRestorePlan } from '../../useCases/timeOperations/prepareTimeOperationStateRestore';
import { reverseRestorePlan } from '../../useCases/timeOperations/reverseRestorePlan';

function hasFiniteNumbers(value: unknown): boolean {
    if (typeof value === 'number') {
        return Number.isFinite(value);
    }
    if (Array.isArray(value)) {
        return value.every(hasFiniteNumbers);
    }
    if (isRecord(value)) {
        return Object.values(value).every(hasFiniteNumbers);
    }
    return true;
}

function isFiniteNumber(value: unknown): boolean {
    return typeof value === 'number' && Number.isFinite(value);
}

function optionalField(value: Record<string, unknown>, key: string, accepts: (field: unknown) => boolean): boolean {
    return !Object.hasOwn(value, key) || value[key] === undefined || accepts(value[key]);
}

function isKneadBlob(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.id === 'string' &&
        isFiniteNumber(value.startTime) &&
        isFiniteNumber(value.endTime) &&
        isFiniteNumber(value.pitchCenterCents) &&
        optionalField(value, 'originalPitchCenterCents', isFiniteNumber) &&
        Array.isArray(value.pitchCurveCents) &&
        value.pitchCurveCents.every(isFiniteNumber) &&
        isFiniteNumber(value.voicedConfidence) &&
        Object.keys(value).every((key) =>
            [
                'id',
                'startTime',
                'endTime',
                'pitchCenterCents',
                'originalPitchCenterCents',
                'pitchCurveCents',
                'voicedConfidence',
            ].includes(key)
        )
    );
}

function isKneadState(value: unknown): boolean {
    return (
        isRecord(value) &&
        Array.isArray(value.blobs) &&
        value.blobs.every(isKneadBlob) &&
        isFiniteNumber(value.retuneSpeedMs) &&
        isFiniteNumber(value.humanizePercent) &&
        typeof value.formantPreserve === 'boolean' &&
        Object.keys(value).every((key) =>
            ['blobs', 'retuneSpeedMs', 'humanizePercent', 'formantPreserve'].includes(key)
        )
    );
}

const optionalClipFields: Record<string, (value: unknown) => boolean> = {
    audioBufferId: (value) => typeof value === 'string',
    fileId: (value) => typeof value === 'string',
    assetHash: (value) => typeof value === 'string',
    audioOffsetBeats: isFiniteNumber,
    midiOffsetBeats: isFiniteNumber,
    stretchMode: (value) => value === 'off' || value === 'repitch' || value === 'timestretch',
    stretchRatio: isFiniteNumber,
    loopEnabled: (value) => typeof value === 'boolean',
    loopLength: isFiniteNumber,
    followAction: (value) =>
        value === 'stop' ||
        value === 'play_next' ||
        value === 'play_previous' ||
        value === 'play_random' ||
        value === 'play_first' ||
        value === 'play_last',
    generating: (value) => typeof value === 'boolean',
    isGhost: (value) => typeof value === 'boolean',
    isInlineEditing: (value) => typeof value === 'boolean',
    parentClipId: (value) => typeof value === 'string',
    isLinkedInstance: (value) => typeof value === 'boolean',
    sourceKeyRoot: isFiniteNumber,
    sourceScaleName: (value) => typeof value === 'string',
    overrides: (value) => isRecord(value) && Object.values(value).every((entry) => typeof entry === 'boolean'),
    kneadState: isKneadState,
};

const requiredClipFields = new Set([
    'id',
    'trackId',
    'name',
    'startBeat',
    'endBeat',
    'type',
    'fadeInBeats',
    'fadeOutBeats',
    'gain',
    'color',
    'locked',
    'muted',
]);

function hasValidClipFields(value: Record<string, unknown>): boolean {
    return Object.entries(value).every(
        ([key, field]) =>
            requiredClipFields.has(key) ||
            (Object.hasOwn(optionalClipFields, key) && (field === undefined || optionalClipFields[key]!(field)))
    );
}

function isRetiredTakeLane(value: unknown, clipId: string): boolean {
    if (
        !isRecord(value) ||
        typeof value.laneIndex !== 'number' ||
        !Number.isSafeInteger(value.laneIndex) ||
        value.laneIndex < 0
    ) {
        return false;
    }
    const lane = decodeExactTakeLaneSnapshots([value.lane])?.[0];
    if (!lane) {
        return false;
    }
    return (
        optionalField(
            value,
            'retiredTakeIds',
            (ids) =>
                Array.isArray(ids) &&
                ids.every(
                    (id) =>
                        typeof id === 'string' && lane.takes.some((take) => take.id === id && take.clipId === clipId)
                )
        ) && Object.keys(value).every((key) => ['laneIndex', 'lane', 'retiredTakeIds'].includes(key))
    );
}

function isRetiredTakeLanes(value: unknown, clipId: string): boolean {
    return Array.isArray(value) && value.every((entry) => isRetiredTakeLane(entry, clipId));
}

function isClipSnapshot(value: unknown, clipId: string, trackId: string): boolean {
    return (
        isRecord(value) &&
        value.id === clipId &&
        value.trackId === trackId &&
        typeof value.name === 'string' &&
        typeof value.startBeat === 'number' &&
        Number.isFinite(value.startBeat) &&
        typeof value.endBeat === 'number' &&
        Number.isFinite(value.endBeat) &&
        value.endBeat > value.startBeat &&
        (value.type === 'audio' || value.type === 'midi') &&
        isFiniteNumber(value.fadeInBeats) &&
        isFiniteNumber(value.fadeOutBeats) &&
        isFiniteNumber(value.gain) &&
        typeof value.color === 'string' &&
        typeof value.locked === 'boolean' &&
        typeof value.muted === 'boolean' &&
        hasValidClipFields(value)
    );
}

function isRippleDeleteShift(value: unknown, removedClipId: string): boolean {
    return (
        isRecord(value) &&
        typeof value.clipId === 'string' &&
        value.clipId.length > 0 &&
        value.clipId !== removedClipId &&
        typeof value.origStartBeat === 'number' &&
        Number.isFinite(value.origStartBeat) &&
        typeof value.origEndBeat === 'number' &&
        Number.isFinite(value.origEndBeat) &&
        value.origEndBeat > value.origStartBeat &&
        typeof value.automationDelta === 'number' &&
        Number.isFinite(value.automationDelta)
    );
}

function isRippleDeleteCapture(value: unknown, clipSnapshot: unknown, clipId: string): boolean {
    return (
        isRecord(value) &&
        Array.isArray(value.removedClips) &&
        value.removedClips.length === 1 &&
        valuesEqual(value.removedClips[0], clipSnapshot) &&
        Array.isArray(value.shiftedClips) &&
        value.shiftedClips.every((shift) => isRippleDeleteShift(shift, clipId)) &&
        clipSatelliteStateCodec.decodeEntries(value.clipSatellites) !== null &&
        isExactAutomationLaneSnapshots(value.clipAutomationLanes)
    );
}

export function isRestoreClipSessionPayload(value: unknown): boolean {
    if (!isRecord(value) || typeof value.clipId !== 'string' || typeof value.trackId !== 'string') {
        return false;
    }
    return (
        value.clipId.length > 0 &&
        value.trackId.length > 0 &&
        isClipSnapshot(value.clipSnapshot, value.clipId, value.trackId) &&
        (value.ripplePlan === null || isRippleDeleteCapture(value.ripplePlan, value.clipSnapshot, value.clipId)) &&
        isRetiredTakeLanes(value.retiredTakeLanes, value.clipId) &&
        hasFiniteNumbers(value)
    );
}

export function isRemoveClipSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (entry.action.type !== 'removeClip' || entry.inverseAction?.type !== 'restoreClip' || entry.redoAction) {
        return false;
    }
    return (
        entry.action.payload.clipId === entry.inverseAction.payload.clipId &&
        isRestoreClipSessionPayload(entry.inverseAction.payload)
    );
}

function isPlacement(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.trackId === 'string' &&
        value.trackId.length > 0 &&
        typeof value.startBeat === 'number' &&
        Number.isFinite(value.startBeat) &&
        value.startBeat >= 0 &&
        typeof value.endBeat === 'number' &&
        Number.isFinite(value.endBeat) &&
        value.endBeat > value.startBeat &&
        Array.isArray(value.automationLanes) &&
        hasFiniteNumbers(value.automationLanes)
    );
}

export function isRestoreClipPlacementSessionPayload(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.clipId === 'string' &&
        value.clipId.length > 0 &&
        isPlacement(value.expected) &&
        isPlacement(value.replacement)
    );
}

export function isMoveClipSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (
        entry.action.type !== 'moveClip' ||
        entry.inverseAction?.type !== 'restoreClipPlacement' ||
        entry.redoAction?.type !== 'restoreClipPlacement'
    ) {
        return false;
    }
    const action = entry.action.payload;
    const inverse = entry.inverseAction.payload;
    const redo = entry.redoAction.payload;
    return (
        action.clipId === inverse.clipId &&
        action.clipId === redo.clipId &&
        isRestoreClipPlacementSessionPayload(inverse) &&
        isRestoreClipPlacementSessionPayload(redo) &&
        inverse.expected.trackId === action.trackId &&
        inverse.expected.startBeat === action.startBeat &&
        inverse.expected.endBeat === action.startBeat + (inverse.replacement.endBeat - inverse.replacement.startBeat) &&
        valuesEqual(inverse.expected, redo.replacement) &&
        valuesEqual(inverse.replacement, redo.expected)
    );
}

function isSplitSnapshot(value: unknown, clipId: string, rightClipId: string): boolean {
    return (
        isRecord(value) &&
        typeof value.trackId === 'string' &&
        value.trackId.length > 0 &&
        isClipSnapshot(value.leftClip, clipId, value.trackId) &&
        (value.rightClip === null || isClipSnapshot(value.rightClip, rightClipId, value.trackId)) &&
        typeof value.rightClipIndex === 'number' &&
        Number.isSafeInteger(value.rightClipIndex) &&
        value.rightClipIndex >= 0 &&
        hasFiniteNumbers(value)
    );
}

export function isRestoreClipSplitSessionPayload(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.clipId === 'string' &&
        value.clipId.length > 0 &&
        typeof value.rightClipId === 'string' &&
        value.rightClipId.length > 0 &&
        value.rightClipId !== value.clipId &&
        isSplitSnapshot(value.expected, value.clipId, value.rightClipId) &&
        isSplitSnapshot(value.replacement, value.clipId, value.rightClipId) &&
        (value.retiredTakeLanes === undefined || isRetiredTakeLanes(value.retiredTakeLanes, value.rightClipId))
    );
}

function splitReplaySnapshotsMatch(
    inverse: Extract<AppAction, { type: 'restoreClipSplitState' }>['payload'],
    redo: Extract<AppAction, { type: 'restoreClipSplitState' }>['payload']
): boolean {
    return (
        valuesEqual(inverse.expected, redo.replacement) &&
        valuesEqual(inverse.replacement, redo.expected) &&
        valuesEqual(inverse.retiredTakeLanes, redo.retiredTakeLanes)
    );
}

export function isSplitClipSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (
        entry.action.type !== 'splitClip' ||
        entry.inverseAction?.type !== 'restoreClipSplitState' ||
        entry.redoAction?.type !== 'restoreClipSplitState'
    ) {
        return false;
    }
    const action = entry.action.payload;
    const inverse = entry.inverseAction.payload;
    const redo = entry.redoAction.payload;
    return (
        action.clipId === inverse.clipId &&
        action.clipId === redo.clipId &&
        action.rightClipId === inverse.rightClipId &&
        action.rightClipId === redo.rightClipId &&
        isRestoreClipSplitSessionPayload(inverse) &&
        isRestoreClipSplitSessionPayload(redo) &&
        typeof action.resolvedBeat === 'number' &&
        Number.isFinite(action.resolvedBeat) &&
        inverse.expected.rightClip !== null &&
        inverse.replacement.rightClip === null &&
        inverse.expected.leftClip.endBeat === action.resolvedBeat &&
        inverse.expected.rightClip.startBeat === action.resolvedBeat &&
        inverse.replacement.leftClip.startBeat < action.resolvedBeat &&
        inverse.replacement.leftClip.endBeat > action.resolvedBeat &&
        splitReplaySnapshotsMatch(inverse, redo)
    );
}

export function isRestoreTimeOperationSessionPayload(value: unknown): boolean {
    return isRecord(value) && timeOperationRestorePlan.isValid(value.plan);
}

export function isDeleteTimeSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (
        entry.action.type !== 'deleteTime' ||
        entry.inverseAction?.type !== 'restoreTimeOperationState' ||
        entry.redoAction?.type !== 'restoreTimeOperationState'
    ) {
        return false;
    }
    const action = entry.action.payload;
    const inverse = entry.inverseAction.payload;
    const redo = entry.redoAction.payload;
    const inversePlan: unknown = inverse.plan;
    const redoPlan: unknown = redo.plan;
    if (
        !Number.isFinite(action.startBeat) ||
        !Number.isFinite(action.endBeat) ||
        action.startBeat < 0 ||
        action.endBeat <= action.startBeat ||
        !isRestoreTimeOperationSessionPayload(inverse) ||
        !isRestoreTimeOperationSessionPayload(redo) ||
        !isRecord(inversePlan) ||
        inversePlan.scope !== 'global' ||
        !isRecord(redoPlan) ||
        redoPlan.scope !== 'global'
    ) {
        return false;
    }
    try {
        return valuesEqual(reverseRestorePlan(inversePlan), redoPlan);
    } catch {
        return false;
    }
}
