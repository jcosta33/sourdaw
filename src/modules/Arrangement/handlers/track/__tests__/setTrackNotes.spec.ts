import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetTrackNotes } from '../setTrackNotes';

const mocks = vi.hoisted(() => ({
    setTrackNotes: vi.fn(),
    getTrackStoreState: vi.fn<() => { tracks: { id: string; notes: string }[] } | null>(),
}));

vi.mock('../../../useCases/setTrackGainPan/setTrackNotes', () => ({
    setTrackNotes: mocks.setTrackNotes,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleSetTrackNotes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('executes setTrackNotes with the provided payload', () => {
        void handleSetTrackNotes.execute({
            type: 'setTrackNotes',
            payload: { trackId: 't1', notes: 'Testing notes' },
        });

        expect(mocks.setTrackNotes).toHaveBeenCalledWith('t1', 'Testing notes');
    });

    it('provides a description', () => {
        const desc = handleSetTrackNotes.describe({
            type: 'setTrackNotes',
            payload: { trackId: 't1', notes: '' },
        });
        expect(desc.label).toBe('Set track notes');
        expect(desc.inverseAction).toBeNull();
    });

    it('describes an inverse restoring the previous notes', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', notes: 'Old notes' }] });

        const desc = handleSetTrackNotes.describe({
            type: 'setTrackNotes',
            payload: { trackId: 't1', notes: 'New notes' },
        });

        expect(desc.inverseAction).toEqual({
            type: 'setTrackNotes',
            payload: { trackId: 't1', notes: 'Old notes' },
        });
    });

    it('is undoable', () => {
        expect(handleSetTrackNotes.undoable).toBe(true);
    });
});
