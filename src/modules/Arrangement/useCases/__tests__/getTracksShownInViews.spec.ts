import { describe, expect, it } from 'vitest';

import { getTracksShownInViews } from '../getTracksShownInViews';

const tracks = [
    { id: 'shown', kind: 'audio', parentId: null, hidden: false },
    { id: 'hidden', kind: 'midi', parentId: null, hidden: true },
    { id: 'folder', kind: 'folder', parentId: null, hidden: true },
    { id: 'child', kind: 'audio', parentId: 'folder', hidden: false },
    { id: 'master', kind: 'master', parentId: null, hidden: false },
];

describe('getTracksShownInViews', () => {
    it('leaves out hidden tracks and the children of a hidden folder, keeping the master', () => {
        expect(getTracksShownInViews(tracks, false).map((track) => track.id)).toEqual(['shown', 'master']);
    });

    it('keeps every track when the session shows hidden tracks', () => {
        expect(getTracksShownInViews(tracks, true)).toEqual(tracks);
    });
});
