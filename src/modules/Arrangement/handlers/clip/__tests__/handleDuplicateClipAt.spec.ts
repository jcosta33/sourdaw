import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { handleDuplicateClipAt } from '../handleDuplicateClipAt';

const mocks = vi.hoisted(() => ({
    duplicateClipCore: vi.fn(),
    prepareDuplicateClipTargetId: vi.fn(() => 'copy-next'),
    resolveEligibleClipWriteTarget: vi.fn(),
}));

vi.mock('../../../useCases/clip/duplicateClipCore', () => ({ duplicateClipCore: mocks.duplicateClipCore }));
vi.mock('../../../useCases/clip/prepareDuplicateClipTargetId', () => ({
    prepareDuplicateClipTargetId: mocks.prepareDuplicateClipTargetId,
}));
vi.mock('../../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

const eligibleSource = { status: 'eligible', trackId: 't1', clipId: 'c1' } as const;
const eligibleTrack = { status: 'eligible', trackId: 't2' } as const;

const action = (overrides: Record<string, unknown> = {}) => ({
    type: 'duplicateClipAt' as const,
    payload: {
        clipId: 'c1',
        destinationTrackId: 't2',
        startBeat: 8,
        ...overrides,
    },
});

const baseAction: AppAction = {
    type: 'duplicateClipAt',
    payload: { clipId: 'c1', destinationTrackId: 't2', startBeat: 8 },
};

const batchContext = (others: readonly AppAction[]): HandlerValidationContext => ({
    actions: [baseAction, ...others],
    actionIndex: 0,
});

describe('handleDuplicateClipAt', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveEligibleClipWriteTarget.mockImplementation(({ clipId, trackId }) => {
            if (clipId === 'c1') {
                return eligibleSource;
            }
            if (trackId === 't2') {
                return eligibleTrack;
            }
            return { status: 'missing' };
        });
        mocks.duplicateClipCore.mockReturnValue(true);
    });

    it('duplicates to the destination at the requested start beat with the pinned copy id', () => {
        const payload = action({ targetClipId: 'copy-42' });
        void handleDuplicateClipAt.execute(payload);

        expect(mocks.duplicateClipCore).toHaveBeenCalledWith({
            clipId: 'c1',
            targetClipId: 'copy-42',
            destinationTrackId: 't2',
            computeStartBeat: expect.any(Function),
        });
        const call = mocks.duplicateClipCore.mock.calls[0]![0];
        expect(call.computeStartBeat({ startBeat: 0 })).toBe(8);
    });

    it('pre-allocates a fresh copy id when the payload carries none', () => {
        void handleDuplicateClipAt.execute(action());

        expect(mocks.prepareDuplicateClipTargetId).toHaveBeenCalled();
        expect(mocks.duplicateClipCore.mock.calls[0]![0].targetClipId).toBe('copy-next');
    });

    it('reports no-write when the core duplicate fails', () => {
        mocks.duplicateClipCore.mockReturnValue(false);
        expect(handleDuplicateClipAt.execute(action())).toEqual({ status: 'no-write' });
    });

    it('describes a discardDuplicatedClip inverse keyed on the exact copy id', () => {
        const desc = handleDuplicateClipAt.describe(action());

        expect(desc.label).toBe('Duplicate clip at destination');
        expect(desc.inverseAction).toEqual({
            type: 'discardDuplicatedClip',
            payload: { clipId: 'copy-next' },
        });
    });

    it('validates a solo member against source, destination, and fresh copy id', () => {
        expect(handleDuplicateClipAt.validate?.(action(), batchContext([]))).toBe(true);
    });

    it('refuses a batch member whose source clip another member removes', () => {
        expect(
            handleDuplicateClipAt.validate?.(
                action(),
                batchContext([{ type: 'removeClip', payload: { clipId: 'c1' } }])
            )
        ).toBe(false);
    });

    it('refuses a batch member whose destination track another member removes', () => {
        expect(
            handleDuplicateClipAt.validate?.(
                action(),
                batchContext([{ type: 'removeTrack', payload: { trackId: 't2' } }])
            )
        ).toBe(false);
    });

    it('refuses a member claiming a copy id another member already claims', () => {
        expect(
            handleDuplicateClipAt.validate?.(
                action({ targetClipId: 'copy-42' }),
                batchContext([
                    {
                        type: 'duplicateClipAt',
                        payload: { clipId: 'c9', destinationTrackId: 't1', startBeat: 0, targetClipId: 'copy-42' },
                    },
                ])
            )
        ).toBe(false);
    });

    it('is undoable', () => {
        expect(handleDuplicateClipAt.undoable).toBe(true);
    });
});
