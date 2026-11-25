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

    describe('hidden tracks', () => {
        const tracks = [
            makeTrack({ id: 'shown', kind: 'audio' }),
            makeTrack({ id: 'hidden-track', kind: 'midi', hidden: true }),
            makeTrack({ id: 'hidden-folder', kind: 'folder', hidden: true }),
            makeTrack({ id: 'in-hidden-folder', kind: 'audio', parentId: 'hidden-folder' }),
            makeTrack({ id: 'nested-folder', kind: 'folder', parentId: 'hidden-folder' }),
            makeTrack({ id: 'in-nested-folder', kind: 'audio', parentId: 'nested-folder' }),
            makeTrack({ id: 'master', kind: 'master', hidden: true }),
        ];

        it('leaves a hidden track and every descendant of a hidden folder out', () => {
            expect(getVisibleTimelineTracks(tracks).map((track) => track.id)).toEqual(['shown']);
        });

        it('shows hidden tracks again, in project order, when the session shows hidden tracks', () => {
            expect(getVisibleTimelineTracks(tracks, true).map((track) => track.id)).toEqual([
                'shown',
                'hidden-track',
                'hidden-folder',
                'in-hidden-folder',
                'nested-folder',
                'in-nested-folder',
            ]);
        });

        it('keeps collapsed-folder behaviour while hidden tracks are shown', () => {
            const collapsed = [
                makeTrack({ id: 'folder', kind: 'folder', collapsed: true, hidden: true }),
                makeTrack({ id: 'child', kind: 'audio', parentId: 'folder' }),
            ];

            expect(getVisibleTimelineTracks(collapsed, true).map((track) => track.id)).toEqual(['folder']);
        });
    });
});
