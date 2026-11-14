import { type AppAction, type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { jsonValuesEqual } from '#/utils/jsonSemanticEquality';
import { isRecord } from '#/utils/structuralEquality';

import { type AutomationPoint } from '../../models/Automation';
import { is_exact_automation_point, is_sorted_by_beat } from '../../stores/automationStore';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

/**
 * Session-history validators for the range writes and the guarded inverses that undo them. A saved
 * history is document data that may come from another build or a peer, so each payload is read
 * here exactly as the owning handler executes it, and each entry only when its undo and redo are the
 * pair its forward write records.
 */

const AUTOMATION_MODES: readonly unknown[] = ['read', 'write', 'touch', 'latch', 'off'];

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isBeatSpan(start: unknown, end: unknown): boolean {
    return isFiniteNumber(start) && isFiniteNumber(end) && start >= 0 && start < end;
}

function isSectionSpan(value: unknown, name: unknown, startBeat: unknown, endBeat: unknown): boolean {
    return isRecord(value) && value.name === name && value.startBeat === startBeat && value.endBeat === endBeat;
}

/** Each id names, in order, the track the expectation at the same index describes. */
function namesEachExpectedTrack(trackIds: unknown, expected: unknown, trackIdKey: string): boolean {
    return (
        Array.isArray(trackIds) &&
        Array.isArray(expected) &&
        trackIds.length > 0 &&
        trackIds.length === expected.length &&
        trackIds.every(
            (trackId, index) =>
                isNonEmptyString(trackId) && isRecord(expected[index]) && expected[index][trackIdKey] === trackId
        )
    );
}

/**
 * Every point carries exactly the store's point shape, checked per point the way
 * `restoreAutomationLanes` checks whole lanes, in the ascending beat order `is_exact_automation_lane`
 * requires. Points restored by undo or redo come from a possibly remote peer's document, so a
 * malformed or out-of-order set refuses the restore rather than write garbage into the lane.
 */
export function isRestorableAutomationPointSet(points: unknown): points is AutomationPoint[] {
    if (!Array.isArray(points)) {
        return false;
    }
    for (let index = 0; index < points.length; index += 1) {
        if (!Object.hasOwn(points, index) || !is_exact_automation_point(points[index])) {
            return false;
        }
    }
    return is_sorted_by_beat(points);
}

export function isRemoveTrackGainAutomationRangePayload(payload: unknown): boolean {
    return (
        isRecord(payload) &&
        isNonEmptyString(payload.sectionId) &&
        isNonEmptyString(payload.sectionName) &&
        isFiniteNumber(payload.gainDb) &&
        isBeatSpan(payload.startBeat, payload.endBeat) &&
        isSectionSpan(payload.expectedSection, payload.sectionName, payload.startBeat, payload.endBeat) &&
        namesEachExpectedTrack(payload.trackIds, payload.expectedTracks, 'trackId') &&
        Array.isArray(payload.expectedTracks) &&
        payload.expectedTracks.every(
            (track) =>
                isRecord(track) &&
                typeof track.trackName === 'string' &&
                isFiniteNumber(track.gain) &&
                track.gain > 0 &&
                AUTOMATION_MODES.includes(track.automationMode) &&
                typeof track.frozen === 'boolean'
        )
    );
}

export function isRemoveSendAutomationRangePayload(payload: unknown): boolean {
    return (
        isRecord(payload) &&
        isNonEmptyString(payload.busId) &&
        typeof payload.busName === 'string' &&
        isNonEmptyString(payload.sectionId) &&
        isNonEmptyString(payload.sectionName) &&
        isFiniteNumber(payload.reductionDb) &&
        isBeatSpan(payload.startBeat, payload.endBeat) &&
        isSectionSpan(payload.expectedSection, payload.sectionName, payload.startBeat, payload.endBeat) &&
        namesEachExpectedTrack(payload.trackIds, payload.expectedSends, 'trackId') &&
        Array.isArray(payload.expectedSends) &&
        payload.expectedSends.every(
            (send) => isRecord(send) && isFiniteNumber(send.level) && typeof send.preFader === 'boolean'
        )
    );
}

function isSendRangeSnapshot(range: unknown, sectionId: unknown): boolean {
    return (
        isRecord(range) &&
        isNonEmptyString(range.sectionId) &&
        range.sectionId === sectionId &&
        isNonEmptyString(range.sectionName) &&
        isBeatSpan(range.startBeat, range.endBeat) &&
        isFiniteNumber(range.automationStartBeat) &&
        isFiniteNumber(range.startBeat) &&
        isFiniteNumber(range.endBeat) &&
        range.automationStartBeat >= range.startBeat &&
        range.automationStartBeat < range.endBeat
    );
}

export function isRemoveSendAutomationRangesPayload(payload: unknown): boolean {
    if (!isRecord(payload) || !Array.isArray(payload.sectionIds) || !Array.isArray(payload.ranges)) {
        return false;
    }
    const { sectionIds, ranges, expectedTimeSignature } = payload;
    return (
        isNonEmptyString(payload.busId) &&
        typeof payload.busName === 'string' &&
        isFiniteNumber(payload.tailBars) &&
        payload.tailBars > 0 &&
        isFiniteNumber(payload.targetLevelDb) &&
        Array.isArray(expectedTimeSignature) &&
        expectedTimeSignature.length === 2 &&
        expectedTimeSignature.every((part) => Number.isSafeInteger(part) && part > 0) &&
        ranges.length > 0 &&
        ranges.length === sectionIds.length &&
        ranges.every((range, index) => isSendRangeSnapshot(range, sectionIds[index])) &&
        namesEachExpectedTrack(payload.trackIds, payload.expectedTracks, 'trackId') &&
        Array.isArray(payload.expectedTracks) &&
        payload.expectedTracks.every(
            (track) =>
                isRecord(track) &&
                typeof track.trackName === 'string' &&
                typeof track.frozen === 'boolean' &&
                AUTOMATION_MODES.includes(track.automationMode) &&
                isFiniteNumber(track.sendLevel) &&
                typeof track.sendPreFader === 'boolean'
        )
    );
}

export function isRemoveAutomationLanePayload(payload: unknown): boolean {
    return (
        isRecord(payload) &&
        isNonEmptyString(payload.laneId) &&
        (!Object.hasOwn(payload, 'expectedPoints') || isRestorableAutomationPointSet(payload.expectedPoints))
    );
}

export function isRestoreAutomationLanePointsPayload(payload: unknown): boolean {
    return (
        isRecord(payload) &&
        isNonEmptyString(payload.laneId) &&
        isRestorableAutomationPointSet(payload.points) &&
        (!Object.hasOwn(payload, 'expectedPoints') || isRestorableAutomationPointSet(payload.expectedPoints))
    );
}

type LegacyRangeWrite = Extract<
    AppAction,
    { type: 'automateTrackGainRange' | 'automateSendRange' | 'automateSendRanges' }
>['type'];

const LEGACY_RANGE_REMOVAL: Record<
    LegacyRangeWrite,
    { type: AppAction['type']; isPayload: (payload: unknown) => boolean }
> = {
    automateTrackGainRange: {
        type: 'removeTrackGainAutomationRange',
        isPayload: isRemoveTrackGainAutomationRangePayload,
    },
    automateSendRange: { type: 'removeSendAutomationRange', isPayload: isRemoveSendAutomationRangePayload },
    automateSendRanges: { type: 'removeSendAutomationRanges', isPayload: isRemoveSendAutomationRangesPayload },
};

/**
 * A retired section range write undoes through its guarded removal, which carries exactly the
 * materialized write, and redoes by replaying the write itself.
 */
export function isLegacyRangeWriteSessionEntry(entry: HandlerSessionActionEntry): boolean {
    const { action, inverseAction, redoAction } = entry;
    if (
        action.type !== 'automateTrackGainRange' &&
        action.type !== 'automateSendRange' &&
        action.type !== 'automateSendRanges'
    ) {
        return false;
    }
    const removal = LEGACY_RANGE_REMOVAL[action.type];
    return (
        redoAction === undefined &&
        inverseAction !== null &&
        inverseAction.type === removal.type &&
        removal.isPayload(inverseAction.payload) &&
        jsonValuesEqual(inverseAction.payload, action.payload)
    );
}

/**
 * Whether `points` hold the run of points this write placed: the ids `<writeId>-point-0`, `-1`, …
 * in order, side by side, inside the written range, and no other point carrying the write's
 * identity. Only the lane the write addressed can hold them, so an undo that expects them names
 * that lane and no other.
 */
function carriesWriteIdentity(point: AutomationPoint, writeId: string): boolean {
    return point.id?.startsWith(`${writeId}-point-`) === true;
}

function holdsWrittenRun(
    points: readonly AutomationPoint[],
    writeId: string,
    startBeat: number,
    endBeat: number
): boolean {
    const first = points.findIndex((point) => carriesWriteIdentity(point, writeId));
    if (first < 0) {
        return false;
    }
    const run = points.slice(first).filter((point) => carriesWriteIdentity(point, writeId));
    return run.every(
        (point, index) =>
            points[first + index] === point &&
            point.id === `${writeId}-point-${String(index)}` &&
            point.beat >= startBeat &&
            point.beat <= endBeat
    );
}

/**
 * Whether the lane a restore names is, while the project holds it, the track's own lane for the
 * parameter the write addresses. A lane the project no longer holds is left to the restore's own
 * guard: a later entry may have removed it, and undoing that entry brings it back first.
 */
function isLaneOfWriteTarget(laneId: string, trackId: string, parameterId: string): boolean {
    const lane = getAutomationStoreState()?.lanes.find((candidate) => candidate.id === laneId);
    return lane === undefined || (!lane.clipId && lane.trackId === trackId && lane.parameterId === parameterId);
}

type LaneRemovalPayload = Extract<AppAction, { type: 'removeAutomationLane' }>['payload'];
type LanePointsRestorePayload = Extract<AppAction, { type: 'restoreAutomationLanePoints' }>['payload'];
type ParameterRangeWrite = {
    writeId: string;
    startBeat: number;
    endBeat: number;
    trackId: string;
    parameterId: string;
};

/** The removal of the lane a write created: `<writeId>-lane`, expected to hold exactly the written run. */
function isCreatedLaneRemoval(
    payload: LaneRemovalPayload,
    writeId: string,
    startBeat: number,
    endBeat: number
): boolean {
    const { laneId, expectedPoints } = payload;
    return (
        isRemoveAutomationLanePayload(payload) &&
        laneId === `${writeId}-lane` &&
        expectedPoints !== undefined &&
        isRestorableAutomationPointSet(expectedPoints) &&
        expectedPoints.every((point) => carriesWriteIdentity(point, writeId)) &&
        holdsWrittenRun(expectedPoints, writeId, startBeat, endBeat)
    );
}

/**
 * The restore of a lane a write rewrote: never the lane the write would create, expecting the written
 * run, restoring points the write did not place, on the track's own lane for the written parameter.
 */
function isRewrittenLaneRestore(payload: LanePointsRestorePayload, write: ParameterRangeWrite): boolean {
    const { laneId, points, expectedPoints } = payload;
    const { writeId, startBeat, endBeat, trackId, parameterId } = write;
    return (
        isRestoreAutomationLanePointsPayload(payload) &&
        laneId !== `${writeId}-lane` &&
        expectedPoints !== undefined &&
        isRestorableAutomationPointSet(expectedPoints) &&
        isRestorableAutomationPointSet(points) &&
        holdsWrittenRun(expectedPoints, writeId, startBeat, endBeat) &&
        !points.some((point) => carriesWriteIdentity(point, writeId)) &&
        isLaneOfWriteTarget(laneId, trackId, parameterId)
    );
}

/**
 * A parameter range write undoes by removing the lane it created, `<writeId>-lane`, only while that
 * lane holds exactly the points it wrote, or by restoring the points of the lane it rewrote, only
 * while that lane holds what it wrote. Either way the undo expects the write's own run of points,
 * which binds it to the lane the write addressed; a write never restores the lane it creates. It
 * redoes by replaying the write, whose application-assigned `writeId` names the same lane and points
 * again.
 */
export function isParameterRangeWriteSessionEntry(entry: HandlerSessionActionEntry): boolean {
    const { action, inverseAction, redoAction } = entry;
    if (action.type !== 'automateParameterRange' || redoAction !== undefined || inverseAction === null) {
        return false;
    }
    const { writeId, startBeat, endBeat, trackId, parameterId } = action.payload;
    if (
        !isNonEmptyString(writeId) ||
        !isFiniteNumber(startBeat) ||
        !isFiniteNumber(endBeat) ||
        !isBeatSpan(startBeat, endBeat)
    ) {
        return false;
    }
    if (inverseAction.type === 'removeAutomationLane') {
        return isCreatedLaneRemoval(inverseAction.payload, writeId, startBeat, endBeat);
    }
    if (inverseAction.type === 'restoreAutomationLanePoints') {
        return isRewrittenLaneRestore(inverseAction.payload, { writeId, startBeat, endBeat, trackId, parameterId });
    }
    return false;
}
