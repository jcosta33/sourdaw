import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setTrackInput } from '../setTrackInput';

const mocks = vi.hoisted(() => ({
    getTrackById: vi.fn(),
    updateTrack: vi.fn(),
}));

vi.mock('../../repositories/track/getTrackById', () => ({
    getTrackById: mocks.getTrackById,
}));

vi.mock('../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

describe('setTrackInput', () => {
    beforeEach(() => vi.clearAllMocks());

    it('preserves ordinary input assignment', () => {
        mocks.getTrackById.mockReturnValue({ id: 'audio-1', kind: 'audio' });

        setTrackInput('audio-1', 'input-1');

        expect(mocks.updateTrack).toHaveBeenCalledWith('audio-1', expect.any(Function));
    });

    it('rejects dormant VCA input assignment but permits clearing residue', () => {
        mocks.getTrackById.mockReturnValue({ id: 'vca-1', kind: 'vca' });

        setTrackInput('vca-1', 'input-1');
        expect(mocks.updateTrack).not.toHaveBeenCalled();

        setTrackInput('vca-1', null);
        expect(mocks.updateTrack).toHaveBeenCalledWith('vca-1', expect.any(Function));
    });
});
