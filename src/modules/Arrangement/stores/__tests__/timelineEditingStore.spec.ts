import { describe, expect, it } from 'vitest';

import { defaultTimelineEditingState, timelineEditingStore } from '../timelineEditingStore';

describe('timelineEditingStore', () => {
    it('starts with ripple off, a one-beat snap and automation lanes hidden', () => {
        expect(defaultTimelineEditingState).toEqual({
            rippleEditing: false,
            snapValue: 1,
            automationVisibility: 'hidden',
            automationSubLanes: {},
        });
        expect(timelineEditingStore.value).toEqual(defaultTimelineEditingState);
    });
});
