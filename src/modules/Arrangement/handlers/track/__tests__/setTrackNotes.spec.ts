import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';
import { MAX_TRACK_NOTES_LENGTH } from '#/utils/trackNotesLimits';

import { handleSetTrackNotes } from '../setTrackNotes';

type NotesAction = Extract<AppAction, { type: 'setTrackNotes' }>;
type TrackFixture = { id: string; notes: string; frozen?: boolean };

const mocks = vi.hoisted(() => ({
    setTrackNotes: vi.fn(),
    getTrackStoreState: vi.fn<() => { tracks: TrackFixture[] } | null>(),
}));

vi.mock('../../../useCases/setTrackGainPan/setTrackNotes', () => ({
    setTrackNotes: mocks.setTrackNotes,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

function notesAction(trackId: string, notes: string, expectedNotes?: string): NotesAction {
    return { type: 'setTrackNotes', payload: { trackId, notes, expectedNotes } };
}

function single(action: NotesAction) {
    return { actions: [action], actionIndex: 0 };
}

describe('handleSetTrackNotes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue(null);
    });

    it('executes setTrackNotes with the provided payload', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', notes: '' }] });

        expect(handleSetTrackNotes.execute(notesAction('t1', 'Testing notes'))).toEqual({ status: 'written' });
        expect(mocks.setTrackNotes).toHaveBeenCalledWith('t1', 'Testing notes');
    });

    it('provides a description with no inverse for an unknown track outside a batch', () => {
        const desc = handleSetTrackNotes.describe(notesAction('t1', ''));

        expect(desc.label).toBe('Set track notes');
        expect(desc.inverseAction).toBeNull();
    });

    it('is undoable', () => {
        expect(handleSetTrackNotes.undoable).toBe(true);
    });

    describe('validation', () => {
        it('refuses a track that does not exist, with its reason', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', notes: '' }] });
            const action = notesAction('ghost', 'x');

            expect(handleSetTrackNotes.validate?.(action, single(action))).toBe(false);
            expect(handleSetTrackNotes.validationRefusalReason?.(action, single(action))).toBe(
                'Track "ghost" does not exist'
            );
        });

        it('refuses notes longer than the limit and admits notes of exactly the limit', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', notes: '' }] });
            const tooLong = notesAction('t1', 'x'.repeat(MAX_TRACK_NOTES_LENGTH + 1));
            const atLimit = notesAction('t1', 'x'.repeat(MAX_TRACK_NOTES_LENGTH));

            expect(handleSetTrackNotes.validate?.(tooLong, single(tooLong))).toBe(false);
            expect(handleSetTrackNotes.validationRefusalReason?.(tooLong, single(tooLong))).toBe(
                `Track notes are limited to ${MAX_TRACK_NOTES_LENGTH} characters`
            );
            expect(handleSetTrackNotes.validate?.(atLimit, single(atLimit))).toBe(true);
        });

        it('restores notes a saved project holds even past the limit for a fresh write', () => {
            const saved = 'y'.repeat(MAX_TRACK_NOTES_LENGTH + 500);
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', notes: 'short' }] });
            const restore = notesAction('t1', saved, 'short');

            expect(handleSetTrackNotes.validate?.(restore, single(restore))).toBe(true);
        });

        it('sets the notes of a frozen track, since a freeze leaves the notes alone', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', notes: '', frozen: true }] });
            const action = notesAction('t1', 'x');

            expect(handleSetTrackNotes.validate?.(action, single(action))).toBe(true);
        });

        it('refuses a restore when the notes were edited after the edit it undoes', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', notes: 'edited since' }] });
            const restore = notesAction('t1', 'Old', 'New');

            expect(handleSetTrackNotes.validate?.(restore, single(restore))).toBe(false);
            expect(handleSetTrackNotes.execute(restore)).toEqual({ status: 'conflict' });
            expect(mocks.setTrackNotes).not.toHaveBeenCalled();
        });
    });

    describe('undo and redo', () => {
        it('records guarded inverse and redo against the notes the action finds', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', notes: 'Old notes' }] });
            const action = notesAction('t1', 'New notes');

            const desc = handleSetTrackNotes.describe(action, single(action));

            expect(desc.inverseAction).toEqual({
                type: 'setTrackNotes',
                payload: { trackId: 't1', notes: 'Old notes', expectedNotes: 'New notes' },
            });
            expect(desc.redoAction).toEqual({
                type: 'setTrackNotes',
                payload: { trackId: 't1', notes: 'New notes', expectedNotes: 'Old notes' },
            });
        });

        it('plans a second action on one track against the notes the first leaves, not the live store', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', notes: 'live' }] });
            const first = notesAction('t1', 'first');
            const second = notesAction('t1', 'second');
            const batch = [first, second];

            const secondDescription = handleSetTrackNotes.describe(second, { actions: batch, actionIndex: 1 });

            expect(secondDescription.inverseAction).toEqual({
                type: 'setTrackNotes',
                payload: { trackId: 't1', notes: 'first', expectedNotes: 'second' },
            });
        });

        it('writes the undo and the redo only while the notes are what each expects', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', notes: 'Old' }] });
            const forward = notesAction('t1', 'New');
            const { inverseAction, redoAction } = handleSetTrackNotes.describe(forward, single(forward));
            if (inverseAction?.type !== 'setTrackNotes' || redoAction?.type !== 'setTrackNotes') {
                throw new Error('Expected a guarded inverse and redo');
            }

            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', notes: 'New' }] });
            expect(handleSetTrackNotes.execute(inverseAction)).toEqual({ status: 'written' });
            expect(mocks.setTrackNotes).toHaveBeenLastCalledWith('t1', 'Old');

            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', notes: 'Old' }] });
            expect(handleSetTrackNotes.execute(redoAction)).toEqual({ status: 'written' });
            expect(mocks.setTrackNotes).toHaveBeenLastCalledWith('t1', 'New');
        });

        it('replays only a restore that names the notes it expects after divergence', () => {
            expect(handleSetTrackNotes.canReapplyAfterDivergence?.(notesAction('t1', 'a'))).toBe(false);
            expect(handleSetTrackNotes.canReapplyAfterDivergence?.(notesAction('t1', 'a', 'b'))).toBe(true);
        });
    });

    describe('isNoop', () => {
        it('treats unchanged notes as a no-op and changed notes as a write', () => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 't1', notes: 'same' }] });

            expect(handleSetTrackNotes.isNoop?.(notesAction('t1', 'same'))).toBe(true);
            expect(handleSetTrackNotes.isNoop?.(notesAction('t1', 'different'))).toBe(false);
        });
    });
});
