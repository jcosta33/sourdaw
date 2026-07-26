import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutomationLane, AutomationPoint } from '../../../models/Automation';
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

const { setAutomationPointCurve } = await import('../setAutomationPointCurve');

function createPoint(beat: number, tension = 0): AutomationPoint {
    return { beat, value: 0.5, curve: 'linear', tension };
}

function createLane(id: string, points: AutomationPoint[]): AutomationLane {
    return {
        id,
        trackId: 'track-1',
        parameterId: 'gain',
        parameterName: 'Gain',
        points,
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
    };
}

describe('setAutomationPointCurve', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.state.value = { lanes: [] };
    });

    it('sets curve and tension for the in-tolerance point and leaves the rest untouched', () => {
        const farPoint = createPoint(4.5, 0);
        const targetLane = createLane('lane-1', [createPoint(4, 0), farPoint]);
        const otherLane = createLane('lane-2', [createPoint(4, 0)]);
        mocks.state.value = { lanes: [targetLane, otherLane] };

        setAutomationPointCurve('lane-1', 4, 'exponential', 0.8);

        expect(mocks.state.value).toEqual({
            lanes: [
                { ...targetLane, points: [{ beat: 4, value: 0.5, curve: 'exponential', tension: 0.8 }, farPoint] },
                otherLane,
            ],
        });
    });

    it('keeps the existing tension when no explicit tension is passed', () => {
        const lane = createLane('lane-1', [createPoint(4, 0.3)]);
        mocks.state.value = { lanes: [lane] };

        setAutomationPointCurve('lane-1', 4, 'step');

        expect(mocks.state.value).toEqual({
            lanes: [{ ...lane, points: [{ beat: 4, value: 0.5, curve: 'step', tension: 0.3 }] }],
        });
    });

    it('does not write when the owner store is unavailable', () => {
        mocks.state.value = null;

        setAutomationPointCurve('lane-1', 4, 'step');

        expect(mocks.set).not.toHaveBeenCalled();
    });
});
