import { type AppAction, type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { type AutomationLane, type AutomationPoint } from '../../models/Automation';
import { is_exact_automation_point } from '../../stores/automationStore';
import { insertAutomationPointAtBeat } from '../../services/insertAutomationPointAtBeat';
import { planAutomationShapeInsertion } from '../../useCases/automationShapes';

import { automationPointSnapshotsMatch as pointsMatch } from './automationPointSnapshotsMatch';
import { isRestorableAutomationPointSet } from './validateRangeWriteSessionEntries';

export type InsertAutomationLanePoints = Extract<AppAction, { type: 'insertAutomationLanePoints' }>;
type Insertion = InsertAutomationLanePoints['payload']['insertion'];
export type InsertionOwner = InsertAutomationLanePoints['payload']['owner'];
export type InsertionCapture = NonNullable<InsertAutomationLanePoints['payload']['capture']>;
type LaneRange = Pick<AutomationLane, 'parameterId' | 'clipId' | 'minValue' | 'maxValue'>;

const SHAPES: ReadonlySet<unknown> = new Set(['sine', 'triangle', 'sawtooth-up', 'sawtooth-down', 'square', 'random']);
// The menu asks for one cycle. Bound planning cost for action data read from a session.
const MAX_CYCLES = 1024;

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

export function isLaneInsertion(insertion: unknown): insertion is Insertion {
    if (!isRecord(insertion)) {
        return false;
    }
    if (insertion.kind === 'point') {
        return is_exact_automation_point(insertion.point) && !Object.hasOwn(insertion.point, 'id');
    }
    const { startBeat, endBeat, cycles } = insertion;
    return (
        insertion.kind === 'shape' &&
        SHAPES.has(insertion.shape) &&
        isFiniteNumber(startBeat) &&
        isFiniteNumber(endBeat) &&
        startBeat >= 0 &&
        startBeat < endBeat &&
        (cycles === undefined ||
            (typeof cycles === 'number' && Number.isInteger(cycles) && cycles > 0 && cycles <= MAX_CYCLES))
    );
}

export function isInsertionOwner(value: unknown): value is InsertionOwner {
    return (
        isRecord(value) &&
        isNonEmptyString(value.trackId) &&
        isNonEmptyString(value.parameterId) &&
        (value.clipId === undefined || isNonEmptyString(value.clipId))
    );
}

export function planLaneInsertion(
    range: LaneRange,
    before: AutomationPoint[],
    insertion: Insertion,
    editId: string
): Pick<InsertionCapture, 'after' | 'changedBeats' | 'changedPointIds'> | null {
    const planned =
        insertion.kind === 'point'
            ? insertAutomationPointAtBeat(before, insertion.point)
            : planAutomationShapeInsertion(
                  { ...range, points: before },
                  insertion.shape,
                  insertion.startBeat,
                  insertion.endBeat,
                  insertion.cycles
              );
    if (planned === null) {
        return null;
    }

    const original = new Set(before);
    const retained = new Set(planned);
    const removed = before.filter((point) => !retained.has(point));
    const occupiedIds = new Set(before.map((point) => point.id));
    const added: AutomationPoint[] = [];
    const after = planned.map((point, index) => {
        if (original.has(point)) {
            return point;
        }
        const generated = { ...point, id: `auto-point-${editId}-${index}` };
        added.push(generated);
        return generated;
    });
    if (
        added.length === 0 ||
        added.some((point) => occupiedIds.has(point.id)) ||
        !isRestorableAutomationPointSet(after)
    ) {
        return null;
    }

    const changed = [...removed, ...added];
    return {
        after,
        changedBeats: [...new Set(changed.map((point) => point.beat))],
        changedPointIds: changed.flatMap((point) => (point.id === undefined ? [] : [point.id])),
    };
}

export function isCapturedLaneInsertion(payload: unknown): boolean {
    if (
        !isRecord(payload) ||
        !isNonEmptyString(payload.laneId) ||
        !isLaneInsertion(payload.insertion) ||
        !isInsertionOwner(payload.owner) ||
        !isRecord(payload.capture) ||
        (payload.direction !== undefined && payload.direction !== 'undo')
    ) {
        return false;
    }
    const { laneObjectId, editId, minValue, maxValue, before, after, changedBeats, changedPointIds } = payload.capture;
    if (
        !isNonEmptyString(laneObjectId) ||
        !isNonEmptyString(editId) ||
        !isFiniteNumber(minValue) ||
        !isFiniteNumber(maxValue) ||
        !isRestorableAutomationPointSet(before) ||
        !isRestorableAutomationPointSet(after)
    ) {
        return false;
    }

    const planned = planLaneInsertion({ ...payload.owner, minValue, maxValue }, before, payload.insertion, editId);
    return (
        planned !== null &&
        pointsMatch(after, planned.after) &&
        valuesEqual(changedBeats, planned.changedBeats) &&
        valuesEqual(changedPointIds, planned.changedPointIds)
    );
}

export function isLaneInsertionSessionEntry(entry: HandlerSessionActionEntry): boolean {
    const { action, inverseAction, redoAction } = entry;
    return (
        action.type === 'insertAutomationLanePoints' &&
        action.payload.direction === undefined &&
        isCapturedLaneInsertion(action.payload) &&
        inverseAction?.type === action.type &&
        valuesEqual(inverseAction.payload, { ...action.payload, direction: 'undo' }) &&
        redoAction === undefined
    );
}
