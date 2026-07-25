import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const automationStoreValue: { value: AutomationStoreState | null } = {
        value: {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [
                        { beat: 2, value: 0.2, curve: 'linear', tension: 0 },
                        { beat: 3, value: 0.3, curve: 'linear', tension: 0 },
                        { beat: 4, value: 0.4, curve: 'linear', tension: 0 },
                        { beat: 6, value: 0.6, curve: 'linear', tension: 0 },
                        { beat: 8, value: 0.8, curve: 'linear', tension: 0 },
                    ],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        },
    };
    return {
        automationStoreValue,
        automationStoreSet: vi.fn(),
    };
});

vi.mock('../../../stores/automationStore', () => ({
    automationStore: {
        get value() {
            return mocks.automationStoreValue.value;
        },
        set: mocks.automationStoreSet,
    },
}));

import { type AutomationStoreState } from '../../../stores/automationStore';
import { deleteAutomationTimeRange } from '../deleteAutomationTimeRange';

describe('deleteAutomationTimeRange', () => {
    beforeEach(() => {
        mocks.automationStoreValue.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [
                        { beat: 2, value: 0.2, curve: 'linear', tension: 0 },
                        { beat: 3, value: 0.3, curve: 'linear', tension: 0 },
                        { beat: 4, value: 0.4, curve: 'linear', tension: 0 },
                        { beat: 6, value: 0.6, curve: 'linear', tension: 0 },
                        { beat: 8, value: 0.8, curve: 'linear', tension: 0 },
                    ],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        };
        mocks.automationStoreSet.mockClear();
    });

    it('removes points in the range and shifts the end boundary left', () => {
        deleteAutomationTimeRange({ startBeat: 3, endBeat: 6 });

        expect(mocks.automationStoreSet).toHaveBeenCalledExactlyOnceWith({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [
                        { beat: 2, value: 0.2, curve: 'linear', tension: 0 },
                        { beat: 3, value: 0.6, curve: 'linear', tension: 0 },
                        { beat: 5, value: 0.8, curve: 'linear', tension: 0 },
                    ],
                    objects: [],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        });
    });

    it('does not write when the store has no state', () => {
        mocks.automationStoreValue.value = null;

        deleteAutomationTimeRange({ startBeat: 0, endBeat: 4 });

        expect(mocks.automationStoreSet).not.toHaveBeenCalled();
    });
});
