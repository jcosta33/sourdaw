import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutomationLane } from '../../../models/Automation';
import type { AutomationStoreState } from '../../../stores/automationStore';

const mocks = vi.hoisted(() => {
    const state: { value: AutomationStoreState | null } = { value: null };

    return {
        state,
        set: vi.fn((nextState: AutomationStoreState): void => {
            state.value = nextState;
        }),
    };
});

vi.mock('../../../stores/automationStore', () => ({
    automationStore: {
        get value(): AutomationStoreState | null {
            return mocks.state.value;
        },
        set: mocks.set,
    },
}));

const { removeAutomationLane } = await import('../removeAutomationLane');

function createLane(id: string, trackId: string): AutomationLane {
    return {
        id,
        trackId,
        parameterId: `parameter-${id}`,
        parameterName: `Parameter ${id}`,
        points: [],
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
    };
}

describe('removeAutomationLane', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.state.value = { lanes: [] };
    });

    it('removes only the lane matching the given id', () => {
        const first = createLane('lane-1', 'track-1');
        const target = createLane('lane-2', 'track-1');
        const third = createLane('lane-3', 'track-2');
        mocks.state.value = { lanes: [first, target, third] };

        removeAutomationLane('lane-2');

        expect(mocks.state.value).toEqual({ lanes: [first, third] });
    });

    it('writes back an unchanged list when no lane matches the id', () => {
        const lane = createLane('lane-1', 'track-1');
        mocks.state.value = { lanes: [lane] };

        removeAutomationLane('missing-lane');

        expect(mocks.set).toHaveBeenCalledWith({ lanes: [lane] });
    });

    it('does not write when the owner store is unavailable', () => {
        mocks.state.value = null;

        removeAutomationLane('lane-1');

        expect(mocks.set).not.toHaveBeenCalled();
    });
});
