import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAutomationLane, type AutomationPoint } from '../../../models/Automation';

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

const { duplicateClipAutomation } = await import('../duplicateClipAutomation');

describe('duplicateClipAutomation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('copies lanes belonging to the source clip onto the new clip', () => {
        const sourcePoint: AutomationPoint = {
            beat: 0,
            value: 0.5,
            curve: 'bezier',
            tension: 0,
            cp1: { x: 0.2, y: 0.3 },
        };
        const sourceLane = {
            ...createAutomationLane('t1', 'gain', 'Gain'),
            id: 'source',
            clipId: 'clip-a',
            visible: false,
            points: [sourcePoint],
        };
        const otherLane = { ...createAutomationLane('t1', 'pan', 'Pan'), id: 'other', clipId: 'clip-b' };
        mocks.state.value = { lanes: [sourceLane, otherLane] };

        duplicateClipAutomation('clip-a', 'clip-c');

        const lanes = mocks.state.value.lanes;
        expect(lanes).toHaveLength(3);
        const copy = lanes[2]!;
        expect(copy.clipId).toBe('clip-c');
        expect(copy.visible).toBe(false);
        expect(copy.points).toEqual([sourcePoint]);

        copy.points[0]!.cp1!.x = 0.99;
        expect(sourcePoint.cp1!.x).toBe(0.2);
    });

    it('does nothing when no lane matches the source clip', () => {
        mocks.state.value = {
            lanes: [{ ...createAutomationLane('t1', 'gain', 'Gain'), id: 'a', clipId: 'clip-b' }],
        };

        duplicateClipAutomation('clip-a', 'clip-c');

        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('does nothing when the store is unavailable', () => {
        mocks.state.value = null;
        duplicateClipAutomation('clip-a', 'clip-c');
        expect(mocks.set).not.toHaveBeenCalled();
    });
});
