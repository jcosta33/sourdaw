import { gainLaneLevelLaw, type LevelResolution, resolveLevelFields } from '#/utils/audioLevelLaw';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { addAutomationPoint } from '../../useCases/automation/addAutomationPoint';
import { getAutomationLaneCeiling } from '../../useCases/automation/getAutomationLaneCeiling';
import { getAutomationValueAtBeat } from '../../useCases/automation/getAutomationValueAtBeat';
import { isLinearGainAutomationLane } from '../../useCases/automation/isLinearGainAutomationLane';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

type AddAutomationPointAction = Extract<AppAction, { type: 'addAutomationPoint' }>;
type AddAutomationLaneAction = Extract<AppAction, { type: 'addAutomationLane' }>;

function ensurePointId(action: { payload: { pointId?: string } }): string {
    if (action.payload.pointId) {
        return action.payload.pointId;
    }
    const pointId = `auto-point-${crypto.randomUUID()}`;
    action.payload.pointId = pointId;
    return pointId;
}

type StoredAutomationLane = NonNullable<ReturnType<typeof getAutomationStoreState>>['lanes'][number];

function findLane(laneId: string): StoredAutomationLane | undefined {
    return getAutomationStoreState()?.lanes.find((candidate) => candidate.id === laneId);
}

/**
 * The lane-native value this action asks for, whichever way it asked.
 *
 * A lane's native unit is whatever its parameter measures — a pan position, a
 * filter cutoff, a millisecond — and only a linear-amplitude gain lane measures
 * something decibels describe. The decibel forms are therefore refused
 * everywhere else by name rather than converted into a unit they do not belong
 * to, and a relative request is measured from the value the lane already draws
 * at this beat.
 */
function requestedValue(action: AddAutomationPointAction): LevelResolution {
    const { value, valueDb, deltaDb } = action.payload;
    if ([value, valueDb, deltaDb].filter((field) => field !== undefined).length !== 1) {
        return {
            ok: false,
            reason: "State the point value exactly once: in the lane's own units, as an absolute level in decibels, or as a relative change in decibels.",
        };
    }
    if (value !== undefined) {
        if (!Number.isFinite(value)) {
            return { ok: false, reason: 'A point value must be a finite number.' };
        }
        return { ok: true, linear: value };
    }
    const lane = findLane(action.payload.laneId);
    if (!lane) {
        return { ok: false, reason: `Automation lane is unavailable: ${action.payload.laneId}` };
    }
    if (!isLinearGainAutomationLane(lane)) {
        return {
            ok: false,
            reason: `Lane "${lane.parameterName}" does not hold gain amplitudes, so its points are stated in the lane's own units rather than in decibels.`,
        };
    }
    const law = gainLaneLevelLaw({ minValue: lane.minValue, maxValue: getAutomationLaneCeiling(lane) });
    if (deltaDb === undefined) {
        return resolveLevelFields({ absoluteDb: valueDb }, lane.minValue, law);
    }
    const currentValue = getAutomationValueAtBeat(lane.id, action.payload.beat);
    if (currentValue === null) {
        return {
            ok: false,
            reason: `Lane "${lane.parameterName}" holds no value at beat ${String(action.payload.beat)}, so there is nothing to change relative to.`,
        };
    }
    return resolveLevelFields({ deltaDb }, currentValue, law);
}

function findFollowerRefusal(lane: StoredAutomationLane): string | null {
    if (!lane.linkedLaneId) {
        return null;
    }
    return `Lane "${lane.parameterName}" follows automation lane ${lane.linkedLaneId}; add points to its source lane instead.`;
}

function earlierBatchActions(context: HandlerValidationContext): readonly AppAction[] {
    return context.actions.slice(0, context.actionIndex);
}

