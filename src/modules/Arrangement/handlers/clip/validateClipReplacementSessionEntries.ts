import { isExactAutomationLaneSnapshots } from '#/modules/Automation/useCases';
import { type HandlerSessionActionEntry, type StripSilenceActionSnapshot } from '#/utils/handlerContract';
import { jsonValuesEqual } from '#/utils/jsonSemanticEquality';
import { isRecord } from '#/utils/structuralEquality';

import { isExactClipSnapshot } from '../../stores/isExactClipSnapshot';
import { clipSatelliteStateCodec } from '../../useCases/timeOperations/clipSatelliteStateCodec';

import { hasFiniteNumbers } from './hasFiniteNumbers';

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isClipReplacementSnapshot(value: unknown): value is StripSilenceActionSnapshot {
    if (!isRecord(value) || !isNonEmptyString(value.trackId) || !Array.isArray(value.clips)) {
        return false;
    }
    const trackId = value.trackId;
    return (
        value.clips.every(
            (clip) => isRecord(clip) && isNonEmptyString(clip.id) && isExactClipSnapshot(clip, clip.id, trackId)
        ) &&
        Array.isArray(value.clipOrder) &&
        value.clipOrder.every(isNonEmptyString) &&
        clipSatelliteStateCodec.decodeEntries(value.clipSatellites) !== null &&
        isExactAutomationLaneSnapshots(value.clipAutomationLanes) &&
        hasFiniteNumbers(value)
    );
}

/**
 * A persisted clip replacement both sides of which are complete snapshots of one track and name the
 * same affected clip set, the shape `restoreStripSilenceState` refuses everything else on.
 */
export function isClipReplacementRestorePayload(
    value: unknown
): value is { expected: StripSilenceActionSnapshot; replacement: StripSilenceActionSnapshot } {
    if (
        !isRecord(value) ||
        !isClipReplacementSnapshot(value.expected) ||
        !isClipReplacementSnapshot(value.replacement)
    ) {
        return false;
    }
    const affected = (snapshot: StripSilenceActionSnapshot) => snapshot.clipSatellites.map((entry) => entry.clipId);
    return (
        value.expected.trackId === value.replacement.trackId &&
        jsonValuesEqual(affected(value.expected), affected(value.replacement))
    );
}

/** Whether `entry`'s undo and redo restore exactly the two snapshots its forward action committed. */
function restoresSwapBetween(
    entry: HandlerSessionActionEntry,
    expected: StripSilenceActionSnapshot,
    replacement: StripSilenceActionSnapshot
): boolean {
    const { inverseAction, redoAction } = entry;
    return (
        inverseAction?.type === 'restoreStripSilenceState' &&
        redoAction?.type === 'restoreStripSilenceState' &&
        isClipReplacementRestorePayload(inverseAction.payload) &&
        jsonValuesEqual(inverseAction.payload, { expected: replacement, replacement: expected }) &&
        jsonValuesEqual(redoAction.payload, { expected, replacement })
    );
}

function isOptionalFiniteNumber(value: unknown): boolean {
    return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

/**
 * Only a strip carrying its complete plan is a deterministic command: the one target clip it
 * replaces and the segments that replace it, both whole snapshots of the same track. A strip that
 * found no silence to remove carries no plan, so it never compiles.
 */
export function isMaterializedStripSilencePayload(value: unknown): boolean {
    if (!isRecord(value) || !isNonEmptyString(value.clipId)) {
        return false;
    }
    const { clipId, threshold, minDuration } = value;
    const plan = { expected: value.expected, replacement: value.replacement };
    return (
        isOptionalFiniteNumber(threshold) &&
        isOptionalFiniteNumber(minDuration) &&
        isClipReplacementRestorePayload(plan) &&
        plan.expected.clips.length === 1 &&
        plan.expected.clips[0]?.id === clipId &&
        plan.replacement.clips.length > 1
    );
}

export function isStripSilenceSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (entry.action.type !== 'stripSilence') {
        return false;
    }
    const { clipId, expected, replacement } = entry.action.payload;
    return (
        expected !== undefined &&
        replacement !== undefined &&
        expected.clips.some((clip) => clip.id === clipId) &&
        restoresSwapBetween(entry, expected, replacement)
    );
}

/**
 * Each move names, in slice order, a distinct slice after the head: that slice starts at the move's
 * grid point and plays from its onset. A slice no move names is the unmoved cut a range end leaves.
 */
function movesHeadTheirSlices(
    moves: readonly unknown[],
    slices: readonly StripSilenceActionSnapshot['clips'][number][]
) {
    let previousIndex = -1;
    return moves.every((move) => {
        const index = slices.findIndex((slice) => isRecord(move) && slice.id === move.sliceClipId);
        const slice = slices[index];
        const headed =
            isRecord(move) &&
            slice !== undefined &&
            index > previousIndex &&
            move.toBeat === slice.startBeat &&
            move.sourceSeconds === slice.audioOffsetSeconds;
        previousIndex = index;
        return headed;
    });
}

function isTransientQuantizePlan(value: unknown, clipId: string): boolean {
    if (!isRecord(value)) {
        return false;
    }
    // Read before the restore-payload predicate narrows `value` to its two snapshots alone.
    const { source, moves, skipped } = value;
    if (
        !isClipReplacementRestorePayload(value) ||
        !isRecord(source) ||
        !Array.isArray(moves) ||
        !Array.isArray(skipped)
    ) {
        return false;
    }
    const [expectedClip] = value.expected.clips;
    const [headSlice, ...slices] = value.replacement.clips;
    return (
        value.expected.clips.length === 1 &&
        expectedClip?.id === clipId &&
        isNonEmptyString(source.audioBufferId) &&
        expectedClip.audioBufferId === source.audioBufferId &&
        headSlice?.id === clipId &&
        movesHeadTheirSlices(moves, slices)
    );
}

/** Only a quantize carrying a complete, internally consistent plan is a deterministic command. */
export function isMaterializedQuantizeTransientsPayload(value: unknown): boolean {
    return isRecord(value) && isNonEmptyString(value.clipId) && isTransientQuantizePlan(value.plan, value.clipId);
}

export function isQuantizeTransientsSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (entry.action.type !== 'quantizeTransients') {
        return false;
    }
    const { plan } = entry.action.payload;
    return (
        plan !== undefined &&
        isMaterializedQuantizeTransientsPayload(entry.action.payload) &&
        restoresSwapBetween(entry, plan.expected, plan.replacement)
    );
}
