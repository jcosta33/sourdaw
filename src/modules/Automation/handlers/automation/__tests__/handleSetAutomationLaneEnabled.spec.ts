import { beforeEach, describe, expect, it } from 'vitest';

import { createAutomationLane } from '../../../models/Automation';
import { automationStore } from '../../../stores/automationStore';
import { handleSetAutomationLaneEnabled } from '../handleSetAutomationLaneEnabled';

const LANE_ID = 'lane-1';

function seedLane(enabled: boolean): void {
    automationStore.set({
        lanes: [
            {
                ...createAutomationLane('track-1', 'gain', 'Gain'),
                id: LANE_ID,
                enabled,
            },
        ],
    });
}

describe('handleSetAutomationLaneEnabled', () => {
    beforeEach(() => {
        seedLane(true);
    });

    it('changes the lane and describes an inverse that restores the prior value', () => {
        const action = {
            type: 'setAutomationLaneEnabled' as const,
            payload: { laneId: LANE_ID, enabled: false },
        };

        const description = handleSetAutomationLaneEnabled.describe(action);
        void handleSetAutomationLaneEnabled.execute(action);

        expect(automationStore.value?.lanes[0]?.enabled).toBe(false);
        expect(description.inverseAction).toEqual({
            type: 'setAutomationLaneEnabled',
            payload: { laneId: LANE_ID, enabled: true },
        });

        if (description.inverseAction?.type !== 'setAutomationLaneEnabled') {
            throw new Error('Expected an automation-lane enablement inverse');
        }
        void handleSetAutomationLaneEnabled.execute(description.inverseAction);
        expect(automationStore.value?.lanes[0]?.enabled).toBe(true);
    });

    it('treats missing lanes and unchanged values as no-ops', () => {
        expect(
            handleSetAutomationLaneEnabled.isNoop?.({
                type: 'setAutomationLaneEnabled',
                payload: { laneId: LANE_ID, enabled: true },
            })
        ).toBe(true);
        expect(
            handleSetAutomationLaneEnabled.isNoop?.({
                type: 'setAutomationLaneEnabled',
                payload: { laneId: 'missing-lane', enabled: false },
            })
        ).toBe(true);
    });
});
