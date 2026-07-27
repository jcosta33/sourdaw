import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleReorderTrack } from '../reorderTrack';

const mocks = vi.hoisted(() => ({
    reorderTrack: vi.fn(),
    getTrackStoreState: vi.fn<() => { tracks: { id: string }[] } | null>(),
}));

vi.mock('#/modules/Arrangement/useCases/toggleTrackState/reorderTrack', () => ({
    reorderTrack: mocks.reorderTrack,
}));

vi.mock('#/modules/Arrangement/useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleReorderTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('executes reorderTrack with the provided payload', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't0' }, { id: 't1' }] });

        const result = handleReorderTrack.execute({
            type: 'reorderTrack',
            payload: { trackId: 't1', newIndex: 0 },
        });

        expect(result).toEqual({ status: 'written' });
        expect(mocks.reorderTrack).toHaveBeenCalledWith('t1', 0);
    });

    it('provides a description', () => {
        const desc = handleReorderTrack.describe({
            type: 'reorderTrack',
            payload: { trackId: 't1', newIndex: 0 },
        });
        expect(desc.label).toBe('Reorder track');
        expect(desc.inverseAction).toBeNull();
    });

    it('describes an inverse restoring the pre-move index', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't0' }, { id: 't1' }, { id: 't2' }] });

        const desc = handleReorderTrack.describe({
            type: 'reorderTrack',
            payload: { trackId: 't1', newIndex: 2 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'reorderTrack',
            payload: { trackId: 't1', newIndex: 1 },
        });
    });

    it('is a no-op when the track is already at the requested index', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't0' }, { id: 't1' }] });

        expect(
            handleReorderTrack.isNoop?.({
                type: 'reorderTrack',
                payload: { trackId: 't1', newIndex: 1 },
            })
        ).toBe(true);
    });

    it('does not claim compensation when the requested index is stale', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't0' }, { id: 't1' }] });
        const action = {
            type: 'reorderTrack',
            payload: { trackId: 't1', newIndex: 2 },
        } as const;

        expect(handleReorderTrack.describe(action).inverseAction).toBeNull();
        expect(handleReorderTrack.isNoop?.(action)).toBe(false);
        expect(handleReorderTrack.execute(action)).toEqual({ status: 'conflict' });
        expect(mocks.reorderTrack).not.toHaveBeenCalled();
    });

    it('is undoable', () => {
        expect(handleReorderTrack.undoable).toBe(true);
    });
});
