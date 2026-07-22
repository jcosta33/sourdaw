import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleFlattenTrack } from '../flattenTrack';

const mocks = vi.hoisted(() => ({
    flattenTrack: vi.fn(),
}));

vi.mock('../../../useCases/freezeBounce/flattenTrack', () => ({
    flattenTrack: mocks.flattenTrack,
}));

describe('handleFlattenTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.flattenTrack.mockReturnValue(true);
    });

    it('executes flattenTrack with the provided payload', () => {
        const result = handleFlattenTrack.execute({
            type: 'flattenTrack',
            payload: { trackId: 't1' },
        });

        expect(mocks.flattenTrack).toHaveBeenCalledWith('t1');
        expect(result).toEqual({ status: 'written' });
    });

    it('returns no-write when flattening is rejected', () => {
        mocks.flattenTrack.mockReturnValue(false);

        const result = handleFlattenTrack.execute({
            type: 'flattenTrack',
            payload: { trackId: 'vca-1' },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('provides a description', () => {
        const desc = handleFlattenTrack.describe({
            type: 'flattenTrack',
            payload: { trackId: 't1' },
        });
        expect(desc.label).toBe('Flatten track');
    });

    it('is undoable', () => {
        expect(handleFlattenTrack.undoable).toBe(true);
    });
});
