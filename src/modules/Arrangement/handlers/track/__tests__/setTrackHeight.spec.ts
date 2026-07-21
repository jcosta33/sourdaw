import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetTrackHeight } from '../setTrackHeight';

const mocks = vi.hoisted(() => ({
    setTrackHeight: vi.fn(),
    getTrackStoreState: vi.fn<() => { tracks: { id: string; height: number }[] } | null>(),
}));

vi.mock('#/modules/Arrangement/useCases/toggleTrackState/setTrackHeight', () => ({
    setTrackHeight: mocks.setTrackHeight,
}));

vi.mock('#/modules/Arrangement/useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleSetTrackHeight', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('executes setTrackHeight with the provided payload', () => {
        void handleSetTrackHeight.execute({
            type: 'setTrackHeight',
            payload: { trackId: 't1', height: 150 },
        });

        expect(mocks.setTrackHeight).toHaveBeenCalledWith('t1', 150);
    });

    it('provides a description', () => {
        const desc = handleSetTrackHeight.describe({
            type: 'setTrackHeight',
            payload: { trackId: 't1', height: 100 },
        });
        expect(desc.label).toBe('Set track height');
        expect(desc.inverseAction).toBeNull();
    });

    it('describes an inverse restoring the previous height even when the forward height clamps', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', height: 80 }] });

        const desc = handleSetTrackHeight.describe({
            type: 'setTrackHeight',
            payload: { trackId: 't1', height: 999 },
        });

        // The forward setter clamps 999 to 300; the inverse restores the
        // captured height 80, not anything derived from the payload.
        expect(desc.inverseAction).toEqual({
            type: 'setTrackHeight',
            payload: { trackId: 't1', height: 80 },
        });
    });

    it('is undoable', () => {
        expect(handleSetTrackHeight.undoable).toBe(true);
    });
});
