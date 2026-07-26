import { createHandler } from '#/utils/createHandler';

import { setAutomationLaneEnabled } from '../../useCases/automation/setAutomationLaneEnabled';
import { getAutomationStoreState } from '../../useCases/getAutomationStoreState';

function getLane(laneId: string) {
    return getAutomationStoreState()?.lanes.find((lane) => lane.id === laneId);
}

function getLabel(enabled: boolean, parameterName?: string): string {
    const verb = enabled ? 'Enable' : 'Disable';
    if (!parameterName) {
        return `${verb} automation`;
    }
    return `${verb} automation: ${parameterName}`;
}

export const handleSetAutomationLaneEnabled = createHandler<'setAutomationLaneEnabled'>({
    execute: (action) => {
        setAutomationLaneEnabled(action.payload);
    },
    describe: (action) => {
        const lane = getLane(action.payload.laneId);
        const label = getLabel(action.payload.enabled, lane?.parameterName);
        if (!lane || lane.enabled === action.payload.enabled) {
            return { label };
        }
        return {
            label,
            inverseAction: {
                type: 'setAutomationLaneEnabled',
                payload: { laneId: lane.id, enabled: lane.enabled },
            },
        };
    },
    isNoop: (action) => {
        const lane = getLane(action.payload.laneId);
        return !lane || lane.enabled === action.payload.enabled;
    },
    undoable: true,
});
