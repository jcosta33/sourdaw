import { describe, it, expect, vi, beforeEach } from 'vitest';

import { armTrack } from '../armTrack';

const mocks = vi.hoisted(() => ({
    updateTrack: vi.fn(),
    getTrackById: vi.fn(),
    setMidiInputTrack: vi.fn(),
    getMidiInputTrack: vi.fn<() => string | null>(),
}));

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('../../../repositories/track/getTrackById', () => ({
    getTrackById: mocks.getTrackById,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    setMidiInputTrack: mocks.setMidiInputTrack,
    getMidiInputTrack: mocks.getMidiInputTrack,
}));

describe('armTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getMidiInputTrack.mockReturnValue(null);
    });

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

    it('disarms a track without touching MIDI input pointed elsewhere', () => {
        armTrack('t1', false);
        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        expect(mocks.setMidiInputTrack).not.toHaveBeenCalled();
    });

    it('clears MIDI input routing on disarm when it points at the track', () => {
        mocks.getMidiInputTrack.mockReturnValue('t1');

        armTrack('t1', false);

        expect(mocks.setMidiInputTrack).toHaveBeenCalledWith(null);
    });

    it('leaves MIDI input routing alone on disarm when it points at another track', () => {
        mocks.getMidiInputTrack.mockReturnValue('t2');

        armTrack('t1', false);

        expect(mocks.setMidiInputTrack).not.toHaveBeenCalled();
    });

    it('restores routing across an arm -> disarm -> re-arm (redo) sequence', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', kind: 'midi' });
        let routing: string | null = null;
        mocks.setMidiInputTrack.mockImplementation((next: string | null) => {
            routing = next;
        });
        mocks.getMidiInputTrack.mockImplementation(() => routing);

        armTrack('t1', true);
        expect(routing).toBe('t1');

        // Undo of the arm disarms and must clear the routing it created.
        armTrack('t1', false);
        expect(routing).toBeNull();

        // Redo of the arm re-routes input to the re-armed track.
        armTrack('t1', true);
        expect(routing).toBe('t1');
    });
});
