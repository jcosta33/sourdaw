import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AutomationStoreState } from '../../../stores/automationStore';
import { removeAutomationPointById } from '../removeAutomationPointById';

const mocks = vi.hoisted(() => ({
    state: { value: null as AutomationStoreState | null },
    set: vi.fn(),
}));

vi.mock('../../../stores/automationStore', () => ({
    automationStore: {
        get value() {
            return mocks.state.value;
        },
        set: mocks.set,
    },
}));

describe('removeAutomationPointById', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.state.value = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    parameterId: 'gain',
                    parameterName: 'Gain',
                    points: [
                        { id: 'remote-point', beat: 2, value: 0.25, curve: 'linear', tension: 0 },
                        { id: 'ai-point', beat: 4, value: 0.5, curve: 'linear', tension: 0 },
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
    });

    it('removes only the exact point identity after array order changes', () => {
        removeAutomationPointById('lane-1', 'ai-point');

        expect(mocks.set).toHaveBeenCalledWith({
            lanes: [
                expect.objectContaining({
                    id: 'lane-1',
                    points: [{ id: 'remote-point', beat: 2, value: 0.25, curve: 'linear', tension: 0 }],
                }),
            ],
        });
    });

    it('does not write when the stable point identity no longer exists', () => {
        removeAutomationPointById('lane-1', 'missing');

        expect(mocks.set).not.toHaveBeenCalled();
    });
});
