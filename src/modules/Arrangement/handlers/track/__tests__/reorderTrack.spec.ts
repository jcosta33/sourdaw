import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleReorderTrack } from '../reorderTrack';

const mocks = vi.hoisted(() => ({
    reorderTrack: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/toggleTrackState/reorderTrack', () => ({
    reorderTrack: mocks.reorderTrack,
}));

describe('handleReorderTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes reorderTrack with the provided payload', () => {
        void handleReorderTrack.execute({
            type: 'reorderTrack',
            payload: { trackId: 't1', newIndex: 5 },
        });

        expect(mocks.reorderTrack).toHaveBeenCalledWith('t1', 5);
    });

    it('provides a description', () => {
        const desc = handleReorderTrack.describe({
            type: 'reorderTrack',
            payload: { trackId: 't1', newIndex: 0 },
        });
        expect(desc.label).toBe('Reorder track');
    });

    it('is undoable', () => {
        expect(handleReorderTrack.undoable).toBe(true);
    });
});