/** The member earlier in this batch that creates the lane this point is written to, if any. */
function findEarlierLaneProducer(
    action: AddAutomationPointAction,
    context: HandlerValidationContext
): AddAutomationLaneAction | undefined {
    return earlierBatchActions(context).find(
        (candidate): candidate is AddAutomationLaneAction =>
            candidate.type === 'addAutomationLane' && candidate.payload.laneId === action.payload.laneId
    );
}

function statesDecibels(action: AddAutomationPointAction): boolean {
    return action.payload.valueDb !== undefined || action.payload.deltaDb !== undefined;
}

/**
 * A point is admitted onto a lane the project holds, unless that lane follows
 * another, or onto a lane an earlier member of this batch creates. Only a gain
 * lane holds amplitudes decibels describe; a lane the batch has not created yet
 * is judged by the parameter its producer names, because the store cannot be
 * asked about it until that producer has run.
 */
function findAddAutomationPointRefusal(
    action: AddAutomationPointAction,
    context: HandlerValidationContext
): string | null {
    const lane = findLane(action.payload.laneId);
    if (lane) {
        return findFollowerRefusal(lane);
    }
    const producer = findEarlierLaneProducer(action, context);
    if (!producer) {
        return `Automation lane ${action.payload.laneId} is neither in the project nor created earlier in this batch.`;
    }
    if (statesDecibels(action) && producer.payload.parameterId !== 'gain') {
        return `Lane "${producer.payload.parameterName}" does not hold gain amplitudes, so its points are stated in the lane's own units rather than in decibels.`;
    }
    return null;
}

function countEarlierBatchPointsBefore(action: AddAutomationPointAction, context: HandlerValidationContext): number {
    return earlierBatchActions(context).filter(
        (candidate) =>
            candidate.type === 'addAutomationPoint' &&
            candidate.payload.laneId === action.payload.laneId &&
            candidate.payload.beat < action.payload.beat
    ).length;
}

/**
 * Where this point lands among its lane's points once every earlier member of
 * the batch has run, or null when no lane will be there to hold it.
 */
function findInsertedPointIndex(
    action: AddAutomationPointAction,
    context: HandlerValidationContext | undefined
): number | null {
    const lane = findLane(action.payload.laneId);
    const earlierBatchPoints = context ? countEarlierBatchPointsBefore(action, context) : 0;
    if (lane) {
        return lane.points.filter((point) => point.beat < action.payload.beat).length + earlierBatchPoints;
    }
    if (!context || !findEarlierLaneProducer(action, context)) {
        return null;
    }
    return earlierBatchPoints;
}

export const handleAddAutomationPoint = createHandler<'addAutomationPoint'>({
    validate: (action, context) => findAddAutomationPointRefusal(action, context) === null,
    validationRefusalReason: findAddAutomationPointRefusal,
    execute: (action) => {
        const lane = findLane(action.payload.laneId);
        const followerRefusal = lane ? findFollowerRefusal(lane) : null;
        if (followerRefusal) {
            return { status: 'conflict', reason: followerRefusal };
        }
        const requested = requestedValue(action);
        if (!requested.ok) {
            return { status: 'conflict', reason: requested.reason };
        }
        addAutomationPoint(action.payload.laneId, {
            id: ensurePointId(action),
            beat: action.payload.beat,
            value: requested.linear,
            curve: action.payload.curve ?? 'linear',
            tension: action.payload.tension ?? 0,
            stairSteps: action.payload.stairSteps,
            cp1: action.payload.cp1,
            cp2: action.payload.cp2,
        });
        return { status: 'written' };
    },
    describe: (action, context) => {
        const insertedIndex = findInsertedPointIndex(action, context);
        if (insertedIndex === null) {
            return { label: 'Add automation point' };
        }
        const pointId = ensurePointId(action);
        return {
            label: 'Add automation point',
            inverseAction: {
                type: 'removeAutomationPoint',
                payload: { laneId: action.payload.laneId, pointIndex: insertedIndex, pointId },
            },
        };
    },
    undoable: true,
});
