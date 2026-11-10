import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    setTimelineAutomationSubLanes: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    setAutomationSubLanes: mocks.setTimelineAutomationSubLanes,
}));

import { setAutomationSubLanes } from '../helpers';

describe('setAutomationSubLanes', () => {
    beforeEach(() => {
        mocks.setTimelineAutomationSubLanes.mockClear();
    });

    it('writes the param ids for the given track through the timeline editing owner', () => {
        setAutomationSubLanes('t1', ['gain', 'pan']);

        expect(mocks.setTimelineAutomationSubLanes).toHaveBeenCalledWith('t1', ['gain', 'pan']);
    });
});
