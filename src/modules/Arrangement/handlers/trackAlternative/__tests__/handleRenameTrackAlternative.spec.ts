import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRenameTrackAlternative } from '../handleRenameTrackAlternative';

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
                }
            ]
        });

        handleRenameTrackAlternative.execute({
            type: 'renameTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt1', name: 'New' },
        });

        const newState = mocks.setTrackStoreState.mock.calls[0][0];
        expect(newState.tracks[0].alternatives[0].name).toBe('New');
        expect(newState.tracks[0].alternatives[1].name).toBe('Other');
    });
});
