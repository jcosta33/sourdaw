import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleNormalizeClip } from '../handleNormalizeClip';

const mocks = vi.hoisted(() => ({
    getClipNormalizationTargetGain: vi.fn(),
    getTrackStoreState: vi.fn(),
    normalizeClip: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/normalizeClip', () => ({
    normalizeClip: mocks.normalizeClip,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../../useCases/clipEditing/getClipNormalizationTargetGain', () => ({
    getClipNormalizationTargetGain: mocks.getClipNormalizationTargetGain,
}));

describe('handleNormalizeClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getClipNormalizationTargetGain.mockReturnValue(null);
        mocks.getTrackStoreState.mockReturnValue(null);
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
        expect(desc1.label).toBe('Normalize clip c1 to -14 LUFS');

        const desc2 = handleNormalizeClip.describe({
            type: 'normalizeClip',
            payload: { clipId: 'c1' },
        });
        expect(desc2.label).toBe('Normalize clip c1 using peak measurement');
    });

    it('captures the previous clip gain as its inverse action, guarded by the post-normalize target', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', gain: 0.625 }] }],
        });
        mocks.getClipNormalizationTargetGain.mockReturnValue(2);

        const description = handleNormalizeClip.describe({
            type: 'normalizeClip',
            payload: { clipId: 'c1', mode: 'lufs', targetDb: -14 },
        });

        expect(description.inverseAction).toEqual({
            type: 'setClipGain',
            payload: { clipId: 'c1', gain: 0.625, expectedGain: 2 },
        });
    });

    it('describes no inverse action when the normalization target cannot be computed', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', gain: 0.625 }] }],
        });
        mocks.getClipNormalizationTargetGain.mockReturnValue(null);

        const description = handleNormalizeClip.describe({
            type: 'normalizeClip',
            payload: { clipId: 'c1', mode: 'lufs', targetDb: -14 },
        });

        expect(description.inverseAction).toBeNull();
    });

    it('recognizes an already-normalized clip as a no-op', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', gain: 0.625 }] }],
        });
        mocks.getClipNormalizationTargetGain.mockReturnValue(0.625);
        const action = {
            type: 'normalizeClip' as const,
            payload: { clipId: 'c1', mode: 'lufs' as const, targetDb: -14 },
        };

        expect(handleNormalizeClip.isNoop?.(action)).toBe(true);
        expect(mocks.getClipNormalizationTargetGain).toHaveBeenCalledWith('c1', 'lufs', -14);
    });

    it('is undoable', () => {
        expect(handleNormalizeClip.undoable).toBe(true);
    });
});
