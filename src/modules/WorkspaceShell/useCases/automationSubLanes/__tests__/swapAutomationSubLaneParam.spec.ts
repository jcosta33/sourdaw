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

import { swapAutomationSubLaneParam } from '../swapAutomationSubLaneParam';

describe('swapAutomationSubLaneParam', () => {
    beforeEach(() => {
        mocks.setTimelineAutomationSubLanes.mockClear();
    });

    it('replaces the param id at the given index', () => {
        mocks.timelineEditing.value = { automationSubLanes: { t1: ['gain', 'pan'] } };

        swapAutomationSubLaneParam('t1', 1, 'cutoff');

        expect(mocks.setTimelineAutomationSubLanes).toHaveBeenCalledWith('t1', ['gain', 'cutoff']);
    });

    it('does not mutate the existing lane list in place', () => {
        const original = ['gain', 'pan'];
        mocks.timelineEditing.value = { automationSubLanes: { t1: original } };

        swapAutomationSubLaneParam('t1', 0, 'cutoff');

        // The source array must be copied, not mutated in place.
        expect(original).toEqual(['gain', 'pan']);
    });

    it('defaults to an empty list when the track has no lanes yet', () => {
        mocks.timelineEditing.value = { automationSubLanes: {} };

        // Swapping index 0 on a non-existent list creates [newParamId].
        swapAutomationSubLaneParam('t1', 0, 'cutoff');

        expect(mocks.setTimelineAutomationSubLanes).toHaveBeenCalledWith('t1', ['cutoff']);
    });

    it('is a no-op when the timeline editing state is null (guard branch)', () => {
        mocks.timelineEditing.value = null;

        swapAutomationSubLaneParam('t1', 0, 'cutoff');

        expect(mocks.setTimelineAutomationSubLanes).not.toHaveBeenCalled();
    });
});
