import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleCreateTrackAlternative } from '../handleCreateTrackAlternative';

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

describe('handleCreateTrackAlternative', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Setup a basic state with one track and one alternative
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [{ id: 'clip1' }],
                    alternatives: [{ id: 'alt1', name: 'Alt 1', clips: [] }],
                },
            ],
        });
    });

    it('creates a new empty alternative and switches to it', () => {
        void handleCreateTrackAlternative.execute({
            type: 'createTrackAlternative',
            payload: { trackId: 't1', name: 'New Alt', duplicateActive: false },
        });

        expect(mocks.setTrackStoreState).toHaveBeenCalledTimes(1);
        const firstCall = mocks.setTrackStoreState.mock.calls[0];
        if (!firstCall) {
            throw new Error('expected setTrackStoreState to be called');
        }
        const newState = firstCall[0];
        const track = newState.tracks[0];

        expect(track.alternatives).toHaveLength(2);
        expect(track.alternatives[1].name).toBe('New Alt');
        expect(track.alternatives[1].clips).toHaveLength(0);
        expect(track.activeAlternativeId).toBe(track.alternatives[1].id);

        // Verify current clips were saved to previous alternative
        expect(track.alternatives[0].clips).toEqual([{ id: 'clip1' }]);
    });

    it('creates a new duplicated alternative and switches to it', () => {
        void handleCreateTrackAlternative.execute({
            type: 'createTrackAlternative',
            payload: { trackId: 't1', name: 'Dupe', duplicateActive: true },
        });

        const firstCall = mocks.setTrackStoreState.mock.calls[0];
        if (!firstCall) {
            throw new Error('expected setTrackStoreState to be called');
        }
        const newState = firstCall[0];
        const track = newState.tracks[0];

        expect(track.alternatives).toHaveLength(2);
        expect(track.alternatives[1].clips).toHaveLength(1);
        expect(track.alternatives[1].clips[0].id).toMatch(/^clip-/);
        expect(track.activeAlternativeId).toBe(track.alternatives[1].id);
    });

    it('is undoable', () => {
        expect(handleCreateTrackAlternative.undoable).toBe(true);
    });
});
