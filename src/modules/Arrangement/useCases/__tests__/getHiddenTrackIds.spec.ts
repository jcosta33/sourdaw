import { describe, expect, it } from 'vitest';

import { getHiddenTrackIds } from '../getHiddenTrackIds';

describe('getHiddenTrackIds', () => {
    it('names hidden tracks and descendants of a hidden folder, not shown tracks or the master', () => {
        const tracks = [
            { id: 'shown', kind: 'audio', parentId: null, hidden: false },
            { id: 'hidden', kind: 'audio', parentId: null, hidden: true },
            { id: 'folder', kind: 'folder', parentId: null, hidden: true },
            { id: 'child', kind: 'audio', parentId: 'folder', hidden: false },
            { id: 'master', kind: 'master', parentId: null, hidden: true },
        ];

        expect([...getHiddenTrackIds(tracks)].sort()).toEqual(['child', 'folder', 'hidden']);
    });
});
