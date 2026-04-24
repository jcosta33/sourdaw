import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDuplicateTrack } from '../duplicateTrack';

const mocks = vi.hoisted(() => ({
    duplicateTrack: vi.fn(),
}));

vi.mock('../../../useCases/duplicateTrack', () => ({
    duplicateTrack: mocks.duplicateTrack,
}));

describe('handleDuplicateTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes duplicateTrack with the provided payload', () => {
        void handleDuplicateTrack.execute({
            type: 'duplicateTrack',
            payload: { trackId: 't1' },
        });

        expect(mocks.duplicateTrack).toHaveBeenCalledWith('t1');
    });

    it('provides a description', () => {
        const desc = handleDuplicateTrack.describe({
            type: 'duplicateTrack',
            payload: { trackId: 't1' },
        });
        expect(desc.label).toBe('Duplicate track');
    });

    it('is undoable', () => {
        expect(handleDuplicateTrack.undoable).toBe(true);
    });
});
