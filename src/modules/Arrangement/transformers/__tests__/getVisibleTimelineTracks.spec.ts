import { describe, expect, it } from 'vitest';

import { createTrack, type Track } from '../../models/Track';
import { getVisibleTimelineTracks } from '../getVisibleTimelineTracks';

function makeTrack(overrides: Partial<Track> & Pick<Track, 'id' | 'kind'>): Track {
    return {
        ...createTrack({
            id: overrides.id,
            kind: overrides.kind,
            name: overrides.name ?? overrides.id,
            initialDeviceId: `${overrides.id}-device`,
            initialAlternativeId: `${overrides.id}-alternative`,
        }),
        ...overrides,
    };
}

describe('getVisibleTimelineTracks', () => {
    it('filters out master tracks and children of collapsed folders', () => {
        const tracks = [
            makeTrack({ id: 'folder', kind: 'folder', collapsed: true }),
            makeTrack({ id: 'child', kind: 'midi', parentId: 'folder', height: 96 }),
            makeTrack({ id: 'open-folder', kind: 'folder', collapsed: false }),
            makeTrack({ id: 'open-child', kind: 'audio', parentId: 'open-folder', height: 80 }),
            makeTrack({ id: 'master', kind: 'master', height: 200 }),
            makeTrack({ id: 'root-track', kind: 'midi', height: 64 }),
        ];

        expect(getVisibleTimelineTracks(tracks).map((track) => track.id)).toEqual([
            'folder',
            'open-folder',
            'open-child',
            'root-track',
        ]);
    });
});
