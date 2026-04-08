import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type Track } from '#/modules/Arrangement/models/Track';
import { setMidiInputTrack } from '#/modules/AudioEngine/useCases/webMidiInput';
import { selectTrack } from './selectTrack';

vi.mock('#/modules/AudioEngine/useCases/webMidiInput', () => ({
    setMidiInputTrack: vi.fn(),
}));

describe('selectTrack', () => {
    beforeEach(() => {
        vi.mocked(setMidiInputTrack).mockClear();
    });

    it('should update selection and skip midi routing when id is null', () => {
        const updateTrackState = vi.fn();
        const getTrackById = vi.fn();
        injectDependencies(selectTrack, { updateTrackState, getTrackById });

        selectTrack(null);

        expect(updateTrackState).toHaveBeenCalledWith({ selectedTrackId: null });
        expect(getTrackById).not.toHaveBeenCalled();
        expect(setMidiInputTrack).not.toHaveBeenCalled();
    });

    it('should set midi input when selected track is midi', () => {
        const updateTrackState = vi.fn();
        const midiTrack = { kind: 'midi' } as unknown as Track;
        const getTrackById = vi.fn(() => midiTrack);
        injectDependencies(selectTrack, { updateTrackState, getTrackById });

        selectTrack('t-midi');

        expect(updateTrackState).toHaveBeenCalledWith({ selectedTrackId: 't-midi' });
        expect(setMidiInputTrack).toHaveBeenCalledWith('t-midi');
    });

    it('should not set midi input when selected track is not midi', () => {
        const updateTrackState = vi.fn();
        const audioTrack = { kind: 'audio' } as unknown as Track;
        const getTrackById = vi.fn(() => audioTrack);
        injectDependencies(selectTrack, { updateTrackState, getTrackById });

        selectTrack('t-audio');

        expect(setMidiInputTrack).not.toHaveBeenCalled();
    });
});
