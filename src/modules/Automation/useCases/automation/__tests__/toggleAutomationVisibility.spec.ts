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

const { toggleAutomationVisibility } = await import('../toggleAutomationVisibility');

function createLane(id: string, overrides: Partial<AutomationLane> = {}): AutomationLane {
    return {
        id,
        trackId: 'track-1',
        parameterId: `parameter-${id}`,
        parameterName: `Parameter ${id}`,
        points: [],
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
        ...overrides,
    };
}

describe('toggleAutomationVisibility', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.state.value = { lanes: [] };
    });

    it('flips visible on the matching lane only, in both directions', () => {
        mocks.state.value = {
            lanes: [createLane('lane-1', { visible: true }), createLane('lane-2', { visible: false })],
        };

        toggleAutomationVisibility('lane-1');

        expect(mocks.state.value).toEqual({
            lanes: [createLane('lane-1', { visible: false }), createLane('lane-2', { visible: false })],
        });

        toggleAutomationVisibility('lane-1');

        expect(mocks.state.value).toEqual({
            lanes: [createLane('lane-1', { visible: true }), createLane('lane-2', { visible: false })],
        });
    });

    it('does not write when the owner store is unavailable', () => {
        mocks.state.value = null;

        toggleAutomationVisibility('lane-1');

        expect(mocks.set).not.toHaveBeenCalled();
    });
});
