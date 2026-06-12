import { describe, it, expect, vi, beforeEach } from 'vitest';

import { addAutomationPoint } from '../addAutomationPoint';
import { getAutomationValueAtBeat } from '../getAutomationValueAtBeat';
import { removeAutomationPoint } from '../removeAutomationPoint';
import { updateAutomationPoint } from '../updateAutomationPoint';

const mocks = vi.hoisted(() => ({
    automationStoreValue: { value: { lanes: [] } },
    automationStoreSet: vi.fn(),
    interpolateAutomationPointValue: vi.fn(),
}));

vi.mock('../../../stores/automationStore', () => ({
    automationStore: {
        get value() {
            return mocks.automationStoreValue.value;
        },
        set: mocks.automationStoreSet,
    },
}));

vi.mock('../../../services/automationPointAlgorithms', () => ({
    interpolateAutomationPointValue: mocks.interpolateAutomationPointValue,
}));

describe('Automation Point Use Cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.automationStoreValue.value = { lanes: [] } as any;
    });

    it('addAutomationPoint adds and sorts points', () => {
        mocks.automationStoreValue.value = {
            lanes: [{ id: 'l1', points: [{ beat: 10, value: 0.5 }] }],
        } as any;

        addAutomationPoint('l1', { beat: 5, value: 0.2, curve: 0 });

        expect(mocks.automationStoreSet).toHaveBeenCalledWith({
            lanes: [
                {
                    id: 'l1',
                    points: [
                        { beat: 5, value: 0.2, curve: 0 },
                        { beat: 10, value: 0.5 },
                    ],
                },
            ],
        });
    });

    it('removeAutomationPoint removes point at beat', () => {
        mocks.automationStoreValue.value = {
            lanes: [
                {
                    id: 'l1',
                    points: [
                        { beat: 5, value: 0.2 },
                        { beat: 10, value: 0.5 },
                    ],
                },
            ],
        } as any;

        removeAutomationPoint('l1', 5);

        expect(mocks.automationStoreSet).toHaveBeenCalledWith({
            lanes: [{ id: 'l1', points: [{ beat: 10, value: 0.5 }] }],
        });
    });

    it('updateAutomationPoint changes value and optionally beat', () => {
        mocks.automationStoreValue.value = {
            lanes: [
                {
                    id: 'l1',
                    points: [
                        { beat: 5, value: 0.2 },
                        { beat: 10, value: 0.5 },
                    ],
                },
            ],
        } as any;

        updateAutomationPoint('l1', 5, 0.8, 6);

        expect(mocks.automationStoreSet).toHaveBeenCalledWith({
            lanes: [
                {
                    id: 'l1',
                    points: [
                        { beat: 6, value: 0.8 },
                        { beat: 10, value: 0.5 },
                    ],
                },
            ],
        });
    });

    describe('getAutomationValueAtBeat', () => {
        it('returns first point value if beat is before all points', () => {
            const points = [
                { beat: 5, value: 0.2 },
                { beat: 10, value: 0.5 },
            ];
            mocks.automationStoreValue.value = { lanes: [{ id: 'l1', points }] } as any;

            expect(getAutomationValueAtBeat('l1', 0)).toBe(0.2);
        });

        it('returns last point value if beat is after all points', () => {
            const points = [
                { beat: 5, value: 0.2 },
                { beat: 10, value: 0.5 },
            ];
            mocks.automationStoreValue.value = { lanes: [{ id: 'l1', points }] } as any;

            expect(getAutomationValueAtBeat('l1', 20)).toBe(0.5);
        });

        it('interpolates between points', () => {
            const points = [
                { beat: 5, value: 0.2 },
                { beat: 10, value: 0.5 },
            ];
            mocks.automationStoreValue.value = { lanes: [{ id: 'l1', points }] } as any;
            mocks.interpolateAutomationPointValue.mockReturnValue(0.35);

            const val = getAutomationValueAtBeat('l1', 7.5);

            expect(val).toBe(0.35);
            expect(mocks.interpolateAutomationPointValue).toHaveBeenCalledWith({
                firstPoint: points[0],
                secondPoint: points[1],
                beat: 7.5,
            });
        });
    });
});
