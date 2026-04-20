import { describe, it, expect, vi, beforeEach } from 'vitest';

import { armTrack } from '../armTrack';

const mocks = vi.hoisted(() => ({
    updateTrack: vi.fn(),
    getTrackById: vi.fn(),
    setMidiInputTrack: vi.fn(),
}));

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('../../../repositories/track/getTrackById', () => ({
    getTrackById: mocks.getTrackById,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    setMidiInputTrack: mocks.setMidiInputTrack,
}));

describe('armTrack', () => {
    beforeEach(() => vi.clearAllMocks());

    it('arms a track and sets it as MIDI input in engine if MIDI track', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', kind: 'midi' });

        armTrack('t1', true);

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        expect(mocks.setMidiInputTrack).toHaveBeenCalledWith('t1');
    });

    it('arms a track but does not set MIDI input if not MIDI', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', kind: 'audio' });

        armTrack('t1', true);

        expect(mocks.updateTrack).toHaveBeenCalled();
        expect(mocks.setMidiInputTrack).not.toHaveBeenCalled();
    });

    it('disarms a track', () => {
        armTrack('t1', false);
        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        expect(mocks.setMidiInputTrack).not.toHaveBeenCalled();
    });
});
