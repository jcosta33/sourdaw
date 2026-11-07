import { describe, it, expect } from 'vitest';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { TrackDummy } from '../../__tests__/TrackDummy';
import { collectLiveClipIds } from '../collectLiveClipIds';

describe('collectLiveClipIds', () => {
    it('counts what each track holds now, not the active alternative stale stored copy', () => {
        // `x` was deleted from the main row after the last alternative switch, so
        // only the active alternative's stale stored copy still names it.
        const track = TrackDummy.create({
            id: 't1',
            clips: ['a', 'b'].map((id) => ClipDummy.create({ id, trackId: 't1' })),
            activeAlternativeId: 'alt-1',
            alternatives: [
                {
                    id: 'alt-1',
                    name: 'Alternative 1',
                    clips: ['a', 'x'].map((id) => ClipDummy.create({ id, trackId: 't1' })),
                },
                { id: 'alt-2', name: 'Alternative 2', clips: [ClipDummy.create({ id: 'y', trackId: 't1' })] },
            ],
        });
        const other = TrackDummy.create({
            id: 't2',
            clips: [ClipDummy.create({ id: 'c', trackId: 't2' })],
        });

        expect(collectLiveClipIds([track, other])).toEqual(new Set(['a', 'b', 'y', 'c']));
    });
});
