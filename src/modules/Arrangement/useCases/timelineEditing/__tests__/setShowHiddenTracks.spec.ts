import { afterEach, describe, expect, it } from 'vitest';

import { defaultTimelineEditingState, timelineEditingStore } from '../../../stores/timelineEditingStore';
import { setShowHiddenTracks } from '../setShowHiddenTracks';

describe('setShowHiddenTracks', () => {
    afterEach(() => {
        timelineEditingStore.set(defaultTimelineEditingState);
    });

    it('does not update when the timeline editing state is missing', () => {
        timelineEditingStore.set(null);

        setShowHiddenTracks(true);

        expect(timelineEditingStore.value).toBeNull();
    });

    it('turns the flag on and off and leaves the other fields alone', () => {
        timelineEditingStore.set({ ...defaultTimelineEditingState, snapValue: 0.5 });

        setShowHiddenTracks(true);
        expect(timelineEditingStore.value).toEqual({
            ...defaultTimelineEditingState,
            snapValue: 0.5,
            showHiddenTracks: true,
        });

        setShowHiddenTracks(false);
        expect(timelineEditingStore.value?.showHiddenTracks).toBe(false);
    });

    it('writes nothing when the flag already has that value', () => {
        const before = timelineEditingStore.value;

        setShowHiddenTracks(false);

        expect(timelineEditingStore.value).toBe(before);
    });
});
