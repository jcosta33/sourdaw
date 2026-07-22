import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDeleteTrackAlternative } from '../handleDeleteTrackAlternative';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    setTrackStoreState: vi.fn(),
    resolveEligibleClipWriteTarget: vi.fn(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/setTrackStoreState', () => ({
    setTrackStoreState: mocks.setTrackStoreState,
}));

vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

describe('handleDeleteTrackAlternative', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'eligible', trackId: 't1' });
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

        const result = handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt2' },
        });

        const firstCall = mocks.setTrackStoreState.mock.calls[0];
        if (!firstCall) {
            throw new Error('expected setTrackStoreState to have been called');
        }
        const newState = firstCall[0];
        expect(newState.tracks[0].alternatives).toHaveLength(1);
        expect(newState.tracks[0].alternatives[0].id).toBe('alt1');
        expect(result).toEqual({ status: 'written' });
    });

    it('falls back to another alternative if deleting the active one', () => {
        const alt2Clips = [{ id: 'c2', trackId: 't1' }];
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [{ id: 'c1', trackId: 't1' }],
                    alternatives: [
                        { id: 'alt1', clips: [{ id: 'c1', trackId: 't1' }] },
                        { id: 'alt2', clips: alt2Clips },
                    ],
                },
            ],
        });

        void handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt1' },
        });

        const firstCall = mocks.setTrackStoreState.mock.calls[0];
        if (!firstCall) {
            throw new Error('expected setTrackStoreState to have been called');
        }
        const newState = firstCall[0];
        const track = newState.tracks[0];
        expect(track.alternatives).toHaveLength(1);
        expect(track.activeAlternativeId).toBe('alt2');
        expect(track.clips).toEqual(alt2Clips);
    });

    it('rejects a malformed fallback clip when deleting the active alternative', () => {
        const fallbackClips = [{ id: 'c2', trackId: 't1' }];
        Object.defineProperty(fallbackClips, 0, { value: null });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [{ id: 'c1', trackId: 't1' }],
                    alternatives: [
                        { id: 'alt1', clips: [] },
                        { id: 'alt2', clips: fallbackClips },
                    ],
                },
            ],
        });

        const result = handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt1' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('rejects a foreign-owned fallback clip when deleting the active alternative', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [{ id: 'c1', trackId: 't1' }],
                    alternatives: [
                        { id: 'alt1', clips: [] },
                        { id: 'alt2', clips: [{ id: 'c2', trackId: 't2' }] },
                    ],
                },
            ],
        });

        const result = handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt1' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('rejects duplicate fallback clip ids when deleting the active alternative', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [{ id: 'c1', trackId: 't1' }],
                    alternatives: [
                        { id: 'alt1', clips: [] },
                        {
                            id: 'alt2',
                            clips: [
                                { id: 'duplicate', trackId: 't1' },
                                { id: 'duplicate', trackId: 't1' },
                            ],
                        },
                    ],
                },
            ],
        });

        const result = handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt1' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('rejects a fallback clip id that collides with another live track', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    activeAlternativeId: 'alt1',
                    clips: [{ id: 'c1', trackId: 't1' }],
                    alternatives: [
                        { id: 'alt1', clips: [] },
                        { id: 'alt2', clips: [{ id: 'occupied', trackId: 't1' }] },
                    ],
                },
                {
                    id: 't2',
                    activeAlternativeId: 'other-alt',
                    clips: [{ id: 'occupied', trackId: 't2' }],
                    alternatives: [{ id: 'other-alt', clips: [] }],
                },
            ],
        });

        const result = handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt1' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('refuses to delete if only one alternative remains', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', alternatives: [{ id: 'alt1' }] }],
        });

        const result = handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt1' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('rejects an ineligible track without publishing', () => {
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
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'ineligible' });

        const result = handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'alt2' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });

    it('returns no-write when the requested alternative is missing', () => {
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

        const result = handleDeleteTrackAlternative.execute({
            type: 'deleteTrackAlternative',
            payload: { trackId: 't1', alternativeId: 'missing' },
        });

        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.setTrackStoreState).not.toHaveBeenCalled();
    });
});
