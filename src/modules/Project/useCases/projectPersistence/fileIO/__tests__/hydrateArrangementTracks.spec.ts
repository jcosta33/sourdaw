import { describe, expect, it } from 'vitest';

import { type ProjectFreezeState } from '../../../../stores/arrangementStore';
import { hydrateArrangementTracks } from '../hydrateArrangementTracks';

function hydrate(track: { frozen?: boolean; frozenBufferId?: string; freezeState?: ProjectFreezeState }) {
    const [hydrated] = hydrateArrangementTracks([{ id: 't1', name: 'T', kind: 'audio', clips: [], ...track }]);
    if (!hydrated) {
        throw new Error('Expected one hydrated track');
    }
    return hydrated;
}

describe('hydrateArrangementTracks freeze state', () => {
    it('settles a project saved mid-render with no take to unfrozen', () => {
        const track = hydrate({ freezeState: { status: 'freezing', renderProgress: 0.6 } });

        expect(track.freezeState).toEqual({ status: 'unfrozen' });
        expect(track.frozen).toBe(false);
        expect(track.frozenBufferId).toBeUndefined();
    });

    it('settles a refresh saved mid-render to a stale take, keeping the take it was replacing', () => {
        const track = hydrate({
            frozen: true,
            frozenBufferId: 'old-take',
            freezeState: { status: 'freezing', freezeId: 'old-take', frozenBufferId: 'old-take', renderProgress: 0.2 },
        });

        expect(track.freezeState).toEqual({ status: 'stale', freezeId: 'old-take', frozenBufferId: 'old-take' });
        expect(track.frozen).toBe(true);
        expect(track.frozenBufferId).toBe('old-take');
    });

    it.each<ProjectFreezeState>([
        { status: 'unfrozen' },
        { status: 'frozen', freezeId: 'f', frozenBufferId: 'f' },
        { status: 'stale', freezeId: 'f', frozenBufferId: 'f' },
        { status: 'error', errorMessage: 'Render crashed' },
    ])('keeps a saved $status status as it was', (freezeState) => {
        expect(hydrate({ freezeState }).freezeState).toEqual(freezeState);
    });
});
