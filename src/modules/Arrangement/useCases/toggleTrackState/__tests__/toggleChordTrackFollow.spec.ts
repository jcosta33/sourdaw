import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toggleChordTrackFollow } from '../toggleChordTrackFollow';

const mocks = vi.hoisted(() => ({
    updateTrack: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

describe('toggleChordTrackFollow', () => {
    beforeEach(() => vi.clearAllMocks());

    it('should call updateTrack with a patch that toggles followChordTrack', () => {
        toggleChordTrackFollow('t1');

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));

        const patch = mocks.updateTrack.mock.calls[0]![1] as (t: { followChordTrack: boolean; id: string }) => {
            followChordTrack: boolean;
            id: string;
        };
        expect(patch({ followChordTrack: false, id: 't1' })).toEqual({ followChordTrack: true, id: 't1' });
        expect(patch({ followChordTrack: true, id: 't1' })).toEqual({ followChordTrack: false, id: 't1' });
    });
});
