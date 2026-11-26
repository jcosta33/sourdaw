import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { handleDisableTrack } from '../disableTrack';

type DisableAction = Extract<AppAction, { type: 'disableTrack' }>;
type TrackFixture = { id: string; disabled: boolean; kind?: string; frozen?: boolean };

const mocks = vi.hoisted(() => ({
    disableTrack: vi.fn(),
    getTrackStoreState: vi.fn<() => { tracks: TrackFixture[] } | null>(),
}));

vi.mock('#/modules/Arrangement/useCases/toggleTrackState/disableTrack', () => ({
    disableTrack: mocks.disableTrack,
}));

vi.mock('#/modules/Arrangement/useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

function disableAction(trackId: string, disabled: boolean): DisableAction {
    return { type: 'disableTrack', payload: { trackId, disabled } };
}

describe('handleDisableTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('executes disableTrack with the provided payload', () => {
        void handleDisableTrack.execute(disableAction('t1', true));

        expect(mocks.disableTrack).toHaveBeenCalledWith('t1', true);
    });

    it('executes disableTrack with disabled false to enable', () => {
        void handleDisableTrack.execute(disableAction('t1', false));

        expect(mocks.disableTrack).toHaveBeenCalledWith('t1', false);
    });

    it('provides a description reflecting disabled state', () => {
        expect(handleDisableTrack.describe(disableAction('t1', true)).label).toBe('Disable track');
        expect(handleDisableTrack.describe(disableAction('t1', false)).label).toBe('Enable track');
    });

    it('is undoable', () => {
        expect(handleDisableTrack.undoable).toBe(true);
    });

    describe('batch validation', () => {
        it('refuses a track that does not exist, with its reason', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', disabled: false }] });
            const action = disableAction('ghost', true);
            const batch = { actions: [action], actionIndex: 0 };

            expect(handleDisableTrack.validate?.(action, batch)).toBe(false);
            expect(handleDisableTrack.validationRefusalReason?.(action, batch)).toBe('Track "ghost" does not exist');
        });

        it('refuses to describe a missing track inside a batch, writing nothing', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
            const action = disableAction('ghost', true);

            expect(() => handleDisableTrack.describe(action, { actions: [action], actionIndex: 0 })).toThrow(
                'Track "ghost" does not exist'
            );
            expect(mocks.disableTrack).not.toHaveBeenCalled();
        });

        it('disables and enables a frozen track, since a freeze leaves the activation alone', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', disabled: false, frozen: true }] });
            const disable = disableAction('t1', true);
            const enable = disableAction('t1', false);

            expect(handleDisableTrack.validate?.(disable, { actions: [disable], actionIndex: 0 })).toBe(true);
            expect(handleDisableTrack.validate?.(enable, { actions: [enable], actionIndex: 0 })).toBe(true);
        });

        it('refuses to disable the master track, with its reason', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 'master', kind: 'master', disabled: false }] });
            const action = disableAction('master', true);
            const batch = { actions: [action], actionIndex: 0 };

            expect(handleDisableTrack.validate?.(action, batch)).toBe(false);
            expect(handleDisableTrack.validationRefusalReason?.(action, batch)).toBe(
                'The master track cannot be disabled'
            );
        });

        it('enables a master track a saved project holds disabled', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 'master', kind: 'master', disabled: true }] });
            const action = disableAction('master', false);

            expect(handleDisableTrack.validate?.(action, { actions: [action], actionIndex: 0 })).toBe(true);
        });
    });

    describe('undo and redo', () => {
        it('records guarded inverse and redo against the state the action finds', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', disabled: false }] });
            const action = disableAction('t1', true);

            const description = handleDisableTrack.describe(action, { actions: [action], actionIndex: 0 });

            expect(description.inverseAction).toEqual({
                type: 'restoreTrackDisabled',
                payload: { trackId: 't1', expected: true, replacement: false },
            });
            expect(description.redoAction).toEqual({
                type: 'restoreTrackDisabled',
                payload: { trackId: 't1', expected: false, replacement: true },
            });
        });

        it('restores an already-disabled track to disabled, not to enabled', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', disabled: true }] });
            const action = disableAction('t1', true);

            const description = handleDisableTrack.describe(action, { actions: [action], actionIndex: 0 });

            expect(description.inverseAction).toEqual({
                type: 'restoreTrackDisabled',
                payload: { trackId: 't1', expected: true, replacement: true },
            });
        });

        it('plans a second action on one track against the state the first leaves, not the live store', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', disabled: false }] });
            const first = disableAction('t1', true);
            const second = disableAction('t1', false);
            const batch = [first, second];

            const firstDescription = handleDisableTrack.describe(first, { actions: batch, actionIndex: 0 });
            const secondDescription = handleDisableTrack.describe(second, { actions: batch, actionIndex: 1 });

            expect(firstDescription.inverseAction).toEqual({
                type: 'restoreTrackDisabled',
                payload: { trackId: 't1', expected: true, replacement: false },
            });
            expect(secondDescription.inverseAction).toEqual({
                type: 'restoreTrackDisabled',
                payload: { trackId: 't1', expected: false, replacement: true },
            });
            expect(secondDescription.redoAction).toEqual({
                type: 'restoreTrackDisabled',
                payload: { trackId: 't1', expected: true, replacement: false },
            });
        });
    });

    describe('isNoop', () => {
        it('treats a request for the state the track already holds as a no-op', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', disabled: true }] });

            expect(handleDisableTrack.isNoop?.(disableAction('t1', true))).toBe(true);
            expect(handleDisableTrack.isNoop?.(disableAction('t1', false))).toBe(false);
        });
    });
});
