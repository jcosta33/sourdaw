import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { defaultTimelineEditingState, timelineEditingStore } from '../../../stores/timelineEditingStore';
import { trackStore } from '../../../stores/trackStore';
import { initTrackSelectionVisibility } from '../../initTrackSelectionVisibility';
import { selectTrack } from '../selectTrack';
import { selectTrackRevealingHidden } from '../selectTrackRevealingHidden';

describe('selectTrackRevealingHidden', () => {
    let stop: () => void;

    beforeEach(() => {
        injectDependencies(selectTrack, { eventBus: { emit: async () => {} } });
        timelineEditingStore.set(defaultTimelineEditingState);
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'a' }), TrackDummy.create({ id: 'b', hidden: true })],
            selectedTrackId: 'a',
        });
        stop = initTrackSelectionVisibility();
    });

    afterEach(() => {
        stop();
        timelineEditingStore.set(defaultTimelineEditingState);
        trackStore.set({ tracks: [], selectedTrackId: null });
    });

    it('shows hidden tracks and selects a hidden track, which the reconciler then leaves selected', () => {
        selectTrackRevealingHidden('b');

        expect(timelineEditingStore.value?.showHiddenTracks).toBe(true);
        expect(trackStore.value?.selectedTrackId).toBe('b');
        expect(trackStore.value?.tracks.find((track) => track.id === 'b')?.hidden).toBe(true);
    });

    it('leaves the flag alone when selecting a shown track', () => {
        selectTrackRevealingHidden('a');

        expect(timelineEditingStore.value?.showHiddenTracks).toBe(false);
        expect(trackStore.value?.selectedTrackId).toBe('a');
    });
});
