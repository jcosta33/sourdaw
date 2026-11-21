import { type AppAction, type HandlerSessionActionEntry } from '#/utils/handlerContract';

import { automationPointSnapshotsMatch } from './automationPointSnapshotsMatch';
import {
    isRemoveAutomationLanePayload,
    isRestoreAutomationLanePointsPayload,
} from './validateRangeWriteSessionEntries';

/**
 * Session-history validators for the automation entries a lane edit records: a recorded pass, a new
 * lane, and a lane transform. A saved history may come from another build or a peer, so an entry is
 * kept only when its undo is exactly the guarded inverse its forward write describes; anything else
 * is dropped, and the mirror's walk stops there rather than step over it.
 */

type LanePointsRestore = Extract<AppAction, { type: 'restoreAutomationLanePoints' }>;
type LaneTransform = Extract<
    AppAction,
    {
        type:
            | 'reverseAutomation'
            | 'invertAutomation'
            | 'scaleAutomation'
            | 'stretchAutomation'
            | 'thinAutomation'
            | 'quantizeAutomation';
    }
>;

const LANE_TRANSFORM_TYPES: ReadonlySet<string> = new Set([
    'reverseAutomation',
    'invertAutomation',
    'scaleAutomation',
    'stretchAutomation',
    'thinAutomation',
    'quantizeAutomation',
]);

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isLaneTransform(action: AppAction): action is LaneTransform {
    return LANE_TRANSFORM_TYPES.has(action.type);
}

/** A lane-points restore that names `laneId` and guards on the points it expects to replace. */
function isGuardedRestoreOfLane(action: AppAction | null | undefined, laneId: string): action is LanePointsRestore {
    return (
        action?.type === 'restoreAutomationLanePoints' &&
        isRestoreAutomationLanePointsPayload(action.payload) &&
        action.payload.laneId === laneId &&
        action.payload.expectedPoints !== undefined
    );
}

/**
 * A recorded pass writes one lane from the points it found to the points it left, guarded on the
 * points it found, and undoes by the mirror image: restoring exactly the points it replaced, guarded
 * on exactly the points it wrote. A pass that changed nothing records no entry. It redoes by
 * replaying the pass itself.
 */
export function isRecordedAutomationPassSessionEntry(entry: HandlerSessionActionEntry): boolean {
    const { action, inverseAction, redoAction } = entry;
    if (action.type !== 'restoreAutomationLanePoints' || redoAction !== undefined) {
        return false;
    }
    const { laneId, points, expectedPoints } = action.payload;
    if (!isGuardedRestoreOfLane(action, laneId) || expectedPoints === undefined) {
        return false;
    }
    if (!isGuardedRestoreOfLane(inverseAction, laneId) || inverseAction.payload.expectedPoints === undefined) {
        return false;
    }
    return (
        !automationPointSnapshotsMatch(points, expectedPoints) &&
        automationPointSnapshotsMatch(inverseAction.payload.points, expectedPoints) &&
        automationPointSnapshotsMatch(inverseAction.payload.expectedPoints, points)
    );
}

/**
 * A new lane undoes by removing the lane under the id it was created with, and nothing else: the
 * removal carries no expected points, because the lane was created empty. A lane the track already
 * had records no undo at all. It redoes by replaying the creation under the same id.
 */
export function isAddAutomationLaneSessionEntry(entry: HandlerSessionActionEntry): boolean {
    const { action, inverseAction, redoAction } = entry;
    if (action.type !== 'addAutomationLane' || redoAction !== undefined) {
        return false;
    }
    if (inverseAction === null) {
        return true;
    }
    const { laneId } = action.payload;
    return (
        isNonEmptyString(laneId) &&
        inverseAction.type === 'removeAutomationLane' &&
        isRemoveAutomationLanePayload(inverseAction.payload) &&
        Object.keys(inverseAction.payload).length === 1 &&
        inverseAction.payload.laneId === laneId
    );
}

/**
 * A lane transform undoes by restoring the points of the lane it transformed, guarded on the points
 * the transform leaves there. A transform of a lane that did not yet exist when it was described
 * records no undo. It redoes by replaying the transform.
 */
export function isLaneTransformSessionEntry(entry: HandlerSessionActionEntry): boolean {
    const { action, inverseAction, redoAction } = entry;
    if (!isLaneTransform(action) || redoAction !== undefined) {
        return false;
    }
    if (inverseAction === null) {
        return true;
    }
    return isGuardedRestoreOfLane(inverseAction, action.payload.laneId);
}
