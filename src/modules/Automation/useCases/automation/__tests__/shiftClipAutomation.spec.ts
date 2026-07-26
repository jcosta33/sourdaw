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

const { shiftClipAutomation } = await import('../shiftClipAutomation');

function createPoint(beat: number): AutomationPoint {
    return { beat, value: 0.5, curve: 'linear', tension: 0 };
}

function createLane(id: string, clipId: string, points: AutomationPoint[]): AutomationLane {
    return {
        id,
        trackId: 'track-1',
        clipId,
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

describe('shiftClipAutomation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.state.value = { lanes: [] };
    });

    it('shifts points for lanes on the given clip, clamps at 0, and leaves other clips untouched', () => {
        const shifted = createLane('lane-1', 'clip-1', [createPoint(1), createPoint(3)]);
        const unrelated = createLane('lane-2', 'clip-2', [createPoint(5)]);
        mocks.state.value = { lanes: [shifted, unrelated] };

        shiftClipAutomation('clip-1', -2);

        expect(mocks.state.value).toEqual({
            lanes: [{ ...shifted, points: [createPoint(0), createPoint(1)] }, unrelated],
        });
    });

    it('re-sorts points after the clamp collapses their order', () => {
        const lane = createLane('lane-1', 'clip-1', [createPoint(3), createPoint(1)]);
        mocks.state.value = { lanes: [lane] };

        shiftClipAutomation('clip-1', -5);

        expect(mocks.state.value).toEqual({ lanes: [{ ...lane, points: [createPoint(0), createPoint(0)] }] });
    });

    it('does not write when the owner store is unavailable', () => {
        mocks.state.value = null;

        shiftClipAutomation('clip-1', 2);

        expect(mocks.set).not.toHaveBeenCalled();
    });
});
