import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleFreezeTrack } from '../freezeTrack';

const mocks = vi.hoisted(() => ({
    freezeTrack: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('../../../useCases/freezeBounce/freezeTrack', () => ({
    freezeTrack: mocks.freezeTrack,
}));
vi.mock('../../../useCases/getTrackStoreState', () => ({ getTrackStoreState: mocks.getTrackStoreState }));

const unfrozenTrack = { id: 't1', frozen: false, frozenBufferId: undefined, freezeState: { status: 'unfrozen' } };

describe('handleFreezeTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue({ tracks: [unfrozenTrack] });
    });

    it('executes freezeTrack with the application-resolved freeze id', async () => {
        mocks.freezeTrack.mockResolvedValue(true);
        const result = await handleFreezeTrack.execute({
            type: 'freezeTrack',
            payload: { trackId: 't1', freezeId: 'freeze-command-1' },
        });

        expect(mocks.freezeTrack).toHaveBeenCalledWith('t1', 'freeze-command-1');
        expect(result).toEqual({ status: 'written' });
    });

    it('reports no-write when freeze is rejected', async () => {
        mocks.freezeTrack.mockResolvedValue(false);

        const result = await handleFreezeTrack.execute({
            type: 'freezeTrack',
            payload: { trackId: 'vca-1', freezeId: 'freeze-command-1' },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('describes a guarded freeze-state restore in both directions, not a bare unfreeze', () => {
        const description = handleFreezeTrack.describe({
            type: 'freezeTrack',
            payload: { trackId: 't1', freezeId: 'freeze-command-1' },
        });

        expect(description.label).toBe('Freeze track');
        expect(description.inverseAction).toMatchObject({
            type: 'restoreFreezeState',
            payload: {
                trackId: 't1',
                expected: { frozen: true, frozenBufferId: 'freeze-command-1' },
                replacement: { frozen: false, freezeState: { status: 'unfrozen' } },
            },
        });
        expect(description.redoAction).toMatchObject({
            type: 'restoreFreezeState',
            payload: {
                trackId: 't1',
                expected: { frozen: false, freezeState: { status: 'unfrozen' } },
                replacement: { frozen: true, frozenBufferId: 'freeze-command-1' },
            },
        });
    });

    it('preserves a stale pre-freeze state and its buffer in the inverse', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    frozen: true,
                    frozenBufferId: 'old-buffer',
                    freezeState: { status: 'stale', freezeId: 'old-freeze', frozenBufferId: 'old-buffer' },
                },
            ],
        });

        const description = handleFreezeTrack.describe({
            type: 'freezeTrack',
            payload: { trackId: 't1', freezeId: 'freeze-command-2' },
        });

        // A bare `unfreezeTrack` inverse would have cleared this buffer and collapsed
        // the metadata to `unfrozen`, which is not the state freeze found.
        expect(description.inverseAction).toMatchObject({
            type: 'restoreFreezeState',
            payload: {
                replacement: {
                    frozen: true,
                    frozenBufferId: 'old-buffer',
                    freezeState: { status: 'stale', freezeId: 'old-freeze' },
                },
            },
        });
    });

    it('finalizes the guarded post-state with the take the render actually produced', async () => {
        const action = {
            type: 'freezeTrack' as const,
            payload: { trackId: 't1', freezeId: 'freeze-command-1' },
        };
        const description = handleFreezeTrack.describe(action);

        mocks.freezeTrack.mockImplementation(() => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [
                    {
                        id: 't1',
                        frozen: true,
                        frozenBufferId: 'freeze-command-1',
                        freezeState: {
                            status: 'frozen',
                            freezeId: 'freeze-command-1',
                            frozenBufferId: 'freeze-command-1',
                            sourceContentHash: 'hash-1',
                            compensationSeconds: 0.25,
                            renderedAt: 1234,
                        },
                    },
                ],
            });
            return Promise.resolve(true);
        });

        await handleFreezeTrack.execute(action);

        // Redo has to restore the metadata frozen playback and staleness detection
        // depend on; seeding it from the id alone would silently drop them.
        expect(description.redoAction).toMatchObject({
            payload: {
                replacement: {
                    freezeState: { sourceContentHash: 'hash-1', compensationSeconds: 0.25, renderedAt: 1234 },
                },
            },
        });
    });

    it('emits no inverse without a resolved freeze id', () => {
        expect(handleFreezeTrack.describe({ type: 'freezeTrack', payload: { trackId: 't1' } })).toEqual({
            label: 'Freeze track',
            inverseAction: null,
        });
    });

    it('reports an already-frozen track as a no-op', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', frozen: true, freezeState: { status: 'frozen' } }],
        });

        expect(handleFreezeTrack.isNoop?.({ type: 'freezeTrack', payload: { trackId: 't1' } })).toBe(true);
    });

    it('is undoable', () => {
        expect(handleFreezeTrack.undoable).toBe(true);
    });
});
