import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { markerStore, type MarkerStoreState } from '../../stores/markerStore';
import { takeLaneStore, type TakeLaneStoreState } from '../../stores/takeLaneStore';
import { restoreArrangementMetadataSnapshot } from '../restoreArrangementMetadataSnapshot';

function reset_metadata_stores(): void {
    markerStore.set({ markers: [], sections: [] });
    takeLaneStore.set({ lanes: [] });
}

describe('restoreArrangementMetadataSnapshot', () => {
    beforeEach(() => {
        reset_metadata_stores();
    });

    afterEach(() => {
        reset_metadata_stores();
    });

    it('preserves exact marker and take-lane snapshot objects and IDs', () => {
        const marker = { id: 'marker-1', beat: 4, name: 'Verse', color: '#ffffff' };
        const section = {
            id: 'section-1',
            startBeat: 4,
            endBeat: 12,
            name: 'Verse',
            color: '#111111',
        };
        const marker_state = {
            markers: [marker],
            sections: [section],
        } satisfies MarkerStoreState;
        const take = {
            id: 'take-1',
            clipId: 'clip-1',
            name: 'Lead',
            startBeat: 0,
            endBeat: 4,
            selected: true,
        };
        const take_lane = {
            id: 'lane-1',
            trackId: 'track-1',
            takes: [take],
            activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: take.id }],
        };
        const take_lane_state = { lanes: [take_lane] } satisfies TakeLaneStoreState;

        restoreArrangementMetadataSnapshot({
            markers: marker_state,
            takeLanes: take_lane_state,
        });

        expect(markerStore.value).toBe(marker_state);
        expect(markerStore.value?.markers[0]).toBe(marker);
        expect(markerStore.value?.markers[0]?.id).toBe(marker.id);
        expect(takeLaneStore.value).toBe(take_lane_state);
        expect(takeLaneStore.value?.lanes[0]).toBe(take_lane);
        expect(takeLaneStore.value?.lanes[0]?.takes[0]?.id).toBe(take.id);
    });

    it('clears stale metadata stores when snapshot values are omitted', () => {
        markerStore.set({
            markers: [{ id: 'stale-marker', beat: 1, name: 'Stale', color: '#ffffff' }],
            sections: [],
        });
        takeLaneStore.set({
            lanes: [
                {
                    id: 'stale-lane',
                    trackId: 'track-1',
                    takes: [],
                    activeCompRegions: [],
                },
            ],
        });

        restoreArrangementMetadataSnapshot({});

        expect(markerStore.value).toEqual({ markers: [], sections: [] });
        expect(takeLaneStore.value).toEqual({ lanes: [] });
    });

    it('sanitizes malformed neighboring metadata records independently', () => {
        const valid_marker = { id: 'marker-1', beat: 4, name: 'Verse', color: '#ffffff' };
        const valid_section = {
            id: 'section-1',
            startBeat: 4,
            endBeat: 12,
            name: 'Verse',
            color: '#111111',
        };
        const valid_lane = {
            id: 'lane-1',
            trackId: 'track-1',
            takes: [],
            activeCompRegions: [],
        };

        restoreArrangementMetadataSnapshot({
            markers: {
                markers: [valid_marker, { id: 'bad-marker', beat: Number.NaN, name: 'Broken', color: '#000000' }],
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
            },
            takeLanes: {
                lanes: [
                    valid_lane,
                    {
                        id: 'bad-lane',
                        trackId: 'track-2',
                        takes: 'not-an-array',
                        activeCompRegions: [],
                    },
                ],
            },
        });

        expect(markerStore.value).toEqual({
            markers: [valid_marker],
            sections: [valid_section],
        });
        expect(takeLaneStore.value).toEqual({ lanes: [valid_lane] });
    });
});
