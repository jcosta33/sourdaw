import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setMidiInputTrack } from '#/modules/AudioEngine/useCases/webMidiInput/setMidiInputTrack';

import { type Track } from '../../../models/Track';
import { selectTrack } from '../selectTrack';

vi.mock('#/modules/AudioEngine/useCases/webMidiInput/setMidiInputTrack', () => ({
    setMidiInputTrack: vi.fn(),
}));

const mockUpdateTrackState = vi.fn<(...args: unknown[]) => void>();
vi.mock('../../../repositories/track/updateTrackState', () => ({
    updateTrackState: (...args: unknown[]) => mockUpdateTrackState(...args),
}));

const mockGetTrackById = vi.fn<(...args: unknown[]) => Track | undefined>();
vi.mock('../../../repositories/track/getTrackById', () => ({
    getTrackById: (...args: unknown[]) => mockGetTrackById(...args),
}));

const mockStoreValue = { selectedTrackId: null as string | null };
vi.mock('../../../stores/trackStore', () => ({
    trackStore: {
        get value() {
            return mockStoreValue;
        },
    },
}));

const mockEmit = vi.fn<(...args: unknown[]) => void>();
vi.mock('#/app/registerDependencies', () => ({
    eventBus: {
        emit: (...args: unknown[]) => mockEmit(...args),
        on: vi.fn(() => () => {}),
        off: vi.fn(),
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('selectTrack', () => {
    beforeEach(() => {
        vi.mocked(setMidiInputTrack).mockClear();
        mockUpdateTrackState.mockReset();
        mockGetTrackById.mockReset();
        mockEmit.mockReset();
        mockStoreValue.selectedTrackId = null;
    });

    it('should update selection and skip midi routing when id is null', () => {
        mockStoreValue.selectedTrackId = 't-prev';

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

    it('emits track.selectionChanged when the selection actually changes', () => {
        mockStoreValue.selectedTrackId = 't-old';

        selectTrack('t-new');

        expect(mockEmit).toHaveBeenCalledWith('track.selectionChanged', {
            trackId: 't-new',
            previousTrackId: 't-old',
        });
    });

    it('does not emit track.selectionChanged when the same track is reselected', () => {
        mockStoreValue.selectedTrackId = 't-same';

        selectTrack('t-same');

        expect(mockEmit).not.toHaveBeenCalled();
    });
});
