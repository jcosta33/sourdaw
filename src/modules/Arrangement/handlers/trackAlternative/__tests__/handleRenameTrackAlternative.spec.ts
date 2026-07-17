import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleRenameTrackAlternative } from '../handleRenameTrackAlternative';

type TrackAlternative = { id: string; name: string };
type Track = { id: string; alternatives: Array<TrackAlternative> };
type TrackStoreState = { tracks: Array<Track> };

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn<() => TrackStoreState>(),
    setTrackStoreState: vi.fn<(state: TrackStoreState) => void>(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/setTrackStoreState', () => ({
    setTrackStoreState: mocks.setTrackStoreState,
}));

describe('handleRenameTrackAlternative', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renames the correct alternative', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    alternatives: [
                        { id: 'alt1', name: 'Old' },
                        { id: 'alt2', name: 'Other' },
                    ],
                },
            ],
        });

        void handleRenameTrackAlternative.execute({
            type: 'renameTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt1', name: 'New' },
        });

        const newState = mocks.setTrackStoreState.mock.calls[0]?.[0];
        if (!newState) {
            throw new Error('expected setTrackStoreState to have been called');
        }
        expect(newState.tracks[0]?.alternatives[0]?.name).toBe('New');
        expect(newState.tracks[0]?.alternatives[1]?.name).toBe('Other');
    });
});
