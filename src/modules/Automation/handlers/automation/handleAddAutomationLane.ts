import { trackStore } from '#/modules/Arrangement/stores';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { addAutomationLane } from '../../useCases/automation/addAutomationLane';
import { getAutomationParameterRangeResolver } from '../../useCases/automation/getAutomationParameterRangeResolver';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

type AddAutomationLaneAction = {
    payload: { trackId: string; parameterId: string; parameterName: string; laneId?: string };
};

type StoredAutomationLane = NonNullable<ReturnType<typeof getAutomationStoreState>>['lanes'][number];

/** The track's own controls, which every track carries and no device resolves. */
const TRACK_PARAMETER_IDS: ReadonlySet<string> = new Set(['gain', 'pan']);

function ensureLaneId(action: AddAutomationLaneAction): string {
    if (action.payload.laneId) {
        return action.payload.laneId;
    }
    const laneId = `auto-${crypto.randomUUID()}`;
    action.payload.laneId = laneId;
    return laneId;
}

function isAddAutomationLaneNoop(action: AddAutomationLaneAction): boolean {
    const state = getAutomationStoreState();
    if (!state) {
        return false;
    }
    const existingLane = state.lanes.find(
        (lane) =>
            lane.id === action.payload.laneId ||
            (!lane.clipId && lane.trackId === action.payload.trackId && lane.parameterId === action.payload.parameterId)
    );
    if (!existingLane) {
        return false;
    }
    action.payload.laneId = existingLane.id;
    return true;
}

/**
 * A device parameter is a target only when the owner's resolver hands back its
 * range: the resolver already answers null for a missing track, a device the
 * track does not carry, and a parameter no curve may drive.
 */
function isAutomatableTarget({ trackId, parameterId }: AddAutomationLaneAction['payload']): boolean {
    if (TRACK_PARAMETER_IDS.has(parameterId)) {
        return true;
    }
    const resolveParameterRange = getAutomationParameterRangeResolver();
    return (
        resolveParameterRange !== null && resolveParameterRange({ trackId, parameterTargetId: parameterId }) !== null
    );
}

function referencesLane(candidate: AppAction, laneId: string): boolean {
    const payload: unknown = 'payload' in candidate ? candidate.payload : undefined;
    return typeof payload === 'object' && payload !== null && 'laneId' in payload && payload.laneId === laneId;
}

function isSameTrackLevelTarget(
    lane: Pick<StoredAutomationLane, 'id' | 'trackId' | 'parameterId' | 'clipId'>,
    action: AddAutomationLaneAction
): boolean {
    return (
        lane.id !== action.payload.laneId &&
        !lane.clipId &&
        lane.trackId === action.payload.trackId &&
        lane.parameterId === action.payload.parameterId
    );
}

/** A lane an earlier member of the same batch creates for this track and parameter. */
function findEarlierBatchLaneId(
    action: AddAutomationLaneAction,
    context: HandlerValidationContext
): string | undefined {
    for (const candidate of context.actions.slice(0, context.actionIndex)) {
        if (candidate.type !== 'addAutomationLane' || candidate.payload.laneId === undefined) {
            continue;
        }
        if (isSameTrackLevelTarget({ ...candidate.payload, id: candidate.payload.laneId }, action)) {
            return candidate.payload.laneId;
        }
    }
    return undefined;
}

/**
 * The id of the track-level lane this action would silently fold into while a
 * later member of the same batch still writes to the lane it names.
 *
 * On its own, adding a lane the track already has is a no-op that retargets
 * the action onto the existing lane. A later member addressed the new id,
 * though, and nothing retargets it, so its write would land on no lane at all.
 * An earlier member creating the same track lane displaces it the same way.
 */
function findDisplacedTrackLevelLaneId(
    action: AddAutomationLaneAction,
    context: HandlerValidationContext | undefined
): string | undefined {
    const laneId = action.payload.laneId;
    if (!context || laneId === undefined) {
        return undefined;
    }
    if (!context.actions.slice(context.actionIndex + 1).some((candidate) => referencesLane(candidate, laneId))) {
        return undefined;
    }
    const storedLane = getAutomationStoreState()?.lanes.find((lane) => isSameTrackLevelTarget(lane, action));
    return storedLane?.id ?? findEarlierBatchLaneId(action, context);
}

function findAddAutomationLaneRefusal(
    action: AddAutomationLaneAction,
    context: HandlerValidationContext
): string | null {
    const { trackId, parameterId } = action.payload;
    if (!trackStore.value?.tracks.some((track) => track.id === trackId)) {
        return `Track is unavailable: ${trackId}`;
    }
    if (!isAutomatableTarget(action.payload)) {
        return `Parameter ${parameterId} is not an automatable target on track ${trackId}.`;
    }
    const displacedLaneId = findDisplacedTrackLevelLaneId(action, context);
    if (displacedLaneId) {
        return `Track ${trackId} already automates ${parameterId} on lane ${displacedLaneId}; write points to that lane instead.`;
    }
    return null;
}

export const handleAddAutomationLane = createHandler<'addAutomationLane'>({
    execute: (action) => {
        addAutomationLane(
            action.payload.trackId,
            action.payload.parameterId,
            action.payload.parameterName,
            ensureLaneId(action)
        );
    },
    validate: (action, context) => findAddAutomationLaneRefusal(action, context) === null,
    validationRefusalReason: findAddAutomationLaneRefusal,
    describe: (action, context) => {
        const label = `Add automation: ${action.payload.parameterName}`;
        // A displaced lane must keep its own id, so validation can still see the
        // later member addressing it and refuse the batch by name.
        if (!findDisplacedTrackLevelLaneId(action, context) && isAddAutomationLaneNoop(action)) {
            return { label };
        }
        return {
            label,
            inverseAction: {
                type: 'removeAutomationLane',
                payload: { laneId: ensureLaneId(action) },
            },
        };
    },
    isNoop: isAddAutomationLaneNoop,
    undoable: true,
});
