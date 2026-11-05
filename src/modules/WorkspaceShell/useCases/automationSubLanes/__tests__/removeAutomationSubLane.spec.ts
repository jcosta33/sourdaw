import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    timelineEditing: { value: null as { automationSubLanes: Record<string, string[]> } | null },
    setTimelineAutomationSubLanes: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    timelineEditingStore: {
        get value() {
            return mocks.timelineEditing.value;
        },
    },
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    setAutomationSubLanes: mocks.setTimelineAutomationSubLanes,
}));

import { removeAutomationSubLane } from '../removeAutomationSubLane';

describe('removeAutomationSubLane', () => {
    beforeEach(() => {
        mocks.setTimelineAutomationSubLanes.mockClear();
    });

    it('removes the lane at the given index, keeping the rest in order', () => {
        mocks.timelineEditing.value = { automationSubLanes: { t1: ['a', 'b', 'c'] } };

        removeAutomationSubLane('t1', 1);

        expect(mocks.setTimelineAutomationSubLanes).toHaveBeenCalledWith('t1', ['a', 'c']);
    });

    it('defaults to an empty list when the track has no lanes yet', () => {
        mocks.timelineEditing.value = { automationSubLanes: {} };

        // Removing index 0 from a non-existent list → empty list (no throw).
        removeAutomationSubLane('t1', 0);

        expect(mocks.setTimelineAutomationSubLanes).toHaveBeenCalledWith('t1', []);
    });

    it('is a no-op when the timeline editing state is null (guard branch)', () => {
        mocks.timelineEditing.value = null;

        removeAutomationSubLane('t1', 0);

        expect(mocks.setTimelineAutomationSubLanes).not.toHaveBeenCalled();
    });
});
