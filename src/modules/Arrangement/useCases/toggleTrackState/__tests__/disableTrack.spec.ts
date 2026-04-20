import { describe, it, expect, vi, beforeEach } from 'vitest';

import { disableTrack } from '../disableTrack';

const mocks = vi.hoisted(() => ({
    updateTrack: vi.fn(),
    getTrackById: vi.fn(),
    engineSetTrackMute: vi.fn(),
}));

vi.mock('#/modules/Arrangement/repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('#/modules/Arrangement/repositories/track/getTrackById', () => ({
    getTrackById: mocks.getTrackById,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    setTrackMute: mocks.engineSetTrackMute,
}));

describe('disableTrack', () => {
    beforeEach(() => vi.clearAllMocks());

    it('disables track and mutes it in engine', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', muted: false });

        disableTrack('t1', true);

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        expect(mocks.engineSetTrackMute).toHaveBeenCalledWith('t1', true);
    });

    it('enables track and restores previous mute state in engine', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', muted: true });

        disableTrack('t1', false);

        expect(mocks.engineSetTrackMute).toHaveBeenCalledWith('t1', true);

        mocks.getTrackById.mockReturnValue({ id: 't1', muted: false });
        disableTrack('t1', false);
        expect(mocks.engineSetTrackMute).toHaveBeenLastCalledWith('t1', false);
    });
});
