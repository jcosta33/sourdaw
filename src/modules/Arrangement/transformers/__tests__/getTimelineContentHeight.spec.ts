import { describe, expect, it } from 'vitest';

import { createTrack, type Track } from '../../models/Track';
import { getTimelineContentHeight } from '../getTimelineContentHeight';

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

describe('getTimelineContentHeight', () => {
    it('is zero for an empty project', () => {
        expect(getTimelineContentHeight([])).toBe(0);
    });

    it('sums each track own height', () => {
        const tracks = [
            makeTrack({ id: 'a', kind: 'audio', height: 48 }),
            makeTrack({ id: 'b', kind: 'midi', height: 96 }),
            makeTrack({ id: 'c', kind: 'bus', height: 64 }),
        ];

        expect(getTimelineContentHeight(tracks)).toBe(208);
    });

    it('excludes the master track', () => {
        const tracks = [
            makeTrack({ id: 'a', kind: 'audio', height: 100 }),
            makeTrack({ id: 'master', kind: 'master', height: 9999 }),
        ];

        expect(getTimelineContentHeight(tracks)).toBe(100);
    });

    it('counts a folder row at its fixed 26px, not its stored height', () => {
        const tracks = [
            makeTrack({ id: 'folder', kind: 'folder', height: 300, collapsed: false }),
            makeTrack({ id: 'child', kind: 'audio', parentId: 'folder', height: 100 }),
        ];

        expect(getTimelineContentHeight(tracks)).toBe(126);
    });

    it('excludes the children of a collapsed folder', () => {
        const tracks = [
            makeTrack({ id: 'folder', kind: 'folder', height: 300, collapsed: true }),
            makeTrack({ id: 'child-1', kind: 'audio', parentId: 'folder', height: 500 }),
            makeTrack({ id: 'child-2', kind: 'midi', parentId: 'folder', height: 500 }),
            makeTrack({ id: 'loose', kind: 'audio', height: 64 }),
        ];

        expect(getTimelineContentHeight(tracks)).toBe(90);
    });

    it('does not advance past the variation lanes the canvas paints over the next row', () => {
        const tracks = [
            makeTrack({ id: 'lanes', kind: 'audio', height: 64, showVariationLanes: true }),
            makeTrack({ id: 'plain', kind: 'audio', height: 64 }),
        ];

        expect(getTimelineContentHeight(tracks)).toBe(128);
    });
});
