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
    });

    it('executes flattenTrack with the provided payload', () => {
        handleFlattenTrack.execute({
            type: 'flattenTrack',
            payload: { trackId: 't1' },
        });

        expect(mocks.flattenTrack).toHaveBeenCalledWith('t1');
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
