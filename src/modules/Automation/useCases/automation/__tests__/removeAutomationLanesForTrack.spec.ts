import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutomationLane } from '../../../models/Automation';
import type { AutomationStoreState } from '../../../stores/automationStore';

const mocks = vi.hoisted(() => {
    const state: { value: AutomationStoreState | null } = { value: null };

    return {
        state,
        getValue: vi.fn((): AutomationStoreState | null => state.value),
        set: vi.fn((nextState: AutomationStoreState): void => {
            state.value = nextState;
        }),
    };
});

vi.mock('../../../stores/automationStore', () => ({
    automationStore: {
        get value(): AutomationStoreState | null {
            return mocks.getValue();
        },
        set: mocks.set,
    },
}));

const { removeAutomationLanesForTrack } = await import('../removeAutomationLanesForTrack');

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

describe('removeAutomationLanesForTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.state.value = { lanes: [] };
    });

    it('removes every lane for a track in one owner-store update', () => {
        const firstTargetLane = createLane('lane-1', 'track-1');
        const unrelatedLane = createLane('lane-2', 'track-2');
        const secondTargetLane = createLane('lane-3', 'track-1');
        mocks.state.value = { lanes: [firstTargetLane, unrelatedLane, secondTargetLane] };

        removeAutomationLanesForTrack('track-1');

        expect(mocks.getValue).toHaveBeenCalledTimes(1);
        expect(mocks.set).toHaveBeenCalledTimes(1);
        expect(mocks.set).toHaveBeenCalledWith({ lanes: [unrelatedLane] });
        expect(mocks.state.value).toEqual({ lanes: [unrelatedLane] });
    });

    it('does not write when the owner store is unavailable', () => {
        mocks.state.value = null;

        removeAutomationLanesForTrack('track-1');

        expect(mocks.getValue).toHaveBeenCalledTimes(1);
        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('does not write when no lane matches the track', () => {
        const unrelatedLane = createLane('lane-2', 'track-2');
        const previousState: AutomationStoreState = { lanes: [unrelatedLane] };
        mocks.state.value = previousState;

        removeAutomationLanesForTrack('track-1');

        expect(mocks.getValue).toHaveBeenCalledTimes(1);
        expect(mocks.set).not.toHaveBeenCalled();
        expect(mocks.state.value).toBe(previousState);
    });
});
