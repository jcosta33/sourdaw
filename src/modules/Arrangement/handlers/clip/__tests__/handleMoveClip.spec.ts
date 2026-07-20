import { describe, it, expect, vi } from 'vitest';

import { moveClip } from '../../../useCases/clip/moveClip';
import { handleMoveClip } from '../handleMoveClip';

type TestClip = { id: string; trackId: string; name: string; startBeat: number; endBeat: number; gain: number };
type TestTrackState = { tracks: { id: string; clips: TestClip[] }[] };

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn<() => TestTrackState | null>(),
}));

vi.mock('../../../useCases/clip/moveClip', () => ({
    moveClip: vi.fn(),
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('clipHandlers', () => {
    it('handleMoveClip forwards to moveClip use case', () => {
        void handleMoveClip.execute({
            type: 'moveClip',
            payload: { clipId: 'c1', trackId: 't1', startBeat: 4 },
        });

        expect(moveClip).toHaveBeenCalledWith('c1', 't1', 4);
    });

    it('handleMoveClip describes an inverse back to the pre-move position', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't0',
                    clips: [{ id: 'c1', trackId: 't0', name: 'Clip c1', startBeat: 2, endBeat: 6, gain: 1 }],
                },
            ],
        });

        const desc = handleMoveClip.describe({
            type: 'moveClip',
            payload: { clipId: 'c1', trackId: 't1', startBeat: 4 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'moveClip',
            payload: { clipId: 'c1', trackId: 't0', startBeat: 2 },
        });
    });

    it('handleMoveClip describes a null inverse when the clip is not found', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

        const desc = handleMoveClip.describe({
            type: 'moveClip',
            payload: { clipId: 'missing', trackId: 't1', startBeat: 4 },
        });

        expect(desc.inverseAction).toBeNull();
    });
});
