import { describe, expect, it } from 'vitest';

import { defaultTimelineEditingState, timelineEditingStore } from '../timelineEditingStore';

describe('timelineEditingStore', () => {
    it('starts with ripple off, a one-beat snap and automation lanes hidden, and hidden tracks left out', () => {
        expect(defaultTimelineEditingState).toEqual({
            rippleEditing: false,
            snapValue: 1,
            automationVisibility: 'hidden',
            automationSubLanes: {},
            showHiddenTracks: false,
        });
        expect(timelineEditingStore.value).toEqual(defaultTimelineEditingState);
    });
});
