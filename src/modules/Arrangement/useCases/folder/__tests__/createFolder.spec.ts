import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as subject from '../createFolder';

type TrackState = { tracks: { id: string; name: string; kind: string }[] };

const mocks = vi.hoisted(() => ({
    createTrack: vi.fn<(input: { name: string; kind: string }) => { id: string; name: string; kind: string }>(),
    getTrackState: vi.fn<() => TrackState | null>(),
    setTrackState: vi.fn(),
}));

vi.mock('../../../models/Track', () => ({
    createTrack: (input: { name: string; kind: string }) => mocks.createTrack(input),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../../repositories/track/setTrackState', () => ({
    setTrackState: mocks.setTrackState,
}));

describe('createFolder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.createTrack.mockImplementation((input) => ({ id: 'folder-1', ...input }));
    });

    it('appends a folder track to the track list preserving existing tracks', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', name: 'Drums', kind: 'audio' }] });
        mocks.createTrack.mockReturnValue({ id: 'folder-9', name: 'Vocals', kind: 'folder' });

        subject.createFolder('Vocals');

        expect(mocks.createTrack).toHaveBeenCalledWith({ name: 'Vocals', kind: 'folder' });
        expect(mocks.setTrackState).toHaveBeenCalledTimes(1);
        const next = mocks.setTrackState.mock.calls[0]?.[0] as TrackState;
        expect(next.tracks).toEqual([
            { id: 't1', name: 'Drums', kind: 'audio' },
            { id: 'folder-9', name: 'Vocals', kind: 'folder' },
        ]);
    });

    it('does nothing when the track store has not loaded', () => {
        mocks.getTrackState.mockReturnValue(null);

        subject.createFolder('Vocals');

        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });
});
