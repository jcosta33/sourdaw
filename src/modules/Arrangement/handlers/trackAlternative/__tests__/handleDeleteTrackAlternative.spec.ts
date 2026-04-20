import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDeleteTrackAlternative } from '../handleDeleteTrackAlternative';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    setTrackStoreState: vi.fn(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/setTrackStoreState', () => ({
    setTrackStoreState: mocks.setTrackStoreState,
}));

describe('handleDeleteTrackAlternative', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('deletes the specified alternative', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    alternatives: [
                        { id: 'alt1', clips: [] },
                        { id: 'alt2', clips: [] },
                    ],
                },
            ],
        });

        void handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt2' },
        });

        const newState = mocks.setTrackStoreState.mock.calls[0][0];
        expect(newState.tracks[0].alternatives).toHaveLength(1);
        expect(newState.tracks[0].alternatives[0].id).toBe('alt1');
    });

    it('falls back to another alternative if deleting the active one', () => {
        const alt2Clips = [{ id: 'c2' }];
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [{ id: 'c1' }],
                    alternatives: [
                        { id: 'alt1', clips: [{ id: 'c1' }] },
                        { id: 'alt2', clips: alt2Clips },
                    ],
                },
            ],
        });

        void handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt1' },
        });

        const newState = mocks.setTrackStoreState.mock.calls[0][0];
        const track = newState.tracks[0];
        expect(track.alternatives).toHaveLength(1);
        expect(track.activeAlternativeId).toBe('alt2');
        expect(track.clips).toEqual(alt2Clips);
    });

    it('refuses to delete if only one alternative remains', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', alternatives: [{ id: 'alt1' }] }],
        });

        void handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt1' },
        });

        const newState = mocks.setTrackStoreState.mock.calls[0][0];
        expect(newState.tracks[0].alternatives).toHaveLength(1);
    });
});
