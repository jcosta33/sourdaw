import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setTrackNotes } from '../setTrackNotes';

const mocks = vi.hoisted(() => ({
    updateTrack: vi.fn(),
}));

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

describe('setTrackNotes', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updates track notes', () => {
        setTrackNotes('t1', 'Some notes');
        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        const call = mocks.updateTrack.mock.calls[0];
        if (!call) {
            throw new Error('expected updateTrack to be called');
        }
        const updater = call[1];
        expect(updater({ notes: '' })).toEqual({ notes: 'Some notes' });
    });
});
