import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { handleHideTrack } from '../hideTrack';

const mocks = vi.hoisted(() => ({
    hideTrack: vi.fn(),
    getTrackStoreState:
        vi.fn<() => { tracks: { id: string; hidden: boolean; kind?: string; devices?: never[] }[] } | null>(),
}));

vi.mock('#/modules/Arrangement/useCases/toggleTrackState/hideTrack', () => ({
    hideTrack: mocks.hideTrack,
}));

vi.mock('#/modules/Arrangement/useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleHideTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('executes hideTrack with payload', () => {
        void handleHideTrack.execute({
            type: 'hideTrack',
            payload: { trackId: 't1', hidden: true },
        });

        expect(mocks.hideTrack).toHaveBeenCalledWith('t1', true);
    });

    it('provides a description based on hidden state', () => {
        const desc1 = handleHideTrack.describe({
            type: 'hideTrack',
            payload: { trackId: 't1', hidden: true },
        });
        expect(desc1.label).toBe('Hide track');

        const desc2 = handleHideTrack.describe({
            type: 'hideTrack',
            payload: { trackId: 't1', hidden: false },
        });
        expect(desc2.label).toBe('Show track');
    });

    it('describes an inverse restoring the previous hidden state', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', hidden: false }] });

        const desc = handleHideTrack.describe({
            type: 'hideTrack',
            payload: { trackId: 't1', hidden: true },
        });

        expect(desc.inverseAction).toEqual({
            type: 'hideTrack',
            payload: { trackId: 't1', hidden: false, expectedHidden: true },
        });
        expect(desc.redoAction).toEqual({
            type: 'hideTrack',
            payload: { trackId: 't1', hidden: true, expectedHidden: false },
        });
    });

    it('does not negate the payload when the forward hide is a no-op', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', hidden: true }] });

        const desc = handleHideTrack.describe({
            type: 'hideTrack',
            payload: { trackId: 't1', hidden: true },
        });

        // Hiding an already-hidden track changes nothing; a negating inverse
        // would wrongly unhide it. The inverse restores the captured pre-state.
        expect(desc.inverseAction).toEqual({
            type: 'hideTrack',
            payload: { trackId: 't1', hidden: true, expectedHidden: true },
        });
    });

    it('is undoable', () => {
        expect(handleHideTrack.undoable).toBe(true);
    });

    describe('guarded replay', () => {
        const forward = (expectedHidden?: boolean) =>
            ({ type: 'hideTrack', payload: { trackId: 't1', hidden: true, expectedHidden } }) as const;
        const context = (action: ReturnType<typeof forward>) => ({ actions: [action], actionIndex: 0 });

        it('refuses a track the project does not hold, naming it', () => {
            const action = forward();

            expect(handleHideTrack.validate?.(action, context(action))).toBe(false);
            expect(handleHideTrack.validationRefusalReason?.(action, context(action))).toBe(
                'Track "t1" does not exist'
            );
        });

        function masterHideAction(
            hidden: boolean,
            expectedHidden?: boolean
        ): Extract<AppAction, { type: 'hideTrack' }> {
            return { type: 'hideTrack', payload: { trackId: 'master', hidden, expectedHidden } };
        }

        it('refuses to hide the master track, writing nothing', () => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [{ id: 'master', kind: 'master', hidden: false }],
            });
            const action = masterHideAction(true);
            const batch = { actions: [action], actionIndex: 0 };

            expect(handleHideTrack.validate?.(action, batch)).toBe(false);
            expect(handleHideTrack.validationRefusalReason?.(action, batch)).toBe('The master track cannot be hidden');
            expect(mocks.hideTrack).not.toHaveBeenCalled();
        });

        it('shows a master track a saved project holds hidden', () => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [{ id: 'master', kind: 'master', hidden: true }],
            });
            const action = masterHideAction(false);

            expect(handleHideTrack.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(true);
            expect(handleHideTrack.execute(action)).toEqual({ status: 'written' });
            expect(mocks.hideTrack).toHaveBeenCalledWith('master', false);
        });

        it("undoes and redoes the show of a master saved hidden through describe's own actions", () => {
            mocks.getTrackStoreState.mockReturnValue({
                tracks: [{ id: 'master', kind: 'master', hidden: true }],
            });
            const forward = masterHideAction(false);
            const description = handleHideTrack.describe(forward, { actions: [forward], actionIndex: 0 });
            const { inverseAction, redoAction } = description;
            if (inverseAction?.type !== 'hideTrack' || redoAction?.type !== 'hideTrack') {
                throw new Error('Expected a guarded inverse and redo');
            }

            expect(handleHideTrack.execute(forward)).toEqual({ status: 'written' });
            expect(mocks.hideTrack).toHaveBeenLastCalledWith('master', false);

            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 'master', kind: 'master', hidden: false }] });
            expect(handleHideTrack.validate?.(inverseAction, { actions: [inverseAction], actionIndex: 0 })).toBe(true);
            expect(handleHideTrack.execute(inverseAction)).toEqual({ status: 'written' });
            expect(mocks.hideTrack).toHaveBeenLastCalledWith('master', true);

            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 'master', kind: 'master', hidden: true }] });
            expect(handleHideTrack.validate?.(redoAction, { actions: [redoAction], actionIndex: 0 })).toBe(true);
            expect(handleHideTrack.execute(redoAction)).toEqual({ status: 'written' });
            expect(mocks.hideTrack).toHaveBeenLastCalledWith('master', false);
        });

        it('validates a restore only against the state it expects', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', hidden: true }] });

            expect(handleHideTrack.validate?.(forward(true), context(forward(true)))).toBe(true);
            expect(handleHideTrack.validate?.(forward(false), context(forward(false)))).toBe(false);
        });

        it('conflicts without writing when the live state is not the one expected', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', hidden: true }] });

            expect(handleHideTrack.execute(forward(false))).toEqual({ status: 'conflict' });
            expect(mocks.hideTrack).not.toHaveBeenCalled();
        });

        it('replays a stored guard-less inverse unguarded, as before guards existed', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', hidden: true }] });
            const legacy = { type: 'hideTrack', payload: { trackId: 't1', hidden: false } } as const;

            expect(handleHideTrack.validate?.(legacy, { actions: [legacy], actionIndex: 0 })).toBe(true);
            expect(handleHideTrack.execute(legacy)).toEqual({ status: 'written' });
            expect(mocks.hideTrack).toHaveBeenCalledWith('t1', false);
        });

        it('can be replayed after divergence only when it states what it expects', () => {
            expect(handleHideTrack.canReapplyAfterDivergence?.(forward(false))).toBe(true);
            expect(handleHideTrack.canReapplyAfterDivergence?.(forward())).toBe(false);
        });

        it('is a no-op only when the state is already the requested one and the expected one', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', hidden: true }] });

            expect(handleHideTrack.isNoop?.(forward())).toBe(true);
            expect(handleHideTrack.isNoop?.(forward(true))).toBe(true);
            expect(handleHideTrack.isNoop?.(forward(false))).toBe(false);
        });
    });

    it('describes against the state an earlier action of its batch left', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', hidden: false, devices: [] }] });
        const first = { type: 'hideTrack', payload: { trackId: 't1', hidden: true } } as const;
        const second = { type: 'hideTrack', payload: { trackId: 't1', hidden: false } } as const;

        const description = handleHideTrack.describe(second, { actions: [first, second], actionIndex: 1 });

        expect(description.inverseAction).toEqual({
            type: 'hideTrack',
            payload: { trackId: 't1', hidden: true, expectedHidden: false },
        });
        expect(description.redoAction).toEqual({
            type: 'hideTrack',
            payload: { trackId: 't1', hidden: false, expectedHidden: true },
        });
    });
});
