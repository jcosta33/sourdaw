import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { markerStore } from '../../stores/markerStore';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { restoreMarkerSnapshot } from '../restoreMarkerSnapshot';

function reset_metadata_stores(): void {
    markerStore.set({ markers: [], sections: [] });
    takeLaneStore.set({ lanes: [] });
}

describe('restoreMarkerSnapshot', () => {
    beforeEach(() => {
        reset_metadata_stores();
    });

    afterEach(() => {
        reset_metadata_stores();
    });

    it('sanitizes markers without overwriting take-lane state', () => {
        const take_lane_state = {
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    takes: [],
                    activeCompRegions: [],
                },
            ],
        };
        const valid_marker = { id: 'marker-1', beat: 4, name: 'Verse', color: '#ffffff' };
        const valid_section = {
            id: 'section-1',
            startBeat: 4,
            endBeat: 12,
            name: 'Verse',
            color: '#111111',
        };
        takeLaneStore.set(take_lane_state);

        restoreMarkerSnapshot({
            markers: [valid_marker, { id: 'bad-marker', beat: -1, name: 'Broken', color: '#000000' }],
            sections: [
                valid_section,
                {
                    id: 'bad-section',
                    startBeat: 12,
                    endBeat: 4,
                    name: 'Backwards',
                    color: '#000000',
                },
            ],
        });

        expect(markerStore.value).toEqual({
            markers: [valid_marker],
            sections: [valid_section],
        });
        expect(takeLaneStore.value).toBe(take_lane_state);
    });
});
