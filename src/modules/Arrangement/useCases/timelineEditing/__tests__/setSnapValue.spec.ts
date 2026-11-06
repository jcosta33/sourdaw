import { afterEach, describe, expect, it } from 'vitest';

import { defaultTimelineEditingState, timelineEditingStore } from '../../../stores/timelineEditingStore';
import { setSnapValue } from '../setSnapValue';

describe('setSnapValue', () => {
    afterEach(() => {
        timelineEditingStore.set(defaultTimelineEditingState);
    });

    it('does not update when the timeline editing state is missing', () => {
        timelineEditingStore.set(null);

        setSnapValue(0.25);

        expect(timelineEditingStore.value).toBeNull();
    });

    it('writes the snap value and leaves the other fields alone', () => {
        timelineEditingStore.set({ ...defaultTimelineEditingState, rippleEditing: true });

        setSnapValue(0.25);

        expect(timelineEditingStore.value).toEqual({
            ...defaultTimelineEditingState,
            rippleEditing: true,
            snapValue: 0.25,
        });
    });
});
