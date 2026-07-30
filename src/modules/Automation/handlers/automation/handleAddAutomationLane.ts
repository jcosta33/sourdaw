import { createHandler } from '#/utils/createHandler';

import { addAutomationLane } from '../../useCases/automation/addAutomationLane';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

type AddAutomationLaneAction = {
    payload: { trackId: string; parameterId: string; parameterName: string; laneId?: string };
};

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

export const handleAddAutomationLane = createHandler<'addAutomationLane'>({
    execute: (action) => {
        addAutomationLane(
            action.payload.trackId,
            action.payload.parameterId,
            action.payload.parameterName,
            ensureLaneId(action)
        );
    },
    describe: (action) => {
        const label = `Add automation: ${action.payload.parameterName}`;
        if (isAddAutomationLaneNoop(action)) {
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
