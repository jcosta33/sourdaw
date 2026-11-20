import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleFoldTrack } from '../foldTrack';

const mocks = vi.hoisted(() => ({
    foldTrack: vi.fn(),
    getTrackStoreState:
        vi.fn<() => { tracks: { id: string; kind?: string; collapsed: boolean; devices?: never[] }[] } | null>(),
}));

vi.mock('#/modules/Arrangement/useCases/toggleTrackState/foldTrack', () => ({
    foldTrack: mocks.foldTrack,
}));

vi.mock('#/modules/Arrangement/useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleFoldTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
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

    it('describes an inverse restoring the previous collapsed state', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', collapsed: false }] });

        const desc = handleFoldTrack.describe({
            type: 'foldTrack',
            payload: { trackId: 't1', folded: true },
        });

        expect(desc.inverseAction).toEqual({
            type: 'foldTrack',
            payload: { trackId: 't1', folded: false, expectedFolded: true },
        });
        expect(desc.redoAction).toEqual({
            type: 'foldTrack',
            payload: { trackId: 't1', folded: true, expectedFolded: false },
        });
    });

    it('does not negate the payload when the forward fold is a no-op', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', collapsed: true }] });

        const desc = handleFoldTrack.describe({
            type: 'foldTrack',
            payload: { trackId: 't1', folded: true },
        });

        // Folding an already-folded track changes nothing; a negating inverse
        // would wrongly unfold it. The inverse restores the captured pre-state.
        expect(desc.inverseAction).toEqual({
            type: 'foldTrack',
            payload: { trackId: 't1', folded: true, expectedFolded: true },
        });
    });

    it('is undoable', () => {
        expect(handleFoldTrack.undoable).toBe(true);
    });

    describe('guarded replay', () => {
        const forward = (expectedFolded?: boolean) =>
            ({ type: 'foldTrack', payload: { trackId: 't1', folded: true, expectedFolded } }) as const;
        const context = (action: ReturnType<typeof forward>) => ({ actions: [action], actionIndex: 0 });

        it('refuses a track the project does not hold, naming it', () => {
            const action = forward();

            expect(handleFoldTrack.validate?.(action, context(action))).toBe(false);
            expect(handleFoldTrack.validationRefusalReason?.(action, context(action))).toBe(
                'Track "t1" does not exist'
            );
        });

        it('refuses a track that is not a folder, naming it', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', kind: 'audio', collapsed: false }] });
            const action = forward();

            expect(handleFoldTrack.validate?.(action, context(action))).toBe(false);
            expect(handleFoldTrack.validationRefusalReason?.(action, context(action))).toBe(
                'Track "t1" is not a folder, so it has nothing to fold'
            );
        });

        it('validates a restore only against the state it expects', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', kind: 'folder', collapsed: true }] });

            expect(handleFoldTrack.validate?.(forward(true), context(forward(true)))).toBe(true);
            expect(handleFoldTrack.validate?.(forward(false), context(forward(false)))).toBe(false);
        });

        it('conflicts without writing when the live state is not the one expected', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', kind: 'folder', collapsed: true }] });

            expect(handleFoldTrack.execute(forward(false))).toEqual({ status: 'conflict' });
            expect(mocks.foldTrack).not.toHaveBeenCalled();
        });

        it('replays a stored guard-less inverse unguarded, as before guards existed', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', kind: 'folder', collapsed: true }] });
            const legacy = { type: 'foldTrack', payload: { trackId: 't1', folded: false } } as const;

            expect(handleFoldTrack.validate?.(legacy, { actions: [legacy], actionIndex: 0 })).toBe(true);
            expect(handleFoldTrack.execute(legacy)).toEqual({ status: 'written' });
            expect(mocks.foldTrack).toHaveBeenCalledWith('t1', false);
        });

        it('can be replayed after divergence only when it states what it expects', () => {
            expect(handleFoldTrack.canReapplyAfterDivergence?.(forward(false))).toBe(true);
            expect(handleFoldTrack.canReapplyAfterDivergence?.(forward())).toBe(false);
        });

        it('is a no-op only when the state is already the requested one and the expected one', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', kind: 'folder', collapsed: true }] });

            expect(handleFoldTrack.isNoop?.(forward())).toBe(true);
            expect(handleFoldTrack.isNoop?.(forward(true))).toBe(true);
            expect(handleFoldTrack.isNoop?.(forward(false))).toBe(false);
        });
    });

    it('describes against the state an earlier action of its batch left', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'folder', collapsed: false, devices: [] }],
        });
        const first = { type: 'foldTrack', payload: { trackId: 't1', folded: true } } as const;
        const second = { type: 'foldTrack', payload: { trackId: 't1', folded: false } } as const;

        const description = handleFoldTrack.describe(second, { actions: [first, second], actionIndex: 1 });

        expect(description.inverseAction).toEqual({
            type: 'foldTrack',
            payload: { trackId: 't1', folded: true, expectedFolded: false },
        });
        expect(description.redoAction).toEqual({
            type: 'foldTrack',
            payload: { trackId: 't1', folded: false, expectedFolded: true },
        });
    });
});
