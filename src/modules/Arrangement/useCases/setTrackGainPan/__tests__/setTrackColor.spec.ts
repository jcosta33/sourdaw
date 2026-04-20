import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setTrackColor } from '../setTrackColor';

const mocks = vi.hoisted(() => ({
    updateTrack: vi.fn(),
}));

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

describe('setTrackColor', () => {
    beforeEach(() => vi.clearAllMocks());

    it('updates track color', () => {
        setTrackColor('t1', '#ff0000');
        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        const updater = mocks.updateTrack.mock.calls[0][1];
        expect(updater({ color: '#000000' })).toEqual({ color: '#ff0000' });
    });
});
