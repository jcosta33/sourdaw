import { afterEach, describe, expect, it } from 'vitest';

import { defaultTimelineEditingState, timelineEditingStore } from '../../../stores/timelineEditingStore';
import { toggleRippleEditing } from '../toggleRippleEditing';

describe('toggleRippleEditing', () => {
    afterEach(() => {
        timelineEditingStore.set(defaultTimelineEditingState);
    });

    it('does not update when the timeline editing state is missing', () => {
        timelineEditingStore.set(null);

        toggleRippleEditing();

        expect(timelineEditingStore.value).toBeNull();
    });

    it('flips ripple editing on and off and leaves the other fields alone', () => {
        timelineEditingStore.set({ ...defaultTimelineEditingState, snapValue: 0.5 });

        toggleRippleEditing();
        expect(timelineEditingStore.value).toEqual({
            ...defaultTimelineEditingState,
            snapValue: 0.5,
            rippleEditing: true,
        });

        toggleRippleEditing();
        expect(timelineEditingStore.value?.rippleEditing).toBe(false);
    });
});
