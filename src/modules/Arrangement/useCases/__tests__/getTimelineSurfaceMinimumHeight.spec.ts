import { describe, expect, it } from 'vitest';

import { createTrack, type Track } from '../../models/Track';
import { getTimelineSurfaceMinimumHeight } from '../getTimelineSurfaceMinimumHeight';

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

describe('getTimelineSurfaceMinimumHeight', () => {
    it('uses the selected visible track height as the timeline minimum', () => {
        const tracks = [
            makeTrack({ id: 'first', kind: 'midi', height: 48 }),
            makeTrack({ id: 'selected', kind: 'midi', height: 96 }),
        ];

        expect(getTimelineSurfaceMinimumHeight(tracks, 'selected')).toBe(96);
    });

    it('falls back to a visible non-folder when the selected child is collapsed in folder', () => {
        const tracks = [
            makeTrack({ id: 'folder', kind: 'folder', collapsed: true }),
            makeTrack({ id: 'child', kind: 'midi', parentId: 'folder', height: 96 }),
            makeTrack({ id: 'fallback', kind: 'midi', height: 64 }),
        ];

        expect(getTimelineSurfaceMinimumHeight(tracks, 'child')).toBe(64);
    });

    it('excludes master tracks and falls back to the rendered folder row', () => {
        const tracks = [
            makeTrack({ id: 'master', kind: 'master', height: 200 }),
            makeTrack({ id: 'folder', kind: 'folder', height: 80 }),
        ];

        expect(getTimelineSurfaceMinimumHeight(tracks, 'master')).toBe(26);
    });
});
