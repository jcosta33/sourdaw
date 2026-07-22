import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDuplicateClipToNextBar } from '../handleDuplicateClipToNextBar';

const mocks = vi.hoisted(() => ({
    duplicateClipToNextBar: vi.fn(),
    prepareDuplicateClipTargetId: vi.fn(() => 'clip-copy'),
    resolveEligibleClipWriteTarget: vi.fn(),
}));

vi.mock('../../../useCases/clip/duplicateClipToNextBar', () => ({
    duplicateClipToNextBar: mocks.duplicateClipToNextBar,
}));

vi.mock('../../../useCases/clip/prepareDuplicateClipTargetId', () => ({
    prepareDuplicateClipTargetId: mocks.prepareDuplicateClipTargetId,
}));

vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

describe('handleDuplicateClipToNextBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.duplicateClipToNextBar.mockReturnValue(true);
        mocks.resolveEligibleClipWriteTarget.mockImplementation((input: { clipId?: string; trackId?: string }) => {
            if (input.clipId === 'c1') {
                return { status: 'eligible', clipId: 'c1', trackId: 't1' };
            }
            if (input.trackId === 't1') {
                return { status: 'eligible', trackId: 't1' };
            }
            return { status: 'missing' };
        });
    });

    it('executes duplicateClipToNextBar with the provided payload and target clip id', () => {
        expect(
            handleDuplicateClipToNextBar.execute({
                type: 'duplicateClipToNextBar',
                payload: { clipId: 'c1', targetClipId: 'clip-provided' },
            })
        ).toEqual({ status: 'written' });

        expect(mocks.duplicateClipToNextBar).toHaveBeenCalledWith({ clipId: 'c1', targetClipId: 'clip-provided' });
        expect(mocks.prepareDuplicateClipTargetId).not.toHaveBeenCalled();
    });

    it('should prepare a reversible duplicate-to-next-bar action when no target clip id is provided', () => {
        const action = {
            type: 'duplicateClipToNextBar' as const,
            payload: { clipId: 'c1' },
        };

        const desc = handleDuplicateClipToNextBar.describe(action);
        void handleDuplicateClipToNextBar.execute(action);

        expect(desc).toEqual({
            label: 'Duplicate clip to next bar',
            inverseAction: { type: 'discardDuplicatedClip', payload: { clipId: 'clip-copy' } },
        });
        expect(mocks.duplicateClipToNextBar).toHaveBeenCalledWith({ clipId: 'c1', targetClipId: 'clip-copy' });
    });

    it('provides a description', () => {
        const desc = handleDuplicateClipToNextBar.describe({
            type: 'duplicateClipToNextBar',
            payload: { clipId: 'c1' },
        });
        expect(desc.label).toBe('Duplicate clip to next bar');
    });

    it('is undoable', () => {
        expect(handleDuplicateClipToNextBar.undoable).toBe(true);
    });

    it('rejects before describe can allocate a target id when the source is ineligible', () => {
        const action = { type: 'duplicateClipToNextBar' as const, payload: { clipId: 'vca-clip' } };
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'ineligible' });

        expect(handleDuplicateClipToNextBar.isNoop?.(action)).toBe(true);

        expect(mocks.prepareDuplicateClipTargetId).not.toHaveBeenCalled();
        expect(mocks.duplicateClipToNextBar).not.toHaveBeenCalled();
    });

    it('rejects an existing explicit target before describe can attach its inverse', () => {
        const action = {
            type: 'duplicateClipToNextBar' as const,
            payload: { clipId: 'c1', targetClipId: 'existing-clip' },
        };
        mocks.resolveEligibleClipWriteTarget.mockImplementation((input: { clipId?: string; trackId?: string }) => {
            if (input.trackId === 't1') {
                return { status: 'eligible', trackId: 't1' };
            }
            return { status: 'eligible', clipId: input.clipId, trackId: 't1' };
        });

        expect(handleDuplicateClipToNextBar.isNoop?.(action)).toBe(true);

        expect(mocks.prepareDuplicateClipTargetId).not.toHaveBeenCalled();
        expect(mocks.duplicateClipToNextBar).not.toHaveBeenCalled();
    });

    it('reports no-write when the prepared duplicate is not published', () => {
        mocks.duplicateClipToNextBar.mockReturnValue(false);

        expect(
            handleDuplicateClipToNextBar.execute({
                type: 'duplicateClipToNextBar',
                payload: { clipId: 'c1', targetClipId: 'clip-provided' },
            })
        ).toEqual({ status: 'no-write' });
    });
});
