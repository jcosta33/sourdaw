import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutomationStoreState } from '../../stores/automationStore';

const mocks = vi.hoisted(() => ({
    set: vi.fn<(new_value: AutomationStoreState) => void>(),
}));

vi.mock('../../stores/automationStore', async (import_original) => {
    const actual = await import_original<typeof import('../../stores/automationStore')>();

    return {
        ...actual,
        automationStore: { set: mocks.set },
    };
});

const { restoreAutomationSnapshot } = await import('../restoreAutomationSnapshot');

function create_valid_state(): AutomationStoreState {
    return {
        lanes: [
            {
                id: 'lane-1',
                trackId: 'track-1',
                parameterId: 'gain',
                parameterName: 'Gain',
                points: [],
                objects: [],
                visible: true,
                enabled: true,
                collapsed: false,
                minValue: 0,
                maxValue: 1,
            },
        ],
    };
}

describe('restoreAutomationSnapshot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('preserves a valid snapshot when writing the Automation store', () => {
        const snapshot = create_valid_state();

        restoreAutomationSnapshot(snapshot);

        expect(mocks.set).toHaveBeenCalledOnce();
        expect(mocks.set.mock.calls[0]?.[0]).toBe(snapshot);
    });

    it('sanitizes a malformed neighboring lane before writing the Automation store', () => {
        const valid_state = create_valid_state();
        const snapshot = {
            lanes: [
                valid_state.lanes[0],
                {
                    ...valid_state.lanes[0],
                    id: 'malformed-lane',
                    trackId: 7,
                },
            ],
        };

        restoreAutomationSnapshot(snapshot);

        expect(mocks.set).toHaveBeenCalledWith(valid_state);
    });
});
