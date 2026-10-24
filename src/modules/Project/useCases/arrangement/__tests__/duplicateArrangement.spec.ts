import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { markerStore, trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';

import {
    arrangementStore,
    defaultArrangementId,
    defaultArrangementStoreState,
    type ArrangementStoreState,
} from '../../../stores/arrangementStore';
import { duplicateArrangement } from '../duplicateArrangement';
import { loadSnapshot } from '../loadSnapshot';
import { switchArrangement } from '../switchArrangement';

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getAudioContext: vi.fn(() => null),
    prepareCachedAudioBuffersFromIdb: vi.fn(async () => ({ publish: () => {}, cancel: () => {} })),
}));

vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/useCases')>()),
    stopPlayback: vi.fn(async () => {}),
}));

// A canonical RFC-4122 UUID after the `arr-` prefix. The previous implementation
// truncated to `crypto.randomUUID().slice(0, 8)` (an 8-hex-char id with a high
// collision risk at scale); this regression pins the full-UUID id.
const ARRANGEMENT_ID_PATTERN = /^arr-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function seed(): void {
    arrangementStore.set(structuredClone(defaultArrangementStoreState));
    loadSnapshot(defaultArrangementStoreState.arrangements[0]!);
}

describe('duplicateArrangement', () => {
    beforeEach(() => {
        seed();
    });

    afterEach(() => {
        seed();
    });

    it('assigns the clone a full-UUID id distinct from the source', () => {
        duplicateArrangement(defaultArrangementId, 'Copy');

        const state = arrangementStore.value as ArrangementStoreState;
        const clone = state.arrangements.find((arrangement) => arrangement.name === 'Copy');
        expect(clone).toBeDefined();
        expect(clone?.id).toMatch(ARRANGEMENT_ID_PATTERN);
        expect(clone?.id).not.toBe(defaultArrangementId);
        expect(state.activeArrangementId).toBe(clone?.id);
    });

    it('does not collide across repeated duplications of the same source', () => {
        const ids = new Set<string>();
        for (let index = 0; index < 200; index++) {
            duplicateArrangement(defaultArrangementId, `Copy ${String(index)}`);
            ids.add((arrangementStore.value as ArrangementStoreState).activeArrangementId);
        }
        expect(ids.size).toBe(200);
    });
    it('retains current tracks, clips and markers when returning to the original arrangement', async () => {
        // The stored original is still empty while its live owner stores have newer edits.
        expect(arrangementStore.value?.arrangements[0]?.tracks.tracks).toEqual([]);
        const latestTrack = createTrack({ id: 'track-bass', name: 'Edited bass', kind: 'midi' });
        latestTrack.clips = [
            {
                id: 'clip-bass',
                trackId: latestTrack.id,
                name: 'New phrase',
                startBeat: 4,
                endBeat: 8,
                type: 'midi',
                midiOffsetBeats: 0,
                fadeInBeats: 0,
                fadeOutBeats: 0,
                gain: 1,
                color: '#ff0000',
                locked: false,
                muted: false,
            },
        ];
        const latestMarkers = {
            markers: [{ id: 'marker-verse', beat: 4, name: 'Edited verse', color: '#ff0000' }],
            sections: [],
        };
        trackStore.set({ tracks: [latestTrack], selectedTrackId: latestTrack.id });
        markerStore.set(latestMarkers);

        duplicateArrangement(defaultArrangementId, 'Copy');

        const state = arrangementStore.value;
        const original = state?.arrangements.find((arrangement) => arrangement.id === defaultArrangementId);
        const created = state?.arrangements.find((arrangement) => arrangement.name === 'Copy');
        expect(original?.tracks.tracks).toEqual([latestTrack]);
        expect(original?.markers).toEqual(latestMarkers);
        expect(created?.id).toMatch(ARRANGEMENT_ID_PATTERN);
        expect(created?.id).not.toBe(defaultArrangementId);
        expect(state?.activeArrangementId).toBe(created?.id);
        expect(created?.tracks.tracks).toEqual([latestTrack]);
        expect(created?.markers).toEqual(latestMarkers);

        await switchArrangement(defaultArrangementId);

        expect(arrangementStore.value?.activeArrangementId).toBe(defaultArrangementId);
        expect(trackStore.value?.tracks).toEqual([latestTrack]);
        expect(markerStore.value).toEqual(latestMarkers);
    });
});
