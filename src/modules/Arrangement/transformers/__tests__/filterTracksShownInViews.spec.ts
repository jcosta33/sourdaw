import { describe, expect, it } from 'vitest';

import { filterTracksShownInViews } from '../filterTracksShownInViews';

type TestTrack = { id: string; kind: string; parentId: string | null; hidden: boolean };

function track(id: string, overrides: Partial<TestTrack> = {}): TestTrack {
    return { id, kind: 'audio', parentId: null, hidden: false, ...overrides };
}

const ids = (tracks: readonly TestTrack[]): string[] => tracks.map((item) => item.id);

describe('filterTracksShownInViews', () => {
    const tracks = [
        track('shown'),
        track('hidden', { hidden: true }),
        track('folder', { kind: 'folder', hidden: true }),
        track('in-folder', { parentId: 'folder' }),
        track('deep-folder', { kind: 'folder', parentId: 'folder' }),
        track('deep-child', { parentId: 'deep-folder' }),
        track('open-folder', { kind: 'folder' }),
        track('in-open-folder', { parentId: 'open-folder' }),
        track('master', { kind: 'master', hidden: true }),
    ];

    it('leaves out a hidden track and every descendant of a hidden folder', () => {
        expect(ids(filterTracksShownInViews(tracks, false))).toEqual([
            'shown',
            'open-folder',
            'in-open-folder',
            'master',
        ]);
    });

    it('keeps every track, in order, when hidden tracks are shown', () => {
        expect(ids(filterTracksShownInViews(tracks, true))).toEqual(ids(tracks));
    });

    it('never hides the master', () => {
        expect(ids(filterTracksShownInViews([track('master', { kind: 'master', hidden: true })], false))).toEqual([
            'master',
        ]);
    });

    it('terminates on a parent cycle and ignores an unknown parent', () => {
        const cyclic = [track('a', { parentId: 'b' }), track('b', { parentId: 'a' }), track('c', { parentId: 'gone' })];

        expect(ids(filterTracksShownInViews(cyclic, false))).toEqual(['a', 'b', 'c']);
    });
});
