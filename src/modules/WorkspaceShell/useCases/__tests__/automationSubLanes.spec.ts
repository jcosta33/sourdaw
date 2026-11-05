import { describe, it, expect, vi, beforeEach } from 'vitest';

import { addAutomationSubLane } from '../automationSubLanes/addAutomationSubLane';
import { setAutomationSubLanes } from '../automationSubLanes/helpers';
import { removeAutomationSubLane } from '../automationSubLanes/removeAutomationSubLane';
import { swapAutomationSubLaneParam } from '../automationSubLanes/swapAutomationSubLaneParam';

const mocks = vi.hoisted(() => {
    const timelineEditing: { value: { automationSubLanes: Record<string, string[]> } } = {
        value: { automationSubLanes: {} },
    };
    return { timelineEditing, setTimelineAutomationSubLanes: vi.fn() };
});

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

describe('automationSubLanes injectables', () => {
    beforeEach(() => {
        mocks.setTimelineAutomationSubLanes.mockClear();
        mocks.timelineEditing.value = { automationSubLanes: {} };
    });

    it('should write automation sub-lanes for a track', () => {
        setAutomationSubLanes('t1', ['gain', 'pan']);

        expect(mocks.setTimelineAutomationSubLanes).toHaveBeenCalledWith('t1', ['gain', 'pan']);
    });

    it('should append a parameter id via addAutomationSubLane', () => {
        addAutomationSubLane('t1', 'cutoff');

        expect(mocks.setTimelineAutomationSubLanes).toHaveBeenCalledWith('t1', ['cutoff']);
    });

    it('should remove a lane index via removeAutomationSubLane', () => {
        mocks.timelineEditing.value = { automationSubLanes: { t1: ['a', 'b', 'c'] } };

        removeAutomationSubLane('t1', 1);

        expect(mocks.setTimelineAutomationSubLanes).toHaveBeenCalledWith('t1', ['a', 'c']);
    });

    it('should swap a parameter at an index via swapAutomationSubLaneParam', () => {
        mocks.timelineEditing.value = { automationSubLanes: { t1: ['a', 'b'] } };

        swapAutomationSubLaneParam('t1', 0, 'z');

        expect(mocks.setTimelineAutomationSubLanes).toHaveBeenCalledWith('t1', ['z', 'b']);
    });
});
