import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleFoldTrack } from '../foldTrack';

const mocks = vi.hoisted(() => ({
    foldTrack: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/toggleTrackState/foldTrack', () => ({
    foldTrack: mocks.foldTrack,
}));

describe('handleFoldTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes foldTrack with the provided payload', () => {
        void handleFoldTrack.execute({
            type: 'foldTrack',
            payload: { trackId: 't1', folded: true },
        });

        expect(mocks.foldTrack).toHaveBeenCalledWith('t1', true);
    });

    it('provides a description reflecting folded state', () => {
        const desc1 = handleFoldTrack.describe({
            type: 'foldTrack',
            payload: { trackId: 't1', folded: true },
        });
        expect(desc1.label).toBe('Fold track');

        const desc2 = handleFoldTrack.describe({
            type: 'foldTrack',
            payload: { trackId: 't1', folded: false },
        });
        expect(desc2.label).toBe('Unfold track');
    });

    it('is undoable', () => {
        expect(handleFoldTrack.undoable).toBe(true);
    });
});
