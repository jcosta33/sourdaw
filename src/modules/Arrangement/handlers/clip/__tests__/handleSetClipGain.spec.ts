import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetClipGain } from '../handleSetClipGain';

const mocks = vi.hoisted(() => ({
    setClipGain: vi.fn(),
    getTrackStoreState: vi.fn<() => { tracks: { id: string; clips: { id: string; gain: number }[] }[] } | null>(),
}));

vi.mock('../../../useCases/clipEditing/setClipGain', () => ({
    setClipGain: mocks.setClipGain,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleSetClipGain', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('executes setClipGain with the provided payload', () => {
        void handleSetClipGain.execute({
            type: 'setClipGain',
            payload: { clipId: 'c1', gain: 0.5 },
        });

        expect(mocks.setClipGain).toHaveBeenCalledWith('c1', 0.5);
    });

    it('provides a description', () => {
        const desc = handleSetClipGain.describe({
            type: 'setClipGain',
            payload: { clipId: 'c1', gain: 0.5 },
        });
        expect(desc.label).toBe('Set clip gain');
        expect(desc.inverseAction).toBeNull();
    });

    it('describes an inverse restoring the previous gain', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', gain: 0.8 }] }],
        });

        const desc = handleSetClipGain.describe({
            type: 'setClipGain',
            payload: { clipId: 'c1', gain: 0.5 },
        });

        expect(desc.inverseAction).toEqual({
            type: 'setClipGain',
            payload: { clipId: 'c1', gain: 0.8 },
        });
    });

    it('is undoable', () => {
        expect(handleSetClipGain.undoable).toBe(true);
    });
});
