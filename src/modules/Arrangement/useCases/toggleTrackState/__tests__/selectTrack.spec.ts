import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type Track } from '#/modules/Arrangement/models/Track';
import { setMidiInputTrack } from '#/modules/AudioEngine/useCases/webMidiInput/setMidiInputTrack';
import { selectTrack } from '../selectTrack';

vi.mock('#/modules/AudioEngine/useCases/webMidiInput/setMidiInputTrack', () => ({
    setMidiInputTrack: vi.fn(),
}));

const mockUpdateTrackState = vi.fn();
vi.mock('#/modules/Arrangement/repositories/track/updateTrackState', () => ({
    updateTrackState: (...args: any[]) => mockUpdateTrackState(...args)
}));

const mockGetTrackById = vi.fn();
vi.mock('#/modules/Arrangement/repositories/track/getTrackById', () => ({
    getTrackById: (...args: any[]) => mockGetTrackById(...args)
}));

describe('selectTrack', () => {
    beforeEach(() => {
        vi.mocked(setMidiInputTrack).mockClear();
        mockUpdateTrackState.mockReset();
        mockGetTrackById.mockReset();
    });

    it('should update selection and skip midi routing when id is null', () => {
        selectTrack(null);

        expect(mockUpdateTrackState).toHaveBeenCalledWith({ selectedTrackId: null });
        expect(mockGetTrackById).not.toHaveBeenCalled();
        expect(setMidiInputTrack).not.toHaveBeenCalled();
    });

    it('should set midi input when selected track is midi', () => {
        const midiTrack = { kind: 'midi' } as unknown as Track;
        mockGetTrackById.mockReturnValue(midiTrack);

        selectTrack('t-midi');

        expect(mockUpdateTrackState).toHaveBeenCalledWith({ selectedTrackId: 't-midi' });
        expect(setMidiInputTrack).toHaveBeenCalledWith('t-midi');
    });

    it('should not set midi input when selected track is not midi', () => {
        const audioTrack = { kind: 'audio' } as unknown as Track;
        mockGetTrackById.mockReturnValue(audioTrack);

        selectTrack('t-audio');

        expect(setMidiInputTrack).not.toHaveBeenCalled();
    });
});
