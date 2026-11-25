import { type AppAction, type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { resolveAutomationCurveSplit } from '#/utils/resolveAutomationCurveSplit';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { type AutomationLane, type AutomationPoint } from '../../models/Automation';
import { insertAutomationPointAtBeat } from '../../services/insertAutomationPointAtBeat';
import { is_exact_automation_point } from '../../stores/automationStore';
import { DEFAULT_BEAT_MERGE_EPSILON } from '../../useCases/automation/batchAddAutomationPoints';
import { getAutomationLaneCeiling } from '../../useCases/automation/getAutomationLaneCeiling';
import { mergeAutomationPointBatch } from '../../useCases/automation/mergeAutomationPointBatch';
import { planAutomationShapeInsertion } from '../../useCases/automationShapes';

import { automationPointSnapshotsMatch as pointsMatch } from './automationPointSnapshotsMatch';
import { isRestorableAutomationPointSet } from './validateRangeWriteSessionEntries';

export type InsertAutomationLanePoints = Extract<AppAction, { type: 'insertAutomationLanePoints' }>;
type Insertion = InsertAutomationLanePoints['payload']['insertion'];
type DraftPoint = Omit<AutomationPoint, 'id'>;
type ValidatedInsertion =
    | Exclude<Insertion, { kind: 'point' | 'stroke' }>
    | { kind: 'point'; point: DraftPoint }
    | { kind: 'stroke'; points: readonly DraftPoint[] };
export type InsertionOwner = InsertAutomationLanePoints['payload']['owner'];
export type InsertionCapture = NonNullable<InsertAutomationLanePoints['payload']['capture']>;
type LaneRange = Pick<AutomationLane, 'parameterId' | 'clipId' | 'minValue' | 'maxValue'>;

const SHAPES: ReadonlySet<unknown> = new Set(['sine', 'triangle', 'sawtooth-up', 'sawtooth-down', 'square', 'random']);
// The menu asks for one cycle. Bound planning cost for action data read from a session.
const MAX_CYCLES = 1024;
const MAX_STROKE_POINTS = 4096;

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeBeat(value: unknown): value is number {
    return isFiniteNumber(value) && value >= 0;
}

function isCycleCount(value: unknown): boolean {
    return (
        value === undefined ||
        (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_CYCLES)
    );
}

function isStrokeInsertion(insertion: Record<string, unknown>): boolean {
    const { points } = insertion;
    if (!Array.isArray(points) || points.length === 0 || points.length > MAX_STROKE_POINTS) {
        return false;
    }
    for (const point of points) {
        if (!is_exact_automation_point(point) || Object.hasOwn(point, 'id')) {
            return false;
        }
    }
    return Object.keys(insertion).length === 2;
}

export function isLaneInsertion(insertion: unknown): insertion is ValidatedInsertion {
    if (!isRecord(insertion)) {
        return false;
    }
    if (insertion.kind === 'point') {
        return is_exact_automation_point(insertion.point) && !Object.hasOwn(insertion.point, 'id');
    }
    if (insertion.kind === 'stroke') {
        return isStrokeInsertion(insertion);
    }
    if (insertion.kind === 'split') {
        return Object.keys(insertion).length === 2 && isNonNegativeBeat(insertion.beat);
    }
    const { startBeat, endBeat, cycles } = insertion;
    return (
        insertion.kind === 'shape' &&
        SHAPES.has(insertion.shape) &&
        isNonNegativeBeat(startBeat) &&
        isFiniteNumber(endBeat) &&
        startBeat < endBeat &&
        isCycleCount(cycles)
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

function planInsertionPoints(range: LaneRange, before: AutomationPoint[], insertion: ValidatedInsertion) {
    if (insertion.kind === 'point') {
        return insertAutomationPointAtBeat(before, insertion.point);
    }
    if (insertion.kind === 'stroke') {
        const maxValue = getAutomationLaneCeiling(range);
        const points = insertion.points.map((point) => ({
            ...point,
            value: Math.max(range.minValue, Math.min(maxValue, point.value)),
        }));
        return mergeAutomationPointBatch(before, points, DEFAULT_BEAT_MERGE_EPSILON);
    }
    if (insertion.kind === 'split') {
        const point = resolveAutomationCurveSplit(before, insertion.beat);
        return point === undefined ? null : insertAutomationPointAtBeat(before, point);
    }
    return planAutomationShapeInsertion(
        { ...range, points: before },
        insertion.shape,
        insertion.startBeat,
        insertion.endBeat,
        insertion.cycles
    );
}

export function planLaneInsertion(
    range: LaneRange,
    before: AutomationPoint[],
    insertion: ValidatedInsertion,
    editId: string
): Pick<InsertionCapture, 'after' | 'changedBeats' | 'changedPointIds'> | null {
    const planned = planInsertionPoints(range, before, insertion);
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

function matchesInsertionPlan(capture: unknown, owner: InsertionOwner, insertion: ValidatedInsertion): boolean {
    if (!isRecord(capture)) {
        return false;
    }
    const { laneObjectId, editId, minValue, maxValue, before, after, changedBeats, changedPointIds } = capture;
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

    const planned = planLaneInsertion({ ...owner, minValue, maxValue }, before, insertion, editId);
    return (
        planned !== null &&
        pointsMatch(after, planned.after) &&
        valuesEqual(changedBeats, planned.changedBeats) &&
        valuesEqual(changedPointIds, planned.changedPointIds)
    );
}

export function isCapturedLaneInsertion(payload: unknown): boolean {
    return (
        isRecord(payload) &&
        isNonEmptyString(payload.laneId) &&
        isLaneInsertion(payload.insertion) &&
        isInsertionOwner(payload.owner) &&
        (payload.direction === undefined || payload.direction === 'undo') &&
        matchesInsertionPlan(payload.capture, payload.owner, payload.insertion)
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
