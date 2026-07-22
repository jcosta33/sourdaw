import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleNormalizeClip } from '../handleNormalizeClip';

const mocks = vi.hoisted(() => ({
    normalizeClip: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/normalizeClip', () => ({
    normalizeClip: mocks.normalizeClip,
}));

describe('handleNormalizeClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.normalizeClip.mockReturnValue(true);
    });

    it('executes normalizeClip with the provided payload', () => {
        const result = handleNormalizeClip.execute({
            type: 'normalizeClip',
            payload: { clipId: 'c1', mode: 'lufs', targetDb: -14 },
        });

        expect(mocks.normalizeClip).toHaveBeenCalledWith('c1', 'lufs', -14);
        expect(result).toEqual({ status: 'written' });
    });

    it('returns no-write when normalization is rejected', () => {
        mocks.normalizeClip.mockReturnValue(false);

        const result = handleNormalizeClip.execute({
            type: 'normalizeClip',
            payload: { clipId: 'vca-clip', mode: 'peak' },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('provides a description reflecting mode', () => {
        const desc1 = handleNormalizeClip.describe({
            type: 'normalizeClip',
            payload: { clipId: 'c1', mode: 'lufs' },
        });
        expect(desc1.label).toBe('Normalize clip (lufs)');

        const desc2 = handleNormalizeClip.describe({
            type: 'normalizeClip',
            payload: { clipId: 'c1' },
        });
        expect(desc2.label).toBe('Normalize clip (peak)');
    });

    it('is undoable', () => {
        expect(handleNormalizeClip.undoable).toBe(true);
    });
});
