import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSwitchTrackAlternative } from '../handleSwitchTrackAlternative';

type MockTrack = {
    id: string;
    activeAlternativeId: string;
    clips?: Array<{ id: string }>;
    alternatives: Array<{ id: string; clips?: Array<{ id: string }> }>;
};

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn<() => { tracks: MockTrack[] }>(),
    setTrackStoreState: vi.fn<(state: { tracks: MockTrack[] }) => void>(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/setTrackStoreState', () => ({
    setTrackStoreState: mocks.setTrackStoreState,
}));

describe('handleSwitchTrackAlternative', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('switches between alternatives saving active clips', () => {
        const alt2Clips = [{ id: 'c2' }];
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [{ id: 'c1' }],
                    alternatives: [
                        { id: 'alt1', clips: [] },
                        { id: 'alt2', clips: alt2Clips },
                    ],
                },
            ],
        });

        void handleSwitchTrackAlternative.execute({
            type: 'switchTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt2' },
        });

        const newState = mocks.setTrackStoreState.mock.calls[0][0];
        const track = newState.tracks[0];
        expect(track.activeAlternativeId).toBe('alt2');
        expect(track.clips).toEqual(alt2Clips);

        // Verify alt1 now contains the clips that were active
        expect(track.alternatives[0].clips).toEqual([{ id: 'c1' }]);
    });

    it('bails if switching to the already active alternative', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', activeAlternativeId: 'alt1', alternatives: [{ id: 'alt1' }] }],
        });

        void handleSwitchTrackAlternative.execute({
            type: 'switchTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt1' },
        });

        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });
});
